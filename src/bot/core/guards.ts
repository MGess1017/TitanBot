// Shared interaction guards (guild, admin, owner) and Discord error checks.
import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";

export function requireGuild(interaction: ChatInputCommandInteraction): string | null {
    if (!interaction.guild) return "This command can only be used in a server.";
    return null;
}

export function requireAdministrator(interaction: ChatInputCommandInteraction): string | null {
    const guildError = requireGuild(interaction);
    if (guildError) return guildError;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return "Only administrators can run this command.";
    }
    return null;
}

export function requireGuildOwner(interaction: ChatInputCommandInteraction): string | null {
    const guildError = requireGuild(interaction);
    if (guildError) return guildError;
    if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
        return "Only the Discord server owner can run this command.";
    }
    return null;
}

export function isUnknownInteractionError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const maybe = error as { code?: number | string };
    return maybe.code === 10062 || maybe.code === "10062";
}
