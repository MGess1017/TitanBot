import path from "node:path";
import { ChatInputCommandInteraction, DiscordAPIError, Guild, GuildMember, PermissionFlagsBits } from "discord.js";
import { ModerationQuotaStore, type ModerationQuotaAction, type ModerationQuotaRequest } from "../../runtime/moderationQuotas";
import { BOT_SRC_DIR } from "../core/paths";

export * from "../../runtime/moderationQuotas";

let store: ModerationQuotaStore | undefined;
let storePath: string | undefined;
export function getModerationQuotaStore(): ModerationQuotaStore {
    const file = path.resolve(process.env.BOT_SRC_DIR || BOT_SRC_DIR, "..", "src", "data", "moderation-quotas.json");
    if (!store || storePath !== file) {
        store = new ModerationQuotaStore(file);
        storePath = file;
    }
    return store;
}

export async function authorizeModerationAction(interaction: ChatInputCommandInteraction, targetId: string, action: ModerationQuotaAction):
    Promise<{ error: string } | { guild: Guild; member: GuildMember }> {
    if (!interaction.guild) return { error: "This command can only be used in a server." } as const;
    const guild = await interaction.guild.fetch().catch(() => null);
    if (!guild) return { error: "Unable to verify this server. No moderation action was taken." } as const;
    const actor = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
    if (!actor?.permissions.has(PermissionFlagsBits.Administrator)) return { error: "Only administrators can run this command." } as const;
    if (targetId === actor.id) return { error: "You cannot target yourself." } as const;
    if (targetId === guild.ownerId) return { error: "You cannot target the server owner." } as const;
    const member = await guild.members.fetch({ user: targetId, force: true }).catch(() => null);
    if (!member) return { error: "Unable to find that member in this server." } as const;
    const bot = await guild.members.fetchMe({ force: true }).catch(() => null);
    const permission = action === "ban" ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.KickMembers;
    if (!bot?.permissions.has(permission)) return { error: `The bot is missing the ${action === "ban" ? "Ban" : "Kick"} Members permission.` } as const;
    if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        return { error: "You cannot target a member with an equal or higher role." } as const;
    }
    if (bot.id === member.id || bot.roles.highest.comparePositionTo(member.roles.highest) <= 0
        || !(action === "ban" ? member.bannable : member.kickable)) {
        return { error: "The bot cannot moderate this member. Check the target's role hierarchy." } as const;
    }
    return { guild, member } as const;
}

/** Only an explicit Discord 4xx rejection proves no destructive request succeeded. */
export function isDefiniteModerationRejection(error: unknown): boolean {
    return error instanceof DiscordAPIError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

export async function executeModerationQuotaAction(request: ModerationQuotaRequest, perform: () => Promise<unknown>,
    quotaStore?: ModerationQuotaStore): Promise<{ ok: boolean; message?: string; reservationId?: string; discordSucceeded?: boolean }> {
    let activeStore: ModerationQuotaStore;
    let reservationId: string;
    try {
        activeStore = quotaStore ?? getModerationQuotaStore();
        const result = activeStore.reserve(request);
        if (!result.allowed) return {
            ok: false,
            message: result.reason === "duplicate" ? "This moderation request has already been recorded; it will not be repeated."
                : `Your ${request.action} quota is exhausted (${result.usage.used}/${result.usage.policy.limit} this UTC ${result.usage.policy.period}).`
        };
        reservationId = result.reservation.id;
    } catch (error) {
        console.error("[moderation] Quota reservation failed; action blocked:", error);
        return { ok: false, message: "Moderation quota storage is unavailable. No action was taken." };
    }
    try {
        await perform();
    } catch (error) {
        const definite = isDefiniteModerationRejection(error);
        try { activeStore.finish(reservationId, definite ? "rejected" : "uncertain", error instanceof Error ? error.message : String(error)); }
        catch (saveError) { console.error("[moderation] Unable to persist failed quota outcome; reservation remains consumed:", saveError); }
        console.warn(`[moderation] ${request.action} failed for ${request.targetId}:`, error);
        return {
            ok: false, reservationId,
            message: definite ? "Discord rejected the moderation action. Its quota reservation has been released if storage is available."
                : "Discord's moderation outcome is uncertain. Quota remains consumed; ask the server owner to inspect the reservation before retrying."
        };
    }
    try { activeStore.finish(reservationId, "succeeded"); }
    catch (error) {
        console.error("[moderation] Discord succeeded but quota finalization failed:", error);
        return {
            ok: false, reservationId, discordSucceeded: true,
            message: "Discord accepted the action, but its durable audit could not be finalized. Quota remains consumed; owner inspection is required."
        };
    }
    return { ok: true, reservationId, discordSucceeded: true };
}
