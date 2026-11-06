"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketCsatButtons = buildTicketCsatButtons;
exports.addTicketInternalNote = addTicketInternalNote;
exports.postJsonToWebhook = postJsonToWebhook;
exports.pruneDeletedTicketRecords = pruneDeletedTicketRecords;
exports.pruneInaccessibleOwnerTicketRecords = pruneInaccessibleOwnerTicketRecords;
exports.purgeLegacyImportedTicketRecords = purgeLegacyImportedTicketRecords;
exports.findChannelOwnerFromTopic = findChannelOwnerFromTopic;
exports.ensureTrackedTicketByChannelId = ensureTrackedTicketByChannelId;
exports.createTicketEntry = createTicketEntry;
exports.archiveTicketByChannel = archiveTicketByChannel;
exports.claimTicketByChannel = claimTicketByChannel;
exports.resolveTicketByChannel = resolveTicketByChannel;
exports.setTicketWorkflowStatus = setTicketWorkflowStatus;
exports.assignTicketToUser = assignTicketToUser;
exports.reopenTicketByChannel = reopenTicketByChannel;
exports.getTicketSlaState = getTicketSlaState;
exports.setTicketPanelMessageId = setTicketPanelMessageId;
exports.sendTicketLog = sendTicketLog;
exports.ticketChannelNotice = ticketChannelNotice;
// Ticket record helpers: lookups, state changes, notes, and logs.
const discord_js_1 = require("discord.js");
const node_https_1 = __importDefault(require("node:https"));
const ticketText_1 = require("../../services/ticketText");
const ticketState_1 = require("../../services/ticketState");
const client_1 = require("../core/client");
const audit_1 = require("../core/audit");
const store_1 = require("./store");
const ids_1 = require("../ui/ids");
const embeds_1 = require("../ui/embeds");
const ticketExperience_1 = require("../../services/ticketExperience");
function buildTicketCsatButtons(ticketId) {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.csatPrefix}:${ticketId}:1`).setLabel("1").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.csatPrefix}:${ticketId}:2`).setLabel("2").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.csatPrefix}:${ticketId}:3`).setLabel("3").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.csatPrefix}:${ticketId}:4`).setLabel("4").setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.csatPrefix}:${ticketId}:5`).setLabel("5").setStyle(discord_js_1.ButtonStyle.Success));
}
function addTicketInternalNote(ticket, note) {
    if (!ticket.internalNotes)
        ticket.internalNotes = [];
    ticket.internalNotes.push({ ...note, note: (0, ticketText_1.sanitizeTranscriptLine)(note.note).slice(0, 500) });
    ticket.updatedAt = Date.now();
    return (0, store_1.saveTicketStore)();
}
function postJsonToWebhook(webhookUrlRaw, payload) {
    return new Promise(resolve => {
        let webhookUrl;
        try {
            webhookUrl = new URL(webhookUrlRaw);
        }
        catch {
            resolve(false);
            return;
        }
        const body = JSON.stringify(payload);
        const req = node_https_1.default.request({
            protocol: webhookUrl.protocol,
            hostname: webhookUrl.hostname,
            port: webhookUrl.port || (webhookUrl.protocol === "https:" ? 443 : 80),
            path: `${webhookUrl.pathname}${webhookUrl.search}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            }
        }, res => {
            const ok = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
            res.resume();
            resolve(ok);
        });
        req.on("error", () => resolve(false));
        req.write(body);
        req.end();
    });
}
async function pruneDeletedTicketRecords(guild) {
    let removed = 0;
    for (let i = store_1.ticketStore.tickets.length - 1; i >= 0; i--) {
        const ticket = store_1.ticketStore.tickets[i];
        if (ticket.guildId !== guild.id || ticketExperience_1.ticketActions.isBusy(ticket.channelId))
            continue;
        const channel = guild.channels.cache.get(ticket.channelId)
            || await guild.channels.fetch(ticket.channelId).catch(error => {
                if (error instanceof discord_js_1.DiscordAPIError && error.code === 10003)
                    return null;
                throw error;
            });
        if (channel)
            continue;
        store_1.ticketStore.tickets.splice(i, 1);
        removed += 1;
        (0, audit_1.appendAuditEvent)("ticket_prune_deleted_channel", {
            guildId: guild.id,
            ticketId: ticket.id,
            channelId: ticket.channelId,
            ownerId: ticket.ownerId,
            priorStatus: ticket.status
        });
    }
    if (removed > 0) {
        (0, store_1.saveTicketStore)();
    }
    return removed;
}
async function pruneInaccessibleOwnerTicketRecords(guild) {
    let removed = 0;
    for (let i = store_1.ticketStore.tickets.length - 1; i >= 0; i--) {
        const ticket = store_1.ticketStore.tickets[i];
        if (ticket.guildId !== guild.id || ticketExperience_1.ticketActions.isBusy(ticket.channelId))
            continue;
        if (!(ticket.status === "open" || ticket.status === "claimed"))
            continue;
        const channel = guild.channels.cache.get(ticket.channelId)
            || await guild.channels.fetch(ticket.channelId).catch(error => {
                if (error instanceof discord_js_1.DiscordAPIError && error.code === 10003)
                    return null;
                throw error;
            });
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
            continue;
        const owner = await guild.members.fetch(ticket.ownerId).catch(error => {
            if (error instanceof discord_js_1.DiscordAPIError && error.code === 10007)
                return null;
            throw error;
        });
        const ownerCanView = owner ? channel.permissionsFor(owner)?.has(discord_js_1.PermissionFlagsBits.ViewChannel) : false;
        if (ownerCanView)
            continue;
        store_1.ticketStore.tickets.splice(i, 1);
        removed += 1;
        (0, audit_1.appendAuditEvent)("ticket_prune_inaccessible_owner", {
            guildId: guild.id,
            ticketId: ticket.id,
            channelId: ticket.channelId,
            ownerId: ticket.ownerId,
            priorStatus: ticket.status
        });
    }
    if (removed > 0) {
        (0, store_1.saveTicketStore)();
    }
    return removed;
}
function purgeLegacyImportedTicketRecords(guildId) {
    const legacyReasons = new Set([
        "Imported existing ticket channel",
        "Imported from known ticket button channel"
    ]);
    const before = store_1.ticketStore.tickets.length;
    store_1.ticketStore.tickets = store_1.ticketStore.tickets.filter(ticket => !(ticket.guildId === guildId && legacyReasons.has(ticket.reason)));
    const removed = before - store_1.ticketStore.tickets.length;
    if (removed > 0) {
        (0, store_1.saveTicketStore)();
        (0, audit_1.appendAuditEvent)("ticket_legacy_import_purge", { guildId, removed });
    }
    return removed;
}
function findChannelOwnerFromTopic(topic) {
    if (!topic)
        return null;
    const match = topic.match(/\((\d{17,21})\)(?:\s*\[ticket-archived\])?\s*$/);
    if (!match)
        return null;
    return match[1];
}
async function ensureTrackedTicketByChannelId(_guild, channelId, _fallbackOwnerId) {
    const existing = (0, store_1.findTicketByChannel)(channelId);
    if (existing)
        return existing;
    return null;
}
function createTicketEntry(guildId, ownerId, channelId, reason, priority) {
    return (0, ticketState_1.createTicketEntry)(store_1.ticketStore, guildId, ownerId, channelId, reason, priority, store_1.saveTicketStore);
}
function archiveTicketByChannel(channelId, closeReason) {
    return (0, ticketState_1.archiveTicketByChannel)(store_1.ticketStore.tickets, channelId, closeReason, store_1.saveTicketStore);
}
function claimTicketByChannel(channelId, claimedById) {
    return (0, ticketState_1.claimTicketByChannel)(store_1.ticketStore.tickets, channelId, claimedById, store_1.saveTicketStore);
}
function resolveTicketByChannel(channelId, resolvedReason, transcript) {
    return (0, ticketState_1.resolveTicketByChannel)(store_1.ticketStore.tickets, channelId, resolvedReason, transcript, store_1.saveTicketStore);
}
function setTicketWorkflowStatus(channelId, workflowStatus) {
    if (ticketExperience_1.ticketActions.isBusy(channelId))
        return null;
    return (0, ticketState_1.setTicketWorkflowStatus)(store_1.ticketStore.tickets, channelId, workflowStatus, store_1.saveTicketStore);
}
function assignTicketToUser(channelId, assigneeId, ownsLock = false) {
    if (!ownsLock && ticketExperience_1.ticketActions.isBusy(channelId))
        return null;
    return (0, ticketState_1.assignTicketToUser)(store_1.ticketStore.tickets, channelId, assigneeId, store_1.saveTicketStore);
}
function reopenTicketByChannel(channelId, reopenedById, reopenReason) {
    if (ticketExperience_1.ticketActions.isBusy(channelId))
        return null;
    return (0, ticketState_1.reopenTicketByChannel)(store_1.ticketStore.tickets, channelId, reopenedById, reopenReason, store_1.saveTicketStore);
}
function getTicketSlaState(ticket, now = Date.now(), thresholds) {
    return (0, ticketState_1.getTicketSlaState)(ticket, now, thresholds);
}
function setTicketPanelMessageId(channelId, panelMessageId) {
    (0, ticketState_1.setTicketPanelMessageId)(store_1.ticketStore.tickets, channelId, panelMessageId, store_1.saveTicketStore);
}
async function sendTicketLog(guildId, title, fields) {
    const cfg = (0, store_1.ensureTicketConfig)(guildId);
    if (!cfg.logChannelId)
        return;
    const guild = client_1.client.guilds.cache.get(guildId);
    if (!guild)
        return;
    const channel = guild.channels.cache.get(cfg.logChannelId);
    if (!channel || !channel.isTextBased())
        return;
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x2dd4bf)
        .setTitle(`🎫 ${title}`)
        .setTimestamp(new Date())
        .addFields(fields), "FN Support Ticket Stream", "Ticket event feed");
    await channel.send({ embeds: [embed] }).catch(() => undefined);
}
async function ticketChannelNotice(guild, ticket, message) {
    const channel = guild.channels.cache.get(ticket.channelId);
    if (channel?.type === discord_js_1.ChannelType.GuildText)
        await channel.send({ content: message, allowedMentions: { parse: [] } }).catch(() => undefined);
}
