"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectIfRateLimited = rejectIfRateLimited;
const commandRateLimitState = new Map();
const RATE_LIMIT_STATE_RETENTION_MS = 10 * 60 * 1000;
const RATE_LIMIT_STATE_HARD_CAP = 50000;
const RATE_LIMIT_STATE_COMPACT_TARGET = 25000;
let lastPruneAt = 0;
function pruneRateLimitState(now = Date.now()) {
    if (now - lastPruneAt < 30000 && commandRateLimitState.size < 2000)
        return;
    for (const [key, ts] of commandRateLimitState.entries()) {
        if (now - ts > RATE_LIMIT_STATE_RETENTION_MS) {
            commandRateLimitState.delete(key);
        }
    }
    if (commandRateLimitState.size > RATE_LIMIT_STATE_HARD_CAP) {
        const entries = Array.from(commandRateLimitState.entries())
            .sort((a, b) => b[1] - a[1]);
        commandRateLimitState.clear();
        for (const [key, ts] of entries.slice(0, RATE_LIMIT_STATE_COMPACT_TARGET)) {
            commandRateLimitState.set(key, ts);
        }
    }
    lastPruneAt = now;
}
function rejectIfRateLimited(key, windowMs) {
    if (windowMs <= 0)
        return null;
    const now = Date.now();
    pruneRateLimitState(now);
    const last = commandRateLimitState.get(key) || 0;
    if (last && (now - last) <= windowMs) {
        return "Please wait a moment before running that command again.";
    }
    commandRateLimitState.set(key, now);
    return null;
}
