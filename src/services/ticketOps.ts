import { TICKET_SLA_THRESHOLDS_MS, type TicketSlaThresholdsMs } from "./ticketSlaConfig";
import { sanitizeTranscriptLine as sanitizeLine } from "./ticketText";

export type TicketSlaEscalationState = {
    firstResponseWarn: boolean;
    firstResponseBreach: boolean;
    resolveWarn: boolean;
    resolveBreach: boolean;
};

type TicketSlaStateInput = {
    createdAt: number;
    firstResponseAt: number | null;
    status: "open" | "claimed" | "archived" | "resolved";
};

export function getTicketSlaEscalationState(
    ticket: TicketSlaStateInput,
    now = Date.now(),
    thresholds: TicketSlaThresholdsMs = TICKET_SLA_THRESHOLDS_MS
): TicketSlaEscalationState {
    const ageMs = Math.max(0, now - ticket.createdAt);
    const { firstResponseWarnMs, firstResponseBreachMs, resolveWarnMs, resolveBreachMs } = thresholds;

    return {
        firstResponseWarn: !ticket.firstResponseAt && ageMs >= firstResponseWarnMs,
        firstResponseBreach: !ticket.firstResponseAt && ageMs >= firstResponseBreachMs,
        resolveWarn: ticket.status !== "resolved" && ageMs >= resolveWarnMs,
        resolveBreach: ticket.status !== "resolved" && ageMs >= resolveBreachMs
    };
}

export function sanitizeTranscriptLine(raw: string): string {
    return sanitizeLine(raw);
}
