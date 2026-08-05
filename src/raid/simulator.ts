import {
    getBossRotationTable,
    mapProjection,
    RAID_CONDITIONS,
    RAID_MAPS,
    rollBossSuccessRewards,
    rollRaidXpGain,
    type RaidMapConfig
} from "./domain";

type Tension = "low" | "medium" | "high";

function parseArg(name: string, fallback: number): number {
    const raw = process.argv.find(arg => arg.startsWith(`--${name}=`));
    if (!raw) return fallback;
    const value = Number.parseInt(raw.split("=")[1] || "", 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function simulateMap(mapCfg: RaidMapConfig, tension: Tension, iterations: number, bet: number) {
    const projection = mapProjection(mapCfg, tension);
    const successProb = projection.successPct / 100;
    const bossRotation = getBossRotationTable(mapCfg);
    let successes = 0;
    let bossSpawns = 0;
    let bossKills = 0;
    let totalRaidXp = 0;
    let totalBossXp = 0;
    let totalTokens = 0;

    const table = {
        low: { successChance: 0.8, tokenMultiplier: 1.15 },
        medium: { successChance: 0.56, tokenMultiplier: 1.6 },
        high: { successChance: 0.33, tokenMultiplier: 2.38 }
    } as const;

    for (let i = 0; i < iterations; i++) {
        const condition = RAID_CONDITIONS[Math.floor(Math.random() * RAID_CONDITIONS.length)];
        const conditionAwareSuccess = Math.max(0.06, Math.min(0.93, table[tension].successChance + mapCfg.successDelta + condition.successDelta - ((mapCfg.bossSpawnChance * mapCfg.bossSuccessPenalty) * 0.75)));
        const success = Math.random() < conditionAwareSuccess;
        if (success) successes += 1;

        const bossSpawned = Math.random() < mapCfg.bossSpawnChance;
        if (bossSpawned) bossSpawns += 1;

        let bossBonusXp = 0;
        let bossTokenBonus = 0;
        if (bossSpawned && success) {
            const boss = bossRotation[Math.floor(Math.random() * bossRotation.length)].boss;
            const bossKillChance = Math.max(0.1, Math.min(0.9, 0.42 + (tension === "high" ? 0.08 : tension === "low" ? -0.03 : 0) - mapCfg.bossKillPenalty - (boss.killPenalty * 0.7)));
            const bossDefeated = Math.random() < bossKillChance;
            if (bossDefeated) {
                bossKills += 1;
                const bossRewards = rollBossSuccessRewards({
                    bet,
                    tension,
                    mapDifficulty: mapCfg.difficulty,
                    bossFerocity: boss.ferocity,
                    bonusXpRange: boss.bonusXpRange,
                    tokenRewardRange: boss.tokenRewardRange
                });
                bossBonusXp = bossRewards.bossBonusXp;
                bossTokenBonus = bossRewards.bossTokenBonus;
            }
        }

        const raidXp = rollRaidXpGain(tension, success, bet, condition.xpMultiplier, mapCfg);
        const tokenBase = success
            ? Math.max(1, Math.floor(bet * (table[tension].tokenMultiplier + mapCfg.tokenMultiplierDelta + condition.tokenMultiplierDelta)))
            : 0;

        totalRaidXp += raidXp + bossBonusXp;
        totalBossXp += bossBonusXp;
        totalTokens += tokenBase + bossTokenBonus;
    }

    return {
        successRate: ((successes / iterations) * 100).toFixed(1),
        bossSpawnRate: ((bossSpawns / iterations) * 100).toFixed(1),
        bossKillRate: bossSpawns > 0 ? ((bossKills / bossSpawns) * 100).toFixed(1) : "0.0",
        avgRaidXp: (totalRaidXp / iterations).toFixed(1),
        avgBossXp: (totalBossXp / iterations).toFixed(1),
        avgTokens: (totalTokens / iterations).toFixed(1),
        projection
    };
}

function main() {
    const iterations = parseArg("iterations", 2500);
    const bet = parseArg("bet", 100);
    const tensions: Tension[] = ["low", "medium", "high"];

    console.log(`Titan Raid Balance Simulator | iterations=${iterations} | bet=${bet}`);
    for (const mapCfg of Object.values(RAID_MAPS)) {
        console.log(`\n=== ${mapCfg.label} (${mapCfg.difficulty}) ===`);
        for (const tension of tensions) {
            const result = simulateMap(mapCfg, tension, iterations, bet);
            console.log([
                `${tension.toUpperCase()} | sim success ${result.successRate}% | projected success ${result.projection.successPct}%`,
                `boss spawn ${result.bossSpawnRate}% | boss kill ${result.bossKillRate}%`,
                `avg raid xp ${result.avgRaidXp} | avg boss xp ${result.avgBossXp} | avg tokens ${result.avgTokens}`
            ].join(" | "));
        }
    }
}

main();
