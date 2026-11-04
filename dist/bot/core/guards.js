"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireGuild = requireGuild;
exports.requireAdministrator = requireAdministrator;
exports.requireGuildOwner = requireGuildOwner;
exports.isUnknownInteractionError = isUnknownInteractionError;
// Shared interaction guards (guild, admin, owner) and Discord error checks.
const discord_js_1 = require("discord.js");
function requireGuild(interaction) {
    if (!interaction.guild)
        return "This command can only be used in a server.";
    return null;
}
function requireAdministrator(interaction) {
    const guildError = requireGuild(interaction);
    if (guildError)
        return guildError;
    if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.Administrator)) {
        return "Only administrators can run this command.";
    }
    return null;
}
function requireGuildOwner(interaction) {
    const guildError = requireGuild(interaction);
    if (guildError)
        return guildError;
    if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
        return "Only the Discord server owner can run this command.";
    }
    return null;
}
function isUnknownInteractionError(error) {
    if (!error || typeof error !== "object")
        return false;
    const maybe = error;
    return maybe.code === 10062 || maybe.code === "10062";
}
