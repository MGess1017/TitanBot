// Spam alerts and staff health checks.
import { Guild, MessageFlags, PermissionFlagsBits, type Interaction } from "discord.js";
import { getJsonSaveFailures } from "../../runtime/jsonPersistence";
import { type AntiRaidDetection } from "../../features/antiRaid";
import { buildHealthPayload, buildIncidentAlert, healthSignature, type HealthIssue } from "../../features/staffHub";
import { JOIN_WELCOME_CHANNEL_ID, PERMANENT_TICKET_PANEL_CHANNEL_ID, PLAYER_COUNT_CHANNEL_ID, WHATS_NEW_CHANNEL_ID } from "../core/config";
import { ensureCheckpointCardPanel } from "../panels/playerCards";
import { ensureInquiryPanelForGuild } from "../panels/inquiry";
import { client } from "../core/client";
import { ensureXpCratePanel, refreshXpLeaderboardPanel } from "../panels/xpPanels";
import { antiRaidIncidents, botSettingsStore, isFeatureEnabled, SAVE_HEALTH } from "../core/settings";
import { ASYNC_FAILURES, PROCESS_STARTED_AT } from "../core/metrics";
import { postOpsAlert, toSafeString } from "../core/ops";
import { appendAuditEvent } from "../core/audit";
import { getGuildPanelMessageId, type GuildPanelKey } from "../moderation/store";
import { getPrimaryGuild } from "../core/reports";
import { clampText } from "../ui/embeds";
import { fetchGuildTextChannel, isStaffMember, postStaffAlert } from "./staffDesk";

// ---------- Staff desk ----------

export let lastHealthIssues: HealthIssue[] = [];
let lastHealthSignature = "";

// ---------- Spam alerts (message abuse only; never kicks or bans) ----------

export async function raiseAntiRaidAlert(_guild: Guild, detection: AntiRaidDetection): Promise<void> {
    const incident = antiRaidIncidents.create(detection);
    appendAuditEvent("anti_raid_detected", { guildId: incident.guildId, incidentId: incident.id, kind: incident.kind, userIds: incident.userIds });
    const message = await postStaffAlert(buildIncidentAlert(incident));
    if (message) {
        antiRaidIncidents.update(incident.id, entry => {
            entry.alertChannelId = message.channelId;
            entry.alertMessageId = message.id;
        });
    } else {
        postOpsAlert("warn", "Spam alert could not be delivered", { incidentId: incident.id, kind: incident.kind });
    }
}

export async function handleAntiRaidAction(interaction: Interaction, guild: Guild): Promise<void> {
    if (!interaction.isButton()) return;
    const [, action, incidentId] = interaction.customId.split(":");
    const incident = antiRaidIncidents.get(incidentId);
    if (!incident || incident.guildId !== guild.id) {
        await interaction.reply({ content: "This incident is no longer tracked.", flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferUpdate();
    const actorId = interaction.user.id;
    const minutes = botSettingsStore.get().antiRaid.timeoutMinutes;
    let count = 0;
    let note = "";
    if (action === "timeout") {
        const affected: string[] = [];
        for (const userId of incident.userIds) {
            if (incident.timedOutUserIds.includes(userId)) continue;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member || member.user.bot || isStaffMember(member) || !member.moderatable) continue;
            const ok = await member.timeout(minutes * 60_000, `Spam alert ${incident.id} by ${interaction.user.username}`).then(() => true).catch(() => false);
            if (ok) affected.push(userId);
        }
        count = affected.length;
        antiRaidIncidents.update(incident.id, entry => {
            entry.timedOutUserIds = [...new Set([...entry.timedOutUserIds, ...affected])];
            entry.actions.push({ type: "timeout", byId: actorId, at: Date.now(), count });
        });
        if (!count) note = "No members could be timed out (they left, are staff, or rank above the bot).";
    } else if (action === "untimeout") {
        for (const userId of incident.timedOutUserIds) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member && await member.timeout(null, `Spam alert ${incident.id} undone by ${interaction.user.username}`).then(() => true).catch(() => false)) count += 1;
        }
        antiRaidIncidents.update(incident.id, entry => {
            entry.timedOutUserIds = [];
            entry.actions.push({ type: "untimeout", byId: actorId, at: Date.now(), count });
        });
    } else if (action === "dismiss") {
        antiRaidIncidents.update(incident.id, entry => {
            entry.actions.push({ type: "dismiss", byId: actorId, at: Date.now() });
        });
    }
    appendAuditEvent("anti_raid_action", { guildId: guild.id, incidentId: incident.id, action, actorId, count });
    const updated = antiRaidIncidents.get(incident.id)!;
    await interaction.editReply(buildIncidentAlert(updated));
    if (note) await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral });
}

// ---------- Health checks ----------

export async function runStaffHealthCheck(reason: string): Promise<{ issues: HealthIssue[]; notes: string[] }> {
    const issues: HealthIssue[] = [];
    const notes: string[] = [];
    const settings = botSettingsStore.get();
    const guild = getPrimaryGuild();
    if (!client.isReady()) issues.push({ key: "client:not-ready", severity: "critical", message: "Discord client is not ready." });
    if (!guild) {
        issues.push({ key: "guild:missing", severity: "critical", message: "Primary guild is unavailable." });
    } else {
        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!me) {
            issues.push({ key: "guild:no-member", severity: "critical", message: "Bot member could not be loaded." });
        } else {
            const guildPerms: Array<[bigint, string, string]> = [
                [PermissionFlagsBits.ManageRoles, "Manage Roles", "XP rank roles"],
                [PermissionFlagsBits.ModerateMembers, "Timeout Members", "spam alert timeouts"],
                [PermissionFlagsBits.ManageChannels, "Manage Channels", "tickets and temp VCs"]
            ];
            for (const [flag, name, purpose] of guildPerms) {
                if (!me.permissions.has(flag)) issues.push({ key: `perm:guild:${name}`, severity: "warning", message: `Missing **${name}** (needed for ${purpose}).` });
            }
            const channelChecks: Array<{ id: string; label: string; files: boolean }> = [
                { id: settings.channels.modAlerts, label: "Staff alerts", files: false },
                { id: settings.channels.xpPanels, label: "XP panels", files: true },
                { id: PLAYER_COUNT_CHANNEL_ID, label: "Player inquiry", files: true },
                { id: settings.channels.checkpointCards, label: "Player rating", files: true },
                { id: WHATS_NEW_CHANNEL_ID, label: "What's New", files: false },
                { id: JOIN_WELCOME_CHANNEL_ID, label: "Welcome", files: false },
                { id: PERMANENT_TICKET_PANEL_CHANNEL_ID, label: "Ticket panel", files: false }
            ];
            for (const check of channelChecks) {
                const channel = await fetchGuildTextChannel(check.id);
                if (!channel) {
                    issues.push({ key: `channel:missing:${check.id}`, severity: "critical", message: `${check.label} channel <#${check.id}> is missing or not a text channel.` });
                    continue;
                }
                const perms = channel.permissionsFor(me);
                const needed: Array<[bigint, string]> = [
                    [PermissionFlagsBits.ViewChannel, "View Channel"], [PermissionFlagsBits.SendMessages, "Send Messages"],
                    [PermissionFlagsBits.EmbedLinks, "Embed Links"], [PermissionFlagsBits.ReadMessageHistory, "Read History"],
                    ...(check.files ? [[PermissionFlagsBits.AttachFiles, "Attach Files"] as [bigint, string]] : [])
                ];
                const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
                if (missing.length) issues.push({ key: `perm:${check.id}:${missing.join(",")}`, severity: "critical", message: `${check.label} <#${check.id}> missing: ${missing.join(", ")}.` });
            }
            const panels: Array<{ key: GuildPanelKey; channelId: string; label: string; repair: () => Promise<void>; enabled: boolean }> = [
                { key: "xpLeaderboard", channelId: settings.channels.xpPanels, label: "XP leaderboard", repair: refreshXpLeaderboardPanel, enabled: true },
                { key: "xpCrate", channelId: settings.channels.xpPanels, label: "FN Xp Panel", repair: ensureXpCratePanel, enabled: settings.features.xpCrates },
                { key: "checkpointCard", channelId: settings.channels.checkpointCards, label: "Arena Player Rating panel", repair: ensureCheckpointCardPanel, enabled: settings.features.checkpointCards },
                { key: "inquiry", channelId: PLAYER_COUNT_CHANNEL_ID, label: "Player inquiry panel", repair: () => ensureInquiryPanelForGuild(guild), enabled: true }
            ];
            for (const panel of panels) {
                if (!panel.enabled) continue;
                const channel = await fetchGuildTextChannel(panel.channelId);
                const messageId = getGuildPanelMessageId(guild.id, panel.key);
                const exists = Boolean(channel && messageId && await channel.messages.fetch(messageId).catch(() => null));
                if (exists) continue;
                try {
                    await panel.repair();
                    notes.push(`🔧 Re-posted missing **${panel.label}**.`);
                    appendAuditEvent("health_panel_repaired", { panel: panel.key, reason });
                } catch (error) {
                    issues.push({ key: `panel:${panel.key}`, severity: "critical", message: `${panel.label} is missing and could not be re-posted: ${clampText(toSafeString(error), 120)}` });
                }
            }
        }
    }

    for (const [store, entry] of SAVE_HEALTH) {
        if (entry.lastError) {
            issues.push({ key: `save:${store}`, severity: "critical", message: `${store} saves are failing: ${clampText(entry.lastError, 120)}` });
        }
    }
    for (const failure of getJsonSaveFailures()) {
        issues.push({
            key: `save:${failure.file}`, severity: "critical",
            message: `JSON save failed (${failure.file}): ${clampText(failure.error, 120)}`
        });
    }
    const now = Date.now();
    const startupFailures = ASYNC_FAILURES.filter(failure => failure.at - PROCESS_STARTED_AT <= 2 * 60_000);
    for (const context of new Set(startupFailures.map(failure => failure.context))) {
        issues.push({ key: `startup:${context}`, severity: "critical", message: `Startup task **${context}** failed: ${clampText(startupFailures.find(failure => failure.context === context)!.reason, 100)}` });
    }
    const recentFailures = ASYNC_FAILURES.filter(failure => now - failure.at <= 30 * 60_000 && failure.at - PROCESS_STARTED_AT > 2 * 60_000);
    const byContext = new Map<string, number>();
    for (const failure of recentFailures) byContext.set(failure.context, (byContext.get(failure.context) || 0) + 1);
    for (const [context, count] of byContext) {
        issues.push({ key: `async:${context}`, severity: "warning", message: `**${context}** failed ${count}× in the last 30 min.` });
    }

    lastHealthIssues = issues;
    return { issues, notes };
}

export async function runStaffHealthMonitor(reason: string): Promise<void> {
    const report = await runStaffHealthCheck(reason);
    const signature = healthSignature(report.issues);
    const changed = signature !== lastHealthSignature;
    lastHealthSignature = signature;
    if (!isFeatureEnabled("healthAlerts")) return;
    if ((changed && (report.issues.length > 0 || reason !== "startup")) || report.notes.length) {
        await postStaffAlert({ embeds: buildHealthPayload(report.issues, Date.now(), [`Trigger: ${reason}`, ...report.notes]).embeds });
    }
}
