// Coinflip, baccarat, hi-lo, keno, crash, and casino quick actions.
import { addTokens, getTokens, removeTokens, recordGameResult } from "../../utils";
import {
    BACCARAT_PAYOUTS, COINFLIP_PAYOUT, dealBaccaratRound, settleBaccaratBet, HILO_PAYOUTS, KENO_PAYOUTS,
    rollWinBonus
} from "../../game/casinoBalance";
import { type CasinoActionKind, type CasinoGameKey } from "../ui/ids";
import {
    type CasinoOutcome, defaultCasinoArgForGame, formatCasinoResult, formatTokenAmount, getNextCasinoGame,
    sanitizeCasinoActionArg, validateCasinoBet
} from "./ui";
import { playBlackjack, playDice, playRoulette } from "./tableGames";
import { buildCrashMeter, playSlots } from "./slots";

export function playCoinflip(userId: string, bet: number, side: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const pick = side.toLowerCase();
    if (!["heads", "tails"].includes(pick)) return "Choose a valid side: heads or tails.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const landed = Math.random() < 0.5 ? "heads" : "tails";
    if (pick !== landed) {
        recordGameResult(userId, "coinflip", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "coinflip",
            gameIcon: "🪙",
            gameName: "Coinflip",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Pick", value: pick },
                { label: "Landed", value: landed }
            ],
            actionMeta: { bet, arg: pick }
        });
    }

    const lucky = rollWinBonus();
    const payout = Math.max(1, Math.floor(bet * COINFLIP_PAYOUT * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "coinflip", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "coinflip",
        gameIcon: "🪙",
        gameName: "Coinflip",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Pick", value: pick },
            { label: "Landed", value: landed },
            { label: "Base Multiplier", value: `${COINFLIP_PAYOUT.toFixed(2)}x` }
        ],
        actionMeta: { bet, arg: pick }
    });
}

export function playBaccarat(userId: string, bet: number, side: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const pick = side.toLowerCase();
    if (!["player", "banker", "tie"].includes(pick)) return "Choose a valid side: player, banker, or tie.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);

    const round = dealBaccaratRound();
    const outcome = round.outcome;
    const playerHand = `${round.playerCards.join("+")} => ${round.playerTotal}`;
    const bankerHand = `${round.bankerCards.join("+")} => ${round.bankerTotal}`;
    const lucky = outcome === pick ? rollWinBonus() : { multiplier: 1, label: "No bonus", triggered: false };
    const settlement = settleBaccaratBet(pick as keyof typeof BACCARAT_PAYOUTS, outcome, bet, lucky.multiplier);

    if (settlement.outcome === "push") {
        addTokens(userId, bet);
        recordGameResult(userId, "baccarat", "push", bet, bet);
        return formatCasinoResult({
            userId,
            gameKey: "baccarat",
            gameIcon: "🂡",
            gameName: "Baccarat",
            outcome: "push",
            bet,
            payout: bet,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Pick", value: pick },
                { label: "Player Hand", value: playerHand },
                { label: "Banker Hand", value: bankerHand },
                { label: "Outcome", value: "tie" }
            ],
            notes: ["Player and Banker bets push on a tie; the stake is returned."],
            actionMeta: { bet, arg: pick }
        });
    }

    if (settlement.outcome === "loss") {
        recordGameResult(userId, "baccarat", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "baccarat",
            gameIcon: "🂡",
            gameName: "Baccarat",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Pick", value: pick },
                { label: "Player Hand", value: playerHand },
                { label: "Banker Hand", value: bankerHand },
                { label: "Outcome", value: outcome }
            ],
            actionMeta: { bet, arg: pick }
        });
    }

    const base = BACCARAT_PAYOUTS[pick as keyof typeof BACCARAT_PAYOUTS];
    const payout = settlement.payout;
    addTokens(userId, payout);
    recordGameResult(userId, "baccarat", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "baccarat",
        gameIcon: "🂡",
        gameName: "Baccarat",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Pick", value: pick },
            { label: "Player Hand", value: playerHand },
            { label: "Banker Hand", value: bankerHand },
            { label: "Outcome", value: outcome },
            { label: "Gross Return", value: `${base.toFixed(2)}x${pick === "banker" ? " (includes 5% commission)" : ""}` }
        ],
        actionMeta: { bet, arg: pick }
    });
}

export function playHiLo(userId: string, bet: number, call: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const pick = call.toLowerCase();
    if (!["higher", "lower"].includes(pick)) return "Call must be higher or lower.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);

    const first = Math.floor(Math.random() * 13) + 1;
    const second = Math.floor(Math.random() * 13) + 1;
    const firstFace = first === 1 ? "A" : first === 11 ? "J" : first === 12 ? "Q" : first === 13 ? "K" : String(first);
    const secondFace = second === 1 ? "A" : second === 11 ? "J" : second === 12 ? "Q" : second === 13 ? "K" : String(second);

    if (first === second) {
        addTokens(userId, bet);
        recordGameResult(userId, "hilo", "push", bet, bet);
        return formatCasinoResult({
            userId,
            gameKey: "hilo",
            gameIcon: "🃏",
            gameName: "High-Low",
            outcome: "push",
            bet,
            payout: bet,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Call", value: pick },
                { label: "First Card", value: firstFace },
                { label: "Second Card", value: secondFace }
            ],
            notes: ["Tie card refunded your stake."],
            actionMeta: { bet, arg: pick }
        });
    }

    const outcome = second > first ? "higher" : "lower";
    if (pick !== outcome) {
        recordGameResult(userId, "hilo", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "hilo",
            gameIcon: "🃏",
            gameName: "High-Low",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Call", value: pick },
                { label: "First Card", value: firstFace },
                { label: "Second Card", value: secondFace },
                { label: "Outcome", value: outcome }
            ],
            actionMeta: { bet, arg: pick }
        });
    }

    const distance = Math.abs(second - first);
    const base = distance >= 8 ? HILO_PAYOUTS.extreme : distance >= 5 ? HILO_PAYOUTS.strong : HILO_PAYOUTS.standard;
    const lucky = rollWinBonus();
    const payout = Math.max(1, Math.floor(bet * base * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "hilo", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "hilo",
        gameIcon: "🃏",
        gameName: "High-Low",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Call", value: pick },
            { label: "First Card", value: firstFace },
            { label: "Second Card", value: secondFace },
            { label: "Distance Bonus Tier", value: distance >= 8 ? "Extreme" : distance >= 5 ? "Strong" : "Standard" },
            { label: "Base Multiplier", value: `${base.toFixed(2)}x` }
        ],
        actionMeta: { bet, arg: pick }
    });
}

export function playKeno(userId: string, bet: number, picksRaw: string): string {
    const numericTokens = (picksRaw.match(/\d+/g) || [])
        .map(part => Number.parseInt(part, 10))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 40);
    const picks = Array.from(new Set(numericTokens));
    if (picks.length < 2 || picks.length > 10) {
        return "Keno picks must contain 2 to 10 unique numbers from 1 to 40. Accepted formats: 3,8,11,24 or 3 8 11 24.";
    }

    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);

    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const draw: number[] = [];
    for (let i = 0; i < 10; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        draw.push(pool[idx]);
        pool.splice(idx, 1);
    }

    const hits = picks.filter(n => draw.includes(n));
    const hitCount = hits.length;
    const spots = picks.length;
    const baseMultiplier = KENO_PAYOUTS[spots]?.[hitCount] || 0;
    const picksText = picks.sort((a, b) => a - b).join(", ");
    const drawText = draw.sort((a, b) => a - b).join(", ");
    const hitsText = hits.sort((a, b) => a - b).join(", ") || "none";

    if (baseMultiplier <= 0) {
        recordGameResult(userId, "keno", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "keno",
            gameIcon: "🎟️",
            gameName: "Keno",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: `Your Picks (${spots})`, value: picksText },
                { label: "Drawn Numbers", value: drawText },
                { label: "Hits", value: `${hitCount} (${hitsText})` }
            ],
            notes: ["Fewer picks generally improve consistency; more picks chase bigger ladders."],
            actionMeta: { bet, arg: picks.sort((a, b) => a - b).join(",") }
        });
    }

    const lucky = rollWinBonus();
    const payout = Math.max(1, Math.floor(bet * baseMultiplier * lucky.multiplier));
    addTokens(userId, payout);
    const resultOutcome: CasinoOutcome = payout > bet ? "win" : payout === bet ? "push" : "loss";
    recordGameResult(userId, "keno", resultOutcome, bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "keno",
        gameIcon: "🎟️",
        gameName: "Keno",
        outcome: resultOutcome,
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: `Your Picks (${spots})`, value: picksText },
            { label: "Drawn Numbers", value: drawText },
            { label: "Hits", value: `${hitCount} (${hitsText})` },
            { label: "Base Multiplier", value: `${baseMultiplier.toFixed(2)}x` }
        ],
        actionMeta: { bet, arg: picks.sort((a, b) => a - b).join(",") }
    });
}

export async function playCrash(userId: string, bet: number, target: number): Promise<string> {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;
    if (!target || target < 1.05 || target > 10) return "Target multiplier must be between 1.05 and 10.0.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const result = (await import("../../game/economy")).resolveCrash(bet, target);
    if (result.win) {
        const lucky = rollWinBonus();
        const payout = Math.max(1, Math.floor(result.payout * lucky.multiplier));
        addTokens(userId, payout);
        recordGameResult(userId, "crash", "win", bet, payout);
        return formatCasinoResult({
            userId,
            gameKey: "crash",
            gameIcon: "📈",
            gameName: "Crash",
            outcome: "win",
            bet,
            payout,
            walletBefore,
            walletAfter: getTokens(userId),
            luckyLabel: lucky.label,
            details: [
                { label: "Target", value: `${target.toFixed(2)}x` },
                { label: "Crash Point", value: `${result.crashPoint}x` },
                { label: "Base Payout", value: formatTokenAmount(result.payout) }
            ],
            sections: [
                { title: "Crash Meter", value: buildCrashMeter(target, Number(result.crashPoint)) }
            ],
            actionMeta: { bet, arg: target.toFixed(2) }
        });
    }

    recordGameResult(userId, "crash", "loss", bet, 0);
    return formatCasinoResult({
        userId,
        gameKey: "crash",
        gameIcon: "📈",
        gameName: "Crash",
        outcome: "loss",
        bet,
        payout: 0,
        walletBefore,
        walletAfter: getTokens(userId),
        details: [
            { label: "Target", value: `${target.toFixed(2)}x` },
            { label: "Crash Point", value: `${result.crashPoint}x` }
        ],
        sections: [
            { title: "Crash Meter", value: buildCrashMeter(target, Number(result.crashPoint)) }
        ],
        actionMeta: { bet, arg: target.toFixed(2) }
    });
}

export async function runCasinoQuickAction(input: {
    userId: string;
    action: CasinoActionKind;
    gameKey: CasinoGameKey;
    bet: number;
    arg: string;
}): Promise<{ gameKey: CasinoGameKey; payload: string }> {
    const resolvedGame = input.action === "switch" ? getNextCasinoGame(input.gameKey) : input.gameKey;
    const sourceBet = Math.max(1, Math.floor(input.bet));
    const effectiveBet = input.action === "double"
        ? sourceBet * 2
        : input.action === "half"
            ? Math.max(1, Math.floor(sourceBet / 2))
            : sourceBet;
    const arg = sanitizeCasinoActionArg(input.action === "switch" ? defaultCasinoArgForGame(resolvedGame) : (input.arg || defaultCasinoArgForGame(resolvedGame)));

    if (resolvedGame === "dice") return { gameKey: resolvedGame, payload: playDice(input.userId, effectiveBet, arg || "low") };
    if (resolvedGame === "roulette") return { gameKey: resolvedGame, payload: playRoulette(input.userId, effectiveBet, arg || "red") };
    if (resolvedGame === "blackjack") return { gameKey: resolvedGame, payload: playBlackjack(input.userId, effectiveBet, arg || "safe") };
    if (resolvedGame === "crash") {
        const target = Number.parseFloat(arg || "1.50");
        return { gameKey: resolvedGame, payload: await playCrash(input.userId, effectiveBet, Number.isFinite(target) ? target : 1.5) };
    }
    if (resolvedGame === "magicslots") {
        return { gameKey: resolvedGame, payload: playSlots(input.userId, effectiveBet) };
    }
    if (resolvedGame === "coinflip") return { gameKey: resolvedGame, payload: playCoinflip(input.userId, effectiveBet, arg || "heads") };
    if (resolvedGame === "baccarat") return { gameKey: resolvedGame, payload: playBaccarat(input.userId, effectiveBet, arg || "player") };
    if (resolvedGame === "hilo") return { gameKey: resolvedGame, payload: playHiLo(input.userId, effectiveBet, arg || "higher") };
    return { gameKey: "keno", payload: playKeno(input.userId, effectiveBet, arg || "3,8,11,24") };
}
