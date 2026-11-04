// Engagement XP and live voice XP sessions (2x after continuous voice time).
import { EmbedBuilder, Guild } from "discord.js";
import path from "node:path";
import { addXP, ensureUser } from "../../utils";
import {
    accrueVoiceXp, getVoiceXpConfig, getVoiceXpMultiplier, isVoiceXpEligible, type VoiceXpAccrualState
} from "../../runtime/voiceXp";
import { VOICE_XP_REMAINDER_TTL_MS } from "../core/config";
import { client } from "../core/client";
import { scheduleXpLeaderboardUpdate } from "../panels/xpPanels";
import { isFeatureEnabled } from "../core/settings";
import { runAsyncWithBoundary } from "../core/metrics";
import { appendAuditEvent } from "../core/audit";
import { enqueueXpRoleSync, getEffectiveXpRoleEntries, notifyXpThresholdUnlock } from "./roles";
import { BOT_SRC_DIR } from "../core/paths";
import { readVoiceSessions, restoreVoiceSession, saveVoiceSessions } from "../../runtime/voiceSessionStore";

type VoiceXpSession = VoiceXpAccrualState & {
    guild: Guild;
    userId: string;
    connected: boolean;
    updatedAt: number;
    doubleXpNotified?: boolean;
};
export const VOICE_XP_SESSIONS = new Map<string, VoiceXpSession>();
const VOICE_SESSION_FILE = path.resolve(BOT_SRC_DIR, "..", "src", "data", "voice-sessions.json");
let voiceSessionsSeeded = false;

export function saveVoiceXpSessions(now = Date.now()): void {
    if (!voiceSessionsSeeded) return;
    saveVoiceSessions(VOICE_SESSION_FILE, [...VOICE_XP_SESSIONS.values()].map(session => ({
        guildId: session.guild.id,
        userId: session.userId,
        connected: session.connected,
        elapsedMs: session.connected ? Math.max(0, now - (session.connectedAt ?? now)) : 0,
        remainderMs: session.remainderMs,
        doubleXpNotified: Boolean(session.doubleXpNotified)
    })));
}

export function awardEngagementXp(guild: Guild | null, userId: string, xpDelta: number, voiceMinutesDelta = 0): { previousXp: number; totalXp: number } {
    const user = ensureUser(userId);
    if (voiceMinutesDelta > 0) user.voiceMinutes += voiceMinutesDelta;
    const previousXp = user.xp;
    const totalXp = addXP(userId, xpDelta);
    if (guild && getEffectiveXpRoleEntries().some(entry => previousXp < entry.xp && totalXp >= entry.xp)) {
        enqueueXpRoleSync(guild, userId, totalXp);
        runAsyncWithBoundary("xpRoleThresholdNotification", () => notifyXpThresholdUnlock(guild, userId, previousXp, totalXp));
    }
    scheduleXpLeaderboardUpdate();
    return { previousXp, totalXp };
}

export function getLiveVoiceTimeMs(userId: string): number {
    const user = ensureUser(userId);
    let totalMs = user.voiceMinutes * 60_000;
    const now = Date.now();
    for (const session of VOICE_XP_SESSIONS.values()) {
        if (session.userId !== userId) continue;
        totalMs += session.remainderMs;
        if (session.connected) totalMs += Math.max(0, now - session.lastAccruedAt);
    }
    return totalMs;
}

export function formatVoiceDuration(totalMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}

export function voiceXpSessionKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
}

export function getCurrentVoiceXpMultiplier(guild: Guild | null, userId: string, now = Date.now()): 1 | 2 {
    if (!guild?.voiceStates.cache.get(userId)?.channelId) return 1;
    const session = VOICE_XP_SESSIONS.get(voiceXpSessionKey(guild.id, userId));
    return session?.connected && session.connectedAt !== undefined
        ? getVoiceXpMultiplier(session.connectedAt, now)
        : 1;
}

export function trackVoiceXpConnection(guild: Guild, userId: string, connected: boolean, now = Date.now()): void {
    const key = voiceXpSessionKey(guild.id, userId);
    const session = VOICE_XP_SESSIONS.get(key);
    if (connected) {
        if (session) {
            if (session.connected) return;
            session.guild = guild;
            session.connected = true;
            session.connectedAt = now;
            session.doubleXpNotified = false;
            session.lastAccruedAt = now;
            session.updatedAt = now;
        } else {
            VOICE_XP_SESSIONS.set(key, {
                guild,
                userId,
                connected: true,
                connectedAt: now,
                lastAccruedAt: now,
                remainderMs: 0,
                updatedAt: now
            });
        }
        scheduleXpLeaderboardUpdate();
        saveVoiceXpSessions(now);
        return;
    }

    if (!session || !session.connected) return;
    awardConnectedVoiceXp(session, now);
    session.connected = false;
    session.lastAccruedAt = now;
    session.updatedAt = now;
    scheduleXpLeaderboardUpdate();
    saveVoiceXpSessions(now);
}

function awardConnectedVoiceXp(session: VoiceXpSession, now = Date.now()): void {
    if (!session.connected) return;
    const accrued = accrueVoiceXp(session, now);
    session.lastAccruedAt = accrued.state.lastAccruedAt;
    session.remainderMs = accrued.state.remainderMs;
    session.connectedAt = accrued.state.connectedAt;
    session.updatedAt = now;
    if (!session.doubleXpNotified && getCurrentVoiceXpMultiplier(session.guild, session.userId, now) === 2) {
        session.doubleXpNotified = true;
        runAsyncWithBoundary("voiceDoubleXpNotification", () => notifyVoiceDoubleXpUnlock(session));
    }
    if (accrued.xp <= 0 || !isFeatureEnabled("voiceXp")) return;

    const award = awardEngagementXp(session.guild, session.userId, accrued.xp, accrued.minutes);
    appendAuditEvent("voice_engagement_xp", {
        guildId: session.guild.id,
        userId: session.userId,
        xpDelta: accrued.xp,
        minutes: accrued.minutes,
        totalXp: award.totalXp
    });
}

async function notifyVoiceDoubleXpUnlock(session: VoiceXpSession): Promise<void> {
    if (!shouldSendDoubleXpDm(session.userId)) return;
    const config = getVoiceXpConfig();
    const hours = config.doubleAfterMs / 3_600_000;
    const user = await client.users.fetch(session.userId);
    await user.send({
        embeds: [new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle("Double Voice XP Unlocked!")
            .setDescription(`You've stayed in voice for over ${Number.isInteger(hours) ? hours : hours.toFixed(2)} continuous hour${hours === 1 ? "" : "s"} in **${session.guild.name}**.\n`
                + `**2x voice XP is active: ${(config.perMinute * 2).toLocaleString("en-US")} XP/minute.**\n`
                + "Switching VCs keeps your bonus. Disconnecting resets it to 1x. Message XP is unchanged.\n"
                + "-# Turn these DMs off any time in /profile → Preferences.")],
        allowedMentions: { parse: [] }
    });
    appendAuditEvent("voice_double_xp_notified", { guildId: session.guild.id, userId: session.userId });
}

function shouldSendDoubleXpDm(userId: string): boolean {
    return isFeatureEnabled("doubleXpDm") && ensureUser(userId).preferences.doubleXpDm;
}

export function processVoiceXpSessions(now = Date.now()): void {
    for (const [key, session] of VOICE_XP_SESSIONS.entries()) {
        if (session.connected) {
            const channelId = session.guild.voiceStates.cache.get(session.userId)?.channelId || null;
            if (!isVoiceXpEligible(channelId, false)) {
                awardConnectedVoiceXp(session, now);
                session.connected = false;
                session.lastAccruedAt = now;
                session.updatedAt = now;
            } else {
                awardConnectedVoiceXp(session, now);
            }
        } else if (now - session.updatedAt >= VOICE_XP_REMAINDER_TTL_MS) {
            VOICE_XP_SESSIONS.delete(key);
        }
    }
    saveVoiceXpSessions(now);
}

export function seedConnectedVoiceXpSessions(): void {
    const now = Date.now();
    const saved = readVoiceSessions(VOICE_SESSION_FILE);
    for (const previous of saved) {
        const guild = client.guilds.cache.get(previous.guildId);
        if (!guild) continue;
        const state = guild.voiceStates.cache.get(previous.userId);
        const connectedNow = isVoiceXpEligible(state?.channelId ?? null, Boolean(state?.member?.user.bot));
        VOICE_XP_SESSIONS.set(voiceXpSessionKey(guild.id, previous.userId), {
            guild, userId: previous.userId,
            ...restoreVoiceSession(previous, connectedNow, now),
            updatedAt: now
        });
    }
    for (const guild of client.guilds.cache.values()) {
        for (const state of guild.voiceStates.cache.values()) {
            if (isVoiceXpEligible(state.channelId, Boolean(state.member?.user.bot)) && state.member) {
                trackVoiceXpConnection(guild, state.member.id, true, now);
            }
        }
    }
    voiceSessionsSeeded = true;
    saveVoiceXpSessions(now);
}
