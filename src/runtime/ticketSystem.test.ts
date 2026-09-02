import assert from "node:assert/strict";
import {
    archiveTicketByChannel,
    assignTicketToUser,
    canTransitionTicketStatus,
    claimTicketByChannel,
    createTicketEntry,
    findArchivedTicketByChannel,
    findOpenTicketByChannel,
    getTicketSlaState,
    normalizeTicketPriority,
    normalizeTicketStatus,
    reopenTicketByChannel,
    resolveTicketByChannel,
    setTicketPanelMessageId,
    setTicketWorkflowStatus,
    type TicketRecord,
    type TicketStoreState
} from "../services/ticketState";
import { getTicketSlaEscalationState } from "../services/ticketOps";
import type { TicketSlaThresholdsMs } from "../services/ticketSlaConfig";
import { clampTranscriptLine, sanitizeTranscriptLine } from "../services/ticketText";

function makeStore(): TicketStoreState {
    return {
        nextId: 1,
        version: 1,
        tickets: []
    };
}

function runTicketSystemTests(): void {
    const store = makeStore();
    let saveCount = 0;
    const save = () => {
        saveCount += 1;
        store.version += 1;
        return true;
    };

    const created = createTicketEntry(store, "g1", "u-owner", "c-1", "Need help", "normal", save);
    assert.ok(created);
    assert.equal(store.tickets.length, 1);
    assert.equal(created?.events?.[0]?.type, "created");
    assert.equal(normalizeTicketStatus("closed"), "archived");
    assert.equal(normalizeTicketPriority("invalid"), "normal");
    assert.equal(canTransitionTicketStatus("open", "claimed"), true);
    assert.equal(canTransitionTicketStatus("resolved", "open"), false);

    const claimed = claimTicketByChannel(store.tickets, "c-1", "u-handler", save);
    assert.ok(claimed);
    assert.equal(claimed?.status, "claimed");
    assert.equal(claimed?.assignedToId, "u-handler");

    const assigned = assignTicketToUser(store.tickets, "c-1", "u-2", save);
    assert.ok(assigned);
    assert.equal(assigned?.assignedToId, "u-2");
    assert.ok((assigned?.events || []).some(event => event.type === "assigned"));

    const statusSet = setTicketWorkflowStatus(store.tickets, "c-1", "waiting_user", save);
    assert.ok(statusSet);
    assert.equal(statusSet?.workflowStatus, "waiting_user");

    setTicketPanelMessageId(store.tickets, "c-1", "m-111", save);
    assert.equal(store.tickets[0].panelMessageId, "m-111");

    const archived = archiveTicketByChannel(store.tickets, "c-1", "Need more info", save);
    assert.ok(archived);
    assert.equal(findArchivedTicketByChannel(store.tickets, "c-1")?.status, "archived");

    const reopened = reopenTicketByChannel(store.tickets, "c-1", "u-handler", "user replied", save);
    assert.ok(reopened);
    assert.equal(reopened?.status, "claimed");

    const reArchived = archiveTicketByChannel(store.tickets, "c-1", "Ready to close", save);
    assert.ok(reArchived);

    const resolved = resolveTicketByChannel(store.tickets, "c-1", "done", { exportedAt: Date.now(), messageCountApprox: 4, firstMessageAt: null, lastMessageAt: null, channelName: "ops", transcriptFormat: "txt", transcriptPath: "x.txt" }, save);
    assert.ok(resolved);
    assert.equal(resolved?.status, "resolved");
    assert.ok((resolved?.events || []).some(event => event.type === "resolved"));
    assert.equal(findOpenTicketByChannel(store.tickets, "c-1"), null);

    const strictThresholds: TicketSlaThresholdsMs = {
        firstResponseWarnMs: 1_000,
        firstResponseBreachMs: 2_000,
        resolveWarnMs: 4_000,
        resolveBreachMs: 8_000
    };
    const now = Date.now();
    const pendingTicket: TicketRecord = {
        id: 99,
        guildId: "g1",
        ownerId: "u-owner",
        channelId: "c-99",
        reason: "Bug",
        status: "open",
        priority: "high",
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
        createdAt: now - 9_000,
        updatedAt: now - 9_000
    };

    const escalation = getTicketSlaEscalationState(
        { createdAt: pendingTicket.createdAt, firstResponseAt: pendingTicket.firstResponseAt, status: pendingTicket.status },
        now,
        strictThresholds
    );
    assert.equal(escalation.firstResponseWarn, true);
    assert.equal(escalation.firstResponseBreach, true);
    assert.equal(escalation.resolveWarn, true);
    assert.equal(escalation.resolveBreach, true);

    const overdue = getTicketSlaState(pendingTicket, now, strictThresholds);
    assert.equal(overdue.firstResponseOverdue, true);
    assert.equal(overdue.resolveOverdue, true);
    const pausedTicket: TicketRecord = { ...pendingTicket, workflowStatus: "waiting_user", slaPausedAt: now - 20_000, slaPausedMs: 0 };
    const pausedSla = getTicketSlaState(pausedTicket, now, strictThresholds);
    assert.equal(pausedSla.firstResponseOverdue, false);
    assert.equal(pausedSla.resolveOverdue, false);

    const failedSaveStore = makeStore();
    const saveFail = () => false;
    const failedCreate = createTicketEntry(failedSaveStore, "g1", "owner", "c-fail", "x", "low", saveFail);
    assert.equal(failedCreate, null);
    assert.equal(failedSaveStore.tickets.length, 0);

    const rollbackStore = makeStore();
    const okCreate = createTicketEntry(rollbackStore, "g1", "owner", "c-rollback", "x", "normal", () => true);
    assert.ok(okCreate);
    const failedClaim = claimTicketByChannel(rollbackStore.tickets, "c-rollback", "handler", () => false);
    assert.equal(failedClaim, null);
    assert.equal(rollbackStore.tickets[0].status, "open");

    assert.equal(sanitizeTranscriptLine("hello\nworld"), "hello world");
    assert.equal(sanitizeTranscriptLine("Email user@example.com token=abc123 123456789012"), "Email [email redacted] token: [redacted] [number redacted]");
    assert.equal(clampTranscriptLine("x".repeat(5000)).length <= 1802, true);
    assert.ok(saveCount >= 8);
}

runTicketSystemTests();
console.log("ticket system tests passed");
