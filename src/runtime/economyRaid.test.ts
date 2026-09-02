import assert from "node:assert/strict";
import {
    addTokens,
    depositToBank,
    ensureUser,
    getBankTokens,
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
    recordMapReputation,
    transferWalletTokens,
    withdrawFromBank
} from "../utils";
import { getRaidRewards } from "../game/raid";
import { buildRaidResultPayload, RAID_RESULT_ACTION_IDS } from "../game/payloads";
import {
    BOSS_TRAITS,
    MAP_REPUTATION_TIERS,
    RAID_APPROACHES,
    RAID_BOSS_ROSTER,
    RAID_MAPS,
    calculateMapReputationGain,
    getBossCombatModifiers,
    getBossCombatProfile,
    getBossRotationTable,
    getMapReputationProgress,
    mapProjection,
    resolveRaidApproach,
    rollBossSuccessRewards
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
                pmcPrestigeLabel: "Vanguard"
            },
            mapCfg: { label: "FN Plagued Cemetery", bossName: "The Grave Warden", lootTier: "Low to Mid" },
            fallbackTension: "medium",
            armyIconUrl: "https://example.com/army.png"
        }));
        assert.ok(premiumRaidPayload.embed.fields.some((field: { name: string }) => field.name === "Combat Sequence"));
        assert.ok(premiumRaidPayload.embed.fields.find((field: { name: string }) => field.name === "Summary")?.value.includes("Prestige 3"));
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
