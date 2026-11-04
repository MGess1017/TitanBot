const MS_PER_VOICE_XP_MINUTE = 60_000;
const VOICE_XP_PER_MINUTE = 100;
export const VOICE_XP_DOUBLE_AFTER_MS = 2 * 60 * MS_PER_VOICE_XP_MINUTE;

export type VoiceXpAccrualState = {
    lastAccruedAt: number;
    remainderMs: number;
    connectedAt?: number;
};

export function getVoiceXpMultiplier(connectedAt: number, now: number): 1 | 2 {
    return now - connectedAt > VOICE_XP_DOUBLE_AFTER_MS ? 2 : 1;
}

export function isVoiceXpEligible(channelId: string | null, afkChannelId: string | null, isBot: boolean): boolean {
    return Boolean(channelId) && channelId !== afkChannelId && !isBot;
}

export function accrueVoiceXp(state: VoiceXpAccrualState, now: number): { state: VoiceXpAccrualState; xp: number; minutes: number } {
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
    const bonusMs = Math.max(0, completedUntil - Math.max(
        lastAccruedAt - remainderMs,
        connectedAt + VOICE_XP_DOUBLE_AFTER_MS
    ));

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