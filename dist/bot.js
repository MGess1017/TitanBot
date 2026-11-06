"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const health_1 = require("./runtime/health");
const voiceXp_1 = require("./runtime/voiceXp");
const jsonPersistence_1 = require("./runtime/jsonPersistence");
const config_1 = require("./bot/core/config");
const playerCards_1 = require("./bot/panels/playerCards");
const client_1 = require("./bot/core/client");
const engagement_1 = require("./bot/xp/engagement");
const playerCounts_1 = require("./bot/panels/playerCounts");
const xpPanels_1 = require("./bot/panels/xpPanels");
const settings_1 = require("./bot/core/settings");
const metrics_1 = require("./bot/core/metrics");
const announcements_1 = require("./bot/core/announcements");
const ops_1 = require("./bot/core/ops");
const giveaways_1 = require("./bot/giveaways/giveaways");
const audit_1 = require("./bot/core/audit");
const checkpoint_1 = require("./bot/core/checkpoint");
const store_1 = require("./bot/moderation/store");
const roles_1 = require("./bot/xp/roles");
const records_1 = require("./bot/tickets/records");
const reports_1 = require("./bot/core/reports");
const embeds_1 = require("./bot/ui/embeds");
const ticketPanels_1 = require("./bot/panels/ticketPanels");
const welcome_1 = require("./bot/panels/welcome");
const community_1 = require("./bot/panels/community");
const featureBrief_1 = require("./bot/panels/featureBrief");
const channels_1 = require("./bot/tickets/channels");
const registry_1 = require("./bot/commands/registry");
const staffDesk_1 = require("./bot/staff/staffDesk");
const profile_1 = require("./bot/profile/profile");
const safety_1 = require("./bot/staff/safety");
const rewards_1 = require("./bot/interactions/rewards");
const forms_1 = require("./bot/interactions/forms");
const community_2 = require("./bot/interactions/community");
const economy_1 = require("./bot/interactions/economy");
const tickets_1 = require("./bot/interactions/tickets");
const raids_1 = require("./bot/interactions/raids");
const commands_1 = require("./bot/interactions/commands");
const opsPanel_1 = require("./bot/tickets/opsPanel");
const experience_1 = require("./bot/tickets/experience");
// Entry point: wires Discord events, timers, and startup. Feature code lives in src/bot/ (see README "Project layout").
let shuttingDown = false;
async function shutdown(reason, exitCode) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    const deadline = setTimeout(() => {
        console.error("[shutdown] Persistence flush timed out; pending saves may not be durable.");
        (0, ops_1.releaseInstanceLock)();
        process.exit(1);
    }, 10000);
    try {
        (0, engagement_1.processVoiceXpSessions)();
        (0, metrics_1.recordRuntimeShutdown)(reason);
        if (!(0, checkpoint_1.checkpointState)(reason))
            exitCode = 1;
        await client_1.client.destroy();
    }
    catch (error) {
        console.error("[shutdown] Could not checkpoint or close the client:", error);
        exitCode = 1;
    }
    try {
        await (0, jsonPersistence_1.flushJsonWrites)();
    }
    catch (error) {
        console.error("[shutdown] Could not flush all state:", error);
        exitCode = 1;
    }
    finally {
        clearTimeout(deadline);
        (0, ops_1.releaseInstanceLock)();
    }
    process.exit(exitCode);
}
client_1.client.once("clientReady", () => (0, metrics_1.runAsyncWithBoundary)("clientReady", async () => {
    console.log(`Logged in as ${client_1.client.user?.tag ?? "unknown-user"}`);
    console.log(`[startup] Preparing to register ${registry_1.slashCommands.length} guild slash commands.`);
    if (registry_1.slashCommands.length > 100) {
        console.error(`[startup] Slash command count ${registry_1.slashCommands.length} exceeds Discord guild limit (100). Some commands will not register.`);
    }
    (0, ops_1.updateBotPresence)();
    (0, engagement_1.seedConnectedVoiceXpSessions)();
    (0, metrics_1.runAsyncWithBoundary)("xpLeaderboardInit", xpPanels_1.refreshXpLeaderboardPanel);
    (0, metrics_1.runAsyncWithBoundary)("xpCratePanelInit", xpPanels_1.ensureXpCratePanel);
    (0, metrics_1.runAsyncWithBoundary)("checkpointCardPanelInit", playerCards_1.ensureCheckpointCardPanel);
    (0, metrics_1.runAsyncWithBoundary)("whatsNewPost", announcements_1.postWhatsNewIfNeeded);
    console.log(`[startup] ${(0, health_1.buildStartupSummary)(client_1.client.guilds.cache.size, Math.floor(process.uptime()), process.memoryUsage())}`);
    (0, audit_1.appendAuditEvent)("startup", {
        userTag: client_1.client.user?.tag,
        guildCount: client_1.client.guilds.cache.size
    });
    // Keep this bot guild-scoped to avoid duplicate global+guild slash entries.
    await client_1.client.application?.commands.set([]).catch(() => undefined);
    if (config_1.DISCORD_GUILD_ID) {
        const guild = await client_1.client.guilds.fetch(config_1.DISCORD_GUILD_ID).catch(() => null);
        if (guild) {
            await guild.commands.set(registry_1.slashCommands);
            console.log(`Registered slash commands for guild ${guild.id}`);
            await (0, roles_1.ensureXpTierRoles)(guild);
            await (0, roles_1.retryXpRoleDeadLetters)();
            (0, records_1.purgeLegacyImportedTicketRecords)(guild.id);
            await (0, channels_1.ensureArchiveCategory)(guild);
            if (config_1.ENABLE_STARTUP_AUTOPANELS) {
                await (0, ticketPanels_1.removeLegacyReportPanelForGuild)(guild);
                await (0, ticketPanels_1.ensureAdminReportPanelForGuild)(guild);
                await (0, ticketPanels_1.ensurePermanentTicketPanelForGuild)(guild);
                await (0, featureBrief_1.ensureBotFeatureBriefForGuild)(guild);
                await (0, opsPanel_1.refreshTicketPanelsForGuild)(guild);
                await (0, welcome_1.ensureWelcomePanelForGuild)(guild);
                await (0, community_1.upsertSelfRoleSelectorForGuild)(guild);
            }
            await (0, community_1.ensureTemporaryVoicePanelForGuild)(guild);
            await (0, playerCounts_1.ensurePlayerCountPanelForGuild)(guild);
            if (config_1.ENABLE_STARTUP_DEPLOYMENT_SUMMARY) {
                await (0, announcements_1.sendDeploymentSummaryIfNeeded)();
            }
        }
        else {
            console.warn("DISCORD_GUILD_ID is set but the guild could not be fetched.");
        }
        return;
    }
    if (client_1.client.guilds.cache.size > 0) {
        for (const guild of client_1.client.guilds.cache.values()) {
            await guild.commands.set(registry_1.slashCommands).catch(() => undefined);
            (0, records_1.purgeLegacyImportedTicketRecords)(guild.id);
            await (0, channels_1.ensureArchiveCategory)(guild);
            if (config_1.ENABLE_STARTUP_AUTOPANELS) {
                await (0, ticketPanels_1.removeLegacyReportPanelForGuild)(guild);
                await (0, ticketPanels_1.ensureAdminReportPanelForGuild)(guild);
                await (0, ticketPanels_1.ensurePermanentTicketPanelForGuild)(guild);
                await (0, featureBrief_1.ensureBotFeatureBriefForGuild)(guild);
                await (0, opsPanel_1.refreshTicketPanelsForGuild)(guild);
                await (0, welcome_1.ensureWelcomePanelForGuild)(guild);
                await (0, community_1.upsertSelfRoleSelectorForGuild)(guild);
            }
            await (0, community_1.ensureTemporaryVoicePanelForGuild)(guild);
            await (0, playerCounts_1.ensurePlayerCountPanelForGuild)(guild);
        }
        if (config_1.ENABLE_STARTUP_DEPLOYMENT_SUMMARY) {
            await (0, announcements_1.sendDeploymentSummaryIfNeeded)();
        }
        console.log(`Registered slash commands in ${client_1.client.guilds.cache.size} guild(s) for instant updates.`);
    }
    console.log("Global slash commands cleared to prevent duplicate command entries.");
    console.log("Guild-only slash commands are active.");
}));
client_1.client.on("guildBanAdd", ban => (0, metrics_1.runAsyncWithBoundary)("guildBanAdd", async () => {
    const guildId = ban.guild.id;
    const userId = ban.user.id;
    if ((0, ops_1.shouldSkipRecentModerationLog)("ban", guildId, userId))
        return;
    const audit = await ban.guild.fetchAuditLogs({ type: discord_js_1.AuditLogEvent.MemberBanAdd, limit: 6 }).catch(() => null);
    const entry = audit?.entries.find(item => {
        const targetId = item.target && "id" in item.target ? item.target.id : null;
        return targetId === userId && Date.now() - item.createdTimestamp < 15000;
    });
    const moderatorId = entry?.executor?.id;
    const reason = entry?.reason || "No reason provided";
    await (0, store_1.sendModLog)(guildId, "Ban", [
        { name: "Moderator", value: moderatorId ? `<@${moderatorId}>` : "Unknown", inline: true },
        { name: "Target", value: `<@${userId}>`, inline: true },
        { name: "Reason", value: reason }
    ]);
}));
client_1.client.on("guildMemberAdd", member => (0, metrics_1.runAsyncWithBoundary)("guildMemberAdd", async () => {
    // Every new member is welcome: joins are never rate-limited, flagged, kicked, or banned.
    (0, playerCounts_1.trackGuildMemberChange)(member, 1);
    const channel = await member.guild.channels.fetch(config_1.JOIN_WELCOME_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        console.warn(`[welcome] Join channel ${config_1.JOIN_WELCOME_CHANNEL_ID} is missing or is not a text channel.`);
        return;
    }
    const joinedAt = member.joinedTimestamp || Date.now();
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x16a34a)
        .setTitle("Welcome to FNT")
        .setDescription(`Welcome, <@${member.id}>!`)
        .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 256 }))
        .addFields({ name: "Member", value: `${member.user.username}${member.user.bot ? " • Bot" : " • Player"}`, inline: true }, { name: "Joined", value: `<t:${Math.floor(joinedAt / 1000)}:F>`, inline: true }, { name: "Account Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }, { name: "Player ID", value: `\`${member.id}\``, inline: false }), "FNT Player Tracking", "New member joined");
    const sent = await channel.send({
        content: `<@${member.id}>`,
        embeds: [embed],
        allowedMentions: { parse: [], users: [member.id] }
    }).catch(error => {
        console.warn(`[welcome] Could not post join message for ${member.id}:`, error);
        return null;
    });
    if (sent)
        (0, audit_1.appendAuditEvent)("guild_member_welcomed", {
            guildId: member.guild.id,
            userId: member.id,
            channelId: channel.id,
            messageId: sent.id,
            isBot: member.user.bot
        });
}));
client_1.client.on("guildMemberRemove", member => (0, metrics_1.runAsyncWithBoundary)("guildMemberRemove", async () => {
    (0, playerCounts_1.trackGuildMemberChange)(member, -1);
    const guildId = member.guild.id;
    const userId = member.id;
    const audit = await member.guild.fetchAuditLogs({ type: discord_js_1.AuditLogEvent.MemberKick, limit: 6 }).catch(() => null);
    const entry = audit?.entries.find(item => {
        const targetId = item.target && "id" in item.target ? item.target.id : null;
        return targetId === userId && Date.now() - item.createdTimestamp < 15000;
    });
    if (!entry)
        return;
    if ((0, ops_1.shouldSkipRecentModerationLog)("kick", guildId, userId))
        return;
    const moderatorId = entry.executor?.id;
    const reason = entry.reason || "No reason provided";
    await (0, store_1.sendModLog)(guildId, "Kick", [
        { name: "Moderator", value: moderatorId ? `<@${moderatorId}>` : "Unknown", inline: true },
        { name: "Target", value: `<@${userId}>`, inline: true },
        { name: "Reason", value: reason }
    ]);
}));
setInterval(() => {
    if (shuttingDown)
        return;
    (0, checkpoint_1.checkpointState)("interval_30s");
}, 30000).unref();
setInterval(() => {
    (0, ops_1.updateBotPresence)();
}, 10 * 60 * 1000).unref();
setInterval(() => {
    if (shuttingDown)
        return;
    (0, engagement_1.processVoiceXpSessions)();
    (0, metrics_1.runAsyncWithBoundary)("xpLeaderboardRefresh", xpPanels_1.refreshXpLeaderboardPanel);
}, config_1.VOICE_XP_TICK_MS).unref();
if (config_1.COMMAND_IDEMPOTENCY_WINDOW_MS > 0) {
    setInterval(() => {
        (0, ops_1.pruneRecentCommandExecutions)();
    }, Math.max(5000, config_1.COMMAND_IDEMPOTENCY_WINDOW_MS)).unref();
}
setInterval(() => {
    (0, ops_1.pruneInMemoryRuntimeState)();
}, config_1.IN_MEMORY_STATE_PRUNE_INTERVAL_MS).unref();
setInterval(() => {
    (0, metrics_1.runAsyncWithBoundary)("healthReportInterval", () => (0, reports_1.sendAutomatedHealthReport)("interval_24h"));
}, config_1.DAILY_HEALTH_REPORT_MS).unref();
setInterval(() => {
    (0, metrics_1.runAsyncWithBoundary)("healthWatchdogInterval", () => (0, reports_1.runHealthWatchdog)("interval_10m"));
    (0, metrics_1.runAsyncWithBoundary)("staffHealthMonitor", () => (0, safety_1.runStaffHealthMonitor)("interval_10m"));
    settings_1.antiRaidDetector.prune(Date.now());
}, config_1.HEALTH_WATCHDOG_INTERVAL_MS).unref();
setInterval(() => {
    (0, metrics_1.runAsyncWithBoundary)("balanceReportInterval", () => (0, reports_1.sendAutomatedBalanceReport)("interval_7d"));
}, config_1.WEEKLY_BALANCE_REPORT_MS).unref();
setInterval(() => {
    (0, metrics_1.runAsyncWithBoundary)("giveawayExpiryInterval", giveaways_1.processDueGiveaways);
}, 15000).unref();
setInterval(() => {
    (0, metrics_1.runAsyncWithBoundary)("giveawayRefreshInterval", giveaways_1.refreshActiveGiveawayEmbeds);
}, 60000).unref();
setTimeout(() => {
    (0, metrics_1.runAsyncWithBoundary)("startupHealthReport", () => (0, reports_1.sendAutomatedHealthReport)("startup_warmup"));
}, 90000).unref();
setTimeout(() => {
    (0, metrics_1.runAsyncWithBoundary)("startupHealthWatchdog", () => (0, reports_1.runHealthWatchdog)("startup_warmup"));
}, 45000).unref();
setTimeout(() => {
    (0, metrics_1.runAsyncWithBoundary)("staffHealthStartup", () => (0, safety_1.runStaffHealthMonitor)("startup"));
}, 60000).unref();
setTimeout(() => {
    (0, metrics_1.runAsyncWithBoundary)("startupBalanceReport", () => (0, reports_1.sendAutomatedBalanceReport)("startup_warmup"));
}, 120000).unref();
process.on("SIGINT", () => {
    void shutdown("sigint", 0);
});
process.on("SIGTERM", () => {
    void shutdown("sigterm", 0);
});
process.on("beforeExit", () => {
    void shutdown("before_exit", 0);
});
client_1.client.on("interactionCreate", interaction => (0, metrics_1.runAsyncWithBoundary)("interactionCreate", async () => {
    if (shuttingDown)
        return;
    if (await (0, profile_1.handleProfileInteraction)(interaction))
        return;
    if (await (0, staffDesk_1.handleStaffInteraction)(interaction))
        return;
    if (await (0, playerCards_1.handleCheckpointInteraction)(interaction))
        return;
    if (await (0, rewards_1.handleRewardAndAutocompleteInteraction)(interaction))
        return;
    if (await (0, forms_1.handleFormInteraction)(interaction))
        return;
    if (await (0, community_2.handleCommunityInteraction)(interaction))
        return;
    if (await (0, economy_1.handleEconomyInteraction)(interaction))
        return;
    if (await (0, tickets_1.handleTicketButtonInteraction)(interaction))
        return;
    if (await (0, raids_1.handleRaidInteraction)(interaction))
        return;
    await (0, commands_1.handleChatInputCommand)(interaction);
}));
client_1.client.on("voiceStateUpdate", (oldState, newState) => {
    if (shuttingDown)
        return;
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        setTimeout(() => {
            (0, metrics_1.runAsyncWithBoundary)("temporaryVoiceCleanup", () => (0, community_1.cleanupEmptyTemporaryVoiceChannel)(oldState.guild, oldState.channelId));
        }, 1000).unref();
    }
    const member = newState.member || oldState.member;
    if (!member || member.user.bot)
        return;
    const key = (0, engagement_1.voiceXpSessionKey)(member.guild.id, member.id);
    const oldEligible = (0, voiceXp_1.isVoiceXpEligible)(oldState.channelId, false);
    const newEligible = (0, voiceXp_1.isVoiceXpEligible)(newState.channelId, false);
    if (oldEligible && !newEligible)
        (0, engagement_1.trackVoiceXpConnection)(member.guild, member.id, false);
    if (newEligible && (!oldEligible || !engagement_1.VOICE_XP_SESSIONS.get(key)?.connected))
        (0, engagement_1.trackVoiceXpConnection)(member.guild, member.id, true);
});
client_1.client.on("messageCreate", message => (0, metrics_1.runAsyncWithBoundary)("messageCreate", async () => {
    if (shuttingDown)
        return;
    if (message.author.bot)
        return;
    await (0, experience_1.trackTicketReply)(message);
    if (message.guildId) {
        const state = (0, store_1.ensureGuildModeration)(message.guildId);
        if (state.lockdownChannelId && message.channelId === state.lockdownChannelId) {
            const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
            const isAdmin = Boolean(member?.permissions?.has(discord_js_1.PermissionFlagsBits.Administrator));
            if (!isAdmin) {
                const reason = "Lockdown channel violation: non-admin message sent in protected channel.";
                await message.delete().catch(() => undefined);
                if (member) {
                    await member.ban({ reason }).catch(() => undefined);
                }
                await (0, store_1.sendModLog)(message.guildId, "Lockdown Ban", [
                    { name: "Target", value: `<@${message.author.id}>`, inline: true },
                    { name: "Channel", value: `<#${message.channelId}>`, inline: true },
                    { name: "Reason", value: reason }
                ]).catch(() => undefined);
                (0, audit_1.appendAuditEvent)("lockdown_ban", {
                    guildId: message.guildId,
                    channelId: message.channelId,
                    userId: message.author.id,
                    reason
                });
                return;
            }
        }
    }
    const isCommunicationEvent = message.content.trim().length > 0 ||
        message.mentions.users.size > 0 ||
        Boolean(message.reference) ||
        message.attachments.size > 0;
    if (message.guild && (0, settings_1.isFeatureEnabled)("antiRaid") && !(0, staffDesk_1.isStaffMember)(message.member)) {
        const detection = settings_1.antiRaidDetector.recordMessage({
            guildId: message.guild.id,
            userId: message.author.id,
            channelId: message.channelId,
            messageId: message.id,
            content: message.content,
            mentionCount: message.mentions.users.filter(user => user.id !== message.author.id).size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0)
        });
        if (detection)
            (0, metrics_1.runAsyncWithBoundary)("antiRaidAlert", () => (0, safety_1.raiseAntiRaidAlert)(message.guild, detection));
    }
    const messageXpGain = (0, settings_1.getMessageXpGain)();
    if (isCommunicationEvent && messageXpGain > 0 && (0, settings_1.isFeatureEnabled)("messageXp")) {
        const { totalXp: nextXp } = (0, engagement_1.awardEngagementXp)(message.guild, message.author.id, messageXpGain);
        (0, audit_1.appendAuditEvent)("engagement_xp", {
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
    if (message.content.trim().toLowerCase() === `${config_1.PREFIX}ping`) {
        await message.reply("Pong.");
    }
}));
process.on("unhandledRejection", reason => {
    console.error("Unhandled promise rejection:", reason);
    (0, audit_1.appendAuditEvent)("unhandled_rejection", { reason: (0, ops_1.toSafeString)(reason) });
    (0, checkpoint_1.checkpointState)("unhandled_rejection");
    (0, ops_1.postOpsAlert)("error", "Unhandled promise rejection", {
        reason: (0, ops_1.toSafeString)(reason)
    });
});
process.on("uncaughtException", error => {
    console.error("Uncaught exception:", error);
    (0, audit_1.appendAuditEvent)("uncaught_exception", { message: error.message, stack: error.stack });
    (0, ops_1.postOpsAlert)("error", "Uncaught exception", {
        name: error.name,
        message: error.message
    });
    void shutdown("uncaught_exception", 1);
});
async function bootServices() {
    const lock = (0, ops_1.acquireInstanceLock)();
    if (!lock.ok) {
        console.error(`[preflight] ${lock.reason}`);
        process.exit(1);
        return;
    }
    const preflight = await (0, ops_1.runStartupPreflight)();
    if (preflight.warnings.length > 0) {
        console.warn(`[preflight] warnings=${preflight.warnings.length} ${(0, ops_1.summarizePreflightMessages)(preflight.warnings)}`);
    }
    if (preflight.errors.length > 0) {
        console.error(`[preflight] errors=${preflight.errors.length} ${(0, ops_1.summarizePreflightMessages)(preflight.errors)}`);
        (0, ops_1.postOpsAlert)("error", "Startup preflight failed", {
            errors: preflight.errors.join(" | "),
            warnings: preflight.warnings.join(" | ")
        });
        process.exit(1);
        return;
    }
    (0, metrics_1.recordRuntimeStartup)();
    await client_1.client.login(process.env.DISCORD_TOKEN);
}
void bootServices().catch(error => {
    console.error("Boot failed:", error);
    (0, ops_1.postOpsAlert)("error", "Boot failed", {
        reason: (0, ops_1.toSafeString)(error)
    });
    void shutdown("boot_failed", 1);
});
