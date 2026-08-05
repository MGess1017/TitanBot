"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PMC_LEVEL_THRESHOLDS = exports.PMC_TIER_MILESTONES = exports.PMC_LEVEL_CAP = exports.XP_LEVEL_THRESHOLDS = exports.points = exports.GAME_STAT_KEYS = void 0;
exports.savePoints = savePoints;
exports.getXpPersistenceSnapshot = getXpPersistenceSnapshot;
exports.ensureUser = ensureUser;
exports.getPoints = getPoints;
exports.addPoints = addPoints;
exports.getTokens = getTokens;
exports.getBankTokens = getBankTokens;
exports.canAffordTokens = canAffordTokens;
exports.addTokens = addTokens;
exports.removeTokens = removeTokens;
exports.depositToBank = depositToBank;
exports.withdrawFromBank = withdrawFromBank;
exports.transferWalletTokens = transferWalletTokens;
exports.addXP = addXP;
exports.getXPLevel = getXPLevel;
exports.xpBar = xpBar;
exports.getPmcTierForLevel = getPmcTierForLevel;
exports.getPmcLevel = getPmcLevel;
exports.getPmcProgress = getPmcProgress;
exports.pmcBar = pmcBar;
exports.getPmcBuffs = getPmcBuffs;
exports.getPmcBuffsForXP = getPmcBuffsForXP;
exports.getRandomInt = getRandomInt;
exports.getInventoryCount = getInventoryCount;
exports.addInventoryItem = addInventoryItem;
exports.removeInventoryItem = removeInventoryItem;
exports.recordGameResult = recordGameResult;
exports.getGameStatsSummary = getGameStatsSummary;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
exports.GAME_STAT_KEYS = [
    "raid",
    "dice",
    "roulette",
    "blackjack",
    "crash",
    "slots",
    "coinflip",
    "baccarat",
    "hilo",
    "keno"
];
function defaultGameStatEntry() {
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
function defaultGameStats() {
    const stats = {};
    for (const key of exports.GAME_STAT_KEYS) {
        stats[key] = defaultGameStatEntry();
    }
    return stats;
}
const pointsFile = path_1.default.resolve(__dirname, "../src/data/points.json");
const pointsBackupFile = `${pointsFile}.bak`;
const pointsTempFile = `${pointsFile}.tmp`;
const anomalyLogFile = path_1.default.resolve(__dirname, "../src/data/anomalies.jsonl");
const TOKEN_SPIKE_THRESHOLD = Math.max(1, Number(process.env.TOKEN_SPIKE_THRESHOLD || 25000));
const XP_SPIKE_THRESHOLD = Math.max(1, Number(process.env.XP_SPIKE_THRESHOLD || 5000));
const ANOMALY_COOLDOWN_MS = Math.max(5000, Number(process.env.ANOMALY_COOLDOWN_MS || 60000));
const anomalyLastLogged = new Map();
function shouldLogAnomaly(key) {
    const now = Date.now();
    const last = anomalyLastLogged.get(key) || 0;
    if (now - last < ANOMALY_COOLDOWN_MS)
        return false;
    anomalyLastLogged.set(key, now);
    return true;
}
function appendAnomalyEvent(type, payload) {
    try {
        fs_extra_1.default.ensureDirSync(path_1.default.dirname(anomalyLogFile));
        const line = JSON.stringify({ ts: new Date().toISOString(), type, ...payload });
        fs_extra_1.default.appendFileSync(anomalyLogFile, `${line}\n`, "utf8");
    }
    catch {
        // Never crash state mutations over telemetry append failure.
    }
}
function defaultUserState() {
    return {
        modPoints: 0,
        xp: 0,
        rxp: 0,
        pmcXP: 0,
        pmcRaids: 0,
        pmcRaidWins: 0,
        pmcBossKills: 0,
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
        raidHistory: [],
        lastRaid: 0,
        inventory: {},
        gameStats: defaultGameStats()
    };
}
function parsePointsShape(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const candidate = raw;
    if (candidate.users && typeof candidate.users === "object") {
        return { users: candidate.users };
    }
    // Backward-compat: old format used top-level object as user map.
    return { users: raw };
}
function readPointsFileFrom(filePath) {
    if (!fs_extra_1.default.existsSync(filePath))
        return null;
    try {
        const raw = fs_extra_1.default.readJsonSync(filePath);
        return parsePointsShape(raw);
    }
    catch {
        return null;
    }
}
function writePointsFileAtomic(data) {
    fs_extra_1.default.ensureDirSync(path_1.default.dirname(pointsFile));
    const pointsBackupV1File = `${pointsFile}.bak.1`;
    const pointsBackupV2File = `${pointsFile}.bak.2`;
    try {
        if (fs_extra_1.default.existsSync(pointsBackupV1File))
            fs_extra_1.default.copyFileSync(pointsBackupV1File, pointsBackupV2File);
        if (fs_extra_1.default.existsSync(pointsBackupFile))
            fs_extra_1.default.copyFileSync(pointsBackupFile, pointsBackupV1File);
    }
    catch {
        // Best effort backup chain rotation only.
    }
    if (fs_extra_1.default.existsSync(pointsFile)) {
        fs_extra_1.default.copyFileSync(pointsFile, pointsBackupFile);
    }
    fs_extra_1.default.writeJsonSync(pointsTempFile, data, { spaces: 2 });
    fs_extra_1.default.moveSync(pointsTempFile, pointsFile, { overwrite: true });
    // Keep backup in sync with the last known-good snapshot.
    fs_extra_1.default.copyFileSync(pointsFile, pointsBackupFile);
}
function readPointsFile() {
    const seed = { users: {} };
    if (!fs_extra_1.default.existsSync(pointsFile) && !fs_extra_1.default.existsSync(pointsBackupFile)) {
        writePointsFileAtomic(seed);
        return seed;
    }
    const primary = readPointsFileFrom(pointsFile);
    if (primary)
        return primary;
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
exports.points = store.users;
function savePoints() {
    writePointsFileAtomic({ users: exports.points });
}
function getXpPersistenceSnapshot(userId) {
    const memory = exports.points[userId];
    const primary = readPointsFileFrom(pointsFile);
    const backup = readPointsFileFrom(pointsBackupFile);
    const primaryUser = primary?.users?.[userId];
    const backupUser = backup?.users?.[userId];
    const pointsFileExists = fs_extra_1.default.existsSync(pointsFile);
    const pointsBackupExists = fs_extra_1.default.existsSync(pointsBackupFile);
    const pointsFileSize = pointsFileExists ? fs_extra_1.default.statSync(pointsFile).size : 0;
    const pointsBackupSize = pointsBackupExists ? fs_extra_1.default.statSync(pointsBackupFile).size : 0;
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
function ensureUser(userId) {
    if (!exports.points[userId]) {
        exports.points[userId] = defaultUserState();
        savePoints();
    }
    // Backward compatibility for partially populated records.
    const user = exports.points[userId];
    if (user.modPoints === undefined)
        user.modPoints = 0;
    if (user.xp === undefined)
        user.xp = 0;
    if (user.rxp === undefined)
        user.rxp = 0;
    if (user.pmcXP === undefined)
        user.pmcXP = user.rxp || 0;
    if (user.pmcRaids === undefined)
        user.pmcRaids = 0;
    if (user.pmcRaidWins === undefined)
        user.pmcRaidWins = 0;
    if (user.pmcBossKills === undefined)
        user.pmcBossKills = 0;
    if (user.lastXP === undefined)
        user.lastXP = 0;
    if (user.prestige === undefined)
        user.prestige = 0;
    if (user.lastDaily === undefined)
        user.lastDaily = 0;
    if (user.dailyStreak === undefined)
        user.dailyStreak = 0;
    if (!Array.isArray(user.achievements))
        user.achievements = [];
    if (!Array.isArray(user.bossHeartClaims))
        user.bossHeartClaims = [];
    if (user.fnTokens === undefined)
        user.fnTokens = 50;
    if (user.bankTokens === undefined)
        user.bankTokens = 0;
    if (user.bankUpdatedAt === undefined)
        user.bankUpdatedAt = Date.now();
    if (user.selectedCharacter === undefined)
        user.selectedCharacter = null;
    if (!Array.isArray(user.raidHistory))
        user.raidHistory = [];
    if (user.lastRaid === undefined)
        user.lastRaid = 0;
    if (!user.inventory || typeof user.inventory !== "object")
        user.inventory = {};
    if (!user.gameStats || typeof user.gameStats !== "object")
        user.gameStats = defaultGameStats();
    for (const key of exports.GAME_STAT_KEYS) {
        const entry = user.gameStats[key];
        if (!entry || typeof entry !== "object") {
            user.gameStats[key] = defaultGameStatEntry();
            continue;
        }
        if (entry.played === undefined)
            entry.played = 0;
        if (entry.wins === undefined)
            entry.wins = 0;
        if (entry.losses === undefined)
            entry.losses = 0;
        if (entry.pushes === undefined)
            entry.pushes = 0;
        if (entry.wagered === undefined)
            entry.wagered = 0;
        if (entry.payout === undefined)
            entry.payout = 0;
        if (entry.net === undefined)
            entry.net = 0;
        user.gameStats[key] = entry;
    }
    exports.points[userId] = user;
    return exports.points[userId];
}
function getPoints(userId) {
    return ensureUser(userId).modPoints;
}
function addPoints(userId, amount) {
    const user = ensureUser(userId);
    user.modPoints += Math.max(0, Math.floor(amount));
    savePoints();
    return user.modPoints;
}
function getTokens(userId) {
    return ensureUser(userId).fnTokens;
}
function getBankTokens(userId) {
    return ensureUser(userId).bankTokens;
}
function canAffordTokens(userId, amount) {
    return getTokens(userId) >= Math.max(0, Math.floor(amount));
}
function addTokens(userId, amount) {
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
function removeTokens(userId, amount) {
    const user = ensureUser(userId);
    user.fnTokens = Math.max(0, user.fnTokens - Math.max(0, Math.floor(amount)));
    savePoints();
    return user.fnTokens;
}
function depositToBank(userId, amount) {
    const user = ensureUser(userId);
    const value = Math.max(0, Math.floor(amount));
    const move = Math.min(user.fnTokens, value);
    user.fnTokens -= move;
    user.bankTokens += move;
    user.bankUpdatedAt = Date.now();
    savePoints();
    return { wallet: user.fnTokens, bank: user.bankTokens };
}
function withdrawFromBank(userId, amount) {
    const user = ensureUser(userId);
    const value = Math.max(0, Math.floor(amount));
    const move = Math.min(user.bankTokens, value);
    user.bankTokens -= move;
    user.fnTokens += move;
    user.bankUpdatedAt = Date.now();
    savePoints();
    return { wallet: user.fnTokens, bank: user.bankTokens };
}
function transferWalletTokens(fromUserId, toUserId, amount) {
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
function addXP(userId, amount) {
    const delta = Math.max(0, Math.floor(amount));
    if (!delta)
        return ensureUser(userId).xp;
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
    exports.points[userId].xp = Math.max(exports.points[userId].xp, user.xp);
    exports.points[userId].lastXP = Math.max(exports.points[userId].lastXP, user.lastXP);
    savePoints();
    return user.xp;
}
exports.XP_LEVEL_THRESHOLDS = [
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
];
function getXPLevel(xp) {
    for (let i = exports.XP_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
        if (xp >= exports.XP_LEVEL_THRESHOLDS[i])
            return i + 1;
    }
    return 0;
}
function xpBar(xp) {
    const level = getXPLevel(xp);
    const thresholds = [0, ...exports.XP_LEVEL_THRESHOLDS];
    const current = thresholds[level] ?? thresholds[thresholds.length - 1];
    const next = thresholds[level + 1] ?? current;
    const denom = Math.max(1, next - current);
    const ratio = level >= exports.XP_LEVEL_THRESHOLDS.length
        ? 1
        : Math.max(0, Math.min(1, (xp - current) / denom));
    const width = 14;
    const filled = Math.round(ratio * width);
    const solidGreen = "🟩".repeat(filled);
    const softGreen = "🟢".repeat(width - filled);
    return `${solidGreen}${softGreen} ${Math.round(ratio * 100)}%`;
}
exports.PMC_LEVEL_CAP = 20000;
exports.PMC_TIER_MILESTONES = [
    { level: 1000, badge: "🛡️", label: "Iron Vanguard", bonusScalar: 0.004 },
    { level: 4000, badge: "⚔️", label: "Steel Warlord", bonusScalar: 0.009 },
    { level: 8000, badge: "👑", label: "Apex Sovereign", bonusScalar: 0.015 },
    { level: 12000, badge: "🔥", label: "Cataclysm Marshal", bonusScalar: 0.023 },
    { level: 20000, badge: "🌌", label: "Mythic Overlord", bonusScalar: 0.034 }
];
exports.PMC_LEVEL_THRESHOLDS = (() => {
    const thresholds = [];
    let total = 0;
    for (let level = 1; level <= exports.PMC_LEVEL_CAP; level++) {
        const scaledCore = 200 + Math.floor(level * 7.5) + Math.floor(Math.pow(level, 1.25) * 1.85);
        const tierPressure = (level > 1000 ? 900 + Math.floor(Math.pow(level - 1000, 1.08) * 2.8) : 0)
            + (level > 4000 ? 1800 + Math.floor(Math.pow(level - 4000, 1.14) * 3.9) : 0)
            + (level > 8000 ? 4200 + Math.floor(Math.pow(level - 8000, 1.22) * 6.6) : 0)
            + (level > 12000 ? 7000 + Math.floor(Math.pow(level - 12000, 1.28) * 8.2) : 0);
        const requirement = scaledCore + tierPressure;
        total += requirement;
        thresholds.push(total);
    }
    return thresholds;
})();
function getPmcTierForLevel(level) {
    const lv = Math.max(0, Math.floor(level));
    let current = null;
    for (const tier of exports.PMC_TIER_MILESTONES) {
        if (lv >= tier.level)
            current = tier;
        else
            break;
    }
    return current;
}
function getPmcLevel(pmcXP) {
    const value = Math.max(0, Math.floor(pmcXP));
    for (let i = exports.PMC_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
        if (value >= exports.PMC_LEVEL_THRESHOLDS[i])
            return i + 1;
    }
    return 0;
}
function getPmcProgress(pmcXP) {
    const xp = Math.max(0, Math.floor(pmcXP));
    const level = getPmcLevel(xp);
    const capped = level >= exports.PMC_LEVEL_CAP;
    const currentThreshold = level <= 0 ? 0 : exports.PMC_LEVEL_THRESHOLDS[level - 1] || 0;
    const nextThreshold = capped ? currentThreshold : (exports.PMC_LEVEL_THRESHOLDS[level] || currentThreshold);
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
function pmcBar(pmcXP) {
    const p = getPmcProgress(pmcXP);
    const width = 16;
    const filled = p.capped ? width : Math.round((p.progressPct / 100) * width);
    const solid = "🟩".repeat(filled);
    const open = "⬛".repeat(Math.max(0, width - filled));
    return `${solid}${open} ${p.progressPct}%`;
}
function getPmcBuffs(level) {
    const lv = Math.max(0, Math.min(exports.PMC_LEVEL_CAP, Math.floor(level)));
    const progress = Math.max(0, Math.min(1, lv / exports.PMC_LEVEL_CAP));
    const progressionScale = Math.pow(progress, 0.74);
    const tier = getPmcTierForLevel(lv);
    const tierBonus = tier?.bonusScalar || 0;
    return {
        // Buffs stay moderate but meaningful across long progression.
        successBonus: Math.min(0.13, (0.052 * progressionScale) + tierBonus),
        tokenBonus: Math.min(0.11, (0.044 * progressionScale) + (tierBonus * 0.9)),
        defenseBonus: Math.min(0.095, (0.04 * progressionScale) + (tierBonus * 0.85)),
        xpBonus: Math.min(0.12, (0.048 * progressionScale) + (tierBonus * 0.75))
    };
}
function getPmcBuffsForXP(pmcXP) {
    return getPmcBuffs(getPmcLevel(pmcXP));
}
function getRandomInt(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}
function getInventoryCount(userId, itemId) {
    const user = ensureUser(userId);
    return user.inventory[itemId] || 0;
}
function addInventoryItem(userId, itemId, qty) {
    const user = ensureUser(userId);
    user.inventory[itemId] = (user.inventory[itemId] || 0) + Math.max(0, Math.floor(qty));
    savePoints();
    return user.inventory[itemId];
}
function removeInventoryItem(userId, itemId, qty) {
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
function recordGameResult(userId, game, outcome, bet, payout) {
    const user = ensureUser(userId);
    const entry = user.gameStats[game] || defaultGameStatEntry();
    entry.played += 1;
    if (outcome === "win")
        entry.wins += 1;
    else if (outcome === "loss")
        entry.losses += 1;
    else
        entry.pushes += 1;
    const cleanBet = Math.max(0, Math.floor(bet));
    const cleanPayout = Math.max(0, Math.floor(payout));
    entry.wagered += cleanBet;
    entry.payout += cleanPayout;
    entry.net += cleanPayout - cleanBet;
    user.gameStats[game] = entry;
    savePoints();
    return entry;
}
function getGameStatsSummary(userId) {
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
    for (const key of exports.GAME_STAT_KEYS) {
        const entry = user.gameStats[key] || defaultGameStatEntry();
        totalPlayed += entry.played;
        wins += entry.wins;
        losses += entry.losses;
        pushes += entry.pushes;
        wagered += entry.wagered;
        payout += entry.payout;
        net += entry.net;
        if (key !== "raid")
            casinoPlayed += entry.played;
    }
    return { totalPlayed, wins, losses, pushes, wagered, payout, net, raid, casinoPlayed };
}
