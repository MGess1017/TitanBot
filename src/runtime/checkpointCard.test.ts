import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { ChannelType, DiscordAPIError, MessageFlags } from "discord.js";
import {
    calculateCheckpointRating, CHECKPOINT_SECTION_IDS, CHECKPOINT_SECTIONS, CHECKPOINT_STAT_KEYS, getCheckpointTier,
    isCheckpointComplete, normalizeCheckpointProfile, parseCheckpointStat, parseIngameName, validateCheckpointStats,
    type CheckpointProfile, type CheckpointStatKey
} from "../game/checkpointRating";
import {
    buildCheckpointBreakdownEmbed, buildCheckpointCardMessage, buildCheckpointModal, buildCheckpointNameModal, buildCheckpointPanel, buildCheckpointWorkspace, CHECKPOINT_EDIT_PREFIX,
    CHECKPOINT_NAME_ID, CHECKPOINT_NAME_INPUT_ID, CHECKPOINT_NAME_MODAL_ID, CHECKPOINT_MODAL_PREFIX, CHECKPOINT_VIEW_ID,
    CHECKPOINT_WORKSPACE_ID, CHECKPOINT_REFRESH_ID, CHECKPOINT_RETRY_ID, describeCheckpointProgress, renderCheckpointCard, upsertCheckpointCardMessage
} from "../features/checkpointCard";
import { normalizeHubPreferences } from "../game/hubPreferences";
import { withHubNavigation } from "../features/inquiryPanel";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };

const strong: Record<CheckpointStatKey, number> = {
    kd: 2.14, playerKills: 4210, deaths: 1967, doubleKills: 610, matchesPlayed: 980, victories: 590, winRate: 60.2,
    matchesQuit: 6, headshotKills: 1450, headshotRate: 34.4, overkills: 44, meleeKills: 37, highestWinStreak: 11,
    highestMatchXp: 5120, moneyEarned: 48_200_000, mvps: 210
};

async function verifyWorkspaceInteractions(): Promise<void> {
    const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
    const code = ["queueCheckpointWork", "publishCheckpointCard", "removeCheckpointPublicCard", "getCheckpointCardUrl", "finishCheckpointSave", "handleCheckpointInteraction"].map(name => {
        const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(declaration, `Missing ${name}`);
        return declaration.getText(source);
    }).join("\n");
    const user = {
        preferences: { hub: normalizeHubPreferences(null) },
        checkpointProfile: { ingameName: "FNT_Ghost", stats: strong, updatedAt: 123000, cardChannelId: null, cardMessageId: null } as CheckpointProfile
    };
    let posts = 0;
    let edits = 0;
    let deletes = 0;
    let failSave = false;
    const errors: unknown[] = [];
    const message = {
        id: "card", url: "https://discord.com/channels/guild/cards/card", author: { id: "bot" },
        edit: async () => { edits++; return message; },
        delete: async () => { deletes++; }
    };
    const channel = { id: "cards", type: ChannelType.GuildText, messages: { fetch: async () => message }, send: async () => { posts++; return message; } };
    const context = vm.createContext({
        checkpointCardQueues: new Map(), ensureUser: () => user,
        normalizeHubPreferences, withHubNavigation, buildCheckpointWorkspace, buildCheckpointBreakdownEmbed, buildCheckpointCardMessage,
        buildCheckpointModal, buildCheckpointNameModal, CHECKPOINT_EDIT_PREFIX, CHECKPOINT_MODAL_PREFIX,
        CHECKPOINT_NAME_ID, CHECKPOINT_NAME_INPUT_ID, CHECKPOINT_NAME_MODAL_ID, CHECKPOINT_VIEW_ID,
        CHECKPOINT_WORKSPACE_ID, CHECKPOINT_REFRESH_ID, CHECKPOINT_RETRY_ID,
        CHECKPOINT_SECTIONS, isCheckpointComplete, isCheckpointSectionId: (value: string) => CHECKPOINT_SECTION_IDS.includes(value as typeof CHECKPOINT_SECTION_IDS[number]),
        parseCheckpointStat, parseIngameName, validateCheckpointStats,
        renderCheckpointCard: async () => ({ buffer: Buffer.from("card"), rating: 80, tier: getCheckpointTier(80) }),
        fetchAvatarBuffer: async () => null, getCheckpointCardChannel: async () => channel, upsertCheckpointCardMessage,
        savePoints: () => { if (failSave) throw new Error("disk full"); },
        appendAuditEvent: () => undefined, isFeatureEnabled: () => true, toSafeString: String,
        rejectIfRateLimited: () => null, COMMAND_RATE_LIMIT_WINDOW_MS: 1500,
        MessageFlags, ChannelType, DiscordAPIError,
        client: { user: { id: "bot" }, channels: { fetch: async () => channel } },
        console: { error: (...args: unknown[]) => errors.push(args) }
    });
    vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
    type Reply = { content?: string; flags?: number; files?: unknown[]; embeds?: unknown[]; components?: unknown[] };
    function request(id: string, ephemeral = false, modal = false) {
        const replies: Reply[] = [];
        const fake = {
            customId: id, user: { id: "member", displayAvatarURL: () => "avatar" }, guildId: "guild",
            fields: { getTextInputValue: () => "New_Name" }, message: { flags: { has: () => ephemeral } },
            isButton: () => !modal, isModalSubmit: () => modal, isFromMessage: () => false,
            reply: async (reply: Reply) => { replies.push(reply); },
            update: async (reply: Reply) => { replies.push(reply); },
            deferReply: async (reply: Reply) => { replies.push(reply); },
            deferUpdate: async () => { replies.push({ content: "update" }); },
            editReply: async (reply: Reply) => { replies.push(reply); }
        };
        return { fake, replies };
    }
    const open = request(CHECKPOINT_WORKSPACE_ID);
    await context.handleCheckpointInteraction(open.fake);
    assert.equal(open.replies[0].flags, MessageFlags.Ephemeral);
    assert.equal(posts, 0, "opening a workspace must not publish");
    const retry = request(CHECKPOINT_RETRY_ID);
    await context.handleCheckpointInteraction(retry.fake);
    assert.equal(posts, 1);
    assert.equal(user.checkpointProfile.cardMessageId, "card");
    const refresh = request(CHECKPOINT_REFRESH_ID, true);
    await context.handleCheckpointInteraction(refresh.fake);
    assert.equal(posts, 1, "refresh must edit existing card");
    assert.equal(edits, 1);
    assert.equal(refresh.replies[0].content, "update", "private editing reuses the workspace");
    const details = request(CHECKPOINT_VIEW_ID, true);
    await context.handleCheckpointInteraction(details.fake);
    assert.match(JSON.stringify(details.replies), /Self|SELF-REPORTED/);
    assert.match(JSON.stringify(details.replies), /Combat|Precision/);
    await Promise.all([context.publishCheckpointCard(retry.fake.user), context.publishCheckpointCard(retry.fake.user)]);
    assert.equal(posts, 1, "concurrent publication must never create duplicate public cards");
    assert.equal(edits, 3);
    user.preferences.hub.cardVisibility = "private";
    await context.removeCheckpointPublicCard("member");
    assert.equal(deletes, 1);
    assert.equal(user.checkpointProfile.cardMessageId, null);
    await assert.rejects(() => context.publishCheckpointCard(retry.fake.user), /private/);
    const preview = request(CHECKPOINT_REFRESH_ID, true);
    await context.handleCheckpointInteraction(preview.fake);
    assert.equal(preview.replies[1].files?.length, 1);
    assert.equal(posts, 1, "private refresh must never publish publicly");
    failSave = true;
    const previous = user.checkpointProfile;
    const failed = request(CHECKPOINT_NAME_MODAL_ID, false, true);
    await context.handleCheckpointInteraction(failed.fake);
    assert.equal(user.checkpointProfile, previous, "failed persistence must restore the old profile");
    assert.match(failed.replies[0].content || "", /could not be saved/);
    assert.equal(errors.length, 1);
    user.checkpointProfile = { ...previous, stats: {}, ingameName: null };
    const incomplete = request(CHECKPOINT_REFRESH_ID, true);
    await context.handleCheckpointInteraction(incomplete.fake);
    assert.match(incomplete.replies[1].content || "", /remaining setup/);
    assert.equal(posts, 1);
}

async function main(): Promise<void> {
    const sectionKeys = CHECKPOINT_SECTION_IDS.flatMap(id => CHECKPOINT_SECTIONS[id].keys);
    assert.deepEqual([...sectionKeys].sort(), [...CHECKPOINT_STAT_KEYS].sort(), "every stat must appear in exactly one section");
    for (const id of CHECKPOINT_SECTION_IDS) {
        assert.ok(CHECKPOINT_SECTIONS[id].keys.length <= 5, "Discord modals allow at most 5 inputs");
        const modal = buildCheckpointModal(id, { kd: 1.5 }).toJSON();
        assert.equal(modal.components.length, CHECKPOINT_SECTIONS[id].keys.length);
    }
    const launcher = buildCheckpointPanel();
    assert.equal(launcher.components.length, 1);
    assert.ok(launcher.embeds[0].toJSON().description!.length < 200);
    const workspace = withHubNavigation(buildCheckpointWorkspace(null, "private"), "arena");
    const panelButtons = workspace.components!.flatMap(row => row.components).filter(button => "custom_id" in button) as Array<{ custom_id: string }>;
    assert.equal(panelButtons.filter(button => button.custom_id.startsWith(CHECKPOINT_EDIT_PREFIX)).length, 4);
    assert.ok(panelButtons.some(button => button.custom_id === CHECKPOINT_NAME_ID), "panel has an In-Game Name button");
    const nameModal = buildCheckpointNameModal("FNT_Ghost").toJSON();
    assert.equal(nameModal.custom_id, CHECKPOINT_NAME_MODAL_ID);
    const nameInput = (nameModal.components[0] as { components: Array<{ custom_id: string; value?: string; max_length?: number }> }).components[0];
    assert.equal(nameInput.custom_id, CHECKPOINT_NAME_INPUT_ID);
    assert.equal(nameInput.value, "FNT_Ghost", "existing name is prefilled for editing");
    assert.equal(nameInput.max_length, 15);

    assert.deepEqual(parseIngameName("  FNT_Ghost-7 "), { ok: true, value: "FNT_Ghost-7" });
    assert.equal(parseIngameName("ab").ok, false, "too short");
    assert.equal(parseIngameName("a".repeat(16)).ok, false, "too long");
    assert.equal(parseIngameName("bad name").ok, false, "no spaces");
    assert.equal(parseIngameName("@everyone").ok, false, "no mentions or symbols");
    assert.equal(parseIngameName("**bold**").ok, false, "no markdown");
    assert.match(describeCheckpointProgress({}, null), /⬜ In-Game Name/);
    assert.match(describeCheckpointProgress({}, "FNT_Ghost"), /✅ In-Game Name: \*\*FNT\\_Ghost\*\*/);
    const cardMessage = buildCheckpointCardMessage("1", "FNT_Ghost", 80, getCheckpointTier(80), Buffer.from([0]));
    assert.equal(cardMessage.embeds[0].toJSON().title, "FNT\\_Ghost • PMC Rating 80", "card title uses the in-game name");

    assert.deepEqual(parseCheckpointStat("playerKills", "1,240"), { ok: true, value: 1240 });
    assert.deepEqual(parseCheckpointStat("winRate", "56.1%"), { ok: true, value: 56.1 });
    assert.deepEqual(parseCheckpointStat("moneyEarned", "15.4m"), { ok: true, value: 15_400_000 });
    assert.deepEqual(parseCheckpointStat("moneyEarned", "₽ 2,500,000"), { ok: true, value: 2_500_000 });
    assert.equal(parseCheckpointStat("playerKills", "12.5").ok, false);
    assert.equal(parseCheckpointStat("playerKills", "5k").ok, false);
    assert.equal(parseCheckpointStat("winRate", "101").ok, false);
    assert.equal(parseCheckpointStat("deaths", "-4").ok, false);
    assert.equal(parseCheckpointStat("deaths", "abc").ok, false);

    assert.deepEqual(validateCheckpointStats(strong), []);
    assert.ok(validateCheckpointStats({ victories: 10, matchesPlayed: 5 }).length === 1);
    assert.ok(validateCheckpointStats({ headshotKills: 50, playerKills: 10 }).length === 1);
    assert.deepEqual(validateCheckpointStats({ victories: 10 }), [], "partial stats validate only known pairs");

    const strongRating = calculateCheckpointRating(strong);
    assert.ok(strongRating.rating >= 1 && strongRating.rating <= 99);
    const zero = Object.fromEntries(CHECKPOINT_STAT_KEYS.map(key => [key, 0])) as Record<CheckpointStatKey, number>;
    assert.ok(calculateCheckpointRating(zero).rating < 30, "an empty record must rate low");
    const maxed = { ...strong, kd: 5, winRate: 90, headshotRate: 70, mvps: 600, playerKills: 15000, highestWinStreak: 30, matchesPlayed: 2000, victories: 1800, moneyEarned: 900_000_000, highestMatchXp: 12000, doubleKills: 2000, overkills: 400, meleeKills: 900, matchesQuit: 0 };
    assert.equal(calculateCheckpointRating(maxed).rating, 99, "ratings cap at 99");
    assert.ok(calculateCheckpointRating({ ...strong, kd: 3 }).rating > strongRating.rating, "better K/D raises rating");
    assert.ok(calculateCheckpointRating({ ...strong, matchesQuit: 150 }).rating < strongRating.rating, "quitting lowers rating");
    const tiny = { ...strong, matchesPlayed: 5, victories: 5, mvps: 5, highestWinStreak: 5 };
    assert.ok(calculateCheckpointRating(tiny).sampleFactor < 1, "small samples are blended");
    assert.equal(getCheckpointTier(95).id, "legend");
    assert.equal(getCheckpointTier(79).id, "veteran");
    assert.equal(getCheckpointTier(10).id, "recruit");

    assert.equal(normalizeCheckpointProfile(null), null);
    const normalized = normalizeCheckpointProfile({ stats: { kd: 1.2, deaths: -1, bogus: 5, playerKills: "9" }, cardMessageId: 5 });
    assert.deepEqual(normalized?.stats, { kd: 1.2 });
    assert.equal(normalized?.cardMessageId, null);
    assert.equal(normalized?.ingameName, null, "older saved profiles start without a name");
    assert.equal(normalizeCheckpointProfile({ ingameName: "FNT_Ghost", stats: {} })?.ingameName, "FNT_Ghost");
    assert.equal(normalizeCheckpointProfile({ ingameName: "bad name!", stats: {} })?.ingameName, null, "invalid saved names are dropped");
    assert.equal(isCheckpointComplete(strong), true);
    assert.equal(isCheckpointComplete({ kd: 1 }), false);

    const card = await renderCheckpointCard({ userId: "123456789012345678", ingameName: "FNT_Ghost", stats: strong, updatedAt: Date.now() });
    assert.equal(card.rating, strongRating.rating);
    assert.deepEqual([...card.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "card must be a PNG");
    await verifyWorkspaceInteractions();
    console.log(`checkpointCard tests passed (sample rating ${card.rating}, ${card.tier.name})`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
