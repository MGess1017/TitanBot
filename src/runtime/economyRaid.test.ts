import assert from "node:assert/strict";
import {
    addTokens,
    depositToBank,
    ensureUser,
    getBankTokens,
    getBossProgressEntry,
    getMapReputationEntry,
    getPmcBuffs,
    getPmcLevel,
    getPmcPrestigeTier,
    getTokens,
    performPmcPrestige,
    PMC_LEVEL_CAP,
    PMC_LEVEL_THRESHOLDS,
    PMC_PRESTIGE_CAP,
    PMC_PRESTIGE_LEVEL_REQUIREMENT,
    points,
    applyPmcMilestoneRewards,
    getPmcMasteryLevel,
    recordMapReputation,
    recordBossProgress,
    transferWalletTokens,
    withdrawFromBank
} from "../utils";
import { getRaidRewards } from "../game/raid";
import { ITEM_DEFS, SHOP_ITEMS } from "../game/catalog";
import { getRouteAccessItemDropChance } from "../raid/runtime";
import { CRAFT_RECIPES, craftItem, createAuctionListing, dismantleGear, getDynamicVendorPrice, calculateDynamicLootValue, getGearDurability, insureGear, placeAuctionBid, repairGear, resolveGearLoss, saveLoadout, upgradeGear } from "../game/gearEconomy";
import { buildBossBattlePayload, buildRaidBranchDecisionPayload, buildRaidResultPayload, buildRareRouteDecisionPayload, RAID_ENCOUNTER_IDS, RAID_RESULT_ACTION_IDS } from "../game/payloads";
import {
    BOSS_TRAITS,
    MAP_REPUTATION_TIERS,
    RAID_APPROACHES,
    RAID_BOSS_ROSTER,
    RAID_MAPS,
    RARE_EXTRACTION_ROUTES,
    calculateMapReputationGain,
    discoverRareExtractionRoute,
    getBossCombatModifiers,
    getBossCombatProfile,
    getBossRotationTable,
    getMapReputationProgress,
    getRaidBranchModifiers,
    RAID_MAP_EVENTS,
    rollRaidMapEvent,
    mapProjection,
    resolveRaidApproach,
    rollBossSuccessRewards,
    shouldTriggerRaidDecision
} from "../raid/domain";

function cloneUserState(userId: string) {
    const value = points[userId];
    return value ? JSON.parse(JSON.stringify(value)) : null;
}

function restoreUserState(userId: string, snapshot: unknown): void {
    if (snapshot) {
        points[userId] = snapshot as typeof points[string];
    } else {
        delete points[userId];
    }
}

function runEconomyAndRaidTests(): void {
    const priorNoSaveFlag = process.env.RUNTIME_TEST_NO_POINTS_SAVE;
    process.env.RUNTIME_TEST_NO_POINTS_SAVE = "1";

    const userA = "__test_runtime_user_a__";
    const userB = "__test_runtime_user_b__";
    const snapshotA = cloneUserState(userA);
    const snapshotB = cloneUserState(userB);

    try {
        ensureUser(userA);
        ensureUser(userB);

        points[userA].fnTokens = 0;
        points[userA].bankTokens = 0;
        points[userB].fnTokens = 0;
        points[userB].bankTokens = 0;

        addTokens(userA, 500);
        const afterDeposit = depositToBank(userA, 180);
        assert.equal(afterDeposit.wallet, 320);
        assert.equal(afterDeposit.bank, 180);

        const afterWithdraw = withdrawFromBank(userA, 50);
        assert.equal(afterWithdraw.wallet, 370);
        assert.equal(afterWithdraw.bank, 130);

        const transfer = transferWalletTokens(userA, userB, 120);
        assert.equal(transfer.moved, 120);
        assert.equal(transfer.fromWallet, 250);
        assert.equal(transfer.toWallet, 120);

        assert.equal(getTokens(userA), 250);
        assert.equal(getBankTokens(userA), 130);

        assert.equal(PMC_LEVEL_CAP, 50000);
        assert.equal(PMC_LEVEL_THRESHOLDS.length, PMC_LEVEL_CAP);
        assert.equal(PMC_LEVEL_THRESHOLDS[PMC_PRESTIGE_LEVEL_REQUIREMENT - 1], 14677517320);
        assert.equal(PMC_LEVEL_THRESHOLDS[PMC_PRESTIGE_LEVEL_REQUIREMENT] - PMC_LEVEL_THRESHOLDS[PMC_PRESTIGE_LEVEL_REQUIREMENT - 1], 250025);
        assert.equal(PMC_LEVEL_THRESHOLDS[PMC_LEVEL_CAP - 1] - PMC_LEVEL_THRESHOLDS[PMC_LEVEL_CAP - 2], 1000000);
        assert.equal(getPmcLevel(PMC_LEVEL_THRESHOLDS[PMC_LEVEL_CAP - 1]), PMC_LEVEL_CAP);
        assert.equal(getPmcPrestigeTier(1).numeral, "I");
        assert.equal(getPmcPrestigeTier(PMC_PRESTIGE_CAP).numeral, "X");
        const veteranBuffs = getPmcBuffs(PMC_PRESTIGE_LEVEL_REQUIREMENT, 0);
        const prestigedBuffs = getPmcBuffs(PMC_PRESTIGE_LEVEL_REQUIREMENT, 5);
        assert.ok(prestigedBuffs.successBonus > veteranBuffs.successBonus);
        assert.ok(prestigedBuffs.tokenBonus > veteranBuffs.tokenBonus);
        assert.ok(prestigedBuffs.defenseBonus > veteranBuffs.defenseBonus);
        assert.ok(prestigedBuffs.xpBonus > veteranBuffs.xpBonus);

        delete (points[userB] as Partial<typeof points[string]>).pmcPrestige;
        assert.equal(ensureUser(userB).pmcPrestige, 0);
        points[userB].pmcXP = PMC_LEVEL_THRESHOLDS[PMC_PRESTIGE_LEVEL_REQUIREMENT - 1];
        points[userB].rxp = 999;
        points[userB].inventory = { scrap: 17 };
        points[userB].fnTokens = 4321;
        points[userB].pmcBossKills = 8;
        points[userB].mapReputation = { plagued_cemetary: { points: 100, raids: 4, extracts: 3, bossEncounters: 2, bossKills: 1, lastRaidAt: 123 } };
        const prestigeResult = performPmcPrestige(userB);
        assert.equal(prestigeResult.prestige, 1);
        assert.equal(prestigeResult.tier?.numeral, "I");
        assert.equal(points[userB].pmcXP, 0);
        assert.equal(points[userB].rxp, 0);
        assert.deepEqual(points[userB].inventory, { scrap: 17 });
        assert.equal(points[userB].fnTokens, 4321);
        assert.equal(points[userB].pmcBossKills, 8);
        assert.equal(points[userB].mapReputation.plagued_cemetary.points, 100);
        points[userB].pmcPrestige = PMC_PRESTIGE_CAP;
        points[userB].pmcXP = PMC_LEVEL_THRESHOLDS[PMC_PRESTIGE_LEVEL_REQUIREMENT - 1];
        assert.ok(performPmcPrestige(userB).error);

        const loot = getRaidRewards("found rare loot");
        const extract = getRaidRewards("extracted alive");
        const fail = getRaidRewards("ran out of ammo");
        assert.equal(loot.tokens, 24);
        assert.equal(extract.tokens, 14);
        assert.equal(fail.tokens, 0);

        assert.equal(resolveRaidApproach("unknown").key, "balanced");
        assert.equal(RAID_APPROACHES.balanced.successDelta, 0);
        assert.ok(RAID_APPROACHES.recon.successDelta > 0);
        assert.ok(RAID_APPROACHES.recon.tokenMultiplierDelta < 0);
        assert.ok(RAID_APPROACHES.assault.bossSpawnDelta > 0);
        assert.ok(RAID_APPROACHES.assault.bossKillDelta > 0);
        assert.ok(RAID_APPROACHES.scavenge.lootBonusRolls > 0);
        assert.ok(RAID_APPROACHES.scavenge.successDelta < 0);

        assert.equal(RARE_EXTRACTION_ROUTES.length, 4);
        assert.ok(RARE_EXTRACTION_ROUTES.every(route => route.baseDiscoveryChance < 0.05));
        for (const route of RARE_EXTRACTION_ROUTES) {
            assert.equal(ITEM_DEFS[route.requiredItemId]?.rarity, "mythic");
            assert.ok(!SHOP_ITEMS.includes(route.requiredItemId));
        }
        assert.equal(getRouteAccessItemDropChance({ ultraRareBaseChance: 0.003, legendaryChanceBonus: 0.095, bossDefeated: true, success: true }), 0.0012);
        assert.equal(getRouteAccessItemDropChance({ ultraRareBaseChance: 0.003, legendaryChanceBonus: 0.095, bossDefeated: true, success: false }), 0);
        points[userA].inventory = { pulse_rifle: 1, repair_kit: 1, scrap: 30, rare_material: 4, servo_motor: 1, upgrade_core: 2, combat_stim: 2, power_cell: 2 };
        points[userA].fnTokens = 100000;
        assert.equal(getGearDurability(points[userA], "pulse_rifle"), 100);
        assert.equal(resolveGearLoss(points[userA], "pulse_rifle", true).recovered, false);
        assert.equal(getGearDurability(points[userA], "pulse_rifle"), 92);
        assert.equal(insureGear(points[userA], "pulse_rifle").error, undefined);
        assert.equal(resolveGearLoss(points[userA], "pulse_rifle", false, () => 0).recovered, true);
        points[userA].gearDurability.pulse_rifle = 40;
        assert.equal(repairGear(points[userA], "pulse_rifle").error, undefined);
        assert.equal(getGearDurability(points[userA], "pulse_rifle"), 100);
        const coresBeforeCraft = points[userA].inventory.upgrade_core || 0;
        assert.equal(craftItem(points[userA], CRAFT_RECIPES[0]).error, undefined);
        assert.equal((points[userA].inventory.upgrade_core || 0) > coresBeforeCraft, true);
        assert.equal(upgradeGear(points[userA], "pulse_rifle").error, undefined);
        assert.equal(dismantleGear(points[userA], "pulse_rifle").error, undefined);
        assert.equal(saveLoadout(points[userA], "boss-kit", "pulse_rifle", "guardian_plate", "ammo_ap").error, undefined);
        points[userA].inventory.pulse_rifle = 1;
        points[userA].vendorReputation = 2;
        assert.ok(getDynamicVendorPrice(points[userA], "pulse_rifle") < ITEM_DEFS.pulse_rifle.price);
        assert.ok(calculateDynamicLootValue("pulse_rifle", 0.2) > ITEM_DEFS.pulse_rifle.price);
        const listing = createAuctionListing(points[userA], userA, "pulse_rifle", 1, 100, Date.now() + 60_000);
        assert.ok(!("error" in listing));
        assert.equal(points[userA].inventory.pulse_rifle, 0);
        assert.equal(placeAuctionBid(listing as Exclude<typeof listing, { error: string }>, points[userB], userB, 120).error, undefined);
        points[userA].pmcXP = PMC_LEVEL_THRESHOLDS[999];
        assert.ok(applyPmcMilestoneRewards(userA).claimed.includes(1000));
        points[userA].pmcXP = PMC_LEVEL_THRESHOLDS[PMC_LEVEL_CAP - 1] + 2000000;
        assert.equal(getPmcMasteryLevel(points[userA].pmcXP), 2);
        assert.equal(applyPmcMilestoneRewards(userA).masteryLevel, 2);
        assert.equal(discoverRareExtractionRoute({ mapKey: "plagued_cemetary", tension: "high", reputationLevel: 4, inventory: {}, random: () => 0 }), null);
        const discoveredRoute = discoverRareExtractionRoute({ mapKey: "plagued_cemetary", tension: "high", reputationLevel: 4, inventory: { boneway_key: 1 }, random: () => 0 });
        assert.equal(discoveredRoute?.key, "catacomb_smuggler");
        assert.equal(discoverRareExtractionRoute({ mapKey: "plagued_cemetary", tension: "high", reputationLevel: 4, inventory: { boneway_key: 1 }, random: () => 0.081 }), null);
        const safeBranch = getRaidBranchModifiers(discoveredRoute, "hidden_exit");
        const cacheBranch = getRaidBranchModifiers(discoveredRoute, "route_cache");
        assert.ok(safeBranch.successDelta > 0);
        assert.ok(cacheBranch.successDelta < 0);
        assert.equal(cacheBranch.bonusLootRolls, 2);
        assert.ok(getRaidBranchModifiers(null, "secure_perimeter").successDelta > 0);
        assert.equal(getRaidBranchModifiers(null, "push_objective").bonusLootRolls, 1);
        recordBossProgress(userA, "The Grave Warden", true);
        const firstKillIntelLevel = getBossProgressEntry(userA, "The Grave Warden").intelLevel;
        recordBossProgress(userA, "The Grave Warden", false);
        recordBossProgress(userA, "The Grave Warden", true);
        assert.equal(getBossProgressEntry(userA, "The Grave Warden").kills, 2);
        assert.equal(getBossProgressEntry(userA, "The Grave Warden").currentStreak, 1);
        assert.equal(firstKillIntelLevel, 0);
        for (let i = 0; i < 8; i++) recordBossProgress(userA, "The Grave Warden", true);
        const veteranBoss = getBossProgressEntry(userA, "The Grave Warden");
        assert.equal(veteranBoss.heartUpgradeLevel, 3);
        assert.equal(veteranBoss.alternateFormUnlocked, true);
        assert.ok(veteranBoss.bestStreak >= veteranBoss.currentStreak);
        assert.ok(RAID_MAP_EVENTS.length >= 6);
        assert.notEqual(rollRaidMapEvent("warlords_warcamp", 0, () => 0)?.key, "map_lockdown");
        const eventRolls = [0.11, 0];
        assert.equal(rollRaidMapEvent("warlords_warcamp", 3, () => eventRolls.shift() ?? 1)?.key, "faction_invasion");
        assert.equal(shouldTriggerRaidDecision("low", () => 0.21), true);
        assert.equal(shouldTriggerRaidDecision("low", () => 0.22), false);
        assert.equal(shouldTriggerRaidDecision("high", () => 0.39), true);
        const routePayload = JSON.parse(buildRareRouteDecisionPayload({ route: discoveredRoute!, mapLabel: "FN Plagued Cemetery", requiredItemName: "Boneway Key" }));
        assert.equal(routePayload.components[0].components.length, 3);
        assert.deepEqual(routePayload.components[0].components.map((component: { custom_id: string }) => component.custom_id), [RAID_ENCOUNTER_IDS.hiddenExit, RAID_ENCOUNTER_IDS.routeCache, RAID_ENCOUNTER_IDS.stayCourse]);
        const branchPayload = JSON.parse(buildRaidBranchDecisionPayload({ mapLabel: "FN Plagued Cemetery", tension: "high" }));
        assert.deepEqual(branchPayload.components[0].components.map((component: { custom_id: string }) => component.custom_id), [RAID_ENCOUNTER_IDS.securePerimeter, RAID_ENCOUNTER_IDS.pushObjective, RAID_ENCOUNTER_IDS.stayCourse]);
        const battleOpening = JSON.parse(buildBossBattlePayload({ bossName: "The Grave Warden", bossFerocity: 1.2, bossTraitLabels: ["Reactive Armor"], bossPhaseNames: ["Contact", "Enraged"], bossCurrentPhase: "Enraged", bossDefeated: true, bossKillChance: 60, bossHpMax: 800, bossHpFinal: 0, pmcLevel: 1200, pmcPrestige: 2, pmcHpMax: 600, pmcHpFinal: 240, weaponName: "Pulse Rifle", armorName: "Guardian Plate", turn: 0, totalTurns: 3 }));
        const battleFinal = JSON.parse(buildBossBattlePayload({ bossName: "The Grave Warden", bossFerocity: 1.2, bossTraitLabels: ["Reactive Armor"], bossPhaseNames: ["Contact", "Enraged"], bossCurrentPhase: "Enraged", bossDefeated: true, bossKillChance: 60, bossHpMax: 800, bossHpFinal: 0, pmcLevel: 1200, pmcPrestige: 2, pmcHpMax: 600, pmcHpFinal: 240, weaponName: "Pulse Rifle", armorName: "Guardian Plate", turn: 3, totalTurns: 3 }));
        assert.equal(battleOpening.components[0].components.length, 4);
        assert.ok(battleOpening.embed.fields[0].value.includes("800/800"));
        assert.ok(battleFinal.embed.fields[0].value.includes("0/800"));
        assert.ok(battleFinal.embed.fields[1].value.includes("240/600"));
        assert.ok(battleFinal.embed.fields[2].value.includes("neutralized"));

        delete (points[userA] as Partial<typeof points[string]>).mapReputation;
        assert.equal(getMapReputationEntry(userA, "plagued_cemetary").points, 0);
        const reputationRecord = recordMapReputation({
            userId: userA,
            mapKey: "plagued_cemetary",
            points: 35,
            success: true,
            bossSpawned: true,
            bossDefeated: true,
            timestamp: 12345
        });
        assert.equal(reputationRecord.beforePoints, 0);
        assert.deepEqual(reputationRecord.entry, { points: 35, raids: 1, extracts: 1, bossEncounters: 1, bossKills: 1, lastRaidAt: 12345 });

        assert.equal(getMapReputationProgress(0).tier.label, "Unproven");
        assert.equal(getMapReputationProgress(100).tier.label, "Pathfinder");
        assert.equal(getMapReputationProgress(300).tier.label, "Fixer");
        assert.equal(getMapReputationProgress(700).tier.label, "Vanguard");
        assert.equal(getMapReputationProgress(1400).tier.label, "Map Legend");
        assert.equal(getMapReputationProgress(1400).nextTier, null);
        assert.ok(MAP_REPUTATION_TIERS.every((tier, index) => index === 0 || tier.threshold > MAP_REPUTATION_TIERS[index - 1].threshold));
        assert.ok(calculateMapReputationGain({ mapDifficulty: "Cataclysmic", tension: "high", success: true, bossSpawned: true, bossDefeated: true })
            > calculateMapReputationGain({ mapDifficulty: "Beginner", tension: "low", success: false, bossSpawned: false, bossDefeated: false }));

        for (const boss of RAID_BOSS_ROSTER) {
            const profile = getBossCombatProfile(boss.name);
            assert.ok(profile.traits.length >= 1);
            assert.ok(profile.phases.length >= 2);
            assert.equal(profile.phases[0].thresholdPct, 100);
            assert.ok(profile.traits.every(key => Boolean(BOSS_TRAITS[key])));
        }
        const assaultCounter = getBossCombatModifiers("The Grave Warden", "assault");
        const reconMatch = getBossCombatModifiers("The Grave Warden", "recon");
        assert.ok(assaultCounter.counterBonus > reconMatch.counterBonus);
        assert.ok(assaultCounter.killPenalty > 0);
        assert.ok(assaultCounter.rewardMultiplier > 1 && assaultCounter.rewardMultiplier <= 1.65);

        const originalRandom = Math.random;
        Math.random = () => 0.5;
        try {
            const baseBossReward = rollBossSuccessRewards({ bet: 1000, tension: "medium", mapDifficulty: "Mid", bossFerocity: 1, bonusXpRange: [20, 20], tokenRewardRange: [20, 20] });
            const phaseBossReward = rollBossSuccessRewards({ bet: 1000, tension: "medium", mapDifficulty: "Mid", bossFerocity: 1, bonusXpRange: [20, 20], tokenRewardRange: [20, 20], combatRewardMultiplier: 1.5 });
            assert.ok(phaseBossReward.bossBonusXp > baseBossReward.bossBonusXp);
            assert.ok(phaseBossReward.bossTokenBonus > baseBossReward.bossTokenBonus);
        } finally {
            Math.random = originalRandom;
        }

        const premiumRaidPayload = JSON.parse(buildRaidResultPayload({
            result: {
                success: true,
                bossSpawned: true,
                bossDefeated: true,
                bossName: "The Grave Warden",
                bossTraitLabels: ["Reactive Armor"],
                bossCounteredTraits: ["Reactive Armor"],
                bossPhaseNames: ["Contact", "Enraged"],
                bossPhasesReached: 2,
                bossCurrentPhase: "Enraged",
                bossCombatRewardMultiplier: 1.14,
                mapReputationGain: 29,
                mapReputationPoints: 100,
                mapReputationTier: "Pathfinder",
                mapReputationTierUnlocked: "Pathfinder",
                pmcPrestige: 3,
                pmcPrestigeLabel: "Vanguard",
                extractionRouteLabel: "Catacomb Smuggler Exit",
                branchDecisionLabel: "Breach Catacomb Smuggler Exit Cache"
            },
            mapCfg: { label: "FN Plagued Cemetery", bossName: "The Grave Warden", lootTier: "Low to Mid" },
            fallbackTension: "medium",
            armyIconUrl: "https://example.com/army.png"
        }));
        assert.ok(premiumRaidPayload.embed.fields.some((field: { name: string }) => field.name === "Combat Sequence"));
        assert.ok(premiumRaidPayload.embed.fields.find((field: { name: string }) => field.name === "Summary")?.value.includes("Prestige 3"));
        assert.ok(premiumRaidPayload.embed.fields.find((field: { name: string }) => field.name === "Summary")?.value.includes("Catacomb Smuggler Exit"));
        assert.ok(premiumRaidPayload.components[0].components.some((component: { custom_id: string }) => component.custom_id === RAID_RESULT_ACTION_IDS.mastery));

        for (const mapCfg of Object.values(RAID_MAPS)) {
            const table = getBossRotationTable(mapCfg);
            const totalShare = table.reduce((sum, entry) => sum + entry.sharePct, 0);
            assert.ok(totalShare >= 99.5 && totalShare <= 100.5);

            for (const tension of ["low", "medium", "high"] as const) {
                const projection = mapProjection(mapCfg, tension);
                assert.ok(projection.successPct >= 6 && projection.successPct <= 93);
                assert.ok(projection.tokenMultiplier >= 0.7);
                assert.ok(projection.xpBand[0] >= 1);
                assert.ok(projection.xpBand[1] >= projection.xpBand[0]);
            }
        }
    } finally {
        restoreUserState(userA, snapshotA);
        restoreUserState(userB, snapshotB);
        if (typeof priorNoSaveFlag === "string") process.env.RUNTIME_TEST_NO_POINTS_SAVE = priorNoSaveFlag;
        else delete process.env.RUNTIME_TEST_NO_POINTS_SAVE;
    }
}

runEconomyAndRaidTests();
console.log("economy + raid tests passed");
