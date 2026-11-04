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
exports.playCoinflip = playCoinflip;
exports.playBaccarat = playBaccarat;
exports.playHiLo = playHiLo;
exports.playKeno = playKeno;
exports.playCrash = playCrash;
exports.runCasinoQuickAction = runCasinoQuickAction;
// Coinflip, baccarat, hi-lo, keno, crash, and casino quick actions.
const utils_1 = require("../../utils");
const casinoBalance_1 = require("../../game/casinoBalance");
const ui_1 = require("./ui");
const tableGames_1 = require("./tableGames");
const slots_1 = require("./slots");
function playCoinflip(userId, bet, side) {
    const betError = (0, ui_1.validateCasinoBet)(userId, bet);
    if (betError)
        return betError;
    const pick = side.toLowerCase();
    if (!["heads", "tails"].includes(pick))
        return "Choose a valid side: heads or tails.";
    const walletBefore = (0, utils_1.getTokens)(userId);
    (0, utils_1.removeTokens)(userId, bet);
    const landed = Math.random() < 0.5 ? "heads" : "tails";
    if (pick !== landed) {
        (0, utils_1.recordGameResult)(userId, "coinflip", "loss", bet, 0);
        return (0, ui_1.formatCasinoResult)({
            userId,
            gameKey: "coinflip",
            gameIcon: "🪙",
            gameName: "Coinflip",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: (0, utils_1.getTokens)(userId),
            details: [
                { label: "Your Pick", value: pick },
                { label: "Landed", value: landed }
            ],
            actionMeta: { bet, arg: pick }
        });
    }
    const lucky = (0, casinoBalance_1.rollWinBonus)();
    const payout = Math.max(1, Math.floor(bet * casinoBalance_1.COINFLIP_PAYOUT * lucky.multiplier));
    (0, utils_1.addTokens)(userId, payout);
    (0, utils_1.recordGameResult)(userId, "coinflip", "win", bet, payout);
    return (0, ui_1.formatCasinoResult)({
        userId,
        gameKey: "coinflip",
        gameIcon: "🪙",
        gameName: "Coinflip",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: (0, utils_1.getTokens)(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Pick", value: pick },
            { label: "Landed", value: landed },
            { label: "Base Multiplier", value: `${casinoBalance_1.COINFLIP_PAYOUT.toFixed(2)}x` }
        ],
        actionMeta: { bet, arg: pick }
    });
}
function playBaccarat(userId, bet, side) {
    const betError = (0, ui_1.validateCasinoBet)(userId, bet);
    if (betError)
        return betError;
    const pick = side.toLowerCase();
    if (!["player", "banker", "tie"].includes(pick))
        return "Choose a valid side: player, banker, or tie.";
    const walletBefore = (0, utils_1.getTokens)(userId);
    (0, utils_1.removeTokens)(userId, bet);
    const round = (0, casinoBalance_1.dealBaccaratRound)();
    const outcome = round.outcome;
    const playerHand = `${round.playerCards.join("+")} => ${round.playerTotal}`;
    const bankerHand = `${round.bankerCards.join("+")} => ${round.bankerTotal}`;
    const lucky = outcome === pick ? (0, casinoBalance_1.rollWinBonus)() : { multiplier: 1, label: "No bonus", triggered: false };
    const settlement = (0, casinoBalance_1.settleBaccaratBet)(pick, outcome, bet, lucky.multiplier);
    if (settlement.outcome === "push") {
        (0, utils_1.addTokens)(userId, bet);
        (0, utils_1.recordGameResult)(userId, "baccarat", "push", bet, bet);
        return (0, ui_1.formatCasinoResult)({
            userId,
            gameKey: "baccarat",
            gameIcon: "🂡",
            gameName: "Baccarat",
            outcome: "push",
            bet,
            payout: bet,
            walletBefore,
            walletAfter: (0, utils_1.getTokens)(userId),
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
        (0, utils_1.recordGameResult)(userId, "baccarat", "loss", bet, 0);
        return (0, ui_1.formatCasinoResult)({
            userId,
            gameKey: "baccarat",
            gameIcon: "🂡",
            gameName: "Baccarat",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: (0, utils_1.getTokens)(userId),
            details: [
                { label: "Your Pick", value: pick },
                { label: "Player Hand", value: playerHand },
                { label: "Banker Hand", value: bankerHand },
                { label: "Outcome", value: outcome }
            ],
            actionMeta: { bet, arg: pick }
        });
    }
    const base = casinoBalance_1.BACCARAT_PAYOUTS[pick];
    const payout = settlement.payout;
    (0, utils_1.addTokens)(userId, payout);
    (0, utils_1.recordGameResult)(userId, "baccarat", "win", bet, payout);
    return (0, ui_1.formatCasinoResult)({
        userId,
        gameKey: "baccarat",
        gameIcon: "🂡",
        gameName: "Baccarat",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: (0, utils_1.getTokens)(userId),
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
function playHiLo(userId, bet, call) {
    const betError = (0, ui_1.validateCasinoBet)(userId, bet);
    if (betError)
        return betError;
    const pick = call.toLowerCase();
    if (!["higher", "lower"].includes(pick))
        return "Call must be higher or lower.";
    const walletBefore = (0, utils_1.getTokens)(userId);
    (0, utils_1.removeTokens)(userId, bet);
    const first = Math.floor(Math.random() * 13) + 1;
    const second = Math.floor(Math.random() * 13) + 1;
    const firstFace = first === 1 ? "A" : first === 11 ? "J" : first === 12 ? "Q" : first === 13 ? "K" : String(first);
    const secondFace = second === 1 ? "A" : second === 11 ? "J" : second === 12 ? "Q" : second === 13 ? "K" : String(second);
    if (first === second) {
        (0, utils_1.addTokens)(userId, bet);
        (0, utils_1.recordGameResult)(userId, "hilo", "push", bet, bet);
        return (0, ui_1.formatCasinoResult)({
            userId,
            gameKey: "hilo",
            gameIcon: "🃏",
            gameName: "High-Low",
            outcome: "push",
            bet,
            payout: bet,
            walletBefore,
            walletAfter: (0, utils_1.getTokens)(userId),
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
        (0, utils_1.recordGameResult)(userId, "hilo", "loss", bet, 0);
        return (0, ui_1.formatCasinoResult)({
            userId,
            gameKey: "hilo",
            gameIcon: "🃏",
            gameName: "High-Low",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: (0, utils_1.getTokens)(userId),
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
    const base = distance >= 8 ? casinoBalance_1.HILO_PAYOUTS.extreme : distance >= 5 ? casinoBalance_1.HILO_PAYOUTS.strong : casinoBalance_1.HILO_PAYOUTS.standard;
    const lucky = (0, casinoBalance_1.rollWinBonus)();
    const payout = Math.max(1, Math.floor(bet * base * lucky.multiplier));
    (0, utils_1.addTokens)(userId, payout);
    (0, utils_1.recordGameResult)(userId, "hilo", "win", bet, payout);
    return (0, ui_1.formatCasinoResult)({
        userId,
        gameKey: "hilo",
        gameIcon: "🃏",
        gameName: "High-Low",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: (0, utils_1.getTokens)(userId),
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
function playKeno(userId, bet, picksRaw) {
    const numericTokens = (picksRaw.match(/\d+/g) || [])
        .map(part => Number.parseInt(part, 10))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 40);
    const picks = Array.from(new Set(numericTokens));
    if (picks.length < 2 || picks.length > 10) {
        return "Keno picks must contain 2 to 10 unique numbers from 1 to 40. Accepted formats: 3,8,11,24 or 3 8 11 24.";
    }
    const betError = (0, ui_1.validateCasinoBet)(userId, bet);
    if (betError)
        return betError;
    const walletBefore = (0, utils_1.getTokens)(userId);
    (0, utils_1.removeTokens)(userId, bet);
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const draw = [];
    for (let i = 0; i < 10; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        draw.push(pool[idx]);
        pool.splice(idx, 1);
    }
    const hits = picks.filter(n => draw.includes(n));
    const hitCount = hits.length;
    const spots = picks.length;
    const baseMultiplier = casinoBalance_1.KENO_PAYOUTS[spots]?.[hitCount] || 0;
    const picksText = picks.sort((a, b) => a - b).join(", ");
    const drawText = draw.sort((a, b) => a - b).join(", ");
    const hitsText = hits.sort((a, b) => a - b).join(", ") || "none";
    if (baseMultiplier <= 0) {
        (0, utils_1.recordGameResult)(userId, "keno", "loss", bet, 0);
        return (0, ui_1.formatCasinoResult)({
            userId,
            gameKey: "keno",
            gameIcon: "🎟️",
            gameName: "Keno",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: (0, utils_1.getTokens)(userId),
            details: [
                { label: `Your Picks (${spots})`, value: picksText },
                { label: "Drawn Numbers", value: drawText },
                { label: "Hits", value: `${hitCount} (${hitsText})` }
            ],
            notes: ["Fewer picks generally improve consistency; more picks chase bigger ladders."],
            actionMeta: { bet, arg: picks.sort((a, b) => a - b).join(",") }
        });
    }
    const lucky = (0, casinoBalance_1.rollWinBonus)();
    const payout = Math.max(1, Math.floor(bet * baseMultiplier * lucky.multiplier));
    (0, utils_1.addTokens)(userId, payout);
    const resultOutcome = payout > bet ? "win" : payout === bet ? "push" : "loss";
    (0, utils_1.recordGameResult)(userId, "keno", resultOutcome, bet, payout);
    return (0, ui_1.formatCasinoResult)({
        userId,
        gameKey: "keno",
        gameIcon: "🎟️",
        gameName: "Keno",
        outcome: resultOutcome,
        bet,
        payout,
        walletBefore,
        walletAfter: (0, utils_1.getTokens)(userId),
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
async function playCrash(userId, bet, target) {
    const betError = (0, ui_1.validateCasinoBet)(userId, bet);
    if (betError)
        return betError;
    if (!target || target < 1.05 || target > 10)
        return "Target multiplier must be between 1.05 and 10.0.";
    const walletBefore = (0, utils_1.getTokens)(userId);
    (0, utils_1.removeTokens)(userId, bet);
    const result = (await Promise.resolve().then(() => __importStar(require("../../game/economy")))).resolveCrash(bet, target);
    if (result.win) {
        const lucky = (0, casinoBalance_1.rollWinBonus)();
        const payout = Math.max(1, Math.floor(result.payout * lucky.multiplier));
        (0, utils_1.addTokens)(userId, payout);
        (0, utils_1.recordGameResult)(userId, "crash", "win", bet, payout);
        return (0, ui_1.formatCasinoResult)({
            userId,
            gameKey: "crash",
            gameIcon: "📈",
            gameName: "Crash",
            outcome: "win",
            bet,
            payout,
            walletBefore,
            walletAfter: (0, utils_1.getTokens)(userId),
            luckyLabel: lucky.label,
            details: [
                { label: "Target", value: `${target.toFixed(2)}x` },
                { label: "Crash Point", value: `${result.crashPoint}x` },
                { label: "Base Payout", value: (0, ui_1.formatTokenAmount)(result.payout) }
            ],
            sections: [
                { title: "Crash Meter", value: (0, slots_1.buildCrashMeter)(target, Number(result.crashPoint)) }
            ],
            actionMeta: { bet, arg: target.toFixed(2) }
        });
    }
    (0, utils_1.recordGameResult)(userId, "crash", "loss", bet, 0);
    return (0, ui_1.formatCasinoResult)({
        userId,
        gameKey: "crash",
        gameIcon: "📈",
        gameName: "Crash",
        outcome: "loss",
        bet,
        payout: 0,
        walletBefore,
        walletAfter: (0, utils_1.getTokens)(userId),
        details: [
            { label: "Target", value: `${target.toFixed(2)}x` },
            { label: "Crash Point", value: `${result.crashPoint}x` }
        ],
        sections: [
            { title: "Crash Meter", value: (0, slots_1.buildCrashMeter)(target, Number(result.crashPoint)) }
        ],
        actionMeta: { bet, arg: target.toFixed(2) }
    });
}
async function runCasinoQuickAction(input) {
    const resolvedGame = input.action === "switch" ? (0, ui_1.getNextCasinoGame)(input.gameKey) : input.gameKey;
    const sourceBet = Math.max(1, Math.floor(input.bet));
    const effectiveBet = input.action === "double"
        ? sourceBet * 2
        : input.action === "half"
            ? Math.max(1, Math.floor(sourceBet / 2))
            : sourceBet;
    const arg = (0, ui_1.sanitizeCasinoActionArg)(input.action === "switch" ? (0, ui_1.defaultCasinoArgForGame)(resolvedGame) : (input.arg || (0, ui_1.defaultCasinoArgForGame)(resolvedGame)));
    if (resolvedGame === "dice")
        return { gameKey: resolvedGame, payload: (0, tableGames_1.playDice)(input.userId, effectiveBet, arg || "low") };
    if (resolvedGame === "roulette")
        return { gameKey: resolvedGame, payload: (0, tableGames_1.playRoulette)(input.userId, effectiveBet, arg || "red") };
    if (resolvedGame === "blackjack")
        return { gameKey: resolvedGame, payload: (0, tableGames_1.playBlackjack)(input.userId, effectiveBet, arg || "safe") };
    if (resolvedGame === "crash") {
        const target = Number.parseFloat(arg || "1.50");
        return { gameKey: resolvedGame, payload: await playCrash(input.userId, effectiveBet, Number.isFinite(target) ? target : 1.5) };
    }
    if (resolvedGame === "magicslots") {
        return { gameKey: resolvedGame, payload: (0, slots_1.playSlots)(input.userId, effectiveBet) };
    }
    if (resolvedGame === "coinflip")
        return { gameKey: resolvedGame, payload: playCoinflip(input.userId, effectiveBet, arg || "heads") };
    if (resolvedGame === "baccarat")
        return { gameKey: resolvedGame, payload: playBaccarat(input.userId, effectiveBet, arg || "player") };
    if (resolvedGame === "hilo")
        return { gameKey: resolvedGame, payload: playHiLo(input.userId, effectiveBet, arg || "higher") };
    return { gameKey: "keno", payload: playKeno(input.userId, effectiveBet, arg || "3,8,11,24") };
}
