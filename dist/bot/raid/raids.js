"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeRaidDecisions = exports.activeRaidEncounters = void 0;
exports.performRaid = performRaid;
exports.resolveRareRouteDecision = resolveRareRouteDecision;
exports.resolveRaidBranchDecision = resolveRaidBranchDecision;
exports.presentBossBattle = presentBossBattle;
exports.reconcileBossBattleOutcome = reconcileBossBattleOutcome;
// Raid execution, raid decisions, and boss battles.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const catalog_1 = require("../../game/catalog");
const bossHearts_1 = require("../../game/bossHearts");
const bossPortraits_1 = require("../../game/bossPortraits");
const gearEconomy_1 = require("../../game/gearEconomy");
const payloads_1 = require("../../game/payloads");
const raid_1 = require("../../game/raid");
const RaidDomain = __importStar(require("../../raid/domain"));
const RaidRuntime = __importStar(require("../../raid/runtime"));
const combat_1 = require("../../raid/combat");
const config_1 = require("../core/config");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const embeds_1 = require("../ui/embeds");
const autocomplete_1 = require("../ui/autocomplete");
exports.activeRaidEncounters = new Set();
function performRaid(...args) {
    return (0, utils_1.withDeferredPointsSave)(() => performRaidUnbatched(...args));
}
function performRaidUnbatched(userId, bet, tension, mapKeyRaw, selectedWeaponId, selectedArmorId, approachRaw, extractionRoute, branchDecision = "stay_course") {
    const user = (0, utils_1.ensureUser)(userId);
    const now = Date.now();
    if (now - user.lastRaid < config_1.RAID_COOLDOWN_MS) {
        const remain = Math.ceil((config_1.RAID_COOLDOWN_MS - (now - user.lastRaid)) / 1000);
        return { error: `Raid systems recharging. Wait ${remain}s.` };
    }
    if (bet < config_1.MIN_RAID_BET)
        return { error: `Minimum raid bet is ${config_1.MIN_RAID_BET} FN Token$.` };
    if (!(0, utils_1.canAffordTokens)(userId, bet))
        return { error: "Not enough FN Token$." };
    const mapCfg = RaidDomain.resolveRaidMap(mapKeyRaw);
    const approach = RaidDomain.resolveRaidApproach(approachRaw);
    const branchModifiers = RaidDomain.getRaidBranchModifiers(extractionRoute || null, branchDecision);
    const mapReputationBefore = (0, utils_1.getMapReputationEntry)(userId, mapCfg.key);
    const mapReputationBeforeProgress = RaidDomain.getMapReputationProgress(mapReputationBefore.points);
    const mapEvent = RaidDomain.rollRaidMapEvent(mapCfg.key, mapReputationBeforeProgress.tier.level);
    const table = {
        low: { successChance: 0.78, tokenMultiplier: 1.07, baseRxp: 5 },
        medium: { successChance: 0.53, tokenMultiplier: 1.42, baseRxp: 11 },
        high: { successChance: 0.31, tokenMultiplier: 2.06, baseRxp: 22 }
    };
    const cfg = table[tension] || table.medium;
    const condition = RaidDomain.rollRaidCondition();
    const gearBonus = RaidRuntime.getRaidLoadoutBonus({ userId, condition, selectedWeaponId, selectedArmorId, getInventoryCount: utils_1.getInventoryCount, getBestOwnedGear: autocomplete_1.getBestOwnedGear });
    if (gearBonus.error)
        return { error: gearBonus.error };
    const effectiveCondition = gearBonus.negatedCondition
        ? { ...condition, successDelta: 0, tokenMultiplierDelta: 0, xpMultiplier: 1 }
        : condition;
    const pmcLevelBeforeRaid = (0, utils_1.getPmcLevel)(user.pmcXP);
    const pmcTierBeforeRaid = (0, utils_1.getPmcTierForLevel)(pmcLevelBeforeRaid);
    const pmcBuffs = (0, utils_1.getPmcBuffs)(pmcLevelBeforeRaid, user.pmcPrestige);
    const sirGru = user.followers?.sir_gru;
    const followerBonuses = (0, utils_1.getSirGruRaidBonuses)(sirGru);
    const levelPressure = Math.max(0, Math.min(0.11, pmcLevelBeforeRaid * 0.00075));
    const tensionPressure = tension === "high" ? 0.05 : tension === "medium" ? 0.02 : -0.01;
    const difficultyScalar = 1 + levelPressure + Math.max(0, tensionPressure);
    const mapDifficultyIndex = RaidDomain.getRaidDifficultyIndex(mapCfg.difficulty);
    const mapDifficultyBossScale = 1 + (mapDifficultyIndex * 0.055);
    const latePmcBossScale = pmcLevelBeforeRaid >= 8000
        ? 1 + Math.min(0.18, (pmcLevelBeforeRaid - 8000) / 60000)
        : 1;
    const bossSpawnChance = Math.max(0.03, Math.min(0.82, mapCfg.bossSpawnChance + 0.02 + tensionPressure + levelPressure * 0.5 + mapCfg.bossRaidPressure * 0.35 + approach.bossSpawnDelta));
    const bossSpawned = Math.random() < bossSpawnChance;
    const boss = bossSpawned ? RaidDomain.rollBossVariant(mapCfg) : null;
    const priorBossProgress = boss ? (0, utils_1.getBossProgressEntry)(userId, boss.name) : null;
    const alternateBossForm = Boolean(boss && priorBossProgress?.alternateFormUnlocked && Math.random() < 0.35);
    if (alternateBossForm && boss) {
        boss.ferocity = Math.min(2.6, boss.ferocity * 1.15);
        boss.title = `${boss.title} • Alternate Form`;
    }
    const bossCombat = boss ? RaidDomain.getBossCombatModifiers(boss.name, approach.key) : null;
    const bossPressurePenalty = bossSpawned
        ? (mapCfg.bossSuccessPenalty + mapCfg.bossRaidPressure + (boss?.successPenalty || 0) * difficultyScalar + (boss?.raidPressure || 0) * difficultyScalar) * mapDifficultyBossScale * latePmcBossScale
        : 0;
    const followerPreAssist = (0, utils_1.rollSirGruRaidAssist)(sirGru, { bet, bossSpawned });
    const finalSuccessChance = Math.max(0.06, Math.min(0.93, cfg.successChance + mapCfg.successDelta + effectiveCondition.successDelta + gearBonus.attackBoost + pmcBuffs.successBonus + followerBonuses.successBonus + followerPreAssist.successBonus + approach.successDelta + branchModifiers.successDelta + (mapEvent?.successDelta || 0) + mapReputationBeforeProgress.tier.successBonus - bossPressurePenalty));
    const success = Math.random() < finalSuccessChance;
    const followerAssist = (0, utils_1.rollSirGruRaidAssist)(sirGru, { bet, success, bossSpawned });
    (0, utils_1.removeTokens)(userId, bet);
    let rewardTokens = 0;
    if (success) {
        const conditionTokenBoost = cfg.tokenMultiplier + mapCfg.tokenMultiplierDelta + effectiveCondition.tokenMultiplierDelta + gearBonus.tokenBoost + pmcBuffs.tokenBonus + followerBonuses.tokenBonus + followerAssist.tokenBonus + approach.tokenMultiplierDelta + branchModifiers.tokenMultiplierDelta + (mapEvent?.tokenMultiplierDelta || 0) + mapReputationBeforeProgress.tier.tokenBonus;
        rewardTokens = Math.max(1, Math.floor(bet * (conditionTokenBoost + (Math.random() * 0.12 - 0.07))));
        (0, utils_1.addTokens)(userId, rewardTokens);
    }
    const outcomeText = (0, raid_1.getRaidOutcome)(userId);
    const reward = success ? (0, raid_1.getRaidRewards)(outcomeText) : { tokens: 0 };
    if (reward.tokens > 0)
        (0, utils_1.addTokens)(userId, reward.tokens);
    let bossDefeated = false;
    let bossKillChance = 0;
    let bossBonusXp = 0;
    let bossTokenBonus = 0;
    let bossHeartUnlockedName;
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
            (0, utils_1.addTokens)(userId, bossTokenBonus);
            user.pmcBossKills = Math.max(0, Math.floor((user.pmcBossKills || 0) + 1));
            const bossHeartUnlock = (0, bossHearts_1.awardBossHeartAchievement)(userId, boss?.name || mapCfg.bossName);
            if (bossHeartUnlock.awarded) {
                bossHeartUnlockedName = bossHeartUnlock.heartName;
                (0, audit_1.appendAuditEvent)("boss_heart_unlocked", {
                    userId,
                    bossName: boss?.name || mapCfg.bossName,
                    heartName: bossHeartUnlock.heartName || null
                });
            }
        }
    }
    const bossProgress = bossSpawned ? (0, utils_1.recordBossProgress)(userId, boss?.name || mapCfg.bossName, bossDefeated) : null;
    let pmcHpMax = 0;
    let pmcHpRemaining = 0;
    let bossHpMax = 0;
    let bossHpRemaining = 0;
    if (bossSpawned) {
        const pmcPool = 500
            + Math.round(Math.min(260, pmcLevelBeforeRaid * 0.02))
            + Math.round(Math.max(0, gearBonus.defenseBoost) * 340);
        const bossPool = Math.round((520 + mapDifficultyIndex * 45)
            * (boss?.ferocity || 1)
            * (1 + mapCfg.bossRaidPressure * 0.35));
        let pmcRemainingPct = 0;
        let bossRemainingPct = 1;
        if (!success) {
            pmcRemainingPct = Math.max(0.04, Math.min(0.32, 0.11 + gearBonus.defenseBoost * 0.7 + finalSuccessChance * 0.08));
            bossRemainingPct = Math.max(0.62, Math.min(1, 0.82 + (1 - finalSuccessChance) * 0.14));
        }
        else if (bossDefeated) {
            pmcRemainingPct = Math.max(0.14, Math.min(0.9, 0.28 + bossKillChance * 0.42 + gearBonus.defenseBoost * 0.5));
            bossRemainingPct = 0;
        }
        else {
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
    const newGearNames = Array.from(new Set(loot.filter(drop => ["weapon", "armor"].includes(catalog_1.ITEM_DEFS[drop.id]?.kind || "") && (0, utils_1.getInventoryCount)(userId, drop.id) === 0).map(drop => catalog_1.ITEM_DEFS[drop.id].name)));
    for (const drop of loot) {
        (0, utils_1.addInventoryItem)(userId, drop.id, drop.qty);
    }
    const objectiveRewards = RaidDomain.getRaidObjectiveRewards(branchDecision, success);
    const baseRaidXpGain = RaidDomain.rollRaidXpGain(tension, success, bet, effectiveCondition.xpMultiplier * gearBonus.xpMultiplier * (1 + pmcBuffs.xpBonus) * approach.xpMultiplier * objectiveRewards.xpMultiplier, mapCfg);
    const progressionScale = RaidDomain.getPmcXpGainScale(pmcLevelBeforeRaid, mapCfg, tension, success) * (1 + followerBonuses.xpBonus + followerAssist.xpBonus);
    const scaledRaidXpGain = Math.max(1, Math.floor(baseRaidXpGain * progressionScale * RaidDomain.RAID_PMC_XP_SCALE));
    const rxpGain = scaledRaidXpGain + bossBonusXp;
    user.rxp += rxpGain;
    user.pmcXP += rxpGain;
    user.pmcRaids += 1;
    if (success)
        user.pmcRaidWins += 1;
    user.lastRaid = now;
    const pmcLevelAfterRaid = (0, utils_1.getPmcLevel)(user.pmcXP);
    (0, utils_1.applyPmcMilestoneRewards)(userId);
    const followerRaidProgress = (0, utils_1.awardSirGruRaidXp)(user, { success, bossSpawned, bossDefeated, tension, mapDifficulty: mapCfg.difficulty });
    if (followerRaidProgress.levelAfter > followerRaidProgress.levelBefore) {
        (0, audit_1.appendAuditEvent)("sir_gru_level_up", {
            userId,
            levelBefore: followerRaidProgress.levelBefore,
            levelAfter: followerRaidProgress.levelAfter,
            xpGained: followerRaidProgress.xpGained,
            maxPerkUnlocked: followerRaidProgress.maxPerkUnlocked
        });
    }
    for (const gearId of [gearBonus.weapon?.id, gearBonus.armor?.id].filter((id) => Boolean(id))) {
        (0, gearEconomy_1.resolveGearLoss)(user, gearId, success);
    }
    const pmcTierAfterRaid = (0, utils_1.getPmcTierForLevel)(pmcLevelAfterRaid);
    const pmcTierUnlocked = pmcTierAfterRaid && (!pmcTierBeforeRaid || pmcTierAfterRaid.level > pmcTierBeforeRaid.level)
        ? pmcTierAfterRaid
        : null;
    const failureMitigation = success ? 0 : Math.floor(bet * (gearBonus.defenseBoost + pmcBuffs.defenseBonus + followerBonuses.defenseBonus + followerAssist.defenseBonus) * 0.7) + followerAssist.flatFailureMitigation;
    if (failureMitigation > 0)
        (0, utils_1.addTokens)(userId, failureMitigation);
    const baseRewardTokens = rewardTokens;
    const outcomeBonusTokens = reward.tokens;
    const net = baseRewardTokens + outcomeBonusTokens + bossTokenBonus + failureMitigation - bet;
    const mapReputationGain = RaidDomain.calculateMapReputationGain({ mapDifficulty: mapCfg.difficulty, tension, success, bossSpawned, bossDefeated }) + objectiveRewards.reputationBonus;
    const mapReputationResult = (0, utils_1.recordMapReputation)({ userId, mapKey: mapCfg.key, points: mapReputationGain, success, bossSpawned, bossDefeated, timestamp: now });
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
    if (user.raidHistory.length > 12)
        user.raidHistory = user.raidHistory.slice(0, 12);
    (0, utils_1.savePoints)();
    (0, utils_1.recordGameResult)(userId, "raid", success ? "win" : "loss", bet, rewardTokens + reward.tokens + bossTokenBonus + failureMitigation);
    (0, audit_1.appendAuditEvent)("raid_result", {
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
        sirGruSupportRole: utils_1.FOLLOWER_SUPPORT_ROLES[(0, utils_1.getFollowerSupportRole)(sirGru)].label,
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
        pmcPrestigeLabel: (0, utils_1.getPmcPrestigeTier)(user.pmcPrestige).label,
        sirGruXpGained: followerRaidProgress.xpGained,
        sirGruLevel: followerRaidProgress.levelAfter || undefined,
        sirGruLevelBefore: followerRaidProgress.levelBefore || undefined,
        sirGruMaxPerkUnlocked: followerRaidProgress.maxPerkUnlocked,
        sirGruAbilities: followerAssist.unlockedAbilities.map(ability => ability.name),
        sirGruTriggeredAbilities: followerAssist.triggeredAbilities
    };
}
exports.activeRaidDecisions = new Map();
async function awaitRaidDecision(interaction, message, ids, time) {
    const validIds = new Set(ids);
    exports.activeRaidDecisions.set(message.id, { userId: interaction.user.id, ids: validIds });
    try {
        const selected = await message.awaitMessageComponent({
            componentType: discord_js_1.ComponentType.Button,
            time,
            filter: candidate => candidate.user.id === interaction.user.id && validIds.has(candidate.customId)
        }).catch(() => null);
        if (selected)
            await selected.deferUpdate().catch(() => undefined);
        return selected;
    }
    finally {
        exports.activeRaidDecisions.delete(message.id);
    }
}
async function resolveRareRouteDecision(interaction, route, mapLabel) {
    const payload = JSON.parse((0, payloads_1.buildRareRouteDecisionPayload)({
        route,
        mapLabel,
        requiredItemName: catalog_1.ITEM_DEFS[route.requiredItemId]?.name || route.requiredItemId
    }));
    const message = await interaction.editReply({
        embeds: [(0, embeds_1.embedFromPayload)("raid", payload.embed, interaction.user)],
        components: payload.components
    });
    const selected = await awaitRaidDecision(interaction, message, [payloads_1.RAID_ENCOUNTER_IDS.hiddenExit, payloads_1.RAID_ENCOUNTER_IDS.routeCache, payloads_1.RAID_ENCOUNTER_IDS.stayCourse], 20000);
    if (!selected)
        return "stay_course";
    if (selected.customId === payloads_1.RAID_ENCOUNTER_IDS.hiddenExit)
        return "hidden_exit";
    if (selected.customId === payloads_1.RAID_ENCOUNTER_IDS.routeCache)
        return "route_cache";
    return "stay_course";
}
async function resolveRaidBranchDecision(interaction, mapLabel, tension) {
    const payload = JSON.parse((0, payloads_1.buildRaidBranchDecisionPayload)({ mapLabel, tension }));
    const message = await interaction.editReply({
        embeds: [(0, embeds_1.embedFromPayload)("raid", payload.embed, interaction.user)],
        components: payload.components
    });
    const selected = await awaitRaidDecision(interaction, message, [payloads_1.RAID_ENCOUNTER_IDS.securePerimeter, payloads_1.RAID_ENCOUNTER_IDS.pushObjective, payloads_1.RAID_ENCOUNTER_IDS.surveySite, payloads_1.RAID_ENCOUNTER_IDS.rescuePatrol, payloads_1.RAID_ENCOUNTER_IDS.stayCourse], 15000);
    if (!selected)
        return "stay_course";
    if (selected.customId === payloads_1.RAID_ENCOUNTER_IDS.securePerimeter)
        return "secure_perimeter";
    if (selected.customId === payloads_1.RAID_ENCOUNTER_IDS.pushObjective)
        return "push_objective";
    if (selected.customId === payloads_1.RAID_ENCOUNTER_IDS.surveySite)
        return "survey_site";
    if (selected.customId === payloads_1.RAID_ENCOUNTER_IDS.rescuePatrol)
        return "rescue_patrol";
    return "stay_course";
}
async function presentBossBattle(interaction, result) {
    if (!result.bossName || !result.bossHpMax || !result.pmcHpMax)
        return null;
    const bossName = result.bossName;
    const bossHpMax = result.bossHpMax;
    const pmcHpMax = result.pmcHpMax;
    const phaseCount = result.bossPhaseNames?.length || 3;
    const totalTurns = Math.max(6, Math.min(8, phaseCount + 4));
    let action;
    let state = { turn: 0, bossHp: bossHpMax, pmcHp: pmcHpMax, rage: 0, armorBreak: 0, scanRevealed: false };
    let battleLog = [];
    let portraitUploaded = false;
    const actionIds = new Map([
        [payloads_1.RAID_ENCOUNTER_IDS.attack, "attack"],
        [payloads_1.RAID_ENCOUNTER_IDS.defend, "defend"],
        [payloads_1.RAID_ENCOUNTER_IDS.heal, "heal"],
        [payloads_1.RAID_ENCOUNTER_IDS.scan, "scan"]
    ]);
    const renderFrame = async (finished) => {
        const phase = (0, combat_1.getBossBattlePhase)(bossName, state.bossHp, bossHpMax);
        const intent = finished ? null : (0, combat_1.getBossAttackIntent)(state);
        const payload = JSON.parse((0, payloads_1.buildBossBattlePayload)({
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
            medPatchCount: (0, utils_1.getInventoryCount)(interaction.user.id, "med_patch"),
            decisionDeadline: finished ? undefined : Date.now() + 8000,
            battleLog
        }));
        try {
            const message = await interaction.editReply({
                embeds: [(0, embeds_1.embedFromPayload)("raid", payload.embed, interaction.user)],
                components: payload.components,
                ...(!portraitUploaded ? { attachments: [], files: (0, bossPortraits_1.getBossPortraitFiles)(bossName) } : {})
            });
            portraitUploaded = true;
            return message;
        }
        catch (error) {
            console.error(`[raid] Could not render battle frame for ${bossName}:`, error);
            (0, audit_1.appendAuditEvent)("raid_battle_render_failed", { userId: interaction.user.id, bossName, reason: (0, ops_1.toSafeString)(error) });
            return null;
        }
    };
    if (result.bossDefeated || result.success === false) {
        state.bossHp = result.bossHpRemaining ?? bossHpMax;
        state.pmcHp = result.pmcHpRemaining ?? pmcHpMax;
        await renderFrame(true);
        return null;
    }
    while (!(0, combat_1.isBossBattleFinished)(state, totalTurns)) {
        const message = await renderFrame(false);
        if (!message)
            return { defeated: state.bossHp <= 0, bossHp: state.bossHp, pmcHp: state.pmcHp, scanRevealed: state.scanRevealed };
        const selected = await awaitRaidDecision(interaction, message, [...actionIds.keys(), payloads_1.RAID_ENCOUNTER_IDS.extract], 8000);
        if (selected?.customId === payloads_1.RAID_ENCOUNTER_IDS.extract) {
            battleLog = ["Extraction chosen. Secured raid rewards retained."];
            break;
        }
        action = selected ? actionIds.get(selected.customId) || "attack" : "attack";
        const resolved = (0, combat_1.resolveBossTurn)({ state, action, totalTurns, pmcHpMax, medPatchCount: (0, utils_1.getInventoryCount)(interaction.user.id, "med_patch") });
        if (resolved.medPatchesUsed)
            (0, utils_1.removeInventoryItem)(interaction.user.id, "med_patch", resolved.medPatchesUsed);
        state = resolved.state;
        battleLog = [...(!selected ? ["Action timed out. Auto-attack selected."] : []), ...resolved.log];
    }
    await renderFrame(true);
    return { defeated: state.bossHp <= 0, bossHp: state.bossHp, pmcHp: state.pmcHp, scanRevealed: state.scanRevealed };
}
function reconcileBossBattleOutcome(...args) {
    return (0, utils_1.withDeferredPointsSave)(() => reconcileBossBattleOutcomeUnbatched(...args));
}
function reconcileBossBattleOutcomeUnbatched(userId, mapCfg, result, battle) {
    result.bossHpRemaining = battle.bossHp;
    result.pmcHpRemaining = battle.pmcHp;
    if (result.bossName && result.bossHpMax) {
        result.bossCurrentPhase = (0, combat_1.getBossBattlePhase)(result.bossName, battle.bossHp, result.bossHpMax).name;
        result.bossPhasesReached = RaidDomain.getBossCombatProfile(result.bossName).phases.filter(phase => battle.bossHp <= result.bossHpMax * phase.thresholdPct / 100).length;
    }
    if (!result.success || result.bossDefeated || !battle.defeated || !result.bossName)
        return;
    const user = (0, utils_1.ensureUser)(userId);
    const bonusXp = Math.max(40, Math.floor((result.bossBonusXp || 40) * 1.1));
    const bonusTokens = Math.max(20, Math.floor((result.bet || 0) * 0.15));
    result.bossDefeated = true;
    result.bossBonusXp = bonusXp;
    result.bossBonusTokens = bonusTokens;
    result.rxpGain = (result.rxpGain || 0) + bonusXp;
    result.net = (result.net || 0) + bonusTokens;
    const bonusLoot = [{ id: mapCfg.bossKit.weaponId, qty: 1 }, { id: mapCfg.bossKit.armorId, qty: 1 }];
    result.loot = [...(result.loot || []), ...bonusLoot];
    for (const drop of bonusLoot)
        (0, utils_1.addInventoryItem)(userId, drop.id, drop.qty);
    (0, utils_1.addTokens)(userId, bonusTokens);
    user.rxp += bonusXp;
    user.pmcXP += bonusXp;
    user.pmcBossKills += 1;
    const progress = (0, utils_1.getBossProgressEntry)(userId, result.bossName);
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
    const heart = (0, bossHearts_1.awardBossHeartAchievement)(userId, result.bossName);
    if (heart.awarded)
        result.bossHeartUnlockedName = heart.heartName;
    (0, utils_1.recordGameResult)(userId, "raid", "win", 0, bonusTokens);
    (0, utils_1.savePoints)();
}
