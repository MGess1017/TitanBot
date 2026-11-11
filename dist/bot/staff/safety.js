"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lastHealthIssues = void 0;
exports.raiseAntiRaidAlert = raiseAntiRaidAlert;
exports.handleAntiRaidAction = handleAntiRaidAction;
exports.runStaffHealthCheck = runStaffHealthCheck;
exports.runStaffHealthMonitor = runStaffHealthMonitor;
// Spam alerts and staff health checks.
const discord_js_1 = require("discord.js");
const jsonPersistence_1 = require("../../runtime/jsonPersistence");
const staffHub_1 = require("../../features/staffHub");
const config_1 = require("../core/config");
const playerCards_1 = require("../panels/playerCards");
const inquiry_1 = require("../panels/inquiry");
const embedBuilder_1 = require("../panels/embedBuilder");
const owner_1 = require("../panels/owner");
const store_1 = require("../panels/store");
const client_1 = require("../core/client");
const xpPanels_1 = require("../panels/xpPanels");
const settings_1 = require("../core/settings");
const metrics_1 = require("../core/metrics");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const store_2 = require("../moderation/store");
const reports_1 = require("../core/reports");
const embeds_1 = require("../ui/embeds");
const staffDesk_1 = require("./staffDesk");
// ---------- Staff desk ----------
exports.lastHealthIssues = [];
let lastHealthSignature = "";
// ---------- Spam alerts (message abuse only; never kicks or bans) ----------
async function raiseAntiRaidAlert(_guild, detection) {
    const incident = settings_1.antiRaidIncidents.create(detection);
    (0, audit_1.appendAuditEvent)("anti_raid_detected", { guildId: incident.guildId, incidentId: incident.id, kind: incident.kind, userIds: incident.userIds });
    const message = await (0, staffDesk_1.postStaffAlert)((0, staffHub_1.buildIncidentAlert)(incident));
    if (message) {
        settings_1.antiRaidIncidents.update(incident.id, entry => {
            entry.alertChannelId = message.channelId;
            entry.alertMessageId = message.id;
        });
    }
    else {
        (0, ops_1.postOpsAlert)("warn", "Spam alert could not be delivered", { incidentId: incident.id, kind: incident.kind });
    }
}
async function handleAntiRaidAction(interaction, guild) {
    if (!interaction.isButton())
        return;
    const [, action, incidentId] = interaction.customId.split(":");
    const incident = settings_1.antiRaidIncidents.get(incidentId);
    if (!incident || incident.guildId !== guild.id) {
        await interaction.reply({ content: "This incident is no longer tracked.", flags: discord_js_1.MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferUpdate();
    const actorId = interaction.user.id;
    const minutes = settings_1.botSettingsStore.get().antiRaid.timeoutMinutes;
    let count = 0;
    let note = "";
    if (action === "timeout") {
        const affected = [];
        for (const userId of incident.userIds) {
            if (incident.timedOutUserIds.includes(userId))
                continue;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member || member.user.bot || (0, staffDesk_1.isStaffMember)(member) || !member.moderatable)
                continue;
            const ok = await member.timeout(minutes * 60000, `Spam alert ${incident.id} by ${interaction.user.username}`).then(() => true).catch(() => false);
            if (ok)
                affected.push(userId);
        }
        count = affected.length;
        settings_1.antiRaidIncidents.update(incident.id, entry => {
            entry.timedOutUserIds = [...new Set([...entry.timedOutUserIds, ...affected])];
            entry.actions.push({ type: "timeout", byId: actorId, at: Date.now(), count });
        });
        if (!count)
            note = "No members could be timed out (they left, are staff, or rank above the bot).";
    }
    else if (action === "untimeout") {
        for (const userId of incident.timedOutUserIds) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member && await member.timeout(null, `Spam alert ${incident.id} undone by ${interaction.user.username}`).then(() => true).catch(() => false))
                count += 1;
        }
        settings_1.antiRaidIncidents.update(incident.id, entry => {
            entry.timedOutUserIds = [];
            entry.actions.push({ type: "untimeout", byId: actorId, at: Date.now(), count });
        });
    }
    else if (action === "dismiss") {
        settings_1.antiRaidIncidents.update(incident.id, entry => {
            entry.actions.push({ type: "dismiss", byId: actorId, at: Date.now() });
        });
    }
    (0, audit_1.appendAuditEvent)("anti_raid_action", { guildId: guild.id, incidentId: incident.id, action, actorId, count });
    const updated = settings_1.antiRaidIncidents.get(incident.id);
    await interaction.editReply((0, staffHub_1.buildIncidentAlert)(updated));
    if (note)
        await interaction.followUp({ content: note, flags: discord_js_1.MessageFlags.Ephemeral });
}
// ---------- Health checks ----------
async function runStaffHealthCheck(reason) {
    const issues = [];
    const notes = [];
    const settings = settings_1.botSettingsStore.get();
    const guild = (0, reports_1.getPrimaryGuild)();
    if (!client_1.client.isReady())
        issues.push({ key: "client:not-ready", severity: "critical", message: "Discord client is not ready." });
    if (!guild) {
        issues.push({ key: "guild:missing", severity: "critical", message: "Primary guild is unavailable." });
    }
    else {
        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!me) {
            issues.push({ key: "guild:no-member", severity: "critical", message: "Bot member could not be loaded." });
        }
        else {
            const guildPerms = [
                [discord_js_1.PermissionFlagsBits.ManageRoles, "Manage Roles", "XP rank roles"],
                [discord_js_1.PermissionFlagsBits.ModerateMembers, "Timeout Members", "spam alert timeouts"],
                [discord_js_1.PermissionFlagsBits.ManageChannels, "Manage Channels", "tickets and temp VCs"]
            ];
            for (const [flag, name, purpose] of guildPerms) {
                if (!me.permissions.has(flag))
                    issues.push({ key: `perm:guild:${name}`, severity: "warning", message: `Missing **${name}** (needed for ${purpose}).` });
            }
            const channelChecks = [
                { id: settings.channels.modAlerts, label: "Staff alerts", files: false },
                { id: settings.channels.xpPanels, label: "XP panels", files: true },
                { id: config_1.PLAYER_COUNT_CHANNEL_ID, label: "Player inquiry", files: true },
                { id: config_1.STAFF_EMBED_CHANNEL_ID, label: "Staff embed builder", files: false },
                { id: config_1.OWNER_PANEL_CHANNEL_ID, label: "Owner Control", files: false },
                { id: config_1.STORE_CHANNEL_ID, label: "Store", files: false },
                { id: config_1.STORE_ADMIN_CHANNEL_ID, label: "Store management", files: false },
                { id: settings.channels.checkpointCards, label: "Player rating", files: true },
                { id: config_1.WHATS_NEW_CHANNEL_ID, label: "What's New", files: false },
                { id: config_1.JOIN_WELCOME_CHANNEL_ID, label: "Welcome", files: false },
                { id: config_1.PERMANENT_TICKET_PANEL_CHANNEL_ID, label: "Ticket panel", files: false }
            ];
            for (const check of channelChecks) {
                const channel = await (0, staffDesk_1.fetchGuildTextChannel)(check.id);
                if (!channel) {
                    issues.push({ key: `channel:missing:${check.id}`, severity: "critical", message: `${check.label} channel <#${check.id}> is missing or not a text channel.` });
                    continue;
                }
                const perms = channel.permissionsFor(me);
                const needed = [
                    [discord_js_1.PermissionFlagsBits.ViewChannel, "View Channel"], [discord_js_1.PermissionFlagsBits.SendMessages, "Send Messages"],
                    [discord_js_1.PermissionFlagsBits.EmbedLinks, "Embed Links"], [discord_js_1.PermissionFlagsBits.ReadMessageHistory, "Read History"],
                    ...(check.files ? [[discord_js_1.PermissionFlagsBits.AttachFiles, "Attach Files"]] : [])
                ];
                const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
                if (missing.length)
                    issues.push({ key: `perm:${check.id}:${missing.join(",")}`, severity: "critical", message: `${check.label} <#${check.id}> missing: ${missing.join(", ")}.` });
            }
            const panels = [
                { key: "xpLeaderboard", channelId: settings.channels.xpPanels, label: "XP leaderboard", repair: xpPanels_1.refreshXpLeaderboardPanel, enabled: true },
                { key: "xpCrate", channelId: settings.channels.xpPanels, label: "FN Xp Panel", repair: xpPanels_1.ensureXpCratePanel, enabled: settings.features.xpCrates },
                { key: "checkpointCard", channelId: settings.channels.checkpointCards, label: "Arena Player Rating panel", repair: playerCards_1.ensureCheckpointCardPanel, enabled: settings.features.checkpointCards },
                { key: "inquiry", channelId: config_1.PLAYER_COUNT_CHANNEL_ID, label: "Player inquiry panel", repair: () => (0, inquiry_1.ensureInquiryPanelForGuild)(guild), enabled: true },
                { key: "staffEmbed", channelId: config_1.STAFF_EMBED_CHANNEL_ID, label: "Staff embed builder", repair: () => (0, embedBuilder_1.ensureStaffEmbedPanelForGuild)(guild), enabled: true },
                { key: "owner", channelId: config_1.OWNER_PANEL_CHANNEL_ID, label: "Owner Control", repair: () => (0, owner_1.ensureOwnerPanelForGuild)(guild), enabled: true },
                { key: "store", channelId: config_1.STORE_CHANNEL_ID, label: "Store", repair: () => (0, store_1.ensureStorePanelsForGuild)(guild), enabled: true },
                { key: "storeAdmin", channelId: config_1.STORE_ADMIN_CHANNEL_ID, label: "Store management", repair: () => (0, store_1.ensureStorePanelsForGuild)(guild), enabled: true }
            ];
            for (const panel of panels) {
                if (!panel.enabled)
                    continue;
                const channel = await (0, staffDesk_1.fetchGuildTextChannel)(panel.channelId);
                const messageId = (0, store_2.getGuildPanelMessageId)(guild.id, panel.key);
                const exists = Boolean(channel && messageId && await channel.messages.fetch(messageId).catch(() => null));
                if (exists)
                    continue;
                try {
                    await panel.repair();
                    notes.push(`🔧 Re-posted missing **${panel.label}**.`);
                    (0, audit_1.appendAuditEvent)("health_panel_repaired", { panel: panel.key, reason });
                }
                catch (error) {
                    issues.push({ key: `panel:${panel.key}`, severity: "critical", message: `${panel.label} is missing and could not be re-posted: ${(0, embeds_1.clampText)((0, ops_1.toSafeString)(error), 120)}` });
                }
            }
        }
    }
    for (const [store, entry] of settings_1.SAVE_HEALTH) {
        if (entry.lastError) {
            issues.push({ key: `save:${store}`, severity: "critical", message: `${store} saves are failing: ${(0, embeds_1.clampText)(entry.lastError, 120)}` });
        }
    }
    for (const failure of (0, jsonPersistence_1.getJsonSaveFailures)()) {
        issues.push({
            key: `save:${failure.file}`, severity: "critical",
            message: `JSON save failed (${failure.file}): ${(0, embeds_1.clampText)(failure.error, 120)}`
        });
    }
    const now = Date.now();
    const startupFailures = metrics_1.ASYNC_FAILURES.filter(failure => failure.at - metrics_1.PROCESS_STARTED_AT <= 2 * 60000);
    for (const context of new Set(startupFailures.map(failure => failure.context))) {
        issues.push({ key: `startup:${context}`, severity: "critical", message: `Startup task **${context}** failed: ${(0, embeds_1.clampText)(startupFailures.find(failure => failure.context === context).reason, 100)}` });
    }
    const recentFailures = metrics_1.ASYNC_FAILURES.filter(failure => now - failure.at <= 30 * 60000 && failure.at - metrics_1.PROCESS_STARTED_AT > 2 * 60000);
    const byContext = new Map();
    for (const failure of recentFailures)
        byContext.set(failure.context, (byContext.get(failure.context) || 0) + 1);
    for (const [context, count] of byContext) {
        issues.push({ key: `async:${context}`, severity: "warning", message: `**${context}** failed ${count}× in the last 30 min.` });
    }
    exports.lastHealthIssues = issues;
    return { issues, notes };
}
async function runStaffHealthMonitor(reason) {
    const report = await runStaffHealthCheck(reason);
    const signature = (0, staffHub_1.healthSignature)(report.issues);
    const changed = signature !== lastHealthSignature;
    lastHealthSignature = signature;
    if (!(0, settings_1.isFeatureEnabled)("healthAlerts"))
        return;
    if ((changed && (report.issues.length > 0 || reason !== "startup")) || report.notes.length) {
        await (0, staffDesk_1.postStaffAlert)({ embeds: (0, staffHub_1.buildHealthPayload)(report.issues, Date.now(), [`Trigger: ${reason}`, ...report.notes]).embeds });
    }
}
