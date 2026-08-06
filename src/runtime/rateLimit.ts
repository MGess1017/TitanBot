const commandRateLimitState = new Map<string, number>();
const RATE_LIMIT_STATE_RETENTION_MS = 10 * 60 * 1000;
let lastPruneAt = 0;

function pruneRateLimitState(now = Date.now()): void {
    if (now - lastPruneAt < 30_000 && commandRateLimitState.size < 2000) return;
    for (const [key, ts] of commandRateLimitState.entries()) {
        if (now - ts > RATE_LIMIT_STATE_RETENTION_MS) {
            commandRateLimitState.delete(key);
        }
    }
    lastPruneAt = now;
}

export function rejectIfRateLimited(key: string, windowMs: number): string | null {
    if (windowMs <= 0) return null;
    const now = Date.now();
    pruneRateLimitState(now);
    const last = commandRateLimitState.get(key) || 0;
    if (last && (now - last) <= windowMs) {
        return "Please wait a moment before running that command again.";
    }

    commandRateLimitState.set(key, now);
    return null;
}
