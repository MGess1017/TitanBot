import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { EmbedBuilder } from "discord.js";
import { addXpCrateProfile } from "../features/xpCratePanel";
import type { XpCrateReward } from "../game/xpCrates";
import { accrueVoiceXp, getVoiceXpConfig, getVoiceXpMultiplier, isVoiceXpEligible, VOICE_XP_DOUBLE_AFTER_MS, type VoiceXpAccrualState } from "./voiceXp";
import { restoreVoiceSession, type SavedVoiceSession } from "./voiceSessionStore";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };

const minute = 60_000;
const threshold = VOICE_XP_DOUBLE_AFTER_MS;
assert.equal(threshold, 120 * minute);
assert.equal(getVoiceXpMultiplier(0, threshold - 1), 1);
assert.equal(getVoiceXpMultiplier(0, threshold), 1);
assert.equal(getVoiceXpMultiplier(0, threshold + 1), 2);

for (const [now, expectedXp, expectedMinutes] of [
    [threshold - 1, 11_900, 119],
    [threshold, 12_000, 120],
    [threshold + minute, 12_200, 121],
    [threshold + 60 * minute, 24_000, 180]
]) {
    const result = accrueVoiceXp({ lastAccruedAt: 0, remainderMs: 0, connectedAt: 0 }, now);
    assert.equal(result.xp, expectedXp, `wrong XP at ${now}ms`);
    assert.equal(result.minutes, expectedMinutes, "double XP must not double voice achievement time");
}

let state: VoiceXpAccrualState = { lastAccruedAt: 0, remainderMs: 0, connectedAt: 0 };
let total = 0;
for (let now = 15_000; now <= threshold + 60 * minute; now += 15_000) {
    const result = accrueVoiceXp(state, now);
    state = result.state;
    total += result.xp;
}
assert.equal(total, 24_000, "regular ticks and delayed ticks must award identical XP");
assert.equal(accrueVoiceXp(state, state.lastAccruedAt).xp, 0, "duplicate ticks must not award XP");
assert.equal(accrueVoiceXp(state, state.lastAccruedAt - minute).xp, 0, "clock rollback must not award XP");

const delayed = accrueVoiceXp({
    lastAccruedAt: threshold - 2 * minute,
    remainderMs: 0,
    connectedAt: 0
}, threshold + 3 * minute);
assert.equal(delayed.xp, 800, "a boundary-spanning tick must award 2 normal and 3 doubled minutes");
const fractional = accrueVoiceXp({
    lastAccruedAt: threshold,
    remainderMs: 30_000,
    connectedAt: 0
}, threshold + 30_000);
assert.equal(fractional.xp, 150, "a carried partial minute must split its XP at the actual bonus boundary");

type TestGuild = {
    id: string;
    afkChannelId: string;
    voiceStates: { cache: Map<string, { channelId: string | null }> };
};
type TestSession = VoiceXpAccrualState & {
    guild: TestGuild;
    userId: string;
    connected: boolean;
    updatedAt: number;
    doubleXpNotified?: boolean;
};
type TestVoiceState = {
    channelId: string | null;
    guild: TestGuild;
    member: { id: string; guild: TestGuild; user: { bot: boolean } };
};
const sessions = new Map<string, TestSession>();
const awards: Array<{ xp: number; minutes: number }> = [];
let currentTime = 0;
const unlockNotifications: string[] = [];
let savedSessions: SavedVoiceSession[] = [];
let voiceHandler: ((oldState: TestVoiceState, newState: TestVoiceState) => void) | undefined;
const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
const helperNames = new Set([
    "voiceXpSessionKey", "getCurrentVoiceXpMultiplier", "trackVoiceXpConnection", "awardConnectedVoiceXp",
    "processVoiceXpSessions", "saveVoiceXpSessions", "seedConnectedVoiceXpSessions"
]);
const helpers = source.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text || ""));
assert.equal(helpers.length, helperNames.size);
const voiceEvent = source.statements.find(node => node.getText(source).startsWith('client.on("voiceStateUpdate"'));
assert.ok(voiceEvent);
const context = vm.createContext({
    Date: { now: () => currentTime },
    shuttingDown: false,
    VOICE_XP_SESSIONS: sessions,
    VOICE_XP_REMAINDER_TTL_MS: 24 * 60 * minute,
    accrueVoiceXp,
    getVoiceXpMultiplier,
    isVoiceXpEligible,
    scheduleXpLeaderboardUpdate: () => undefined,
    VOICE_SESSION_FILE: "voice-test.json",
    voiceSessionsSeeded: false,
    readVoiceSessions: () => structuredClone(savedSessions),
    saveVoiceSessions: (_file: string, value: SavedVoiceSession[]) => { savedSessions = structuredClone(value); },
    restoreVoiceSession,
    isFeatureEnabled: () => true,
    appendAuditEvent: () => undefined,
    runAsyncWithBoundary: (_name: string, task: () => Promise<void>) => { void task(); },
    notifyVoiceDoubleXpUnlock: async (session: TestSession) => { unlockNotifications.push(session.userId); },
    awardEngagementXp: (_guild: TestGuild, _id: string, xp: number, minutes: number) => {
        awards.push({ xp, minutes });
        return { totalXp: awards.reduce((sum, award) => sum + award.xp, 0) };
    },
    setTimeout: () => ({ unref: () => undefined }),
    client: {
        guilds: { cache: new Map<string, TestGuild>() },
        on: (_name: string, handler: typeof voiceHandler) => { voiceHandler = handler; }
    }
});
vm.runInContext(ts.transpileModule(
    [...helpers, voiceEvent].map(node => node.getText(source)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
).outputText, context);
const runtime = context as {
    trackVoiceXpConnection: (guild: TestGuild, id: string, connected: boolean, now: number) => void;
    processVoiceXpSessions: (now: number) => void;
    getCurrentVoiceXpMultiplier: (guild: TestGuild | null, userId: string, now: number) => 1 | 2;
    seedConnectedVoiceXpSessions: () => void;
    saveVoiceXpSessions: (now: number) => void;
};
const guild: TestGuild = { id: "guild", afkChannelId: "afk", voiceStates: { cache: new Map() } };
context.client.guilds.cache.set(guild.id, guild);
runtime.seedConnectedVoiceXpSessions();
const member = { id: "user", guild, user: { bot: false } };
function moveVoice(oldChannel: string | null, newChannel: string | null, now: number): void {
    currentTime = now;
    guild.voiceStates.cache.set(member.id, { channelId: newChannel });
    assert.ok(voiceHandler);
    voiceHandler({ channelId: oldChannel, guild, member }, { channelId: newChannel, guild, member });
}

moveVoice(null, "vc-1", 0);
let session = sessions.get("guild:user")!;
assert.equal(runtime.getCurrentVoiceXpMultiplier(guild, member.id, threshold), 1);
assert.equal(runtime.getCurrentVoiceXpMultiplier(guild, member.id, threshold + 1), 2);
assert.equal(runtime.getCurrentVoiceXpMultiplier(null, member.id, threshold + 1), 1);
assert.equal(runtime.getCurrentVoiceXpMultiplier(guild, "unknown-user", threshold + 1), 1);
runtime.trackVoiceXpConnection(guild, member.id, true, minute);
assert.equal(session.connectedAt, 0, "duplicate connection notifications must not restart the session");
moveVoice("vc-1", "vc-2", threshold + minute);
assert.equal(session.connectedAt, 0, "normal VC moves must preserve the bonus timer");
runtime.processVoiceXpSessions(threshold + minute);
assert.equal(awards[awards.length - 1]?.xp, 12_200);
assert.deepEqual(unlockNotifications, ["user"], "crossing two continuous hours must notify the user");
runtime.processVoiceXpSessions(threshold + minute + 15_000);
assert.equal(unlockNotifications.length, 1, "regular ticks must not repeat the unlock DM");
moveVoice("vc-2", null, threshold + 2 * minute);
assert.equal(awards[awards.length - 1]?.xp, 200, "disconnect must settle the final doubled minute");
assert.equal(session.connected, false);
assert.equal(runtime.getCurrentVoiceXpMultiplier(guild, member.id, threshold + 2 * minute), 1);
runtime.processVoiceXpSessions(threshold + 10 * minute);
assert.equal(awards.length, 2, "disconnected time must not earn XP");
moveVoice(null, "vc-3", threshold + 10 * minute);
assert.equal(session.doubleXpNotified, false, "disconnect and reconnect must rearm the notification");
assert.equal(getVoiceXpMultiplier(session.connectedAt!, threshold + 10 * minute), 1);
runtime.processVoiceXpSessions(threshold + 11 * minute);
assert.equal(awards[awards.length - 1]?.xp, 100, "reconnecting must restore the base rate");
moveVoice("vc-3", "afk", threshold + 12 * minute);
assert.equal(session.connected, true, "there must be no AFK penalty");
assert.equal(session.connectedAt, threshold + 10 * minute, "all channel switches preserve the session timer");
runtime.processVoiceXpSessions(threshold + 12 * minute);
assert.equal(awards[awards.length - 1]?.xp, 100, "every VC must earn XP");
moveVoice("afk", "vc-3", threshold + 20 * minute);
assert.equal(session.connectedAt, threshold + 10 * minute, "switching back must preserve the session timer");
guild.voiceStates.cache.set(member.id, { channelId: null });
assert.equal(runtime.getCurrentVoiceXpMultiplier(guild, member.id, threshold * 3), 1, "live status must check voice presence before periodic reconciliation");
runtime.processVoiceXpSessions(threshold + 21 * minute);
assert.equal(session.connected, false, "periodic reconciliation must catch a missing disconnect event");

runtime.trackVoiceXpConnection(guild, "partial", true, 0);
runtime.trackVoiceXpConnection(guild, "partial", false, 30_000);
runtime.trackVoiceXpConnection(guild, "partial", true, threshold);
runtime.trackVoiceXpConnection(guild, "partial", false, threshold + 30_000);
assert.equal(awards[awards.length - 1]?.xp, 100, "reconnect keeps partial earned time but not the old multiplier");
assert.equal(sessions.get("guild:partial")?.remainderMs, 0);
moveVoice(null, "vc-4", threshold * 3);
runtime.processVoiceXpSessions(threshold * 4 + minute);
assert.deepEqual(unlockNotifications, ["user", "user"], "a fresh continuous session must unlock one new DM");
runtime.processVoiceXpSessions(threshold * 4 + 2 * minute);
assert.equal(unlockNotifications.length, 2);
const restartAt = threshold * 8;
const awardsBeforeRestart = awards.length;
sessions.clear();
currentTime = restartAt;
runtime.seedConnectedVoiceXpSessions();
session = sessions.get("guild:user")!;
assert.equal(runtime.getCurrentVoiceXpMultiplier(guild, member.id, restartAt), 2, "startup seeding must restore the saved bonus");
runtime.processVoiceXpSessions(restartAt);
assert.equal(awards.length, awardsBeforeRestart, "startup seeding must not award offline XP");
runtime.processVoiceXpSessions(restartAt + minute);
assert.equal(awards[awards.length - 1]?.xp, 200, "post-restart connected time must earn double XP");
assert.equal(unlockNotifications.length, 2, "startup seeding must not duplicate the unlock notification");
moveVoice("vc-4", null, restartAt + minute);
sessions.clear();
currentTime = restartAt + 2 * minute;
runtime.seedConnectedVoiceXpSessions();
session = sessions.get("guild:user")!;
assert.equal(session.connected, false, "an observed disconnect must remain disconnected after startup");
moveVoice(null, "vc-5", restartAt + 2 * minute);
assert.equal(runtime.getCurrentVoiceXpMultiplier(guild, member.id, restartAt + 2 * minute), 1);
console.log("voice XP bonus and connection lifecycle tests passed");

async function verifyXpStatus(): Promise<void> {
    let xpHandler: ts.ArrowFunction | undefined;
    function findXpHandler(node: ts.Node): void {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === "xp" && ts.isArrowFunction(node.initializer)) {
            xpHandler = node.initializer;
        }
        ts.forEachChild(node, findXpHandler);
    }
    findXpHandler(source);
    assert.ok(xpHandler, "/xp handler must exist");
    const user = {
        xp: 100, prestige: 0, pmcXP: 0, pmcPrestige: 0, lastXP: 0,
        dailyStreak: 0, achievements: [], xpRoleUnlocks: [], fnTokens: 0, bankTokens: 0,
        latestXpCrate: null as XpCrateReward | null
    };
    const statusContext = vm.createContext({
        EmbedBuilder,
        addXpCrateProfile,
        getCurrentVoiceXpMultiplier: (targetGuild: TestGuild | null, userId: string) =>
            runtime.getCurrentVoiceXpMultiplier(targetGuild, userId, Date.now()),
        ensureUser: () => user,
        getPoints: () => 0,
        getAccessPointBadge: () => ({ label: "Recruit" }),
        getPrestigeBadge: () => ({ color: 0x123456, label: "None" }),
        getPmcLevel: () => 1,
        getPmcPrestigeTier: () => ({ numeral: "0", label: "None" }),
        getPmcTierVisual: () => ({ label: "Recruit" }),
        getXPLevel: () => 1,
        XP_LEVEL_THRESHOLDS: [100, 200],
        formatProgressPercent: () => "0%",
        getEffectiveXpRoleEntries: () => [],
        xpBar: () => "[progress]"
    });
    vm.runInContext(ts.transpileModule(`const xpHandler = ${xpHandler.getText(source)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText + "\nthis.handleXp = xpHandler;", statusContext);
    const handle = (statusContext as { handleXp: (interaction: { guild: TestGuild | null; user: { id: string } }) => Promise<string> }).handleXp;
    for (const [channelId, connected, connectedAt, expected] of [
        ["vc-1", true, Date.now(), 1],
        ["vc-1", true, Date.now() - threshold - minute, 2],
        ["afk", true, Date.now() - threshold - minute, 2],
        [null, false, Date.now() - threshold - minute, 1]
    ] as const) {
        guild.voiceStates.cache.set(member.id, { channelId });
        session.connected = connected;
        session.connectedAt = connectedAt;
        const result = JSON.parse(await handle({ guild, user: { id: member.id } }));
        const status = result.embed.fields.find((field: { name: string }) => field.name === "XP Status");
        assert.ok(status, "/xp must show an XP Status field");
        assert.ok(status.value.includes(`Voice XP: **${expected}x** (${expected * 100} XP/minute)`));
        assert.ok(!status.value.includes("AFK"));
    }
    for (const reward of [
        { crateId: "emerald", xp: 1234, claimedAt: Date.now() },
        { crateId: "astral", xp: 1_000_000, claimedAt: Date.now() }
    ] satisfies XpCrateReward[]) {
        user.latestXpCrate = reward;
        const result = JSON.parse(await handle({ guild, user: { id: member.id } }));
        assert.equal(result.xpCrateId, reward.crateId, "attachment must match the profile snapshot");
        assert.equal(result.embed.image.url, `attachment://${reward.crateId}.png`);
        assert.ok(result.embed.fields.some((field: { value: string }) =>
            field.value.includes(`+${reward.xp.toLocaleString("en-US")} XP`)
        ), "reopening /xp must immediately display the latest claimed crate");
    }
    const notification = source.statements.find(node =>
        ts.isFunctionDeclaration(node) && node.name?.text === "notifyVoiceDoubleXpUnlock"
    );
    assert.ok(notification);
    const sent: Array<{ embeds: EmbedBuilder[] }> = [];
    const fetched: string[] = [];
    let dmClosed = false;
    const dmContext = vm.createContext({
        EmbedBuilder,
        getVoiceXpConfig,
        shouldSendDoubleXpDm: () => true,
        client: { users: { fetch: async (id: string) => {
            fetched.push(id);
            return { send: async (payload: { embeds: EmbedBuilder[] }) => {
                if (dmClosed) throw new Error("Cannot send messages to this user");
                sent.push(payload);
            } };
        } } },
        appendAuditEvent: () => undefined
    });
    vm.runInContext(ts.transpileModule(notification.getText(source), {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, dmContext);
    const sendDm = (dmContext as { notifyVoiceDoubleXpUnlock: (value: TestSession) => Promise<void> }).notifyVoiceDoubleXpUnlock;
    await sendDm(session);
    assert.deepEqual(fetched, [member.id], "unlock DM must go to the session owner");
    assert.equal(sent[0].embeds[0].toJSON().title, "Double Voice XP Unlocked!");
    assert.ok(sent[0].embeds[0].toJSON().description?.includes("200 XP/minute"));
    dmClosed = true;
    await assert.rejects(sendDm(session), /Cannot send messages/, "DM failures must propagate to the logged async boundary");
    console.log("/xp live multiplier status tests passed");
}
void verifyXpStatus().catch(error => { console.error(error); process.exitCode = 1; });
