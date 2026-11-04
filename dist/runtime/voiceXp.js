"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOICE_XP_DOUBLE_AFTER_MS = void 0;
exports.getVoiceXpMultiplier = getVoiceXpMultiplier;
exports.isVoiceXpEligible = isVoiceXpEligible;
exports.accrueVoiceXp = accrueVoiceXp;
const MS_PER_VOICE_XP_MINUTE = 60000;
const VOICE_XP_PER_MINUTE = 100;
exports.VOICE_XP_DOUBLE_AFTER_MS = 2 * 60 * MS_PER_VOICE_XP_MINUTE;
function getVoiceXpMultiplier(connectedAt, now) {
    return now - connectedAt > exports.VOICE_XP_DOUBLE_AFTER_MS ? 2 : 1;
}
function isVoiceXpEligible(channelId, afkChannelId, isBot) {
    return Boolean(channelId) && channelId !== afkChannelId && !isBot;
}
function accrueVoiceXp(state, now) {
    const lastAccruedAt = Math.max(0, Math.floor(state.lastAccruedAt));
    const currentTime = Math.max(lastAccruedAt, Math.floor(now));
    const remainderMs = Math.max(0, Math.floor(state.remainderMs));
    const elapsedMs = currentTime - lastAccruedAt;
    const totalMs = remainderMs + elapsedMs;
    const minutes = Math.floor(totalMs / MS_PER_VOICE_XP_MINUTE);
    const connectedAt = state.connectedAt ?? lastAccruedAt;
    const nextRemainderMs = totalMs - (minutes * MS_PER_VOICE_XP_MINUTE);
    const completedUntil = currentTime - nextRemainderMs;
    // Split delayed ticks at the bonus boundary instead of doubling pre-bonus minutes.
    const bonusMs = Math.max(0, completedUntil - Math.max(lastAccruedAt - remainderMs, connectedAt + exports.VOICE_XP_DOUBLE_AFTER_MS));
    return {
        state: {
            lastAccruedAt: currentTime,
            remainderMs: nextRemainderMs,
            connectedAt
        },
        xp: minutes * VOICE_XP_PER_MINUTE + Math.floor(bonusMs * VOICE_XP_PER_MINUTE / MS_PER_VOICE_XP_MINUTE),
        minutes
    };
}
