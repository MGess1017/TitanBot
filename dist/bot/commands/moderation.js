"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moderationSlashCommands = void 0;
// Moderation slash commands.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const ops_1 = require("../core/ops");
const store_1 = require("../moderation/store");
const guards_1 = require("../core/guards");
const registry_1 = require("./registry");
/** Moderation commands. */
exports.moderationSlashCommands = {
    addpoints: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const user = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        const addPointsDedupeError = (0, ops_1.rejectIfDuplicateCommand)(interaction, `addpoints:user:${user.id}:amount:${amount}`);
        if (addPointsDedupeError)
            return addPointsDedupeError;
        const total = (0, utils_1.addPoints)(user.id, amount);
        await (0, store_1.sendModLog)(interaction.guildId, "Access Points Added", [
            { name: "Admin", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${user.id}>`, inline: true },
            { name: "Amount", value: `${amount}`, inline: true },
            { name: "New Total", value: `${total}`, inline: true }
        ]);
        return `${user.username} now has ${total} Access Points.`;
    },
    timeout: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const target = interaction.options.getUser("user", true);
        const timeoutDedupeError = (0, ops_1.rejectIfDuplicateCommand)(interaction, `timeout:user:${target.id}`);
        if (timeoutDedupeError)
            return timeoutDedupeError;
        const guild = interaction.guild;
        const member = guild ? await guild.members.fetch(target.id).catch(() => null) : null;
        if (!member)
            return "Unable to find that member in this server.";
        const botMember = guild?.members.me ?? (guild ? await guild.members.fetchMe().catch(() => null) : null);
        if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ModerateMembers)) {
            return "The bot is missing the Moderate Members permission required to apply a timeout.";
        }
        if (!member.moderatable) {
            return "The bot cannot timeout this member. Check that the target is below the bot's highest role and is not the server owner.";
        }
        const timedOut = await member.timeout(5 * 60 * 1000, "Timeout by administrator action").then(() => true).catch(error => {
            console.warn(`[moderation] Timeout failed for ${target.id} in guild ${guild?.id || "unknown"}:`, error);
            return false;
        });
        if (!timedOut)
            return "Discord rejected the timeout. Check the bot's Moderate Members permission and role hierarchy.";
        await (0, store_1.sendModLog)(interaction.guildId, "Timeout", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Duration", value: "5m", inline: true },
            { name: "Reason", value: "Timeout by administrator action" }
        ]);
        return `${target.username} has been timed out for 5 minutes.`;
    },
    kick: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const target = interaction.options.getUser("user", true);
        const kickDedupeError = (0, ops_1.rejectIfDuplicateCommand)(interaction, `kick:user:${target.id}`);
        if (kickDedupeError)
            return kickDedupeError;
        const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;
        if (!member)
            return "Unable to find that member in this server.";
        await member.kick("Kick by administrator action");
        (0, ops_1.rememberModerationLog)("kick", interaction.guildId, target.id);
        await (0, store_1.sendModLog)(interaction.guildId, "Kick", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Reason", value: "Kick by administrator action" }
        ]);
        return `${target.username} has been kicked.`;
    },
    ban: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const target = interaction.options.getUser("user", true);
        const banDedupeError = (0, ops_1.rejectIfDuplicateCommand)(interaction, `ban:user:${target.id}`);
        if (banDedupeError)
            return banDedupeError;
        const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;
        if (!member)
            return "Unable to find that member in this server.";
        await member.ban({ reason: "Ban by administrator action" });
        (0, ops_1.rememberModerationLog)("ban", interaction.guildId, target.id);
        await (0, store_1.sendModLog)(interaction.guildId, "Ban", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Reason", value: "Ban by administrator action" }
        ]);
        return `${target.username} has been banned.`;
    },
    unban: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const userId = interaction.options.getString("user_id", true).trim();
        const reason = interaction.options.getString("reason")?.trim() || "Unban by administrator action";
        if (!/^\d{17,20}$/.test(userId))
            return "Provide a valid Discord user ID.";
        if (!interaction.guild)
            return "This command can only be used in a server.";
        const unbanDedupeError = (0, ops_1.rejectIfDuplicateCommand)(interaction, `unban:user:${userId}`);
        if (unbanDedupeError)
            return unbanDedupeError;
        try {
            await interaction.guild.members.unban(userId, reason);
        }
        catch {
            return "Unable to unban that user. They may not be banned or I lack Ban Members permission.";
        }
        await (0, store_1.sendModLog)(interaction.guildId, "Unban", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${userId}> (${userId})`, inline: true },
            { name: "Reason", value: reason }
        ]);
        return `User ${userId} has been unbanned.`;
    },
    setmodlog: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.setmodlog(interaction);
    },
    setlockdown: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.setlockdown(interaction);
    },
    lockdownnotice: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.lockdownnotice(interaction);
    },
    modconfig: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.modconfig(interaction);
    },
    warn: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.warn(interaction);
    },
    warnings: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.warnings(interaction);
    },
    clearwarnings: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.clearwarnings(interaction);
    },
    tempban: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.tempban(interaction);
    },
    purge: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.purge(interaction);
    },
    announce: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        return await registry_1.moderationCommandHandlers.announce(interaction);
    }
};
