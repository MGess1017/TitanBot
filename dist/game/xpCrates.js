"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JACKPOT_XP_CRATE = exports.XP_CRATES = exports.XP_CRATE_COOLDOWN_MS = void 0;
exports.getXpCrateDefinition = getXpCrateDefinition;
exports.rollXpCrate = rollXpCrate;
exports.claimXpCrate = claimXpCrate;
exports.isXpCrateReward = isXpCrateReward;
const node_crypto_1 = require("node:crypto");
exports.XP_CRATE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
exports.XP_CRATES = [
    { id: "slate", name: "Slate XP Crate", color: 0x94a3b8, weight: 3000, exponent: 8 },
    { id: "emerald", name: "Emerald XP Crate", color: 0x22c55e, weight: 2200, exponent: 7.5 },
    { id: "teal", name: "Teal XP Crate", color: 0x14b8a6, weight: 1600, exponent: 7 },
    { id: "sapphire", name: "Sapphire XP Crate", color: 0x3b82f6, weight: 1100, exponent: 6.5 },
    { id: "violet", name: "Violet XP Crate", color: 0x8b5cf6, weight: 800, exponent: 6 },
    { id: "rose", name: "Rose XP Crate", color: 0xec4899, weight: 500, exponent: 5.5 },
    { id: "crimson", name: "Crimson XP Crate", color: 0xef4444, weight: 350, exponent: 5 },
    { id: "amber", name: "Amber XP Crate", color: 0xf59e0b, weight: 200, exponent: 4.5 },
    { id: "gold", name: "Gold XP Crate", color: 0xeab308, weight: 150, exponent: 4 },
    { id: "diamond", name: "Diamond XP Crate", color: 0x67e8f9, weight: 100, exponent: 3 }
];
exports.JACKPOT_XP_CRATE = {
    id: "astral",
    name: "Astral Million XP Crate",
    color: 0x8b5cf6
};
function getXpCrateDefinition(id) {
    const crate = id === exports.JACKPOT_XP_CRATE.id ? exports.JACKPOT_XP_CRATE : exports.XP_CRATES.find(crate => crate.id === id);
    if (!crate)
        throw new Error(`Unknown XP crate: ${id}`);
    return crate;
}
function rollXpCrate(now, draw = max => (0, node_crypto_1.randomInt)(max)) {
    if (draw(100000) === 0)
        return { crateId: "astral", xp: 1000000, claimedAt: now };
    const selection = draw(10000);
    let remaining = selection;
    const crate = exports.XP_CRATES.find(candidate => {
        remaining -= candidate.weight;
        return remaining < 0;
    });
    if (!crate)
        throw new Error(`Invalid XP crate selection: ${selection}`);
    const xp = draw(10000) === 0
        ? 100000
        : Math.floor(100000 * Math.pow(draw(1000000) / 1000000, crate.exponent));
    return { crateId: crate.id, xp, claimedAt: now };
}
function claimXpCrate(state, now = Date.now(), draw) {
    const nextClaimAt = state.latestXpCrate ? state.latestXpCrate.claimedAt + exports.XP_CRATE_COOLDOWN_MS : 0;
    if (now < nextClaimAt)
        return { ok: false, nextClaimAt };
    const reward = rollXpCrate(now, draw);
    state.latestXpCrate = reward;
    return { ok: true, reward };
}
function isXpCrateReward(value) {
    if (!value || typeof value !== "object")
        return false;
    const reward = value;
    const knownCrate = reward.crateId === "astral" || exports.XP_CRATES.some(crate => crate.id === reward.crateId);
    return knownCrate
        && typeof reward.claimedAt === "number" && Number.isFinite(reward.claimedAt) && reward.claimedAt >= 0
        && typeof reward.xp === "number" && Number.isInteger(reward.xp) && reward.xp >= 0
        && (reward.crateId === "astral" ? reward.xp === 1000000 : reward.xp <= 100000);
}
