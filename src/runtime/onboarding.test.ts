import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Collection, DiscordAPIError,
    EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type APIEmbed
} from "discord.js";
import { buildTicketIntakeReason, classifyTicketCategory, getTicketSlaPolicy, hydrateTicketIntakeFields, parseTicketIntakeSnapshot } from "../services/ticketEnhancements";
import { createTicketEntry, getTicketSlaState, normalizeTicketStatus, type TicketRecord } from "../services/ticketState";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };

const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
const functionNames = new Set([
    "buildBotFeatureBriefPayload", "upsertBotFeatureBriefInChannel", "buildTicketPanelPayload",
    "upsertTicketPanelInChannel", "messageHasTicketOpenButton", "buildTicketIntakeModal",
    "buildGettingStartedEmbed", "handleCommunityInteraction", "handleFormInteraction", "handleTicketButtonInteraction",
    "buildTicketOpsEmbed", "buildTicketOpsComponents", "buildTicketStaffEmbed", "buildTicketStaffComponents",
    "getTicketNextActionHint", "updateTicketOpsPanelMessage", "refreshTicketPanelsForGuild"
]);
const constantNames = new Set(["ONBOARDING_IDS", "HELP_IDS", "TICKET_IDS", "TICKET_TEMPLATE_IDS", "REPORT_IDS", "GIVEAWAY_IDS"]);
const selected = source.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && functionNames.has(node.name?.text || ""))
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
        ts.isIdentifier(declaration.name) && constantNames.has(declaration.name.text)))
);
assert.equal(selected.length, functionNames.size + constantNames.size);

type Reply = {
    content?: string;
    embeds?: Array<APIEmbed | EmbedBuilder>;
    components?: unknown[];
    flags?: number;
    allowedMentions?: { parse: string[] };
};
type Panel = { embed: APIEmbed; components: Array<{ components: Array<{ custom_id?: string }> }> };
type FakeMessage = {
    id: string;
    author: { id: string };
    embeds: APIEmbed[];
    components: unknown[];
    edit: (reply: Reply) => Promise<FakeMessage>;
    delete: () => Promise<void>;
};
let storedId: string | null = "saved";
const helpEvents: string[] = [];
const createEvents: string[] = [];
let createdReason = "";
let createError: string | undefined;
const ticket = createTicketEntry({ nextId: 41, version: 1, tickets: [] }, "guild", "owner", "channel",
    buildTicketIntakeReason({ category: "general", summary: "Missing raid loot", details: "I extracted but cannot find the loot." }),
    "normal", () => true);
assert.ok(ticket);
const tickets = { tickets: [ticket] };
const actionEvents: string[] = [];
const context = vm.createContext({
    exports: {}, console,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, DiscordAPIError, EmbedBuilder,
    MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
    MIN_RAID_BET: 10,
    PERMANENT_TICKET_PANEL_CHANNEL_ID: "1506119505720377434",
    STAFF_IDS: { home: "staff:home" },
    ticketStore: tickets,
    normalizeTicketStatus, hydrateTicketIntakeFields, getTicketSlaPolicy, getTicketSlaState,
    sanitizeEmbedBuilder: (embed: EmbedBuilder) => embed,
    canManageTicketActions: (member: { staff?: boolean }) => member.staff === true,
    findTicketByChannel: (channelId: string) => tickets.tickets.find(ticket => ticket.channelId === channelId),
    findOpenTicketByChannel: (channelId: string) => tickets.tickets.find(ticket =>
        ticket.channelId === channelId && ["open", "claimed"].includes(ticket.status)),
    findArchivedTicketByChannel: (channelId: string) => tickets.tickets.find(ticket =>
        ticket.channelId === channelId && ticket.status === "archived"),
    ensureTrackedTicketByChannelId: async () => { actionEvents.push("tracked"); return ticket; },
    claimTicketChannel: async () => { actionEvents.push("claim"); return "Ticket #41 claimed."; },
    closeTicketChannel: async () => { actionEvents.push("close"); ticket.status = "archived"; return "Ticket #41 closed."; },
    resolveTicketChannel: async () => { actionEvents.push("resolve"); ticket.status = "resolved"; return "Ticket #41 resolved."; },
    setTicketPanelMessageId: (channelId: string, messageId: string) => {
        const entry = tickets.tickets.find(ticket => ticket.channelId === channelId);
        if (entry) entry.panelMessageId = messageId;
    },
    GEAR_UI_IDS: {},
    GEAR_MODAL_PREFIX: "gear_modal:",
    client: { user: { id: "bot" } },
    getGuildPanelMessageId: () => storedId,
    setGuildPanelMessageId: (_guild: string, _key: string, id: string | null) => { storedId = id; },
    brandLiveEmbed: (embed: EmbedBuilder, author: string, footer: string) =>
        embed.setAuthor({ name: author }).setFooter({ text: footer }),
    buildHelpPayload: async (page: string) => {
        helpEvents.push(`build:${page}`);
        return { embed: new EmbedBuilder().setTitle("Command Guide").toJSON() };
    },
    helpDropdown: (page: string) => { helpEvents.push(`menu:${page}`); return []; },
    buildTicketIntakeReason, classifyTicketCategory,
    createTicketChannel: async (_guild: unknown, _owner: string, reason: string) => {
        createEvents.push("create");
        createdReason = reason;
        return createError ? { error: createError } : { channelId: "ticket-channel" };
    }
});
vm.runInContext(ts.transpileModule(selected.map(node => node.getText(source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText, context);
const functions = context as {
    buildBotFeatureBriefPayload: () => Panel;
    buildTicketPanelPayload: (name: string) => Panel;
    buildGettingStartedEmbed: () => EmbedBuilder;
    buildTicketIntakeModal: () => ModalBuilder;
    upsertBotFeatureBriefInChannel: (guild: unknown, channelId: string) => Promise<{ ok: boolean; action?: string }>;
    upsertTicketPanelInChannel: (guild: unknown, channelId: string) => Promise<{ ok: boolean; action?: string }>;
    handleCommunityInteraction: (interaction: unknown) => Promise<boolean>;
    handleFormInteraction: (interaction: unknown) => Promise<boolean>;
    handleTicketButtonInteraction: (interaction: unknown) => Promise<boolean>;
    buildTicketOpsEmbed: (ticket: TicketRecord) => EmbedBuilder;
    buildTicketOpsComponents: (ticket: TicketRecord) => ActionRowBuilder<ButtonBuilder>[];
    buildTicketStaffEmbed: (ticket: TicketRecord) => EmbedBuilder;
    buildTicketStaffComponents: (ticket: TicketRecord) => ActionRowBuilder<ButtonBuilder>[];
    updateTicketOpsPanelMessage: (guild: unknown, ticket: TicketRecord) => Promise<void>;
    refreshTicketPanelsForGuild: (guild: unknown) => Promise<void>;
    ONBOARDING_IDS: { start: string; commands: string };
    TICKET_IDS: { open: string; tools: string; claim: string; close: string; resolve: string; intakeModal: string; intakeSummary: string; intakeDetails: string; intakeCategory: string; intakeEvidence: string; intakePlatform: string };
};
const { ONBOARDING_IDS, TICKET_IDS } = vm.runInContext("({ ONBOARDING_IDS, TICKET_IDS })", context) as Pick<typeof functions, "ONBOARDING_IDS" | "TICKET_IDS">;

const welcome = functions.buildBotFeatureBriefPayload();
assert.equal(welcome.embed.title, "Welcome to FNT");
assert.equal(welcome.embed.color, 0x9b59b6);
assert.equal(welcome.embed.description?.split("\n").length, 5);
assert.ok(welcome.embed.description!.split("\n").every(line => line.startsWith("• ")));
assert.ok(welcome.embed.description!.length < 500, "welcome copy must stay short");
assert.equal(welcome.embed.fields?.length || 0, 0);
assert.deepEqual(welcome.components[0].components.map(button => button.custom_id),
    [ONBOARDING_IDS.start, ONBOARDING_IDS.commands]);
assert.match(welcome.embed.description!, /<#1506119505720377434>/);
assert.ok(!JSON.stringify(welcome.components).includes(TICKET_IDS.open), "welcome must only reference the ticket channel");
const guide = functions.buildGettingStartedEmbed().toJSON();
assert.match(guide.description!, /\/raid bet:10 tension:low/);
assert.match(guide.description!, /FN Plagued Cemetery/);
assert.match(guide.description!, /Failed raids can lose your stake/);
assert.ok(guide.description!.length < 850);
const config = fs.readFileSync(path.resolve(__dirname, "../bot/core/config.ts"), "utf8");
assert.match(config, /DEFAULT_BOT_FEATURE_BRIEF_CHANNEL_ID = "1528998695624773714"/);

const support = functions.buildTicketPanelPayload("FNT");
assert.equal(support.embed.description?.split("\n").length, 4);
assert.equal(support.embed.fields?.length || 0, 0);
assert.ok(support.embed.description!.length < 400);
assert.equal(support.components[0].components[0].custom_id, TICKET_IDS.open);
const modal = functions.buildTicketIntakeModal().toJSON();
assert.equal(modal.title, "Open Support Ticket");
assert.equal(modal.components.length, 4);
const inputs = modal.components.flatMap(row => row.components);
assert.deepEqual(inputs.map(input => input.custom_id),
    [TICKET_IDS.intakeSummary, TICKET_IDS.intakeDetails, TICKET_IDS.intakeCategory, TICKET_IDS.intakeEvidence]);
assert.deepEqual(inputs.map(input => input.required), [true, true, false, false]);
assert.equal(inputs[1].max_length, 700, "match the persisted detail limit");

const card = functions.buildTicketOpsEmbed(ticket).toJSON();
assert.equal(card.title, "Support Ticket #41");
assert.equal(card.description, "Missing raid loot");
assert.equal(card.fields?.length, 4, "default ticket has three summary fields and the request");
assert.deepEqual(card.fields?.map(field => field.name), ["Member", "Status", "Handler", "Your request"]);
assert.ok(!JSON.stringify(card).match(/SLA|Lifecycle|Workflow|Command Deck|Case Graph|Not provided|No evidence/));
assert.ok(JSON.stringify(card).length < 750, "member card stays compact");
assert.equal(functions.buildTicketOpsComponents(ticket)[0].components.length, 3);
const assigned = { ...ticket, assignedToId: "handler", status: "claimed" as const, workflowStatus: "responded" as const };
assert.equal(functions.buildTicketOpsEmbed(assigned).data.fields?.[1].value, "In progress");
assert.equal(functions.buildTicketOpsEmbed(assigned).data.fields?.[2].value, "<@handler>");
const waiting = { ...assigned, workflowStatus: "waiting_user" as const };
assert.equal(functions.buildTicketOpsEmbed(waiting).data.fields?.[1].value, "Waiting for your reply");
const closed = { ...assigned, status: "archived" as const };
assert.equal(functions.buildTicketOpsEmbed(closed).data.fields?.[1].value, "Closed");
assert.equal(functions.buildTicketOpsComponents(closed)[0].components.length, 1, "closed tickets only show staff tools");
assert.equal(functions.buildTicketStaffComponents(ticket)[0].components[0].data.disabled, true);
assert.equal(functions.buildTicketStaffComponents(closed)[0].components[0].data.disabled, false);
const evidenced = { ...ticket, intakePlatform: "PC", intakeEvidence: "https://discord.com/channels/g/c/m" };
assert.equal(functions.buildTicketOpsEmbed(evidenced).data.fields?.length, 6);
assert.ok(JSON.stringify(functions.buildTicketStaffEmbed(ticket).toJSON()).includes("SLA Clock"), "staff keep detailed diagnostics");

async function run(): Promise<void> {
    let edits = 0;
    let sends = 0;
    let historyFetches = 0;
    let fetchError: Error | null = null;
    let editError: Error | null = null;
    let savedReply: Reply | null = null;
    const message: FakeMessage = {
        id: "saved", author: { id: "bot" },
        embeds: [{ title: "Old Reference", footer: { text: "About Titan Bot • Official Reference Panel" } }],
        components: [],
        edit: async reply => {
            if (editError) throw editError;
            edits++;
            savedReply = reply;
            return message;
        },
        delete: async () => {}
    };
    let history = new Collection<string, FakeMessage>([[message.id, message]]);
    const channel = {
        type: ChannelType.GuildText,
        messages: {
            fetch: async (query: string | { limit: number }) => {
                if (typeof query === "string") {
                    if (fetchError) throw fetchError;
                    return message;
                }
                historyFetches++;
                return history;
            }
        },
        send: async (reply: Reply) => { sends++; savedReply = reply; return { id: "new" }; }
    };
    const guild = { id: "guild", name: "FNT", channels: { cache: new Map([["channel", channel]]) } };
    const upsert = () => functions.upsertBotFeatureBriefInChannel(guild, "channel");
    assert.equal((await upsert()).action, "updated");
    assert.equal(edits, 1);
    assert.equal(sends, 0);
    assert.equal(historyFetches, 0, "saved panel is edited in place");
    storedId = null;
    assert.equal((await upsert()).action, "updated");
    assert.equal(storedId, "saved", "legacy reference is recovered by its footer");
    storedId = null;
    message.embeds = [welcome.embed];
    assert.equal((await upsert()).action, "updated", "new welcome panel is recognized without saved state");
    fetchError = new DiscordAPIError({ code: 10008, message: "Unknown Message" }, 10008, 404, "GET", "https://discord.com/api", {});
    history = new Collection();
    assert.equal((await upsert()).action, "posted");
    assert.equal(storedId, "new");
    assert.equal(sends, 1);
    fetchError = new Error("Missing Permissions");
    await assert.rejects(upsert(), /Missing Permissions/);
    assert.equal(sends, 1, "failed fetch must not duplicate the panel");
    fetchError = null;
    editError = new Error("Cannot edit");
    await assert.rejects(upsert(), /Cannot edit/);
    assert.equal(sends, 1);
    editError = null;

    await functions.upsertTicketPanelInChannel(guild, "channel");
    const postedSupport = savedReply as Reply | null;
    assert.equal(postedSupport?.components?.length, 1, "new support panel is usable immediately");
    assert.equal(postedSupport?.allowedMentions?.parse.length, 0);
    message.components = [{ components: [{ customId: TICKET_IDS.open }] }];
    history = new Collection([[message.id, message]]);
    const sendsBefore = sends;
    assert.equal((await functions.upsertTicketPanelInChannel(guild, "channel")).action, "updated");
    assert.equal(sends, sendsBefore, "existing ticket panel is replaced, not duplicated");

    ticket.panelMessageId = "saved";
    await functions.updateTicketOpsPanelMessage(guild, ticket);
    let refreshed = savedReply as Reply | null;
    assert.match(JSON.stringify(refreshed?.embeds), /Support Ticket #41/);
    assert.equal(refreshed?.components?.length, 1, "legacy rows must be replaced along with the embed");
    ticket.panelMessageId = null;
    message.embeds = [{ title: "🏛️ FN Support • Case #41 Command Deck" }];
    await functions.refreshTicketPanelsForGuild(guild);
    assert.equal(ticket.panelMessageId, "saved", "startup migrates the old Command Deck in place");
    ticket.panelMessageId = null;
    message.embeds = [card];
    await functions.updateTicketOpsPanelMessage(guild, ticket);
    assert.equal(ticket.panelMessageId, "saved", "compact cards are recoverable without their saved ID");
    const terminal = { ...ticket, id: 42, status: "resolved" as const };
    tickets.tickets.push(terminal);
    const editCount = edits;
    await functions.refreshTicketPanelsForGuild(guild);
    assert.equal(edits, editCount + 1, "startup skips resolved cases");
    tickets.tickets.pop();
    ticket.status = "archived";
    await functions.updateTicketOpsPanelMessage(guild, ticket);
    refreshed = savedReply as Reply | null;
    assert.match(JSON.stringify(refreshed?.embeds), /Closed/);
    assert.equal(functions.buildTicketOpsComponents(ticket)[0].components.length, 1);
    ticket.status = "open";

    const replies: Reply[] = [];
    const button = (customId: string) => ({
        customId, guild,
        isButton: () => true,
        reply: async (reply: Reply) => { replies.push(reply); },
        deferReply: async (reply: Reply) => { replies.push(reply); helpEvents.push("defer"); },
        editReply: async (reply: Reply) => { replies.push(reply); }
    });
    assert.equal(await functions.handleCommunityInteraction(button(ONBOARDING_IDS.start)), true);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
    const originalWelcome = JSON.stringify(welcome);
    assert.equal(await functions.handleCommunityInteraction(button(ONBOARDING_IDS.commands)), true);
    assert.equal(replies[1].flags, MessageFlags.Ephemeral);
    assert.deepEqual(helpEvents, ["defer", "build:general", "menu:general"]);
    assert.equal(JSON.stringify(welcome), originalWelcome, "private guides do not rewrite the public panel");

    let openedModal: ModalBuilder | null = null;
    assert.equal(await functions.handleTicketButtonInteraction({
        customId: support.components[0].components[0].custom_id,
        guild, isButton: () => true,
        showModal: async (value: ModalBuilder) => { openedModal = value; }
    }), true);
    assert.equal((openedModal as ModalBuilder | null)?.toJSON().custom_id, TICKET_IDS.intakeModal,
        "the actual support panel must open the simplified intake form");

    const toolsButton = (staff: boolean, channelId = "channel") => ({
        customId: TICKET_IDS.tools, guild, channelId, member: { staff }, isButton: () => true,
        reply: async (reply: Reply) => { replies.push(reply); }
    });
    await functions.handleTicketButtonInteraction(toolsButton(false));
    assert.equal(replies[replies.length - 1].content, "These tools are for support staff only.");
    assert.equal(replies[replies.length - 1].embeds, undefined);
    await functions.handleTicketButtonInteraction(toolsButton(true));
    assert.equal(replies[replies.length - 1].flags, MessageFlags.Ephemeral);
    assert.equal(replies[replies.length - 1].components?.length, 2);
    assert.match(JSON.stringify(replies[replies.length - 1].embeds), /Staff • Ticket #41/);
    await functions.handleTicketButtonInteraction(toolsButton(true, "untracked"));
    assert.equal(replies[replies.length - 1].content, "This ticket is no longer tracked.");

    const actionButton = (customId: string, staff = true) => ({
        customId, guild, channel: { id: "channel" }, channelId: "channel", member: { staff }, user: { id: "handler" },
        isButton: () => true,
        reply: async (reply: Reply) => { replies.push(reply); actionEvents.push("reply"); },
        deferReply: async (reply: Reply) => { replies.push(reply); actionEvents.push("defer"); },
        editReply: async (reply: Reply) => { replies.push(reply); actionEvents.push("edit"); }
    });
    for (const action of [TICKET_IDS.claim, TICKET_IDS.close, TICKET_IDS.resolve]) {
        actionEvents.length = 0;
        await functions.handleTicketButtonInteraction(actionButton(action, false));
        assert.deepEqual(actionEvents, ["reply"], "members cannot perform staff case actions");
    }
    actionEvents.length = 0;
    await functions.handleTicketButtonInteraction(actionButton(TICKET_IDS.claim));
    assert.deepEqual(actionEvents, ["defer", "claim", "edit"]);
    assert.equal(replies[replies.length - 1].embeds, undefined, "action confirmations stay concise");
    actionEvents.length = 0;
    await functions.handleTicketButtonInteraction(actionButton(TICKET_IDS.resolve));
    assert.deepEqual(actionEvents, ["defer", "tracked", "edit"], "open tickets cannot be permanently resolved");
    actionEvents.length = 0;
    await functions.handleTicketButtonInteraction(actionButton(TICKET_IDS.close));
    assert.deepEqual(actionEvents, ["defer", "tracked", "close", "edit"]);
    actionEvents.length = 0;
    await functions.handleTicketButtonInteraction(actionButton(TICKET_IDS.resolve));
    assert.deepEqual(actionEvents, ["defer", "tracked", "resolve", "edit"], "transcript/resolution work starts after acknowledgement");
    ticket.status = "open";

    const submit = async (category = "", evidence = "", platform?: string, details = "Need help finding raid loot") => {
        createEvents.length = 0;
        const values = new Map([
            [TICKET_IDS.intakeSummary, "Raid question"], [TICKET_IDS.intakeDetails, details],
            [TICKET_IDS.intakeCategory, category], [TICKET_IDS.intakeEvidence, evidence]
        ]);
        if (platform !== undefined) values.set(TICKET_IDS.intakePlatform, platform);
        return functions.handleFormInteraction({
            customId: TICKET_IDS.intakeModal, guild, user: { id: "owner" },
            isChatInputCommand: () => false, isButton: () => false, isModalSubmit: () => true,
            fields: {
                fields: values,
                getTextInputValue: (key: string) => {
                    assert.ok(values.has(key), `removed input ${key} must not be read from new forms`);
                    return values.get(key);
                }
            },
            reply: async (reply: Reply) => { replies.push(reply); createEvents.push("reply"); },
            deferReply: async (reply: Reply) => { replies.push(reply); createEvents.push("defer"); },
            editReply: async (reply: Reply) => { replies.push(reply); createEvents.push("edit"); }
        });
    };
    assert.equal(await submit(), true);
    assert.deepEqual(createEvents, ["defer", "create", "edit"]);
    assert.equal(parseTicketIntakeSnapshot(createdReason).category, "general");
    assert.equal(parseTicketIntakeSnapshot(createdReason).platform, "");
    assert.equal(replies[replies.length - 2].flags, MessageFlags.Ephemeral);
    assert.match(JSON.stringify(replies[replies.length - 1]), /ticket-channel/);
    await submit("bug", "", "PC");
    assert.equal(parseTicketIntakeSnapshot(createdReason).platform, "PC", "old in-flight forms retain platform data");
    for (const topic of ["report", "appeal", "billing"]) {
        await submit(topic);
        assert.deepEqual(createEvents, ["reply"], `${topic} still requires evidence`);
        await submit(topic, "https://discord.com/channels/g/c/m");
        assert.deepEqual(createEvents, ["defer", "create", "edit"]);
    }
    await submit("", "", undefined, "  ");
    assert.deepEqual(createEvents, ["reply"], "blank details are rejected with feedback");
    createError = "You already have an open support ticket: <#existing>";
    await submit();
    assert.equal(replies[replies.length - 1].content, createError);
    assert.deepEqual(createEvents, ["defer", "create", "edit"]);
    console.log("Onboarding panels, private guides, legacy replacement, and support intake tests passed");
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
