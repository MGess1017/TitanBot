import type { TicketRecord } from "./ticketState";

export const TICKET_TOPICS = [
    { label: "General Question", value: "general" },
    { label: "Bug / Bot Problem", value: "bug" },
    { label: "Account Help", value: "account" },
    { label: "Billing / Purchase", value: "billing" },
    { label: "Report a Member", value: "report" },
    { label: "Appeal", value: "appeal" }
] as const;
export type TicketTopic = typeof TICKET_TOPICS[number]["value"];
export function isTicketTopic(value: string): value is TicketTopic {
    return TICKET_TOPICS.some(topic => topic.value === value);
}

export class TicketActionCoordinator {
    private readonly active = new Set<string>();
    private readonly waiters = new Map<string, Array<() => void>>();
    isBusy(channelId: string): boolean { return this.active.has(channelId); }
    async whenIdle(channelId: string): Promise<void> {
        while (this.active.has(channelId)) {
            await new Promise<void>(resolve => {
                this.waiters.set(channelId, [...(this.waiters.get(channelId) || []), resolve]);
            });
        }
    }
    async run(channelId: string, action: () => Promise<string>): Promise<string> {
        if (this.active.has(channelId)) return "Another action is updating this ticket. Please try again shortly.";
        this.active.add(channelId);
        try { return await action(); }
        finally {
            this.active.delete(channelId);
            for (const resolve of this.waiters.get(channelId) || []) resolve();
            this.waiters.delete(channelId);
        }
    }
}

export const ticketActions = new TicketActionCoordinator();

export function applyTicketReply(ticket: TicketRecord, actorId: string, staff: boolean, at: number, requestsInformation = false): boolean {
    if (!["open", "claimed"].includes(ticket.status) || at <= (ticket.lastReplyAt || 0)) return false;
    if (actorId !== ticket.ownerId && !staff) return false;
    const memberReply = actorId === ticket.ownerId;
    ticket.lastReplyAt = at;
    ticket.lastReplyBy = memberReply ? "member" : "staff";
    ticket.workflowStatus = memberReply ? "new" : requestsInformation ? "waiting_user" : "responded";
    if (ticket.workflowStatus === "waiting_user" && !ticket.slaPausedAt) ticket.slaPausedAt = at;
    if (ticket.workflowStatus !== "waiting_user" && ticket.slaPausedAt) {
        ticket.slaPausedMs = Math.max(0, (ticket.slaPausedMs || 0) + at - ticket.slaPausedAt);
        ticket.slaPausedAt = null;
    }
    if (!memberReply && !ticket.firstResponseAt) ticket.firstResponseAt = at;
    ticket.updatedAt = at;
    return true;
}

export function ticketDisplayStatus(ticket: TicketRecord): string {
    if (ticket.status === "archived") return "Closed";
    if (ticket.status === "resolved") return "Resolved";
    if (ticket.closureRequestedAt) return "Closure requested";
    if (ticket.workflowStatus === "waiting_user") return "Waiting for you";
    if (ticket.workflowStatus === "escalated") return "Under review";
    if (ticket.lastReplyBy === "member" || ticket.workflowStatus === "new") return "Waiting for staff";
    return ticket.workflowStatus === "responded" || ticket.assignedToId || ticket.claimedById ? "In progress" : "Waiting for staff";
}

export function isTicketReplyOverdue(ticket: TicketRecord, now: number): boolean {
    if (!["open", "claimed"].includes(ticket.status) || ticket.workflowStatus === "waiting_user") return false;
    const target = ticket.slaPolicy?.firstResponseMs || 15 * 60_000;
    const since = ticket.lastReplyBy === "member" ? ticket.lastReplyAt || ticket.createdAt : ticket.createdAt;
    return (ticket.lastReplyBy === "member" || !ticket.firstResponseAt) && now - since >= target;
}

export function ticketNotificationTarget(ticket: TicketRecord, kind: "member_reply" | "staff_reply" | "closure" | "reminder"): string | null {
    return kind === "staff_reply" ? ticket.ownerId : ticket.assignedToId || ticket.claimedById || null;
}

export type TicketDraft = {
    category: TicketTopic;
    summary: string;
    details: string;
    evidence: string;
    platform?: string;
    at: number;
};

export function pruneTicketDrafts(drafts: Record<string, TicketDraft>, now: number): Record<string, TicketDraft> {
    return Object.fromEntries(Object.entries(drafts)
        .filter(([, draft]) => now - draft.at < 24 * 60 * 60_000)
        .sort((a, b) => b[1].at - a[1].at).slice(0, 1000));
}
