"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOICE_XP_SESSIONS = void 0;
exports.saveVoiceXpSessions = saveVoiceXpSessions;
exports.awardEngagementXp = awardEngagementXp;
exports.getLiveVoiceTimeMs = getLiveVoiceTimeMs;
exports.formatVoiceDuration = formatVoiceDuration;
exports.voiceXpSessionKey = voiceXpSessionKey;
exports.getCurrentVoiceXpMultiplier = getCurrentVoiceXpMultiplier;
exports.trackVoiceXpConnection = trackVoiceXpConnection;
exports.processVoiceXpSessions = processVoiceXpSessions;
exports.seedConnectedVoiceXpSessions = seedConnectedVoiceXpSessions;
// Engagement XP and live voice XP sessions (2x after continuous voice time).
const discord_js_1 = require("discord.js");
const node_path_1 = __importDefault(require("node:path"));
const utils_1 = require("../../utils");
const voiceXp_1 = require("../../runtime/voiceXp");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const xpPanels_1 = require("../panels/xpPanels");
const settings_1 = require("../core/settings");
const metrics_1 = require("../core/metrics");
const audit_1 = require("../core/audit");
const roles_1 = require("./roles");
const paths_1 = require("../core/paths");
const voiceSessionStore_1 = require("../../runtime/voiceSessionStore");
exports.VOICE_XP_SESSIONS = new Map();
const VOICE_SESSION_FILE = node_path_1.default.resolve(paths_1.BOT_SRC_DIR, "..", "src", "data", "voice-sessions.json");
let voiceSessionsSeeded = false;
function saveVoiceXpSessions(now = Date.now()) {
    if (!voiceSessionsSeeded)
        return;
    (0, voiceSessionStore_1.saveVoiceSessions)(VOICE_SESSION_FILE, [...exports.VOICE_XP_SESSIONS.values()].map(session => ({
        guildId: session.guild.id,
        userId: session.userId,
        connected: session.connected,
        elapsedMs: session.connected ? Math.max(0, now - (session.connectedAt ?? now)) : 0,
        remainderMs: session.remainderMs,
        doubleXpNotified: Boolean(session.doubleXpNotified)
    })));
}
function awardEngagementXp(guild, userId, xpDelta, voiceMinutesDelta = 0) {
    const user = (0, utils_1.ensureUser)(userId);
    if (voiceMinutesDelta > 0)
        user.voiceMinutes += voiceMinutesDelta;
    const previousXp = user.xp;
    const totalXp = (0, utils_1.addXP)(userId, xpDelta);
    if (guild && (0, roles_1.getEffectiveXpRoleEntries)().some(entry => previousXp < entry.xp && totalXp >= entry.xp)) {
        (0, roles_1.enqueueXpRoleSync)(guild, userId, totalXp);
        (0, metrics_1.runAsyncWithBoundary)("xpRoleThresholdNotification", () => (0, roles_1.notifyXpThresholdUnlock)(guild, userId, previousXp, totalXp));
    }
    (0, xpPanels_1.scheduleXpLeaderboardUpdate)();
    return { previousXp, totalXp };
}
function getLiveVoiceTimeMs(userId) {
    const user = (0, utils_1.ensureUser)(userId);
    let totalMs = user.voiceMinutes * 60000;
    const now = Date.now();
    for (const session of exports.VOICE_XP_SESSIONS.values()) {
        if (session.userId !== userId)
            continue;
        totalMs += session.remainderMs;
        if (session.connected)
            totalMs += Math.max(0, now - session.lastAccruedAt);
    }
    return totalMs;
}
function formatVoiceDuration(totalMs) {
    const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}
function voiceXpSessionKey(guildId, userId) {
    return `${guildId}:${userId}`;
}
function getCurrentVoiceXpMultiplier(guild, userId, now = Date.now()) {
    if (!guild?.voiceStates.cache.get(userId)?.channelId)
        return 1;
    const session = exports.VOICE_XP_SESSIONS.get(voiceXpSessionKey(guild.id, userId));
    return session?.connected && session.connectedAt !== undefined
        ? (0, voiceXp_1.getVoiceXpMultiplier)(session.connectedAt, now)
        : 1;
}
function trackVoiceXpConnection(guild, userId, connected, now = Date.now()) {
    const key = voiceXpSessionKey(guild.id, userId);
    const session = exports.VOICE_XP_SESSIONS.get(key);
    if (connected) {
        if (session) {
            if (session.connected)
                return;
            session.guild = guild;
            session.connected = true;
            session.connectedAt = now;
            session.doubleXpNotified = false;
            session.lastAccruedAt = now;
            session.updatedAt = now;
        }
        else {
            exports.VOICE_XP_SESSIONS.set(key, {
                guild,
                userId,
                connected: true,
                connectedAt: now,
                lastAccruedAt: now,
                remainderMs: 0,
                updatedAt: now
            });
        }
        (0, xpPanels_1.scheduleXpLeaderboardUpdate)();
        saveVoiceXpSessions(now);
        return;
    }
    if (!session || !session.connected)
        return;
    awardConnectedVoiceXp(session, now);
    session.connected = false;
    session.lastAccruedAt = now;
    session.updatedAt = now;
    (0, xpPanels_1.scheduleXpLeaderboardUpdate)();
    saveVoiceXpSessions(now);
}
function awardConnectedVoiceXp(session, now = Date.now()) {
    if (!session.connected)
        return;
    const accrued = (0, voiceXp_1.accrueVoiceXp)(session, now);
    session.lastAccruedAt = accrued.state.lastAccruedAt;
    session.remainderMs = accrued.state.remainderMs;
    session.connectedAt = accrued.state.connectedAt;
    session.updatedAt = now;
    if (!session.doubleXpNotified && getCurrentVoiceXpMultiplier(session.guild, session.userId, now) === 2) {
        session.doubleXpNotified = true;
        (0, metrics_1.runAsyncWithBoundary)("voiceDoubleXpNotification", () => notifyVoiceDoubleXpUnlock(session));
    }
    if (accrued.xp <= 0 || !(0, settings_1.isFeatureEnabled)("voiceXp"))
        return;
    const award = awardEngagementXp(session.guild, session.userId, accrued.xp, accrued.minutes);
    (0, audit_1.appendAuditEvent)("voice_engagement_xp", {
        guildId: session.guild.id,
        userId: session.userId,
        xpDelta: accrued.xp,
        minutes: accrued.minutes,
        totalXp: award.totalXp
    });
}
async function notifyVoiceDoubleXpUnlock(session) {
    if (!shouldSendDoubleXpDm(session.userId))
        return;
    const config = (0, voiceXp_1.getVoiceXpConfig)();
    const hours = config.doubleAfterMs / 3600000;
    const user = await client_1.client.users.fetch(session.userId);
    await user.send({
        embeds: [new discord_js_1.EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle("Double Voice XP Unlocked!")
                .setDescription(`You've stayed in voice for over ${Number.isInteger(hours) ? hours : hours.toFixed(2)} continuous hour${hours === 1 ? "" : "s"} in **${session.guild.name}**.\n`
                + `**2x voice XP is active: ${(config.perMinute * 2).toLocaleString("en-US")} XP/minute.**\n`
                + "Switching VCs keeps your bonus. Disconnecting resets it to 1x. Message XP is unchanged.\n"
                + "-# Turn these DMs off any time in /profile → Preferences.")],
        allowedMentions: { parse: [] }
    });
    (0, audit_1.appendAuditEvent)("voice_double_xp_notified", { guildId: session.guild.id, userId: session.userId });
}
function shouldSendDoubleXpDm(userId) {
    return (0, settings_1.isFeatureEnabled)("doubleXpDm") && (0, utils_1.ensureUser)(userId).preferences.doubleXpDm;
}
function processVoiceXpSessions(now = Date.now()) {
    for (const [key, session] of exports.VOICE_XP_SESSIONS.entries()) {
        if (session.connected) {
            const channelId = session.guild.voiceStates.cache.get(session.userId)?.channelId || null;
            if (!(0, voiceXp_1.isVoiceXpEligible)(channelId, false)) {
                awardConnectedVoiceXp(session, now);
                session.connected = false;
                session.lastAccruedAt = now;
                session.updatedAt = now;
            }
            else {
                awardConnectedVoiceXp(session, now);
            }
        }
        else if (now - session.updatedAt >= config_1.VOICE_XP_REMAINDER_TTL_MS) {
            exports.VOICE_XP_SESSIONS.delete(key);
        }
    }
    saveVoiceXpSessions(now);
}
function seedConnectedVoiceXpSessions() {
    const now = Date.now();
    const saved = (0, voiceSessionStore_1.readVoiceSessions)(VOICE_SESSION_FILE);
    for (const previous of saved) {
        const guild = client_1.client.guilds.cache.get(previous.guildId);
        if (!guild)
            continue;
        const state = guild.voiceStates.cache.get(previous.userId);
        const connectedNow = (0, voiceXp_1.isVoiceXpEligible)(state?.channelId ?? null, Boolean(state?.member?.user.bot));
        exports.VOICE_XP_SESSIONS.set(voiceXpSessionKey(guild.id, previous.userId), {
            guild, userId: previous.userId,
            ...(0, voiceSessionStore_1.restoreVoiceSession)(previous, connectedNow, now),
            updatedAt: now
        });
    }
    for (const guild of client_1.client.guilds.cache.values()) {
        for (const state of guild.voiceStates.cache.values()) {
            if ((0, voiceXp_1.isVoiceXpEligible)(state.channelId, Boolean(state.member?.user.bot)) && state.member) {
                trackVoiceXpConnection(guild, state.member.id, true, now);
            }
        }
    }
    voiceSessionsSeeded = true;
    saveVoiceXpSessions(now);
}
