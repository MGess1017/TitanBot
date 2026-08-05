"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRaidOutcome = getRaidOutcome;
exports.getRaidRewards = getRaidRewards;
const utils_1 = require("../utils");
const RAID_OUTCOMES = ["extracted alive", "found rare loot", "got ambushed", "ran out of ammo", "escaped at last second"];
function getRaidOutcome(_userId) {
    const index = (0, utils_1.getRandomInt)(0, RAID_OUTCOMES.length - 1);
    return RAID_OUTCOMES[index];
}
function getRaidRewards(outcome) {
    if (outcome.includes("rare loot"))
        return { tokens: 24 };
    if (outcome.includes("extracted alive"))
        return { tokens: 14 };
    if (outcome.includes("escaped"))
        return { tokens: 8 };
    if (outcome.includes("ambushed"))
        return { tokens: 2 };
    return { tokens: 0 };
}
