const MS_PER_VOICE_XP_MINUTE = 60_000;
const DEFAULT_VOICE_XP_PER_MINUTE = 100;
export const VOICE_XP_DOUBLE_AFTER_MS = 2 * 60 * MS_PER_VOICE_XP_MINUTE;

const voiceXpConfig = { perMinute: DEFAULT_VOICE_XP_PER_MINUTE, doubleAfterMs: VOICE_XP_DOUBLE_AFTER_MS };

/** Applies staff-panel reward settings; invalid values fall back to defaults. */
export function configureVoiceXp(options: { perMinute?: number; doubleAfterMs?: number }): void {
    const { perMinute, doubleAfterMs } = options;
    voiceXpConfig.perMinute = typeof perMinute === "number" && Number.isFinite(perMinute) && perMinute >= 0
        ? Math.floor(perMinute) : DEFAULT_VOICE_XP_PER_MINUTE;
    voiceXpConfig.doubleAfterMs = typeof doubleAfterMs === "number" && Number.isFinite(doubleAfterMs) && doubleAfterMs > 0
        ? Math.floor(doubleAfterMs) : VOICE_XP_DOUBLE_AFTER_MS;
}

export function getVoiceXpConfig(): Readonly<typeof voiceXpConfig> {
    return voiceXpConfig;
}

export type VoiceXpAccrualState = {
    lastAccruedAt: number;
    remainderMs: number;
    connectedAt?: number;
};

export function getVoiceXpMultiplier(connectedAt: number, now: number): 1 | 2 {
    return now - connectedAt > voiceXpConfig.doubleAfterMs ? 2 : 1;
}

export function isVoiceXpEligible(channelId: string | null, isBot: boolean): boolean {
    return Boolean(channelId) && !isBot;
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
        connectedAt + voiceXpConfig.doubleAfterMs
    ));

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