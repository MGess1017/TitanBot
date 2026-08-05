"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TICKET_SLA_THRESHOLDS_MS = void 0;
exports.getTicketSlaThresholdsFromEnv = getTicketSlaThresholdsFromEnv;
function parseThreshold(value, fallbackMs) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallbackMs;
    return Math.floor(parsed);
}
function normalizeThresholds(raw) {
    const firstResponseWarnMs = Math.max(60000, raw.firstResponseWarnMs);
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
function getTicketSlaThresholdsFromEnv(env = process.env) {
    return normalizeThresholds({
        firstResponseWarnMs: parseThreshold(env.TICKET_SLA_FIRST_RESPONSE_WARN_MS, 10 * 60 * 1000),
        firstResponseBreachMs: parseThreshold(env.TICKET_SLA_FIRST_RESPONSE_BREACH_MS, 15 * 60 * 1000),
        resolveWarnMs: parseThreshold(env.TICKET_SLA_RESOLVE_WARN_MS, 20 * 60 * 60 * 1000),
        resolveBreachMs: parseThreshold(env.TICKET_SLA_RESOLVE_BREACH_MS, 24 * 60 * 60 * 1000)
    });
}
exports.TICKET_SLA_THRESHOLDS_MS = getTicketSlaThresholdsFromEnv();
