"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBossHeartDefinition = getBossHeartDefinition;
exports.syncBossHeartClaims = syncBossHeartClaims;
exports.awardBossHeartAchievement = awardBossHeartAchievement;
exports.getBossHeartUnlockCount = getBossHeartUnlockCount;
exports.getUnlockedBossHeartNames = getUnlockedBossHeartNames;
const utils_1 = require("../utils");
const catalog_1 = require("./catalog");
function normalizeBossName(raw) {
    if (!raw)
        return "";
    return raw
        .replace(/\s*\([^)]*\)\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function normalizeKey(raw) {
    return normalizeBossName(raw).toLowerCase();
}
function slugifyBossName(raw) {
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}
function buildDynamicHeartDefinition(bossName) {
    const normalized = normalizeBossName(bossName);
    const slug = slugifyBossName(normalized) || "unknown";
    return {
        id: `heart_dynamic_${slug}`,
        name: `${normalized}'s Heart`,
        desc: `Permanent achievement trophy for first defeating ${normalized}.`
    };
}
function isDynamicHeartId(id) {
    return id.startsWith("heart_dynamic_");
}
function dynamicHeartNameFromId(id) {
    if (!isDynamicHeartId(id))
        return null;
    const slug = id.replace(/^heart_dynamic_/, "").trim();
    if (!slug)
        return null;
    const spaced = slug.replace(/_/g, " ");
    const titled = spaced.replace(/\b\w/g, ch => ch.toUpperCase());
    return `${titled}'s Heart`;
}
const BOSS_HEART_LOOKUP_BY_KEY = (() => {
    const map = new Map();
    for (const [bossName, def] of Object.entries(catalog_1.BOSS_HEART_DEFS)) {
        map.set(normalizeKey(bossName), def);
    }
    return map;
})();
function getBossHeartDefinition(bossName) {
    if (!bossName)
        return null;
    const normalized = normalizeBossName(bossName);
    if (!normalized)
        return null;
    const direct = catalog_1.BOSS_HEART_DEFS[normalized];
    if (direct)
        return direct;
    const keyed = BOSS_HEART_LOOKUP_BY_KEY.get(normalizeKey(normalized));
    if (keyed)
        return keyed;
    // Allow compatibility with roster text variants like "Boss Name (Title)".
    const normalizedKey = normalizeKey(normalized);
    for (const [key, def] of BOSS_HEART_LOOKUP_BY_KEY.entries()) {
        if (normalizedKey.startsWith(key) || key.startsWith(normalizedKey)) {
            return def;
        }
    }
    return buildDynamicHeartDefinition(normalized);
}
function syncBossHeartClaims(userId) {
    const user = (0, utils_1.ensureUser)(userId);
    const claimed = new Set(Array.isArray(user.bossHeartClaims) ? user.bossHeartClaims : []);
    let changed = false;
    for (const entry of user.raidHistory) {
        if (!entry?.bossDefeated || !entry.bossName)
            continue;
        const heart = getBossHeartDefinition(entry.bossName);
        if (heart && !claimed.has(heart.id)) {
            claimed.add(heart.id);
            changed = true;
        }
    }
    for (const [id, qty] of Object.entries(user.inventory)) {
        if (!(catalog_1.BOSS_HEART_IDS.has(id) || isDynamicHeartId(id)) || (qty || 0) <= 0 || claimed.has(id))
            continue;
        claimed.add(id);
        changed = true;
    }
    if (claimed.size !== (user.bossHeartClaims || []).length) {
        changed = true;
    }
    if (changed) {
        user.bossHeartClaims = Array.from(claimed);
        for (const heartId of user.bossHeartClaims) {
            if ((user.inventory[heartId] || 0) < 1) {
                user.inventory[heartId] = 1;
            }
        }
        (0, utils_1.savePoints)();
    }
    return user.bossHeartClaims;
}
function awardBossHeartAchievement(userId, bossName) {
    const heart = getBossHeartDefinition(bossName);
    if (!heart)
        return { awarded: false };
    // Check direct claim state first so the first qualifying kill awards exactly once,
    // even if raid history is written right after the kill.
    const user = (0, utils_1.ensureUser)(userId);
    const claimed = new Set(Array.isArray(user.bossHeartClaims) ? user.bossHeartClaims : []);
    if (claimed.has(heart.id)) {
        return { awarded: false, heartName: heart.name };
    }
    if (!Array.isArray(user.bossHeartClaims))
        user.bossHeartClaims = [];
    user.bossHeartClaims.push(heart.id);
    (0, utils_1.addInventoryItem)(userId, heart.id, 1);
    (0, utils_1.savePoints)();
    return { awarded: true, heartName: heart.name };
}
function getBossHeartUnlockCount(userId) {
    return syncBossHeartClaims(userId).length;
}
function getUnlockedBossHeartNames(userId) {
    const claimed = syncBossHeartClaims(userId);
    return claimed
        .map(id => catalog_1.ITEM_DEFS[id]?.name || dynamicHeartNameFromId(id) || id)
        .sort((a, b) => a.localeCompare(b));
}
