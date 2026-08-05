import {
    addPoints,
    addTokens as addTokensCore,
    canAffordTokens,
    ensureUser,
    getTokens as getTokensCore,
    points,
    removeTokens as removeTokensCore,
    savePoints
} from "../utils";

export function getTokens(userId: string): number {
    return getTokensCore(userId);
}

export function addTokens(userId: string, amount: number): number {
    return addTokensCore(userId, amount);
}

export function removeTokens(userId: string, amount: number): number {
    return removeTokensCore(userId, amount);
}

export function getLeaderboard(): Array<{ id: string; xp: number; prestige: number }> {
    return Object.entries(points)
        .map(([id, user]) => ({ id, xp: user.xp || 0, prestige: user.prestige || 0 }))
        .sort((a, b) => b.xp - a.xp)
        .slice(0, 10);
}

export function claimDaily(userId: string): { bonus: number; tokenBonus: number; streak: number } | null {
    const user = ensureUser(userId);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    if (user.lastDaily && now - user.lastDaily < dayMs) {
        return null;
    }

    if (user.lastDaily && now - user.lastDaily < dayMs * 2) {
        user.dailyStreak += 1;
    } else {
        user.dailyStreak = 1;
    }

    const bonus = 50 + Math.min(200, user.dailyStreak * 10);
    const tokenBonus = 20 + Math.min(100, user.dailyStreak * 5);

    addPoints(userId, bonus);
    addTokensCore(userId, tokenBonus);
    user.lastDaily = now;
    savePoints();

    return { bonus, tokenBonus, streak: user.dailyStreak };
}

export function resolveCrash(bet: number, target: number): { win: boolean; crashPoint: string; payout: number; loss: number } {
    const crashPoint = 1 + Math.random() * 9;
    const rounded = crashPoint.toFixed(2);
    const win = crashPoint >= target;

    if (win) {
        const payout = Math.max(1, Math.floor(bet * target));
        return { win: true, crashPoint: rounded, payout, loss: 0 };
    }

    return { win: false, crashPoint: rounded, payout: 0, loss: bet };
}

export function canStartRaid(userId: string, cost = 10): boolean {
    return canAffordTokens(userId, cost);
}