"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTicketSlaEscalationState = getTicketSlaEscalationState;
exports.sanitizeTranscriptLine = sanitizeTranscriptLine;
const ticketSlaConfig_1 = require("./ticketSlaConfig");
const ticketText_1 = require("./ticketText");
function getTicketSlaEscalationState(ticket, now = Date.now(), thresholds = ticketSlaConfig_1.TICKET_SLA_THRESHOLDS_MS) {
    const ageMs = Math.max(0, now - ticket.createdAt);
    const { firstResponseWarnMs, firstResponseBreachMs, resolveWarnMs, resolveBreachMs } = thresholds;
    return {
        firstResponseWarn: !ticket.firstResponseAt && ageMs >= firstResponseWarnMs,
        firstResponseBreach: !ticket.firstResponseAt && ageMs >= firstResponseBreachMs,
        resolveWarn: ticket.status !== "resolved" && ageMs >= resolveWarnMs,
        resolveBreach: ticket.status !== "resolved" && ageMs >= resolveBreachMs
    };
}
function sanitizeTranscriptLine(raw) {
    return (0, ticketText_1.sanitizeTranscriptLine)(raw);
}
