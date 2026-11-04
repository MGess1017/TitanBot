"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOICE_XP_DOUBLE_AFTER_MS = void 0;
exports.configureVoiceXp = configureVoiceXp;
exports.getVoiceXpConfig = getVoiceXpConfig;
exports.getVoiceXpMultiplier = getVoiceXpMultiplier;
exports.isVoiceXpEligible = isVoiceXpEligible;
exports.accrueVoiceXp = accrueVoiceXp;
const MS_PER_VOICE_XP_MINUTE = 60000;
const DEFAULT_VOICE_XP_PER_MINUTE = 100;
exports.VOICE_XP_DOUBLE_AFTER_MS = 2 * 60 * MS_PER_VOICE_XP_MINUTE;
const voiceXpConfig = { perMinute: DEFAULT_VOICE_XP_PER_MINUTE, doubleAfterMs: exports.VOICE_XP_DOUBLE_AFTER_MS };
/** Applies staff-panel reward settings; invalid values fall back to defaults. */
function configureVoiceXp(options) {
    const { perMinute, doubleAfterMs } = options;
    voiceXpConfig.perMinute = typeof perMinute === "number" && Number.isFinite(perMinute) && perMinute >= 0
        ? Math.floor(perMinute) : DEFAULT_VOICE_XP_PER_MINUTE;
    voiceXpConfig.doubleAfterMs = typeof doubleAfterMs === "number" && Number.isFinite(doubleAfterMs) && doubleAfterMs > 0
        ? Math.floor(doubleAfterMs) : exports.VOICE_XP_DOUBLE_AFTER_MS;
}
function getVoiceXpConfig() {
    return voiceXpConfig;
}
function getVoiceXpMultiplier(connectedAt, now) {
    return now - connectedAt > voiceXpConfig.doubleAfterMs ? 2 : 1;
}
function isVoiceXpEligible(channelId, isBot) {
    return Boolean(channelId) && !isBot;
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
    const bonusMs = Math.max(0, completedUntil - Math.max(lastAccruedAt - remainderMs, connectedAt + voiceXpConfig.doubleAfterMs));
    return {
        state: {
            lastAccruedAt: currentTime,
            remainderMs: nextRemainderMs,
            connectedAt
        },
        xp: minutes * voiceXpConfig.perMinute + Math.floor(bonusMs * voiceXpConfig.perMinute / MS_PER_VOICE_XP_MINUTE),
        minutes
    };
}
