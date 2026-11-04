// Role and ticket sanity checks with their repair routines.
import { Guild, PermissionFlagsBits } from "discord.js";
import { ensureUser } from "../../utils";
import { appendAuditEvent } from "./audit";
import {
    findTicketByChannel, normalizeTicketStatus, saveTicketStore, type TicketSanityReport, ticketStore
} from "../tickets/store";
import {
    describeXpRoleDiff, ensureXpTierRoles, getEffectiveXpRoleEntriesForGuild, type RoleSanityReport,
    runGuildXpRoleSyncJob, XP_ROLE_SYNC_RUNNING_GUILDS
} from "../xp/roles";
import { getTicketSlaState, pruneDeletedTicketRecords, pruneInaccessibleOwnerTicketRecords } from "../tickets/records";
import { updateTicketOpsPanelMessage } from "../tickets/opsPanel";

export async function collectRoleSanityReport(guild: Guild): Promise<RoleSanityReport> {
    await guild.roles.fetch().catch(() => undefined);
    await guild.members.fetch().catch(() => undefined);

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    const botHighest = me?.roles.highest?.position ?? 0;
    const canManageRoles = Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles));
    const configurationErrors: string[] = [];
    const seenThresholds = new Set<number>();
    const roleEntries = await getEffectiveXpRoleEntriesForGuild(guild);
    for (const tier of roleEntries) {
        if (seenThresholds.has(tier.xp)) configurationErrors.push(`Duplicate XP threshold: ${tier.xp}`);
        seenThresholds.add(tier.xp);
        if (!/^\d{15,22}$/.test(tier.roleId)) configurationErrors.push(`Invalid role ID for ${tier.name}: ${tier.roleId}`);
    }

    const existingTierRoles = roleEntries
        .map(tier => ({ tier, role: guild.roles.cache.get(tier.roleId) || null }))
        .filter(item => Boolean(item.role));

    const missing = roleEntries.filter(tier => !guild.roles.cache.has(tier.roleId));
    const hierarchyBlocked = existingTierRoles
        .filter(item => (item.role?.position || 0) >= botHighest)
        .map(item => ({ tier: item.tier, rolePosition: item.role?.position || 0 }));

    let multiTierMembers = 0;
    const dryRunDiffs: string[] = [];
    for (const [, member] of guild.members.cache) {
        if (member.user.bot) continue;
        const count = roleEntries.filter(tier => member.roles.cache.has(tier.roleId)).length;
        if (count > 1) multiTierMembers += 1;
        if (dryRunDiffs.length < 10) {
            const diff = describeXpRoleDiff(member, ensureUser(member.id).xp, roleEntries, botHighest);
            if (diff.hasChange) dryRunDiffs.push(diff.line);
        }
    }

    return {
        configuredTierCount: roleEntries.length,
        existingTierCount: existingTierRoles.length,
        missing,
        hierarchyBlocked,
        dryRunDiffs,
        multiTierMembers,
        canManageRoles,
        botHighestRolePosition: botHighest,
        configurationErrors
    };
}

export async function runRoleSanityFix(guild: Guild, startedByUserId: string, sourceChannelId: string | null): Promise<{ started: boolean; reason?: string }> {
    if (XP_ROLE_SYNC_RUNNING_GUILDS.has(guild.id)) {
        return { started: false, reason: "XP role sync already running." };
    }

    XP_ROLE_SYNC_RUNNING_GUILDS.add(guild.id);
    void ensureXpTierRoles(guild)
        .then(() => runGuildXpRoleSyncJob(guild, sourceChannelId, startedByUserId))
        .catch(error => {
            appendAuditEvent("rolesanity_fix_failed", {
                guildId: guild.id,
                userId: startedByUserId,
                error: error instanceof Error ? error.message : String(error)
            });
        })
        .finally(() => {
            XP_ROLE_SYNC_RUNNING_GUILDS.delete(guild.id);
        });

    appendAuditEvent("rolesanity_fix_started", {
        guildId: guild.id,
        userId: startedByUserId,
        sourceChannelId
    });

    return { started: true };
}

export async function collectTicketSanityReport(guild: Guild): Promise<TicketSanityReport> {
    const guildTickets = ticketStore.tickets.filter(ticket => ticket.guildId === guild.id);
    const open = guildTickets.filter(ticket => normalizeTicketStatus(ticket.status) === "open").length;
    const claimed = guildTickets.filter(ticket => normalizeTicketStatus(ticket.status) === "claimed").length;
    const archived = guildTickets.filter(ticket => normalizeTicketStatus(ticket.status) === "archived").length;
    const resolved = guildTickets.filter(ticket => normalizeTicketStatus(ticket.status) === "resolved").length;

    const ownerOpenCounts = new Map<string, number>();
    for (const ticket of guildTickets) {
        if (ticket.status !== "open" && ticket.status !== "claimed") continue;
        ownerOpenCounts.set(ticket.ownerId, (ownerOpenCounts.get(ticket.ownerId) || 0) + 1);
    }
    const duplicateOpenOwners = [...ownerOpenCounts.values()].filter(count => count > 1).length;

    let missingChannels = 0;
    for (const ticket of guildTickets) {
        const exists = guild.channels.cache.get(ticket.channelId)
            || await guild.channels.fetch(ticket.channelId).catch(() => null);
        if (!exists) missingChannels += 1;
    }

    const panelMissing = guildTickets.filter(ticket =>
        (ticket.status === "open" || ticket.status === "claimed") && !ticket.panelMessageId
    ).length;

    const slaBreaches = guildTickets
        .filter(ticket => ticket.status !== "resolved")
        .map(ticket => ({ ticket, sla: getTicketSlaState(ticket) }))
        .filter(entry => entry.sla.firstResponseOverdue || entry.sla.resolveOverdue)
        .length;

    return {
        total: guildTickets.length,
        open,
        claimed,
        archived,
        resolved,
        missingChannels,
        duplicateOpenOwners,
        panelMissing,
        slaBreaches
    };
}

function dedupeActiveTicketsByOwner(guildId: string): number {
    const active = ticketStore.tickets
        .filter(ticket => ticket.guildId === guildId && (ticket.status === "open" || ticket.status === "claimed"))
        .sort((a, b) => b.createdAt - a.createdAt);

    const keepOwners = new Set<string>();
    let removed = 0;

    for (const ticket of active) {
        if (!keepOwners.has(ticket.ownerId)) {
            keepOwners.add(ticket.ownerId);
            continue;
        }

        const idx = ticketStore.tickets.findIndex(t => t.id === ticket.id);
        if (idx >= 0) {
            ticketStore.tickets.splice(idx, 1);
            removed += 1;
        }
    }

    if (removed > 0) {
        saveTicketStore();
    }

    return removed;
}

export async function runTicketSanityFix(guild: Guild): Promise<{ removedDeleted: number; removedInaccessible: number; deduped: number; panelBackfilled: number }> {
    const removedDeleted = await pruneDeletedTicketRecords(guild);
    const removedInaccessible = await pruneInaccessibleOwnerTicketRecords(guild);
    const deduped = dedupeActiveTicketsByOwner(guild.id);

    let panelBackfilled = 0;
    const activeTickets = ticketStore.tickets.filter(t => t.guildId === guild.id && (t.status === "open" || t.status === "claimed") && !t.panelMessageId);
    for (const ticket of activeTickets) {
        await updateTicketOpsPanelMessage(guild, ticket);
        const refreshed = findTicketByChannel(ticket.channelId);
        if (refreshed?.panelMessageId) panelBackfilled += 1;
    }

    appendAuditEvent("ticketsanity_fix_applied", {
        guildId: guild.id,
        removedDeleted,
        removedInaccessible,
        deduped,
        panelBackfilled
    });

    return { removedDeleted, removedInaccessible, deduped, panelBackfilled };
}
