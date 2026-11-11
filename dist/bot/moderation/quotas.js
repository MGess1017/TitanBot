"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModerationQuotaStore = getModerationQuotaStore;
exports.authorizeModerationAction = authorizeModerationAction;
exports.isDefiniteModerationRejection = isDefiniteModerationRejection;
exports.executeModerationQuotaAction = executeModerationQuotaAction;
const node_path_1 = __importDefault(require("node:path"));
const discord_js_1 = require("discord.js");
const moderationQuotas_1 = require("../../runtime/moderationQuotas");
const paths_1 = require("../core/paths");
__exportStar(require("../../runtime/moderationQuotas"), exports);
let store;
let storePath;
function getModerationQuotaStore() {
    const file = node_path_1.default.resolve(process.env.BOT_SRC_DIR || paths_1.BOT_SRC_DIR, "..", "src", "data", "moderation-quotas.json");
    if (!store || storePath !== file) {
        store = new moderationQuotas_1.ModerationQuotaStore(file);
        storePath = file;
    }
    return store;
}
async function authorizeModerationAction(interaction, targetId, action) {
    if (!interaction.guild)
        return { error: "This command can only be used in a server." };
    const guild = await interaction.guild.fetch().catch(() => null);
    if (!guild)
        return { error: "Unable to verify this server. No moderation action was taken." };
    const actor = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
    if (!actor?.permissions.has(discord_js_1.PermissionFlagsBits.Administrator))
        return { error: "Only administrators can run this command." };
    if (targetId === actor.id)
        return { error: "You cannot target yourself." };
    if (targetId === guild.ownerId)
        return { error: "You cannot target the server owner." };
    const member = await guild.members.fetch({ user: targetId, force: true }).catch(() => null);
    if (!member)
        return { error: "Unable to find that member in this server." };
    const bot = await guild.members.fetchMe({ force: true }).catch(() => null);
    const permission = action === "ban" ? discord_js_1.PermissionFlagsBits.BanMembers : discord_js_1.PermissionFlagsBits.KickMembers;
    if (!bot?.permissions.has(permission))
        return { error: `The bot is missing the ${action === "ban" ? "Ban" : "Kick"} Members permission.` };
    if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        return { error: "You cannot target a member with an equal or higher role." };
    }
    if (bot.id === member.id || bot.roles.highest.comparePositionTo(member.roles.highest) <= 0
        || !(action === "ban" ? member.bannable : member.kickable)) {
        return { error: "The bot cannot moderate this member. Check the target's role hierarchy." };
    }
    return { guild, member };
}
/** Only an explicit Discord 4xx rejection proves no destructive request succeeded. */
function isDefiniteModerationRejection(error) {
    return error instanceof discord_js_1.DiscordAPIError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
async function executeModerationQuotaAction(request, perform, quotaStore) {
    let activeStore;
    let reservationId;
    try {
        activeStore = quotaStore ?? getModerationQuotaStore();
        const result = activeStore.reserve(request);
        if (!result.allowed)
            return {
                ok: false,
                message: result.reason === "duplicate" ? "This moderation request has already been recorded; it will not be repeated."
                    : `Your ${request.action} quota is exhausted (${result.usage.used}/${result.usage.policy.limit} this UTC ${result.usage.policy.period}).`
            };
        reservationId = result.reservation.id;
    }
    catch (error) {
        console.error("[moderation] Quota reservation failed; action blocked:", error);
        return { ok: false, message: "Moderation quota storage is unavailable. No action was taken." };
    }
    try {
        await perform();
    }
    catch (error) {
        const definite = isDefiniteModerationRejection(error);
        try {
            activeStore.finish(reservationId, definite ? "rejected" : "uncertain", error instanceof Error ? error.message : String(error));
        }
        catch (saveError) {
            console.error("[moderation] Unable to persist failed quota outcome; reservation remains consumed:", saveError);
        }
        console.warn(`[moderation] ${request.action} failed for ${request.targetId}:`, error);
        return {
            ok: false, reservationId,
            message: definite ? "Discord rejected the moderation action. Its quota reservation has been released if storage is available."
                : "Discord's moderation outcome is uncertain. Quota remains consumed; ask the server owner to inspect the reservation before retrying."
        };
    }
    try {
        activeStore.finish(reservationId, "succeeded");
    }
    catch (error) {
        console.error("[moderation] Discord succeeded but quota finalization failed:", error);
        return {
            ok: false, reservationId, discordSucceeded: true,
            message: "Discord accepted the action, but its durable audit could not be finalized. Quota remains consumed; owner inspection is required."
        };
    }
    return { ok: true, reservationId, discordSucceeded: true };
}
