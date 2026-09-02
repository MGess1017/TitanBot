"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokens = getTokens;
exports.addTokens = addTokens;
exports.removeTokens = removeTokens;
exports.getLeaderboard = getLeaderboard;
exports.claimDaily = claimDaily;
exports.resolveCrash = resolveCrash;
exports.canStartRaid = canStartRaid;
const utils_1 = require("../utils");
const casinoBalance_1 = require("./casinoBalance");
function getTokens(userId) {
    return (0, utils_1.getTokens)(userId);
}
function addTokens(userId, amount) {
    return (0, utils_1.addTokens)(userId, amount);
}
function removeTokens(userId, amount) {
    return (0, utils_1.removeTokens)(userId, amount);
}
function getLeaderboard() {
    return Object.entries(utils_1.points)
        .map(([id, user]) => ({ id, xp: user.xp || 0, prestige: user.prestige || 0 }))
        .sort((a, b) => b.xp - a.xp)
        .slice(0, 10);
}
function claimDaily(userId) {
    const user = (0, utils_1.ensureUser)(userId);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (user.lastDaily && now - user.lastDaily < dayMs) {
        return null;
    }
    if (user.lastDaily && now - user.lastDaily < dayMs * 2) {
        user.dailyStreak += 1;
    }
    else {
        user.dailyStreak = 1;
    }
    const bonus = 50 + Math.min(200, user.dailyStreak * 10);
    const tokenBonus = 20 + Math.min(100, user.dailyStreak * 5);
    (0, utils_1.addPoints)(userId, bonus);
    (0, utils_1.addTokens)(userId, tokenBonus);
    user.lastDaily = now;
    (0, utils_1.savePoints)();
    return { bonus, tokenBonus, streak: user.dailyStreak };
}
function resolveCrash(bet, target) {
    return (0, casinoBalance_1.resolveFairCrash)(bet, target);
}
function canStartRaid(userId, cost = 10) {
    return (0, utils_1.canAffordTokens)(userId, cost);
}
