const MS_PER_VOICE_XP_MINUTE = 60_000;
const VOICE_XP_PER_MINUTE = 100;

export type VoiceXpAccrualState = {
    lastAccruedAt: number;
    remainderMs: number;
};

export function accrueVoiceXp(state: VoiceXpAccrualState, now: number): { state: VoiceXpAccrualState; xp: number; minutes: number } {
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