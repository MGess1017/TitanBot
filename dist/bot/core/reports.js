"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrimaryGuild = getPrimaryGuild;
exports.buildHealthEmbed = buildHealthEmbed;
exports.sendAutomatedHealthReport = sendAutomatedHealthReport;
exports.buildBalanceReportEmbed = buildBalanceReportEmbed;
exports.sendOpsBroadcastEmbed = sendOpsBroadcastEmbed;
exports.buildRaidUnlockBroadcastEmbed = buildRaidUnlockBroadcastEmbed;
exports.sendAutomatedBalanceReport = sendAutomatedBalanceReport;
exports.runHealthWatchdog = runHealthWatchdog;
// Automated health/balance reports, ops broadcasts, and watchdogs.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const catalog_1 = require("../../game/catalog");
const bossPortraits_1 = require("../../game/bossPortraits");
const config_1 = require("./config");
const client_1 = require("./client");
const metrics_1 = require("./metrics");
const ops_1 = require("./ops");
const telemetry_1 = require("./telemetry");
const audit_1 = require("./audit");
const store_1 = require("../moderation/store");
const store_2 = require("../tickets/store");
const roles_1 = require("../xp/roles");
const embeds_1 = require("../ui/embeds");
const experience_1 = require("../tickets/experience");
function getPrimaryGuild() {
    return config_1.DISCORD_GUILD_ID
        ? client_1.client.guilds.cache.get(config_1.DISCORD_GUILD_ID) || null
        : client_1.client.guilds.cache.first() || null;
}
function buildHealthEmbed() {
    const heap = process.memoryUsage();
    const usersTracked = Object.keys(utils_1.points).length;
    const commandTotal = metrics_1.runtimeMetrics.command.total;
    const commandFailed = metrics_1.runtimeMetrics.command.failed;
    const commandErrorRate = commandTotal > 0 ? ((commandFailed / commandTotal) * 100).toFixed(2) : "0.00";
    const ticketAttempts = metrics_1.runtimeMetrics.tickets.createAttempts;
    const ticketFailures = metrics_1.runtimeMetrics.tickets.createFailures;
    const ticketFailureRate = ticketAttempts > 0 ? ((ticketFailures / ticketAttempts) * 100).toFixed(2) : "0.00";
    const availability = metrics_1.runtimeMetrics.availability;
    const downtimeIntervals = Math.max(0, availability.totalRestarts - 1);
    const avgDowntimeMs = downtimeIntervals > 0
        ? Math.floor(availability.trackedDowntimeMs / downtimeIntervals)
        : 0;
    return (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("🩺 Bot Health")
        .setDescription("Operational diagnostics for runtime, persistence, and sync state.")
        .addFields({
        name: "Runtime",
        value: [
            `Uptime: ${(0, ops_1.formatDuration)(process.uptime())}`,
            `Guilds: ${client_1.client.guilds.cache.size}`,
            `Heap: ${(heap.heapUsed / (1024 * 1024)).toFixed(1)}MB / ${(heap.heapTotal / (1024 * 1024)).toFixed(1)}MB`,
            `RSS: ${(heap.rss / (1024 * 1024)).toFixed(1)}MB`
        ].join("\n"),
        inline: false
    }, {
        name: "Persistence",
        value: [
            `Tracked users: ${usersTracked}`,
            `points.json: ${(0, ops_1.statLabel)(config_1.POINTS_DATA_FILE)}`,
            `points.json.bak: ${(0, ops_1.statLabel)(config_1.POINTS_BACKUP_FILE)}`,
            `events.jsonl: ${(0, ops_1.statLabel)(config_1.EVENT_LOG_FILE)}`
        ].join("\n"),
        inline: false
    }, {
        name: "Ops",
        value: [
            `Active XP sync jobs: ${roles_1.XP_ROLE_SYNC_RUNNING_GUILDS.size}`,
            `Sync queue: ${roles_1.XP_ROLE_SYNC_QUEUE.length} | Retries: ${roles_1.XP_ROLE_SYNC_METRICS.retries}`,
            `Dead letters: ${(0, roles_1.readXpRoleDeadLetters)().length} | Processed: ${roles_1.XP_ROLE_SYNC_METRICS.processed}`,
            `Last sync: ${roles_1.XP_ROLE_SYNC_METRICS.lastSyncAt ? new Date(roles_1.XP_ROLE_SYNC_METRICS.lastSyncAt).toISOString() : "never"}`,
            `Last success: ${roles_1.XP_ROLE_SYNC_METRICS.lastSuccessAt ? new Date(roles_1.XP_ROLE_SYNC_METRICS.lastSuccessAt).toISOString() : "never"}`,
            `Role mutations: +${roles_1.XP_ROLE_SYNC_METRICS.added} / -${roles_1.XP_ROLE_SYNC_METRICS.removed} | Failures: ${roles_1.XP_ROLE_SYNC_METRICS.failed}`,
            `tickets.json: ${(0, ops_1.statLabel)(config_1.TICKET_DATA_FILE)}`,
            `trades.json: ${(0, ops_1.statLabel)(config_1.TRADE_DATA_FILE)}`,
            `moderation.json: ${(0, ops_1.statLabel)(config_1.MOD_DATA_FILE)}`,
            `balance-telemetry.json: ${(0, ops_1.statLabel)(config_1.BALANCE_TELEMETRY_FILE)}`,
            `xp-role-metrics.json: ${(0, ops_1.statLabel)(config_1.XP_ROLE_METRICS_FILE)}`,
            `runtime-metrics.json: ${(0, ops_1.statLabel)(config_1.METRICS_DATA_FILE)}`
        ].join("\n"),
        inline: false
    }, {
        name: "SLO Metrics",
        value: [
            `Command error rate: ${commandFailed}/${commandTotal} (${commandErrorRate}%)`,
            `Ticket create failures: ${ticketFailures}/${ticketAttempts} (${ticketFailureRate}%)`,
            `Restarts tracked: ${availability.totalRestarts}`,
            `Last downtime: ${(0, metrics_1.formatMetricDuration)(availability.lastDowntimeMs)}`,
            `Average downtime: ${(0, metrics_1.formatMetricDuration)(avgDowntimeMs)}`,
            `Total downtime tracked: ${(0, metrics_1.formatMetricDuration)(availability.trackedDowntimeMs)}`
        ].join("\n"),
        inline: false
    })
        .setTimestamp(new Date()), "Titan Runtime Health Monitor", "Automated diagnostics");
}
async function sendAutomatedHealthReport(reason) {
    const guild = getPrimaryGuild();
    if (!guild)
        return;
    const channelId = config_1.HEALTH_REPORT_CHANNEL_ID || (0, store_1.ensureGuildModeration)(guild.id).modLogChannelId || "";
    if (!channelId)
        return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel))
        return;
    const embed = buildHealthEmbed().setTitle("📊 Automated Health Report").setFooter({ text: `Reason: ${reason}` });
    await channel.send({ embeds: [embed] }).catch(() => undefined);
    (0, audit_1.appendAuditEvent)("health_report_sent", { guildId: guild.id, channelId, reason });
}
function buildBalanceReportEmbed(reason = "manual") {
    const raid = telemetry_1.balanceTelemetry.raid;
    const winRate = raid.runs > 0 ? ((raid.wins / raid.runs) * 100).toFixed(1) : "0.0";
    const avgNet = raid.runs > 0 ? (raid.totalNet / raid.runs).toFixed(1) : "0.0";
    const avgBet = raid.runs > 0 ? (raid.totalBet / raid.runs).toFixed(1) : "0.0";
    const avgReward = raid.runs > 0
        ? ((raid.tokenSources.baseReward + raid.tokenSources.outcomeBonus + raid.tokenSources.bossBonus + raid.tokenSources.failureMitigation) / raid.runs).toFixed(1)
        : "0.0";
    const bossKillRate = raid.bossSpawns > 0 ? ((raid.bossKills / raid.bossSpawns) * 100).toFixed(1) : "0.0";
    const formatSlice = (label, data) => {
        const wr = data.runs > 0 ? ((data.wins / data.runs) * 100).toFixed(1) : "0.0";
        const net = data.runs > 0 ? (data.net / data.runs).toFixed(1) : "0.0";
        const chance = data.runs > 0 ? (data.successChanceSum / data.runs).toFixed(1) : "0.0";
        const lootValue = data.runs > 0 ? (data.lootValue / data.runs).toFixed(1) : "0.0";
        const bossRate = data.bossSpawns > 0 ? ((data.bossKills / data.bossSpawns) * 100).toFixed(1) : "0.0";
        return `${label}: ${data.runs} runs | WR ${wr}% | Avg Net ${net} | Avg Success ${chance}% | Loot Value ${lootValue} | Boss KR ${bossRate}%`;
    };
    const topTensions = Object.entries(raid.byTension)
        .sort((a, b) => b[1].runs - a[1].runs)
        .slice(0, 3)
        .map(([name, data]) => formatSlice(name, data))
        .join("\n") || "No raid telemetry yet.";
    const topMaps = Object.entries(raid.byMap)
        .sort((a, b) => b[1].runs - a[1].runs)
        .slice(0, 3)
        .map(([name, data]) => formatSlice(name, data))
        .join("\n") || "No map telemetry yet.";
    const topDifficulties = Object.entries(raid.byDifficulty)
        .sort((a, b) => b[1].runs - a[1].runs)
        .slice(0, 3)
        .map(([name, data]) => formatSlice(name, data))
        .join("\n") || "No difficulty telemetry yet.";
    const topConditions = Object.entries(raid.byCondition)
        .sort((a, b) => b[1].runs - a[1].runs)
        .slice(0, 3)
        .map(([name, data]) => formatSlice(name, data))
        .join("\n") || "No condition telemetry yet.";
    const tokenSources = [
        `Base Raid Payout: ${raid.tokenSources.baseReward}`,
        `Outcome Bonus: ${raid.tokenSources.outcomeBonus}`,
        `Boss Bonus: ${raid.tokenSources.bossBonus}`,
        `Failure Mitigation: ${raid.tokenSources.failureMitigation}`
    ].join("\n");
    const lootByRarity = Object.entries(raid.lootByRarity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([rarity, qty]) => `${rarity}: ${qty}`)
        .join(" | ") || "No loot rarity telemetry yet.";
    const consumables = Object.entries(telemetry_1.balanceTelemetry.consumables)
        .sort((a, b) => b[1].uses - a[1].uses)
        .slice(0, 4)
        .map(([id, data]) => `${catalog_1.ITEM_DEFS[id]?.name || id}: uses ${data.uses}, qty ${data.qty}, fail ${data.failures}`)
        .join("\n") || "No consumable usage yet.";
    const crates = Object.entries(telemetry_1.balanceTelemetry.crates)
        .sort((a, b) => b[1].opened - a[1].opened)
        .slice(0, 4)
        .map(([id, data]) => `${catalog_1.ITEM_DEFS[id]?.name || id}: opened ${data.opened}, auto ${data.autoOpened}, drops ${data.totalDrops}`)
        .join("\n") || "No crate telemetry yet.";
    const commandUsage = Object.entries(telemetry_1.balanceTelemetry.commands)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count]) => `${name}: ${count}`)
        .join(" | ") || "No tracked command usage yet.";
    return (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("📈 Balance Telemetry")
        .setDescription("Weekly raid-economy signal pack for tuning drop rates, payouts, and consumable impact.")
        .addFields({
        name: "Raid Core",
        value: [
            `Runs: ${raid.runs} | Win Rate: ${winRate}%`,
            `Avg Bet: ${avgBet} | Avg Net: ${avgNet} | Avg Reward: ${avgReward}`,
            `Boss Spawns: ${raid.bossSpawns} | Boss Kills: ${raid.bossKills} | Boss Kill Rate: ${bossKillRate}%`
        ].join("\n"),
        inline: false
    }, { name: "Top Tensions", value: topTensions, inline: false }, { name: "Top Maps", value: topMaps, inline: false }, { name: "Top Difficulties", value: topDifficulties, inline: false }, { name: "Top Conditions", value: topConditions, inline: false }, { name: "Token Sources", value: tokenSources, inline: false }, { name: "Loot Rarity Mix", value: lootByRarity, inline: false }, { name: "Consumables", value: consumables, inline: false }, { name: "Crates", value: crates, inline: false }, { name: "Raid Command Usage", value: commandUsage, inline: false })
        .setFooter({ text: `Reason: ${reason} | Updated: ${new Date(telemetry_1.balanceTelemetry.updatedAt).toISOString()}` })
        .setTimestamp(new Date()), "Titan Economy Observatory", "Balance telemetry stream");
}
function getOpsBroadcastChannelId(guildId) {
    return config_1.ACTIVITY_CHANNEL_ID || config_1.HEALTH_REPORT_CHANNEL_ID || (0, store_1.ensureGuildModeration)(guildId).modLogChannelId || "";
}
async function sendOpsBroadcastEmbed(guild, embed, bossName) {
    const channelId = getOpsBroadcastChannelId(guild.id);
    if (!channelId)
        return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel))
        return;
    await channel.send({ embeds: [embed], files: (0, bossPortraits_1.getBossPortraitFiles)(bossName) });
}
function buildRaidUnlockBroadcastEmbed(input) {
    const { user, result } = input;
    const loot = result.loot || [];
    const enhancedLoot = loot
        .filter(entry => entry.id.startsWith("enhanced_") && catalog_1.ITEM_DEFS[entry.id])
        .map(entry => catalog_1.ITEM_DEFS[entry.id].name);
    const mythicLoot = loot
        .filter(entry => catalog_1.ITEM_DEFS[entry.id]?.rarity === "mythic")
        .map(entry => catalog_1.ITEM_DEFS[entry.id].name);
    const lines = [
        result.bossHeartUnlockedName ? `• First-kill heart unlocked: ${result.bossHeartUnlockedName}` : null,
        result.pmcTierUnlockedLabel ? `• ${result.pmcTierUnlockedBadge || "🏅"} Reached ${result.pmcTierUnlockedLabel} at PMC Level ${result.pmcLevel || "?"}` : null,
        enhancedLoot.length ? `• Enhanced recoveries: ${enhancedLoot.join(", ")}` : null,
        mythicLoot.length ? `• Mythic recoveries: ${mythicLoot.join(", ")}` : null
    ].filter(Boolean);
    if (!lines.length)
        return null;
    return (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🌟 Premium Unlock Broadcast")
        .setDescription(`${user.username} completed a standout raid operation on **${result.mapLabel || "Unknown AO"}**.`)
        .setThumbnail((0, bossPortraits_1.getBossPortraitUrl)(result.bossName) || config_1.ARMY_ICON_URL)
        .addFields({
        name: "Operator",
        value: `<@${user.id}>`,
        inline: true
    }, {
        name: "Boss Contact",
        value: result.bossName
            ? `${result.bossName}${result.bossTitle ? ` • ${result.bossTitle}` : ""}`
            : "No boss engaged",
        inline: true
    }, {
        name: "Highlights",
        value: lines.join("\n"),
        inline: false
    }), "Titan Premium Progression Feed", "Rare progression event");
}
async function sendAutomatedBalanceReport(reason) {
    const guild = getPrimaryGuild();
    if (!guild)
        return;
    const channelId = config_1.HEALTH_REPORT_CHANNEL_ID || (0, store_1.ensureGuildModeration)(guild.id).modLogChannelId || "";
    if (!channelId)
        return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel))
        return;
    const embed = buildBalanceReportEmbed(reason);
    await channel.send({ embeds: [embed] }).catch(() => undefined);
    telemetry_1.balanceTelemetry.lastWeeklyReportAt = Date.now();
    (0, telemetry_1.saveBalanceTelemetry)();
    (0, audit_1.appendAuditEvent)("balance_report_sent", { guildId: guild.id, channelId, reason });
}
async function runHealthWatchdog(reason) {
    const now = Date.now();
    const pointsPrimary = (0, ops_1.statSummary)(config_1.POINTS_DATA_FILE);
    const pointsBackup = (0, ops_1.statSummary)(config_1.POINTS_BACKUP_FILE);
    const ticketsPrimary = (0, ops_1.statSummary)(config_1.TICKET_DATA_FILE);
    const tradePrimary = (0, ops_1.statSummary)(config_1.TRADE_DATA_FILE);
    const telemetryPrimary = (0, ops_1.statSummary)(config_1.BALANCE_TELEMETRY_FILE);
    const warnings = [];
    const errors = [];
    if (!pointsPrimary.exists)
        errors.push("points.json missing");
    if (!pointsBackup.exists)
        errors.push("points.json.bak missing");
    if (pointsPrimary.exists && pointsPrimary.size <= 0)
        errors.push("points.json empty");
    if (pointsBackup.exists && pointsBackup.size <= 0)
        errors.push("points.json.bak empty");
    if (pointsBackup.exists && now - pointsBackup.mtime > config_1.BACKUP_STALE_WARNING_MS) {
        warnings.push("points backup appears stale");
    }
    if (!ticketsPrimary.exists)
        warnings.push("tickets.json missing");
    if (!tradePrimary.exists)
        warnings.push("trades.json missing");
    if (!telemetryPrimary.exists)
        warnings.push("balance-telemetry.json missing");
    if (errors.length) {
        (0, ops_1.postOpsAlert)("error", "Health watchdog critical state", {
            reason,
            errors: errors.join(" | "),
            warnings: warnings.join(" | ") || "none"
        });
    }
    else if (warnings.length) {
        (0, ops_1.postOpsAlert)("warn", "Health watchdog warning state", {
            reason,
            warnings: warnings.join(" | ")
        });
    }
    (0, audit_1.appendAuditEvent)("health_watchdog", {
        reason,
        status: errors.length ? "error" : warnings.length ? "warn" : "ok",
        errors,
        warnings,
        pointsPrimaryExists: pointsPrimary.exists,
        pointsBackupExists: pointsBackup.exists,
        pointsPrimarySize: pointsPrimary.size,
        pointsBackupSize: pointsBackup.size,
        pointsBackupAgeSec: pointsBackup.exists ? Math.floor((now - pointsBackup.mtime) / 1000) : -1
    });
    const guild = getPrimaryGuild();
    if (guild) {
        await runTicketSlaWatchdog(guild, reason);
        (0, store_2.purgeResolvedTicketsByRetention)(guild.id, now);
    }
}
async function runTicketSlaWatchdog(guild, _reason) {
    await (0, experience_1.runTicketReplyReminders)(guild);
}
