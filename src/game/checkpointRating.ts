export const CHECKPOINT_STAT_KEYS = [
    "kd", "playerKills", "deaths", "doubleKills",
    "matchesPlayed", "victories", "winRate", "matchesQuit",
    "headshotKills", "headshotRate", "overkills", "meleeKills",
    "highestWinStreak", "highestMatchXp", "moneyEarned", "mvps"
] as const;

export type CheckpointStatKey = typeof CHECKPOINT_STAT_KEYS[number];
export type CheckpointStats = Partial<Record<CheckpointStatKey, number>>;
export type CheckpointSectionId = "combat" | "matches" | "precision" | "records";

export type CheckpointProfile = {
    ingameName: string | null;
    stats: CheckpointStats;
    updatedAt: number;
    cardChannelId: string | null;
    cardMessageId: string | null;
};

export const INGAME_NAME_MIN = 3;
export const INGAME_NAME_MAX = 15;
const INGAME_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Tarkov Arena nicknames: 3–15 letters, numbers, underscores, or hyphens. */
export function parseIngameName(raw: string): { ok: true; value: string } | { ok: false; error: string } {
    const value = raw.trim();
    if (value.length < INGAME_NAME_MIN || value.length > INGAME_NAME_MAX) {
        return { ok: false, error: `In-game name must be ${INGAME_NAME_MIN}–${INGAME_NAME_MAX} characters.` };
    }
    if (!INGAME_NAME_PATTERN.test(value)) {
        return { ok: false, error: "In-game name can only use letters, numbers, underscores (_), and hyphens (-)." };
    }
    return { ok: true, value };
}

type StatDefinition = { label: string; short: string; kind: "integer" | "decimal" | "percent"; placeholder: string };

export const CHECKPOINT_STATS: Record<CheckpointStatKey, StatDefinition> = {
    kd: { label: "K/D", short: "K/D", kind: "decimal", placeholder: "e.g. 1.85" },
    playerKills: { label: "Player kills", short: "KILLS", kind: "integer", placeholder: "e.g. 1240" },
    deaths: { label: "Deaths", short: "DEATHS", kind: "integer", placeholder: "e.g. 670" },
    doubleKills: { label: "Double kills", short: "DOUBLE KILLS", kind: "integer", placeholder: "e.g. 85" },
    matchesPlayed: { label: "Matches played", short: "MATCHES", kind: "integer", placeholder: "e.g. 410" },
    victories: { label: "Victories", short: "VICTORIES", kind: "integer", placeholder: "e.g. 230" },
    winRate: { label: "Win rate %", short: "WIN RATE", kind: "percent", placeholder: "e.g. 56.1" },
    matchesQuit: { label: "Matches quit", short: "QUITS", kind: "integer", placeholder: "e.g. 3" },
    headshotKills: { label: "Headshot kills", short: "HEADSHOTS", kind: "integer", placeholder: "e.g. 380" },
    headshotRate: { label: "Headshot kill rate %", short: "HS RATE", kind: "percent", placeholder: "e.g. 30.6" },
    overkills: { label: "Overkills", short: "OVERKILLS", kind: "integer", placeholder: "e.g. 12" },
    meleeKills: { label: "Melee weapon kills", short: "MELEE", kind: "integer", placeholder: "e.g. 9" },
    highestWinStreak: { label: "Highest win streak", short: "BEST STREAK", kind: "integer", placeholder: "e.g. 8" },
    highestMatchXp: { label: "Highest match XP", short: "BEST MATCH XP", kind: "integer", placeholder: "e.g. 4200" },
    moneyEarned: { label: "Money earned", short: "MONEY", kind: "integer", placeholder: "e.g. 15400000 or 15.4m" },
    mvps: { label: "Match MVPs received", short: "MVPS", kind: "integer", placeholder: "e.g. 64" }
};

export const CHECKPOINT_SECTIONS: Record<CheckpointSectionId, { title: string; keys: CheckpointStatKey[] }> = {
    combat: { title: "Combat", keys: ["kd", "playerKills", "deaths", "doubleKills"] },
    matches: { title: "Matches", keys: ["matchesPlayed", "victories", "winRate", "matchesQuit"] },
    precision: { title: "Precision", keys: ["headshotKills", "headshotRate", "overkills", "meleeKills"] },
    records: { title: "Records & Economy", keys: ["highestWinStreak", "highestMatchXp", "moneyEarned", "mvps"] }
};

export const CHECKPOINT_SECTION_IDS = Object.keys(CHECKPOINT_SECTIONS) as CheckpointSectionId[];

export function isCheckpointSectionId(value: string): value is CheckpointSectionId {
    return Object.prototype.hasOwnProperty.call(CHECKPOINT_SECTIONS, value);
}

const MAX_VALUE = 1_000_000_000_000;

export function parseCheckpointStat(key: CheckpointStatKey, raw: string): { ok: true; value: number } | { ok: false; error: string } {
    const def = CHECKPOINT_STATS[key];
    const cleaned = raw.trim().toLowerCase().replace(/[,\s_₽$%]/g, "");
    const match = /^(\d+(?:\.\d+)?|\.\d+)([km]?)$/.exec(cleaned);
    if (!match) return { ok: false, error: `${def.label} must be a number.` };
    const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
    if (multiplier !== 1 && key !== "moneyEarned" && key !== "highestMatchXp") {
        return { ok: false, error: `${def.label} cannot use k/m shorthand.` };
    }
    let value = Number(match[1]) * multiplier;
    if (!Number.isFinite(value) || value > MAX_VALUE) return { ok: false, error: `${def.label} is too large.` };
    if (def.kind === "integer") {
        if (!Number.isInteger(value) && multiplier === 1) return { ok: false, error: `${def.label} must be a whole number.` };
        value = Math.round(value);
    } else {
        value = Math.round(value * 100) / 100;
    }
    if (def.kind === "percent" && value > 100) return { ok: false, error: `${def.label} cannot be above 100.` };
    if (key === "kd" && value > 100) return { ok: false, error: "K/D cannot be above 100." };
    return { ok: true, value };
}

export function validateCheckpointStats(stats: CheckpointStats): string[] {
    const errors: string[] = [];
    const notAbove = (a: CheckpointStatKey, b: CheckpointStatKey) => {
        const left = stats[a];
        const right = stats[b];
        if (left !== undefined && right !== undefined && left > right) {
            errors.push(`${CHECKPOINT_STATS[a].label} cannot be higher than ${CHECKPOINT_STATS[b].label}.`);
        }
    };
    notAbove("victories", "matchesPlayed");
    notAbove("matchesQuit", "matchesPlayed");
    notAbove("mvps", "matchesPlayed");
    notAbove("highestWinStreak", "victories");
    notAbove("headshotKills", "playerKills");
    notAbove("meleeKills", "playerKills");
    notAbove("doubleKills", "playerKills");
    notAbove("overkills", "playerKills");
    return errors;
}

export function isCheckpointComplete(stats: CheckpointStats): stats is Record<CheckpointStatKey, number> {
    return CHECKPOINT_STAT_KEYS.every(key => typeof stats[key] === "number");
}

export function isSectionComplete(stats: CheckpointStats, section: CheckpointSectionId): boolean {
    return CHECKPOINT_SECTIONS[section].keys.every(key => typeof stats[key] === "number");
}

export function normalizeCheckpointProfile(raw: unknown): CheckpointProfile | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<CheckpointProfile>;
    const stats: CheckpointStats = {};
    const sourceStats = candidate.stats && typeof candidate.stats === "object" ? candidate.stats as Record<string, unknown> : {};
    for (const key of CHECKPOINT_STAT_KEYS) {
        const value = sourceStats[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) stats[key] = value;
    }
    const parsedName = typeof candidate.ingameName === "string" ? parseIngameName(candidate.ingameName) : null;
    return {
        ingameName: parsedName?.ok ? parsedName.value : null,
        stats,
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
        cardChannelId: typeof candidate.cardChannelId === "string" ? candidate.cardChannelId : null,
        cardMessageId: typeof candidate.cardMessageId === "string" ? candidate.cardMessageId : null
    };
}

export type CheckpointRatingPart = { label: string; points: number; max: number };
export type CheckpointRating = { rating: number; parts: CheckpointRatingPart[]; quitPenalty: number; sampleFactor: number };

const CHECKPOINT_BASELINE_RATING = 45;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const per = (value: number, matches: number) => matches > 0 ? value / matches : 0;

/**
 * Rating out of 100. Rate stats are weighted most; volume stats use log scales so grinding alone
 * cannot max the card, and small samples (<50 matches) are pulled toward an average result.
 */
export function calculateCheckpointRating(stats: Record<CheckpointStatKey, number>): CheckpointRating {
    const matches = stats.matchesPlayed;
    const parts: CheckpointRatingPart[] = [
        { label: "K/D", max: 20, points: 20 * clamp01(stats.kd / 3) },
        { label: "Win rate", max: 18, points: 18 * clamp01(stats.winRate / 70) },
        { label: "Headshot rate", max: 12, points: 12 * clamp01(stats.headshotRate / 50) },
        { label: "MVP rate", max: 10, points: 10 * clamp01(per(stats.mvps, matches) / 0.3) },
        { label: "Kills per match", max: 8, points: 8 * clamp01(per(stats.playerKills, matches) / 6) },
        { label: "Experience", max: 10, points: 10 * clamp01(Math.log10(matches + 1) / 3) },
        { label: "Multi-kills", max: 6, points: 6 * clamp01(per(stats.doubleKills + stats.overkills * 2, matches) / 0.6) },
        { label: "Win streak", max: 6, points: 6 * clamp01(stats.highestWinStreak / 10) },
        { label: "Best match XP", max: 4, points: 4 * clamp01(stats.highestMatchXp / 8000) },
        { label: "Money earned", max: 4, points: 4 * clamp01(Math.log10(stats.moneyEarned + 1) / 8) },
        { label: "Melee", max: 2, points: 2 * clamp01(per(stats.meleeKills, Math.max(stats.playerKills, 1)) / 0.05) }
    ];
    const sampleFactor = 0.6 + 0.4 * clamp01(matches / 50);
    const raw = parts.reduce((sum, part) => sum + part.points, 0);
    const adjusted = raw * sampleFactor + CHECKPOINT_BASELINE_RATING * (1 - sampleFactor);
    const quitPenalty = 10 * clamp01(per(stats.matchesQuit, matches) / 0.2);
    const rating = Math.max(1, Math.min(99, Math.round(adjusted - quitPenalty)));
    return {
        rating,
        parts: parts.map(part => ({ ...part, points: Math.round(part.points * 10) / 10 })),
        quitPenalty: Math.round(quitPenalty * 10) / 10,
        sampleFactor
    };
}

export type CheckpointTierId = "legend" | "elite" | "veteran" | "operator" | "contender" | "recruit";
export type CheckpointTier = { id: CheckpointTierId; name: string; minRating: number; color: number; accent: string };

export const CHECKPOINT_TIERS: CheckpointTier[] = [
    { id: "legend", name: "LEGEND", minRating: 90, color: 0xf5b82e, accent: "#f5b82e" },
    { id: "elite", name: "ELITE", minRating: 80, color: 0xb24cff, accent: "#c77dff" },
    { id: "veteran", name: "VETERAN", minRating: 70, color: 0x2fa8ff, accent: "#4cc3ff" },
    { id: "operator", name: "OPERATOR", minRating: 60, color: 0x1fcf8f, accent: "#34e0a1" },
    { id: "contender", name: "CONTENDER", minRating: 45, color: 0xff6a2a, accent: "#ff8a4c" },
    { id: "recruit", name: "RECRUIT", minRating: 0, color: 0x8a9399, accent: "#b8c2c8" }
];

export function getCheckpointTier(rating: number): CheckpointTier {
    return CHECKPOINT_TIERS.find(tier => rating >= tier.minRating) || CHECKPOINT_TIERS[CHECKPOINT_TIERS.length - 1];
}

export function formatCheckpointStat(key: CheckpointStatKey, value: number): string {
    const def = CHECKPOINT_STATS[key];
    if (def.kind === "percent") return `${value.toFixed(1)}%`;
    if (def.kind === "decimal") return value.toFixed(2);
    if (key === "moneyEarned") {
        if (value >= 1_000_000_000) return `₽${(value / 1_000_000_000).toFixed(2)}B`;
        if (value >= 1_000_000) return `₽${(value / 1_000_000).toFixed(1)}M`;
        if (value >= 10_000) return `₽${(value / 1_000).toFixed(1)}K`;
        return `₽${value.toLocaleString("en-US")}`;
    }
    return value.toLocaleString("en-US");
}
