// Dice, roulette, and blackjack.
import { addTokens, getTokens, removeTokens, recordGameResult } from "../../utils";
import {
    BLACKJACK_PAYOUTS, DICE_PAYOUTS, buildAmericanRouletteSnapshot, rollAmericanRoulettePocket,
    getAmericanRouletteColor, getAmericanRoulettePayout, rollWinBonus
} from "../../game/casinoBalance";
import { formatCasinoResult, validateCasinoBet } from "./ui";

export function playDice(userId: string, bet: number, choice: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const c = choice.toLowerCase();
    if (!["1", "2", "3", "4", "5", "6", "high", "low", "odd", "even"].includes(c)) {
        return "Choose 1-6, high, low, odd, or even.";
    }

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const roll = Math.floor(Math.random() * 6) + 1;
    const exact = c === roll.toString();
    const win = exact || (c === "high" && roll >= 4) || (c === "low" && roll <= 3) || (c === "odd" && roll % 2 === 1) || (c === "even" && roll % 2 === 0);
    if (!win) {
        recordGameResult(userId, "dice", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "dice",
            gameIcon: "🎲",
            gameName: "Dice",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Call", value: c },
                { label: "Roll", value: String(roll) },
                { label: "Target Bands", value: "Low=1-3 | High=4-6 | Odd/Even parity" }
            ],
            notes: ["Exact number calls are high volatility. Use parity calls for steadier hit rates."],
            actionMeta: { bet, arg: c }
        });
    }

    const lucky = rollWinBonus();
    const baseMultiplier = exact ? DICE_PAYOUTS.exact : DICE_PAYOUTS.band;
    const payout = Math.max(1, Math.floor(bet * baseMultiplier * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "dice", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "dice",
        gameIcon: "🎲",
        gameName: "Dice",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Call", value: c },
            { label: "Roll", value: String(roll) },
            { label: "Base Multiplier", value: `${baseMultiplier.toFixed(2)}x` }
        ],
        notes: ["Protect upside by banking a share of win streak payouts."],
        actionMeta: { bet, arg: c }
    });
}

export function playRoulette(userId: string, bet: number, choice: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const c = choice.toLowerCase();
    const straightNumber = Number.parseInt(c, 10);
    const validChoice = ["red", "black", "green", "odd", "even"].includes(c)
        || c === "00"
        || (/^\d{1,2}$/.test(c) && straightNumber >= 0 && straightNumber <= 36);
    if (!validChoice) return "Choose red, black, green, odd, even, 0, 00, or a number from 1-36.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const number = rollAmericanRoulettePocket();
    const color = getAmericanRouletteColor(number);
    const payoutMultiplier = getAmericanRoulettePayout(c, number);
    const boardSnapshot = buildAmericanRouletteSnapshot(number, c);

    if (payoutMultiplier <= 0) {
        recordGameResult(userId, "roulette", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "roulette",
            gameIcon: "🎡",
            gameName: "Roulette",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Call", value: c },
                { label: "Landed", value: `${number} (${color})` }
            ],
            boardSnapshot,
            notes: ["Color/parity calls have lower variance than exact number calls."],
            actionMeta: { bet, arg: c }
        });
    }

    const lucky = rollWinBonus();
    const payout = Math.max(1, Math.floor(bet * payoutMultiplier * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "roulette", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "roulette",
        gameIcon: "🎡",
        gameName: "Roulette",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Call", value: c },
            { label: "Landed", value: `${number} (${color})` },
            { label: "Base Multiplier", value: `${payoutMultiplier.toFixed(2)}x` }
        ],
            boardSnapshot,
        actionMeta: { bet, arg: c }
    });
}

export function playBlackjack(userId: string, bet: number, style: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const values = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const deck: string[] = [];
    for (const v of values) for (let i = 0; i < 4; i++) deck.push(v);
    const draw = () => deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
    const handValue = (hand: string[]) => {
        let total = 0;
        let aces = 0;
        for (const card of hand) {
            if (["J", "Q", "K"].includes(card)) total += 10;
            else if (card === "A") { total += 11; aces += 1; }
            else total += Number.parseInt(card, 10);
        }
        while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
        return total;
    };

    const player = [draw(), draw()];
    const dealer = [draw(), draw()];
    while (handValue(player) < (style === "aggressive" ? 18 : 16)) player.push(draw());
    while (handValue(dealer) < 17) dealer.push(draw());

    const p = handValue(player);
    const d = handValue(dealer);
    if (p > 21) {
        recordGameResult(userId, "blackjack", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "blackjack",
            gameIcon: "🃏",
            gameName: "Blackjack",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Style", value: style },
                { label: "Player", value: `${player.join(" ")} (${p})` },
                { label: "Dealer", value: `${dealer.join(" ")} (${d})` }
            ],
            notes: ["Safe style (stand threshold 16) lowers bust frequency compared to aggressive style."],
            actionMeta: { bet, arg: style }
        });
    }

    if (p === d) {
        addTokens(userId, bet);
        recordGameResult(userId, "blackjack", "push", bet, bet);
        return formatCasinoResult({
            userId,
            gameKey: "blackjack",
            gameIcon: "🃏",
            gameName: "Blackjack",
            outcome: "push",
            bet,
            payout: bet,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Style", value: style },
                { label: "Player", value: `${player.join(" ")} (${p})` },
                { label: "Dealer", value: `${dealer.join(" ")} (${d})` }
            ],
            notes: ["Push refunded your stake."],
            actionMeta: { bet, arg: style }
        });
    }

    if (d > 21 || p > d) {
        const lucky = rollWinBonus();
        const baseMultiplier = style === "aggressive" ? BLACKJACK_PAYOUTS.aggressive : BLACKJACK_PAYOUTS.safe;
        const payout = Math.max(1, Math.floor(bet * baseMultiplier * lucky.multiplier));
        addTokens(userId, payout);
        recordGameResult(userId, "blackjack", "win", bet, payout);
        return formatCasinoResult({
            userId,
            gameKey: "blackjack",
            gameIcon: "🃏",
            gameName: "Blackjack",
            outcome: "win",
            bet,
            payout,
            walletBefore,
            walletAfter: getTokens(userId),
            luckyLabel: lucky.label,
            details: [
                { label: "Style", value: style },
                { label: "Player", value: `${player.join(" ")} (${p})` },
                { label: "Dealer", value: `${dealer.join(" ")} (${d})` },
                { label: "Base Multiplier", value: `${baseMultiplier.toFixed(2)}x` }
            ],
            actionMeta: { bet, arg: style }
        });
    }

    recordGameResult(userId, "blackjack", "loss", bet, 0);
    return formatCasinoResult({
        userId,
        gameKey: "blackjack",
        gameIcon: "🃏",
        gameName: "Blackjack",
        outcome: "loss",
        bet,
        payout: 0,
        walletBefore,
        walletAfter: getTokens(userId),
        details: [
            { label: "Style", value: style },
            { label: "Player", value: `${player.join(" ")} (${p})` },
            { label: "Dealer", value: `${dealer.join(" ")} (${d})` }
        ],
        actionMeta: { bet, arg: style }
    });
}
