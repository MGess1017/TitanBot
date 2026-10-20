import assert from "node:assert/strict";
import {
    BACCARAT_PAYOUTS,
    BLACKJACK_PAYOUTS,
    AMERICAN_ROULETTE_WHEEL,
    CASINO_BASE_RTP,
    CASINO_PROFILES,
    COINFLIP_PAYOUT,
    DICE_PAYOUTS,
    buildAmericanRouletteSnapshot,
    dealBaccaratRound,
    getAmericanRouletteColor,
    getAmericanRoulettePayout,
    rollAmericanRoulettePocket,
    HILO_PAYOUTS,
    KENO_PAYOUTS,
    ROULETTE_PAYOUTS,
    resolveFairCrash,
    rollWinBonus,
    settleBaccaratBet,
    STANDARD_WIN_BONUS_CHANCE,
    STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER,
    buildCasinoBoardSnapshot
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
    assert.equal(AMERICAN_ROULETTE_WHEEL.length, 38);
    assert.equal(rollAmericanRoulettePocket(() => 0), "0");
    assert.equal(rollAmericanRoulettePocket(() => 0.5), "00");
    assert.equal(rollAmericanRoulettePocket(() => 1), "2");
    assert.equal(AMERICAN_ROULETTE_WHEEL.filter(pocket => getAmericanRouletteColor(pocket) === "red").length, 18);
    assert.equal(AMERICAN_ROULETTE_WHEEL.filter(pocket => getAmericanRouletteColor(pocket) === "black").length, 18);
    assert.equal(AMERICAN_ROULETTE_WHEEL.filter(pocket => getAmericanRouletteColor(pocket) === "green").length, 2);
    assertFairRtp("American roulette straight", ROULETTE_PAYOUTS.straight / 38 * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("American roulette even money", 18 / 38 * ROULETTE_PAYOUTS.evenMoney * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("American roulette green", 2 / 38 * ROULETTE_PAYOUTS.green * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assert.equal(getAmericanRoulettePayout("red", "1"), ROULETTE_PAYOUTS.evenMoney);
    assert.equal(getAmericanRoulettePayout("red", "2"), 0);
    assert.equal(getAmericanRoulettePayout("odd", "0"), 0);
    assert.equal(getAmericanRoulettePayout("green", "00"), ROULETTE_PAYOUTS.green);
    assert.equal(getAmericanRoulettePayout("00", "00"), ROULETTE_PAYOUTS.straight);
    assert.match(buildAmericanRouletteSnapshot("00", "00"), /\[00\]/);
    assert.match(buildCasinoBoardSnapshot("dice", [{ label: "Your Call", value: "high" }, { label: "Roll", value: "6" }]) || "", /\[ 6 \]/);
    assert.match(buildCasinoBoardSnapshot("blackjack", [{ label: "Player", value: "A 10 (21)" }, { label: "Dealer", value: "9 7 (16)" }]) || "", /PLAYER  A 10/);
    assert.match(buildCasinoBoardSnapshot("baccarat", [{ label: "Player Hand", value: "2+7 => 9" }, { label: "Banker Hand", value: "5+3 => 8" }, { label: "Outcome", value: "player" }]) || "", /RESULT  PLAYER/);
    assert.match(buildCasinoBoardSnapshot("coinflip", [{ label: "Your Pick", value: "heads" }, { label: "Landed", value: "tails" }]) || "", /HEADS  vs  TAILS/);
    assert.match(buildCasinoBoardSnapshot("hilo", [{ label: "Your Call", value: "higher" }, { label: "First Card", value: "7" }, { label: "Second Card", value: "K" }]) || "", /7  →  K/);
    assert.match(buildCasinoBoardSnapshot("crash", [{ label: "Target", value: "2.00x" }, { label: "Crash Point", value: "1.86x" }]) || "", /POINT  1.86x/);
    assert.ok((buildCasinoBoardSnapshot("roulette", [{ label: "Your Call", value: "red" }, { label: "Landed", value: "18 (red)" }]) || "").length <= 850);
    const kenoBoard = buildCasinoBoardSnapshot("keno", [{ label: "Your Picks (3)", value: "1, 8, 11" }, { label: "Drawn Numbers", value: "1, 2, 3, 4, 5, 6, 7, 8, 9, 10" }]) || "";
    assert.equal(kenoBoard.split("\n").length, 9);
    assert.match(kenoBoard, /✓01/);
    assert.match(kenoBoard, /✓08/);
    assert.ok(kenoBoard.length <= 850, "casino board snapshots must remain compact embed fields");
    assertFairRtp("Coinflip", COINFLIP_PAYOUT / 2 * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER);
    assertFairRtp("Blackjack safe", (0.416126 * BLACKJACK_PAYOUTS.safe * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER) + 0.093358);
    assertFairRtp("Blackjack aggressive", (0.399414 * BLACKJACK_PAYOUTS.aggressive * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER) + 0.088072);
    let baccaratSeed = 81337;
    const baccaratRandom = () => ((baccaratSeed = (baccaratSeed * 48271) % 2147483647) / 2147483647);
    const baccaratCounts = { player: 0, banker: 0, tie: 0 };
    const baccaratTrials = 120_000;
    for (let trial = 0; trial < baccaratTrials; trial++) {
        const round = dealBaccaratRound(baccaratRandom);
        assert.ok(round.playerCards.length >= 2 && round.playerCards.length <= 3);
        assert.ok(round.bankerCards.length >= 2 && round.bankerCards.length <= 3);
        baccaratCounts[round.outcome] += 1;
    }
    const playerProbability = baccaratCounts.player / baccaratTrials;
    const bankerProbability = baccaratCounts.banker / baccaratTrials;
    const tieProbability = baccaratCounts.tie / baccaratTrials;
    assert.ok(Math.abs(playerProbability - 0.446) < 0.005, `unexpected baccarat player probability ${playerProbability}`);
    assert.ok(Math.abs(bankerProbability - 0.459) < 0.005, `unexpected baccarat banker probability ${bankerProbability}`);
    assert.ok(Math.abs(tieProbability - 0.095) < 0.005, `unexpected baccarat tie probability ${tieProbability}`);
    assertFairRtp("Baccarat player", playerProbability * BACCARAT_PAYOUTS.player * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER + tieProbability, 0.985, 1.005);
    assertFairRtp("Baccarat banker", bankerProbability * BACCARAT_PAYOUTS.banker * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER + tieProbability, 0.985, 1.005);
    assertFairRtp("Baccarat tie", tieProbability * BACCARAT_PAYOUTS.tie * STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER, 0.83, 0.89);
    const naturalSamples = [7 / 13, 0, 4 / 13, 1 / 13];
    const naturalRound = dealBaccaratRound(() => naturalSamples.shift() ?? 0);
    assert.equal(naturalRound.playerTotal, 9);
    assert.equal(naturalRound.playerCards.length, 2, "a natural 8 or 9 must stop baccarat draws");
    assert.equal(naturalRound.bankerCards.length, 2);
    const thirdCardSamples = [1 / 13, 2 / 13, 1 / 13, 1 / 13, 2 / 13, 1 / 13];
    const thirdCardRound = dealBaccaratRound(() => thirdCardSamples.shift() ?? 0);
    assert.equal(thirdCardRound.playerCards.length, 3);
    assert.equal(thirdCardRound.bankerCards.length, 3, "banker third-card rule must be applied after a player draw");
    assert.deepEqual(settleBaccaratBet("player", "tie", 100), { outcome: "push", payout: 100 });
    assert.deepEqual(settleBaccaratBet("banker", "tie", 100), { outcome: "push", payout: 100 });
    assert.deepEqual(settleBaccaratBet("player", "banker", 100), { outcome: "loss", payout: 0 });
    assert.deepEqual(settleBaccaratBet("banker", "banker", 100), { outcome: "win", payout: 195 });
    assert.deepEqual(settleBaccaratBet("tie", "tie", 100), { outcome: "win", payout: 900 });

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