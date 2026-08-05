export type TicketSlaThresholdsMs = {
    firstResponseWarnMs: number;
    firstResponseBreachMs: number;
    resolveWarnMs: number;
    resolveBreachMs: number;
};

function parseThreshold(value: string | undefined, fallbackMs: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
    return Math.floor(parsed);
}

function normalizeThresholds(raw: TicketSlaThresholdsMs): TicketSlaThresholdsMs {
    const firstResponseWarnMs = Math.max(60_000, raw.firstResponseWarnMs);
    const firstResponseBreachMs = Math.max(firstResponseWarnMs, raw.firstResponseBreachMs);
    const resolveWarnMs = Math.max(firstResponseBreachMs, raw.resolveWarnMs);
    const resolveBreachMs = Math.max(resolveWarnMs, raw.resolveBreachMs);

    return {
        firstResponseWarnMs,
        firstResponseBreachMs,
        resolveWarnMs,
        resolveBreachMs
    };
}

export function getTicketSlaThresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): TicketSlaThresholdsMs {
    return normalizeThresholds({
        firstResponseWarnMs: parseThreshold(env.TICKET_SLA_FIRST_RESPONSE_WARN_MS, 10 * 60 * 1000),
        firstResponseBreachMs: parseThreshold(env.TICKET_SLA_FIRST_RESPONSE_BREACH_MS, 15 * 60 * 1000),
        resolveWarnMs: parseThreshold(env.TICKET_SLA_RESOLVE_WARN_MS, 20 * 60 * 60 * 1000),
        resolveBreachMs: parseThreshold(env.TICKET_SLA_RESOLVE_BREACH_MS, 24 * 60 * 60 * 1000)
    });
}

export const TICKET_SLA_THRESHOLDS_MS = getTicketSlaThresholdsFromEnv();
