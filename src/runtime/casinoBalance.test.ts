import assert from "node:assert/strict";
import {
    BACCARAT_PAYOUTS,
    BLACKJACK_PAYOUTS,
    CASINO_BASE_RTP,
    CASINO_PROFILES,
    COINFLIP_PAYOUT,
    DICE_PAYOUTS,
    HILO_PAYOUTS,
    KENO_PAYOUTS,
    ROULETTE_PAYOUTS,
    resolveFairCrash,
    rollWinBonus,
    STANDARD_WIN_BONUS_CHANCE,
    STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER
} from "../game/casinoBalance";
import { claimCasinoDaily, ensureUser, getCasinoVipTier, points, recordGameResult } from "../utils";

function combination(n: number, k: number): number {
    let result = 1;
    for (let index = 1; index <= k; index++) result = result * (n - k + index) / index;
    return result;
}

function assertFairRtp(label: string, rtp: number, low = 0.93, high = 0.98): void {
    assert.equal(rtp >= low && rtp <= high, true, `${label} RTP ${rtp.toFixed(4)} outside ${low}-${high}`);
}

function runCasinoBalanceTests(): void {
    const priorNoSave = process.env.RUNTIME_TEST_NO_POINTS_SAVE;
    process.env.RUNTIME_TEST_NO_POINTS_SAVE = "1";
    const testUser = "__casino_progression_test__";
    const user = ensureUser(testUser);
    user.fnTokens = 10000;
    user.casinoXP = 0;
    user.casinoVipLevel = 0;
    user.casinoStreak = 0;
    user.casinoDailyClaimedAt = 0;
    user.casinoLossToday = 0;
    recordGameResult(testUser, "dice", "win", 1000, 1900);
    assert.equal(user.casinoStreak, 1);
    assert.ok(user.casinoXP >= 108);
    assert.equal(getCasinoVipTier(testUser).level, 0);
    const daily = claimCasinoDaily(testUser);
    assert.ok(daily.reward && daily.reward > 0);
    assert.ok(claimCasinoDaily(testUser).error);
    recordGameResult(testUser, "dice", "loss", 500, 0);
    assert.equal(user.casinoLossToday, 500);
    delete points[testUser];
    if (typeof priorNoSave === "string") process.env.RUNTIME_TEST_NO_POINTS_SAVE = priorNoSave;
    else delete process.env.RUNTIME_TEST_NO_POINTS_SAVE;

    assert.equal(Object.keys(CASINO_PROFILES).length, 9);
    assert.equal(STANDARD_WIN_BONUS_CHANCE, 0.06);
    assert.deepEqual(rollWinBonus(0.5), { multiplier: 1, label: "No bonus", triggered: false });
    assert.equal(rollWinBonus(0.05).multiplier, 1.1);
    assert.equal(rollWinBonus(0.01).multiplier, 1.25);
    assert.equal(rollWinBonus(0.001).multiplier, 1.75);
    assertFairRtp("Dice exact", DICE_PAYOUTS.exact / 6 * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("Dice band", DICE_PAYOUTS.band / 2 * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("Roulette straight", ROULETTE_PAYOUTS.straight / 37 * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("Roulette even money", 18 / 37 * ROULETTE_PAYOUTS.evenMoney * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("Coinflip", COINFLIP_PAYOUT / 2 * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("Blackjack safe", (0.416126 * BLACKJACK_PAYOUTS.safe * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER) + 0.093358);
    assertFairRtp("Blackjack aggressive", (0.399414 * BLACKJACK_PAYOUTS.aggressive * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER) + 0.088072);
    assertFairRtp("Baccarat player", 0.44872 * BACCARAT_PAYOUTS.player * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("Baccarat banker", 0.44872 * BACCARAT_PAYOUTS.banker * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("Baccarat tie", 0.10255 * BACCARAT_PAYOUTS.tie * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);

    let hiloRtp = 13 / 169;
    for (let first = 1; first <= 13; first++) {
        for (let second = 1; second <= 13; second++) {
            if (first === second) continue;
            const distance = Math.abs(second - first);
            const payout = distance >= 8 ? HILO_PAYOUTS.extreme : distance >= 5 ? HILO_PAYOUTS.strong : HILO_PAYOUTS.standard;
            hiloRtp += 0.5 * payout * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER / 169;
        }
    }
    assertFairRtp("High-Low", hiloRtp);
    assertFairRtp("Crash", CASINO_BASE_RTP * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER, 0.949, 0.951);

    const winRolls = [0.1, 0.5];
    const win = resolveFairCrash(100, 2, () => winRolls.shift() ?? 0);
    assert.equal(win.win, true);
    assert.equal(win.payout, 200);
    assert.equal(Number(win.crashPoint) >= 2, true);

    const lossRolls = [0.9, 0.5];
    const loss = resolveFairCrash(100, 2, () => lossRolls.shift() ?? 0);
    assert.equal(loss.win, false);
    assert.equal(loss.payout, 0);
    assert.equal(Number(loss.crashPoint) < 2, true);

    for (let spots = 2; spots <= 10; spots++) {
        assert.equal(KENO_PAYOUTS[spots].length, spots + 1);
        assert.equal(KENO_PAYOUTS[spots].every(value => value >= 0), true);
        let kenoRtp = 0;
        for (let hits = 0; hits <= spots; hits++) {
            const probability = combination(spots, hits) * combination(40 - spots, 10 - hits) / combination(40, 10);
            kenoRtp += probability * KENO_PAYOUTS[spots][hits] * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER;
        }
        assertFairRtp(`Keno ${spots}-spot`, kenoRtp);
    }
}

runCasinoBalanceTests();
console.log("casino balance tests passed");