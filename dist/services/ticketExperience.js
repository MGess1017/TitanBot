"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketActions = exports.TicketActionCoordinator = exports.TICKET_TOPICS = void 0;
exports.isTicketTopic = isTicketTopic;
exports.applyTicketReply = applyTicketReply;
exports.ticketDisplayStatus = ticketDisplayStatus;
exports.isTicketReplyOverdue = isTicketReplyOverdue;
exports.ticketNotificationTarget = ticketNotificationTarget;
exports.pruneTicketDrafts = pruneTicketDrafts;
exports.TICKET_TOPICS = [
    { label: "General Question", value: "general" },
    { label: "Bug / Bot Problem", value: "bug" },
    { label: "Account Help", value: "account" },
    { label: "Billing / Purchase", value: "billing" },
    { label: "Report a Member", value: "report" },
    { label: "Appeal", value: "appeal" }
];
function isTicketTopic(value) {
    return exports.TICKET_TOPICS.some(topic => topic.value === value);
}
class TicketActionCoordinator {
    constructor() {
        this.active = new Set();
        this.waiters = new Map();
    }
    isBusy(channelId) { return this.active.has(channelId); }
    async whenIdle(channelId) {
        while (this.active.has(channelId)) {
            await new Promise(resolve => {
                this.waiters.set(channelId, [...(this.waiters.get(channelId) || []), resolve]);
            });
        }
    }
    async run(channelId, action) {
        if (this.active.has(channelId))
            return "Another action is updating this ticket. Please try again shortly.";
        this.active.add(channelId);
        try {
            return await action();
        }
        finally {
            this.active.delete(channelId);
            for (const resolve of this.waiters.get(channelId) || [])
                resolve();
            this.waiters.delete(channelId);
        }
    }
}
exports.TicketActionCoordinator = TicketActionCoordinator;
exports.ticketActions = new TicketActionCoordinator();
function applyTicketReply(ticket, actorId, staff, at, requestsInformation = false) {
    if (!["open", "claimed"].includes(ticket.status) || at <= (ticket.lastReplyAt || 0))
        return false;
    if (actorId !== ticket.ownerId && !staff)
        return false;
    const memberReply = actorId === ticket.ownerId;
    ticket.lastReplyAt = at;
    ticket.lastReplyBy = memberReply ? "member" : "staff";
    ticket.workflowStatus = memberReply ? "new" : requestsInformation ? "waiting_user" : "responded";
    if (ticket.workflowStatus === "waiting_user" && !ticket.slaPausedAt)
        ticket.slaPausedAt = at;
    if (ticket.workflowStatus !== "waiting_user" && ticket.slaPausedAt) {
        ticket.slaPausedMs = Math.max(0, (ticket.slaPausedMs || 0) + at - ticket.slaPausedAt);
        ticket.slaPausedAt = null;
    }
    if (!memberReply && !ticket.firstResponseAt)
        ticket.firstResponseAt = at;
    ticket.updatedAt = at;
    return true;
}
function ticketDisplayStatus(ticket) {
    if (ticket.status === "archived")
        return "Closed";
    if (ticket.status === "resolved")
        return "Resolved";
    if (ticket.closureRequestedAt)
        return "Closure requested";
    if (ticket.workflowStatus === "waiting_user")
        return "Waiting for you";
    if (ticket.workflowStatus === "escalated")
        return "Under review";
    if (ticket.lastReplyBy === "member" || ticket.workflowStatus === "new")
        return "Waiting for staff";
    return ticket.workflowStatus === "responded" || ticket.assignedToId || ticket.claimedById ? "In progress" : "Waiting for staff";
}
function isTicketReplyOverdue(ticket, now) {
    if (!["open", "claimed"].includes(ticket.status) || ticket.workflowStatus === "waiting_user")
        return false;
    const target = ticket.slaPolicy?.firstResponseMs || 15 * 60000;
    const since = ticket.lastReplyBy === "member" ? ticket.lastReplyAt || ticket.createdAt : ticket.createdAt;
    return (ticket.lastReplyBy === "member" || !ticket.firstResponseAt) && now - since >= target;
}
function ticketNotificationTarget(ticket, kind) {
    return kind === "staff_reply" ? ticket.ownerId : ticket.assignedToId || ticket.claimedById || null;
}
function pruneTicketDrafts(drafts, now) {
    return Object.fromEntries(Object.entries(drafts)
        .filter(([, draft]) => now - draft.at < 24 * 60 * 60000)
        .sort((a, b) => b[1].at - a[1].at).slice(0, 1000));
}
