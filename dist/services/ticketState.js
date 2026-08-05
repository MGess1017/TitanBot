"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTicketStatus = normalizeTicketStatus;
exports.normalizeTicketPriority = normalizeTicketPriority;
exports.normalizeTicketWorkflowStatus = normalizeTicketWorkflowStatus;
exports.canTransitionTicketStatus = canTransitionTicketStatus;
exports.findOpenTicketByOwner = findOpenTicketByOwner;
exports.findOpenTicketByChannel = findOpenTicketByChannel;
exports.findTicketByChannel = findTicketByChannel;
exports.findArchivedTicketByChannel = findArchivedTicketByChannel;
exports.createTicketEntry = createTicketEntry;
exports.archiveTicketByChannel = archiveTicketByChannel;
exports.claimTicketByChannel = claimTicketByChannel;
exports.resolveTicketByChannel = resolveTicketByChannel;
exports.setTicketWorkflowStatus = setTicketWorkflowStatus;
exports.assignTicketToUser = assignTicketToUser;
exports.getTicketSlaState = getTicketSlaState;
exports.setTicketPanelMessageId = setTicketPanelMessageId;
exports.reopenTicketByChannel = reopenTicketByChannel;
const ticketSlaConfig_1 = require("./ticketSlaConfig");
function cloneTicket(ticket) {
    return {
        ...ticket,
        transcript: ticket.transcript ? { ...ticket.transcript } : null
    };
}
function restoreTicket(target, snapshot) {
    Object.assign(target, snapshot);
}
function normalizeTicketStatus(status) {
    if (status === "open" || status === "claimed" || status === "archived" || status === "resolved")
        return status;
    if (status === "closed")
        return "archived";
    return "open";
}
function normalizeTicketPriority(priority) {
    if (priority === "low" || priority === "normal" || priority === "high")
        return priority;
    return "normal";
}
function normalizeTicketWorkflowStatus(status) {
    if (status === "new" || status === "responded" || status === "waiting_user" || status === "escalated" || status === "resolved")
        return status;
    return "new";
}
function canTransitionTicketStatus(fromStatus, toStatus) {
    const from = normalizeTicketStatus(fromStatus);
    const to = normalizeTicketStatus(toStatus);
    if (from === to)
        return true;
    if (from === "open")
        return to === "claimed" || to === "archived";
    if (from === "claimed")
        return to === "archived";
    if (from === "archived")
        return to === "claimed" || to === "resolved";
    return false;
}
function findOpenTicketByOwner(tickets, guildId, ownerId) {
    return tickets.find(t => t.guildId === guildId && t.ownerId === ownerId && (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed")) || null;
}
function findOpenTicketByChannel(tickets, channelId) {
    return tickets.find(t => t.channelId === channelId && (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed")) || null;
}
function findTicketByChannel(tickets, channelId) {
    return tickets.find(t => t.channelId === channelId) || null;
}
function findArchivedTicketByChannel(tickets, channelId) {
    return tickets.find(t => t.channelId === channelId && normalizeTicketStatus(t.status) === "archived") || null;
}
function createTicketEntry(store, guildId, ownerId, channelId, reason, priority, save) {
    const originalNextId = store.nextId;
    const ticket = {
        id: store.nextId++,
        guildId,
        ownerId,
        channelId,
        reason,
        status: "open",
        priority,
        workflowStatus: "new",
        claimedById: null,
        assignedToId: null,
        panelMessageId: null,
        firstResponseAt: null,
        archivedAt: null,
        resolvedAt: null,
        closedReason: null,
        resolvedReason: null,
        transcript: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        category: "general",
        tags: [],
        linkedTicketId: null,
        parentTicketId: null,
        childTicketIds: [],
        mergedIntoTicketId: null,
        reopenUntilAt: null,
        reopenedCount: 0,
        internalNotes: [],
        csat: null
    };
    store.tickets.push(ticket);
    if (save()) {
        return ticket;
    }
    store.tickets.pop();
    store.nextId = originalNextId;
    return null;
}
function archiveTicketByChannel(tickets, channelId, closeReason, save) {
    const ticket = tickets.find(t => t.channelId === channelId && (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed"));
    if (!ticket)
        return null;
    if (!canTransitionTicketStatus(ticket.status, "archived"))
        return null;
    const snapshot = cloneTicket(ticket);
    ticket.status = "archived";
    ticket.workflowStatus = "waiting_user";
    ticket.archivedAt = Date.now();
    ticket.closedReason = closeReason;
    ticket.updatedAt = Date.now();
    if (save()) {
        return ticket;
    }
    restoreTicket(ticket, snapshot);
    return null;
}
function claimTicketByChannel(tickets, channelId, claimedById, save) {
    const ticket = tickets.find(t => t.channelId === channelId && (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed"));
    if (!ticket)
        return null;
    if (!canTransitionTicketStatus(ticket.status, "claimed"))
        return null;
    const snapshot = cloneTicket(ticket);
    ticket.status = "claimed";
    ticket.workflowStatus = "responded";
    ticket.claimedById = claimedById;
    if (!ticket.assignedToId)
        ticket.assignedToId = claimedById;
    if (!ticket.firstResponseAt)
        ticket.firstResponseAt = Date.now();
    ticket.updatedAt = Date.now();
    if (save()) {
        return ticket;
    }
    restoreTicket(ticket, snapshot);
    return null;
}
function resolveTicketByChannel(tickets, channelId, resolvedReason, transcript, save) {
    const ticket = tickets.find(t => t.channelId === channelId && normalizeTicketStatus(t.status) === "archived");
    if (!ticket)
        return null;
    if (!canTransitionTicketStatus(ticket.status, "resolved"))
        return null;
    const snapshot = cloneTicket(ticket);
    ticket.status = "resolved";
    ticket.workflowStatus = "resolved";
    ticket.resolvedAt = Date.now();
    ticket.resolvedReason = resolvedReason;
    ticket.transcript = transcript;
    ticket.updatedAt = Date.now();
    if (save()) {
        return ticket;
    }
    restoreTicket(ticket, snapshot);
    return null;
}
function setTicketWorkflowStatus(tickets, channelId, workflowStatus, save) {
    const ticket = tickets.find(t => t.channelId === channelId);
    if (!ticket)
        return null;
    const status = normalizeTicketStatus(ticket.status);
    if (status !== "open" && status !== "claimed")
        return null;
    const snapshot = cloneTicket(ticket);
    ticket.workflowStatus = workflowStatus;
    if (workflowStatus === "responded" && !ticket.firstResponseAt)
        ticket.firstResponseAt = Date.now();
    ticket.updatedAt = Date.now();
    if (save()) {
        return ticket;
    }
    restoreTicket(ticket, snapshot);
    return null;
}
function assignTicketToUser(tickets, channelId, assigneeId, save) {
    const ticket = tickets.find(t => {
        const status = normalizeTicketStatus(t.status);
        return t.channelId === channelId && (status === "open" || status === "claimed");
    });
    if (!ticket)
        return null;
    const snapshot = cloneTicket(ticket);
    ticket.assignedToId = assigneeId;
    if (normalizeTicketStatus(ticket.status) === "open")
        ticket.status = "claimed";
    ticket.workflowStatus = "responded";
    if (!ticket.firstResponseAt)
        ticket.firstResponseAt = Date.now();
    ticket.updatedAt = Date.now();
    if (save()) {
        return ticket;
    }
    restoreTicket(ticket, snapshot);
    return null;
}
function getTicketSlaState(ticket, now = Date.now(), thresholds = ticketSlaConfig_1.TICKET_SLA_THRESHOLDS_MS) {
    const firstResponseOverdue = !ticket.firstResponseAt && now - ticket.createdAt > thresholds.firstResponseBreachMs;
    const resolveOverdue = normalizeTicketStatus(ticket.status) !== "resolved" && now - ticket.createdAt > thresholds.resolveBreachMs;
    return { firstResponseOverdue, resolveOverdue };
}
function setTicketPanelMessageId(tickets, channelId, panelMessageId, save) {
    const ticket = tickets.find(t => t.channelId === channelId);
    if (!ticket)
        return;
    const snapshot = cloneTicket(ticket);
    ticket.panelMessageId = panelMessageId;
    ticket.updatedAt = Date.now();
    if (!save()) {
        restoreTicket(ticket, snapshot);
    }
}
function reopenTicketByChannel(tickets, channelId, reopenedById, reopenReason, save) {
    const ticket = tickets.find(t => t.channelId === channelId && normalizeTicketStatus(t.status) === "archived");
    if (!ticket)
        return null;
    if (!canTransitionTicketStatus(ticket.status, "claimed"))
        return null;
    if (ticket.reopenUntilAt && Date.now() > ticket.reopenUntilAt)
        return null;
    const snapshot = cloneTicket(ticket);
    ticket.status = "claimed";
    ticket.workflowStatus = "responded";
    ticket.claimedById = reopenedById;
    if (!ticket.assignedToId) {
        ticket.assignedToId = reopenedById;
    }
    if (!ticket.firstResponseAt) {
        ticket.firstResponseAt = Date.now();
    }
    ticket.archivedAt = null;
    ticket.closedReason = reopenReason || ticket.closedReason;
    ticket.resolvedAt = null;
    ticket.resolvedReason = null;
    ticket.reopenedCount = (ticket.reopenedCount || 0) + 1;
    ticket.updatedAt = Date.now();
    if (save()) {
        return ticket;
    }
    restoreTicket(ticket, snapshot);
    return null;
}
