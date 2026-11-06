import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Collection, DiscordAPIError,
    EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type APIEmbed
} from "discord.js";
import { buildTicketIntakeReason, classifyTicketCategory, parseTicketIntakeSnapshot } from "../services/ticketEnhancements";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };

const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
const functionNames = new Set([
    "buildBotFeatureBriefPayload", "upsertBotFeatureBriefInChannel", "buildTicketPanelPayload",
    "upsertTicketPanelInChannel", "messageHasTicketOpenButton", "buildTicketIntakeModal",
    "buildGettingStartedEmbed", "handleCommunityInteraction", "handleFormInteraction", "handleTicketButtonInteraction"
]);
const constantNames = new Set(["ONBOARDING_IDS", "HELP_IDS", "TICKET_IDS"]);
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
const context = vm.createContext({
    exports: {}, console,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, DiscordAPIError, EmbedBuilder,
    MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
    MIN_RAID_BET: 10,
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
    ONBOARDING_IDS: { start: string; commands: string };
    TICKET_IDS: { open: string; intakeModal: string; intakeSummary: string; intakeDetails: string; intakeCategory: string; intakeEvidence: string; intakePlatform: string };
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
    [ONBOARDING_IDS.start, ONBOARDING_IDS.commands, TICKET_IDS.open]);
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
        customId: welcome.components[0].components[2].custom_id,
        guild, isButton: () => true,
        showModal: async (value: ModalBuilder) => { openedModal = value; }
    }), true);
    assert.equal((openedModal as ModalBuilder | null)?.toJSON().custom_id, TICKET_IDS.intakeModal,
        "the welcome support button must open the same simplified intake form");

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
