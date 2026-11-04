// Raid execution, raid decisions, and boss battles.
import { ChatInputCommandInteraction, ComponentType } from "discord.js";
import {
    addTokens, awardSirGruRaidXp, applyPmcMilestoneRewards, addInventoryItem, canAffordTokens, ensureUser,
    getInventoryCount, getMapReputationEntry, getPmcBuffs, getPmcLevel, getPmcPrestigeTier, getPmcTierForLevel,
    getSirGruRaidBonuses, getFollowerSupportRole, FOLLOWER_SUPPORT_ROLES, getBossProgressEntry,
    removeInventoryItem, removeTokens, recordGameResult, recordBossProgress, recordMapReputation,
    rollSirGruRaidAssist, savePoints, withDeferredPointsSave
} from "../../utils";
import { ITEM_DEFS } from "../../game/catalog";
import { awardBossHeartAchievement } from "../../game/bossHearts";
import { getBossPortraitFiles } from "../../game/bossPortraits";
import { resolveGearLoss } from "../../game/gearEconomy";
import {
    buildBossBattlePayload, buildRaidBranchDecisionPayload, buildRareRouteDecisionPayload, RAID_ENCOUNTER_IDS
} from "../../game/payloads";
import { getRaidOutcome, getRaidRewards } from "../../game/raid";
import * as RaidDomain from "../../raid/domain";
import * as RaidRuntime from "../../raid/runtime";
import {
    getBossAttackIntent, getBossBattlePhase, isBossBattleFinished, resolveBossTurn, type BossAction,
    type BossBattleState
} from "../../raid/combat";
import { MIN_RAID_BET, RAID_COOLDOWN_MS } from "../core/config";
import { toSafeString } from "../core/ops";
import { appendAuditEvent } from "../core/audit";
import { embedFromPayload } from "../ui/embeds";
import { getBestOwnedGear } from "../ui/autocomplete";

export const activeRaidEncounters = new Set<string>();

export function performRaid(...args: Parameters<typeof performRaidUnbatched>): ReturnType<typeof performRaidUnbatched> {
    return withDeferredPointsSave(() => performRaidUnbatched(...args));
}

function performRaidUnbatched(userId: string, bet: number, tension: string, mapKeyRaw?: string | null, selectedWeaponId?: string | null, selectedArmorId?: string | null, approachRaw?: string | null, extractionRoute?: RaidDomain.RareExtractionRoute | null, branchDecision: RaidDomain.RaidBranchDecisionKey = "stay_course"): {
    error?: string;
    success?: boolean;
    net?: number;
    loot?: Array<{ id: string; qty: number }>;
    rxpGain?: number;
    successChance?: number;
    bet?: number;
    tension?: string;
    pmcLevel?: number;
    pmcXP?: number;
    pmcPrestige?: number;
    pmcPrestigeLabel?: string;
    mapLabel?: string;
    mapDifficulty?: string;
    conditionLabel?: string;
    bossSpawned?: boolean;
    bossDefeated?: boolean;
    bossName?: string;
    bossTitle?: string;
    bossFerocity?: number;
    bossBonusXp?: number;
    bossKillChance?: number;
    pmcHpMax?: number;
    pmcHpRemaining?: number;
    bossHpMax?: number;
    bossHpRemaining?: number;
    bossHeartUnlockedName?: string;
    pmcTierUnlockedLabel?: string;
    pmcTierUnlockedBadge?: string;
    selectedWeaponName?: string;
    selectedArmorName?: string;
    baseRewardTokens?: number;
    outcomeBonusTokens?: number;
    bossBonusTokens?: number;
    failureMitigationTokens?: number;
    approachLabel?: string;
    mapKey?: string;
    mapReputationGain?: number;
    mapReputationPoints?: number;
    mapReputationTier?: string;
    mapReputationTierUnlocked?: string;
    mapReputationProgressPct?: number;
    bossTraitLabels?: string[];
    bossCounteredTraits?: string[];
    bossPhaseNames?: string[];
    bossPhasesReached?: number;
    bossCurrentPhase?: string;
    bossCombatRewardMultiplier?: number;
    extractionRouteLabel?: string;
    branchDecisionLabel?: string;
    mapEventLabel?: string;
    mapEventDetails?: string;
    objectiveOutcome?: string;
    loadoutSetLabel?: string;
    newGearNames?: string[];
    sirGruSupportRole?: string;
    bossCurrentStreak?: number;
    bossBestStreak?: number;
    bossIntelLevel?: number;
    bossHeartUpgradeLevel?: number;
    bossAlternateFormUnlocked?: boolean;
    alternateBossForm?: boolean;
    sirGruXpGained?: number;
    sirGruLevel?: number;
    sirGruLevelBefore?: number;
    sirGruMaxPerkUnlocked?: boolean;
    sirGruAbilities?: string[];
    sirGruTriggeredAbilities?: string[];
} {
    const user = ensureUser(userId);
    const now = Date.now();

    if (now - user.lastRaid < RAID_COOLDOWN_MS) {
        const remain = Math.ceil((RAID_COOLDOWN_MS - (now - user.lastRaid)) / 1000);
        return { error: `Raid systems recharging. Wait ${remain}s.` };
    }
    if (bet < MIN_RAID_BET) return { error: `Minimum raid bet is ${MIN_RAID_BET} FN Token$.` };
    if (!canAffordTokens(userId, bet)) return { error: "Not enough FN Token$." };

    const mapCfg = RaidDomain.resolveRaidMap(mapKeyRaw);
    const approach = RaidDomain.resolveRaidApproach(approachRaw);
    const branchModifiers = RaidDomain.getRaidBranchModifiers(extractionRoute || null, branchDecision);
    const mapReputationBefore = getMapReputationEntry(userId, mapCfg.key);
    const mapReputationBeforeProgress = RaidDomain.getMapReputationProgress(mapReputationBefore.points);
    const mapEvent = RaidDomain.rollRaidMapEvent(mapCfg.key, mapReputationBeforeProgress.tier.level);
    const table = {
        low: { successChance: 0.78, tokenMultiplier: 1.07, baseRxp: 5 },
        medium: { successChance: 0.53, tokenMultiplier: 1.42, baseRxp: 11 },
        high: { successChance: 0.31, tokenMultiplier: 2.06, baseRxp: 22 }
    } as const;
    const cfg = table[(tension as keyof typeof table)] || table.medium;
    const condition = RaidDomain.rollRaidCondition();
    const gearBonus = RaidRuntime.getRaidLoadoutBonus({ userId, condition, selectedWeaponId, selectedArmorId, getInventoryCount, getBestOwnedGear });
    if (gearBonus.error) return { error: gearBonus.error };
    const effectiveCondition = gearBonus.negatedCondition
        ? { ...condition, successDelta: 0, tokenMultiplierDelta: 0, xpMultiplier: 1 }
        : condition;
    const pmcLevelBeforeRaid = getPmcLevel(user.pmcXP);
    const pmcTierBeforeRaid = getPmcTierForLevel(pmcLevelBeforeRaid);
    const pmcBuffs = getPmcBuffs(pmcLevelBeforeRaid, user.pmcPrestige);
    const sirGru = user.followers?.sir_gru;
    const followerBonuses = getSirGruRaidBonuses(sirGru);
    const levelPressure = Math.max(0, Math.min(0.11, pmcLevelBeforeRaid * 0.00075));
    const tensionPressure = tension === "high" ? 0.05 : tension === "medium" ? 0.02 : -0.01;
    const difficultyScalar = 1 + levelPressure + Math.max(0, tensionPressure);

    const mapDifficultyIndex = RaidDomain.getRaidDifficultyIndex(mapCfg.difficulty);
    const mapDifficultyBossScale = 1 + (mapDifficultyIndex * 0.055);
    const latePmcBossScale = pmcLevelBeforeRaid >= 8000
        ? 1 + Math.min(0.18, (pmcLevelBeforeRaid - 8000) / 60000)
        : 1;

    const bossSpawnChance = Math.max(
        0.03,
        Math.min(0.82, mapCfg.bossSpawnChance + 0.02 + tensionPressure + levelPressure * 0.5 + mapCfg.bossRaidPressure * 0.35 + approach.bossSpawnDelta)
    );
    const bossSpawned = Math.random() < bossSpawnChance;
    const boss = bossSpawned ? RaidDomain.rollBossVariant(mapCfg) : null;
    const priorBossProgress = boss ? getBossProgressEntry(userId, boss.name) : null;
    const alternateBossForm = Boolean(boss && priorBossProgress?.alternateFormUnlocked && Math.random() < 0.35);
    if (alternateBossForm && boss) {
        boss.ferocity = Math.min(2.6, boss.ferocity * 1.15);
        boss.title = `${boss.title} • Alternate Form`;
    }
    const bossCombat = boss ? RaidDomain.getBossCombatModifiers(boss.name, approach.key) : null;
    const bossPressurePenalty = bossSpawned
        ? (mapCfg.bossSuccessPenalty + mapCfg.bossRaidPressure + (boss?.successPenalty || 0) * difficultyScalar + (boss?.raidPressure || 0) * difficultyScalar) * mapDifficultyBossScale * latePmcBossScale
        : 0;
    const followerPreAssist = rollSirGruRaidAssist(sirGru, { bet, bossSpawned });
    const finalSuccessChance = Math.max(
        0.06,
        Math.min(0.93, cfg.successChance + mapCfg.successDelta + effectiveCondition.successDelta + gearBonus.attackBoost + pmcBuffs.successBonus + followerBonuses.successBonus + followerPreAssist.successBonus + approach.successDelta + branchModifiers.successDelta + (mapEvent?.successDelta || 0) + mapReputationBeforeProgress.tier.successBonus - bossPressurePenalty)
    );

    const success = Math.random() < finalSuccessChance;
    const followerAssist = rollSirGruRaidAssist(sirGru, { bet, success, bossSpawned });
    removeTokens(userId, bet);

    let rewardTokens = 0;
    if (success) {
        const conditionTokenBoost = cfg.tokenMultiplier + mapCfg.tokenMultiplierDelta + effectiveCondition.tokenMultiplierDelta + gearBonus.tokenBoost + pmcBuffs.tokenBonus + followerBonuses.tokenBonus + followerAssist.tokenBonus + approach.tokenMultiplierDelta + branchModifiers.tokenMultiplierDelta + (mapEvent?.tokenMultiplierDelta || 0) + mapReputationBeforeProgress.tier.tokenBonus;
        rewardTokens = Math.max(1, Math.floor(bet * (conditionTokenBoost + (Math.random() * 0.12 - 0.07))));
        addTokens(userId, rewardTokens);
    }

    const outcomeText = getRaidOutcome(userId);
    const reward = success ? getRaidRewards(outcomeText) : { tokens: 0 };
    if (reward.tokens > 0) addTokens(userId, reward.tokens);

    let bossDefeated = false;
    let bossKillChance = 0;
    let bossBonusXp = 0;
    let bossTokenBonus = 0;
    let bossHeartUnlockedName: string | undefined;
    if (success && bossSpawned) {
        const tensionBossDelta = tension === "high" ? 0.08 : tension === "low" ? -0.03 : 0;
        const mapAndBossKillPenalty = (mapCfg.bossKillPenalty + mapCfg.bossRaidPressure + (boss?.killPenalty || 0) * difficultyScalar + (boss?.raidPressure || 0) * difficultyScalar) * (1 + mapDifficultyIndex * 0.05) * latePmcBossScale;
        const pmcRaidMastery = Math.max(0, Math.min(0.14, pmcLevelBeforeRaid * 0.00085));
        bossKillChance = Math.max(0.1, Math.min(0.9, 0.42 + gearBonus.attackBoost * 1.8 + pmcRaidMastery + followerBonuses.bossKillBonus + followerPreAssist.bossKillBonus + tensionBossDelta + approach.bossKillDelta + mapReputationBeforeProgress.tier.bossKillBonus + (bossCombat?.counterBonus || 0) - mapAndBossKillPenalty - (bossCombat?.killPenalty || 0)));
        bossDefeated = Math.random() < bossKillChance;
        if (bossDefeated) {
            const rolledBossReward = RaidDomain.rollBossSuccessRewards({
                bet,
                tension,
                mapDifficulty: mapCfg.difficulty,
                bossFerocity: boss?.ferocity || 1,
                bonusXpRange: boss?.bonusXpRange || mapCfg.bossBonusXpRange,
                tokenRewardRange: boss?.tokenRewardRange || [20, 55],
                combatRewardMultiplier: bossCombat?.rewardMultiplier || 1
            });
            bossBonusXp = Math.max(1, Math.floor(rolledBossReward.bossBonusXp * RaidDomain.RAID_BOSS_XP_SCALE));
            bossTokenBonus = rolledBossReward.bossTokenBonus;
            addTokens(userId, bossTokenBonus);

            user.pmcBossKills = Math.max(0, Math.floor((user.pmcBossKills || 0) + 1));
            const bossHeartUnlock = awardBossHeartAchievement(userId, boss?.name || mapCfg.bossName);
            if (bossHeartUnlock.awarded) {
                bossHeartUnlockedName = bossHeartUnlock.heartName;
                appendAuditEvent("boss_heart_unlocked", {
                    userId,
                    bossName: boss?.name || mapCfg.bossName,
                    heartName: bossHeartUnlock.heartName || null
                });
            }
        }
    }
    const bossProgress = bossSpawned ? recordBossProgress(userId, boss?.name || mapCfg.bossName, bossDefeated) : null;

    let pmcHpMax = 0;
    let pmcHpRemaining = 0;
    let bossHpMax = 0;
    let bossHpRemaining = 0;
    if (bossSpawned) {
        const pmcPool = 500
            + Math.round(Math.min(260, pmcLevelBeforeRaid * 0.02))
            + Math.round(Math.max(0, gearBonus.defenseBoost) * 340);
        const bossPool = Math.round(
            (520 + mapDifficultyIndex * 45)
            * (boss?.ferocity || 1)
            * (1 + mapCfg.bossRaidPressure * 0.35)
        );

        let pmcRemainingPct = 0;
        let bossRemainingPct = 1;
        if (!success) {
            pmcRemainingPct = Math.max(0.04, Math.min(0.32, 0.11 + gearBonus.defenseBoost * 0.7 + finalSuccessChance * 0.08));
            bossRemainingPct = Math.max(0.62, Math.min(1, 0.82 + (1 - finalSuccessChance) * 0.14));
        } else if (bossDefeated) {
            pmcRemainingPct = Math.max(0.14, Math.min(0.9, 0.28 + bossKillChance * 0.42 + gearBonus.defenseBoost * 0.5));
            bossRemainingPct = 0;
        } else {
            pmcRemainingPct = Math.max(0.06, Math.min(0.54, 0.12 + bossKillChance * 0.24 + gearBonus.defenseBoost * 0.4));
            bossRemainingPct = Math.max(0.1, Math.min(0.88, 0.22 + (1 - bossKillChance) * 0.52));
        }

        pmcHpMax = Math.max(120, pmcPool);
        bossHpMax = Math.max(180, bossPool);
        pmcHpRemaining = Math.max(0, Math.min(pmcHpMax, Math.round(pmcHpMax * pmcRemainingPct)));
        bossHpRemaining = Math.max(0, Math.min(bossHpMax, Math.round(bossHpMax * bossRemainingPct)));
    }

    const bossPhasesReached = bossSpawned && bossCombat
        ? bossDefeated
            ? bossCombat.phases.length
            : bossCombat.phases.filter(phase => bossHpMax > 0 && (bossHpRemaining / bossHpMax) * 100 <= phase.thresholdPct).length
        : 0;
    const bossCurrentPhase = bossCombat && bossPhasesReached > 0
        ? bossCombat.phases[Math.min(bossPhasesReached, bossCombat.phases.length) - 1]
        : null;

    const bossPhaseLootRoll = bossDefeated && (bossCombat?.phases.length || 0) >= 3 ? 1 : 0;
    const loot = RaidRuntime.rollRaidLoot({ success, tension, mapCfg, bossDefeated, boss, difficultyScalar, bonusRolls: approach.lootBonusRolls + bossPhaseLootRoll + branchModifiers.bonusLootRolls + (mapEvent?.lootBonusRolls || 0) + followerAssist.bonusLootRolls });
    const newGearNames = Array.from(new Set(loot.filter(drop => ["weapon", "armor"].includes(ITEM_DEFS[drop.id]?.kind || "") && getInventoryCount(userId, drop.id) === 0).map(drop => ITEM_DEFS[drop.id].name)));
    for (const drop of loot) {
        addInventoryItem(userId, drop.id, drop.qty);
    }

    const objectiveRewards = RaidDomain.getRaidObjectiveRewards(branchDecision, success);
    const baseRaidXpGain = RaidDomain.rollRaidXpGain(
        tension,
        success,
        bet,
        effectiveCondition.xpMultiplier * gearBonus.xpMultiplier * (1 + pmcBuffs.xpBonus) * approach.xpMultiplier * objectiveRewards.xpMultiplier,
        mapCfg
    );
    const progressionScale = RaidDomain.getPmcXpGainScale(pmcLevelBeforeRaid, mapCfg, tension, success) * (1 + followerBonuses.xpBonus + followerAssist.xpBonus);
    const scaledRaidXpGain = Math.max(1, Math.floor(baseRaidXpGain * progressionScale * RaidDomain.RAID_PMC_XP_SCALE));
    const rxpGain = scaledRaidXpGain + bossBonusXp;
    user.rxp += rxpGain;
    user.pmcXP += rxpGain;
    user.pmcRaids += 1;
    if (success) user.pmcRaidWins += 1;
    user.lastRaid = now;

    const pmcLevelAfterRaid = getPmcLevel(user.pmcXP);
    applyPmcMilestoneRewards(userId);
    const followerRaidProgress = awardSirGruRaidXp(user, { success, bossSpawned, bossDefeated, tension, mapDifficulty: mapCfg.difficulty });
    if (followerRaidProgress.levelAfter > followerRaidProgress.levelBefore) {
        appendAuditEvent("sir_gru_level_up", {
            userId,
            levelBefore: followerRaidProgress.levelBefore,
            levelAfter: followerRaidProgress.levelAfter,
            xpGained: followerRaidProgress.xpGained,
            maxPerkUnlocked: followerRaidProgress.maxPerkUnlocked
        });
    }
    for (const gearId of [gearBonus.weapon?.id, gearBonus.armor?.id].filter((id): id is string => Boolean(id))) {
        resolveGearLoss(user, gearId, success);
    }
    const pmcTierAfterRaid = getPmcTierForLevel(pmcLevelAfterRaid);
    const pmcTierUnlocked = pmcTierAfterRaid && (!pmcTierBeforeRaid || pmcTierAfterRaid.level > pmcTierBeforeRaid.level)
        ? pmcTierAfterRaid
        : null;

    const failureMitigation = success ? 0 : Math.floor(bet * (gearBonus.defenseBoost + pmcBuffs.defenseBonus + followerBonuses.defenseBonus + followerAssist.defenseBonus) * 0.7) + followerAssist.flatFailureMitigation;
    if (failureMitigation > 0) addTokens(userId, failureMitigation);
    const baseRewardTokens = rewardTokens;
    const outcomeBonusTokens = reward.tokens;
    const net = baseRewardTokens + outcomeBonusTokens + bossTokenBonus + failureMitigation - bet;
    const mapReputationGain = RaidDomain.calculateMapReputationGain({ mapDifficulty: mapCfg.difficulty, tension, success, bossSpawned, bossDefeated }) + objectiveRewards.reputationBonus;
    const mapReputationResult = recordMapReputation({ userId, mapKey: mapCfg.key, points: mapReputationGain, success, bossSpawned, bossDefeated, timestamp: now });
    const mapReputationAfterProgress = RaidDomain.getMapReputationProgress(mapReputationResult.entry.points);
    const mapReputationTierUnlocked = mapReputationAfterProgress.tier.level > mapReputationBeforeProgress.tier.level
        ? mapReputationAfterProgress.tier.label
        : undefined;
    user.raidHistory.unshift({
        timestamp: now,
        tension,
        map: mapCfg.label,
        mapKey: mapCfg.key,
        condition: gearBonus.negatedCondition ? `${condition.label} (Negated)` : condition.label,
        approach: approach.label,
        extractionRoute: extractionRoute?.label,
        branchDecision: branchModifiers.label,
        mapEvent: mapEvent?.label,
        bet,
        success,
        rewardTokens: baseRewardTokens + outcomeBonusTokens + bossTokenBonus,
        net,
        rxpGain,
        bossSpawned,
        bossDefeated,
        bossName: bossSpawned ? (boss?.name || mapCfg.bossName) : undefined,
        bossTraits: bossCombat?.traits.map(trait => trait.label),
        bossPhasesReached,
        bossPhaseCount: bossCombat?.phases.length,
        mapReputationGain,
        mapReputationPoints: mapReputationResult.entry.points,
        bossBonusXp,
        loot,
        successChance: Math.round(finalSuccessChance * 100)
    });
    if (user.raidHistory.length > 12) user.raidHistory = user.raidHistory.slice(0, 12);
    savePoints();
    recordGameResult(userId, "raid", success ? "win" : "loss", bet, rewardTokens + reward.tokens + bossTokenBonus + failureMitigation);
    appendAuditEvent("raid_result", {
        userId,
        map: mapCfg.label,
        mapDifficulty: mapCfg.difficulty,
        selectedWeaponId: gearBonus.weapon?.id || null,
        selectedArmorId: gearBonus.armor?.id || null,
        pmcBuffs,
        followerBonuses,
        followerAssist: followerAssist.triggeredAbilities,
        tension,
        condition: condition.label,
        approach: approach.key,
        extractionRoute: extractionRoute?.key || null,
        branchDecision,
        mapEvent: mapEvent?.key || null,
        bet,
        success,
        bossSpawned,
        bossDefeated,
        bossName: boss?.name || mapCfg.bossName,
        bossTitle: boss?.title || null,
        bossTraits: bossCombat?.traits.map(trait => trait.key) || [],
        bossPhasesReached,
        bossPhaseCount: bossCombat?.phases.length || 0,
        bossCurrentPhase: bossCurrentPhase?.name || null,
        bossCombatRewardMultiplier: bossCombat?.rewardMultiplier || 1,
        bossFerocity: boss?.ferocity || 0,
        bossSpawnChance: Math.round(bossSpawnChance * 100),
        bossKillChance: Math.round(bossKillChance * 100),
        bossBonusXp,
        bossTokenBonus,
        progressionScale,
        baseRaidXpGain,
        scaledRaidXpGain,
        mapReputationGain,
        mapReputationPoints: mapReputationResult.entry.points,
        mapReputationTier: mapReputationAfterProgress.tier.label,
        mapReputationTierUnlocked: mapReputationTierUnlocked || null,
        net,
        raidXp: rxpGain,
        pmcXP: user.pmcXP,
        pmcPrestige: user.pmcPrestige,
        pmcLevel: pmcLevelAfterRaid,
        pmcTierUnlockedLevel: pmcTierUnlocked?.level || null,
        pmcTierUnlockedLabel: pmcTierUnlocked?.label || null,
        sirGruXpGained: followerRaidProgress.xpGained,
        sirGruLevel: followerRaidProgress.levelAfter,
        sirGruLevelBefore: followerRaidProgress.levelBefore,
        sirGruMaxPerkUnlocked: followerRaidProgress.maxPerkUnlocked,
        sirGruAbilities: followerAssist.unlockedAbilities.map(ability => ability.name),
        sirGruTriggeredAbilities: followerAssist.triggeredAbilities
    });

    return {
        success,
        net,
        loot,
        rxpGain,
        successChance: Math.round(finalSuccessChance * 100),
        bet,
        mapLabel: mapCfg.label,
        mapKey: mapCfg.key,
        mapDifficulty: mapCfg.difficulty,
        conditionLabel: condition.label,
        bossSpawned,
        bossDefeated,
        bossName: boss?.name || mapCfg.bossName,
        bossTitle: boss?.title,
        bossFerocity: boss?.ferocity,
        bossTraitLabels: bossCombat?.traits.map(trait => trait.label),
        bossCounteredTraits: bossCombat?.traits.filter(trait => trait.counterApproach === approach.key).map(trait => trait.label),
        bossPhaseNames: bossCombat?.phases.map(phase => phase.name),
        bossPhasesReached,
        bossCurrentPhase: bossCurrentPhase?.name,
        bossCombatRewardMultiplier: bossCombat?.rewardMultiplier,
        extractionRouteLabel: extractionRoute?.label,
        branchDecisionLabel: branchModifiers.label,
        mapEventLabel: mapEvent?.label,
        mapEventDetails: mapEvent ? `${mapEvent.description}\nExtraction ${mapEvent.successDelta >= 0 ? "+" : ""}${(mapEvent.successDelta * 100).toFixed(1)}% • Tokens ${mapEvent.tokenMultiplierDelta >= 0 ? "+" : ""}${(mapEvent.tokenMultiplierDelta * 100).toFixed(1)}% • Bonus loot rolls ${mapEvent.lootBonusRolls}` : undefined,
        objectiveOutcome: objectiveRewards.outcome,
        loadoutSetLabel: gearBonus.setLabel,
        newGearNames,
        sirGruSupportRole: FOLLOWER_SUPPORT_ROLES[getFollowerSupportRole(sirGru)].label,
        bossCurrentStreak: bossProgress?.currentStreak,
        bossBestStreak: bossProgress?.bestStreak,
        bossIntelLevel: bossProgress?.intelLevel,
        bossHeartUpgradeLevel: bossProgress?.heartUpgradeLevel,
        bossAlternateFormUnlocked: bossProgress?.alternateFormUnlocked,
        alternateBossForm,
        bossBonusXp,
        bossKillChance: Math.round(bossKillChance * 100),
        pmcHpMax: bossSpawned ? pmcHpMax : undefined,
        pmcHpRemaining: bossSpawned ? pmcHpRemaining : undefined,
        bossHpMax: bossSpawned ? bossHpMax : undefined,
        bossHpRemaining: bossSpawned ? bossHpRemaining : undefined,
        bossHeartUnlockedName,
        pmcTierUnlockedLabel: pmcTierUnlocked?.label,
        pmcTierUnlockedBadge: pmcTierUnlocked?.badge,
        selectedWeaponName: gearBonus.weapon?.name,
        selectedArmorName: gearBonus.armor?.name,
        baseRewardTokens,
        outcomeBonusTokens,
        bossBonusTokens: bossTokenBonus,
        failureMitigationTokens: failureMitigation,
        approachLabel: approach.label,
        mapReputationGain,
        mapReputationPoints: mapReputationResult.entry.points,
        mapReputationTier: mapReputationAfterProgress.tier.label,
        mapReputationTierUnlocked,
        mapReputationProgressPct: mapReputationAfterProgress.progressPct,
        tension: `${tension} | ${condition.label}`,
        pmcXP: user.pmcXP,
        pmcLevel: pmcLevelAfterRaid,
        pmcPrestige: user.pmcPrestige,
        pmcPrestigeLabel: getPmcPrestigeTier(user.pmcPrestige).label,
        sirGruXpGained: followerRaidProgress.xpGained,
        sirGruLevel: followerRaidProgress.levelAfter || undefined,
        sirGruLevelBefore: followerRaidProgress.levelBefore || undefined,
        sirGruMaxPerkUnlocked: followerRaidProgress.maxPerkUnlocked,
        sirGruAbilities: followerAssist.unlockedAbilities.map(ability => ability.name),
        sirGruTriggeredAbilities: followerAssist.triggeredAbilities
    };
}

export const activeRaidDecisions = new Map<string, { userId: string; ids: Set<string> }>();

async function awaitRaidDecision(interaction: ChatInputCommandInteraction, message: Awaited<ReturnType<ChatInputCommandInteraction["fetchReply"]>>, ids: string[], time: number) {
    const validIds = new Set(ids);
    activeRaidDecisions.set(message.id, { userId: interaction.user.id, ids: validIds });
    try {
        const selected = await message.awaitMessageComponent({
            componentType: ComponentType.Button,
            time,
            filter: candidate => candidate.user.id === interaction.user.id && validIds.has(candidate.customId)
        }).catch(() => null);
        if (selected) await selected.deferUpdate().catch(() => undefined);
        return selected;
    } finally {
        activeRaidDecisions.delete(message.id);
    }
}

export async function resolveRareRouteDecision(interaction: ChatInputCommandInteraction, route: RaidDomain.RareExtractionRoute, mapLabel: string): Promise<RaidDomain.RaidBranchDecisionKey> {
    const payload = JSON.parse(buildRareRouteDecisionPayload({
        route,
        mapLabel,
        requiredItemName: ITEM_DEFS[route.requiredItemId]?.name || route.requiredItemId
    }));
    const message = await interaction.editReply({
        embeds: [embedFromPayload("raid", payload.embed, interaction.user)],
        components: payload.components
    });
    const selected = await awaitRaidDecision(interaction, message, [RAID_ENCOUNTER_IDS.hiddenExit, RAID_ENCOUNTER_IDS.routeCache, RAID_ENCOUNTER_IDS.stayCourse], 20_000);
    if (!selected) return "stay_course";
    if (selected.customId === RAID_ENCOUNTER_IDS.hiddenExit) return "hidden_exit";
    if (selected.customId === RAID_ENCOUNTER_IDS.routeCache) return "route_cache";
    return "stay_course";
}

export async function resolveRaidBranchDecision(interaction: ChatInputCommandInteraction, mapLabel: string, tension: string): Promise<RaidDomain.RaidBranchDecisionKey> {
    const payload = JSON.parse(buildRaidBranchDecisionPayload({ mapLabel, tension }));
    const message = await interaction.editReply({
        embeds: [embedFromPayload("raid", payload.embed, interaction.user)],
        components: payload.components
    });
    const selected = await awaitRaidDecision(interaction, message, [RAID_ENCOUNTER_IDS.securePerimeter, RAID_ENCOUNTER_IDS.pushObjective, RAID_ENCOUNTER_IDS.surveySite, RAID_ENCOUNTER_IDS.rescuePatrol, RAID_ENCOUNTER_IDS.stayCourse], 15_000);
    if (!selected) return "stay_course";
    if (selected.customId === RAID_ENCOUNTER_IDS.securePerimeter) return "secure_perimeter";
    if (selected.customId === RAID_ENCOUNTER_IDS.pushObjective) return "push_objective";
    if (selected.customId === RAID_ENCOUNTER_IDS.surveySite) return "survey_site";
    if (selected.customId === RAID_ENCOUNTER_IDS.rescuePatrol) return "rescue_patrol";
    return "stay_course";
}

export async function presentBossBattle(interaction: ChatInputCommandInteraction, result: {
    success?: boolean;
    bossName?: string;
    bossTitle?: string;
    bossFerocity?: number;
    bossTraitLabels?: string[];
    bossCounteredTraits?: string[];
    bossPhaseNames?: string[];
    bossCurrentPhase?: string;
    bossDefeated?: boolean;
    bossKillChance?: number;
    bossHpMax?: number;
    bossHpRemaining?: number;
    pmcLevel?: number;
    pmcPrestige?: number;
    pmcHpMax?: number;
    pmcHpRemaining?: number;
    selectedWeaponName?: string;
    selectedArmorName?: string;
}): Promise<{ defeated: boolean; bossHp: number; pmcHp: number; scanRevealed: boolean } | null> {
    if (!result.bossName || !result.bossHpMax || !result.pmcHpMax) return null;
    const bossName = result.bossName;
    const bossHpMax = result.bossHpMax;
    const pmcHpMax = result.pmcHpMax;
    const phaseCount = result.bossPhaseNames?.length || 3;
    const totalTurns = Math.max(6, Math.min(8, phaseCount + 4));
    let action: BossAction | undefined;
    let state: BossBattleState = { turn: 0, bossHp: bossHpMax, pmcHp: pmcHpMax, rage: 0, armorBreak: 0, scanRevealed: false };
    let battleLog: string[] = [];
    let portraitUploaded = false;
    const actionIds = new Map<string, BossAction>([
        [RAID_ENCOUNTER_IDS.attack, "attack"],
        [RAID_ENCOUNTER_IDS.defend, "defend"],
        [RAID_ENCOUNTER_IDS.heal, "heal"],
        [RAID_ENCOUNTER_IDS.scan, "scan"]
    ]);
    const renderFrame = async (finished: boolean) => {
        const phase = getBossBattlePhase(bossName, state.bossHp, bossHpMax);
        const intent = finished ? null : getBossAttackIntent(state);
        const payload = JSON.parse(buildBossBattlePayload({
            bossName,
            bossTitle: result.bossTitle,
            bossFerocity: result.bossFerocity,
            bossTraitLabels: result.bossTraitLabels,
            bossCurrentPhase: phase.name,
            phaseMechanic: phase.mechanic,
            counteredTraits: result.bossCounteredTraits,
            bossKillChance: result.bossKillChance,
            bossHpMax,
            pmcLevel: result.pmcLevel,
            pmcPrestige: result.pmcPrestige,
            pmcHpMax,
            weaponName: result.selectedWeaponName,
            armorName: result.selectedArmorName,
            turn: state.turn,
            totalTurns,
            action,
            interactive: !finished,
            finished,
            bossHpCurrent: state.bossHp,
            pmcHpCurrent: state.pmcHp,
            rage: state.rage,
            armorBreak: state.armorBreak,
            specialAttack: intent
                ? `Countercharge this turn: ${intent.damage} damage. Defend reduces it to ${intent.defendedDamage}.`
                : undefined,
            scanRevealed: state.scanRevealed,
            medPatchCount: getInventoryCount(interaction.user.id, "med_patch"),
            decisionDeadline: finished ? undefined : Date.now() + 8_000,
            battleLog
        }));
        try {
            const message = await interaction.editReply({
                embeds: [embedFromPayload("raid", payload.embed, interaction.user)],
                components: payload.components,
                ...(!portraitUploaded ? { attachments: [], files: getBossPortraitFiles(bossName) } : {})
            });
            portraitUploaded = true;
            return message;
        } catch (error) {
            console.error(`[raid] Could not render battle frame for ${bossName}:`, error);
            appendAuditEvent("raid_battle_render_failed", { userId: interaction.user.id, bossName, reason: toSafeString(error) });
            return null;
        }
    };
    if (result.bossDefeated || result.success === false) {
        state.bossHp = result.bossHpRemaining ?? bossHpMax;
        state.pmcHp = result.pmcHpRemaining ?? pmcHpMax;
        await renderFrame(true);
        return null;
    }
    while (!isBossBattleFinished(state, totalTurns)) {
        const message = await renderFrame(false);
        if (!message) return { defeated: state.bossHp <= 0, bossHp: state.bossHp, pmcHp: state.pmcHp, scanRevealed: state.scanRevealed };
        const selected = await awaitRaidDecision(interaction, message, [...actionIds.keys(), RAID_ENCOUNTER_IDS.extract], 8_000);
        if (selected?.customId === RAID_ENCOUNTER_IDS.extract) {
            battleLog = ["Extraction chosen. Secured raid rewards retained."];
            break;
        }
        action = selected ? actionIds.get(selected.customId) || "attack" : "attack";
        const resolved = resolveBossTurn({ state, action, totalTurns, pmcHpMax, medPatchCount: getInventoryCount(interaction.user.id, "med_patch") });
        if (resolved.medPatchesUsed) removeInventoryItem(interaction.user.id, "med_patch", resolved.medPatchesUsed);
        state = resolved.state;
        battleLog = [...(!selected ? ["Action timed out. Auto-attack selected."] : []), ...resolved.log];
    }
    await renderFrame(true);
    return { defeated: state.bossHp <= 0, bossHp: state.bossHp, pmcHp: state.pmcHp, scanRevealed: state.scanRevealed };
}

export function reconcileBossBattleOutcome(...args: Parameters<typeof reconcileBossBattleOutcomeUnbatched>): ReturnType<typeof reconcileBossBattleOutcomeUnbatched> {
    return withDeferredPointsSave(() => reconcileBossBattleOutcomeUnbatched(...args));
}

function reconcileBossBattleOutcomeUnbatched(userId: string, mapCfg: RaidDomain.RaidMapConfig, result: ReturnType<typeof performRaid>, battle: { defeated: boolean; bossHp: number; pmcHp: number; scanRevealed: boolean }): void {
    result.bossHpRemaining = battle.bossHp;
    result.pmcHpRemaining = battle.pmcHp;
    if (result.bossName && result.bossHpMax) {
        result.bossCurrentPhase = getBossBattlePhase(result.bossName, battle.bossHp, result.bossHpMax).name;
        result.bossPhasesReached = RaidDomain.getBossCombatProfile(result.bossName).phases.filter(phase => battle.bossHp <= result.bossHpMax! * phase.thresholdPct / 100).length;
    }
    if (!result.success || result.bossDefeated || !battle.defeated || !result.bossName) return;
    const user = ensureUser(userId);
    const bonusXp = Math.max(40, Math.floor((result.bossBonusXp || 40) * 1.1));
    const bonusTokens = Math.max(20, Math.floor((result.bet || 0) * 0.15));
    result.bossDefeated = true;
    result.bossBonusXp = bonusXp;
    result.bossBonusTokens = bonusTokens;
    result.rxpGain = (result.rxpGain || 0) + bonusXp;
    result.net = (result.net || 0) + bonusTokens;
    const bonusLoot = [{ id: mapCfg.bossKit.weaponId, qty: 1 }, { id: mapCfg.bossKit.armorId, qty: 1 }];
    result.loot = [...(result.loot || []), ...bonusLoot];
    for (const drop of bonusLoot) addInventoryItem(userId, drop.id, drop.qty);
    addTokens(userId, bonusTokens);
    user.rxp += bonusXp;
    user.pmcXP += bonusXp;
    user.pmcBossKills += 1;
    const progress = getBossProgressEntry(userId, result.bossName);
    progress.kills += 1;
    progress.currentStreak += 1;
    progress.bestStreak = Math.max(progress.bestStreak, progress.currentStreak);
    progress.heartUpgradeLevel = Math.min(3, Math.floor(progress.kills / 3));
    progress.alternateFormUnlocked = progress.kills >= 5;
    result.bossCurrentStreak = progress.currentStreak;
    result.bossBestStreak = progress.bestStreak;
    result.bossIntelLevel = progress.intelLevel;
    result.bossHeartUpgradeLevel = progress.heartUpgradeLevel;
    result.bossAlternateFormUnlocked = progress.alternateFormUnlocked;
    const history = user.raidHistory[0];
    if (history && history.bossName === result.bossName) {
        history.bossDefeated = true;
        history.bossBonusXp = bonusXp;
        history.rewardTokens += bonusTokens;
        history.net += bonusTokens;
        history.rxpGain += bonusXp;
    }
    const heart = awardBossHeartAchievement(userId, result.bossName);
    if (heart.awarded) result.bossHeartUnlockedName = heart.heartName;
    recordGameResult(userId, "raid", "win", 0, bonusTokens);
    savePoints();
}
