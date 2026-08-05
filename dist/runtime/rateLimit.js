"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectIfRateLimited = rejectIfRateLimited;
const commandRateLimitState = new Map();
function rejectIfRateLimited(key, windowMs) {
    if (windowMs <= 0)
        return null;
    const now = Date.now();
    const last = commandRateLimitState.get(key) || 0;
    if (last && (now - last) <= windowMs) {
        return "Please wait a moment before running that command again.";
    }
    commandRateLimitState.set(key, now);
    return null;
}
