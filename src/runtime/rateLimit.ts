const commandRateLimitState = new Map<string, number>();

export function rejectIfRateLimited(key: string, windowMs: number): string | null {
    if (windowMs <= 0) return null;
    const now = Date.now();
    const last = commandRateLimitState.get(key) || 0;
    if (last && (now - last) <= windowMs) {
        return "Please wait a moment before running that command again.";
    }

    commandRateLimitState.set(key, now);
    return null;
}
