"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectRoleSanityReport = collectRoleSanityReport;
exports.runRoleSanityFix = runRoleSanityFix;
exports.collectTicketSanityReport = collectTicketSanityReport;
exports.runTicketSanityFix = runTicketSanityFix;
// Role and ticket sanity checks with their repair routines.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const audit_1 = require("./audit");
const store_1 = require("../tickets/store");
const roles_1 = require("../xp/roles");
const records_1 = require("../tickets/records");
const opsPanel_1 = require("../tickets/opsPanel");
async function collectRoleSanityReport(guild) {
    await guild.roles.fetch().catch(() => undefined);
    await guild.members.fetch().catch(() => undefined);
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    const botHighest = me?.roles.highest?.position ?? 0;
    const canManageRoles = Boolean(me?.permissions.has(discord_js_1.PermissionFlagsBits.ManageRoles));
    const configurationErrors = [];
    const seenThresholds = new Set();
    const roleEntries = await (0, roles_1.getEffectiveXpRoleEntriesForGuild)(guild);
    for (const tier of roleEntries) {
        if (seenThresholds.has(tier.xp))
            configurationErrors.push(`Duplicate XP threshold: ${tier.xp}`);
        seenThresholds.add(tier.xp);
        if (!/^\d{15,22}$/.test(tier.roleId))
            configurationErrors.push(`Invalid role ID for ${tier.name}: ${tier.roleId}`);
    }
    const existingTierRoles = roleEntries
        .map(tier => ({ tier, role: guild.roles.cache.get(tier.roleId) || null }))
        .filter(item => Boolean(item.role));
    const missing = roleEntries.filter(tier => !guild.roles.cache.has(tier.roleId));
    const hierarchyBlocked = existingTierRoles
        .filter(item => (item.role?.position || 0) >= botHighest)
        .map(item => ({ tier: item.tier, rolePosition: item.role?.position || 0 }));
    let multiTierMembers = 0;
    const dryRunDiffs = [];
    for (const [, member] of guild.members.cache) {
        if (member.user.bot)
            continue;
        const count = roleEntries.filter(tier => member.roles.cache.has(tier.roleId)).length;
        if (count > 1)
            multiTierMembers += 1;
        if (dryRunDiffs.length < 10) {
            const diff = (0, roles_1.describeXpRoleDiff)(member, (0, utils_1.ensureUser)(member.id).xp, roleEntries, botHighest);
            if (diff.hasChange)
                dryRunDiffs.push(diff.line);
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
async function runRoleSanityFix(guild, startedByUserId, sourceChannelId) {
    if (roles_1.XP_ROLE_SYNC_RUNNING_GUILDS.has(guild.id)) {
        return { started: false, reason: "XP role sync already running." };
    }
    roles_1.XP_ROLE_SYNC_RUNNING_GUILDS.add(guild.id);
    void (0, roles_1.ensureXpTierRoles)(guild)
        .then(() => (0, roles_1.runGuildXpRoleSyncJob)(guild, sourceChannelId, startedByUserId))
        .catch(error => {
        (0, audit_1.appendAuditEvent)("rolesanity_fix_failed", {
            guildId: guild.id,
            userId: startedByUserId,
            error: error instanceof Error ? error.message : String(error)
        });
    })
        .finally(() => {
        roles_1.XP_ROLE_SYNC_RUNNING_GUILDS.delete(guild.id);
    });
    (0, audit_1.appendAuditEvent)("rolesanity_fix_started", {
        guildId: guild.id,
        userId: startedByUserId,
        sourceChannelId
    });
    return { started: true };
}
async function collectTicketSanityReport(guild) {
    const guildTickets = store_1.ticketStore.tickets.filter(ticket => ticket.guildId === guild.id);
    const open = guildTickets.filter(ticket => (0, store_1.normalizeTicketStatus)(ticket.status) === "open").length;
    const claimed = guildTickets.filter(ticket => (0, store_1.normalizeTicketStatus)(ticket.status) === "claimed").length;
    const archived = guildTickets.filter(ticket => (0, store_1.normalizeTicketStatus)(ticket.status) === "archived").length;
    const resolved = guildTickets.filter(ticket => (0, store_1.normalizeTicketStatus)(ticket.status) === "resolved").length;
    const ownerOpenCounts = new Map();
    for (const ticket of guildTickets) {
        if (ticket.status !== "open" && ticket.status !== "claimed")
            continue;
        ownerOpenCounts.set(ticket.ownerId, (ownerOpenCounts.get(ticket.ownerId) || 0) + 1);
    }
    const duplicateOpenOwners = [...ownerOpenCounts.values()].filter(count => count > 1).length;
    let missingChannels = 0;
    for (const ticket of guildTickets) {
        const exists = guild.channels.cache.get(ticket.channelId)
            || await guild.channels.fetch(ticket.channelId).catch(() => null);
        if (!exists)
            missingChannels += 1;
    }
    const panelMissing = guildTickets.filter(ticket => (ticket.status === "open" || ticket.status === "claimed") && !ticket.panelMessageId).length;
    const slaBreaches = guildTickets
        .filter(ticket => ticket.status !== "resolved")
        .map(ticket => ({ ticket, sla: (0, records_1.getTicketSlaState)(ticket) }))
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
function dedupeActiveTicketsByOwner(guildId) {
    const active = store_1.ticketStore.tickets
        .filter(ticket => ticket.guildId === guildId && (ticket.status === "open" || ticket.status === "claimed"))
        .sort((a, b) => b.createdAt - a.createdAt);
    const keepOwners = new Set();
    let removed = 0;
    for (const ticket of active) {
        if (!keepOwners.has(ticket.ownerId)) {
            keepOwners.add(ticket.ownerId);
            continue;
        }
        const idx = store_1.ticketStore.tickets.findIndex(t => t.id === ticket.id);
        if (idx >= 0) {
            store_1.ticketStore.tickets.splice(idx, 1);
            removed += 1;
        }
    }
    if (removed > 0) {
        (0, store_1.saveTicketStore)();
    }
    return removed;
}
async function runTicketSanityFix(guild) {
    const removedDeleted = await (0, records_1.pruneDeletedTicketRecords)(guild);
    const removedInaccessible = await (0, records_1.pruneInaccessibleOwnerTicketRecords)(guild);
    const deduped = dedupeActiveTicketsByOwner(guild.id);
    let panelBackfilled = 0;
    const activeTickets = store_1.ticketStore.tickets.filter(t => t.guildId === guild.id && (t.status === "open" || t.status === "claimed") && !t.panelMessageId);
    for (const ticket of activeTickets) {
        await (0, opsPanel_1.updateTicketOpsPanelMessage)(guild, ticket);
        const refreshed = (0, store_1.findTicketByChannel)(ticket.channelId);
        if (refreshed?.panelMessageId)
            panelBackfilled += 1;
    }
    (0, audit_1.appendAuditEvent)("ticketsanity_fix_applied", {
        guildId: guild.id,
        removedDeleted,
        removedInaccessible,
        deduped,
        panelBackfilled
    });
    return { removedDeleted, removedInaccessible, deduped, panelBackfilled };
}
