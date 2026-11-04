// Ticket types, storage, routing, and retention.
import { Guild } from "discord.js";
import fs from "fs-extra";
import {
    classifyTicketCategory, findPotentialDuplicateTickets, getKbSuggestions, getTicketSlaPolicy,
    pickLeastLoadedAssignee, shouldPurgeResolvedTicket
} from "../../services/ticketEnhancements";
import { normalizeTicketChecklist } from "../../features/staffDesk";
import {
    canTransitionTicketStatus as stateCanTransitionTicketStatus,
    findArchivedTicketByChannel as stateFindArchivedTicketByChannel,
    findOpenTicketByChannel as stateFindOpenTicketByChannel, findTicketByChannel as stateFindTicketByChannel,
    normalizeTicketPriority as stateNormalizeTicketPriority, normalizeTicketStatus as stateNormalizeTicketStatus,
    normalizeTicketWorkflowStatus as stateNormalizeTicketWorkflowStatus,
    type TicketPriority as StateTicketPriority, type TicketRecord as StateTicketRecord,
    type TicketStoreState as StateTicketStoreState, type TicketWorkflowStatus as StateTicketWorkflowStatus
} from "../../services/ticketState";
import type { TicketCsatRecord, TicketNote } from "../../services/ticketEnhancements";
import { TICKET_DATA_FILE, TICKET_HANDLER_ROLE_ID } from "../core/config";
import { client } from "../core/client";
import { recordSaveResult } from "../core/settings";
import { runAsyncWithBoundary } from "../core/metrics";
import { appendAuditEvent } from "../core/audit";
import { readJsonWithBackup, writeJsonAtomic } from "../core/storage";
import { assignTicketToUser } from "./records";
import { updateTicketOpsPanelMessage } from "./opsPanel";

type TicketConfig = {
    categoryId: string | null;
    archiveCategoryId: string | null;
    logChannelId: string | null;
    retentionDays: number | null;
    reopenWindowHours: number | null;
    exportWebhookUrl: string | null;
};

export type TicketPriority = StateTicketPriority;
export type TicketWorkflowStatus = StateTicketWorkflowStatus;
export type TicketEntry = StateTicketRecord;
type TicketStore = StateTicketStoreState & {
    guildConfigs: Record<string, TicketConfig>;
};

export type TicketSanityReport = {
    total: number;
    open: number;
    claimed: number;
    archived: number;
    resolved: number;
    missingChannels: number;
    duplicateOpenOwners: number;
    panelMissing: number;
    slaBreaches: number;
};

type TicketRowLike = {
    id?: unknown;
    guildId?: unknown;
    ownerId?: unknown;
    channelId?: unknown;
    reason?: unknown;
    status?: unknown;
    priority?: unknown;
    workflowStatus?: unknown;
    claimedById?: unknown;
    assignedToId?: unknown;
    panelMessageId?: unknown;
    firstResponseAt?: unknown;
    archivedAt?: unknown;
    resolvedAt?: unknown;
    closedReason?: unknown;
    resolvedReason?: unknown;
    transcript?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    category?: unknown;
    tags?: unknown;
    linkedTicketId?: unknown;
    parentTicketId?: unknown;
    childTicketIds?: unknown;
    mergedIntoTicketId?: unknown;
    reopenUntilAt?: unknown;
    reopenedCount?: unknown;
    internalNotes?: unknown;
    watchers?: unknown;
    events?: unknown;
    slaPausedAt?: unknown;
    slaPausedMs?: unknown;
    csat?: unknown;
    slaPolicy?: unknown;
    checklist?: unknown;
};

export type ComponentLike = {
    customId?: string | null;
};

export type ComponentRowLike = {
    components?: ComponentLike[] | null;
};

export type MessageWithComponents = {
    components?: ComponentRowLike[] | null;
};

export function normalizeTicketStatus(status: unknown): TicketEntry["status"] {
    return stateNormalizeTicketStatus(status);
}

export function normalizeTicketPriority(priority: unknown): TicketPriority {
    return stateNormalizeTicketPriority(priority);
}

export function normalizeTicketWorkflowStatus(status: unknown): TicketWorkflowStatus {
    return stateNormalizeTicketWorkflowStatus(status);
}

export function canTransitionTicketStatus(fromStatus: unknown, toStatus: unknown): boolean {
    return stateCanTransitionTicketStatus(fromStatus, toStatus);
}

function normalizeTicketFromRaw(ticketRaw: TicketRowLike): TicketEntry | null {
    const transcriptRaw = ticketRaw.transcript && typeof ticketRaw.transcript === "object"
        ? ticketRaw.transcript as Record<string, unknown>
        : null;

    const transcript = transcriptRaw
        ? {
            exportedAt: typeof transcriptRaw.exportedAt === "number" ? transcriptRaw.exportedAt : Date.now(),
            messageCountApprox: typeof transcriptRaw.messageCountApprox === "number" ? transcriptRaw.messageCountApprox : 0,
            firstMessageAt: typeof transcriptRaw.firstMessageAt === "number" ? transcriptRaw.firstMessageAt : null,
            lastMessageAt: typeof transcriptRaw.lastMessageAt === "number" ? transcriptRaw.lastMessageAt : null,
            channelName: String(transcriptRaw.channelName || "unknown"),
            transcriptPath: transcriptRaw.transcriptPath ? String(transcriptRaw.transcriptPath) : undefined,
            transcriptFormat: transcriptRaw.transcriptFormat === "txt" ? ("txt" as const) : undefined
        }
        : null;

    const notesRaw = Array.isArray(ticketRaw.internalNotes) ? ticketRaw.internalNotes : [];
    const internalNotes: TicketNote[] = notesRaw
        .map(note => {
            const cast = note as Record<string, unknown>;
            if (!cast || typeof cast !== "object") return null;
            const byId = typeof cast.byId === "string" ? cast.byId : "";
            const at = typeof cast.at === "number" ? cast.at : Date.now();
            const text = typeof cast.note === "string" ? cast.note : "";
            if (!byId || !text) return null;
            return { byId, at, note: text.slice(0, 500) };
        })
        .filter((note): note is TicketNote => note !== null);

    const csatRaw = ticketRaw.csat && typeof ticketRaw.csat === "object"
        ? ticketRaw.csat as Record<string, unknown>
        : null;
    const csat: TicketCsatRecord | null = csatRaw
        ? {
            rating: Math.max(1, Math.min(5, Number(csatRaw.rating) || 5)),
            submittedAt: typeof csatRaw.submittedAt === "number" ? csatRaw.submittedAt : Date.now(),
            submittedById: typeof csatRaw.submittedById === "string" ? csatRaw.submittedById : "unknown",
            ...(typeof csatRaw.comment === "string" ? { comment: csatRaw.comment.slice(0, 300) } : {})
        }
        : null;

    const rawCategory = typeof ticketRaw.category === "string" ? ticketRaw.category : "general";
    const category = classifyTicketCategory(rawCategory);
    const priority = normalizeTicketPriority(ticketRaw.priority);
    const derivedPolicy = getTicketSlaPolicy(category, priority);
    const rawSla = ticketRaw.slaPolicy && typeof ticketRaw.slaPolicy === "object"
        ? ticketRaw.slaPolicy as Record<string, unknown>
        : null;

    const normalized: TicketEntry = {
        id: Number(ticketRaw.id) || 0,
        guildId: String(ticketRaw.guildId || ""),
        ownerId: String(ticketRaw.ownerId || ""),
        channelId: String(ticketRaw.channelId || ""),
        reason: String(ticketRaw.reason || "General support"),
        status: normalizeTicketStatus(ticketRaw.status),
        priority,
        workflowStatus: normalizeTicketWorkflowStatus(ticketRaw.workflowStatus),
        claimedById: ticketRaw.claimedById ? String(ticketRaw.claimedById) : null,
        assignedToId: ticketRaw.assignedToId ? String(ticketRaw.assignedToId) : null,
        panelMessageId: ticketRaw.panelMessageId ? String(ticketRaw.panelMessageId) : null,
        firstResponseAt: typeof ticketRaw.firstResponseAt === "number" ? ticketRaw.firstResponseAt : null,
        archivedAt: typeof ticketRaw.archivedAt === "number" ? ticketRaw.archivedAt : null,
        resolvedAt: typeof ticketRaw.resolvedAt === "number" ? ticketRaw.resolvedAt : null,
        closedReason: ticketRaw.closedReason ? String(ticketRaw.closedReason) : null,
        resolvedReason: ticketRaw.resolvedReason ? String(ticketRaw.resolvedReason) : null,
        transcript,
        createdAt: typeof ticketRaw.createdAt === "number" ? ticketRaw.createdAt : Date.now(),
        updatedAt: typeof ticketRaw.updatedAt === "number" ? ticketRaw.updatedAt : Date.now(),
        category,
        tags: Array.isArray(ticketRaw.tags) ? ticketRaw.tags.map(tag => String(tag).slice(0, 30)) : [],
        linkedTicketId: typeof ticketRaw.linkedTicketId === "number" ? ticketRaw.linkedTicketId : null,
        parentTicketId: typeof ticketRaw.parentTicketId === "number" ? ticketRaw.parentTicketId : null,
        childTicketIds: Array.isArray(ticketRaw.childTicketIds) ? ticketRaw.childTicketIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0) : [],
        mergedIntoTicketId: typeof ticketRaw.mergedIntoTicketId === "number" ? ticketRaw.mergedIntoTicketId : null,
        reopenUntilAt: typeof ticketRaw.reopenUntilAt === "number" ? ticketRaw.reopenUntilAt : null,
        reopenedCount: typeof ticketRaw.reopenedCount === "number" ? ticketRaw.reopenedCount : 0,
        internalNotes,
        watchers: Array.isArray(ticketRaw.watchers) ? ticketRaw.watchers.map(id => String(id)).filter(Boolean).slice(0, 25) : [],
        events: Array.isArray(ticketRaw.events) ? ticketRaw.events.map(event => {
            const entry = event as Record<string, unknown>;
            return { at: typeof entry.at === "number" ? entry.at : Date.now(), actorId: String(entry.actorId || "unknown"), type: String(entry.type || "update").slice(0, 40), detail: String(entry.detail || "").slice(0, 300) };
        }).filter(event => event.detail).slice(-100) : [],
        slaPausedAt: typeof ticketRaw.slaPausedAt === "number" ? ticketRaw.slaPausedAt : null,
        slaPausedMs: typeof ticketRaw.slaPausedMs === "number" ? Math.max(0, ticketRaw.slaPausedMs) : 0,
        checklist: normalizeTicketChecklist(ticketRaw.checklist),
        csat,
        slaPolicy: {
            name: typeof rawSla?.name === "string" ? rawSla.name : derivedPolicy.name,
            firstResponseMs: typeof rawSla?.firstResponseMs === "number" ? rawSla.firstResponseMs : derivedPolicy.firstResponseMs,
            resolveMs: typeof rawSla?.resolveMs === "number" ? rawSla.resolveMs : derivedPolicy.resolveMs
        }
    };

    if (!(normalized.id > 0 && normalized.guildId && normalized.ownerId && normalized.channelId)) {
        return null;
    }

    return normalized;
}

function readTicketStore(): TicketStore {
    return readJsonWithBackup(TICKET_DATA_FILE, raw => {
        const candidate = raw as Partial<TicketStore>;
        if (candidate && typeof candidate.nextId === "number" && candidate.guildConfigs && Array.isArray(candidate.tickets)) {
            const normalizedTickets = candidate.tickets
                .map(ticketRaw => normalizeTicketFromRaw((ticketRaw && typeof ticketRaw === "object") ? (ticketRaw as TicketRowLike) : {}))
                .filter((ticket): ticket is TicketEntry => ticket !== null);

            const normalizedStore: TicketStore = {
                nextId: Math.max(1, candidate.nextId),
                version: typeof candidate.version === "number" && candidate.version > 0 ? Math.floor(candidate.version) : 1,
                guildConfigs: candidate.guildConfigs,
                tickets: normalizedTickets
            };
            return normalizedStore;
        }
        return null;
    }, { nextId: 1, version: 1, guildConfigs: {}, tickets: [] });
}

export const ticketStore = readTicketStore();

export const TICKET_RESPONSE_TEMPLATES: Record<string, string> = {
    ack: "Thanks for the detailed report. A handler has been notified and will review the case shortly.",
    evidence: "Please provide the relevant screenshots, logs, timestamps, or message links so we can continue the investigation.",
    resolved: "This case has been resolved. Reply within the reopen window if the issue persists."
};
export const TICKET_TEMPLATE_IDS = {
    ack: "ticket_template_ack",
    evidence: "ticket_template_evidence",
    resolved: "ticket_template_resolved"
} as const;

export function recordTicketEvent(ticket: TicketEntry, actorId: string, type: string, detail: string): void {
    const event = { at: Date.now(), actorId, type: type.slice(0, 40), detail: detail.slice(0, 300) };
    ticket.events = [...(ticket.events || []), event].slice(-100);
    runAsyncWithBoundary("ticketWatcherNotification", () => notifyTicketWatchers(ticket, event));
}

async function notifyTicketWatchers(ticket: TicketEntry, event: { at: number; actorId: string; type: string; detail: string }): Promise<void> {
    for (const watcherId of ticket.watchers || []) {
        if (watcherId === event.actorId) continue;
        const watcher = await client.users.fetch(watcherId).catch(() => null);
        if (!watcher) continue;
        await watcher.send(`Ticket #${ticket.id} update: ${event.type}\n${event.detail}`).catch(() => undefined);
    }
}

export function addTicketWatcher(ticket: TicketEntry, watcherId: string): boolean {
    ticket.watchers = Array.from(new Set([...(ticket.watchers || []), watcherId])).slice(0, 25);
    recordTicketEvent(ticket, watcherId, "watcher_added", `Watcher <@${watcherId}> subscribed to this ticket.`);
    return saveTicketStore();
}

function readDiskTicketStoreVersion(): number | null {
    if (!fs.existsSync(TICKET_DATA_FILE)) return null;
    try {
        const raw = fs.readJsonSync(TICKET_DATA_FILE) as { version?: unknown };
        if (typeof raw.version !== "number" || raw.version <= 0) {
            return 1;
        }
        return Math.floor(raw.version);
    } catch {
        return null;
    }
}

export function saveTicketStore(): boolean {
    const diskVersion = readDiskTicketStoreVersion();
    if (diskVersion !== null && diskVersion !== ticketStore.version) {
        appendAuditEvent("ticket_store_version_conflict", {
            expectedVersion: ticketStore.version,
            diskVersion
        });
        return false;
    }

    const previousVersion = ticketStore.version;
    ticketStore.version = previousVersion + 1;
    try {
        writeJsonAtomic(TICKET_DATA_FILE, ticketStore);
        recordSaveResult("tickets", true);
        return true;
    } catch (error) {
        ticketStore.version = previousVersion;
        recordSaveResult("tickets", false, error);
        return false;
    }
}

export function ensureTicketConfig(guildId: string): TicketConfig {
    if (!ticketStore.guildConfigs[guildId]) {
        ticketStore.guildConfigs[guildId] = {
            categoryId: null,
            archiveCategoryId: null,
            logChannelId: null,
            retentionDays: 45,
            reopenWindowHours: 72,
            exportWebhookUrl: null
        };
        saveTicketStore();
    }

    const cfg = ticketStore.guildConfigs[guildId];
    if (cfg.categoryId === undefined) cfg.categoryId = null;
    if (cfg.archiveCategoryId === undefined) cfg.archiveCategoryId = null;
    if (cfg.logChannelId === undefined) cfg.logChannelId = null;
    if (cfg.retentionDays === undefined) cfg.retentionDays = 45;
    if (cfg.reopenWindowHours === undefined) cfg.reopenWindowHours = 72;
    if (cfg.exportWebhookUrl === undefined) cfg.exportWebhookUrl = null;
    return cfg;
}

export type TicketCaseBucket = "support" | "report";

export function getTicketCaseBucket(categoryOrReason: string | null | undefined): TicketCaseBucket {
    return classifyTicketCategory(categoryOrReason || "general") === "report" ? "report" : "support";
}

export function findOpenTicketByOwnerInBucket(guildId: string, ownerId: string, bucket: TicketCaseBucket): TicketEntry | null {
    return ticketStore.tickets.find(ticket =>
        ticket.guildId === guildId
        && ticket.ownerId === ownerId
        && (normalizeTicketStatus(ticket.status) === "open" || normalizeTicketStatus(ticket.status) === "claimed")
        && getTicketCaseBucket(ticket.category || ticket.reason) === bucket
    ) || null;
}

export function findOpenTicketByChannel(channelId: string): TicketEntry | null {
    return stateFindOpenTicketByChannel(ticketStore.tickets, channelId);
}

export function findTicketByChannel(channelId: string): TicketEntry | null {
    return stateFindTicketByChannel(ticketStore.tickets, channelId);
}

export function findArchivedTicketByChannel(channelId: string): TicketEntry | null {
    return stateFindArchivedTicketByChannel(ticketStore.tickets, channelId);
}

export function findTicketById(ticketId: number): TicketEntry | null {
    return ticketStore.tickets.find(ticket => ticket.id === ticketId) || null;
}

export function buildTicketSlaThresholds(ticket: TicketEntry): { firstResponseWarnMs: number; firstResponseBreachMs: number; resolveWarnMs: number; resolveBreachMs: number } {
    const policy = ticket.slaPolicy || getTicketSlaPolicy(ticket.category || "general", ticket.priority);
    const firstResponseBreachMs = Math.max(2 * 60 * 1000, policy.firstResponseMs);
    const resolveBreachMs = Math.max(2 * 60 * 60 * 1000, policy.resolveMs);
    return {
        firstResponseWarnMs: Math.max(60_000, Math.floor(firstResponseBreachMs * 0.66)),
        firstResponseBreachMs,
        resolveWarnMs: Math.max(firstResponseBreachMs, Math.floor(resolveBreachMs * 0.84)),
        resolveBreachMs
    };
}

export async function autoRouteTicket(guild: Guild, ticket: TicketEntry): Promise<void> {
    const role = guild.roles.cache.get(TICKET_HANDLER_ROLE_ID) || await guild.roles.fetch(TICKET_HANDLER_ROLE_ID).catch(() => null);
    if (!role) return;

    const handlerIds = Array.from(role.members.values())
        .filter(member => !member.user.bot)
        .map(member => member.id);
    const best = pickLeastLoadedAssignee(handlerIds, ticketStore.tickets);
    if (!best) return;

    const assigned = assignTicketToUser(ticket.channelId, best);
    if (!assigned) return;
    await updateTicketOpsPanelMessage(guild, assigned);
    appendAuditEvent("ticket_auto_route", {
        guildId: guild.id,
        ticketId: assigned.id,
        assignedToId: best,
        category: assigned.category || "general",
        policy: assigned.slaPolicy?.name || "default"
    });
}

export function evaluateTicketDeflection(guildId: string, ownerId: string, reason: string): { blocked: boolean; message?: string } {
    const duplicates = findPotentialDuplicateTickets({
        tickets: ticketStore.tickets,
        guildId,
        ownerId,
        reason,
        lookbackMs: 21 * 24 * 60 * 60 * 1000
    });
    const kb = getKbSuggestions(reason);
    if (!duplicates.length) return { blocked: false };

    const dupLines = duplicates
        .slice(0, 3)
        .map(d => `• #${d.ticketId} (${d.status}) similarity ${(d.score * 100).toFixed(0)}%`)
        .join("\n");

    return {
        blocked: true,
        message: [
            "Potential duplicate detected. Try these first:",
            kb.map(item => `• ${item}`).join("\n"),
            "Recent related tickets:",
            dupLines,
            "If you still need a new case, run /ticketforce."
        ].join("\n")
    };
}

export function applyTicketMetadata(ticket: TicketEntry, reason: string): void {
    ticket.category = classifyTicketCategory(reason);
    ticket.slaPolicy = getTicketSlaPolicy(ticket.category, ticket.priority);
    ticket.tags = Array.from(new Set([ticket.category, ticket.priority]));
    ticket.updatedAt = Date.now();
    saveTicketStore();
}

export function purgeResolvedTicketsByRetention(guildId: string, now = Date.now()): number {
    const cfg = ensureTicketConfig(guildId);
    const retentionDays = Math.max(1, Number(cfg.retentionDays || 45));
    const before = ticketStore.tickets.length;
    ticketStore.tickets = ticketStore.tickets.filter(ticket => !(
        ticket.guildId === guildId && shouldPurgeResolvedTicket(ticket, retentionDays, now)
    ));
    const removed = before - ticketStore.tickets.length;
    if (removed > 0) {
        saveTicketStore();
        appendAuditEvent("ticket_retention_purge", { guildId, retentionDays, removed });
    }
    return removed;
}
