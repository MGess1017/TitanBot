"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KENO_PAYOUTS = exports.HILO_PAYOUTS = exports.BACCARAT_PAYOUTS = exports.COINFLIP_PAYOUT = exports.BLACKJACK_PAYOUTS = exports.ROULETTE_PAYOUTS = exports.DICE_PAYOUTS = exports.STANDARD_WIN_BONUS_CHANCE = exports.CASINO_PROFILES = exports.CASINO_BASE_RTP = exports.STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER = exports.CASINO_TARGET_RTP = void 0;
exports.rollWinBonus = rollWinBonus;
exports.getCasinoProfileLine = getCasinoProfileLine;
exports.resolveFairCrash = resolveFairCrash;
exports.CASINO_TARGET_RTP = 0.95;
exports.STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER = 1.00925;
exports.CASINO_BASE_RTP = exports.CASINO_TARGET_RTP / exports.STANDARD_WIN_BONUS_EXPECTED_MULTIPLIER;
exports.CASINO_PROFILES = {
    dice: { rtp: "~95%", bonus: "6% win boost", volatility: "Choice-based" },
    roulette: { rtp: "~95%", bonus: "6% win boost", volatility: "Choice-based" },
    blackjack: { rtp: "~95%", bonus: "6% win boost", volatility: "Medium" },
    crash: { rtp: "95%", bonus: "6% win boost", volatility: "Target-based" },
    magicslots: { rtp: "~94% simulated", bonus: "Scatter 0.47% | Ultra 0.16%", volatility: "Very high" },
    coinflip: { rtp: "~96%", bonus: "6% win boost", volatility: "Medium" },
    baccarat: { rtp: "~95%", bonus: "6% win boost", volatility: "Medium" },
    hilo: { rtp: "~95%", bonus: "6% win boost", volatility: "Medium" },
    keno: { rtp: "~95%", bonus: "6% win boost", volatility: "High" }
};
exports.STANDARD_WIN_BONUS_CHANCE = 0.06;
function rollWinBonus(random = Math.random()) {
    if (random < 0.002)
        return { multiplier: 1.75, label: "Legendary Boost 1.75x", triggered: true };
    if (random < 0.015)
        return { multiplier: 1.25, label: "Rare Boost 1.25x", triggered: true };
    if (random < exports.STANDARD_WIN_BONUS_CHANCE)
        return { multiplier: 1.1, label: "Lucky Boost 1.10x", triggered: true };
    return { multiplier: 1, label: "No bonus", triggered: false };
}
exports.DICE_PAYOUTS = { exact: 5.6, band: 1.88 };
exports.ROULETTE_PAYOUTS = { straight: 35.2, evenMoney: 1.93 };
exports.BLACKJACK_PAYOUTS = { safe: 2.04, aggressive: 2.14 };
exports.COINFLIP_PAYOUT = 1.9;
exports.BACCARAT_PAYOUTS = { player: 2.08, banker: 2.08, tie: 9.18 };
exports.HILO_PAYOUTS = { standard: 1.72, strong: 1.96, extreme: 2.24 };
exports.KENO_PAYOUTS = {
    2: [0, 1.03, 9.62],
    3: [0, 0.6, 3.59, 15.57],
    4: [0, 0.36, 1.82, 7.64, 38.23],
    5: [0, 0.32, 1.27, 3.8, 13.95, 49.14],
    6: [0, 0, 1, 3.01, 7.35, 29.41, 76.85],
    7: [0, 0, 0.64, 2.23, 5.1, 13.07, 39.84, 98.8],
    8: [0, 0, 0.44, 1.61, 3.66, 9.37, 22.84, 53.28, 122.94],
    9: [0, 0, 0.27, 1.21, 2.83, 6.74, 16.44, 34.77, 72.77, 150.98],
    10: [0, 0, 0.26, 0.9, 2.06, 4.9, 11.34, 24.48, 50.25, 95.35, 190.7]
};
function getCasinoProfileLine(gameKey) {
    const profile = exports.CASINO_PROFILES[gameKey];
    return `Target RTP: ${profile.rtp} | Bonus: ${profile.bonus} | Volatility: ${profile.volatility}`;
}
function resolveFairCrash(bet, target, random = Math.random) {
    const hitChance = Math.min(1, exports.CASINO_BASE_RTP / target);
    const win = random() < hitChance;
    const crashPoint = win
        ? target + random() * Math.max(0, 10 - target)
        : 1 + random() * Math.max(0, target - 1);
    return win
        ? { win: true, crashPoint: crashPoint.toFixed(2), payout: Math.max(1, Math.floor(bet * target)), loss: 0 }
        : { win: false, crashPoint: crashPoint.toFixed(2), payout: 0, loss: bet };
}
