import { getRandomInt } from "../utils";

const RAID_OUTCOMES = ["extracted alive", "found rare loot", "got ambushed", "ran out of ammo", "escaped at last second"];

export function getRaidOutcome(_userId: string): string {
    const index = getRandomInt(0, RAID_OUTCOMES.length - 1);
    return RAID_OUTCOMES[index];
}

export function getRaidRewards(outcome: string): { tokens: number } {
    if (outcome.includes("rare loot")) return { tokens: 24 };
    if (outcome.includes("extracted alive")) return { tokens: 14 };
    if (outcome.includes("escaped")) return { tokens: 8 };
    if (outcome.includes("ambushed")) return { tokens: 2 };
    return { tokens: 0 };
}