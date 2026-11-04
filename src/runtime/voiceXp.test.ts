import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { accrueVoiceXp, getVoiceXpMultiplier, isVoiceXpEligible, VOICE_XP_DOUBLE_AFTER_MS, type VoiceXpAccrualState } from "./voiceXp";

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
};
type TestVoiceState = {
    channelId: string | null;
    guild: TestGuild;
    member: { id: string; guild: TestGuild; user: { bot: boolean } };
};
const sessions = new Map<string, TestSession>();
const awards: Array<{ xp: number; minutes: number }> = [];
let currentTime = 0;
let voiceHandler: ((oldState: TestVoiceState, newState: TestVoiceState) => void) | undefined;
const source = ts.createSourceFile("bot.ts", fs.readFileSync(path.resolve(__dirname, "../bot.ts"), "utf8"), ts.ScriptTarget.ES2020, true);
const helperNames = new Set(["voiceXpSessionKey", "trackVoiceXpConnection", "awardConnectedVoiceXp", "processVoiceXpSessions"]);
const helpers = source.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text || ""));
assert.equal(helpers.length, helperNames.size);
const voiceEvent = source.statements.find(node => node.getText(source).startsWith('client.on("voiceStateUpdate"'));
assert.ok(voiceEvent);
const context = vm.createContext({
    Date: { now: () => currentTime },
    VOICE_XP_SESSIONS: sessions,
    VOICE_XP_REMAINDER_TTL_MS: 24 * 60 * minute,
    accrueVoiceXp,
    isVoiceXpEligible,
    scheduleXpLeaderboardUpdate: () => undefined,
    appendAuditEvent: () => undefined,
    awardEngagementXp: (_guild: TestGuild, _id: string, xp: number, minutes: number) => {
        awards.push({ xp, minutes });
        return { totalXp: awards.reduce((sum, award) => sum + award.xp, 0) };
    },
    setTimeout: () => ({ unref: () => undefined }),
    client: { on: (_name: string, handler: typeof voiceHandler) => { voiceHandler = handler; } }
});
vm.runInContext(ts.transpileModule(
    [...helpers, voiceEvent].map(node => node.getText(source)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
).outputText, context);
const runtime = context as {
    trackVoiceXpConnection: (guild: TestGuild, id: string, connected: boolean, now: number) => void;
    processVoiceXpSessions: (now: number) => void;
};
const guild: TestGuild = { id: "guild", afkChannelId: "afk", voiceStates: { cache: new Map() } };
const member = { id: "user", guild, user: { bot: false } };
function moveVoice(oldChannel: string | null, newChannel: string | null, now: number): void {
    currentTime = now;
    guild.voiceStates.cache.set(member.id, { channelId: newChannel });
    assert.ok(voiceHandler);
    voiceHandler({ channelId: oldChannel, guild, member }, { channelId: newChannel, guild, member });
}

moveVoice(null, "vc-1", 0);
const session = sessions.get("guild:user")!;
runtime.trackVoiceXpConnection(guild, member.id, true, minute);
assert.equal(session.connectedAt, 0, "duplicate connection notifications must not restart the session");
moveVoice("vc-1", "vc-2", threshold + minute);
assert.equal(session.connectedAt, 0, "normal VC moves must preserve the bonus timer");
runtime.processVoiceXpSessions(threshold + minute);
assert.equal(awards[awards.length - 1]?.xp, 12_200);
moveVoice("vc-2", null, threshold + 2 * minute);
assert.equal(awards[awards.length - 1]?.xp, 200, "disconnect must settle the final doubled minute");
assert.equal(session.connected, false);
runtime.processVoiceXpSessions(threshold + 10 * minute);
assert.equal(awards.length, 2, "disconnected time must not earn XP");
moveVoice(null, "vc-3", threshold + 10 * minute);
assert.equal(getVoiceXpMultiplier(session.connectedAt!, threshold + 10 * minute), 1);
runtime.processVoiceXpSessions(threshold + 11 * minute);
assert.equal(awards[awards.length - 1]?.xp, 100, "reconnecting must restore the base rate");
moveVoice("vc-3", "afk", threshold + 12 * minute);
assert.equal(session.connected, false, "AFK must end the eligible session");
moveVoice("afk", "vc-3", threshold + 20 * minute);
assert.equal(session.connectedAt, threshold + 20 * minute, "leaving AFK starts a fresh session");
guild.voiceStates.cache.set(member.id, { channelId: null });
runtime.processVoiceXpSessions(threshold + 21 * minute);
assert.equal(session.connected, false, "periodic reconciliation must catch a missing disconnect event");

runtime.trackVoiceXpConnection(guild, "partial", true, 0);
runtime.trackVoiceXpConnection(guild, "partial", false, 30_000);
runtime.trackVoiceXpConnection(guild, "partial", true, threshold);
runtime.trackVoiceXpConnection(guild, "partial", false, threshold + 30_000);
assert.equal(awards[awards.length - 1]?.xp, 100, "reconnect keeps partial earned time but not the old multiplier");
assert.equal(sessions.get("guild:partial")?.remainderMs, 0);
console.log("voice XP bonus and connection lifecycle tests passed");
