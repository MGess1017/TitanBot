import fs from "fs-extra";
import path from "path";

export type UserState = {
    modPoints: number;
    xp: number;
    rxp: number;
    pmcXP: number;
    pmcRaids: number;
    pmcRaidWins: number;
    pmcBossKills: number;
    pmcPrestige: number;
    lastXP: number;
    prestige: number;
    lastDaily: number;
    dailyStreak: number;
    achievements: string[];
    bossHeartClaims: string[];
    fnTokens: number;
    bankTokens: number;
    bankUpdatedAt: number;
    selectedCharacter: string | null;
    mapReputation: Record<string, MapReputationEntry>;
    raidHistory: Array<{
        timestamp: number;
        tension: string;
        map?: string;
        mapKey?: string;
        condition?: string;
        approach?: string;
        bet: number;
        success: boolean;
        rewardTokens: number;
        net: number;
        rxpGain: number;
        bossSpawned?: boolean;
        bossDefeated?: boolean;
        bossName?: string;
        bossTraits?: string[];
        bossPhasesReached?: number;
        bossPhaseCount?: number;
        bossBonusXp?: number;
        mapReputationGain?: number;
        mapReputationPoints?: number;
        loot: Array<{ id: string; qty: number }>;
        successChance: number;
    }>;
    lastRaid: number;
    inventory: Record<string, number>;
    gameStats: Record<GameStatKey, GameStatEntry>;
};

export type MapReputationEntry = {
    points: number;
    raids: number;
    extracts: number;
    bossEncounters: number;
    bossKills: number;
    lastRaidAt: number;
};

export type GameStatKey = "raid" | "dice" | "roulette" | "blackjack" | "crash" | "magicslots" | "coinflip" | "baccarat" | "hilo" | "keno";

export type GameStatEntry = {
    played: number;
    wins: number;
    losses: number;
    pushes: number;
    wagered: number;
    payout: number;
    net: number;
};

export const GAME_STAT_KEYS: GameStatKey[] = [
    "raid",
    "dice",
    "roulette",
    "blackjack",
    "crash",
    "magicslots",
    "coinflip",
    "baccarat",
    "hilo",
    "keno"
];

function defaultGameStatEntry(): GameStatEntry {
    return {
        played: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        wagered: 0,
        payout: 0,
        net: 0
    };
}

function defaultGameStats(): Record<GameStatKey, GameStatEntry> {
    const stats = {} as Record<GameStatKey, GameStatEntry>;
    for (const key of GAME_STAT_KEYS) {
        stats[key] = defaultGameStatEntry();
    }
    return stats;
}

type PointsFileShape = {
    users: Record<string, UserState>;
};

const pointsFile = path.resolve(__dirname, "../src/data/points.json");
const pointsBackupFile = `${pointsFile}.bak`;
const pointsTempFile = `${pointsFile}.tmp`;
const anomalyLogFile = path.resolve(__dirname, "../src/data/anomalies.jsonl");
const TOKEN_SPIKE_THRESHOLD = Math.max(1, Number(process.env.TOKEN_SPIKE_THRESHOLD || 25000));
const XP_SPIKE_THRESHOLD = Math.max(1, Number(process.env.XP_SPIKE_THRESHOLD || 5000));
const ANOMALY_COOLDOWN_MS = Math.max(5000, Number(process.env.ANOMALY_COOLDOWN_MS || 60000));
const ANOMALY_RETENTION_MS = Math.max(60 * 60 * 1000, ANOMALY_COOLDOWN_MS * 8);
const anomalyLastLogged = new Map<string, number>();

function shouldLogAnomaly(key: string): boolean {
    const now = Date.now();
    for (const [entryKey, ts] of anomalyLastLogged.entries()) {
        if (now - ts > ANOMALY_RETENTION_MS) anomalyLastLogged.delete(entryKey);
    }
    const last = anomalyLastLogged.get(key) || 0;
    if (now - last < ANOMALY_COOLDOWN_MS) return false;
    anomalyLastLogged.set(key, now);
    return true;
}

function appendAnomalyEvent(type: string, payload: Record<string, unknown>): void {
    try {
        fs.ensureDirSync(path.dirname(anomalyLogFile));
        const line = JSON.stringify({ ts: new Date().toISOString(), type, ...payload });
        fs.appendFileSync(anomalyLogFile, `${line}\n`, "utf8");
    } catch {
        // Never crash state mutations over telemetry append failure.
    }
}

function defaultUserState(): UserState {
    return {
        modPoints: 0,
        xp: 0,
        rxp: 0,
        pmcXP: 0,
        pmcRaids: 0,
        pmcRaidWins: 0,
        pmcBossKills: 0,
        pmcPrestige: 0,
        lastXP: 0,
        prestige: 0,
        lastDaily: 0,
        dailyStreak: 0,
        achievements: [],
        bossHeartClaims: [],
        fnTokens: 50,
        bankTokens: 0,
        bankUpdatedAt: Date.now(),
        selectedCharacter: null,
        mapReputation: {},
        raidHistory: [],
        lastRaid: 0,
        inventory: {},
        gameStats: defaultGameStats()
    };
}

function parsePointsShape(raw: unknown): PointsFileShape | null {
    if (!raw || typeof raw !== "object") return null;

    const candidate = raw as Partial<PointsFileShape>;
    if (candidate.users && typeof candidate.users === "object") {
        return { users: candidate.users as Record<string, UserState> };
    }

    // Backward-compat: old format used top-level object as user map.
    return { users: raw as Record<string, UserState> };
}

function readPointsFileFrom(filePath: string): PointsFileShape | null {
    if (!fs.existsSync(filePath)) return null;
    try {
        const raw = fs.readJsonSync(filePath) as unknown;
        return parsePointsShape(raw);
    } catch {
        return null;
    }
}

function writePointsFileAtomic(data: PointsFileShape): void {
    fs.ensureDirSync(path.dirname(pointsFile));

    const pointsBackupV1File = `${pointsFile}.bak.1`;
    const pointsBackupV2File = `${pointsFile}.bak.2`;
    try {
        if (fs.existsSync(pointsBackupV1File)) fs.copyFileSync(pointsBackupV1File, pointsBackupV2File);
        if (fs.existsSync(pointsBackupFile)) fs.copyFileSync(pointsBackupFile, pointsBackupV1File);
    } catch {
        // Best effort backup chain rotation only.
    }

    if (fs.existsSync(pointsFile)) {
        fs.copyFileSync(pointsFile, pointsBackupFile);
    }

    fs.writeJsonSync(pointsTempFile, data, { spaces: 2 });
    fs.moveSync(pointsTempFile, pointsFile, { overwrite: true });

    // Keep backup in sync with the last known-good snapshot.
    fs.copyFileSync(pointsFile, pointsBackupFile);
}

function readPointsFile(): PointsFileShape {
    const seed: PointsFileShape = { users: {} };

    if (!fs.existsSync(pointsFile) && !fs.existsSync(pointsBackupFile)) {
        writePointsFileAtomic(seed);
        return seed;
    }

    const primary = readPointsFileFrom(pointsFile);
    if (primary) return primary;

    const backup = readPointsFileFrom(pointsBackupFile);
    if (backup) {
        // Self-heal if primary became truncated/corrupt.
        writePointsFileAtomic(backup);
        return backup;
    }

    writePointsFileAtomic(seed);
    return seed;
}

const store = readPointsFile();
export const points: Record<string, UserState> = store.users;

function shouldSkipPointsPersistence(): boolean {
    return process.env.RUNTIME_TEST_NO_POINTS_SAVE === "1";
}

export function savePoints(): void {
    // Runtime tests can disable disk writes to avoid polluting live JSON stores.
    if (shouldSkipPointsPersistence()) return;
    writePointsFileAtomic({ users: points });
}

export type XpPersistenceSnapshot = {
    userId: string;
    memoryXp: number;
    memoryLastXp: number;
    primaryXp: number | null;
    primaryLastXp: number | null;
    backupXp: number | null;
    backupLastXp: number | null;
    pointsFileExists: boolean;
    pointsBackupExists: boolean;
    pointsFileSize: number;
    pointsBackupSize: number;
};

export function getXpPersistenceSnapshot(userId: string): XpPersistenceSnapshot {
    const memory = points[userId];
    const primary = readPointsFileFrom(pointsFile);
    const backup = readPointsFileFrom(pointsBackupFile);

    const primaryUser = primary?.users?.[userId];
    const backupUser = backup?.users?.[userId];

    const pointsFileExists = fs.existsSync(pointsFile);
    const pointsBackupExists = fs.existsSync(pointsBackupFile);

    const pointsFileSize = pointsFileExists ? fs.statSync(pointsFile).size : 0;
    const pointsBackupSize = pointsBackupExists ? fs.statSync(pointsBackupFile).size : 0;

    return {
        userId,
        memoryXp: memory?.xp ?? 0,
        memoryLastXp: memory?.lastXP ?? 0,
        primaryXp: typeof primaryUser?.xp === "number" ? primaryUser.xp : null,
        primaryLastXp: typeof primaryUser?.lastXP === "number" ? primaryUser.lastXP : null,
        backupXp: typeof backupUser?.xp === "number" ? backupUser.xp : null,
        backupLastXp: typeof backupUser?.lastXP === "number" ? backupUser.lastXP : null,
        pointsFileExists,
        pointsBackupExists,
        pointsFileSize,
        pointsBackupSize
    };
}

export function ensureUser(userId: string): UserState {
    if (!points[userId]) {
        points[userId] = defaultUserState();
        savePoints();
    }

    // Backward compatibility for partially populated records.
    const user = points[userId] as Partial<UserState>;
    if (user.modPoints === undefined) user.modPoints = 0;
    if (user.xp === undefined) user.xp = 0;
    if (user.rxp === undefined) user.rxp = 0;
    if (user.pmcXP === undefined) user.pmcXP = user.rxp || 0;
    if (user.pmcRaids === undefined) user.pmcRaids = 0;
    if (user.pmcRaidWins === undefined) user.pmcRaidWins = 0;
    if (user.pmcBossKills === undefined) user.pmcBossKills = 0;
    if (user.pmcPrestige === undefined) user.pmcPrestige = 0;
    if (user.lastXP === undefined) user.lastXP = 0;
    if (user.prestige === undefined) user.prestige = 0;
    if (user.lastDaily === undefined) user.lastDaily = 0;
    if (user.dailyStreak === undefined) user.dailyStreak = 0;
    if (!Array.isArray(user.achievements)) user.achievements = [];
    if (!Array.isArray(user.bossHeartClaims)) user.bossHeartClaims = [];
    if (user.fnTokens === undefined) user.fnTokens = 50;
    if (user.bankTokens === undefined) user.bankTokens = 0;
    if (user.bankUpdatedAt === undefined) user.bankUpdatedAt = Date.now();
    if (user.selectedCharacter === undefined) user.selectedCharacter = null;
    if (!user.mapReputation || typeof user.mapReputation !== "object") user.mapReputation = {};
    if (!Array.isArray(user.raidHistory)) user.raidHistory = [];
    if (user.lastRaid === undefined) user.lastRaid = 0;
    if (!user.inventory || typeof user.inventory !== "object") user.inventory = {};
    if (!user.gameStats || typeof user.gameStats !== "object") user.gameStats = defaultGameStats();

    for (const key of GAME_STAT_KEYS) {
        const entry = user.gameStats[key] as Partial<GameStatEntry> | undefined;
        if (!entry || typeof entry !== "object") {
            user.gameStats[key] = defaultGameStatEntry();
            continue;
        }
        if (entry.played === undefined) entry.played = 0;
        if (entry.wins === undefined) entry.wins = 0;
        if (entry.losses === undefined) entry.losses = 0;
        if (entry.pushes === undefined) entry.pushes = 0;
        if (entry.wagered === undefined) entry.wagered = 0;
        if (entry.payout === undefined) entry.payout = 0;
        if (entry.net === undefined) entry.net = 0;
        user.gameStats[key] = entry as GameStatEntry;
    }

    points[userId] = user as UserState;
    return points[userId];
}

export function getMapReputationEntry(userId: string, mapKey: string): MapReputationEntry {
    const user = ensureUser(userId);
    const existing = user.mapReputation[mapKey] as Partial<MapReputationEntry> | undefined;
    const normalized: MapReputationEntry = {
        points: Math.max(0, Math.floor(existing?.points || 0)),
        raids: Math.max(0, Math.floor(existing?.raids || 0)),
        extracts: Math.max(0, Math.floor(existing?.extracts || 0)),
        bossEncounters: Math.max(0, Math.floor(existing?.bossEncounters || 0)),
        bossKills: Math.max(0, Math.floor(existing?.bossKills || 0)),
        lastRaidAt: Math.max(0, Math.floor(existing?.lastRaidAt || 0))
    };
    user.mapReputation[mapKey] = normalized;
    return normalized;
}

export function recordMapReputation(input: {
    userId: string;
    mapKey: string;
    points: number;
    success: boolean;
    bossSpawned: boolean;
    bossDefeated: boolean;
    timestamp: number;
}): { beforePoints: number; entry: MapReputationEntry } {
    const entry = getMapReputationEntry(input.userId, input.mapKey);
    const beforePoints = entry.points;
    entry.points += Math.max(0, Math.floor(input.points || 0));
    entry.raids += 1;
    if (input.success) entry.extracts += 1;
    if (input.bossSpawned) entry.bossEncounters += 1;
    if (input.bossDefeated) entry.bossKills += 1;
    entry.lastRaidAt = Math.max(entry.lastRaidAt, Math.floor(input.timestamp || 0));
    return { beforePoints, entry };
}

export function getPoints(userId: string): number {
    return ensureUser(userId).modPoints;
}

export function addPoints(userId: string, amount: number): number {
    const user = ensureUser(userId);
    user.modPoints += Math.max(0, Math.floor(amount));
    savePoints();
    return user.modPoints;
}

export function getTokens(userId: string): number {
    return ensureUser(userId).fnTokens;
}

export function getBankTokens(userId: string): number {
    return ensureUser(userId).bankTokens;
}

export function canAffordTokens(userId: string, amount: number): boolean {
    return getTokens(userId) >= Math.max(0, Math.floor(amount));
}

export function addTokens(userId: string, amount: number): number {
    const user = ensureUser(userId);
    const delta = Math.max(0, Math.floor(amount));
    user.fnTokens += delta;

    if (delta >= TOKEN_SPIKE_THRESHOLD && shouldLogAnomaly(`token_spike:${userId}`)) {
        appendAnomalyEvent("token_spike", {
            userId,
            delta,
            threshold: TOKEN_SPIKE_THRESHOLD,
            walletAfter: user.fnTokens
        });
    }

    savePoints();
    return user.fnTokens;
}

export function removeTokens(userId: string, amount: number): number {
    const user = ensureUser(userId);
    user.fnTokens = Math.max(0, user.fnTokens - Math.max(0, Math.floor(amount)));
    savePoints();
    return user.fnTokens;
}

export function depositToBank(userId: string, amount: number): { wallet: number; bank: number } {
    const user = ensureUser(userId);
    const value = Math.max(0, Math.floor(amount));
    const move = Math.min(user.fnTokens, value);
    user.fnTokens -= move;
    user.bankTokens += move;
    user.bankUpdatedAt = Date.now();
    savePoints();
    return { wallet: user.fnTokens, bank: user.bankTokens };
}

export function withdrawFromBank(userId: string, amount: number): { wallet: number; bank: number } {
    const user = ensureUser(userId);
    const value = Math.max(0, Math.floor(amount));
    const move = Math.min(user.bankTokens, value);
    user.bankTokens -= move;
    user.fnTokens += move;
    user.bankUpdatedAt = Date.now();
    savePoints();
    return { wallet: user.fnTokens, bank: user.bankTokens };
}

export function transferWalletTokens(fromUserId: string, toUserId: string, amount: number): { fromWallet: number; toWallet: number; moved: number } {
    const from = ensureUser(fromUserId);
    const to = ensureUser(toUserId);
    const value = Math.max(0, Math.floor(amount));
    const moved = Math.min(from.fnTokens, value);
    from.fnTokens -= moved;
    to.fnTokens += moved;

    if (moved >= TOKEN_SPIKE_THRESHOLD && shouldLogAnomaly(`large_transfer:${fromUserId}:${toUserId}`)) {
        appendAnomalyEvent("large_wallet_transfer", {
            fromUserId,
            toUserId,
            moved,
            threshold: TOKEN_SPIKE_THRESHOLD,
            fromWalletAfter: from.fnTokens,
            toWalletAfter: to.fnTokens
        });
    }

    savePoints();
    return { fromWallet: from.fnTokens, toWallet: to.fnTokens, moved };
}

export function addXP(userId: string, amount: number): number {
    const delta = Math.max(0, Math.floor(amount));
    if (!delta) return ensureUser(userId).xp;

    const user = ensureUser(userId);

    // Read the latest on-disk snapshot to avoid stale in-memory overwrites after restarts
    // or overlapping process runs. XP should only ever move forward here.
    const diskState = readPointsFileFrom(pointsFile) || readPointsFileFrom(pointsBackupFile);
    const diskUser = diskState?.users?.[userId];
    const currentXp = Math.max(user.xp, diskUser?.xp ?? 0);

    user.xp = currentXp + delta;
    user.lastXP = Date.now();

    if (delta >= XP_SPIKE_THRESHOLD && shouldLogAnomaly(`xp_spike:${userId}`)) {
        appendAnomalyEvent("xp_spike", {
            userId,
            delta,
            threshold: XP_SPIKE_THRESHOLD,
            xpBefore: currentXp,
            xpAfter: user.xp
        });
    }

    // Keep in-memory user XP monotonic in case another caller still holds an older object reference.
    points[userId].xp = Math.max(points[userId].xp, user.xp);
    points[userId].lastXP = Math.max(points[userId].lastXP, user.lastXP);

    savePoints();
    return user.xp;
}

export const XP_LEVEL_THRESHOLDS = [
    120000,
    240000,
    360000,
    480000,
    600000,
    720000,
    840000,
    960000,
    1080000,
    1200000,
    1320000,
    1440000,
    1560000,
    1680000,
    1800000,
    1920000,
    2040000,
    2160000,
    2280000,
    2400000,
    2520000,
    2640000,
    2760000,
    2880000,
    3000000
] as const;

export function getXPLevel(xp: number): number {
    for (let i = XP_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
        if (xp >= XP_LEVEL_THRESHOLDS[i]) return i + 1;
    }
    return 0;
}

export function formatProgressPercent(ratio: number): string {
    const pct = Math.max(0, Math.min(100, ratio * 100));
    if (pct === 0 || pct === 100) return `${Math.round(pct)}%`;
    if (pct < 1) return `${pct.toFixed(2)}%`;
    if (pct < 10) return `${pct.toFixed(1)}%`;
    return `${Math.round(pct)}%`;
}

export function xpBar(xp: number): string {
    const level = getXPLevel(xp);
    const thresholds = [0, ...XP_LEVEL_THRESHOLDS];
    const current = thresholds[level] ?? thresholds[thresholds.length - 1];
    const next = thresholds[level + 1] ?? current;
    const denom = Math.max(1, next - current);
    const ratio = level >= XP_LEVEL_THRESHOLDS.length
        ? 1
        : Math.max(0, Math.min(1, (xp - current) / denom));
    const width = 14;
    const filled = ratio > 0 && ratio < 1
        ? Math.max(1, Math.round(ratio * width))
        : Math.round(ratio * width);
    const solidGreen = "🟩".repeat(filled);
    const emptySlots = "⬜".repeat(width - filled);
    return `${solidGreen}${emptySlots} ${formatProgressPercent(ratio)}`;
}

export const PMC_LEVEL_CAP = 50000;
export const PMC_PRESTIGE_LEVEL_REQUIREMENT = 20000;
export const PMC_PRESTIGE_CAP = 10;

export type PmcTierMilestone = {
    level: number;
    badge: string;
    label: string;
    bonusScalar: number;
};

export const PMC_TIER_MILESTONES: PmcTierMilestone[] = [
    { level: 1000, badge: "🛡️", label: "Iron Vanguard", bonusScalar: 0.004 },
    { level: 4000, badge: "⚔️", label: "Steel Warlord", bonusScalar: 0.009 },
    { level: 8000, badge: "👑", label: "Apex Sovereign", bonusScalar: 0.015 },
    { level: 12000, badge: "🔥", label: "Cataclysm Marshal", bonusScalar: 0.023 },
    { level: 20000, badge: "🌌", label: "Mythic Overlord", bonusScalar: 0.034 },
    { level: 25000, badge: "🌀", label: "Void Commander", bonusScalar: 0.039 },
    { level: 30000, badge: "💠", label: "Rift General", bonusScalar: 0.044 },
    { level: 35000, badge: "🗿", label: "Eternal Warden", bonusScalar: 0.049 },
    { level: 40000, badge: "☄️", label: "Astral Conqueror", bonusScalar: 0.054 },
    { level: 45000, badge: "🔱", label: "Paragon Prime", bonusScalar: 0.059 },
    { level: 50000, badge: "✨", label: "Ascendant Legend", bonusScalar: 0.064 }
];

export type PmcPrestigeTier = {
    rank: number;
    numeral: string;
    label: string;
    badge: string;
};

export const PMC_PRESTIGE_TIERS: PmcPrestigeTier[] = [
    { rank: 0, numeral: "0", label: "Unprestiged", badge: "🪖" },
    { rank: 1, numeral: "I", label: "Veteran", badge: "🎖️" },
    { rank: 2, numeral: "II", label: "Elite Veteran", badge: "⚔️" },
    { rank: 3, numeral: "III", label: "Vanguard", badge: "🛡️" },
    { rank: 4, numeral: "IV", label: "Warlord", badge: "🔥" },
    { rank: 5, numeral: "V", label: "Mythic", badge: "💎" },
    { rank: 6, numeral: "VI", label: "Voidforged", badge: "🌀" },
    { rank: 7, numeral: "VII", label: "Star Marshal", badge: "☄️" },
    { rank: 8, numeral: "VIII", label: "Eternal", badge: "🌠" },
    { rank: 9, numeral: "IX", label: "Transcendent", badge: "🔱" },
    { rank: 10, numeral: "X", label: "Celestial", badge: "🌌" }
];

export function getPmcPrestigeTier(prestige: number): PmcPrestigeTier {
    const rank = Math.max(0, Math.min(PMC_PRESTIGE_CAP, Math.floor(prestige || 0)));
    return PMC_PRESTIGE_TIERS[rank] || PMC_PRESTIGE_TIERS[0];
}

export function getPmcPrestigeBonuses(prestige: number): {
    successBonus: number;
    tokenBonus: number;
    defenseBonus: number;
    xpBonus: number;
} {
    const rank = getPmcPrestigeTier(prestige).rank;
    return {
        successBonus: rank * 0.0015,
        tokenBonus: rank * 0.003,
        defenseBonus: rank * 0.002,
        xpBonus: rank * 0.015
    };
}

export const PMC_LEVEL_THRESHOLDS: number[] = (() => {
    const thresholds: number[] = [];
    let total = 0;
    for (let level = 1; level <= PMC_LEVEL_CAP; level++) {
        const scaledCore = 200 + Math.floor(level * 7.5) + Math.floor(Math.pow(level, 1.25) * 1.85);
        const tierPressure =
            (level > 1000 ? 900 + Math.floor(Math.pow(level - 1000, 1.08) * 2.8) : 0)
            + (level > 4000 ? 1800 + Math.floor(Math.pow(level - 4000, 1.14) * 3.9) : 0)
            + (level > 8000 ? 4200 + Math.floor(Math.pow(level - 8000, 1.22) * 6.6) : 0)
            + (level > 12000 ? 7000 + Math.floor(Math.pow(level - 12000, 1.28) * 8.2) : 0);
        const overlevel = Math.max(0, level - PMC_PRESTIGE_LEVEL_REQUIREMENT);
        const requirement = overlevel > 0
            ? 250000 + (overlevel * 25)
            : scaledCore + tierPressure;
        total += requirement;
        thresholds.push(total);
    }
    return thresholds;
})();

export function getPmcTierForLevel(level: number): PmcTierMilestone | null {
    const lv = Math.max(0, Math.floor(level));
    let current: PmcTierMilestone | null = null;
    for (const tier of PMC_TIER_MILESTONES) {
        if (lv >= tier.level) current = tier;
        else break;
    }
    return current;
}

export function getPmcLevel(pmcXP: number): number {
    const value = Math.max(0, Math.floor(pmcXP));
    for (let i = PMC_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
        if (value >= PMC_LEVEL_THRESHOLDS[i]) return i + 1;
    }
    return 0;
}

export function getPmcProgress(pmcXP: number): {
    level: number;
    capped: boolean;
    currentThreshold: number;
    nextThreshold: number;
    progressPct: number;
    intoLevel: number;
    needForNext: number;
} {
    const xp = Math.max(0, Math.floor(pmcXP));
    const level = getPmcLevel(xp);
    const capped = level >= PMC_LEVEL_CAP;
    const currentThreshold = level <= 0 ? 0 : PMC_LEVEL_THRESHOLDS[level - 1] || 0;
    const nextThreshold = capped ? currentThreshold : (PMC_LEVEL_THRESHOLDS[level] || currentThreshold);
    const span = Math.max(1, nextThreshold - currentThreshold);
    const intoLevel = capped ? 0 : Math.max(0, xp - currentThreshold);
    const needForNext = capped ? 0 : Math.max(0, nextThreshold - xp);
    const progressPct = capped ? 100 : Math.round(Math.max(0, Math.min(1, intoLevel / span)) * 100);

    return {
        level,
        capped,
        currentThreshold,
        nextThreshold,
        progressPct,
        intoLevel,
        needForNext
    };
}

export function pmcBar(pmcXP: number): string {
    const p = getPmcProgress(pmcXP);
    const width = 16;
    const filled = p.capped ? width : Math.round((p.progressPct / 100) * width);
    const solid = "🟩".repeat(filled);
    const open = "⬛".repeat(Math.max(0, width - filled));
    return `${solid}${open} ${p.progressPct}%`;
}

export function getPmcBuffs(level: number, prestige = 0): {
    successBonus: number;
    tokenBonus: number;
    defenseBonus: number;
    xpBonus: number;
} {
    const lv = Math.max(0, Math.min(PMC_LEVEL_CAP, Math.floor(level)));
    const progress = Math.max(0, Math.min(1, lv / PMC_PRESTIGE_LEVEL_REQUIREMENT));
    const progressionScale = Math.pow(progress, 0.74);
    const tier = getPmcTierForLevel(lv);
    const tierBonus = tier?.bonusScalar || 0;
    const prestigeBonuses = getPmcPrestigeBonuses(prestige);

    return {
        successBonus: Math.min(0.15, (0.052 * progressionScale) + tierBonus + prestigeBonuses.successBonus),
        tokenBonus: Math.min(0.15, (0.044 * progressionScale) + (tierBonus * 0.9) + prestigeBonuses.tokenBonus),
        defenseBonus: Math.min(0.125, (0.04 * progressionScale) + (tierBonus * 0.85) + prestigeBonuses.defenseBonus),
        xpBonus: Math.min(0.3, (0.048 * progressionScale) + (tierBonus * 0.75) + prestigeBonuses.xpBonus)
    };
}

export function getPmcBuffsForXP(pmcXP: number, prestige = 0) {
    return getPmcBuffs(getPmcLevel(pmcXP), prestige);
}

export function performPmcPrestige(userId: string): { error?: string; prestige?: number; tier?: PmcPrestigeTier } {
    const user = ensureUser(userId);
    const currentPrestige = Math.max(0, Math.floor(user.pmcPrestige || 0));
    if (currentPrestige >= PMC_PRESTIGE_CAP) return { error: "Maximum PMC Prestige X has already been achieved." };
    if (getPmcLevel(user.pmcXP) < PMC_PRESTIGE_LEVEL_REQUIREMENT) {
        return { error: `PMC Level ${PMC_PRESTIGE_LEVEL_REQUIREMENT.toLocaleString()} is required to prestige.` };
    }

    user.pmcPrestige = currentPrestige + 1;
    user.pmcXP = 0;
    user.rxp = 0;
    const tier = getPmcPrestigeTier(user.pmcPrestige);
    user.achievements.push(`${tier.badge} PMC Prestige ${tier.numeral}: ${tier.label}`);
    savePoints();
    return { prestige: user.pmcPrestige, tier };
}

export function getRandomInt(min: number, max: number): number {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export function getInventoryCount(userId: string, itemId: string): number {
    const user = ensureUser(userId);
    return user.inventory[itemId] || 0;
}

export function addInventoryItem(userId: string, itemId: string, qty: number): number {
    const user = ensureUser(userId);
    user.inventory[itemId] = (user.inventory[itemId] || 0) + Math.max(0, Math.floor(qty));
    savePoints();
    return user.inventory[itemId];
}

export function removeInventoryItem(userId: string, itemId: string, qty: number): number {
    const user = ensureUser(userId);
    const next = (user.inventory[itemId] || 0) - Math.max(0, Math.floor(qty));
    if (next <= 0) {
        delete user.inventory[itemId];
        savePoints();
        return 0;
    }

    user.inventory[itemId] = next;
    savePoints();
    return next;
}

export function recordGameResult(
    userId: string,
    game: GameStatKey,
    outcome: "win" | "loss" | "push",
    bet: number,
    payout: number
): GameStatEntry {
    const user = ensureUser(userId);
    const entry = user.gameStats[game] || defaultGameStatEntry();
    entry.played += 1;
    if (outcome === "win") entry.wins += 1;
    else if (outcome === "loss") entry.losses += 1;
    else entry.pushes += 1;

    const cleanBet = Math.max(0, Math.floor(bet));
    const cleanPayout = Math.max(0, Math.floor(payout));
    entry.wagered += cleanBet;
    entry.payout += cleanPayout;
    entry.net += cleanPayout - cleanBet;
    user.gameStats[game] = entry;
    savePoints();
    return entry;
}

export function getGameStatsSummary(userId: string): {
    totalPlayed: number;
    wins: number;
    losses: number;
    pushes: number;
    wagered: number;
    payout: number;
    net: number;
    raid: GameStatEntry;
    casinoPlayed: number;
} {
    const user = ensureUser(userId);
    const raid = user.gameStats.raid || defaultGameStatEntry();
    let totalPlayed = 0;
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let wagered = 0;
    let payout = 0;
    let net = 0;
    let casinoPlayed = 0;

    for (const key of GAME_STAT_KEYS) {
        const entry = user.gameStats[key] || defaultGameStatEntry();
        totalPlayed += entry.played;
        wins += entry.wins;
        losses += entry.losses;
        pushes += entry.pushes;
        wagered += entry.wagered;
        payout += entry.payout;
        net += entry.net;
        if (key !== "raid") casinoPlayed += entry.played;
    }

    return { totalPlayed, wins, losses, pushes, wagered, payout, net, raid, casinoPlayed };
}