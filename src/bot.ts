import "dotenv/config";
import { AuditLogEvent, ChannelType, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { buildStartupSummary } from "./runtime/health";
import { isVoiceXpEligible } from "./runtime/voiceXp";
import { flushJsonWrites } from "./runtime/jsonPersistence";
import {
    COMMAND_IDEMPOTENCY_WINDOW_MS, DAILY_HEALTH_REPORT_MS, DISCORD_GUILD_ID, ENABLE_STARTUP_AUTOPANELS,
    ENABLE_STARTUP_DEPLOYMENT_SUMMARY, HEALTH_WATCHDOG_INTERVAL_MS, IN_MEMORY_STATE_PRUNE_INTERVAL_MS,
    JOIN_WELCOME_CHANNEL_ID, PREFIX, VOICE_XP_TICK_MS, WEEKLY_BALANCE_REPORT_MS
} from "./bot/core/config";
import { ensureCheckpointCardPanel, handleCheckpointInteraction } from "./bot/panels/playerCards";
import { ensureInquiryPanelForGuild, handleInquiryInteraction } from "./bot/panels/inquiry";
import { ensureLfgPanelForGuild, ensureLfgSchedulerForGuild, handleLfgInteraction, stopLfgSchedulers } from "./bot/panels/lfg";
import { ensureStaffEmbedPanelForGuild, ensureStaffEmbedSchedulerForGuild, handleStaffEmbedInteraction, stopStaffEmbedScheduler } from "./bot/panels/embedBuilder";
import { ensureOwnerPanelForGuild, handleOwnerInteraction } from "./bot/panels/owner";
import { ensureStorePanelsForGuild, handleStoreInteraction } from "./bot/panels/store";
import { client } from "./bot/core/client";
import {
    awardEngagementXp, processVoiceXpSessions, seedConnectedVoiceXpSessions, trackVoiceXpConnection,
    VOICE_XP_SESSIONS, voiceXpSessionKey
} from "./bot/xp/engagement";
import { ensurePlayerCountPanelForGuild, trackGuildMemberChange } from "./bot/panels/playerCounts";
import { ensureXpCratePanel, refreshXpLeaderboardPanel } from "./bot/panels/xpPanels";
import { antiRaidDetector, getMessageXpGain, isFeatureEnabled } from "./bot/core/settings";
import { recordRuntimeShutdown, recordRuntimeStartup, runAsyncWithBoundary } from "./bot/core/metrics";
import { postWhatsNewIfNeeded, sendDeploymentSummaryIfNeeded } from "./bot/core/announcements";
import {
    acquireInstanceLock, postOpsAlert, pruneInMemoryRuntimeState, pruneRecentCommandExecutions,
    releaseInstanceLock, runStartupPreflight, shouldSkipRecentModerationLog, summarizePreflightMessages,
    toSafeString, updateBotPresence
} from "./bot/core/ops";
import { processDueGiveaways, refreshActiveGiveawayEmbeds } from "./bot/giveaways/giveaways";
import { appendAuditEvent } from "./bot/core/audit";
import { checkpointState } from "./bot/core/checkpoint";
import { ensureGuildModeration, sendModLog } from "./bot/moderation/store";
import { ensureXpTierRoles, retryXpRoleDeadLetters } from "./bot/xp/roles";
import { purgeLegacyImportedTicketRecords } from "./bot/tickets/records";
import { runHealthWatchdog, sendAutomatedBalanceReport, sendAutomatedHealthReport } from "./bot/core/reports";
import { brandLiveEmbed } from "./bot/ui/embeds";
import {
    ensureAdminReportPanelForGuild, ensurePermanentTicketPanelForGuild, removeLegacyReportPanelForGuild
} from "./bot/panels/ticketPanels";
import { ensureWelcomePanelForGuild } from "./bot/panels/welcome";
import {
    cleanupEmptyTemporaryVoiceChannel, ensureTemporaryVoicePanelForGuild, upsertSelfRoleSelectorForGuild
} from "./bot/panels/community";
import { ensureBotFeatureBriefForGuild } from "./bot/panels/featureBrief";
import { ensureArchiveCategory } from "./bot/tickets/channels";
import { slashCommands } from "./bot/commands/registry";
import { handleStaffInteraction, isStaffMember } from "./bot/staff/staffDesk";
import { handleProfileInteraction } from "./bot/profile/profile";
import { raiseAntiRaidAlert, runStaffHealthMonitor } from "./bot/staff/safety";
import { handleRewardAndAutocompleteInteraction } from "./bot/interactions/rewards";
import { handleFormInteraction } from "./bot/interactions/forms";
import { handleCommunityInteraction } from "./bot/interactions/community";
import { handleEconomyInteraction } from "./bot/interactions/economy";
import { handleTicketButtonInteraction } from "./bot/interactions/tickets";
import { handleRaidInteraction } from "./bot/interactions/raids";
import { handleChatInputCommand } from "./bot/interactions/commands";
import { refreshTicketPanelsForGuild } from "./bot/tickets/opsPanel";
import { trackTicketReply } from "./bot/tickets/experience";

// Entry point: wires Discord events, timers, and startup. Feature code lives in src/bot/ (see README "Project layout").
let shuttingDown = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    stopStaffEmbedScheduler();
    stopLfgSchedulers();
    const deadline = setTimeout(() => {
        console.error("[shutdown] Persistence flush timed out; pending saves may not be durable.");
        releaseInstanceLock();
        process.exit(1);
    }, 10_000);
    try {
        processVoiceXpSessions();
        recordRuntimeShutdown(reason);
        if (!checkpointState(reason)) exitCode = 1;
        await client.destroy();
    } catch (error) {
        console.error("[shutdown] Could not checkpoint or close the client:", error);
        exitCode = 1;
    }
    try {
        await flushJsonWrites();
    } catch (error) {
        console.error("[shutdown] Could not flush all state:", error);
        exitCode = 1;
    } finally {
        clearTimeout(deadline);
        releaseInstanceLock();
    }
    process.exit(exitCode);
}

client.once("clientReady", () => runAsyncWithBoundary("clientReady", async () => {
    console.log(`Logged in as ${client.user?.tag ?? "unknown-user"}`);
    console.log(`[startup] Preparing to register ${slashCommands.length} guild slash commands.`);
    if (slashCommands.length > 100) {
        console.error(`[startup] Slash command count ${slashCommands.length} exceeds Discord guild limit (100). Some commands will not register.`);
    }
    updateBotPresence();
    seedConnectedVoiceXpSessions();
    runAsyncWithBoundary("xpLeaderboardInit", refreshXpLeaderboardPanel);
    runAsyncWithBoundary("xpCratePanelInit", ensureXpCratePanel);
    runAsyncWithBoundary("checkpointCardPanelInit", ensureCheckpointCardPanel);
    runAsyncWithBoundary("whatsNewPost", postWhatsNewIfNeeded);
    console.log(`[startup] ${buildStartupSummary(client.guilds.cache.size, Math.floor(process.uptime()), process.memoryUsage())}`);
    appendAuditEvent("startup", {
        userTag: client.user?.tag,
        guildCount: client.guilds.cache.size
    });

    // Keep this bot guild-scoped to avoid duplicate global+guild slash entries.
    await client.application?.commands.set([]).catch(() => undefined);

    if (DISCORD_GUILD_ID) {
        const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch(() => null);
        if (guild) {
            await ensureStaffEmbedSchedulerForGuild(guild);
            await guild.commands.set(slashCommands);
            console.log(`Registered slash commands for guild ${guild.id}`);
            await ensureXpTierRoles(guild);
            await retryXpRoleDeadLetters();
            purgeLegacyImportedTicketRecords(guild.id);
            await ensureArchiveCategory(guild);
            await ensureLfgSchedulerForGuild(guild);
            if (ENABLE_STARTUP_AUTOPANELS) {
                runAsyncWithBoundary("ownerPanelInit", () => ensureOwnerPanelForGuild(guild));
                runAsyncWithBoundary("storePanelsInit", () => ensureStorePanelsForGuild(guild));
                await removeLegacyReportPanelForGuild(guild);
                await ensureAdminReportPanelForGuild(guild);
                await ensurePermanentTicketPanelForGuild(guild);
                await ensureBotFeatureBriefForGuild(guild);
                await refreshTicketPanelsForGuild(guild);
                await ensureWelcomePanelForGuild(guild);
                await upsertSelfRoleSelectorForGuild(guild);
                await ensureInquiryPanelForGuild(guild);
                await ensureLfgPanelForGuild(guild);
                await ensureStaffEmbedPanelForGuild(guild);
            }
            await ensureTemporaryVoicePanelForGuild(guild);
            await ensurePlayerCountPanelForGuild(guild);
            if (ENABLE_STARTUP_DEPLOYMENT_SUMMARY) {
                await sendDeploymentSummaryIfNeeded();
            }
        } else {
            console.warn("DISCORD_GUILD_ID is set but the guild could not be fetched.");
        }
        return;
    }

    if (client.guilds.cache.size > 0) {
        for (const guild of client.guilds.cache.values()) {
            await ensureStaffEmbedSchedulerForGuild(guild);
            await guild.commands.set(slashCommands).catch(() => undefined);
            purgeLegacyImportedTicketRecords(guild.id);
            await ensureArchiveCategory(guild);
            await ensureLfgSchedulerForGuild(guild);
            if (ENABLE_STARTUP_AUTOPANELS) {
                runAsyncWithBoundary("ownerPanelInit", () => ensureOwnerPanelForGuild(guild));
                runAsyncWithBoundary("storePanelsInit", () => ensureStorePanelsForGuild(guild));
                await removeLegacyReportPanelForGuild(guild);
                await ensureAdminReportPanelForGuild(guild);
                await ensurePermanentTicketPanelForGuild(guild);
                await ensureBotFeatureBriefForGuild(guild);
                await refreshTicketPanelsForGuild(guild);
                await ensureWelcomePanelForGuild(guild);
                await upsertSelfRoleSelectorForGuild(guild);
                await ensureInquiryPanelForGuild(guild);
                await ensureLfgPanelForGuild(guild);
                await ensureStaffEmbedPanelForGuild(guild);
            }
            await ensureTemporaryVoicePanelForGuild(guild);
            await ensurePlayerCountPanelForGuild(guild);
        }
        if (ENABLE_STARTUP_DEPLOYMENT_SUMMARY) {
            await sendDeploymentSummaryIfNeeded();
        }
        console.log(`Registered slash commands in ${client.guilds.cache.size} guild(s) for instant updates.`);
    }

    console.log("Global slash commands cleared to prevent duplicate command entries.");
    console.log("Guild-only slash commands are active.");
}));

client.on("guildBanAdd", ban => runAsyncWithBoundary("guildBanAdd", async () => {
    const guildId = ban.guild.id;
    const userId = ban.user.id;
    if (shouldSkipRecentModerationLog("ban", guildId, userId)) return;

    const audit = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 6 }).catch(() => null);
    const entry = audit?.entries.find(item => {
        const targetId = item.target && "id" in item.target ? item.target.id : null;
        return targetId === userId && Date.now() - item.createdTimestamp < 15_000;
    });

    const moderatorId = entry?.executor?.id;
    const reason = entry?.reason || "No reason provided";
    await sendModLog(guildId, "Ban", [
        { name: "Moderator", value: moderatorId ? `<@${moderatorId}>` : "Unknown", inline: true },
        { name: "Target", value: `<@${userId}>`, inline: true },
        { name: "Reason", value: reason }
    ]);
}));

client.on("guildMemberAdd", member => runAsyncWithBoundary("guildMemberAdd", async () => {
    // Every new member is welcome: joins are never rate-limited, flagged, kicked, or banned.
    trackGuildMemberChange(member, 1);
    const channel = await member.guild.channels.fetch(JOIN_WELCOME_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`[welcome] Join channel ${JOIN_WELCOME_CHANNEL_ID} is missing or is not a text channel.`);
        return;
    }

    const joinedAt = member.joinedTimestamp || Date.now();
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x16a34a)
        .setTitle("Welcome to FNT")
        .setDescription(`Welcome, <@${member.id}>!`)
        .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 256 }))
        .addFields(
            { name: "Member", value: `${member.user.username}${member.user.bot ? " • Bot" : " • Player"}`, inline: true },
            { name: "Joined", value: `<t:${Math.floor(joinedAt / 1000)}:F>`, inline: true },
            { name: "Account Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: "Player ID", value: `\`${member.id}\``, inline: false }
        ), "FNT Player Tracking", "New member joined");

    const sent = await channel.send({
        content: `<@${member.id}>`,
        embeds: [embed],
        allowedMentions: { parse: [], users: [member.id] }
    }).catch(error => {
        console.warn(`[welcome] Could not post join message for ${member.id}:`, error);
        return null;
    });
    if (sent) appendAuditEvent("guild_member_welcomed", {
        guildId: member.guild.id,
        userId: member.id,
        channelId: channel.id,
        messageId: sent.id,
        isBot: member.user.bot
    });
}));

client.on("guildMemberRemove", member => runAsyncWithBoundary("guildMemberRemove", async () => {
    trackGuildMemberChange(member, -1);
    const guildId = member.guild.id;
    const userId = member.id;
    const audit = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 6 }).catch(() => null);
    const entry = audit?.entries.find(item => {
        const targetId = item.target && "id" in item.target ? item.target.id : null;
        return targetId === userId && Date.now() - item.createdTimestamp < 15_000;
    });
    if (!entry) return;
    if (shouldSkipRecentModerationLog("kick", guildId, userId)) return;

    const moderatorId = entry.executor?.id;
    const reason = entry.reason || "No reason provided";
    await sendModLog(guildId, "Kick", [
        { name: "Moderator", value: moderatorId ? `<@${moderatorId}>` : "Unknown", inline: true },
        { name: "Target", value: `<@${userId}>`, inline: true },
        { name: "Reason", value: reason }
    ]);
}));

setInterval(() => {
    if (shuttingDown) return;
    checkpointState("interval_30s");
}, 30_000).unref();

setInterval(() => {
    updateBotPresence();
}, 10 * 60 * 1000).unref();

setInterval(() => {
    if (shuttingDown) return;
    processVoiceXpSessions();
    runAsyncWithBoundary("xpLeaderboardRefresh", refreshXpLeaderboardPanel);
}, VOICE_XP_TICK_MS).unref();

if (COMMAND_IDEMPOTENCY_WINDOW_MS > 0) {
    setInterval(() => {
        pruneRecentCommandExecutions();
    }, Math.max(5_000, COMMAND_IDEMPOTENCY_WINDOW_MS)).unref();
}

setInterval(() => {
    pruneInMemoryRuntimeState();
}, IN_MEMORY_STATE_PRUNE_INTERVAL_MS).unref();

setInterval(() => {
    runAsyncWithBoundary("healthReportInterval", () => sendAutomatedHealthReport("interval_24h"));
}, DAILY_HEALTH_REPORT_MS).unref();

setInterval(() => {
    runAsyncWithBoundary("healthWatchdogInterval", () => runHealthWatchdog("interval_10m"));
    runAsyncWithBoundary("staffHealthMonitor", () => runStaffHealthMonitor("interval_10m"));
    antiRaidDetector.prune(Date.now());
}, HEALTH_WATCHDOG_INTERVAL_MS).unref();

setInterval(() => {
    runAsyncWithBoundary("balanceReportInterval", () => sendAutomatedBalanceReport("interval_7d"));
}, WEEKLY_BALANCE_REPORT_MS).unref();

setInterval(() => {
    runAsyncWithBoundary("giveawayExpiryInterval", processDueGiveaways);
}, 15_000).unref();

setInterval(() => {
    runAsyncWithBoundary("giveawayRefreshInterval", refreshActiveGiveawayEmbeds);
}, 60_000).unref();

setTimeout(() => {
    runAsyncWithBoundary("startupHealthReport", () => sendAutomatedHealthReport("startup_warmup"));
}, 90_000).unref();

setTimeout(() => {
    runAsyncWithBoundary("startupHealthWatchdog", () => runHealthWatchdog("startup_warmup"));
}, 45_000).unref();

setTimeout(() => {
    runAsyncWithBoundary("staffHealthStartup", () => runStaffHealthMonitor("startup"));
}, 60_000).unref();

setTimeout(() => {
    runAsyncWithBoundary("startupBalanceReport", () => sendAutomatedBalanceReport("startup_warmup"));
}, 120_000).unref();

process.on("SIGINT", () => {
    void shutdown("sigint", 0);
});

process.on("SIGTERM", () => {
    void shutdown("sigterm", 0);
});

process.on("beforeExit", () => {
    void shutdown("before_exit", 0);
});

client.on("interactionCreate", interaction => runAsyncWithBoundary("interactionCreate", async () => {
    if (shuttingDown) return;
    if (await handleOwnerInteraction(interaction)) return;
    if (await handleStoreInteraction(interaction)) return;
    if (await handleStaffEmbedInteraction(interaction)) return;
    if (await handleInquiryInteraction(interaction)) return;
    if (await handleLfgInteraction(interaction)) return;
    if (await handleProfileInteraction(interaction)) return;
    if (await handleStaffInteraction(interaction)) return;
    if (await handleCheckpointInteraction(interaction)) return;
    if (await handleRewardAndAutocompleteInteraction(interaction)) return;
    if (await handleFormInteraction(interaction)) return;
    if (await handleCommunityInteraction(interaction)) return;
    if (await handleEconomyInteraction(interaction)) return;
    if (await handleTicketButtonInteraction(interaction)) return;
    if (await handleRaidInteraction(interaction)) return;
    await handleChatInputCommand(interaction);
}));

client.on("voiceStateUpdate", (oldState, newState) => {
    if (shuttingDown) return;
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        setTimeout(() => {
            runAsyncWithBoundary("temporaryVoiceCleanup", () => cleanupEmptyTemporaryVoiceChannel(oldState.guild, oldState.channelId!));
        }, 1000).unref();
    }

    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const key = voiceXpSessionKey(member.guild.id, member.id);
    const oldEligible = isVoiceXpEligible(oldState.channelId, false);
    const newEligible = isVoiceXpEligible(newState.channelId, false);
    if (oldEligible && !newEligible) trackVoiceXpConnection(member.guild, member.id, false);
    if (newEligible && (!oldEligible || !VOICE_XP_SESSIONS.get(key)?.connected)) trackVoiceXpConnection(member.guild, member.id, true);
});

client.on("messageCreate", message => runAsyncWithBoundary("messageCreate", async () => {
    if (shuttingDown) return;
    if (message.author.bot) return;
    await trackTicketReply(message);

    if (message.guildId) {
        const state = ensureGuildModeration(message.guildId);
        if (state.lockdownChannelId && message.channelId === state.lockdownChannelId) {
            const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
            const isAdmin = Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
            if (!isAdmin) {
                const reason = "Lockdown channel violation: non-admin message sent in protected channel.";
                await message.delete().catch(() => undefined);
                if (member) {
                    await member.ban({ reason }).catch(() => undefined);
                }
                await sendModLog(message.guildId, "Lockdown Ban", [
                    { name: "Target", value: `<@${message.author.id}>`, inline: true },
                    { name: "Channel", value: `<#${message.channelId}>`, inline: true },
                    { name: "Reason", value: reason }
                ]).catch(() => undefined);
                appendAuditEvent("lockdown_ban", {
                    guildId: message.guildId,
                    channelId: message.channelId,
                    userId: message.author.id,
                    reason
                });
                return;
            }
        }
    }

    const isCommunicationEvent =
        message.content.trim().length > 0 ||
        message.mentions.users.size > 0 ||
        Boolean(message.reference) ||
        message.attachments.size > 0;

    if (message.guild && isFeatureEnabled("antiRaid") && !isStaffMember(message.member)) {
        const detection = antiRaidDetector.recordMessage({
            guildId: message.guild.id,
            userId: message.author.id,
            channelId: message.channelId,
            messageId: message.id,
            content: message.content,
            mentionCount: message.mentions.users.filter(user => user.id !== message.author.id).size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0)
        });
        if (detection) runAsyncWithBoundary("antiRaidAlert", () => raiseAntiRaidAlert(message.guild!, detection));
    }

    const messageXpGain = getMessageXpGain();
    if (isCommunicationEvent && messageXpGain > 0 && isFeatureEnabled("messageXp")) {
        const { totalXp: nextXp } = awardEngagementXp(message.guild, message.author.id, messageXpGain);
        appendAuditEvent("engagement_xp", {
            userId: message.author.id,
            guildId: message.guildId,
            channelId: message.channelId,
            xpDelta: messageXpGain,
            totalXp: nextXp,
            reference: Boolean(message.reference),
            mentionCount: message.mentions.users.size,
            attachmentCount: message.attachments.size
        });
    }

    if (message.content.trim().toLowerCase() === `${PREFIX}ping`) {
        await message.reply("Pong.");
    }
}));

process.on("unhandledRejection", reason => {
    console.error("Unhandled promise rejection:", reason);
    appendAuditEvent("unhandled_rejection", { reason: toSafeString(reason) });
    checkpointState("unhandled_rejection");
    postOpsAlert("error", "Unhandled promise rejection", {
        reason: toSafeString(reason)
    });
});

process.on("uncaughtException", error => {
    console.error("Uncaught exception:", error);
    appendAuditEvent("uncaught_exception", { message: error.message, stack: error.stack });
    postOpsAlert("error", "Uncaught exception", {
        name: error.name,
        message: error.message
    });
    void shutdown("uncaught_exception", 1);
});

async function bootServices(): Promise<void> {
    const lock = acquireInstanceLock();
    if (!lock.ok) {
        console.error(`[preflight] ${lock.reason}`);
        process.exit(1);
        return;
    }

    const preflight = await runStartupPreflight();
    if (preflight.warnings.length > 0) {
        console.warn(`[preflight] warnings=${preflight.warnings.length} ${summarizePreflightMessages(preflight.warnings)}`);
    }

    if (preflight.errors.length > 0) {
        console.error(`[preflight] errors=${preflight.errors.length} ${summarizePreflightMessages(preflight.errors)}`);
        postOpsAlert("error", "Startup preflight failed", {
            errors: preflight.errors.join(" | "),
            warnings: preflight.warnings.join(" | ")
        });
        process.exit(1);
        return;
    }

    recordRuntimeStartup();
    await client.login(process.env.DISCORD_TOKEN);
}

void bootServices().catch(error => {
    console.error("Boot failed:", error);
    postOpsAlert("error", "Boot failed", {
        reason: toSafeString(error)
    });
    void shutdown("boot_failed", 1);
});
