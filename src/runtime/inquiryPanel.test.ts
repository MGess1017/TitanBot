import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { loadImage } from "@napi-rs/canvas";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Collection, DiscordAPIError, EmbedBuilder, MessageFlags, type APIEmbed } from "discord.js";
import {
    buildInquiryEntry, buildInquiryHome, buildInquiryIndex, buildInquiryModal, buildInquirySearch,
    buildHubDashboard, buildHubSection, buildHubSettings, hubParent, withHubNavigation, HUB_SECTIONS,
    INQUIRY_IDS, INQUIRY_TITLE, INQUIRY_LEGACY_TITLE, INQUIRY_PREVIOUS_TITLE, inquiryControls, searchInquiry, type InquiryPayload
} from "../features/inquiryPanel";
import { normalizeHubPreferences, type HubPreferences } from "../game/hubPreferences";
import { defaultCosmeticState, normalizeProfilePreferences } from "../game/cosmetics";
import { CHECKPOINT_SECTION_IDS, CHECKPOINT_STAT_KEYS, isCheckpointComplete, isSectionComplete, type CheckpointProfile } from "../game/checkpointRating";
import { buildCheckpointBreakdownEmbed, buildCheckpointWorkspace } from "../features/checkpointCard";
import { buildInventoryPayload } from "../game/payloads";
import { buildShopPayload } from "../features/profileHub";
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

function assertValidComponents(components: NonNullable<InquiryPayload["components"]>, label: string): void {
    assert.ok(components.length <= 5, `${label}: at most five rows`);
    const ids = new Set<string>();
    for (const row of components) {
        assert.ok(row.components.length >= 1 && row.components.length <= 5, `${label}: valid row size`);
        for (const component of row.components) {
            if (!("custom_id" in component)) continue;
            assert.ok(component.custom_id.length >= 1 && component.custom_id.length <= 100, `${label}: valid custom ID length`);
            assert.ok(!ids.has(component.custom_id), `${label}: duplicate custom_id ${component.custom_id}`);
            ids.add(component.custom_id);
        }
    }
}

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
    assert.ok(profile.fetchedAt <= Date.now() && profile.fetchedAt > Date.now() - 10_000);
    assert.ok(requested.some(url => url.includes("playerData/Test%20Name?includeQuests=true")));
    assert.ok(requested.some(url => url.includes("user=Test%20Name")));
    const embed = buildRs3ProfileEmbed(profile).toJSON();
    assert.match(embed.thumbnail?.url || "", /avatar-rs\/GzAWizZ\/chat\.png$/);
    assert.ok(embed.fields?.length && embed.fields.length <= 4);
    assert.match(JSON.stringify(embed), /123,456,789|138/);
    assert.match(JSON.stringify(embed), /1 complete/);
    assert.match(embed.footer?.text || "", /may be delayed/);
    assert.match(embed.footer?.text || "", /API-SOURCED|Ownership not verified/);
    assert.equal(embed.timestamp, new Date(profile.fetchedAt).toISOString());

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
        assertValidComponents(payload.components || [], payload.embed.title || "search");
        assert.ok((payload.components?.length || 0) <= 3);
        for (const row of payload.components || []) assert.ok(row.components.length <= 5);
        assert.ok(JSON.stringify(payload).length < 6000);
    }
    assert.equal(buildInquiryModal("rs3").toJSON().custom_id, INQUIRY_IDS.rs3Modal);
    assert.equal(buildInquiryModal("search").toJSON().custom_id, INQUIRY_IDS.searchModal);
    for (const key of Object.keys(HUB_SECTIONS)) {
        const section = withHubNavigation(buildHubSection(key), `section:${key}`);
        assertValidComponents(section.components!, key);
        assert.equal(section.components?.length, 2);
        assert.equal(hubParent(`section:${key}`), "home");
        const nav = section.components![section.components!.length - 1];
        const back = nav.components.find(component => "label" in component && component.label === "Back");
        assert.ok(back && "custom_id" in back);
        assert.equal(back.custom_id, `${INQUIRY_IDS.back}home`, "Home and Back need distinct IDs even when they share a destination");
    }
    const settings = withHubNavigation(buildHubSettings(normalizeHubPreferences(null)), "settings");
    assertValidComponents(settings.components!, "settings");
    assert.equal(settings.components?.length, 3);
    assert.equal(withHubNavigation(settings, "settings").components?.length, 3, "navigation must not duplicate itself");
    for (const category of ["appearance", "privacy", "notifications", "games"]) {
        const view = withHubNavigation(buildHubSettings(normalizeHubPreferences(null), category), `settings:${category}`);
        assertValidComponents(view.components!, category);
        assert.ok(view.components!.length <= 5, `${category} must fit Discord row limits`);
        assert.equal(hubParent(`settings:${category}`), "settings");
    }
    assert.throws(() => buildHubSettings(normalizeHubPreferences(null), "invalid"), /Unknown/);
    assert.equal(hubParent("preview:xp"), "settings:appearance");
    assert.equal(hubParent("xp:details"), "xp");
    const dashboard = withHubNavigation(buildHubDashboard({
        xpLevel: 4, pmcLevel: 8, next: "100 XP to next level", arenaProgress: "2/5 setup steps complete", rs3Name: null, shortcut: "xp"
    }), "home");
    assertValidComponents(dashboard.components!, "dashboard");
    assert.match(JSON.stringify(dashboard), /FNTCORD|2\/5/);
    for (const label of ["Home", "Back", "Refresh", "Customize"]) assert.match(JSON.stringify(dashboard), new RegExp(label));
    for (const target of ["home", "settings", "settings:appearance", "settings:privacy", "settings:notifications", "settings:games",
        "xp", "pmc", "profile", "arena", "xp:details", "pmc:details", "arena:details", "themes", "preview:xp", "preview:pmc",
        "rs3player:GzaWizz", "search", ...Object.keys(HUB_SECTIONS).map(key => `section:${key}`)]) {
        const wrapped = withHubNavigation({ embed: { title: target } }, target);
        assertValidComponents(wrapped.components!, target);
        const repeated = withHubNavigation(wrapped, target);
        assertValidComponents(repeated.components!, `${target} repeated navigation`);
        assert.deepEqual(repeated, wrapped, `${target}: navigation must be idempotent`);
    }
    const malformed = normalizeHubPreferences({ shortcut: "admin", background: "file://secret", accent: "red", rs3Name: "../name" });
    assert.deepEqual(malformed, { shortcut: "xp", background: "automatic", accent: "tactical", highlights: "all", cardVisibility: "public", rs3Name: null });
    const saved = { shortcut: "pmc", background: "radio", accent: "theme", highlights: "primary", cardVisibility: "private", rs3Name: " GzaWizz " };
    const restored = normalizeProfilePreferences(JSON.parse(JSON.stringify({ hub: saved })));
    assert.deepEqual(restored.hub, { ...saved, rs3Name: "GzaWizz" });
}

type Reply = { content?: string; embeds?: APIEmbed[]; files?: unknown[]; components?: InquiryPayload["components"]; flags?: number; attachments?: unknown[] };
async function verifyPrivateInteractions(): Promise<void> {
    let savedXp = 100;
    const files: string[] = [];
    const errors: unknown[][] = [];
    const users = new Map<string, {
        preferences: { hub?: HubPreferences; doubleXpDm: boolean; showCheckpointRating: boolean };
        fnTokens: number; bankTokens: number; checkpointProfile: CheckpointProfile | null; inventory: Record<string, number>
    }>();
    let saves = 0;
    let failSave = false;
    let failRemoval = false;
    let removalGate: Promise<void> | undefined;
    let removalStarted: () => void = () => undefined;
    const ensureUser = (id: string) => {
        if (!users.has(id)) users.set(id, { preferences: { doubleXpDm: true, showCheckpointRating: true }, fnTokens: 10, bankTokens: 20, checkpointProfile: null, inventory: {} });
        return users.get(id)!;
    };
    const context = vm.createContext({
        INQUIRY_IDS, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Error,
        hubPreferenceSaves: new Set<string>(),
        buildInquiryEntry, buildInquiryHome, buildInquiryIndex, buildHubSection, buildHubSettings, withHubNavigation,
        buildCheckpointWorkspace, buildCheckpointBreakdownEmbed, isCheckpointComplete, isFeatureEnabled: () => true,
        getCheckpointCardUrl: () => null,
        buildInventoryPayload,
        buildThemeStudioPayload: () => {
            const shop = buildShopPayload(defaultCosmeticState(), 10, "theme", 1);
            return withHubNavigation({ embed: shop.embeds[0], components: shop.components }, "themes");
        },
        buildDashboardPayload: () => buildHubDashboard({ xpLevel: 4, pmcLevel: 8, next: "Next milestone", arenaProgress: "0/5 setup steps complete", rs3Name: null, shortcut: "xp" }),
        removeCheckpointPublicCard: async () => {
            if (failRemoval) throw new Error("Missing card deletion permission");
            removalStarted();
            await removalGate;
        },
        buildInquiryModal, buildInquirySearch, inquiryControls, COMMAND_RATE_LIMIT_WINDOW_MS: 1500,
        ensureUser, normalizeHubPreferences, normalizeRs3Name,
        savePoints: () => { if (failSave) throw new Error("Save failed"); saves++; },
        PERMANENT_TICKET_PANEL_CHANNEL_ID: "support",
        rejectIfRateLimited: () => null,
        buildRs3ProfileEmbed,
        fetchRs3Profile: async () => ({ ...parseRs3QuestProfile(questData), stats: null, statsNotice: null, fetchedAt: Date.now() }),
        buildXpProfilePayload: (user: { id: string }) => JSON.stringify(withHubNavigation({
            embed: { title: `XP ${user.id}`, description: String(savedXp) }, progressionCard: "xp"
        }, "xp")),
        buildPmcProfilePayload: (user: { id: string }) => JSON.stringify(withHubNavigation({
            embed: { title: `PMC ${user.id}` }, progressionCard: "pmc", components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId("pmc-control").setLabel("PMC Control").setStyle(ButtonStyle.Secondary)
                ).toJSON()
            ]
        }, "pmc")),
        buildProfilePayload: (user: { id: string }) => withHubNavigation({ embed: { title: `Profile ${user.id}` }, components: [] }, "profile"),
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
            isFromMessage: () => false,
            reply: async (payload: Reply) => { events.push({ type: "reply", payload }); },
            deferReply: async (payload: Reply) => { fake.deferred = true; events.push({ type: "defer", payload }); },
            deferUpdate: async () => { fake.deferred = true; events.push({ type: "update" }); },
            editReply: async (payload: Reply) => {
                assertValidComponents(payload.components || [], `response to ${customId} / ${value}`);
                events.push({ type: "edit", payload });
            },
            showModal: async () => { events.push({ type: "modal" }); }
        };
        return { fake, events };
    }
    for (const component of inquiryControls().flatMap(row => row.components)) {
        if (!("custom_id" in component) || !("label" in component)) continue;
        const request = interaction("button", component.custom_id, "", "launcher-member");
        assert.equal(await context.handleInquiryInteraction(request.fake), true);
        assert.equal(request.events[0].type, component.custom_id === INQUIRY_IDS.search ? "modal" : "defer");
    }
    assert.equal(errors.length, 0, "all public launcher buttons must work");
    for (const value of ["xp", "pmc", "profile", "guide:xp"]) {
        const { fake, events } = interaction("select", INQUIRY_IDS.browse, value);
        assert.equal(await context.handleInquiryInteraction(fake), true);
        assert.equal(events[0].type, "defer");
        assert.equal(events[0].payload?.flags, MessageFlags.Ephemeral, "personal results must never update the public panel");
        assert.ok(events[1].payload?.embeds?.[0].title);
        if (value === "xp" || value === "pmc") assert.equal(events[1].payload?.files?.length, 1);
        if (value === "pmc") assert.equal(events[1].payload?.components?.length, 2, "PMC controls and hub navigation must coexist");
    }
    const destinations = [
        "home", "shortcut", "settings", "settings:appearance", "settings:privacy", "settings:notifications", "settings:games",
        "xp:details", "pmc:details", "arena:details", "themes", "preview:xp", "preview:pmc", "rs3player:GzaWizz",
        ...Object.keys(HUB_SECTIONS).map(key => `section:${key}`),
        ...Object.values(HUB_SECTIONS).flatMap(section => [...section.items])
    ];
    for (const target of destinations) {
        for (const prefix of [INQUIRY_IDS.open, INQUIRY_IDS.back, INQUIRY_IDS.refresh]) {
            const request = interaction("button", `${prefix}${target}`, "", "matrix-member", true);
            const errorCount = errors.length;
            assert.equal(await context.handleInquiryInteraction(request.fake), true, `${prefix}${target}: handled`);
            assert.equal(errors.length, errorCount, `${prefix}${target}: must not enter Inquiry failed recovery`);
            if (target === "rs3") {
                assert.equal(request.events[0].type, "modal");
            } else {
                assert.equal(request.events[0].type, "update");
                assert.ok(request.events[1].payload?.embeds?.[0].title, `${prefix}${target}: renders a workspace`);
            }
        }
    }
    // Exercise every advertised section option through the actual dropdown dispatch.
    for (const target of destinations.filter(target => target.startsWith("section:") || Object.values(HUB_SECTIONS).some(section => (section.items as readonly string[]).includes(target)))) {
        const request = interaction("select", INQUIRY_IDS.browse, target, "matrix-member");
        const errorCount = errors.length;
        await context.handleInquiryInteraction(request.fake);
        assert.equal(errors.length, errorCount, `dropdown ${target}: must render successfully`);
    }
    ensureUser("matrix-member").checkpointProfile = {
        ingameName: "FNT_Ghost", stats: Object.fromEntries(CHECKPOINT_STAT_KEYS.map(key => [key, 0])),
        updatedAt: Date.now(), cardChannelId: null, cardMessageId: null
    };
    const arenaDetails = interaction("button", `${INQUIRY_IDS.refresh}arena:details`, "", "matrix-member", true);
    await context.handleInquiryInteraction(arenaDetails.fake);
    assert.match(arenaDetails.events[1].payload?.embeds?.[0].title || "", /PMC Rating/);
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
    assert.equal(privateHome.events[1].payload?.embeds?.[0].title, "FNTCORD | My Dashboard");
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
    failRemoval = true;
    const deniedPrivacy = interaction("select", `${INQUIRY_IDS.preference}cardVisibility`, "private", "member-a", true);
    await context.handleInquiryInteraction(deniedPrivacy.fake);
    assert.match(deniedPrivacy.events[1].payload?.content || "", /deletion permission/);
    assert.equal(ensureUser("member-a").preferences.hub?.cardVisibility, "public", "failed public-card removal must not report successful privacy changes");
    failRemoval = false;
    for (const [key, value] of [["highlights", "none"], ["cardVisibility", "private"], ["doubleXpDm", "false"], ["showCheckpointRating", "false"]]) {
        const change = interaction("select", `${INQUIRY_IDS.preference}${key}`, value, "member-a", true);
        await context.handleInquiryInteraction(change.fake);
        assert.match(change.events[1].payload?.content || "", /saved/);
    }
    assert.equal(ensureUser("member-a").preferences.hub?.highlights, "none");
    assert.equal(ensureUser("member-a").preferences.hub?.cardVisibility, "private");
    assert.equal(ensureUser("member-a").preferences.doubleXpDm, false);
    assert.equal(ensureUser("member-a").preferences.showCheckpointRating, false);
    const preview = interaction("button", `${INQUIRY_IDS.open}preview:xp`, "", "member-a", true);
    await context.handleInquiryInteraction(preview.fake);
    assert.equal(preview.events[1].payload?.files?.length, 1);
    assert.match(preview.events[1].payload?.content || "", /Private preview/);
    let releaseRemoval: () => void = () => undefined;
    removalGate = new Promise<void>(resolve => { releaseRemoval = resolve; });
    const started = new Promise<void>(resolve => { removalStarted = resolve; });
    const pending = interaction("select", `${INQUIRY_IDS.preference}cardVisibility`, "private", "member-a", true);
    const saving = context.handleInquiryInteraction(pending.fake);
    await started;
    const overlapping = interaction("select", `${INQUIRY_IDS.preference}background`, "checkpoint", "member-a", true);
    await context.handleInquiryInteraction(overlapping.fake);
    assert.match(overlapping.events[1].payload?.content || "", /still being saved/);
    releaseRemoval();
    await saving;
    removalGate = undefined;
    assert.equal(ensureUser("member-a").preferences.hub?.background, "radio", "overlapping preference writes cannot replace each other");
    const privateName = interaction("modal", INQUIRY_IDS.saveNameModal, "GzaWizz", "member-a", true);
    privateName.fake.isFromMessage = () => true;
    await context.handleInquiryInteraction(privateName.fake);
    assert.equal(privateName.events[0].type, "update", "modal saves reuse their existing private workspace");
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
        PLAYER_COUNT_CHANNEL_ID: "1527571592320651285", ChannelType, DiscordAPIError, buildInquiryHome, INQUIRY_TITLE, INQUIRY_LEGACY_TITLE, INQUIRY_PREVIOUS_TITLE,
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
    const snapshots: Array<{ background?: string; accent?: string; xp: number; stats: unknown[] }> = [];
    let highlights = "all";
    const context = vm.createContext({
        ensureUser: () => ({ preferences: { hub: { background: "radio", accent: "theme", highlights } }, cosmetics: {} }),
        normalizeHubPreferences, getThemeColor: () => 0x38bdf8,
        getProgressionCardSnapshot: () => ({ xp: 12345, stats: [{ label: "One", value: "1" }, { label: "Two", value: "2" }, { label: "Three", value: "3" }] }),
        renderProgressionCard: async (snapshot: typeof snapshots[number]) => { snapshots.push(snapshot); return Buffer.from("card"); },
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
    highlights = "primary";
    await context.progressionCardAttachment("xp", { id: "member" }, null);
    assert.equal(snapshots.at(-1)?.stats.length, 1);
    highlights = "none";
    await context.progressionCardAttachment("pmc", { id: "member" }, null);
    assert.equal(snapshots.at(-1)?.stats.length, 0);
}

async function verifyAttachmentRouting(): Promise<void> {
    let command = "xp";
    let cardVisibility = "public";
    const context = vm.createContext({
        MessageFlags, getCommandKey: () => command, rejectIfRateLimitedForInteraction: () => null,
        commandHandlers: Object.fromEntries(["xp", "pmc"].map(kind => [kind, async () => JSON.stringify({
            embed: { title: kind, image: { url: `attachment://${kind}-profile.png` } },
            components: [], progressionCard: kind
        })])),
        PRIVATE_SLASH_COMMANDS: new Set(), recordCommandOutcome: () => undefined, appendAuditEvent: () => undefined,
        ensureUser: () => ({ preferences: { hub: { cardVisibility } } }), normalizeHubPreferences,
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
    cardVisibility = "private";
    for (command of ["xp", "pmc"]) {
        let flags: number | undefined;
        await context.handleChatInputCommand({
            isChatInputCommand: () => true, user: { id: "member" }, guild: {},
            deferReply: async (reply: Reply) => { flags = reply.flags; }, editReply: async () => undefined
        });
        assert.equal(flags, MessageFlags.Ephemeral, `${command} privacy must be selected before deferring`);
    }

    const raidContext = vm.createContext({
        RAID_ENCOUNTER_IDS: {}, RAID_RESULT_ACTION_IDS: {}, PMC_PROFILE_IDS: { view: "pmc_profile_view", followerRole: "pmc_follower_role" },
        PMC_PROFILE_VIEWS: { overview: "Overview", prestige: "Prestige" },
        buildPmcProfilePayload: (_user: unknown, view: string) => JSON.stringify({
            embed: { title: view, ...(view === "overview" ? { image: { url: "attachment://pmc-profile.png" } } : {}) },
            components: []
        }),
        progressionCardAttachment: async () => "pmc-profile.png",
        ensureUser: () => ({ preferences: {} }), normalizeHubPreferences, MessageFlags
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

function verifyDashboardAndPrivacy(): void {
    const context = vm.createContext({
        ensureUser: () => ({
            preferences: { hub: { shortcut: "pmc", rs3Name: "GzaWizz", cardVisibility: "private" }, doubleXpDm: false, showCheckpointRating: false },
            checkpointProfile: { ingameName: "FNT_Ghost", stats: { kd: 2, playerKills: 20, deaths: 10, doubleKills: 1 } }
        }),
        normalizeHubPreferences, CHECKPOINT_SECTION_IDS, isSectionComplete, buildHubDashboard, EmbedBuilder, buildHubSettings, withHubNavigation,
        getProgressionCardSnapshot: (kind: string) => ({ level: kind === "xp" ? 7 : 12, next: "45 XP to next level" }),
        buildProfileSnapshot: () => { throw new Error("Private visitors must never build a snapshot"); }
    });
    vm.runInContext(functionCode("buildDashboardPayload") + functionCode("buildProfilePayload"), context);
    const dashboard = context.buildDashboardPayload({ id: "member" }, null);
    assert.match(JSON.stringify(dashboard), /Server level \*\*7\*\* \/ PMC level \*\*12\*\*/);
    assert.match(JSON.stringify(dashboard), /2\/5 setup steps complete/);
    assert.match(JSON.stringify(dashboard), /Open PMC Dossier/);
    const hidden = context.buildProfilePayload({ id: "member" }, "overview", "visitor", null);
    assert.equal(hidden.embed.title, "FNTCORD | Private Profile");
    assert.doesNotMatch(JSON.stringify(hidden), /GzaWizz|45 XP|FNT_Ghost/);
    const settings = context.buildProfilePayload({ id: "member" }, "preferences", "member", null);
    for (const label of ["Appearance", "Privacy", "Notifications", "Linked Games"]) assert.match(JSON.stringify(settings), new RegExp(label));
}

async function main(): Promise<void> {
    verifySearchAndComponents();
    verifyDashboardAndPrivacy();
    await verifyRuneScape();
    await verifyPrivateInteractions();
    await verifyPanelPersistence();
    await verifyCards();
    await verifyCardPreferences();
    await verifyAttachmentRouting();
    console.log("Inquiry search, private interactions, persistence, RuneScape and card rendering tests passed.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
