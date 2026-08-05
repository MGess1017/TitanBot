import { TICKET_SLA_THRESHOLDS_MS, type TicketSlaThresholdsMs } from "./ticketSlaConfig";

export type TicketStatus = "open" | "claimed" | "archived" | "resolved";
export type TicketPriority = "low" | "normal" | "high";
export type TicketWorkflowStatus = "new" | "responded" | "waiting_user" | "escalated" | "resolved";

export type TicketTranscriptData = {
    exportedAt: number;
    messageCountApprox: number;
    firstMessageAt: number | null;
    lastMessageAt: number | null;
    channelName: string;
    transcriptPath?: string;
    transcriptFormat?: "txt";
    truncated?: boolean;
    fetchErrors?: number;
};

export type TicketRecord = {
    id: number;
    guildId: string;
    ownerId: string;
    channelId: string;
    reason: string;
    status: TicketStatus;
    priority: TicketPriority;
    workflowStatus: TicketWorkflowStatus;
    claimedById: string | null;
    assignedToId: string | null;
    panelMessageId: string | null;
    firstResponseAt: number | null;
    archivedAt: number | null;
    resolvedAt: number | null;
    closedReason: string | null;
    resolvedReason: string | null;
    transcript: TicketTranscriptData | null;
    createdAt: number;
    updatedAt: number;
    category?: string;
    tags?: string[];
    linkedTicketId?: number | null;
    parentTicketId?: number | null;
    childTicketIds?: number[];
    mergedIntoTicketId?: number | null;
    reopenUntilAt?: number | null;
    reopenedCount?: number;
    internalNotes?: Array<{ byId: string; at: number; note: string }>;
    csat?: { rating: number; submittedAt: number; submittedById: string; comment?: string } | null;
    slaPolicy?: { name: string; firstResponseMs: number; resolveMs: number };
};

export type TicketStoreState = {
    nextId: number;
    version: number;
    tickets: TicketRecord[];
};

type SaveTicketStore = () => boolean;

function cloneTicket(ticket: TicketRecord): TicketRecord {
    return {
        ...ticket,
        transcript: ticket.transcript ? { ...ticket.transcript } : null
    };
}

function restoreTicket(target: TicketRecord, snapshot: TicketRecord): void {
    Object.assign(target, snapshot);
}

export function normalizeTicketStatus(status: unknown): TicketStatus {
    if (status === "open" || status === "claimed" || status === "archived" || status === "resolved") return status;
    if (status === "closed") return "archived";
    return "open";
}

export function normalizeTicketPriority(priority: unknown): TicketPriority {
    if (priority === "low" || priority === "normal" || priority === "high") return priority;
    return "normal";
}

export function normalizeTicketWorkflowStatus(status: unknown): TicketWorkflowStatus {
    if (status === "new" || status === "responded" || status === "waiting_user" || status === "escalated" || status === "resolved") return status;
    return "new";
}

export function canTransitionTicketStatus(fromStatus: unknown, toStatus: unknown): boolean {
    const from = normalizeTicketStatus(fromStatus);
    const to = normalizeTicketStatus(toStatus);
    if (from === to) return true;

    if (from === "open") return to === "claimed" || to === "archived";
    if (from === "claimed") return to === "archived";
    if (from === "archived") return to === "claimed" || to === "resolved";
    return false;
}

export function findOpenTicketByOwner(tickets: TicketRecord[], guildId: string, ownerId: string): TicketRecord | null {
    return tickets.find(t => t.guildId === guildId && t.ownerId === ownerId && (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed")) || null;
}

export function findOpenTicketByChannel(tickets: TicketRecord[], channelId: string): TicketRecord | null {
    return tickets.find(t => t.channelId === channelId && (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed")) || null;
}

export function findTicketByChannel(tickets: TicketRecord[], channelId: string): TicketRecord | null {
    return tickets.find(t => t.channelId === channelId) || null;
}

export function findArchivedTicketByChannel(tickets: TicketRecord[], channelId: string): TicketRecord | null {
    return tickets.find(t => t.channelId === channelId && normalizeTicketStatus(t.status) === "archived") || null;
}

export function createTicketEntry(
    store: TicketStoreState,
    guildId: string,
    ownerId: string,
    channelId: string,
    reason: string,
    priority: TicketPriority,
    save: SaveTicketStore
): TicketRecord | null {
    const originalNextId = store.nextId;
    const ticket: TicketRecord = {
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

export function archiveTicketByChannel(tickets: TicketRecord[], channelId: string, closeReason: string, save: SaveTicketStore): TicketRecord | null {
    const ticket = tickets.find(t => t.channelId === channelId && (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed"));
    if (!ticket) return null;
    if (!canTransitionTicketStatus(ticket.status, "archived")) return null;

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

export function claimTicketByChannel(tickets: TicketRecord[], channelId: string, claimedById: string, save: SaveTicketStore): TicketRecord | null {
    const ticket = tickets.find(t => t.channelId === channelId && (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed"));
    if (!ticket) return null;
    if (!canTransitionTicketStatus(ticket.status, "claimed")) return null;

    const snapshot = cloneTicket(ticket);
    ticket.status = "claimed";
    ticket.workflowStatus = "responded";
    ticket.claimedById = claimedById;
    if (!ticket.assignedToId) ticket.assignedToId = claimedById;
    if (!ticket.firstResponseAt) ticket.firstResponseAt = Date.now();
    ticket.updatedAt = Date.now();

    if (save()) {
        return ticket;
    }

    restoreTicket(ticket, snapshot);
    return null;
}

export function resolveTicketByChannel(
    tickets: TicketRecord[],
    channelId: string,
    resolvedReason: string,
    transcript: TicketTranscriptData | null,
    save: SaveTicketStore
): TicketRecord | null {
    const ticket = tickets.find(t => t.channelId === channelId && normalizeTicketStatus(t.status) === "archived");
    if (!ticket) return null;
    if (!canTransitionTicketStatus(ticket.status, "resolved")) return null;

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

export function setTicketWorkflowStatus(
    tickets: TicketRecord[],
    channelId: string,
    workflowStatus: TicketWorkflowStatus,
    save: SaveTicketStore
): TicketRecord | null {
    const ticket = tickets.find(t => t.channelId === channelId);
    if (!ticket) return null;
    const status = normalizeTicketStatus(ticket.status);
    if (status !== "open" && status !== "claimed") return null;

    const snapshot = cloneTicket(ticket);
    ticket.workflowStatus = workflowStatus;
    if (workflowStatus === "responded" && !ticket.firstResponseAt) ticket.firstResponseAt = Date.now();
    ticket.updatedAt = Date.now();

    if (save()) {
        return ticket;
    }

    restoreTicket(ticket, snapshot);
    return null;
}

export function assignTicketToUser(tickets: TicketRecord[], channelId: string, assigneeId: string, save: SaveTicketStore): TicketRecord | null {
    const ticket = tickets.find(t => {
        const status = normalizeTicketStatus(t.status);
        return t.channelId === channelId && (status === "open" || status === "claimed");
    });
    if (!ticket) return null;

    const snapshot = cloneTicket(ticket);
    ticket.assignedToId = assigneeId;
    if (normalizeTicketStatus(ticket.status) === "open") ticket.status = "claimed";
    ticket.workflowStatus = "responded";
    if (!ticket.firstResponseAt) ticket.firstResponseAt = Date.now();
    ticket.updatedAt = Date.now();

    if (save()) {
        return ticket;
    }

    restoreTicket(ticket, snapshot);
    return null;
}

export function getTicketSlaState(
    ticket: Pick<TicketRecord, "firstResponseAt" | "createdAt" | "status">,
    now = Date.now(),
    thresholds: TicketSlaThresholdsMs = TICKET_SLA_THRESHOLDS_MS
): { firstResponseOverdue: boolean; resolveOverdue: boolean } {
    const firstResponseOverdue = !ticket.firstResponseAt && now - ticket.createdAt > thresholds.firstResponseBreachMs;
    const resolveOverdue = normalizeTicketStatus(ticket.status) !== "resolved" && now - ticket.createdAt > thresholds.resolveBreachMs;
    return { firstResponseOverdue, resolveOverdue };
}

export function setTicketPanelMessageId(tickets: TicketRecord[], channelId: string, panelMessageId: string, save: SaveTicketStore): void {
    const ticket = tickets.find(t => t.channelId === channelId);
    if (!ticket) return;

    const snapshot = cloneTicket(ticket);
    ticket.panelMessageId = panelMessageId;
    ticket.updatedAt = Date.now();
    if (!save()) {
        restoreTicket(ticket, snapshot);
    }
}

export function reopenTicketByChannel(
    tickets: TicketRecord[],
    channelId: string,
    reopenedById: string,
    reopenReason: string,
    save: SaveTicketStore
): TicketRecord | null {
    const ticket = tickets.find(t => t.channelId === channelId && normalizeTicketStatus(t.status) === "archived");
    if (!ticket) return null;
    if (!canTransitionTicketStatus(ticket.status, "claimed")) return null;
    if (ticket.reopenUntilAt && Date.now() > ticket.reopenUntilAt) return null;

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
