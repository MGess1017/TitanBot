// Magic slots reels, paytable, and scoring.
import { addTokens, getTokens, removeTokens, recordGameResult } from "../../utils";
import { type CasinoOutcome, formatMagicSlotsResult, magicSlotSymbolEmoji, validateCasinoBet } from "./ui";

export type MagicSlotSymbol = "WAND" | "POTION" | "DRAGON" | "SPELLBOOK" | "CRYSTAL" | "BONUS";
type MagicPatternKind = "straight" | "zigzag";

const MAGIC_SLOT_REELS = 6;
const MAGIC_SLOT_ROWS = 6;
const MAGIC_SLOT_RETURN_SCALE = 0.93;
const MAGIC_SLOT_MAX_PAID_PATTERNS = 3;
const MAGIC_SLOT_ULTRA_MAX_PAID_PATTERNS = 4;
const MAGIC_SLOT_BONUS_ROW_JACKPOT_MULTIPLIER = 220;
const MAGIC_SLOT_ULTRA_BONUS_ROW_JACKPOT_MULTIPLIER = 1500;
const MAGIC_SLOT_ZIGZAG_PAYOUT_FACTOR = 0.88;
const MAGIC_SLOT_PAYTABLE: Record<Exclude<MagicSlotSymbol, "BONUS">, Record<3 | 4 | 5 | 6, number>> = {
    WAND: { 3: 0.28, 4: 0.9, 5: 2.8, 6: 7 },
    POTION: { 3: 0.36, 4: 1.2, 5: 3.8, 6: 9.5 },
    SPELLBOOK: { 3: 0.48, 4: 1.7, 5: 5.6, 6: 13.5 },
    CRYSTAL: { 3: 0.72, 4: 2.6, 5: 8.9, 6: 22 },
    DRAGON: { 3: 1.2, 4: 4.8, 5: 17, 6: 68 }
};
const MAGIC_SLOT_REEL_TABLES: Array<Array<{ symbol: MagicSlotSymbol; weight: number }>> = [
    [
        { symbol: "WAND", weight: 40 },
        { symbol: "POTION", weight: 30 },
        { symbol: "SPELLBOOK", weight: 20 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 4 },
        { symbol: "BONUS", weight: 0.9 }
    ],
    [
        { symbol: "WAND", weight: 38 },
        { symbol: "POTION", weight: 31 },
        { symbol: "SPELLBOOK", weight: 19 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 4 },
        { symbol: "BONUS", weight: 0.95 }
    ],
    [
        { symbol: "WAND", weight: 36 },
        { symbol: "POTION", weight: 31 },
        { symbol: "SPELLBOOK", weight: 20 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 5 },
        { symbol: "BONUS", weight: 1.05 }
    ],
    [
        { symbol: "WAND", weight: 36 },
        { symbol: "POTION", weight: 30 },
        { symbol: "SPELLBOOK", weight: 20 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 5 },
        { symbol: "BONUS", weight: 1.05 }
    ],
    [
        { symbol: "WAND", weight: 37 },
        { symbol: "POTION", weight: 30 },
        { symbol: "SPELLBOOK", weight: 19 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 5 },
        { symbol: "BONUS", weight: 0.95 }
    ],
    [
        { symbol: "WAND", weight: 39 },
        { symbol: "POTION", weight: 29 },
        { symbol: "SPELLBOOK", weight: 19 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 4 },
        { symbol: "BONUS", weight: 0.9 }
    ]
];
const MAGIC_SLOT_PATTERNS: Array<{ name: string; kind: MagicPatternKind; path: number[] }> = [
    { name: "Runic Row 1", kind: "straight", path: [0, 0, 0, 0, 0, 0] },
    { name: "Runic Row 2", kind: "straight", path: [1, 1, 1, 1, 1, 1] },
    { name: "Runic Row 3", kind: "straight", path: [2, 2, 2, 2, 2, 2] },
    { name: "Runic Row 4", kind: "straight", path: [3, 3, 3, 3, 3, 3] },
    { name: "Runic Row 5", kind: "straight", path: [4, 4, 4, 4, 4, 4] },
    { name: "Runic Row 6", kind: "straight", path: [5, 5, 5, 5, 5, 5] },
    { name: "Storm Weave 1", kind: "zigzag", path: [0, 1, 0, 1, 0, 1] },
    { name: "Storm Weave 2", kind: "zigzag", path: [1, 2, 1, 2, 1, 2] },
    { name: "Storm Weave 3", kind: "zigzag", path: [2, 3, 2, 3, 2, 3] },
    { name: "Storm Weave 4", kind: "zigzag", path: [3, 4, 3, 4, 3, 4] },
    { name: "Storm Weave 5", kind: "zigzag", path: [4, 5, 4, 5, 4, 5] },
    { name: "Arcane Crown", kind: "zigzag", path: [0, 1, 2, 1, 0, 1] }
];

function spinMagicSlotSymbol(reelIndex: number): MagicSlotSymbol {
    const table = MAGIC_SLOT_REEL_TABLES[reelIndex] || MAGIC_SLOT_REEL_TABLES[0];
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of table) {
        roll -= entry.weight;
        if (roll <= 0) return entry.symbol;
    }
    return "POTION";
}

function getMagicSlotSymbolBoost(symbol: Exclude<MagicSlotSymbol, "BONUS">): number {
    if (symbol === "DRAGON") return 1.06;
    if (symbol === "CRYSTAL") return 1.04;
    if (symbol === "SPELLBOOK") return 1.02;
    if (symbol === "POTION") return 1.01;
    return 1;
}

function detectUltraBonusWinSpin(grid: MagicSlotSymbol[][], preliminaryWins: Array<{ streak: number; bonusHits: number }>): boolean {
    const totalBonusSymbols = grid.flat().filter(symbol => symbol === "BONUS").length;
    const bonusAssistedPremiumLine = preliminaryWins.some(win => win.streak >= 4 && win.bonusHits >= 1);
    return totalBonusSymbols >= 3 && bonusAssistedPremiumLine;
}

function getMagicSlotScatterMultiplier(totalBonusSymbols: number): number {
    if (totalBonusSymbols >= 6) return 7.0;
    if (totalBonusSymbols === 5) return 2.4;
    if (totalBonusSymbols === 4) return 0.9;
    if (totalBonusSymbols === 3) return 0.35;
    return 0;
}

function scoreMagicPattern(symbols: MagicSlotSymbol[], kind: MagicPatternKind): {
    hit: boolean;
    streak: number;
    anchor: Exclude<MagicSlotSymbol, "BONUS"> | null;
    bonusHits: number;
    multiplier: number;
    rule: string;
    jackpot: boolean;
} {
    const allBonus = symbols.every(symbol => symbol === "BONUS");
    if (allBonus) {
        return {
            hit: true,
            streak: MAGIC_SLOT_REELS,
            anchor: null,
            bonusHits: MAGIC_SLOT_REELS,
            multiplier: MAGIC_SLOT_BONUS_ROW_JACKPOT_MULTIPLIER,
            rule: "full-bonus jackpot row",
            jackpot: true
        };
    }

    let anchor: Exclude<MagicSlotSymbol, "BONUS"> | null = null;
    let streak = 0;
    let bonusHits = 0;

    for (const symbol of symbols) {
        if (symbol === "BONUS") {
            streak += 1;
            bonusHits += 1;
            continue;
        }

        if (!anchor) {
            anchor = symbol;
            streak += 1;
            continue;
        }

        if (symbol === anchor) {
            streak += 1;
            continue;
        }

        break;
    }

    if (!anchor || streak < 3) {
        return {
            hit: false,
            streak,
            anchor,
            bonusHits,
            multiplier: 0,
            rule: "no_match",
            jackpot: false
        };
    }

    const payoutKey = Math.min(6, Math.max(3, streak)) as 3 | 4 | 5 | 6;
    let base = MAGIC_SLOT_PAYTABLE[anchor][payoutKey];
    let rule = `${payoutKey}-${anchor.toLowerCase()} ${kind}`;

    if (kind === "zigzag") {
        base *= MAGIC_SLOT_ZIGZAG_PAYOUT_FACTOR;
    }

    const symbolBoost = getMagicSlotSymbolBoost(anchor);
    const bonusBoost = bonusHits > 0 ? 1 + (bonusHits * 0.06) : 1;
    return {
        hit: true,
        streak,
        anchor,
        bonusHits,
        multiplier: base * symbolBoost * bonusBoost,
        rule,
        jackpot: false
    };
}

export function buildCrashMeter(target: number, crashPoint: number): string {
    const max = 10;
    const width = 12;
    const targetPos = Math.max(0, Math.min(width - 1, Math.round((target / max) * (width - 1))));
    const crashPos = Math.max(0, Math.min(width - 1, Math.round((crashPoint / max) * (width - 1))));
    const cells: string[] = [];
    for (let i = 0; i < width; i++) {
        if (i === targetPos && i === crashPos) cells.push("🎯");
        else if (i === targetPos) cells.push("T");
        else if (i === crashPos) cells.push("X");
        else cells.push("-");
    }
    return `[${cells.join("")}]`;
}

export function playSlots(userId: string, bet: number): string {
    const totalBet = bet;
    const betError = validateCasinoBet(userId, totalBet);
    if (betError) return betError;

    const walletBefore = getTokens(userId);
    removeTokens(userId, totalBet);

    const machineGrid: MagicSlotSymbol[][] = Array.from({ length: MAGIC_SLOT_ROWS }, () =>
        Array.from({ length: MAGIC_SLOT_REELS }, (_, reelIndex) => spinMagicSlotSymbol(reelIndex))
    );
    const totalBonusSymbols = machineGrid.flat().filter(symbol => symbol === "BONUS").length;

    const activePatterns = MAGIC_SLOT_PATTERNS;
    const preliminaryWins: Array<{ streak: number; bonusHits: number }> = [];
    for (const pattern of activePatterns) {
        const lineSymbols = pattern.path.map((rowIndex, reelIndex) => machineGrid[rowIndex]?.[reelIndex] || "WAND");
        const scored = scoreMagicPattern(lineSymbols, pattern.kind);
        if (!scored.hit || scored.multiplier <= 0) continue;
        preliminaryWins.push({ streak: scored.streak, bonusHits: scored.bonusHits });
    }

    const ultraBonusMode = detectUltraBonusWinSpin(machineGrid, preliminaryWins);
    const lineWins: Array<{ pattern: string; symbols: string; multiplier: number; rule: string; streak: number; bonusHits: number }> = [];
    let jackpotRows = 0;

    for (const pattern of activePatterns) {
        const lineSymbols = pattern.path.map((rowIndex, reelIndex) => machineGrid[rowIndex]?.[reelIndex] || "WAND");
        const scored = scoreMagicPattern(lineSymbols, pattern.kind);
        if (!scored.hit || scored.multiplier <= 0) continue;
        let effectiveMultiplier = scored.multiplier;
        let effectiveRule = scored.rule;

        if (scored.jackpot && ultraBonusMode) {
            effectiveMultiplier = MAGIC_SLOT_ULTRA_BONUS_ROW_JACKPOT_MULTIPLIER;
            effectiveRule = "ultra bonus jackpot row";
            jackpotRows += 1;
        } else if (scored.jackpot) {
            jackpotRows += 1;
        } else if (ultraBonusMode) {
            if (scored.anchor === "DRAGON" && scored.streak >= 6 && scored.bonusHits >= 1) {
                effectiveMultiplier = pattern.kind === "straight" ? 320 : 250;
                effectiveRule = pattern.kind === "straight" ? "ultra dragon line" : "ultra dragon weave";
            } else if (scored.anchor === "CRYSTAL" && scored.streak >= 6 && scored.bonusHits >= 1) {
                effectiveMultiplier = pattern.kind === "straight" ? 110 : 82;
                effectiveRule = pattern.kind === "straight" ? "ultra prism line" : "ultra prism weave";
            }
        }

        lineWins.push({
            pattern: pattern.name,
            symbols: lineSymbols.join(" | "),
            multiplier: effectiveMultiplier,
            rule: effectiveRule,
            streak: scored.streak,
            bonusHits: scored.bonusHits
        });
    }

    const paidLineLimit = ultraBonusMode ? MAGIC_SLOT_ULTRA_MAX_PAID_PATTERNS : MAGIC_SLOT_MAX_PAID_PATTERNS;
    const paidWins = [...lineWins]
        .sort((a, b) => b.multiplier - a.multiplier)
        .slice(0, paidLineLimit);
    const baseMultiplier = paidWins.reduce((sum, win) => sum + win.multiplier, 0);
    const totalBonusHits = paidWins.reduce((sum, win) => sum + win.bonusHits, 0);
    const scatterMultiplier = getMagicSlotScatterMultiplier(totalBonusSymbols);

    const totalMultiplier = Math.max(0, baseMultiplier + scatterMultiplier);
    const scaledMultiplier = totalMultiplier * MAGIC_SLOT_RETURN_SCALE;
    const payout = totalMultiplier > 0 ? Math.max(1, Math.floor(totalBet * scaledMultiplier)) : 0;
    if (payout > 0) addTokens(userId, payout);
    const outcome: CasinoOutcome = payout > totalBet ? "win" : payout === totalBet ? "push" : "loss";
    recordGameResult(userId, "magicslots", outcome, totalBet, payout);

    const boardRows = machineGrid.map((row, idx) => `R${idx + 1} ${row.map(symbol => `[${magicSlotSymbolEmoji(symbol)}]`).join("")}`);
    const winningEmojiLines = paidWins.map(win => ({
        pattern: win.pattern,
        emojiLine: win.symbols.split(" | ").map(symbol => magicSlotSymbolEmoji(symbol as MagicSlotSymbol)).join(" "),
        multiplier: win.multiplier,
        rule: win.rule
    }));

    return formatMagicSlotsResult({
        userId,
        outcome,
        bet: totalBet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: ultraBonusMode ? "Ultra Bonus Win Spin (3+ BONUS + bonus-assisted premium line)" : "Standard reel profile",
        boardRows,
        winningLines: winningEmojiLines,
        baseMultiplier,
        totalBonusHits,
        totalHits: lineWins.length,
        jackpotRows,
        scaledMultiplier,
        ultraBonusMode,
        totalBonusSymbols,
        scatterMultiplier
    });
}
