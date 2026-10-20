export type CasinoGameKey = "dice" | "roulette" | "blackjack" | "crash" | "magicslots" | "coinflip" | "baccarat" | "hilo" | "keno";

export const CASINO_TARGET_RTP = 0.95;
export const STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER = 1.00925;
export const CASINO_BASE_RTP = CASINO_TARGET_RTP / STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER;

export const CASINO_PROFILES: Record<CasinoGameKey, { rtp: string; bonus: string; volatility: string }> = {
    dice: { rtp: "94.2% exact / 94.9% bands incl. promo", bonus: "6% win boost on standard wins", volatility: "Choice-based" },
    roulette: { rtp: "94.7% base / ~95.6% incl. promo", bonus: "6% win boost on standard wins", volatility: "American double-zero" },
    blackjack: { rtp: "~98% simulated auto-play incl. promo", bonus: "6% win boost on standard wins", volatility: "Medium" },
    crash: { rtp: "95%", bonus: "Built into crash odds", volatility: "Target-based" },
    magicslots: { rtp: "~94% simulated", bonus: "Scatter 0.47% | Ultra 0.16%", volatility: "Very high" },
    coinflip: { rtp: "~95.9% incl. promo", bonus: "6% win boost on standard wins", volatility: "Medium" },
    baccarat: { rtp: "~99.6% player | ~99.7% banker | ~85.7% tie incl. promo", bonus: "6% win boost on standard wins", volatility: "Medium" },
    hilo: { rtp: "~95% simulated incl. promo", bonus: "6% win boost on standard wins", volatility: "Medium" },
    keno: { rtp: "94.6-96.0% by spot count incl. promo", bonus: "6% win boost on standard wins", volatility: "High" }
};

export const STANDARD_WIN_BONUS_CHANCE = 0.06;

export function rollWinBonus(random = Math.random()): { multiplier: number; label: string; triggered: boolean } {
    if (random < 0.002) return { multiplier: 1.75, label: "Legendary Boost 1.75x", triggered: true };
    if (random < 0.015) return { multiplier: 1.25, label: "Rare Boost 1.25x", triggered: true };
    if (random < STANDARD_WIN_BONUS_CHANCE) return { multiplier: 1.1, label: "Lucky Boost 1.10x", triggered: true };
    return { multiplier: 1, label: "No bonus", triggered: false };
}

export const DICE_PAYOUTS = { exact: 5.6, band: 1.88 } as const;
export const AMERICAN_ROULETTE_WHEEL = [
    "0", "28", "9", "26", "30", "11", "7", "20", "32", "17", "5", "22", "34", "15", "3", "24", "36", "13", "1",
    "00", "27", "10", "25", "29", "12", "8", "19", "31", "18", "6", "21", "33", "16", "4", "23", "35", "14", "2"
] as const;
export const AMERICAN_ROULETTE_RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const ROULETTE_PAYOUTS = { straight: 36, evenMoney: 2, green: 18 } as const;

export function rollAmericanRoulettePocket(random = Math.random): string {
    const sample = random();
    const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999999999, sample)) : 0;
    return AMERICAN_ROULETTE_WHEEL[Math.floor(normalized * AMERICAN_ROULETTE_WHEEL.length)];
}

export function getAmericanRouletteColor(pocket: string): "red" | "black" | "green" {
    if (pocket === "0" || pocket === "00") return "green";
    return AMERICAN_ROULETTE_RED_NUMBERS.has(Number(pocket)) ? "red" : "black";
}

export function getAmericanRoulettePayout(choice: string, pocket: string): number {
    const normalizedChoice = choice.toLowerCase();
    const color = getAmericanRouletteColor(pocket);
    if (normalizedChoice === pocket) return ROULETTE_PAYOUTS.straight;
    if (normalizedChoice === "green" && color === "green") return ROULETTE_PAYOUTS.green;
    if (normalizedChoice === color && color !== "green") return ROULETTE_PAYOUTS.evenMoney;
    if (color !== "green" && normalizedChoice === "odd" && Number(pocket) % 2 === 1) return ROULETTE_PAYOUTS.evenMoney;
    if (color !== "green" && normalizedChoice === "even" && Number(pocket) % 2 === 0) return ROULETTE_PAYOUTS.evenMoney;
    return 0;
}

export function buildAmericanRouletteSnapshot(landedPocket: string, choice: string): string {
    const rouletteRows = [1, 2, 3].map(row => Array.from({ length: 12 }, (_, column) => {
        const pocket = String((column * 3) + row);
        return pocket === landedPocket ? `[${pocket}]` : ` ${pocket} `;
    }).join(" "));
    const zeroCells = ["0", "00"].map(pocket => pocket === landedPocket ? `[${pocket}]` : ` ${pocket} `).join("  ");
    return [
        `GREEN ${zeroCells}`,
        ...rouletteRows,
        `Bet: ${choice} • Result: ${landedPocket} (${getAmericanRouletteColor(landedPocket)})`
    ].join("\n");
}

export function buildCasinoBoardSnapshot(gameKey: CasinoGameKey, details: Array<{ label: string; value: string }>): string | null {
    const detail = (label: string) => details.find(item => item.label === label)?.value || "-";
    if (gameKey === "dice") return `DICE\nCall: ${detail("Your Call")}\nRoll: [ ${detail("Roll")} ]`;
    if (gameKey === "roulette") {
        const pocket = detail("Landed").split(" ")[0];
        return buildAmericanRouletteSnapshot(pocket, detail("Your Call"));
    }
    if (gameKey === "blackjack") return [
        "BLACKJACK TABLE",
        `PLAYER  ${detail("Player")}`,
        `DEALER  ${detail("Dealer")}`
    ].join("\n");
    if (gameKey === "coinflip") return `COIN FLIP\n${detail("Your Pick").toUpperCase()}  vs  ${detail("Landed").toUpperCase()}`;
    if (gameKey === "baccarat") return [
        "BACCARAT TABLE",
        `PLAYER  ${detail("Player Hand")}`,
        `BANKER  ${detail("Banker Hand")}`,
        `RESULT  ${detail("Outcome").toUpperCase()}`
    ].join("\n");
    if (gameKey === "hilo") return `HIGH-LOW\n${detail("First Card")}  →  ${detail("Second Card")}\nCALL  ${detail("Your Call").toUpperCase()}`;
    if (gameKey === "crash") return `CRASH\nTARGET  ${detail("Target")}\nPOINT  ${detail("Crash Point")}`;
    if (gameKey === "keno") {
        const pickedNumbers = details.find(item => item.label.startsWith("Your Picks"))?.value || "";
        const picks = new Set((pickedNumbers.match(/\d+/g) || []).map(Number));
        const drawn = new Set((detail("Drawn Numbers").match(/\d+/g) || []).map(Number));
        if (!picks.size || !drawn.size) return null;
        const cells = Array.from({ length: 40 }, (_, index) => {
            const number = index + 1;
            const label = String(number).padStart(2, "0");
            const marker = picks.has(number) && drawn.has(number) ? "✓" : picks.has(number) ? "•" : drawn.has(number) ? "x" : " ";
            return `${marker}${label}`;
        });
        return [
            "KENO • ✓ HIT • • PICK • x DRAW",
            ...Array.from({ length: 8 }, (_, row) => cells.slice(row * 5, (row + 1) * 5).join(" "))
        ].join("\n");
    }
    return null;
}
export const BLACKJACK_PAYOUTS = { safe: 2.11, aggressive: 2.21 } as const;
export const COINFLIP_PAYOUT = 1.9;
export const BACCARAT_PAYOUTS = { player: 2, banker: 1.95, tie: 9 } as const;
export const HILO_PAYOUTS = { standard: 1.72, strong: 1.96, extreme: 2.24 } as const;

export type BaccaratRound = {
    playerCards: string[];
    bankerCards: string[];
    playerTotal: number;
    bankerTotal: number;
    outcome: "player" | "banker" | "tie";
};

export function dealBaccaratRound(random = Math.random): BaccaratRound {
    const draw = (): { label: string; value: number } => {
        const sample = random();
        const rank = Math.floor(Math.max(0, Math.min(0.999999999999, sample)) * 13) + 1;
        const label = rank === 1 ? "A" : rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : String(rank);
        return { label, value: rank >= 10 ? 0 : rank };
    };
    const total = (cards: Array<{ label: string; value: number }>): number => cards.reduce((sum, card) => sum + card.value, 0) % 10;
    const playerCards = [draw(), draw()];
    const bankerCards = [draw(), draw()];
    const initialPlayerTotal = total(playerCards);
    const initialBankerTotal = total(bankerCards);
    const natural = initialPlayerTotal >= 8 || initialBankerTotal >= 8;
    let playerThird: number | null = null;

    if (!natural && initialPlayerTotal <= 5) {
        const thirdCard = draw();
        playerThird = thirdCard.value;
        playerCards.push(thirdCard);
    }

    if (!natural) {
        let bankerDraws = false;
        if (playerThird === null) {
            bankerDraws = initialBankerTotal <= 5;
        } else if (initialBankerTotal <= 2) {
            bankerDraws = true;
        } else if (initialBankerTotal === 3) {
            bankerDraws = playerThird !== 8;
        } else if (initialBankerTotal === 4) {
            bankerDraws = playerThird >= 2 && playerThird <= 7;
        } else if (initialBankerTotal === 5) {
            bankerDraws = playerThird >= 4 && playerThird <= 7;
        } else if (initialBankerTotal === 6) {
            bankerDraws = playerThird === 6 || playerThird === 7;
        }
        if (bankerDraws) bankerCards.push(draw());
    }

    const playerTotal = total(playerCards);
    const bankerTotal = total(bankerCards);
    return {
        playerCards: playerCards.map(card => card.label),
        bankerCards: bankerCards.map(card => card.label),
        playerTotal,
        bankerTotal,
        outcome: playerTotal === bankerTotal ? "tie" : playerTotal > bankerTotal ? "player" : "banker"
    };
}

export function settleBaccaratBet(
    pick: "player" | "banker" | "tie",
    outcome: "player" | "banker" | "tie",
    bet: number,
    winBonusMultiplier = 1
): { outcome: "win" | "loss" | "push"; payout: number } {
    if (outcome === "tie" && pick !== "tie") return { outcome: "push", payout: bet };
    if (pick !== outcome) return { outcome: "loss", payout: 0 };
    return {
        outcome: "win",
        payout: Math.max(1, Math.floor(bet * BACCARAT_PAYOUTS[pick] * winBonusMultiplier))
    };
}

export const KENO_PAYOUTS: Record<number, number[]> = {
    2: [0, 1.03, 9.62],
    3: [0, 0.6, 3.59, 15.57],
    4: [0, 0.36, 1.82, 7.64, 38.23],
    5: [0, 0.32, 1.27, 3.8, 13.95, 49.14],
    6: [0, 0, 1, 3.01, 7.35, 29.41, 76.85],
    7: [0, 0, 0.64, 2.23, 5.1, 13.07, 39.84, 98.8],
    8: [0, 0, 0.44, 1.61, 3.66, 9.37, 22.84, 53.28, 122.94],
    9: [0, 0, 0.27, 1.21, 2.83, 6.74, 16.44, 34.77, 72.77, 150.98],
    10: [0, 0, 0.26, 0.9, 2.06, 4.9, 11.34, 24.48, 50.25, 95.35, 190.7]
};

export function getCasinoProfileLine(gameKey: CasinoGameKey): string {
    const profile = CASINO_PROFILES[gameKey];
    return `Target RTP: ${profile.rtp} | Bonus: ${profile.bonus} | Volatility: ${profile.volatility}`;
}

export function resolveFairCrash(bet: number, target: number, random = Math.random): { win: boolean; crashPoint: string; payout: number; loss: number } {
    const hitChance = Math.min(1, CASINO_BASE_RTP / target);
    const win = random() < hitChance;
    const crashPoint = win
        ? target + random() * Math.max(0, 10 - target)
        : 1 + random() * Math.max(0, target - 1);
    return win
        ? { win: true, crashPoint: crashPoint.toFixed(2), payout: Math.max(1, Math.floor(bet * target)), loss: 0 }
        : { win: false, crashPoint: crashPoint.toFixed(2), payout: 0, loss: bet };
}