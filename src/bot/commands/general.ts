// General, bank, trade, XP, and profile slash commands.
import { EmbedBuilder } from "discord.js";
import {
    addTokens, addInventoryItem, depositToBank, ensureUser, getBankTokens, getInventoryCount, getPmcLevel,
    getPmcPrestigeTier, formatProgressPercent, getPoints, getTokens, getXPLevel, removeInventoryItem,
    transferWalletTokens, withdrawFromBank, XP_LEVEL_THRESHOLDS, xpBar
} from "../../utils";
import { ITEM_DEFS } from "../../game/catalog";
import { handleCoreCommand } from "../../commands/coreCommands";
import { buildStatusLines } from "../../runtime/health";
import { addXpCrateProfile } from "../../features/xpCratePanel";
import { MAX_XP_ROLE_THRESHOLD } from "../core/config";
import { client } from "../core/client";
import { getCurrentVoiceXpMultiplier } from "../xp/engagement";
import { runAsyncWithBoundary } from "../core/metrics";
import { getGitDeploymentInfo } from "../core/announcements";
import { getAccessPointBadge, getPmcTierVisual, getPrestigeBadge } from "../pmc/visuals";
import { createTradeOffer, getOpenTradeOffer, saveTradeStore, tradeStore } from "../economy/trades";
import { appendAuditEvent } from "../core/audit";
import { sendModLog } from "../moderation/store";
import {
    drainXpRoleSyncQueue, ensureXpTierRoles, getEffectiveXpRoleEntries, retryXpRoleDeadLetters,
    runGuildXpRoleSyncJob, setXpRoleSyncPaused, upsertXpRoleEntry, XP_ROLE_SYNC_PAUSED, XP_ROLE_SYNC_RUNNING_GUILDS
} from "../xp/roles";
import { requireAdministrator, requireGuildOwner } from "../core/guards";
import { buildHelpPayload, buildThemedRoleSections, resolveXpRoleLines } from "../ui/help";
import { buildPmcProfilePayload } from "../raid/views";
import { type CommandHandlerMap } from "./registry";
import { buildProfilePayload } from "../profile/profile";

/** General, bank, trade, XP, and profile commands. */
export const generalCommands: CommandHandlerMap = {
    ping: async () => {
        return "Pong.";
    },
    help: async interaction => {
        return JSON.stringify(await buildHelpPayload("general", interaction.guild));
    },
    xproles: async interaction => {
        const lines = await resolveXpRoleLines(interaction.guild);
        const sections = buildThemedRoleSections(lines);
        const randomColor = Math.floor(Math.random() * 0xffffff);
        const embed = new EmbedBuilder()
            .setColor(randomColor)
            .setTitle("🎖️ XP Role Directory")
            .setDescription("Engagement XP rank tiers grouped into 5 themed sections")
            .setFooter({ text: `Showing ${lines.length} role entries` });

        for (const section of sections) {
            embed.addFields(section);
        }

        return JSON.stringify({ embed: embed.toJSON() });
    },
    xprolesync: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;

        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";
        const pause = interaction.options.getBoolean("pause");
        const retry = interaction.options.getBoolean("retry") || false;
        const configXp = interaction.options.getInteger("config_xp");
        const configRole = interaction.options.getRole("config_role");
        const configName = interaction.options.getString("config_name")?.trim();

        if (configXp !== null || configRole || configName) {
            if (!configXp || configXp <= 0 || configXp > MAX_XP_ROLE_THRESHOLD || !configRole) {
                return `To configure an XP role tier, provide config_xp from 1 to ${MAX_XP_ROLE_THRESHOLD.toLocaleString()} and config_role. config_name is optional.`;
            }
            const configured = upsertXpRoleEntry({ xp: configXp, roleId: configRole.id, name: configName || configRole.name });
            appendAuditEvent("xp_role_config_updated", {
                guildId: guild.id,
                actorId: interaction.user.id,
                xp: configXp,
                roleId: configRole.id,
                name: configName || configRole.name,
                configuredTierCount: configured.length
            });
            await ensureXpTierRoles(guild);
            return `XP role tier configured: ${configXp.toLocaleString()} XP -> ${configName || configRole.name}. Run /rolesanity dry_run:true to preview member changes.`;
        }

        if (pause !== null) {
            setXpRoleSyncPaused(pause);
            appendAuditEvent("xp_role_sync_pause_changed", { guildId: guild.id, paused: pause, actorId: interaction.user.id });
            if (!pause) runAsyncWithBoundary("xpRoleSyncResume", drainXpRoleSyncQueue);
        }
        if (retry) runAsyncWithBoundary("xpRoleDeadLetterRetry", retryXpRoleDeadLetters);
        if (XP_ROLE_SYNC_PAUSED) return "XP role synchronization is paused for maintenance.";

        if (XP_ROLE_SYNC_RUNNING_GUILDS.has(guild.id)) {
            return "An XP role sync is already running for this server. Please wait for it to finish.";
        }

        XP_ROLE_SYNC_RUNNING_GUILDS.add(guild.id);
        const sourceChannelId = interaction.channelId || null;
        const startedByUserId = interaction.user.id;

        void runGuildXpRoleSyncJob(guild, sourceChannelId, startedByUserId)
            .catch(error => {
                appendAuditEvent("xp_role_sync_failed", {
                    guildId: guild.id,
                    userId: startedByUserId,
                    error: error instanceof Error ? error.message : String(error)
                });
            })
            .finally(() => {
                XP_ROLE_SYNC_RUNNING_GUILDS.delete(guild.id);
            });

        return "XP role sync started in the background. I will post completion results in this channel.";
    },
    status: async () => {
        const memory = process.memoryUsage();
        const deployment = await getGitDeploymentInfo();
        return [
            ...buildStatusLines(client.user?.tag, client.guilds.cache.size, client.ws.ping, memory, Math.floor(process.uptime())),
            `Deployment: ${deployment.shortCommit || "unknown"} • ${deployment.branch || "unknown"}`,
            `Build: ${deployment.subject || "unknown"}`
        ].join("\n");
    },
    balance: async interaction => handleCoreCommand("balance", interaction),
    bank: async interaction => handleCoreCommand("bank", interaction),
    deposit: async interaction => {
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0) return "Amount must be greater than 0.";
        const before = getTokens(interaction.user.id);
        if (before < amount) return `You only have ${before} FN Token$ in your wallet.`;
        const res = depositToBank(interaction.user.id, amount);
        return `Deposited ${amount} FN Token$. Wallet: ${res.wallet} | Bank: ${res.bank}`;
    },
    withdraw: async interaction => {
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0) return "Amount must be greater than 0.";
        const before = getBankTokens(interaction.user.id);
        if (before < amount) return `You only have ${before} FN Token$ in bank.`;
        const res = withdrawFromBank(interaction.user.id, amount);
        return `Withdrew ${amount} FN Token$. Wallet: ${res.wallet} | Bank: ${res.bank}`;
    },
    transfer: async interaction => {
        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        if (target.id === interaction.user.id) return "You cannot transfer to yourself.";
        if (amount <= 0) return "Amount must be greater than 0.";
        if (getTokens(interaction.user.id) < amount) return "Not enough wallet tokens.";
        const moved = transferWalletTokens(interaction.user.id, target.id, amount);
        return `Transferred ${moved.moved} FN Token$ to ${target.username}. Your wallet: ${moved.fromWallet}.`;
    },
    addtoken: async interaction => {
        const ownerError = requireGuildOwner(interaction);
        if (ownerError) return ownerError;

        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0) return "Amount must be greater than 0.";

        const total = addTokens(target.id, amount);
        await sendModLog(interaction.guildId!, "FN Token$ Granted", [
            { name: "Granted By (Owner)", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Amount", value: `${amount}`, inline: true },
            { name: "New Total", value: `${total}`, inline: true }
        ]);

        return `${target.username} received ${amount} FN Token$ (ultra-rare coins normally found only in raids). New balance: ${total}.`;
    },
    tradeoffer: async interaction => {
        const target = interaction.options.getUser("user", true);
        const offerItemId = interaction.options.getString("offer_item", true).trim().toLowerCase();
        const offerQty = interaction.options.getInteger("offer_qty", true);
        const requestItemId = interaction.options.getString("request_item", true).trim().toLowerCase();
        const requestQty = interaction.options.getInteger("request_qty", true);

        if (target.id === interaction.user.id) return "You cannot create a trade with yourself.";
        if (offerQty <= 0 || requestQty <= 0) return "Trade quantities must be greater than 0.";
        if (!ITEM_DEFS[offerItemId]) return `Unknown offer item: ${offerItemId}`;
        if (!ITEM_DEFS[requestItemId]) return `Unknown request item: ${requestItemId}`;
        if (getInventoryCount(interaction.user.id, offerItemId) < offerQty) return "You do not own enough of the offered item.";

        const offer = createTradeOffer({
            guildId: interaction.guildId,
            fromUserId: interaction.user.id,
            toUserId: target.id,
            offerItemId,
            offerQty,
            requestItemId,
            requestQty
        });

        return [
            `Trade offer #${offer.id} created for ${target.username}.`,
            `You give: ${offerQty}x ${ITEM_DEFS[offerItemId].name}`,
            `You request: ${requestQty}x ${ITEM_DEFS[requestItemId].name}`,
            `Target can accept with /tradeaccept offer_id:${offer.id}`
        ].join("\n");
    },
    trades: async interaction => {
        const userId = interaction.user.id;
        const open = tradeStore.offers.filter(offer => offer.status === "open" && (offer.fromUserId === userId || offer.toUserId === userId));
        if (!open.length) return "No open trades for you.";
        const lines = open.slice(-12).reverse().map(offer => {
            const direction = offer.fromUserId === userId ? "Outgoing" : "Incoming";
            return `#${offer.id} ${direction} | ${offer.offerQty}x ${ITEM_DEFS[offer.offerItemId]?.name || offer.offerItemId} -> ${offer.requestQty}x ${ITEM_DEFS[offer.requestItemId]?.name || offer.requestItemId} | <@${offer.fromUserId}> to <@${offer.toUserId}>`;
        });
        return `Open trades:\n${lines.join("\n")}`;
    },
    tradeaccept: async interaction => {
        const offerId = Number.parseInt(interaction.options.getString("offer_id", true), 10);
        if (!Number.isFinite(offerId)) return "Invalid trade selection.";
        const offer = getOpenTradeOffer(offerId);
        if (!offer) return "Trade offer not found or already closed.";
        if (offer.toUserId !== interaction.user.id) return "Only the target user can accept this trade.";

        if (getInventoryCount(offer.fromUserId, offer.offerItemId) < offer.offerQty) {
            offer.status = "cancelled";
            offer.updatedAt = Date.now();
            saveTradeStore();
            return "Trade cancelled because the sender no longer has the offered item.";
        }
        if (getInventoryCount(offer.toUserId, offer.requestItemId) < offer.requestQty) {
            return "You do not have enough of the requested item to complete this trade.";
        }

        removeInventoryItem(offer.fromUserId, offer.offerItemId, offer.offerQty);
        removeInventoryItem(offer.toUserId, offer.requestItemId, offer.requestQty);
        addInventoryItem(offer.toUserId, offer.offerItemId, offer.offerQty);
        addInventoryItem(offer.fromUserId, offer.requestItemId, offer.requestQty);

        offer.status = "accepted";
        offer.updatedAt = Date.now();
        saveTradeStore();
        return `Trade #${offer.id} accepted and completed.`;
    },
    tradedecline: async interaction => {
        const offerId = Number.parseInt(interaction.options.getString("offer_id", true), 10);
        if (!Number.isFinite(offerId)) return "Invalid trade selection.";
        const offer = getOpenTradeOffer(offerId);
        if (!offer) return "Trade offer not found or already closed.";
        if (offer.toUserId !== interaction.user.id && offer.fromUserId !== interaction.user.id) {
            return "You are not part of this trade.";
        }
        offer.status = offer.toUserId === interaction.user.id ? "declined" : "cancelled";
        offer.updatedAt = Date.now();
        saveTradeStore();
        return `Trade #${offer.id} ${offer.status}.`;
    },
    points: async interaction => {
        const target = interaction.options.getUser("user") || interaction.user;
        ensureUser(target.id);
        return `${target.username} has ${getPoints(target.id)} Access Points.`;
    },
    xp: async interaction => {
        const userId = interaction.user.id;
        const voiceMultiplier = getCurrentVoiceXpMultiplier(interaction.guild, userId);
        const user = ensureUser(userId);
        const accessPoints = getPoints(userId);
        const badge = getAccessPointBadge(accessPoints);
        const prestigeBadge = getPrestigeBadge(user.prestige);
        const pmcLevel = getPmcLevel(user.pmcXP);
        const pmcPrestigeTier = getPmcPrestigeTier(user.pmcPrestige);
        const tierVisual = getPmcTierVisual(pmcLevel);
        const engagementLevel = getXPLevel(user.xp);
        const currentThreshold = engagementLevel > 0 ? XP_LEVEL_THRESHOLDS[engagementLevel - 1] : 0;
        const nextThreshold = XP_LEVEL_THRESHOLDS[engagementLevel] ?? currentThreshold;
        const levelSpan = Math.max(1, nextThreshold - currentThreshold);
        const xpIntoLevel = Math.max(0, user.xp - currentThreshold);
        const xpToNextLevel = nextThreshold > currentThreshold ? Math.max(0, nextThreshold - user.xp) : 0;
        const progressPercent = nextThreshold > currentThreshold
            ? formatProgressPercent(xpIntoLevel / levelSpan)
            : "100%";
        const lastXpAt = user.lastXP > 0 ? `<t:${Math.floor(user.lastXP / 1000)}:R>` : "No XP earned yet";
        const roleEntries = getEffectiveXpRoleEntries();
        const currentRole = roleEntries.filter(entry => user.xp >= entry.xp).pop();
        const nextRole = roleEntries.find(entry => entry.xp > user.xp);
        const roleProgress = currentRole && nextRole
            ? `${Math.max(0, user.xp - currentRole.xp).toLocaleString()}/${(nextRole.xp - currentRole.xp).toLocaleString()} XP`
            : nextRole
                ? `${user.xp.toLocaleString()}/${nextRole.xp.toLocaleString()} XP`
                : "Highest configured role reached";
        const streakText = user.dailyStreak > 0 ? `${user.dailyStreak} day streak` : "No active streak";
        const achievements = user.achievements.length > 0
            ? user.achievements.slice(0, 4).join("\n")
            : "No achievements yet";
        const embed = new EmbedBuilder()
            .setColor(prestigeBadge.color)
            .setTitle("📈 XP Progress Center")
            .setDescription([
                `🧠 **Live XP:** ${user.xp.toLocaleString()}`,
                `🎚️ **Level ${engagementLevel}**${nextThreshold > currentThreshold ? ` • ${xpToNextLevel.toLocaleString()} XP to level ${engagementLevel + 1}` : " • Level cap reached"}`,
                `${xpBar(user.xp)}`
            ].join("\n"))
            .setThumbnail("https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c8.png")
            .addFields(
                {
                    name: "XP Status",
                    value: `Voice XP: **${voiceMultiplier}x** (${voiceMultiplier * 100} XP/minute)\n2x after 2 continuous hours in any VC. Disconnecting resets to 1x. Message XP is unchanged.`,
                    inline: false
                },
                {
                    name: "🎯 Engagement",
                    value: [
                        `Level: **${engagementLevel.toLocaleString()}**`,
                        `In level: **${xpIntoLevel.toLocaleString()} / ${levelSpan.toLocaleString()} XP**`,
                        `Completion: **${progressPercent}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🎖️ XP Role",
                    value: [
                        `Current: **${currentRole?.name || "No role yet"}**`,
                        `Progress: **${roleProgress}**`,
                        `Next: **${nextRole ? `${nextRole.name} at ${nextRole.xp.toLocaleString()} XP` : "Maximum tier"}**`,
                        `Unlock history: **${user.xpRoleUnlocks.length}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "💼 Economy",
                    value: [
                        `🪙 FN Token$: **${user.fnTokens.toLocaleString()}**`,
                        `🏦 Banked: **${user.bankTokens.toLocaleString()}**`,
                        `🎯 Access Points: **${accessPoints.toLocaleString()}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🔥 Activity",
                    value: [
                        `📆 ${streakText}`,
                        `⏱️ Last XP: **${lastXpAt}**`,
                        `🏆 Achievements: **${user.achievements.length.toLocaleString()}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🪖 Raid Track",
                    value: [
                        `PMC Level: **${pmcLevel.toLocaleString()}**`,
                        `Raid XP: **${user.pmcXP.toLocaleString()}**`,
                        `Tier: **${tierVisual.label}**`,
                        `PMC Prestige: **${pmcPrestigeTier.numeral} • ${pmcPrestigeTier.label}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🌟 Status",
                    value: [
                        `Engagement Prestige: **${user.prestige.toLocaleString()}**`,
                        `Badge: **${prestigeBadge.label}**`,
                        `Access Tier: **${badge.label}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "✨ Recent Unlocks",
                    value: achievements,
                    inline: true
                }
            )
            .setFooter({ text: "Live data is pulled from persisted XP state." });
        addXpCrateProfile(embed, user.latestXpCrate);
        return JSON.stringify({ embed: embed.toJSON(), xpCrateId: user.latestXpCrate?.crateId });
    },
    pmc: async interaction => buildPmcProfilePayload(interaction.user),
    profile: async interaction => {
        const target = interaction.options.getUser("user") || interaction.user;
        if (target.bot) return "Bots do not have FNT profiles.";
        return JSON.stringify({ ...buildProfilePayload(target, "overview", interaction.user.id, interaction.guild), profilePayload: true });
    }
};
