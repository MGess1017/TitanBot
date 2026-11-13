import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { ChannelType, MessageFlags } from "discord.js";
import {
    buildLfgPanel, buildLfgPost, LFG_PREFIX, lfgExpiration, parseLfgStartTime, validateLfgRequest,
    type LfgListing
} from "../features/lfg";
import { LFG_POST_CHANNEL_ID } from "../bot/core/config";
import { LfgStore } from "./lfgStore";
import { handleLfgInteraction } from "../bot/panels/lfg";
import type { Interaction } from "discord.js";

function runLfgTests(): void {
    assert.deepEqual(validateLfgRequest("  Example Game ", "4", "  Mic required  ", "PC / crossplay", "NA"), {
        game: "Example Game", maxPlayers: 4, comments: "Mic required", platform: "PC / crossplay", region: "NA"
    });
    for (const [game, players] of [["", "2"], ["Example", "1"], ["Example", "21"], ["Example", "2.5"], ["Example", "nope"]]) {
        assert.throws(() => validateLfgRequest(game, players, ""));
    }

    const now = Date.now();
    const scheduledInput = new Date(now + 20 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const startsAt = parseLfgStartTime(scheduledInput, now);
    assert.equal(startsAt, Date.parse(scheduledInput));
    assert.equal(parseLfgStartTime("", now), null);
    assert.throws(() => parseLfgStartTime("2026-02-31T12:00Z", now), /valid calendar date/);
    assert.throws(() => parseLfgStartTime("2026-11-12T12:00", now), /explicit UTC offset/);
    assert.throws(() => parseLfgStartTime(new Date(now + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), now), /at least 5 minutes/);
    assert.equal(lfgExpiration(1000, null), 1000 + 4 * 60 * 60 * 1000);
    assert.equal(lfgExpiration(1000, 20_000), 20_000 + 2 * 60 * 60 * 1000);

    const panel = buildLfgPanel();
    assert.equal(panel.components.length, 1);
    assert.equal(panel.embeds[0].toJSON().title, "FNTCORD | Looking for Group");

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "titan-lfg-"));
    const file = path.join(directory, "lfg-listings.json");
    try {
        let store = new LfgStore(file);
        const listing = store.create({
            guildId: "guild-1", channelId: "channel-1", hostId: "host-1",
            game: "Example Game", maxPlayers: 2, comments: "", color: "Blue",
            platform: "PC", region: "NA", voicePreference: "required", startsAt
        });
        store.setMessageId(listing.id, "message-1");
        store.markRendered(listing.id, listing.revision);
        assert.throws(() => store.join(listing.id, "host-1"), /already in this group/);
        const joined = store.join(listing.id, "member-1");
        assert.equal(joined.playerIds.length, 2);
        assert.throws(() => store.join(listing.id, "member-2"), /already full/);
        assert.throws(() => store.leave(listing.id, "host-1"), /host cannot leave/);

        const post = buildLfgPost(joined);
        assert.equal(post.embeds[0].toJSON().color, 0x3498db);
        assert.equal(post.embeds[0].toJSON().description, "No extra comments provided.");
        assert.match(post.embeds[0].toJSON().fields?.find(field => field.name === "Platform / Crossplay")?.value || "", /PC/);
        assert.equal(post.components[0].components[0].toJSON().disabled, true);

        const updated = store.update(listing.id, "host-1", {
            game: "Updated Game", maxPlayers: 3, comments: "Bring a mic", platform: "Crossplay",
            region: "EU", voicePreference: "not_required", startsAt: null, color: "Gold"
        });
        assert.equal(updated.game, "Updated Game");
        assert.ok(Math.abs(updated.expiresAt - Date.now() - 4 * 60 * 60 * 1000) < 1000);
        assert.throws(() => store.update(listing.id, "member-1", {
            game: "No", maxPlayers: 3, comments: "", platform: "", region: "",
            voicePreference: "any", startsAt: null, color: "Blue"
        }), /Only the host/);
        assert.throws(() => store.update(listing.id, "host-1", {
            game: "Too small", maxPlayers: 1, comments: "", platform: "", region: "",
            voicePreference: "any", startsAt: null, color: "Blue"
        }), /current group size/);
        assert.deepEqual(store.pendingRender("guild-1").map(row => row.id), [listing.id]);

        const report = store.createReport(listing.id, "member-2", "Spam listing");
        assert.equal(store.pendingReports("guild-1")[0].id, report.id);
        assert.throws(() => store.createReport(listing.id, "member-2", "Duplicate report"), /already reported/);
        assert.throws(() => store.createReport(listing.id, "host-1", "Own listing"), /own listing/);

        store = new LfgStore(file);
        assert.deepEqual(store.get(listing.id)?.playerIds, ["host-1", "member-1"]);
        assert.equal(store.get(listing.id)?.platform, "Crossplay");
        assert.equal(store.pendingReports("guild-1").length, 1);
        store.markReportSent(report.id);
        assert.equal(store.pendingReports("guild-1").length, 0);

        const closed = store.close(listing.id, "host-1", "completed");
        assert.equal(closed.status, "completed");
        assert.equal(buildLfgPost(closed).components[0].components[3].toJSON().disabled, true);
        assert.throws(() => store.join(listing.id, "member-2"), /already closed/);

        const expiring = store.create({
            guildId: "guild-1", channelId: "channel-1", hostId: "host-2",
            game: "Short session", maxPlayers: 2, comments: "", color: "Blue",
            platform: "", region: "", voicePreference: "any", startsAt: null
        });
        assert.equal(store.dueListings(expiring.expiresAt).some(row => row.id === expiring.id), true);
        const expired = store.expire(expiring.id, expiring.expiresAt);
        assert.equal(expired?.status, "expired");
        assert.equal(buildLfgPost(expired!).components[0].components[0].toJSON().disabled, true);

        const legacyFile = path.join(directory, "legacy-lfg.json");
        fs.writeFileSync(legacyFile, JSON.stringify({
            version: 1,
            listings: [{
                id: "legacy", guildId: "guild-1", channelId: "channel-1", messageId: "old-message",
                hostId: "old-host", game: "Legacy Game", maxPlayers: 4, comments: "", color: "Purple",
                playerIds: ["old-host"], status: "open", createdAt: Date.now() - 5 * 60 * 60 * 1000
            }]
        }));
        const migrated = new LfgStore(legacyFile);
        assert.equal(migrated.get("legacy")?.status, "expired");
        assert.equal(migrated.get("legacy")?.voicePreference, "any");
        assert.equal(migrated.pendingRender("guild-1").some(row => row.id === "legacy"), true);
        console.log("LFG tests passed");
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

async function testBuilderInteractions(): Promise<void> {
    let response: { embeds?: Array<{ toJSON(): { description?: string } }>; components?: Array<{ components: Array<{ toJSON(): { custom_id?: string } }> }>; content?: string } = {};
    let fetches = 0;
    const guild = { id: "guild-test", channels: { fetch: async () => { fetches++; return null; } } };
    const interaction = (customId: string, type: "button" | "modal", fields: Record<string, string> = {}) => ({
        customId, guild, guildId: guild.id, user: { id: "host-test" }, replied: false, deferred: false,
        isButton: () => type === "button", isStringSelectMenu: () => false, isModalSubmit: () => type === "modal",
        isRepliable: () => true,
        fields: { getTextInputValue: (key: string) => fields[key] || "" },
        reply: async (payload: typeof response) => { response = payload; },
        update: async (payload: typeof response) => { response = payload; },
        deferReply: async function () { this.deferred = true; },
        followUp: async (payload: typeof response) => { response = payload; }
    });

    await handleLfgInteraction(interaction("lfg:open", "button") as unknown as Interaction);
    const detailsId = response.components?.[2].components[0].toJSON().custom_id;
    assert.ok(detailsId?.startsWith("lfg:details:"));
    const id = detailsId.slice("lfg:details:".length);
    await handleLfgInteraction(interaction(`lfg:details_submit:${id}`, "modal", {
        game: "Test Game", players: "4", platform: "PC", region: "EU", comments: "Bring a mic"
    }) as unknown as Interaction);
    assert.match(response.embeds?.[0].toJSON().description || "", /\*\*Total players:\*\* 4/);
    assert.match(response.embeds?.[0].toJSON().description || "", /Test Game/);
    const originalError = console.error;
    try {
        console.error = () => undefined;
        await handleLfgInteraction(interaction(`lfg:publish:${id}`, "button") as unknown as Interaction);
    } finally { console.error = originalError; }
    assert.equal(fetches, 1, "valid details must reach destination lookup");
    assert.match(response.content || "", /destination.*missing/i);
    await handleLfgInteraction(interaction(`lfg:cancel:${id}`, "button") as unknown as Interaction);
    assert.equal(response.content, "LFG setup canceled.");
}

async function testPublicPublishDestination(): Promise<void> {
    const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };
    const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleLfgInteraction");
    assert.ok(declaration);
    assert.equal(LFG_POST_CHANNEL_ID, "1570579425832214568");
    const session = {
        game: "Test Game", playerCount: "4", comments: "Bring a mic", platform: "PC", region: "EU",
        color: "Blue", voicePreference: "any", startsAt: null, listingId: null, publishing: false
    };
    let listing: LfgListing | undefined;
    let sentPayload: ReturnType<typeof buildLfgPost> | undefined;
    let savedMessageId = "";
    let fetchedChannel = "";
    let reply = "";
    const destination = {
        id: LFG_POST_CHANNEL_ID, type: ChannelType.GuildText,
        send: async (payload: ReturnType<typeof buildLfgPost>) => {
            sentPayload = payload;
            return { id: "message-1", url: `https://discord.com/channels/guild-1/${LFG_POST_CHANNEL_ID}/message-1` };
        }
    };
    const store = {
        create: (input: Omit<LfgListing, "id" | "messageId" | "playerIds" | "status" | "createdAt" | "revision" | "renderedRevision" | "expiresAt">) => {
            listing = { ...input, id: "listing-1", messageId: null, playerIds: [input.hostId],
                status: "open", createdAt: Date.now(), expiresAt: Date.now() + 60_000, revision: 1, renderedRevision: 0 };
            return listing;
        },
        setMessageId: (_id: string, messageId: string) => {
            assert.ok(listing);
            savedMessageId = messageId;
            return { ...listing, messageId };
        },
        markRendered: (id: string, revision: number) => {
            assert.equal(id, "listing-1");
            assert.equal(revision, 1);
        }
    };
    const context = vm.createContext({
        LFG_PREFIX, LFG_POST_CHANNEL_ID, ChannelType, MessageFlags, validateLfgRequest, buildLfgPost,
        getSetup: () => session, getStore: () => store, setupSessions: new Map(), console
    });
    vm.runInContext(ts.transpileModule(declaration.getText(source), {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, context);
    const interaction = {
        customId: "lfg:publish:setup-1", user: { id: "host-1" },
        guild: { id: "guild-1", channels: { fetch: async (id: string) => { fetchedChannel = id; return destination; } } },
        isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
        deferReply: async () => undefined, editReply: async (content: string) => { reply = content; }
    };
    await context.handleLfgInteraction(interaction);
    assert.equal(fetchedChannel, "1570579425832214568");
    assert.equal(listing?.channelId, "1570579425832214568");
    assert.equal(savedMessageId, "message-1");
    assert.ok(sentPayload);
    assert.match(JSON.stringify(sentPayload.embeds[0].toJSON()), /Test Game/);
    assert.match(JSON.stringify(sentPayload.embeds[0].toJSON()), /Bring a mic/);
    assert.match(reply, /1570579425832214568\/message-1/);
}

runLfgTests();
testBuilderInteractions().then(testPublicPublishDestination).catch(error => { console.error(error); process.exitCode = 1; });
