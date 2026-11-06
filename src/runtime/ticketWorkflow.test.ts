import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Collection, EmbedBuilder,
    MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder
} from "discord.js";
import {
    applyTicketReply, isTicketReplyOverdue, isTicketTopic, pruneTicketDrafts, ticketDisplayStatus,
    ticketNotificationTarget, TicketActionCoordinator, TICKET_TOPICS, type TicketDraft
} from "../services/ticketExperience";
import { assignTicketToUser, claimTicketByChannel, createTicketEntry, type TicketRecord } from "../services/ticketState";
import { clampTranscriptLine, sanitizeTranscriptLine } from "../services/ticketText";
import { classifyTicketCategory, getTicketSlaPolicy } from "../services/ticketEnhancements";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };
const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "titan-ticket-workflow-"));

function load(names: string[], dependencies: Record<string, unknown>) {
    const wanted = new Set(names);
    const nodes = source.statements.filter(node =>
        ts.isFunctionDeclaration(node) ? wanted.has(node.name?.text || "")
            : ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
                ts.isIdentifier(declaration.name) && wanted.has(declaration.name.text)));
    assert.equal(nodes.length, names.length);
    const context = vm.createContext({ exports: {}, console, ...dependencies });
    vm.runInContext(ts.transpileModule(nodes.map(node => node.getText(source)).join("\n"), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText, context);
    return context;
}

function makeTicket(id = 1): TicketRecord {
    const ticket = createTicketEntry({ nextId: id, version: 1, tickets: [] }, "guild", "owner", `channel-${id}`, "Help", "normal", () => true);
    assert.ok(ticket);
    return ticket;
}

type Reply = { content?: string; components?: unknown[]; embeds?: EmbedBuilder[]; flags?: number };

async function run(): Promise<void> {
    const ticket = makeTicket();
    const start = ticket.createdAt;
    assert.equal(applyTicketReply(ticket, "visitor", false, start + 1), false);
    assert.equal(applyTicketReply(ticket, "owner", false, start + 2), true);
    assert.equal(ticketDisplayStatus(ticket), "Waiting for staff");
    assert.equal(isTicketReplyOverdue(ticket, start + 2 + 15 * 60_000), true);
    assert.equal(applyTicketReply(ticket, "staff", true, start + 3, true), true);
    assert.equal(ticketDisplayStatus(ticket), "Waiting for you");
    assert.equal(ticket.firstResponseAt, start + 3);
    assert.equal(isTicketReplyOverdue(ticket, start + 3 + 24 * 60 * 60_000), false);
    assert.equal(applyTicketReply(ticket, "owner", false, start + 2), false, "out-of-order messages cannot regress status");
    ticket.status = "archived";
    assert.equal(applyTicketReply(ticket, "owner", false, start + 4), false);
    ticket.status = "open";
    ticket.assignedToId = "handler";
    assert.equal(ticketNotificationTarget(ticket, "member_reply"), "handler");
    assert.equal(ticketNotificationTarget(ticket, "staff_reply"), "owner");
    const awaitingReply = makeTicket(99);
    claimTicketByChannel([awaitingReply], awaitingReply.channelId, "staff", () => true);
    assignTicketToUser([awaitingReply], awaitingReply.channelId, "handler", () => true);
    assert.equal(awaitingReply.firstResponseAt, null, "claiming/assignment must not count as an actual staff reply");
    const normalizerCtx = load(["normalizeTicketFromRaw"], {
        classifyTicketCategory, getTicketSlaPolicy,
        normalizeTicketPriority: (value: string) => value || "normal",
        normalizeTicketStatus: (value: string) => value,
        normalizeTicketWorkflowStatus: (value: string) => value,
        normalizeTicketChecklist: (value: unknown) => value || {}
    });
    const normalize = (normalizerCtx as { normalizeTicketFromRaw: (value: unknown) => TicketRecord }).normalizeTicketFromRaw;
    const stored = normalize({ ...makeTicket(98), intakeDetails: "First | Second", lastReplyAt: start,
        lastReplyBy: "member", closureRequestedAt: start, notifications: { reminder: { key: "saved", at: start } } });
    assert.equal(stored.intakeDetails, "First | Second", "structured intake survives restarts without delimiter loss");
    assert.equal(stored.lastReplyBy, "member");
    assert.equal(stored.notifications?.reminder.key, "saved");
    assert.equal(stored.closureRequestedAt, start);

    const locks = new TicketActionCoordinator();
    let unblock: () => void = () => {};
    const pending = locks.run("a", async () => { await new Promise<void>(resolve => { unblock = resolve; }); return "done"; });
    let becameIdle = false;
    const waiting = locks.whenIdle("a").then(() => { becameIdle = true; });
    await Promise.resolve();
    assert.equal(becameIdle, false, "replies wait until the active action completes");
    assert.match(await locks.run("a", async () => "bad"), /Another action/);
    assert.equal(await locks.run("b", async () => "independent"), "independent");
    unblock();
    assert.equal(await pending, "done");
    await waiting;
    assert.equal(becameIdle, true);
    await assert.rejects(locks.run("a", async () => { throw new Error("failure"); }), /failure/);
    assert.equal(locks.isBusy("a"), false, "action locks release after failures");

    const draft: TicketDraft = { category: "bug", summary: "Crash", details: "Opened inventory", evidence: "", at: Date.now() };
    assert.ok(isTicketTopic("bug"));
    assert.equal(isTicketTopic("made-up"), false);
    assert.equal(Object.keys(pruneTicketDrafts({ old: { ...draft, at: 0 }, fresh: draft }, Date.now())).length, 1);
    const draftFile = path.join(tmp, "ticket-drafts.json");
    const draftSource = ts.createSourceFile("drafts.ts", fs.readFileSync(path.resolve(__dirname, "../bot/tickets/drafts.ts"), "utf8"), ts.ScriptTarget.ES2020, true);
    const draftCode = draftSource.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(draftSource)).join("\n");
    const draftDependencies = {
        exports: {}, path, isTicketTopic, pruneTicketDrafts,
        TICKET_DATA_FILE: path.join(tmp, "tickets.json"),
        readJsonWithBackup: (file: string, validate: (value: unknown) => unknown, fallback: unknown) => fs.existsSync(file) ? validate(fs.readJsonSync(file)) : fallback,
        writeJsonAtomicSync: (file: string, value: unknown) => fs.writeJsonSync(file, value),
        recordSaveResult: () => {}
    };
    const loadDrafts = () => {
        const ctx = vm.createContext(draftDependencies);
        vm.runInContext(ts.transpileModule(draftCode, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, ctx);
        return ctx as {
            saveTicketDraft: (guild: string, owner: string, value: TicketDraft | null) => boolean;
            getTicketDraft: (guild: string, owner: string) => TicketDraft | undefined;
        };
    };
    let drafts = loadDrafts();
    assert.equal(drafts.saveTicketDraft("guild", "owner", draft), true);
    drafts = loadDrafts();
    assert.equal(drafts.getTicketDraft("guild", "owner")?.summary, "Crash", "drafts survive restart");
    assert.equal(drafts.getTicketDraft("guild", "other"), undefined, "drafts are scoped to the submitting member");
    assert.equal(drafts.saveTicketDraft("guild", "owner", null), true);
    assert.equal(loadDrafts().getTicketDraft("guild", "owner"), undefined);
    fs.removeSync(draftFile);

    const records = { tickets: Array.from({ length: 23 }, (_, index) => makeTicket(index + 1)) };
    records.tickets.push({ ...makeTicket(100), guildId: "another-guild" });
    let cfg = { notificationsEnabled: true, reminderMinutes: 5 };
    let sent = 0;
    let alerts = 0;
    let saveSucceeds = true;
    let dmFails = false;
    let resolved = 0;
    let resolutionReason = "";
    let currentDraft: TicketDraft | undefined = draft;
    const updates: number[] = [];
    const ctx = load([
        "TICKET_IDS", "notifying", "notifyTicketRecipient", "trackTicketReply", "runTicketReplyReminders",
        "buildTicketQueue", "buildResolveConfirmation", "handleTicketExperienceInteraction", "buildHandlerSelector",
        "buildTicketIntakeModal"
    ], {
        ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder,
        StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
        applyTicketReply, isTicketReplyOverdue, isTicketTopic, ticketActions: locks, ticketDisplayStatus, ticketNotificationTarget,
        TICKET_TOPICS, ticketStore: records,
        client: { users: { fetch: async () => ({ send: async () => { if (dmFails) throw new Error("DM disabled"); sent++; } }) } },
        ensureTicketConfig: () => cfg,
        saveTicketStore: () => saveSucceeds,
        postStaffAlert: async () => { alerts++; return {}; },
        getTicketDraft: () => currentDraft,
        canManageTicketActions: (member: { staff?: boolean }) => member.staff === true,
        findTicketByChannel: (channelId: string) => records.tickets.find(ticket => ticket.channelId === channelId),
        findTicketById: (id: number) => records.tickets.find(ticket => ticket.id === id),
        updateTicketOpsPanelMessage: async (_guild: unknown, value: TicketRecord) => { updates.push(value.id); },
        appendAuditEvent: () => {},
        resolveTicketChannel: async (_guild: unknown, _channel: string, _actor: string, reason: string) => { resolved++; resolutionReason = reason; return "Resolved"; },
        assignTicketToUser: () => records.tickets[0]
    });
    const api = ctx as {
        notifyTicketRecipient: (ticket: TicketRecord, kind: string, key: string) => Promise<boolean>;
        buildTicketQueue: (guild: string, filter?: string, page?: number) => { embeds: EmbedBuilder[]; components: unknown[] };
        buildResolveConfirmation: (ticket: TicketRecord, actor: string, reason?: string) => { components: ActionRowBuilder<ButtonBuilder>[]; embeds: EmbedBuilder[] };
        handleTicketExperienceInteraction: (interaction: unknown) => Promise<boolean>;
        trackTicketReply: (message: unknown) => Promise<void>;
        runTicketReplyReminders: (guild: unknown) => Promise<void>;
    };
    const ids = vm.runInContext("TICKET_IDS", ctx) as Record<string, string>;
    const queue = api.buildTicketQueue("guild");
    assert.equal(queue.components.length, 2);
    assert.equal((queue.embeds[0].data.description?.match(/Handler:/g) || []).length, 10, "queue pages contain at most 10 tickets");
    assert.ok(!queue.embeds[0].data.description?.includes("channel-100"), "queue cannot expose another guild");
    assert.match(api.buildTicketQueue("guild", "staff", 99).embeds[0].data.footer!.text, /Page 3\/3/);
    const recipient = records.tickets[0];
    recipient.assignedToId = "handler";
    assert.equal(await api.notifyTicketRecipient(recipient, "member_reply", "message-1"), true);
    assert.equal(await api.notifyTicketRecipient(recipient, "member_reply", "message-1"), true);
    assert.equal(sent, 1, "identical notification keys are deduplicated");
    const restored: TicketRecord = JSON.parse(JSON.stringify(recipient));
    await api.notifyTicketRecipient(restored, "member_reply", "message-1");
    assert.equal(sent, 1, "persisted notification records suppress repeats after restart");
    assert.equal(await api.notifyTicketRecipient(recipient, "member_reply", "message-2"), true);
    assert.equal(sent, 1, "bursts are throttled");
    recipient.notifications = {};
    cfg.notificationsEnabled = false;
    await api.notifyTicketRecipient(recipient, "member_reply", "message-3");
    assert.equal(sent, 1, "disabled notifications never send");
    cfg.notificationsEnabled = true;
    dmFails = true;
    assert.equal(await api.notifyTicketRecipient(recipient, "member_reply", "message-4"), false);
    assert.equal(recipient.notifications?.member_reply, undefined, "delivery failure is not recorded as success");
    dmFails = false;
    let watcherSent = 0;
    const watcherCtx = load(["ticketWatcherNotifications", "notifyTicketWatchers"], {
        ensureTicketConfig: () => cfg, saveTicketStore: () => true,
        client: { users: { fetch: async () => ({ send: async () => { watcherSent++; } }) } }
    });
    const notifyWatchers = (watcherCtx as { notifyTicketWatchers: (ticket: TicketRecord, event: unknown) => Promise<void> }).notifyTicketWatchers;
    recipient.watchers = ["watcher", "actor"];
    const event = { at: Date.now(), actorId: "actor", type: "update", detail: "Assigned" };
    await Promise.all([notifyWatchers(recipient, event), notifyWatchers(recipient, event)]);
    assert.equal(watcherSent, 1, "watchers exclude the actor and suppress simultaneous notifications");
    await notifyWatchers(JSON.parse(JSON.stringify(recipient)), event);
    assert.equal(watcherSent, 1, "watcher notification records survive restart");
    cfg.notificationsEnabled = false;
    recipient.notifications = {};
    await notifyWatchers(recipient, event);
    assert.equal(watcherSent, 1, "watchers respect the same notification settings");
    cfg.notificationsEnabled = true;
    recipient.assignedToId = null;
    await api.notifyTicketRecipient(recipient, "closure", "closure-1");
    assert.equal(alerts, 1, "unassigned cases alert staff without role pings");

    const replies: Reply[] = [];
    let shownModal: ModalBuilder | null = null;
    const interaction = (customId: string, staff = true, owner = "staff", values: string[] = []) => ({
        customId, guild: { id: "guild" }, channelId: recipient.channelId, member: { staff }, user: { id: owner }, values,
        message: { embeds: [] as EmbedBuilder[] },
        isMessageComponent: () => true, isModalSubmit: () => false, isButton: () => true,
        isStringSelectMenu: () => customId === ids.category, isUserSelectMenu: () => false,
        reply: async (reply: Reply) => { replies.push(reply); },
        deferReply: async (reply: Reply) => { replies.push(reply); },
        editReply: async (reply: Reply) => { replies.push(reply); },
        update: async (reply: Reply) => { replies.push(reply); },
        showModal: async (modal: ModalBuilder) => { shownModal = modal; }
    });
    await api.handleTicketExperienceInteraction(interaction(ids.queue, false));
    assert.equal(replies[replies.length - 1].content, "These tools are for support staff only.");
    await api.handleTicketExperienceInteraction(interaction(ids.queue));
    assert.equal(replies[replies.length - 1].flags, MessageFlags.Ephemeral);
    await api.handleTicketExperienceInteraction(interaction(ids.category, false, "owner", ["bug"]));
    const shown = shownModal as ModalBuilder | null;
    assert.equal(shown?.toJSON().custom_id, `${ids.intakeModal}:bug`);
    assert.equal(shown?.toJSON().components[0].components[0].value, "Crash", "retry drafts prefill the selected category form");
    currentDraft = undefined;
    await api.handleTicketExperienceInteraction(interaction(ids.retry, false, "owner"));
    assert.match(replies[replies.length - 1].content!, /expired/);
    await api.handleTicketExperienceInteraction(interaction(ids.requestClose, false, "other-member"));
    assert.match(replies[replies.length - 1].content!, /Only the member/);
    saveSucceeds = false;
    await api.handleTicketExperienceInteraction(interaction(ids.requestClose, false, "owner"));
    assert.match(replies[replies.length - 1].content!, /could not be saved/);
    assert.equal(recipient.closureRequestedAt, null, "failed saves roll back the closure request");
    saveSucceeds = true;
    await api.handleTicketExperienceInteraction(interaction(ids.requestClose, false, "owner"));
    assert.ok(recipient.closureRequestedAt);
    assert.equal(recipient.status, "open", "requesting closure never closes or deletes a ticket");
    recipient.status = "archived";
    const confirmation = api.buildResolveConfirmation(recipient, "staff").components[0].components[0].data.custom_id!;
    await api.handleTicketExperienceInteraction(interaction(confirmation, true, "another-staff"));
    assert.equal(resolved, 0, "another staff member cannot use the confirmation");
    recipient.updatedAt++;
    await api.handleTicketExperienceInteraction(interaction(confirmation));
    assert.equal(resolved, 0, "stale confirmations do not resolve tickets");
    const freshPayload = api.buildResolveConfirmation(recipient, "staff", "Issue confirmed fixed");
    const fresh = freshPayload.components[0].components[0].data.custom_id!;
    const remoteConfirmation = { ...interaction(fresh), channelId: "staff-command-channel",
        message: { embeds: [{ fields: freshPayload.embeds[0].toJSON().fields }] } };
    await api.handleTicketExperienceInteraction(remoteConfirmation);
    assert.equal(resolved, 1);
    assert.equal(resolutionReason, "Issue confirmed fixed", "confirmation preserves the slash reason and targets its ticket from another channel");
    recipient.status = "open";
    recipient.closureRequestedAt = null;
    recipient.lastReplyAt = undefined;
    recipient.firstResponseAt = null;
    recipient.notifications = {};
    const guild = { id: "guild", members: { fetch: async () => ({ staff: true }) } };
    await api.trackTicketReply({
        id: "member-message", guild, channelId: recipient.channelId, author: { id: "owner", bot: false },
        member: { staff: false }, content: "More details", attachments: new Map(), createdTimestamp: Date.now(),
        reply: async (reply: Reply) => { replies.push(reply); }
    });
    assert.equal(recipient.workflowStatus, "new");
    assert.ok(updates.includes(recipient.id));
    await api.trackTicketReply({
        id: "staff-message", guild, channelId: recipient.channelId, author: { id: "staff", bot: false },
        member: { staff: true }, content: "Reviewing your request", attachments: new Map(), createdTimestamp: Date.now() + 1,
        reply: async (reply: Reply) => { replies.push(reply); }
    });
    assert.equal(recipient.workflowStatus, "responded", "normal staff messages do not incorrectly request member information");
    const infoGuild = {
        id: "guild", channels: { cache: new Map([[recipient.channelId, {
            type: ChannelType.GuildText,
            send: async () => ({ id: "information-request", createdTimestamp: Date.now() + 10 })
        }]]) }
    };
    await api.handleTicketExperienceInteraction({
        ...interaction(ids.requestInfoModal), guild: infoGuild,
        isMessageComponent: () => false, isModalSubmit: () => true,
        fields: { getTextInputValue: () => "Please send the message link." }
    });
    assert.equal(recipient.workflowStatus, "waiting_user");
    assert.match(replies[replies.length - 1].content!, /waiting for the member/);
    recipient.workflowStatus = "new";
    recipient.lastReplyBy = "member";
    recipient.lastReplyAt = Date.now() - 31 * 60_000;
    recipient.assignedToId = "handler";
    recipient.notifications = {};
    const beforeReminder = sent;
    await api.runTicketReplyReminders({ id: "guild" });
    await api.runTicketReplyReminders({ id: "guild" });
    assert.equal(sent, beforeReminder + 1, "watchdog retries do not duplicate reminders");
    const oldCfg = { ...cfg };
    await api.handleTicketExperienceInteraction({
        ...interaction(ids.notificationModal), isMessageComponent: () => false, isModalSubmit: () => true,
        fields: { getTextInputValue: (key: string) => key === "enabled" ? "off" : "1" }
    });
    assert.deepEqual(cfg, oldCfg, "invalid reminder thresholds do not change settings");
    await api.handleTicketExperienceInteraction({
        ...interaction(ids.notificationModal), isMessageComponent: () => false, isModalSubmit: () => true,
        fields: { getTextInputValue: (key: string) => key === "enabled" ? "off" : "15" }
    });
    assert.equal(cfg.notificationsEnabled, false);
    assert.equal(cfg.reminderMinutes, 15);
    recipient.status = "archived";

    const transcriptSource = ts.createSourceFile("ticketTranscript.ts", fs.readFileSync(path.resolve(__dirname, "../services/ticketTranscript.ts"), "utf8"), ts.ScriptTarget.ES2020, true);
    const transcriptCode = transcriptSource.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(transcriptSource)).join("\n");
    const transcriptCtx = vm.createContext({ exports: {}, process, ChannelType, fs, path, createHash, sanitizeTranscriptLine, clampTranscriptLine });
    vm.runInContext(ts.transpileModule(transcriptCode, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, transcriptCtx);
    const exporter = (transcriptCtx as { exportTicketTranscript: (input: unknown) => Promise<{ transcriptPath: string; stub: { messageCountApprox: number; truncated: boolean; fetchErrors: number } }> }).exportTicketTranscript;
    const message = { id: "m1", createdTimestamp: Date.now(), author: { tag: "member", id: "owner" }, content: "Help " + "x".repeat(4000),
        attachments: new Collection([["a1", { url: "https://example.test/image.png" }]]),
        embeds: [new EmbedBuilder().setTitle("Ticket Content")] };
    let fetchFails = false;
    const channel = { id: "channel", name: "support", type: ChannelType.GuildText,
        messages: { fetch: async () => { if (fetchFails) throw new Error("Missing Permissions"); return new Collection([["m1", message]]); } } };
    const transcriptInput = {
        guild: { id: "guild", name: "FNT", channels: { cache: new Map([["channel", channel]]) } },
        channelId: "channel", ticketId: 1, ownerId: "owner", resolverId: "staff", resolvedReason: "Done",
        transcriptDir: path.join(tmp, "transcripts"), projectRootDir: tmp
    };
    const exported = await exporter(transcriptInput);
    assert.equal(exported.stub.truncated, false);
    assert.equal(exported.stub.fetchErrors, 0);
    const body = fs.readFileSync(path.join(tmp, exported.transcriptPath), "utf8");
    assert.match(body, /Ticket Content/);
    assert.match(body, /image\.png/);
    assert.match(body, /Fetch Errors: 0/);
    assert.ok(body.includes("x".repeat(4000)), "long message text must not be silently truncated");
    let messageTotal = 10_000;
    let page = 0;
    const largeChannel = { ...channel, messages: { fetch: async () => {
        const offset = page++ * 100;
        return new Collection(Array.from({ length: Math.max(0, Math.min(100, messageTotal - offset)) }, (_, index) => {
            const id = String(offset + index);
            return [id, { ...message, id, content: "ok", attachments: new Collection(), embeds: [] }] as const;
        }));
    } } };
    const largeInput = { ...transcriptInput, guild: { ...transcriptInput.guild,
        channels: { cache: new Map([["channel", largeChannel]]) } } };
    assert.equal((await exporter(largeInput)).stub.messageCountApprox, 10_000, "exactly 10,000 messages export completely");
    page = 0;
    messageTotal = 10_001;
    await assert.rejects(exporter(largeInput), /10,000-message export limit/, "over-limit tickets are never partially exported");
    fetchFails = true;
    await assert.rejects(exporter(transcriptInput), /Missing Permissions/, "incomplete exports must fail");
    fetchFails = false;
    const blocked = path.join(tmp, "not-a-directory");
    fs.writeFileSync(blocked, "blocked");
    await assert.rejects(exporter({ ...transcriptInput, transcriptDir: blocked }), /EEXIST|ENOTDIR/, "disk failures are surfaced");
    const badFs = { ...fs, readFileSync: () => Buffer.from("corrupted") };
    const badCtx = vm.createContext({ exports: {}, process, ChannelType, fs: badFs, path, createHash, sanitizeTranscriptLine, clampTranscriptLine });
    vm.runInContext(ts.transpileModule(transcriptCode, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, badCtx);
    await assert.rejects((badCtx as { exportTicketTranscript: (input: unknown) => Promise<unknown> }).exportTicketTranscript(transcriptInput), /verification failed/);

    let deletes = 0;
    let storedResolution = 0;
    let exportFails = true;
    let resolutionSaveFails = false;
    let deletionFails = false;
    const resolutionOrder: string[] = [];
    const resolveCtx = load(["performResolveTicketChannel"], {
        exportTicketTranscript: async () => { resolutionOrder.push("export"); if (exportFails) throw new Error("Disk full"); return exported; },
        findTicketByChannel: () => recipient,
        path, BOT_SRC_DIR: tmp, TICKET_TRANSCRIPT_DIR: tmp, EmbedBuilder,
        postStaffAlert: async () => { alerts++; return {}; },
        resolveTicketByChannel: () => { resolutionOrder.push("save"); storedResolution++; return resolutionSaveFails ? null : recipient; },
        ensureTicketConfig: () => ({ exportWebhookUrl: null }), TICKET_EXPORT_WEBHOOK_URL: null,
        sendTicketLog: async () => {}, appendAuditEvent: () => {},
        client: { users: { fetch: async () => null } }
    });
    const resolve = (resolveCtx as { performResolveTicketChannel: (guild: unknown, channel: string, actor: string, reason: string) => Promise<string> }).performResolveTicketChannel;
    const resolveGuild = { id: "guild", channels: { delete: async () => {
        resolutionOrder.push("delete"); if (deletionFails) throw new Error("Missing Permissions"); deletes++;
    } } };
    const result = await resolve(resolveGuild, recipient.channelId, "staff", "Done");
    assert.match(result, /preserved/);
    assert.equal(deletes, 0);
    assert.equal(storedResolution, 0, "failed transcripts neither resolve nor delete the case");
    exportFails = false;
    resolutionSaveFails = true;
    assert.match(await resolve(resolveGuild, recipient.channelId, "staff", "Done"), /resolution could not be saved/);
    assert.equal(deletes, 0, "failed state saves preserve the channel even after a verified export");
    resolutionSaveFails = false;
    resolutionOrder.length = 0;
    await resolve(resolveGuild, recipient.channelId, "staff", "Done");
    assert.deepEqual(resolutionOrder, ["export", "save", "delete"], "verified export and durable case save precede channel deletion");
    deletionFails = true;
    assert.match(await resolve(resolveGuild, recipient.channelId, "staff", "Done"), /deletion failed/);
    console.log("Ticket workflow, queue, drafts, notification throttling, locks, and verified transcript tests passed");
}
void run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.removeSync(tmp));
