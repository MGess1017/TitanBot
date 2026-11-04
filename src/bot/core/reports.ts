// Automated health/balance reports, ops broadcasts, and watchdogs.
import { EmbedBuilder, Guild, User } from "discord.js";
import { points } from "../../utils";
import { ITEM_DEFS } from "../../game/catalog";
import { getBossPortraitFiles, getBossPortraitUrl } from "../../game/bossPortraits";
import {
    ACTIVITY_CHANNEL_ID, ARMY_ICON_URL, BACKUP_STALE_WARNING_MS, BALANCE_TELEMETRY_FILE, DISCORD_GUILD_ID,
    EVENT_LOG_FILE, HEALTH_REPORT_CHANNEL_ID, METRICS_DATA_FILE, MOD_DATA_FILE, POINTS_BACKUP_FILE,
    POINTS_DATA_FILE, TICKET_DATA_FILE, TRADE_DATA_FILE, UNCLAIMED_TICKET_AUTO_CLOSE_MS, XP_ROLE_METRICS_FILE
} from "./config";
import { client } from "./client";
import { formatMetricDuration, runtimeMetrics } from "./metrics";
import { formatDuration, postOpsAlert, statLabel, statSummary } from "./ops";
import { type BalanceSlice, balanceTelemetry, saveBalanceTelemetry } from "./telemetry";
import { appendAuditEvent } from "./audit";
import { ensureGuildModeration } from "../moderation/store";
import {
    buildTicketSlaThresholds, normalizeTicketStatus, purgeResolvedTicketsByRetention, recordTicketEvent,
    saveTicketStore, ticketStore
} from "../tickets/store";
import {
    readXpRoleDeadLetters, XP_ROLE_SYNC_METRICS, XP_ROLE_SYNC_QUEUE, XP_ROLE_SYNC_RUNNING_GUILDS
} from "../xp/roles";
import { ticketChannelNotice } from "../tickets/records";
import { brandLiveEmbed } from "../ui/embeds";
import { closeTicketChannel } from "../tickets/channels";

export function getPrimaryGuild(): Guild | null {
    return DISCORD_GUILD_ID
        ? client.guilds.cache.get(DISCORD_GUILD_ID) || null
        : client.guilds.cache.first() || null;
}

export function buildHealthEmbed(): EmbedBuilder {
    const heap = process.memoryUsage();
    const usersTracked = Object.keys(points).length;
    const commandTotal = runtimeMetrics.command.total;
    const commandFailed = runtimeMetrics.command.failed;
    const commandErrorRate = commandTotal > 0 ? ((commandFailed / commandTotal) * 100).toFixed(2) : "0.00";
    const ticketAttempts = runtimeMetrics.tickets.createAttempts;
    const ticketFailures = runtimeMetrics.tickets.createFailures;
    const ticketFailureRate = ticketAttempts > 0 ? ((ticketFailures / ticketAttempts) * 100).toFixed(2) : "0.00";
    const availability = runtimeMetrics.availability;
    const downtimeIntervals = Math.max(0, availability.totalRestarts - 1);
    const avgDowntimeMs = downtimeIntervals > 0
        ? Math.floor(availability.trackedDowntimeMs / downtimeIntervals)
        : 0;

    return brandLiveEmbed(new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("🩺 Bot Health")
        .setDescription("Operational diagnostics for runtime, persistence, and sync state.")
        .addFields(
            {
                name: "Runtime",
                value: [
                    `Uptime: ${formatDuration(process.uptime())}`,
                    `Guilds: ${client.guilds.cache.size}`,
                    `Heap: ${(heap.heapUsed / (1024 * 1024)).toFixed(1)}MB / ${(heap.heapTotal / (1024 * 1024)).toFixed(1)}MB`,
                    `RSS: ${(heap.rss / (1024 * 1024)).toFixed(1)}MB`
                ].join("\n"),
                inline: false
            },
            {
                name: "Persistence",
                value: [
                    `Tracked users: ${usersTracked}`,
                    `points.json: ${statLabel(POINTS_DATA_FILE)}`,
                    `points.json.bak: ${statLabel(POINTS_BACKUP_FILE)}`,
                    `events.jsonl: ${statLabel(EVENT_LOG_FILE)}`
                ].join("\n"),
                inline: false
            },
            {
                name: "Ops",
                value: [
                    `Active XP sync jobs: ${XP_ROLE_SYNC_RUNNING_GUILDS.size}`,
                    `Sync queue: ${XP_ROLE_SYNC_QUEUE.length} | Retries: ${XP_ROLE_SYNC_METRICS.retries}`,
                    `Dead letters: ${readXpRoleDeadLetters().length} | Processed: ${XP_ROLE_SYNC_METRICS.processed}`,
                    `Last sync: ${XP_ROLE_SYNC_METRICS.lastSyncAt ? new Date(XP_ROLE_SYNC_METRICS.lastSyncAt).toISOString() : "never"}`,
                    `Last success: ${XP_ROLE_SYNC_METRICS.lastSuccessAt ? new Date(XP_ROLE_SYNC_METRICS.lastSuccessAt).toISOString() : "never"}`,
                    `Role mutations: +${XP_ROLE_SYNC_METRICS.added} / -${XP_ROLE_SYNC_METRICS.removed} | Failures: ${XP_ROLE_SYNC_METRICS.failed}`,
                    `tickets.json: ${statLabel(TICKET_DATA_FILE)}`,
                    `trades.json: ${statLabel(TRADE_DATA_FILE)}`,
                    `moderation.json: ${statLabel(MOD_DATA_FILE)}`,
                    `balance-telemetry.json: ${statLabel(BALANCE_TELEMETRY_FILE)}`,
                    `xp-role-metrics.json: ${statLabel(XP_ROLE_METRICS_FILE)}`,
                    `runtime-metrics.json: ${statLabel(METRICS_DATA_FILE)}`
                ].join("\n"),
                inline: false
            },
            {
                name: "SLO Metrics",
                value: [
                    `Command error rate: ${commandFailed}/${commandTotal} (${commandErrorRate}%)`,
                    `Ticket create failures: ${ticketFailures}/${ticketAttempts} (${ticketFailureRate}%)`,
                    `Restarts tracked: ${availability.totalRestarts}`,
                    `Last downtime: ${formatMetricDuration(availability.lastDowntimeMs)}`,
                    `Average downtime: ${formatMetricDuration(avgDowntimeMs)}`,
                    `Total downtime tracked: ${formatMetricDuration(availability.trackedDowntimeMs)}`
                ].join("\n"),
                inline: false
            }
        )
        .setTimestamp(new Date()), "Titan Runtime Health Monitor", "Automated diagnostics");
}

export async function sendAutomatedHealthReport(reason: string): Promise<void> {
    const guild = getPrimaryGuild();
    if (!guild) return;

    const channelId = HEALTH_REPORT_CHANNEL_ID || ensureGuildModeration(guild.id).modLogChannelId || "";
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;

    const embed = buildHealthEmbed().setTitle("📊 Automated Health Report").setFooter({ text: `Reason: ${reason}` });
    await channel.send({ embeds: [embed] }).catch(() => undefined);
    appendAuditEvent("health_report_sent", { guildId: guild.id, channelId, reason });
}

export function buildBalanceReportEmbed(reason = "manual"): EmbedBuilder {
    const raid = balanceTelemetry.raid;
    const winRate = raid.runs > 0 ? ((raid.wins / raid.runs) * 100).toFixed(1) : "0.0";
    const avgNet = raid.runs > 0 ? (raid.totalNet / raid.runs).toFixed(1) : "0.0";
    const avgBet = raid.runs > 0 ? (raid.totalBet / raid.runs).toFixed(1) : "0.0";
    const avgReward = raid.runs > 0
        ? ((raid.tokenSources.baseReward + raid.tokenSources.outcomeBonus + raid.tokenSources.bossBonus + raid.tokenSources.failureMitigation) / raid.runs).toFixed(1)
        : "0.0";
    const bossKillRate = raid.bossSpawns > 0 ? ((raid.bossKills / raid.bossSpawns) * 100).toFixed(1) : "0.0";

    const formatSlice = (label: string, data: BalanceSlice) => {
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

    const consumables = Object.entries(balanceTelemetry.consumables)
        .sort((a, b) => b[1].uses - a[1].uses)
        .slice(0, 4)
        .map(([id, data]) => `${ITEM_DEFS[id]?.name || id}: uses ${data.uses}, qty ${data.qty}, fail ${data.failures}`)
        .join("\n") || "No consumable usage yet.";

    const crates = Object.entries(balanceTelemetry.crates)
        .sort((a, b) => b[1].opened - a[1].opened)
        .slice(0, 4)
        .map(([id, data]) => `${ITEM_DEFS[id]?.name || id}: opened ${data.opened}, auto ${data.autoOpened}, drops ${data.totalDrops}`)
        .join("\n") || "No crate telemetry yet.";

    const commandUsage = Object.entries(balanceTelemetry.commands)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count]) => `${name}: ${count}`)
        .join(" | ") || "No tracked command usage yet.";

    return brandLiveEmbed(new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("📈 Balance Telemetry")
        .setDescription("Weekly raid-economy signal pack for tuning drop rates, payouts, and consumable impact.")
        .addFields(
            {
                name: "Raid Core",
                value: [
                    `Runs: ${raid.runs} | Win Rate: ${winRate}%`,
                    `Avg Bet: ${avgBet} | Avg Net: ${avgNet} | Avg Reward: ${avgReward}`,
                    `Boss Spawns: ${raid.bossSpawns} | Boss Kills: ${raid.bossKills} | Boss Kill Rate: ${bossKillRate}%`
                ].join("\n"),
                inline: false
            },
            { name: "Top Tensions", value: topTensions, inline: false },
            { name: "Top Maps", value: topMaps, inline: false },
            { name: "Top Difficulties", value: topDifficulties, inline: false },
            { name: "Top Conditions", value: topConditions, inline: false },
            { name: "Token Sources", value: tokenSources, inline: false },
            { name: "Loot Rarity Mix", value: lootByRarity, inline: false },
            { name: "Consumables", value: consumables, inline: false },
            { name: "Crates", value: crates, inline: false },
            { name: "Raid Command Usage", value: commandUsage, inline: false }
        )
        .setFooter({ text: `Reason: ${reason} | Updated: ${new Date(balanceTelemetry.updatedAt).toISOString()}` })
        .setTimestamp(new Date()), "Titan Economy Observatory", "Balance telemetry stream");
}

function getOpsBroadcastChannelId(guildId: string): string {
    return ACTIVITY_CHANNEL_ID || HEALTH_REPORT_CHANNEL_ID || ensureGuildModeration(guildId).modLogChannelId || "";
}

export async function sendOpsBroadcastEmbed(guild: Guild, embed: EmbedBuilder, bossName?: string): Promise<void> {
    const channelId = getOpsBroadcastChannelId(guild.id);
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;
    await channel.send({ embeds: [embed], files: getBossPortraitFiles(bossName) });
}

export function buildRaidUnlockBroadcastEmbed(input: {
    user: User;
    result: {
        mapLabel?: string;
        bossName?: string;
        bossTitle?: string;
        bossHeartUnlockedName?: string;
        pmcTierUnlockedLabel?: string;
        pmcTierUnlockedBadge?: string;
        pmcLevel?: number;
        loot?: Array<{ id: string; qty: number }>;
    };
}): EmbedBuilder | null {
    const { user, result } = input;
    const loot = result.loot || [];
    const enhancedLoot = loot
        .filter(entry => entry.id.startsWith("enhanced_") && ITEM_DEFS[entry.id])
        .map(entry => ITEM_DEFS[entry.id].name);
    const mythicLoot = loot
        .filter(entry => ITEM_DEFS[entry.id]?.rarity === "mythic")
        .map(entry => ITEM_DEFS[entry.id].name);

    const lines = [
        result.bossHeartUnlockedName ? `• First-kill heart unlocked: ${result.bossHeartUnlockedName}` : null,
        result.pmcTierUnlockedLabel ? `• ${result.pmcTierUnlockedBadge || "🏅"} Reached ${result.pmcTierUnlockedLabel} at PMC Level ${result.pmcLevel || "?"}` : null,
        enhancedLoot.length ? `• Enhanced recoveries: ${enhancedLoot.join(", ")}` : null,
        mythicLoot.length ? `• Mythic recoveries: ${mythicLoot.join(", ")}` : null
    ].filter(Boolean) as string[];

    if (!lines.length) return null;

    return brandLiveEmbed(new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🌟 Premium Unlock Broadcast")
        .setDescription(`${user.username} completed a standout raid operation on **${result.mapLabel || "Unknown AO"}**.`)
        .setThumbnail(getBossPortraitUrl(result.bossName) || ARMY_ICON_URL)
        .addFields(
            {
                name: "Operator",
                value: `<@${user.id}>`,
                inline: true
            },
            {
                name: "Boss Contact",
                value: result.bossName
                    ? `${result.bossName}${result.bossTitle ? ` • ${result.bossTitle}` : ""}`
                    : "No boss engaged",
                inline: true
            },
            {
                name: "Highlights",
                value: lines.join("\n"),
                inline: false
            }
        ), "Titan Premium Progression Feed", "Rare progression event");
}

export async function sendAutomatedBalanceReport(reason: string): Promise<void> {
    const guild = getPrimaryGuild();
    if (!guild) return;

    const channelId = HEALTH_REPORT_CHANNEL_ID || ensureGuildModeration(guild.id).modLogChannelId || "";
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;

    const embed = buildBalanceReportEmbed(reason);
    await channel.send({ embeds: [embed] }).catch(() => undefined);
    balanceTelemetry.lastWeeklyReportAt = Date.now();
    saveBalanceTelemetry();
    appendAuditEvent("balance_report_sent", { guildId: guild.id, channelId, reason });
}

export async function runHealthWatchdog(reason: string): Promise<void> {
    const now = Date.now();

    const pointsPrimary = statSummary(POINTS_DATA_FILE);
    const pointsBackup = statSummary(POINTS_BACKUP_FILE);
    const ticketsPrimary = statSummary(TICKET_DATA_FILE);
    const tradePrimary = statSummary(TRADE_DATA_FILE);
    const telemetryPrimary = statSummary(BALANCE_TELEMETRY_FILE);

    const warnings: string[] = [];
    const errors: string[] = [];

    if (!pointsPrimary.exists) errors.push("points.json missing");
    if (!pointsBackup.exists) errors.push("points.json.bak missing");
    if (pointsPrimary.exists && pointsPrimary.size <= 0) errors.push("points.json empty");
    if (pointsBackup.exists && pointsBackup.size <= 0) errors.push("points.json.bak empty");

    if (pointsBackup.exists && now - pointsBackup.mtime > BACKUP_STALE_WARNING_MS) {
        warnings.push("points backup appears stale");
    }

    if (!ticketsPrimary.exists) warnings.push("tickets.json missing");
    if (!tradePrimary.exists) warnings.push("trades.json missing");
    if (!telemetryPrimary.exists) warnings.push("balance-telemetry.json missing");

    if (errors.length) {
        postOpsAlert("error", "Health watchdog critical state", {
            reason,
            errors: errors.join(" | "),
            warnings: warnings.join(" | ") || "none"
        });
    } else if (warnings.length) {
        postOpsAlert("warn", "Health watchdog warning state", {
            reason,
            warnings: warnings.join(" | ")
        });
    }

    appendAuditEvent("health_watchdog", {
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
        purgeResolvedTicketsByRetention(guild.id, now);
    }
}

async function runTicketSlaWatchdog(guild: Guild, reason: string): Promise<void> {
    const now = Date.now();
    const activeTickets = ticketStore.tickets.filter(t =>
        t.guildId === guild.id &&
        (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed" || normalizeTicketStatus(t.status) === "archived")
    );

    for (const ticket of activeTickets) {
        const status = normalizeTicketStatus(ticket.status);
        const thresholds = buildTicketSlaThresholds(ticket);
        const age = now - ticket.createdAt;
        const firstResponseWarned = (ticket.events || []).some(event => event.type === "sla_first_response_warning");
        const firstResponseBreached = (ticket.events || []).some(event => event.type === "sla_first_response_breach");
        const resolveWarned = (ticket.events || []).some(event => event.type === "sla_resolution_warning");
        const resolveBreached = (ticket.events || []).some(event => event.type === "sla_resolution_breach");

        if (!ticket.firstResponseAt && age >= thresholds.firstResponseWarnMs && !firstResponseWarned) {
            recordTicketEvent(ticket, guild.members.me?.id || guild.ownerId, "sla_first_response_warning", "First-response SLA warning issued.");
            await ticketChannelNotice(guild, ticket, `SLA warning: first response target is approaching for ticket #${ticket.id}.`);
            saveTicketStore();
        }
        if (!ticket.firstResponseAt && age >= thresholds.firstResponseBreachMs && !firstResponseBreached) {
            ticket.workflowStatus = "escalated";
            recordTicketEvent(ticket, guild.members.me?.id || guild.ownerId, "sla_first_response_breach", "First-response SLA breached; ticket escalated.");
            await ticketChannelNotice(guild, ticket, `SLA breach: ticket #${ticket.id} has been escalated to senior support.`);
            saveTicketStore();
        }
        if (status !== "resolved" && age >= thresholds.resolveWarnMs && !resolveWarned) {
            recordTicketEvent(ticket, guild.members.me?.id || guild.ownerId, "sla_resolution_warning", "Resolution SLA warning issued.");
            await ticketChannelNotice(guild, ticket, `SLA warning: resolution target is approaching for ticket #${ticket.id}.`);
            saveTicketStore();
        }
        if (status !== "resolved" && age >= thresholds.resolveBreachMs && !resolveBreached) {
            ticket.workflowStatus = "escalated";
            recordTicketEvent(ticket, guild.members.me?.id || guild.ownerId, "sla_resolution_breach", "Resolution SLA breached; ticket escalated.");
            await ticketChannelNotice(guild, ticket, `SLA breach: ticket #${ticket.id} requires senior escalation.`);
            saveTicketStore();
        }

        if (status === "open" && !ticket.claimedById && now - ticket.createdAt >= UNCLAIMED_TICKET_AUTO_CLOSE_MS) {
            const closedById = guild.members.me?.id || guild.ownerId;
            await closeTicketChannel(guild, ticket.channelId, closedById, "Auto-closed: ticket was not claimed within 30 minutes.");
            appendAuditEvent("ticket_auto_close_unclaimed", {
                guildId: guild.id,
                ticketId: ticket.id,
                channelId: ticket.channelId,
                ownerId: ticket.ownerId,
                ageMinutes: Math.floor((now - ticket.createdAt) / 60000),
                thresholdMinutes: Math.floor(UNCLAIMED_TICKET_AUTO_CLOSE_MS / 60000),
                reason
            });
        }
    }
}
