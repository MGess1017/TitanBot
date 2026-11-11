// Moderation slash commands.
import { PermissionFlagsBits } from "discord.js";
import { addPoints } from "../../utils";
import { rejectIfDuplicateCommand, rememberModerationLog } from "../core/ops";
import { sendModLog } from "../moderation/store";
import { requireAdministrator } from "../core/guards";
import { authorizeModerationAction, executeModerationQuotaAction } from "../moderation/quotas";
import { type CommandHandlerMap, moderationCommandHandlers } from "./registry";

/** Moderation commands. */
export const moderationSlashCommands: CommandHandlerMap = {
    addpoints: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const user = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        const addPointsDedupeError = rejectIfDuplicateCommand(interaction, `addpoints:user:${user.id}:amount:${amount}`);
        if (addPointsDedupeError) return addPointsDedupeError;
        const total = addPoints(user.id, amount);
        await sendModLog(interaction.guildId!, "Access Points Added", [
            { name: "Admin", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${user.id}>`, inline: true },
            { name: "Amount", value: `${amount}`, inline: true },
            { name: "New Total", value: `${total}`, inline: true }
        ]);
        return `${user.username} now has ${total} Access Points.`;
    },
    timeout: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const target = interaction.options.getUser("user", true);
        const timeoutDedupeError = rejectIfDuplicateCommand(interaction, `timeout:user:${target.id}`);
        if (timeoutDedupeError) return timeoutDedupeError;
        const guild = interaction.guild;
        const member = guild ? await guild.members.fetch(target.id).catch(() => null) : null;
        if (!member) return "Unable to find that member in this server.";
        const botMember = guild?.members.me ?? (guild ? await guild.members.fetchMe().catch(() => null) : null);
        if (!botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return "The bot is missing the Moderate Members permission required to apply a timeout.";
        }
        if (!member.moderatable) {
            return "The bot cannot timeout this member. Check that the target is below the bot's highest role and is not the server owner.";
        }
        const timedOut = await member.timeout(5 * 60 * 1000, "Timeout by administrator action").then(() => true).catch(error => {
            console.warn(`[moderation] Timeout failed for ${target.id} in guild ${guild?.id || "unknown"}:`, error);
            return false;
        });
        if (!timedOut) return "Discord rejected the timeout. Check the bot's Moderate Members permission and role hierarchy.";
        await sendModLog(interaction.guildId!, "Timeout", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Duration", value: "5m", inline: true },
            { name: "Reason", value: "Timeout by administrator action" }
        ]);
        return `${target.username} has been timed out for 5 minutes.`;
    },
    kick: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const target = interaction.options.getUser("user", true);
        const kickDedupeError = rejectIfDuplicateCommand(interaction, `kick:user:${target.id}`);
        if (kickDedupeError) return kickDedupeError;
        const authorized = await authorizeModerationAction(interaction, target.id, "kick");
        if ("error" in authorized) return authorized.error;
        const result = await executeModerationQuotaAction({
            guildId: authorized.guild.id, action: "kick", userId: interaction.user.id, targetId: target.id,
            requestId: interaction.id, ownerId: authorized.guild.ownerId, reason: "Kick by administrator action"
        }, () => authorized.member.kick("Kick by administrator action"));
        if (!result.ok && !result.discordSucceeded) return result.message!;
        rememberModerationLog("kick", interaction.guildId!, target.id);
        await sendModLog(interaction.guildId!, "Kick", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Reason", value: "Kick by administrator action" }
        ]);
        return result.ok ? `${target.username} has been kicked.` : result.message!;
    },
    ban: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const target = interaction.options.getUser("user", true);
        const banDedupeError = rejectIfDuplicateCommand(interaction, `ban:user:${target.id}`);
        if (banDedupeError) return banDedupeError;
        const authorized = await authorizeModerationAction(interaction, target.id, "ban");
        if ("error" in authorized) return authorized.error;
        const result = await executeModerationQuotaAction({
            guildId: authorized.guild.id, action: "ban", userId: interaction.user.id, targetId: target.id,
            requestId: interaction.id, ownerId: authorized.guild.ownerId, reason: "Ban by administrator action"
        }, () => authorized.member.ban({ reason: "Ban by administrator action" }));
        if (!result.ok && !result.discordSucceeded) return result.message!;
        rememberModerationLog("ban", interaction.guildId!, target.id);
        await sendModLog(interaction.guildId!, "Ban", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Reason", value: "Ban by administrator action" }
        ]);
        return result.ok ? `${target.username} has been banned.` : result.message!;
    },
    unban: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const userId = interaction.options.getString("user_id", true).trim();
        const reason = interaction.options.getString("reason")?.trim() || "Unban by administrator action";
        if (!/^\d{17,20}$/.test(userId)) return "Provide a valid Discord user ID.";
        if (!interaction.guild) return "This command can only be used in a server.";

        const unbanDedupeError = rejectIfDuplicateCommand(interaction, `unban:user:${userId}`);
        if (unbanDedupeError) return unbanDedupeError;

        try {
            await interaction.guild.members.unban(userId, reason);
        } catch {
            return "Unable to unban that user. They may not be banned or I lack Ban Members permission.";
        }

        await sendModLog(interaction.guildId!, "Unban", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${userId}> (${userId})`, inline: true },
            { name: "Reason", value: reason }
        ]);
        return `User ${userId} has been unbanned.`;
    },
    setmodlog: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.setmodlog(interaction);
    },
    setlockdown: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.setlockdown(interaction);
    },
    lockdownnotice: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.lockdownnotice(interaction);
    },
    modconfig: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.modconfig(interaction);
    },
    warn: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.warn(interaction);
    },
    warnings: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.warnings(interaction);
    },
    clearwarnings: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.clearwarnings(interaction);
    },
    tempban: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.tempban(interaction);
    },
    purge: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.purge(interaction);
    },
    announce: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.announce(interaction);
    }
};
