"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.giveawayCommands = void 0;
// Giveaway slash commands.
const discord_js_1 = require("discord.js");
const catalog_1 = require("../../game/catalog");
const config_1 = require("../core/config");
const giveaways_1 = require("../giveaways/giveaways");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const guards_1 = require("../core/guards");
const ticketPanels_1 = require("../panels/ticketPanels");
/** Giveaway commands. */
exports.giveawayCommands = {
    giveaway: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const prize = interaction.options.getString("prize", true).slice(0, 200);
        const durationRaw = interaction.options.getString("duration", true);
        const durationMs = (0, store_1.parseDurationMs)(durationRaw);
        if (!durationMs)
            return "Invalid duration. Use values like 30m, 6h, or 2d.";
        const winnerCount = Math.max(1, Math.min(20, interaction.options.getInteger("winners") || 1));
        const description = (interaction.options.getString("description") || "").slice(0, 1000);
        const roleRequired = interaction.options.getRole("role_required");
        const mentionRole = interaction.options.getRole("mention_role");
        const mentionUser = interaction.options.getUser("mention_user");
        const pingEveryone = Boolean(interaction.options.getBoolean("ping_everyone"));
        const channel = await (0, giveaways_1.resolveConfiguredGiveawayChannel)(guild);
        if (!channel)
            return `Configured giveaway channel ${config_1.GIVEAWAY_CHANNEL_ID} is missing or not a text channel.`;
        const giveaway = await (0, giveaways_1.createAndPostGiveaway)({
            guild,
            channel,
            hostId: interaction.user.id,
            prize,
            description,
            durationMs,
            winnerCount,
            roleRequiredId: roleRequired ? roleRequired.id : null,
            rewardKind: "generic",
            announcementContent: (0, giveaways_1.buildGiveawayAnnouncement)({ prize, mentionRoleId: mentionRole?.id || null, mentionUserId: mentionUser?.id || null, pingEveryone }),
            mentionRoleIds: mentionRole ? [mentionRole.id] : [],
            mentionUserIds: mentionUser ? [mentionUser.id] : [],
            mentionEveryone: pingEveryone
        });
        if (!giveaway)
            return "Failed to post giveaway message in the target channel.";
        (0, audit_1.appendAuditEvent)("giveaway_created", {
            guildId: guild.id,
            giveawayId: giveaway.id,
            hostId: interaction.user.id,
            channelId: channel.id,
            prize,
            durationMs,
            winnerCount,
            roleRequiredId: roleRequired?.id || null,
            mentionRoleId: mentionRole?.id || null,
            mentionUserId: mentionUser?.id || null,
            pingEveryone
        });
        await (0, giveaways_1.sendGiveawayLog)(guild.id, `Giveaway #${giveaway.id} Created`, [
            { name: "Prize", value: prize, inline: false },
            { name: "Reward Type", value: "Generic", inline: true },
            { name: "Host", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Channel", value: `<#${channel.id}>`, inline: true },
            { name: "Winners", value: `${winnerCount}`, inline: true },
            { name: "Duration", value: durationRaw, inline: true },
            { name: "Role Requirement", value: roleRequired ? `<@&${roleRequired.id}>` : "None", inline: true }
        ]);
        return JSON.stringify({ embed: new discord_js_1.EmbedBuilder().setColor(0xf59e0b).setTitle("🎉 Giveaway Created").setDescription(`Giveaway #${giveaway.id} is live in <#${channel.id}>.`).addFields({ name: "Prize", value: prize, inline: false }, { name: "Duration", value: durationRaw, inline: true }, { name: "Winners", value: `${winnerCount}`, inline: true }).toJSON() });
    },
    itemgiveaway: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const itemId = interaction.options.getString("item", true).trim().toLowerCase();
        const item = catalog_1.ITEM_DEFS[itemId];
        if (!item)
            return `Unknown raid item: ${itemId}`;
        const quantity = Math.max(1, interaction.options.getInteger("quantity", true));
        const durationRaw = interaction.options.getString("duration", true);
        const durationMs = (0, store_1.parseDurationMs)(durationRaw);
        if (!durationMs)
            return "Invalid duration. Use values like 30m, 6h, or 2d.";
        const winnerCount = Math.max(1, Math.min(20, interaction.options.getInteger("winners") || 1));
        const description = (interaction.options.getString("description") || "").slice(0, 1000);
        const title = (interaction.options.getString("title") || `${item.name} Giveaway`).slice(0, 200);
        const roleRequired = interaction.options.getRole("role_required");
        const mentionRole = interaction.options.getRole("mention_role");
        const mentionUser = interaction.options.getUser("mention_user");
        const pingEveryone = Boolean(interaction.options.getBoolean("ping_everyone"));
        const channel = await (0, giveaways_1.resolveConfiguredGiveawayChannel)(guild);
        if (!channel)
            return `Configured giveaway channel ${config_1.GIVEAWAY_CHANNEL_ID} is missing or not a text channel.`;
        const giveaway = await (0, giveaways_1.createAndPostGiveaway)({
            guild,
            channel,
            hostId: interaction.user.id,
            prize: title,
            description,
            durationMs,
            winnerCount,
            roleRequiredId: roleRequired ? roleRequired.id : null,
            rewardKind: "item",
            rewardItemId: itemId,
            rewardQty: quantity,
            announcementContent: (0, giveaways_1.buildGiveawayAnnouncement)({ prize: title, mentionRoleId: mentionRole?.id || null, mentionUserId: mentionUser?.id || null, pingEveryone }),
            mentionRoleIds: mentionRole ? [mentionRole.id] : [],
            mentionUserIds: mentionUser ? [mentionUser.id] : [],
            mentionEveryone: pingEveryone
        });
        if (!giveaway)
            return "Failed to post raid item giveaway message in the target channel.";
        (0, audit_1.appendAuditEvent)("giveaway_item_created", {
            guildId: guild.id,
            giveawayId: giveaway.id,
            hostId: interaction.user.id,
            channelId: channel.id,
            itemId,
            quantity,
            durationMs,
            winnerCount,
            roleRequiredId: roleRequired?.id || null,
            mentionRoleId: mentionRole?.id || null,
            mentionUserId: mentionUser?.id || null,
            pingEveryone
        });
        await (0, giveaways_1.sendGiveawayLog)(guild.id, `Giveaway #${giveaway.id} Created`, [
            { name: "Prize", value: title, inline: false },
            { name: "Reward Type", value: "Raid Item", inline: true },
            { name: "Raid Item", value: `${item.name} (${itemId}) x${quantity}`, inline: false },
            { name: "Host", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Channel", value: `<#${channel.id}>`, inline: true },
            { name: "Winners", value: `${winnerCount}`, inline: true }
        ]);
        return JSON.stringify({ embed: new discord_js_1.EmbedBuilder().setColor(0xf59e0b).setTitle("🎁 Raid Item Giveaway Created").setDescription(`Giveaway #${giveaway.id} is live in <#${channel.id}>.`).addFields({ name: "Raid Item", value: `${item.name} x${quantity}`, inline: false }, { name: "Duration", value: durationRaw, inline: true }, { name: "Winners", value: `${winnerCount}`, inline: true }).toJSON() });
    },
    raidgiveawaypanel: async (interaction) => {
        const guildError = (0, guards_1.requireGuild)(interaction);
        if (guildError)
            return guildError;
        if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
            return "You need Manage Channels to post the raid item giveaway panel.";
        }
        if (!interaction.channel || !interaction.channel.isTextBased()) {
            return "This command requires a text channel.";
        }
        if (!("send" in interaction.channel) || interaction.channel.type !== discord_js_1.ChannelType.GuildText) {
            return "This command requires a standard text channel.";
        }
        const payload = (0, ticketPanels_1.buildRaidItemGiveawayPanelPayload)(interaction.guild.name);
        await interaction.channel.send({ embeds: [payload.embed], components: payload.components, allowedMentions: { parse: [] } }).catch(() => null);
        return "✅ Raid item giveaway panel posted in this channel.";
    },
    giveawayedit: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const giveaway = (0, giveaways_1.getGiveawayById)(interaction.options.getInteger("id", true));
        if (!giveaway)
            return "Giveaway not found.";
        if (giveaway.status !== "active")
            return "Only active giveaways can be edited.";
        const raw = interaction.options.getString("duration", true).trim().toLowerCase();
        const isNegative = raw.startsWith("-");
        const durationMs = (0, store_1.parseDurationMs)(isNegative ? raw.slice(1) : raw);
        if (!durationMs)
            return "Invalid duration adjustment. Use values like 30m, 6h, 2d, or -15m.";
        giveaway.endAt += isNegative ? -durationMs : durationMs;
        giveaway.endAt = Math.max(Date.now() + 10000, giveaway.endAt);
        giveaway.updatedAt = Date.now();
        (0, giveaways_1.saveGiveawayStore)();
        await (0, giveaways_1.syncGiveawayMessage)(giveaway);
        (0, audit_1.appendAuditEvent)("giveaway_edit", { guildId: giveaway.guildId, giveawayId: giveaway.id, actorId: interaction.user.id, adjustment: raw, endAt: giveaway.endAt });
        await (0, giveaways_1.sendGiveawayLog)(giveaway.guildId, `Giveaway #${giveaway.id} Updated`, [
            { name: "Adjustment", value: raw, inline: true },
            { name: "New End", value: `<t:${Math.floor(giveaway.endAt / 1000)}:F>`, inline: true }
        ]);
        return `Giveaway #${giveaway.id} now ends <t:${Math.floor(giveaway.endAt / 1000)}:R>.`;
    },
    giveawayend: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const giveaway = (0, giveaways_1.getGiveawayById)(interaction.options.getInteger("id", true));
        if (!giveaway)
            return "Giveaway not found.";
        if (giveaway.status !== "active")
            return "Giveaway is already closed.";
        await (0, giveaways_1.finalizeGiveaway)(giveaway, "manual");
        return `Giveaway #${giveaway.id} ended.`;
    },
    giveawayreroll: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const giveaway = (0, giveaways_1.getGiveawayById)(interaction.options.getInteger("id", true));
        if (!giveaway)
            return "Giveaway not found.";
        if (!giveaway.entries.length)
            return "This giveaway has no entrants to reroll.";
        await (0, giveaways_1.finalizeGiveaway)(giveaway, "reroll");
        return `Giveaway #${giveaway.id} rerolled.`;
    },
    giveawaylist: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const scoped = giveaways_1.giveawayStore.giveaways
            .filter(entry => !interaction.guildId || entry.guildId === interaction.guildId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 15);
        if (!scoped.length)
            return "No giveaways found.";
        return [
            "🎉 Giveaways",
            ...scoped.map(entry => `#${entry.id} [${entry.status}|${entry.rewardKind === "item" ? `item:${entry.rewardItemId || "unknown"}x${entry.rewardQty}` : "generic"}] ${entry.prize} | entries ${entry.entries.length} | winners ${entry.winnerCount} | end <t:${Math.floor(entry.endAt / 1000)}:R>`)
        ].join("\n");
    }
};
