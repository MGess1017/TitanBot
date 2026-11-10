"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generalCommands = void 0;
// General, bank, trade, XP, and profile slash commands.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const catalog_1 = require("../../game/catalog");
const coreCommands_1 = require("../../commands/coreCommands");
const health_1 = require("../../runtime/health");
const runescapeProfile_1 = require("../../features/runescapeProfile");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const metrics_1 = require("../core/metrics");
const announcements_1 = require("../core/announcements");
const trades_1 = require("../economy/trades");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const roles_1 = require("../xp/roles");
const guards_1 = require("../core/guards");
const help_1 = require("../ui/help");
const views_1 = require("../raid/views");
const profile_1 = require("../profile/profile");
const cards_1 = require("../profile/cards");
/** General, bank, trade, XP, and profile commands. */
exports.generalCommands = {
    ping: async () => {
        return "Pong.";
    },
    rs3: async (interaction) => {
        const playerName = interaction.options.getString("player")?.trim() || runescapeProfile_1.DEFAULT_RS3_PLAYER;
        return JSON.stringify({ embed: (0, runescapeProfile_1.buildRs3ProfileEmbed)(await (0, runescapeProfile_1.fetchRs3Profile)(playerName)).toJSON() });
    },
    help: async (interaction) => {
        return JSON.stringify(await (0, help_1.buildHelpPayload)("general", interaction.guild));
    },
    xproles: async (interaction) => {
        const lines = await (0, help_1.resolveXpRoleLines)(interaction.guild);
        const sections = (0, help_1.buildThemedRoleSections)(lines);
        const randomColor = Math.floor(Math.random() * 0xffffff);
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(randomColor)
            .setTitle("🎖️ XP Role Directory")
            .setDescription("Engagement XP rank tiers grouped into 5 themed sections")
            .setFooter({ text: `Showing ${lines.length} role entries` });
        for (const section of sections) {
            embed.addFields(section);
        }
        return JSON.stringify({ embed: embed.toJSON() });
    },
    xprolesync: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const pause = interaction.options.getBoolean("pause");
        const retry = interaction.options.getBoolean("retry") || false;
        const configXp = interaction.options.getInteger("config_xp");
        const configRole = interaction.options.getRole("config_role");
        const configName = interaction.options.getString("config_name")?.trim();
        if (configXp !== null || configRole || configName) {
            if (!configXp || configXp <= 0 || configXp > config_1.MAX_XP_ROLE_THRESHOLD || !configRole) {
                return `To configure an XP role tier, provide config_xp from 1 to ${config_1.MAX_XP_ROLE_THRESHOLD.toLocaleString()} and config_role. config_name is optional.`;
            }
            const configured = (0, roles_1.upsertXpRoleEntry)({ xp: configXp, roleId: configRole.id, name: configName || configRole.name });
            (0, audit_1.appendAuditEvent)("xp_role_config_updated", {
                guildId: guild.id,
                actorId: interaction.user.id,
                xp: configXp,
                roleId: configRole.id,
                name: configName || configRole.name,
                configuredTierCount: configured.length
            });
            await (0, roles_1.ensureXpTierRoles)(guild);
            return `XP role tier configured: ${configXp.toLocaleString()} XP -> ${configName || configRole.name}. Run /rolesanity dry_run:true to preview member changes.`;
        }
        if (pause !== null) {
            (0, roles_1.setXpRoleSyncPaused)(pause);
            (0, audit_1.appendAuditEvent)("xp_role_sync_pause_changed", { guildId: guild.id, paused: pause, actorId: interaction.user.id });
            if (!pause)
                (0, metrics_1.runAsyncWithBoundary)("xpRoleSyncResume", roles_1.drainXpRoleSyncQueue);
        }
        if (retry)
            (0, metrics_1.runAsyncWithBoundary)("xpRoleDeadLetterRetry", roles_1.retryXpRoleDeadLetters);
        if (roles_1.XP_ROLE_SYNC_PAUSED)
            return "XP role synchronization is paused for maintenance.";
        if (roles_1.XP_ROLE_SYNC_RUNNING_GUILDS.has(guild.id)) {
            return "An XP role sync is already running for this server. Please wait for it to finish.";
        }
        roles_1.XP_ROLE_SYNC_RUNNING_GUILDS.add(guild.id);
        const sourceChannelId = interaction.channelId || null;
        const startedByUserId = interaction.user.id;
        void (0, roles_1.runGuildXpRoleSyncJob)(guild, sourceChannelId, startedByUserId)
            .catch(error => {
            (0, audit_1.appendAuditEvent)("xp_role_sync_failed", {
                guildId: guild.id,
                userId: startedByUserId,
                error: error instanceof Error ? error.message : String(error)
            });
        })
            .finally(() => {
            roles_1.XP_ROLE_SYNC_RUNNING_GUILDS.delete(guild.id);
        });
        return "XP role sync started in the background. I will post completion results in this channel.";
    },
    status: async () => {
        const memory = process.memoryUsage();
        const deployment = await (0, announcements_1.getGitDeploymentInfo)();
        return [
            ...(0, health_1.buildStatusLines)(client_1.client.user?.tag, client_1.client.guilds.cache.size, client_1.client.ws.ping, memory, Math.floor(process.uptime())),
            `Deployment: ${deployment.shortCommit || "unknown"} • ${deployment.branch || "unknown"}`,
            `Build: ${deployment.subject || "unknown"}`
        ].join("\n");
    },
    balance: async (interaction) => (0, coreCommands_1.handleCoreCommand)("balance", interaction),
    bank: async (interaction) => (0, coreCommands_1.handleCoreCommand)("bank", interaction),
    deposit: async (interaction) => {
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0)
            return "Amount must be greater than 0.";
        const before = (0, utils_1.getTokens)(interaction.user.id);
        if (before < amount)
            return `You only have ${before} FN Token$ in your wallet.`;
        const res = (0, utils_1.depositToBank)(interaction.user.id, amount);
        return `Deposited ${amount} FN Token$. Wallet: ${res.wallet} | Bank: ${res.bank}`;
    },
    withdraw: async (interaction) => {
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0)
            return "Amount must be greater than 0.";
        const before = (0, utils_1.getBankTokens)(interaction.user.id);
        if (before < amount)
            return `You only have ${before} FN Token$ in bank.`;
        const res = (0, utils_1.withdrawFromBank)(interaction.user.id, amount);
        return `Withdrew ${amount} FN Token$. Wallet: ${res.wallet} | Bank: ${res.bank}`;
    },
    transfer: async (interaction) => {
        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        if (target.id === interaction.user.id)
            return "You cannot transfer to yourself.";
        if (amount <= 0)
            return "Amount must be greater than 0.";
        if ((0, utils_1.getTokens)(interaction.user.id) < amount)
            return "Not enough wallet tokens.";
        const moved = (0, utils_1.transferWalletTokens)(interaction.user.id, target.id, amount);
        return `Transferred ${moved.moved} FN Token$ to ${target.username}. Your wallet: ${moved.fromWallet}.`;
    },
    addtoken: async (interaction) => {
        const ownerError = (0, guards_1.requireGuildOwner)(interaction);
        if (ownerError)
            return ownerError;
        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0)
            return "Amount must be greater than 0.";
        const total = (0, utils_1.addTokens)(target.id, amount);
        await (0, store_1.sendModLog)(interaction.guildId, "FN Token$ Granted", [
            { name: "Granted By (Owner)", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Amount", value: `${amount}`, inline: true },
            { name: "New Total", value: `${total}`, inline: true }
        ]);
        return `${target.username} received ${amount} FN Token$ (ultra-rare coins normally found only in raids). New balance: ${total}.`;
    },
    tradeoffer: async (interaction) => {
        const target = interaction.options.getUser("user", true);
        const offerItemId = interaction.options.getString("offer_item", true).trim().toLowerCase();
        const offerQty = interaction.options.getInteger("offer_qty", true);
        const requestItemId = interaction.options.getString("request_item", true).trim().toLowerCase();
        const requestQty = interaction.options.getInteger("request_qty", true);
        if (target.id === interaction.user.id)
            return "You cannot create a trade with yourself.";
        if (offerQty <= 0 || requestQty <= 0)
            return "Trade quantities must be greater than 0.";
        if (!catalog_1.ITEM_DEFS[offerItemId])
            return `Unknown offer item: ${offerItemId}`;
        if (!catalog_1.ITEM_DEFS[requestItemId])
            return `Unknown request item: ${requestItemId}`;
        if ((0, utils_1.getInventoryCount)(interaction.user.id, offerItemId) < offerQty)
            return "You do not own enough of the offered item.";
        const offer = (0, trades_1.createTradeOffer)({
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
            `You give: ${offerQty}x ${catalog_1.ITEM_DEFS[offerItemId].name}`,
            `You request: ${requestQty}x ${catalog_1.ITEM_DEFS[requestItemId].name}`,
            `Target can accept with /tradeaccept offer_id:${offer.id}`
        ].join("\n");
    },
    trades: async (interaction) => {
        const userId = interaction.user.id;
        const open = trades_1.tradeStore.offers.filter(offer => offer.status === "open" && (offer.fromUserId === userId || offer.toUserId === userId));
        if (!open.length)
            return "No open trades for you.";
        const lines = open.slice(-12).reverse().map(offer => {
            const direction = offer.fromUserId === userId ? "Outgoing" : "Incoming";
            return `#${offer.id} ${direction} | ${offer.offerQty}x ${catalog_1.ITEM_DEFS[offer.offerItemId]?.name || offer.offerItemId} -> ${offer.requestQty}x ${catalog_1.ITEM_DEFS[offer.requestItemId]?.name || offer.requestItemId} | <@${offer.fromUserId}> to <@${offer.toUserId}>`;
        });
        return `Open trades:\n${lines.join("\n")}`;
    },
    tradeaccept: async (interaction) => {
        const offerId = Number.parseInt(interaction.options.getString("offer_id", true), 10);
        if (!Number.isFinite(offerId))
            return "Invalid trade selection.";
        const offer = (0, trades_1.getOpenTradeOffer)(offerId);
        if (!offer)
            return "Trade offer not found or already closed.";
        if (offer.toUserId !== interaction.user.id)
            return "Only the target user can accept this trade.";
        if ((0, utils_1.getInventoryCount)(offer.fromUserId, offer.offerItemId) < offer.offerQty) {
            offer.status = "cancelled";
            offer.updatedAt = Date.now();
            (0, trades_1.saveTradeStore)();
            return "Trade cancelled because the sender no longer has the offered item.";
        }
        if ((0, utils_1.getInventoryCount)(offer.toUserId, offer.requestItemId) < offer.requestQty) {
            return "You do not have enough of the requested item to complete this trade.";
        }
        (0, utils_1.removeInventoryItem)(offer.fromUserId, offer.offerItemId, offer.offerQty);
        (0, utils_1.removeInventoryItem)(offer.toUserId, offer.requestItemId, offer.requestQty);
        (0, utils_1.addInventoryItem)(offer.toUserId, offer.offerItemId, offer.offerQty);
        (0, utils_1.addInventoryItem)(offer.fromUserId, offer.requestItemId, offer.requestQty);
        offer.status = "accepted";
        offer.updatedAt = Date.now();
        (0, trades_1.saveTradeStore)();
        return `Trade #${offer.id} accepted and completed.`;
    },
    tradedecline: async (interaction) => {
        const offerId = Number.parseInt(interaction.options.getString("offer_id", true), 10);
        if (!Number.isFinite(offerId))
            return "Invalid trade selection.";
        const offer = (0, trades_1.getOpenTradeOffer)(offerId);
        if (!offer)
            return "Trade offer not found or already closed.";
        if (offer.toUserId !== interaction.user.id && offer.fromUserId !== interaction.user.id) {
            return "You are not part of this trade.";
        }
        offer.status = offer.toUserId === interaction.user.id ? "declined" : "cancelled";
        offer.updatedAt = Date.now();
        (0, trades_1.saveTradeStore)();
        return `Trade #${offer.id} ${offer.status}.`;
    },
    points: async (interaction) => {
        const target = interaction.options.getUser("user") || interaction.user;
        (0, utils_1.ensureUser)(target.id);
        return `${target.username} has ${(0, utils_1.getPoints)(target.id)} Access Points.`;
    },
    xp: async (interaction) => (0, cards_1.buildXpProfilePayload)(interaction.user, interaction.guild),
    pmc: async (interaction) => (0, views_1.buildPmcProfilePayload)(interaction.user),
    profile: async (interaction) => {
        const target = interaction.options.getUser("user") || interaction.user;
        if (target.bot)
            return "Bots do not have FNT profiles.";
        return JSON.stringify({ ...(0, profile_1.buildProfilePayload)(target, "overview", interaction.user.id, interaction.guild), profilePayload: true });
    }
};
