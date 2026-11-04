import { randomInt } from "node:crypto";

export const XP_CRATE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const XP_CRATES = [
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
] as const;
export const JACKPOT_XP_CRATE = {
    id: "astral",
    name: "Astral Million XP Crate",
    color: 0x8b5cf6
} as const;
export type XpCrateId = typeof XP_CRATES[number]["id"] | typeof JACKPOT_XP_CRATE.id;
export type XpCrateReward = { crateId: XpCrateId; xp: number; claimedAt: number };
export type XpCrateState = { latestXpCrate: XpCrateReward | null };
export type XpCrateClaim = { ok: true; reward: XpCrateReward } | { ok: false; nextClaimAt: number };

export function getXpCrateDefinition(id: XpCrateId) {
    const crate = id === JACKPOT_XP_CRATE.id ? JACKPOT_XP_CRATE : XP_CRATES.find(crate => crate.id === id);
    if (!crate) throw new Error(`Unknown XP crate: ${id}`);
    return crate;
}

export function rollXpCrate(now: number, draw: (max: number) => number = max => randomInt(max)): XpCrateReward {
    if (draw(100_000) === 0) return { crateId: "astral", xp: 1_000_000, claimedAt: now };
    const selection = draw(10_000);
    let remaining = selection;
    const crate = XP_CRATES.find(candidate => {
        remaining -= candidate.weight;
        return remaining < 0;
    });
    if (!crate) throw new Error(`Invalid XP crate selection: ${selection}`);
    const xp = draw(10_000) === 0
        ? 100_000
        : Math.floor(100_000 * Math.pow(draw(1_000_000) / 1_000_000, crate.exponent));
    return { crateId: crate.id, xp, claimedAt: now };
}

export function claimXpCrate(state: XpCrateState, now = Date.now(), draw?: (max: number) => number): XpCrateClaim {
    const nextClaimAt = state.latestXpCrate ? state.latestXpCrate.claimedAt + XP_CRATE_COOLDOWN_MS : 0;
    if (now < nextClaimAt) return { ok: false, nextClaimAt };
    const reward = rollXpCrate(now, draw);
    state.latestXpCrate = reward;
    return { ok: true, reward };
}

export function isXpCrateReward(value: unknown): value is XpCrateReward {
    if (!value || typeof value !== "object") return false;
    const reward = value as Partial<XpCrateReward>;
    const knownCrate = reward.crateId === "astral" || XP_CRATES.some(crate => crate.id === reward.crateId);
    return knownCrate
        && typeof reward.claimedAt === "number" && Number.isFinite(reward.claimedAt) && reward.claimedAt >= 0
        && typeof reward.xp === "number" && Number.isInteger(reward.xp) && reward.xp >= 0
        && (reward.crateId === "astral" ? reward.xp === 1_000_000 : reward.xp <= 100_000);
}
