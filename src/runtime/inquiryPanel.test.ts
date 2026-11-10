import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { loadImage } from "@napi-rs/canvas";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Collection, DiscordAPIError, EmbedBuilder, MessageFlags, type APIEmbed } from "discord.js";
import {
    buildInquiryEntry, buildInquiryHome, buildInquiryIndex, buildInquiryModal, buildInquirySearch,
    buildHubSection, buildHubSettings, hubParent, withHubNavigation, HUB_SECTIONS,
    INQUIRY_IDS, INQUIRY_TITLE, INQUIRY_LEGACY_TITLE, inquiryControls, searchInquiry
} from "../features/inquiryPanel";
import { normalizeHubPreferences, type HubPreferences } from "../game/hubPreferences";
import { normalizeProfilePreferences } from "../game/cosmetics";
import { buildRs3ProfileEmbed, fetchRs3Profile, normalizeRs3Name, parseRs3QuestProfile } from "../features/runescapeProfile";
import { PROGRESSION_CARD_HEIGHT, PROGRESSION_CARD_WIDTH, renderProgressionCard } from "../features/progressionCard";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };

const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
function functionCode(name: string): string {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `Missing ${name}`);
    return ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}

const questData = {
    name: "GzAWizZ", qp: 160, qp_max: 476,
    quests: {
        one: { title: "Complete quest", status: "COMPLETED" },
        two: { title: "Started quest", status: "STARTED" },
        three: { title: "Remaining quest", status: "NOT_STARTED" }
    }
};

async function verifyRuneScape(): Promise<void> {
    assert.equal(normalizeRs3Name(" GzaWizz "), "GzaWizz");
    for (const invalid of ["", "a".repeat(13), "../player", "<@123>"]) {
        assert.throws(() => normalizeRs3Name(invalid));
    }
    assert.throws(() => parseRs3QuestProfile({ ...questData, qp: NaN }));
    assert.throws(() => parseRs3QuestProfile({ ...questData, quests: { bad: { title: "Bad", status: "OTHER" } } }));
    const requested: string[] = [];
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const request: typeof fetch = async input => {
        const url = String(input);
        requested.push(url);
        return response(url.includes("runemetrics") ? { combatlevel: 138, totalskill: 2900, totalxp: 123456789 } : questData);
    };
    const profile = await fetchRs3Profile("Test Name", request);
    assert.ok(requested.some(url => url.includes("playerData/Test%20Name?includeQuests=true")));
    assert.ok(requested.some(url => url.includes("user=Test%20Name")));
    const embed = buildRs3ProfileEmbed(profile).toJSON();
    assert.match(embed.thumbnail?.url || "", /avatar-rs\/GzAWizZ\/chat\.png$/);
    assert.ok(embed.fields?.length && embed.fields.length <= 4);
    assert.match(JSON.stringify(embed), /123,456,789|138/);
    assert.match(JSON.stringify(embed), /1 complete/);
    assert.match(embed.footer?.text || "", /may be delayed/);

    const privateProfile = await fetchRs3Profile("GzaWizz", async input =>
        response(String(input).includes("runemetrics") ? { error: "PROFILE_PRIVATE" } : questData));
    assert.equal(privateProfile.stats, null);
    assert.match(buildRs3ProfileEmbed(privateProfile).toJSON().description || "", /private/);
    const warnings: unknown[][] = [];
    const previousWarn = console.warn;
    console.warn = (...args) => { warnings.push(args); };
    try {
        const unavailable = await fetchRs3Profile("GzaWizz", async input => {
            if (String(input).includes("runemetrics")) throw new Error("timeout");
            return response(questData);
        });
        assert.equal(unavailable.stats, null);
        assert.match(unavailable.statsNotice || "", /unavailable/);
        assert.equal(warnings.length, 1, "optional service failure must be logged");
        await assert.rejects(() => fetchRs3Profile("GzaWizz", async input =>
            String(input).includes("runemetrics") ? response({ error: 2 }) : response({}, 404)), /not found/);
    } finally {
        console.warn = previousWarn;
    }
}

function verifySearchAndComponents(): void {
    const index = buildInquiryIndex();
    assert.ok(index.some(entry => entry.title === "/rs3"));
    assert.ok(index.some(entry => entry.title === "/casino dice"));
    assert.ok(!index.some(entry => entry.title === "/purge"), "privileged command references must be excluded");
    assert.equal(searchInquiry("RuneScape", index)[0].id, "guide:rs3");
    assert.ok(searchInquiry("VOICE XP", index).some(entry => entry.id === "guide:xp"));
    assert.deepEqual(searchInquiry("qzzqqz", index), []);
    assert.throws(() => searchInquiry("   "), /Enter/);
    const home = buildInquiryHome();
    assert.equal(home.embed.title, INQUIRY_TITLE);
    assert.ok((home.embed.description?.length || 0) < 300);
    for (const payload of [home, buildInquirySearch("xp"), buildInquirySearch("qzzqqz")]) {
        assert.ok((payload.components?.length || 0) <= 3);
        for (const row of payload.components || []) assert.ok(row.components.length <= 5);
        assert.ok(JSON.stringify(payload).length < 6000);
    }
    assert.equal(buildInquiryModal("rs3").toJSON().custom_id, INQUIRY_IDS.rs3Modal);
    assert.equal(buildInquiryModal("search").toJSON().custom_id, INQUIRY_IDS.searchModal);
    for (const key of Object.keys(HUB_SECTIONS)) {
        const section = withHubNavigation(buildHubSection(key), `section:${key}`);
        assert.equal(section.components?.length, 2);
        assert.equal(hubParent(`section:${key}`), "home");
    }
    const settings = withHubNavigation(buildHubSettings(normalizeHubPreferences(null)), "settings");
    assert.equal(settings.components?.length, 5);
    assert.equal(withHubNavigation(settings, "settings").components?.length, 5, "navigation must not duplicate itself");
    const malformed = normalizeHubPreferences({ shortcut: "admin", background: "file://secret", accent: "red", rs3Name: "../name" });
    assert.deepEqual(malformed, { shortcut: "xp", background: "automatic", accent: "tactical", rs3Name: null });
    const saved = { shortcut: "pmc", background: "radio", accent: "theme", rs3Name: " GzaWizz " };
    const restored = normalizeProfilePreferences(JSON.parse(JSON.stringify({ hub: saved })));
    assert.deepEqual(restored.hub, { ...saved, rs3Name: "GzaWizz" });
}

type Reply = { content?: string; embeds?: APIEmbed[]; files?: unknown[]; components?: unknown[]; flags?: number; attachments?: unknown[] };
async function verifyPrivateInteractions(): Promise<void> {
    let savedXp = 100;
    const files: string[] = [];
    const errors: unknown[][] = [];
    const users = new Map<string, { preferences: { hub?: HubPreferences }; fnTokens: number; bankTokens: number }>();
    let saves = 0;
    let failSave = false;
    const ensureUser = (id: string) => {
        if (!users.has(id)) users.set(id, { preferences: {}, fnTokens: 10, bankTokens: 20 });
        return users.get(id)!;
    };
    const context = vm.createContext({
        INQUIRY_IDS, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Error,
        buildInquiryEntry, buildInquiryHome, buildInquiryIndex, buildHubSection, buildHubSettings, withHubNavigation,
        buildInquiryModal, buildInquirySearch, inquiryControls, COMMAND_RATE_LIMIT_WINDOW_MS: 1500,
        ensureUser, normalizeHubPreferences, normalizeRs3Name,
        savePoints: () => { if (failSave) throw new Error("Save failed"); saves++; },
        PERMANENT_TICKET_PANEL_CHANNEL_ID: "support",
        rejectIfRateLimited: () => null,
        buildRs3ProfileEmbed,
        fetchRs3Profile: async () => ({ ...parseRs3QuestProfile(questData), stats: null, statsNotice: null }),
        buildXpProfilePayload: (user: { id: string }) => JSON.stringify({
            embed: { title: `XP ${user.id}`, description: String(savedXp) }, progressionCard: "xp"
        }),
        buildPmcProfilePayload: (user: { id: string }) => JSON.stringify({
            embed: { title: `PMC ${user.id}` }, progressionCard: "pmc", components: [{ type: 1, components: [{ type: 2, custom_id: "pmc-control" }] }]
        }),
        buildProfilePayload: (user: { id: string }) => ({ embed: { title: `Profile ${user.id}` }, components: [] }),
        progressionCardAttachment: async (kind: string, user: { id: string }) => {
            files.push(`${kind}:${user.id}`);
            return `${kind}.png`;
        },
        console: { error: (...args: unknown[]) => { errors.push(args); } }
    });
    vm.runInContext(functionCode("handleInquiryInteraction"), context);
    function interaction(kind: "button" | "select" | "modal", customId: string, value: string, userId = "member-a", ephemeral = false) {
        const events: Array<{ type: string; payload?: Reply }> = [];
        const fake = {
            customId, values: [value], user: { id: userId }, guild: {}, guildId: "guild",
            fields: { getTextInputValue: () => value },
            message: { flags: { has: () => ephemeral } },
            deferred: false, replied: false,
            isButton: () => kind === "button",
            isStringSelectMenu: () => kind === "select",
            isModalSubmit: () => kind === "modal",
            reply: async (payload: Reply) => { events.push({ type: "reply", payload }); },
            deferReply: async (payload: Reply) => { fake.deferred = true; events.push({ type: "defer", payload }); },
            deferUpdate: async () => { fake.deferred = true; events.push({ type: "update" }); },
            editReply: async (payload: Reply) => { events.push({ type: "edit", payload }); },
            showModal: async () => { events.push({ type: "modal" }); }
        };
        return { fake, events };
    }
    for (const value of ["xp", "pmc", "profile", "guide:xp"]) {
        const { fake, events } = interaction("select", INQUIRY_IDS.browse, value);
        assert.equal(await context.handleInquiryInteraction(fake), true);
        assert.equal(events[0].type, "defer");
        assert.equal(events[0].payload?.flags, MessageFlags.Ephemeral, "personal results must never update the public panel");
        assert.ok(events[1].payload?.embeds?.[0].title);
        if (value === "xp" || value === "pmc") assert.equal(events[1].payload?.files?.length, 1);
        if (value === "pmc") assert.equal(events[1].payload?.components?.length, 2, "PMC controls and hub navigation must coexist");
    }
    savedXp = 200;
    const refreshed = interaction("select", INQUIRY_IDS.browse, "xp", "member-b");
    await context.handleInquiryInteraction(refreshed.fake);
    assert.equal(refreshed.events[1].payload?.embeds?.[0].description, "200");
    assert.ok(files.includes("xp:member-b"), "cards must resolve the clicking user's data");
    const modal = interaction("button", INQUIRY_IDS.rs3, "");
    await context.handleInquiryInteraction(modal.fake);
    assert.equal(modal.events[0].type, "modal", "modal must open without deferring first");
    const rs3Result = interaction("select", INQUIRY_IDS.result, "command:rs3");
    await context.handleInquiryInteraction(rs3Result.fake);
    assert.equal(rs3Result.events[0].type, "modal");
    const xpResult = interaction("select", INQUIRY_IDS.result, "command:xp");
    await context.handleInquiryInteraction(xpResult.fake);
    assert.equal(xpResult.events[1].payload?.files?.length, 1, "profile search results must open the actual card");
    for (const [id, value] of [[INQUIRY_IDS.searchModal, "xp"], [INQUIRY_IDS.rs3Modal, "GzaWizz"]]) {
        const request = interaction("modal", id, value);
        await context.handleInquiryInteraction(request.fake);
        assert.equal(request.events[0].payload?.flags, MessageFlags.Ephemeral);
        assert.ok(request.events[1].payload?.embeds?.length);
    }
    const expired = interaction("select", INQUIRY_IDS.result, "guide:deleted");
    await context.handleInquiryInteraction(expired.fake);
    assert.match(expired.events[1].payload?.content || "", /no longer available/);
    assert.equal(errors.length, 1);
    const privateHome = interaction("button", `${INQUIRY_IDS.open}home`, "", "member-a", true);
    await context.handleInquiryInteraction(privateHome.fake);
    assert.equal(privateHome.events[0].type, "update", "private navigation must reuse the existing workspace");
    assert.equal(privateHome.events[1].payload?.attachments?.length, 0, "navigation must clear stale card images");
    for (const [key, value] of [["shortcut", "pmc"], ["background", "radio"], ["accent", "theme"]]) {
        const change = interaction("select", `${INQUIRY_IDS.preference}${key}`, value, "member-a", true);
        await context.handleInquiryInteraction(change.fake);
        assert.match(change.events[1].payload?.content || "", /saved/);
    }
    assert.equal(saves, 3);
    assert.equal(ensureUser("member-a").preferences.hub?.shortcut, "pmc");
    assert.equal(ensureUser("member-b").preferences.hub, undefined, "settings must not affect other users");
    const shortcut = interaction("button", `${INQUIRY_IDS.open}shortcut`, "", "member-a", true);
    await context.handleInquiryInteraction(shortcut.fake);
    assert.equal(shortcut.events[1].payload?.embeds?.[0].title, "PMC member-a");
    const name = interaction("modal", INQUIRY_IDS.saveNameModal, "GzaWizz");
    await context.handleInquiryInteraction(name.fake);
    assert.equal(ensureUser("member-a").preferences.hub?.rs3Name, "GzaWizz");
    failSave = true;
    const failed = interaction("select", `${INQUIRY_IDS.preference}background`, "checkpoint", "member-a", true);
    await context.handleInquiryInteraction(failed.fake);
    assert.match(failed.events[1].payload?.content || "", /Save failed/);
    assert.equal(ensureUser("member-a").preferences.hub?.background, "radio", "failed saves must roll back in-memory settings");
    failSave = false;
    const clear = interaction("button", `${INQUIRY_IDS.open}clearName`, "", "member-a", true);
    await context.handleInquiryInteraction(clear.fake);
    assert.equal(ensureUser("member-a").preferences.hub?.rs3Name, null);
    assert.equal(await context.handleInquiryInteraction(interaction("button", "other:control", "").fake), false);
}

async function verifyPanelPersistence(): Promise<void> {
    let storedId: string | null = null;
    let posts = 0;
    let edits = 0;
    const message = {
        id: "inquiry-message", author: { id: "bot" }, embeds: [{ title: INQUIRY_TITLE }],
        edit: async () => { edits++; return message; }
    };
    const channel = {
        type: ChannelType.GuildText,
        messages: {
            fetch: async (value: string | { limit: number }) => typeof value === "string" ? message : new Collection()
        },
        send: async () => { posts++; return message; }
    };
    const context = vm.createContext({
        PLAYER_COUNT_CHANNEL_ID: "1527571592320651285", ChannelType, DiscordAPIError, buildInquiryHome, INQUIRY_TITLE, INQUIRY_LEGACY_TITLE,
        getGuildPanelMessageId: () => storedId,
        setGuildPanelMessageId: (_guild: string, panel: string, id: string) => {
            assert.equal(panel, "inquiry"); storedId = id;
        },
        console
    });
    vm.runInContext(functionCode("ensureInquiryPanelForGuild"), context);
    const guild = { id: "guild", client: { user: { id: "bot" } }, channels: { cache: new Map([["1527571592320651285", channel]]) } };
    await context.ensureInquiryPanelForGuild(guild);
    await context.ensureInquiryPanelForGuild(guild);
    assert.equal(posts, 1);
    assert.equal(edits, 1);
    storedId = null;
    channel.messages.fetch = async () => new Collection([[message.id, message]]);
    await context.ensureInquiryPanelForGuild(guild);
    assert.equal(posts, 1, "recovering a lost saved ID must not post another panel");
    assert.equal(storedId, message.id);
    message.embeds[0].title = INQUIRY_LEGACY_TITLE;
    channel.messages.fetch = async () => message;
    await context.ensureInquiryPanelForGuild(guild);
    assert.equal(posts, 1, "the legacy inquiry panel must migrate in place");
}

async function verifyCards(): Promise<void> {
    for (const kind of ["xp", "pmc"] as const) {
        const buffer = await renderProgressionCard({
            kind, name: "Long Player Name For Card Layout", level: kind === "pmc" ? 50_000 : 25,
            xp: 50_000_000, prestige: "X", progress: 1,
            next: "Maximum level reached",
            stats: [{ label: "Raids", value: "999,999" }, { label: "Extraction", value: "99.9%" }, { label: "Boss kills", value: "9,999" }]
        });
        assert.ok(buffer.length < 8 * 1024 * 1024, "card must fit common Discord attachment limits");
        const image = await loadImage(buffer);
        assert.equal(image.width, PROGRESSION_CARD_WIDTH);
        assert.equal(image.height, PROGRESSION_CARD_HEIGHT);
    }
}

async function verifyCardPreferences(): Promise<void> {
    const snapshots: Array<{ background?: string; accent?: string; xp: number }> = [];
    const context = vm.createContext({
        ensureUser: () => ({ preferences: { hub: { background: "radio", accent: "theme" } }, cosmetics: {} }),
        normalizeHubPreferences, getThemeColor: () => 0x38bdf8,
        getProgressionCardSnapshot: () => ({ xp: 12345 }),
        renderProgressionCard: async (snapshot: { xp: number }) => { snapshots.push(snapshot); return Buffer.from("card"); },
        AttachmentBuilder: class {
            constructor(public buffer: Buffer, public options: { name: string }) {}
        }
    });
    vm.runInContext(functionCode("progressionCardAttachment"), context);
    for (const kind of ["xp", "pmc"]) {
        const attachment = await context.progressionCardAttachment(kind, { id: "member" }, null);
        assert.equal(attachment.options.name, `${kind}-profile.png`);
    }
    assert.ok(snapshots.every(snapshot => snapshot.background === "radio" && snapshot.accent === "#38bdf8"));
    assert.ok(snapshots.every(snapshot => snapshot.xp === 12345), "customization must not alter player stats");
}

async function verifyAttachmentRouting(): Promise<void> {
    let command = "xp";
    const context = vm.createContext({
        MessageFlags, getCommandKey: () => command, rejectIfRateLimitedForInteraction: () => null,
        commandHandlers: Object.fromEntries(["xp", "pmc"].map(kind => [kind, async () => JSON.stringify({
            embed: { title: kind, image: { url: `attachment://${kind}-profile.png` } },
            components: [], progressionCard: kind
        })])),
        PRIVATE_SLASH_COMMANDS: new Set(), recordCommandOutcome: () => undefined, appendAuditEvent: () => undefined,
        progressionCardAttachment: async (kind: string) => `${kind}-profile.png`,
        isUnknownInteractionError: () => false, console
    });
    vm.runInContext(functionCode("handleChatInputCommand"), context);
    for (command of ["xp", "pmc"]) {
        const replies: Reply[] = [];
        await context.handleChatInputCommand({
            isChatInputCommand: () => true, user: { id: "member" }, guild: {},
            deferReply: async () => undefined, editReply: async (reply: Reply) => { replies.push(reply); }
        });
        assert.equal(replies.length, 1);
        assert.equal(replies[0].embeds?.[0].image?.url, `attachment://${command}-profile.png`);
        assert.equal(replies[0].files?.[0], `${command}-profile.png`);
        assert.equal(replies[0].attachments?.length, 0);
    }

    const raidContext = vm.createContext({
        RAID_ENCOUNTER_IDS: {}, RAID_RESULT_ACTION_IDS: {}, PMC_PROFILE_IDS: { view: "pmc_profile_view", followerRole: "pmc_follower_role" },
        PMC_PROFILE_VIEWS: { overview: "Overview", prestige: "Prestige" },
        buildPmcProfilePayload: (_user: unknown, view: string) => JSON.stringify({
            embed: { title: view, ...(view === "overview" ? { image: { url: "attachment://pmc-profile.png" } } : {}) },
            components: []
        }),
        progressionCardAttachment: async () => "pmc-profile.png"
    });
    vm.runInContext(functionCode("handleRaidInteraction"), raidContext);
    for (const view of ["overview", "prestige"]) {
        const replies: Reply[] = [];
        let deferred = false;
        await raidContext.handleRaidInteraction({
            isButton: () => false, isStringSelectMenu: () => true,
            customId: "pmc_profile_view:member", user: { id: "member" }, guild: {}, values: [view],
            deferUpdate: async () => { deferred = true; },
            editReply: async (reply: Reply) => { assert.ok(deferred); replies.push(reply); }
        });
        assert.equal(replies[0].files?.length, view === "overview" ? 1 : 0);
        assert.equal(replies[0].attachments?.length, 0, "changing dossier sections must remove stale card attachments");
    }
}

async function main(): Promise<void> {
    verifySearchAndComponents();
    await verifyRuneScape();
    await verifyPrivateInteractions();
    await verifyPanelPersistence();
    await verifyCards();
    await verifyCardPreferences();
    await verifyAttachmentRouting();
    console.log("Inquiry search, private interactions, persistence, RuneScape and card rendering tests passed.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
