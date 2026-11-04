import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { DiscordAPIError, EmbedBuilder, MessageFlags } from "discord.js";
import {
    claimXpCrate, getXpCrateDefinition, isXpCrateReward, rollXpCrate,
    XP_CRATES, XP_CRATE_COOLDOWN_MS, type XpCrateState, type XpCrateReward
} from "../game/xpCrates";
import {
    addXpCrateProfile, buildXpCratePanel, buildXpCrateRewardEmbed, xpCrateAttachment, XP_CRATE_BUTTON_ID
} from "../features/xpCratePanel";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };

function draws(...values: number[]): (max: number) => number {
    let position = 0;
    return max => {
        const value = values[position++];
        assert.ok(value !== undefined && value >= 0 && value < max, `invalid draw ${value} for ${max}`);
        return value;
    };
}
assert.equal(XP_CRATES.length, 10);
assert.equal(new Set(XP_CRATES.map(crate => crate.color)).size, 10, "regular crates must have distinct colors");
assert.equal(XP_CRATES.reduce((sum, crate) => sum + crate.weight, 0), 10_000);
assert.equal(XP_CRATE_COOLDOWN_MS, 86_400_000);
assert.deepEqual(rollXpCrate(1000, draws(0)), { crateId: "astral", xp: 1_000_000, claimedAt: 1000 });

let lowerBound = 0;
for (const crate of XP_CRATES) {
    const zero = rollXpCrate(1000, draws(1, lowerBound, 1, 0));
    assert.equal(zero.crateId, crate.id);
    assert.equal(zero.xp, 0, "every regular chest must allow zero XP with no positive minimum");
    const cap = rollXpCrate(1000, draws(1, lowerBound + crate.weight - 1, 0));
    assert.equal(cap.crateId, crate.id);
    assert.equal(cap.xp, 100_000);
    const nearCap = rollXpCrate(1000, draws(1, lowerBound, 1, 999_999));
    assert.ok(nearCap.xp < 100_000, "ordinary rewards must never accidentally reach the cap");
    lowerBound += crate.weight;
}

let jackpotOutcomes = 0;
for (let roll = 0; roll < 100_000; roll++) {
    const result = rollXpCrate(1000, roll === 0 ? draws(roll) : draws(roll, 0, 1, 0));
    if (result.crateId === "astral") jackpotOutcomes++;
}
assert.equal(jackpotOutcomes, 1, "jackpot probability must be exactly 1 in 100,000");
let cappedOutcomes = 0;
for (let roll = 0; roll < 10_000; roll++) {
    const result = rollXpCrate(1000, roll === 0 ? draws(1, 0, roll) : draws(1, 0, roll, 0));
    if (result.xp === 100_000) cappedOutcomes++;
}
assert.equal(cappedOutcomes, 1, "regular cap probability must be exactly 1 in 10,000");

const state: XpCrateState = { latestXpCrate: null };
const now = 1_800_000_000_000;
const first = claimXpCrate(state, now, draws(1, 0, 1, 0));
assert.ok(first.ok);
assert.equal(first.reward.xp, 0);
assert.equal(claimXpCrate(state, now).ok, false, "zero-XP claims must still consume the daily claim");
assert.equal(claimXpCrate(state, now + XP_CRATE_COOLDOWN_MS - 1).ok, false);
const restored: XpCrateState = JSON.parse(JSON.stringify(state));
assert.equal(claimXpCrate(restored, now + 1000).ok, false, "cooldown must survive reloading persisted state");
assert.equal(claimXpCrate(restored, now - 1000).ok, false, "clock rollback must not bypass the cooldown");
const next = claimXpCrate(restored, now + XP_CRATE_COOLDOWN_MS, draws(0));
assert.ok(next.ok, "the exact rolling 24-hour boundary must permit another claim");
assert.equal(next.reward.xp, 1_000_000);
assert.equal(isXpCrateReward(next.reward), true);
for (const invalid of [
    { crateId: "unknown", xp: 1, claimedAt: now },
    { crateId: "slate", xp: 100_001, claimedAt: now },
    { crateId: "astral", xp: 100_000, claimedAt: now },
    { crateId: "slate", xp: -1, claimedAt: now },
    { crateId: "slate", xp: 0.5, claimedAt: now },
    { crateId: "slate", xp: 10, claimedAt: NaN }
]) assert.equal(isXpCrateReward(invalid), false);

const panel = buildXpCratePanel();
assert.equal(panel.embeds[0].toJSON().title, "FN Xp Panel");
assert.equal(panel.embeds[0].toJSON().color, 0x9b59b6);
const claimButton = panel.components[0].toJSON().components[0];
assert.ok("custom_id" in claimButton);
assert.equal(claimButton.custom_id, XP_CRATE_BUTTON_ID);
assert.deepEqual(panel.allowedMentions.parse, []);
for (const crateId of [...XP_CRATES.map(crate => crate.id), "astral"] as const) {
    const reward: XpCrateReward = { crateId, xp: crateId === "astral" ? 1_000_000 : 100, claimedAt: now };
    const definition = getXpCrateDefinition(crateId);
    const resultEmbed = buildXpCrateRewardEmbed(reward).toJSON();
    assert.equal(resultEmbed.color, definition.color);
    assert.equal(resultEmbed.image?.url, `attachment://${crateId}.png`);
    const asset = xpCrateAttachment(crateId);
    assert.equal(asset.name, `${crateId}.png`);
    const imagePath = path.resolve(__dirname, `../../assets/xp-crates/${crateId}.png`);
    const bytes = fs.readFileSync(imagePath);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG", "every crate must ship with a real PNG chest image");
    assert.equal(bytes.readUInt32BE(16), 384);
    assert.equal(bytes.readUInt32BE(20), 384);
    const profile = addXpCrateProfile(new EmbedBuilder(), reward, now + 1000).toJSON();
    assert.ok(profile.fields?.[0].value.includes("already credited"));
    assert.equal(profile.image?.url, `attachment://${crateId}.png`);
    assert.ok(addXpCrateProfile(new EmbedBuilder(), reward, now + XP_CRATE_COOLDOWN_MS).toJSON().fields?.[0].value.includes("ready"));
}
assert.ok(addXpCrateProfile(new EmbedBuilder(), null).toJSON().fields?.[0].value.includes("No crate claimed yet"));

async function verifyClaimButton(): Promise<void> {
    const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
    let buttonBranch: ts.IfStatement | undefined;
    function findBranch(node: ts.Node): void {
        if (ts.isIfStatement(node) && node.expression.getText(source).includes("interaction.customId === XP_CRATE_BUTTON_ID")) {
            buttonBranch = node;
        }
        ts.forEachChild(node, findBranch);
    }
    findBranch(source);
    assert.ok(buttonBranch);
    const user: XpCrateState & { xp: number } = { xp: 500, latestXpCrate: null };
    let saved: typeof user | undefined;
    let saves = 0;
    let drawsCount = 0;
    let rewardXp = 1_000_000;
    const replies: Array<{ content?: string; embeds?: EmbedBuilder[]; files?: unknown[] }> = [];
    const failures: string[] = [];
    const context = vm.createContext({
        XP_CRATE_BUTTON_ID,
        getXpPanelChannelId: () => "1527571592320651285",
        isFeatureEnabled: () => true,
        MessageFlags,
        ensureUser: () => user,
        claimXpCrate: (state: XpCrateState) => {
            if (state.latestXpCrate && state.latestXpCrate.claimedAt + XP_CRATE_COOLDOWN_MS > now) {
                return { ok: false, nextClaimAt: state.latestXpCrate.claimedAt + XP_CRATE_COOLDOWN_MS };
            }
            drawsCount++;
            const reward: XpCrateReward = { crateId: rewardXp === 1_000_000 ? "astral" : "slate", xp: rewardXp, claimedAt: now };
            state.latestXpCrate = reward;
            return { ok: true, reward };
        },
        withDeferredPointsSave: (task: () => unknown) => task(),
        awardEngagementXp: (_guild: unknown, _id: string, xp: number) => { user.xp += xp; },
        savePoints: () => { saved = JSON.parse(JSON.stringify(user)); saves++; },
        appendAuditEvent: () => undefined,
        buildXpCrateRewardEmbed,
        xpCrateAttachment,
        console: { error: (...args: unknown[]) => { failures.push(String(args[0])); } },
        toSafeString: String
    });
    vm.runInContext(ts.transpileModule(`async function claimButton(interaction) { ${buttonBranch.getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, context);
    const button = {
        isButton: () => true,
        customId: XP_CRATE_BUTTON_ID,
        guild: { id: "guild" },
        guildId: "guild",
        channelId: "1527571592320651285",
        user: { id: "user", bot: false },
        deferReply: async (value: { flags: number }) => { assert.equal(value.flags, MessageFlags.Ephemeral); },
        editReply: async (value: typeof replies[number]) => { replies.push(value); },
        reply: async (value: typeof replies[number]) => { replies.push(value); }
    };
    const handle = (context as { claimButton: (interaction: typeof button) => Promise<void> }).claimButton;
    await Promise.all([handle(button), handle(button), handle(button)]);
    assert.equal(drawsCount, 1, "simultaneous clicks must claim only once");
    assert.equal(user.xp, 1_000_500, "jackpot XP must be credited once without the voice multiplier");
    assert.equal(saved?.latestXpCrate?.crateId, "astral");
    assert.equal(saved?.xp, user.xp, "XP and claim cooldown must persist together");
    assert.equal(saves, 1);
    assert.equal(replies.filter(reply => reply.content === "Daily limit exceeded").length, 2);
    assert.equal(replies[0].files?.length, 1);
    assert.equal(failures.length, 0);
    user.latestXpCrate = null;
    rewardXp = 0;
    await handle(button);
    assert.equal(saves, 2, "zero-XP reward must still save its cooldown and profile result");
    assert.equal((user as XpCrateState).latestXpCrate?.xp, 0);
    await handle({ ...button, channelId: "wrong-channel" });
    assert.equal(saves, 2, "claims outside the panel channel must be rejected");
    assert.ok(replies[replies.length - 1].content?.includes("designated server channel"));
    const panelSource = ts.createSourceFile("xpCratePanel.ts", fs.readFileSync(path.resolve(__dirname, "../features/xpCratePanel.ts"), "utf8"), ts.ScriptTarget.ES2020, true);
    const helpers = panelSource.statements.filter(node =>
        ts.isFunctionDeclaration(node) && ["isCratePanel", "upsertXpCratePanel"].includes(node.name?.text || "")
    );
    assert.equal(helpers.length, 2);
    const panelContext = vm.createContext({
        exports: {}, DiscordAPIError, buildXpCratePanel, XP_CRATE_PANEL_TITLE: "FN Xp Panel"
    });
    vm.runInContext(ts.transpileModule(helpers.map(node => node.getText(panelSource)).join("\n"), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText, panelContext);
    let edits = 0;
    let sends = 0;
    let fetchError: Error | null = null;
    const message = {
        id: "panel", author: { id: "bot" }, embeds: [{ title: "FN Xp Panel" }],
        edit: async () => { edits++; }
    };
    let recentMessages = [message];
    const channel = {
        messages: { fetch: async (query: string | { limit: number }) => {
            if (typeof query === "string") {
                if (fetchError) throw fetchError;
                return message;
            }
            return { find: (predicate: (item: typeof message) => boolean) => recentMessages.find(predicate) };
        } },
        send: async () => { sends++; return { id: "created" }; }
    };
    const upsert = (panelContext as {
        upsertXpCratePanel: (inputChannel: typeof channel, botId: string, storedId: string | null) => Promise<string>;
    }).upsertXpCratePanel;
    assert.equal(await upsert(channel, "bot", "panel"), "panel");
    assert.equal(await upsert(channel, "bot", null), "panel", "startup must recover a panel without its saved ID");
    assert.equal(edits, 2);
    assert.equal(sends, 0);
    fetchError = new DiscordAPIError({ code: 10008, message: "Unknown Message" }, 10008, 404, "GET", "https://discord.com/api", {});
    recentMessages = [];
    assert.equal(await upsert(channel, "bot", "deleted"), "created", "a deleted daily panel must be recreated at startup");
    fetchError = new Error("Missing Permissions");
    await assert.rejects(upsert(channel, "bot", "panel"), /Missing Permissions/);
    assert.equal(sends, 1, "permission failures must not produce duplicate panels");
    console.log("XP crate odds, cooldown, assets, profiles, and claim button tests passed");
}
void verifyClaimButton().catch(error => { console.error(error); process.exitCode = 1; });
