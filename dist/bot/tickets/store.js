"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TICKET_TEMPLATE_IDS = exports.TICKET_RESPONSE_TEMPLATES = exports.ticketStore = void 0;
exports.normalizeTicketStatus = normalizeTicketStatus;
exports.normalizeTicketPriority = normalizeTicketPriority;
exports.normalizeTicketWorkflowStatus = normalizeTicketWorkflowStatus;
exports.canTransitionTicketStatus = canTransitionTicketStatus;
exports.recordTicketEvent = recordTicketEvent;
exports.addTicketWatcher = addTicketWatcher;
exports.saveTicketStore = saveTicketStore;
exports.ensureTicketConfig = ensureTicketConfig;
exports.getTicketCaseBucket = getTicketCaseBucket;
exports.findOpenTicketByOwnerInBucket = findOpenTicketByOwnerInBucket;
exports.findOpenTicketByChannel = findOpenTicketByChannel;
exports.findTicketByChannel = findTicketByChannel;
exports.findArchivedTicketByChannel = findArchivedTicketByChannel;
exports.findTicketById = findTicketById;
exports.buildTicketSlaThresholds = buildTicketSlaThresholds;
exports.autoRouteTicket = autoRouteTicket;
exports.evaluateTicketDeflection = evaluateTicketDeflection;
exports.applyTicketMetadata = applyTicketMetadata;
exports.purgeResolvedTicketsByRetention = purgeResolvedTicketsByRetention;
const fs_extra_1 = __importDefault(require("fs-extra"));
const ticketEnhancements_1 = require("../../services/ticketEnhancements");
const staffDesk_1 = require("../../features/staffDesk");
const ticketState_1 = require("../../services/ticketState");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const settings_1 = require("../core/settings");
const metrics_1 = require("../core/metrics");
const audit_1 = require("../core/audit");
const storage_1 = require("../core/storage");
const records_1 = require("./records");
const opsPanel_1 = require("./opsPanel");
function normalizeTicketStatus(status) {
    return (0, ticketState_1.normalizeTicketStatus)(status);
}
function normalizeTicketPriority(priority) {
    return (0, ticketState_1.normalizeTicketPriority)(priority);
}
function normalizeTicketWorkflowStatus(status) {
    return (0, ticketState_1.normalizeTicketWorkflowStatus)(status);
}
function canTransitionTicketStatus(fromStatus, toStatus) {
    return (0, ticketState_1.canTransitionTicketStatus)(fromStatus, toStatus);
}
function normalizeTicketFromRaw(ticketRaw) {
    const transcriptRaw = ticketRaw.transcript && typeof ticketRaw.transcript === "object"
        ? ticketRaw.transcript
        : null;
    const transcript = transcriptRaw
        ? {
            exportedAt: typeof transcriptRaw.exportedAt === "number" ? transcriptRaw.exportedAt : Date.now(),
            messageCountApprox: typeof transcriptRaw.messageCountApprox === "number" ? transcriptRaw.messageCountApprox : 0,
            firstMessageAt: typeof transcriptRaw.firstMessageAt === "number" ? transcriptRaw.firstMessageAt : null,
            lastMessageAt: typeof transcriptRaw.lastMessageAt === "number" ? transcriptRaw.lastMessageAt : null,
            channelName: String(transcriptRaw.channelName || "unknown"),
            transcriptPath: transcriptRaw.transcriptPath ? String(transcriptRaw.transcriptPath) : undefined,
            transcriptFormat: transcriptRaw.transcriptFormat === "txt" ? "txt" : undefined,
            truncated: transcriptRaw.truncated === true,
            fetchErrors: typeof transcriptRaw.fetchErrors === "number" ? transcriptRaw.fetchErrors : 0
        }
        : null;
    const notesRaw = Array.isArray(ticketRaw.internalNotes) ? ticketRaw.internalNotes : [];
    const internalNotes = notesRaw
        .map(note => {
        const cast = note;
        if (!cast || typeof cast !== "object")
            return null;
        const byId = typeof cast.byId === "string" ? cast.byId : "";
        const at = typeof cast.at === "number" ? cast.at : Date.now();
        const text = typeof cast.note === "string" ? cast.note : "";
        if (!byId || !text)
            return null;
        return { byId, at, note: text.slice(0, 500) };
    })
        .filter((note) => note !== null);
    const csatRaw = ticketRaw.csat && typeof ticketRaw.csat === "object"
        ? ticketRaw.csat
        : null;
    const csat = csatRaw
        ? {
            rating: Math.max(1, Math.min(5, Number(csatRaw.rating) || 5)),
            submittedAt: typeof csatRaw.submittedAt === "number" ? csatRaw.submittedAt : Date.now(),
            submittedById: typeof csatRaw.submittedById === "string" ? csatRaw.submittedById : "unknown",
            ...(typeof csatRaw.comment === "string" ? { comment: csatRaw.comment.slice(0, 300) } : {})
        }
        : null;
    const rawCategory = typeof ticketRaw.category === "string" ? ticketRaw.category : "general";
    const category = (0, ticketEnhancements_1.classifyTicketCategory)(rawCategory);
    const priority = normalizeTicketPriority(ticketRaw.priority);
    const derivedPolicy = (0, ticketEnhancements_1.getTicketSlaPolicy)(category, priority);
    const rawSla = ticketRaw.slaPolicy && typeof ticketRaw.slaPolicy === "object"
        ? ticketRaw.slaPolicy
        : null;
    const normalized = {
        id: Number(ticketRaw.id) || 0,
        guildId: String(ticketRaw.guildId || ""),
        ownerId: String(ticketRaw.ownerId || ""),
        channelId: String(ticketRaw.channelId || ""),
        reason: String(ticketRaw.reason || "General support"),
        intakeSummary: typeof ticketRaw.intakeSummary === "string" ? ticketRaw.intakeSummary.slice(0, 120) : undefined,
        intakeCategory: typeof ticketRaw.intakeCategory === "string" ? ticketRaw.intakeCategory.slice(0, 40) : undefined,
        intakeDetails: typeof ticketRaw.intakeDetails === "string" ? ticketRaw.intakeDetails.slice(0, 700) : undefined,
        intakePlatform: typeof ticketRaw.intakePlatform === "string" ? ticketRaw.intakePlatform.slice(0, 80) : undefined,
        intakeEvidence: typeof ticketRaw.intakeEvidence === "string" ? ticketRaw.intakeEvidence.slice(0, 400) : undefined,
        intakeOrderId: typeof ticketRaw.intakeOrderId === "string" ? ticketRaw.intakeOrderId.slice(0, 80) : undefined,
        lastReplyAt: typeof ticketRaw.lastReplyAt === "number" ? ticketRaw.lastReplyAt : undefined,
        lastReplyBy: ticketRaw.lastReplyBy === "member" || ticketRaw.lastReplyBy === "staff" ? ticketRaw.lastReplyBy : undefined,
        closureRequestedAt: typeof ticketRaw.closureRequestedAt === "number" ? ticketRaw.closureRequestedAt : null,
        closureRequestedBy: typeof ticketRaw.closureRequestedBy === "string" ? ticketRaw.closureRequestedBy : null,
        notifications: normalizeTicketNotifications(ticketRaw.notifications),
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
            const entry = event;
            return { at: typeof entry.at === "number" ? entry.at : Date.now(), actorId: String(entry.actorId || "unknown"), type: String(entry.type || "update").slice(0, 40), detail: String(entry.detail || "").slice(0, 300) };
        }).filter(event => event.detail).slice(-100) : [],
        slaPausedAt: typeof ticketRaw.slaPausedAt === "number" ? ticketRaw.slaPausedAt : null,
        slaPausedMs: typeof ticketRaw.slaPausedMs === "number" ? Math.max(0, ticketRaw.slaPausedMs) : 0,
        checklist: (0, staffDesk_1.normalizeTicketChecklist)(ticketRaw.checklist),
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
    function normalizeTicketNotifications(raw) {
        const entries = {};
        if (!raw || typeof raw !== "object")
            return entries;
        for (const [kind, value] of Object.entries(raw)) {
            if (!value || typeof value !== "object")
                continue;
            const item = value;
            if (typeof item.key === "string" && typeof item.at === "number")
                entries[kind] = { key: item.key.slice(0, 200), at: item.at };
        }
        return entries;
    }
    return normalized;
}
function readTicketStore() {
    return (0, storage_1.readJsonWithBackup)(config_1.TICKET_DATA_FILE, raw => {
        const candidate = raw;
        if (candidate && typeof candidate.nextId === "number" && candidate.guildConfigs && Array.isArray(candidate.tickets)) {
            const normalizedTickets = candidate.tickets
                .map(ticketRaw => normalizeTicketFromRaw((ticketRaw && typeof ticketRaw === "object") ? ticketRaw : {}))
                .filter((ticket) => ticket !== null);
            const normalizedStore = {
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
exports.ticketStore = readTicketStore();
exports.TICKET_RESPONSE_TEMPLATES = {
    ack: "Thanks for the detailed report. A handler has been notified and will review the case shortly.",
    evidence: "Please provide the relevant screenshots, logs, timestamps, or message links so we can continue the investigation.",
    resolved: "This case has been resolved. Reply within the reopen window if the issue persists."
};
exports.TICKET_TEMPLATE_IDS = {
    ack: "ticket_template_ack",
    evidence: "ticket_template_evidence",
    resolved: "ticket_template_resolved"
};
function recordTicketEvent(ticket, actorId, type, detail) {
    const event = { at: Date.now(), actorId, type: type.slice(0, 40), detail: detail.slice(0, 300) };
    ticket.events = [...(ticket.events || []), event].slice(-100);
    (0, metrics_1.runAsyncWithBoundary)("ticketWatcherNotification", () => notifyTicketWatchers(ticket, event));
}
const ticketWatcherNotifications = new Set();
async function notifyTicketWatchers(ticket, event) {
    const cfg = ensureTicketConfig(ticket.guildId);
    if (!cfg.notificationsEnabled)
        return;
    for (const watcherId of ticket.watchers || []) {
        if (watcherId === event.actorId)
            continue;
        const kind = `watcher:${watcherId}`;
        const key = `${event.at}:${event.type}:${event.actorId}`;
        const previous = ticket.notifications?.[kind];
        const lock = `${ticket.id}:${kind}`;
        if (ticketWatcherNotifications.has(lock) || previous?.key === key
            || (previous && Date.now() - previous.at < (cfg.reminderMinutes || 30) * 60000))
            continue;
        ticketWatcherNotifications.add(lock);
        try {
            const watcher = await client_1.client.users.fetch(watcherId);
            await watcher.send({
                content: `Ticket #${ticket.id} update: ${event.type}\n${event.detail}\nhttps://discord.com/channels/${ticket.guildId}/${ticket.channelId}`,
                allowedMentions: { parse: [] }
            });
            ticket.notifications = { ...(ticket.notifications || {}), [kind]: { key, at: Date.now() } };
            saveTicketStore();
        }
        catch (error) {
            console.warn(`Could not notify watcher ${watcherId} about ticket #${ticket.id}:`, error);
        }
        finally {
            ticketWatcherNotifications.delete(lock);
        }
    }
}
function addTicketWatcher(ticket, watcherId) {
    ticket.watchers = Array.from(new Set([...(ticket.watchers || []), watcherId])).slice(0, 25);
    recordTicketEvent(ticket, watcherId, "watcher_added", `Watcher <@${watcherId}> subscribed to this ticket.`);
    return saveTicketStore();
}
function readDiskTicketStoreVersion() {
    if (!fs_extra_1.default.existsSync(config_1.TICKET_DATA_FILE))
        return null;
    try {
        const raw = fs_extra_1.default.readJsonSync(config_1.TICKET_DATA_FILE);
        if (typeof raw.version !== "number" || raw.version <= 0) {
            return 1;
        }
        return Math.floor(raw.version);
    }
    catch {
        return null;
    }
}
function saveTicketStore() {
    const diskVersion = readDiskTicketStoreVersion();
    if (diskVersion !== null && diskVersion !== exports.ticketStore.version) {
        (0, audit_1.appendAuditEvent)("ticket_store_version_conflict", {
            expectedVersion: exports.ticketStore.version,
            diskVersion
        });
        (0, settings_1.recordSaveResult)("tickets", false, new Error(`Ticket store version conflict: expected ${exports.ticketStore.version}, found ${diskVersion}`));
        return false;
    }
    const previousVersion = exports.ticketStore.version;
    exports.ticketStore.version = previousVersion + 1;
    try {
        (0, storage_1.writeJsonAtomicSync)(config_1.TICKET_DATA_FILE, exports.ticketStore);
        (0, settings_1.recordSaveResult)("tickets", true);
        return true;
    }
    catch (error) {
        exports.ticketStore.version = previousVersion;
        (0, settings_1.recordSaveResult)("tickets", false, error);
        return false;
    }
}
function ensureTicketConfig(guildId) {
    if (!exports.ticketStore.guildConfigs[guildId]) {
        exports.ticketStore.guildConfigs[guildId] = {
            categoryId: null,
            archiveCategoryId: null,
            logChannelId: null,
            retentionDays: 45,
            reopenWindowHours: 72,
            exportWebhookUrl: null
        };
        saveTicketStore();
    }
    const cfg = exports.ticketStore.guildConfigs[guildId];
    if (cfg.categoryId === undefined)
        cfg.categoryId = null;
    if (cfg.archiveCategoryId === undefined)
        cfg.archiveCategoryId = null;
    if (cfg.logChannelId === undefined)
        cfg.logChannelId = null;
    if (cfg.retentionDays === undefined)
        cfg.retentionDays = 45;
    if (cfg.reopenWindowHours === undefined)
        cfg.reopenWindowHours = 72;
    if (cfg.exportWebhookUrl === undefined)
        cfg.exportWebhookUrl = null;
    if (typeof cfg.notificationsEnabled !== "boolean")
        cfg.notificationsEnabled = true;
    if (!Number.isFinite(cfg.reminderMinutes) || (cfg.reminderMinutes || 0) < 5 || (cfg.reminderMinutes || 0) > 1440)
        cfg.reminderMinutes = 30;
    return cfg;
}
function getTicketCaseBucket(categoryOrReason) {
    return (0, ticketEnhancements_1.classifyTicketCategory)(categoryOrReason || "general") === "report" ? "report" : "support";
}
function findOpenTicketByOwnerInBucket(guildId, ownerId, bucket) {
    return exports.ticketStore.tickets.find(ticket => ticket.guildId === guildId
        && ticket.ownerId === ownerId
        && (normalizeTicketStatus(ticket.status) === "open" || normalizeTicketStatus(ticket.status) === "claimed")
        && getTicketCaseBucket(ticket.category || ticket.reason) === bucket) || null;
}
function findOpenTicketByChannel(channelId) {
    return (0, ticketState_1.findOpenTicketByChannel)(exports.ticketStore.tickets, channelId);
}
function findTicketByChannel(channelId) {
    return (0, ticketState_1.findTicketByChannel)(exports.ticketStore.tickets, channelId);
}
function findArchivedTicketByChannel(channelId) {
    return (0, ticketState_1.findArchivedTicketByChannel)(exports.ticketStore.tickets, channelId);
}
function findTicketById(ticketId) {
    return exports.ticketStore.tickets.find(ticket => ticket.id === ticketId) || null;
}
function buildTicketSlaThresholds(ticket) {
    const policy = ticket.slaPolicy || (0, ticketEnhancements_1.getTicketSlaPolicy)(ticket.category || "general", ticket.priority);
    const firstResponseBreachMs = Math.max(2 * 60 * 1000, policy.firstResponseMs);
    const resolveBreachMs = Math.max(2 * 60 * 60 * 1000, policy.resolveMs);
    return {
        firstResponseWarnMs: Math.max(60000, Math.floor(firstResponseBreachMs * 0.66)),
        firstResponseBreachMs,
        resolveWarnMs: Math.max(firstResponseBreachMs, Math.floor(resolveBreachMs * 0.84)),
        resolveBreachMs
    };
}
async function autoRouteTicket(guild, ticket) {
    const role = guild.roles.cache.get(config_1.TICKET_HANDLER_ROLE_ID) || await guild.roles.fetch(config_1.TICKET_HANDLER_ROLE_ID).catch(() => null);
    if (!role)
        return;
    const handlerIds = Array.from(role.members.values())
        .filter(member => !member.user.bot)
        .map(member => member.id);
    const best = (0, ticketEnhancements_1.pickLeastLoadedAssignee)(handlerIds, exports.ticketStore.tickets.filter(entry => entry.guildId === guild.id));
    if (!best)
        return;
    const assigned = (0, records_1.assignTicketToUser)(ticket.channelId, best);
    if (!assigned)
        return;
    await (0, opsPanel_1.updateTicketOpsPanelMessage)(guild, assigned);
    (0, audit_1.appendAuditEvent)("ticket_auto_route", {
        guildId: guild.id,
        ticketId: assigned.id,
        assignedToId: best,
        category: assigned.category || "general",
        policy: assigned.slaPolicy?.name || "default"
    });
}
function evaluateTicketDeflection(guildId, ownerId, reason) {
    const duplicates = (0, ticketEnhancements_1.findPotentialDuplicateTickets)({
        tickets: exports.ticketStore.tickets,
        guildId,
        ownerId,
        reason,
        lookbackMs: 21 * 24 * 60 * 60 * 1000
    });
    const kb = (0, ticketEnhancements_1.getKbSuggestions)(reason);
    if (!duplicates.length)
        return { blocked: false };
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
function applyTicketMetadata(ticket, reason) {
    ticket.category = (0, ticketEnhancements_1.classifyTicketCategory)(reason);
    ticket.slaPolicy = (0, ticketEnhancements_1.getTicketSlaPolicy)(ticket.category, ticket.priority);
    ticket.tags = Array.from(new Set([ticket.category, ticket.priority]));
    ticket.updatedAt = Date.now();
    saveTicketStore();
}
function purgeResolvedTicketsByRetention(guildId, now = Date.now()) {
    const cfg = ensureTicketConfig(guildId);
    const retentionDays = Math.max(1, Number(cfg.retentionDays || 45));
    const before = exports.ticketStore.tickets.length;
    exports.ticketStore.tickets = exports.ticketStore.tickets.filter(ticket => !(ticket.guildId === guildId && (0, ticketEnhancements_1.shouldPurgeResolvedTicket)(ticket, retentionDays, now)));
    const removed = before - exports.ticketStore.tickets.length;
    if (removed > 0) {
        saveTicketStore();
        (0, audit_1.appendAuditEvent)("ticket_retention_purge", { guildId, retentionDays, removed });
    }
    return removed;
}
