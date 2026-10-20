"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accrueVoiceXp = accrueVoiceXp;
const MS_PER_VOICE_XP_MINUTE = 60000;
const VOICE_XP_PER_MINUTE = 100;
function accrueVoiceXp(state, now) {
    const lastAccruedAt = Math.max(0, Math.floor(state.lastAccruedAt));
    const currentTime = Math.max(lastAccruedAt, Math.floor(now));
    const remainderMs = Math.max(0, Math.floor(state.remainderMs));
    const elapsedMs = currentTime - lastAccruedAt;
    const totalMs = remainderMs + elapsedMs;
    const minutes = Math.floor(totalMs / MS_PER_VOICE_XP_MINUTE);
    return {
        state: {
            lastAccruedAt: currentTime,
            remainderMs: totalMs - (minutes * MS_PER_VOICE_XP_MINUTE)
        },
        xp: minutes * VOICE_XP_PER_MINUTE,
        minutes
    };
}
