"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleTicketButtonInteraction = handleTicketButtonInteraction;
// Interaction handlers: ticket, report, and giveaway buttons.
const discord_js_1 = require("discord.js");
const giveaways_1 = require("../giveaways/giveaways");
const audit_1 = require("../core/audit");
const store_1 = require("../tickets/store");
const modals_1 = require("../ui/modals");
const records_1 = require("../tickets/records");
const opsPanel_1 = require("../tickets/opsPanel");
const actions_1 = require("../tickets/actions");
const ids_1 = require("../ui/ids");
const channels_1 = require("../tickets/channels");
/** Ticket, report, and giveaway panel buttons. */
async function handleTicketButtonInteraction(interaction) {
    if (interaction.isButton() && interaction.customId === ids_1.TICKET_IDS.open) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Tickets can only be opened in a server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.showModal((0, modals_1.buildTicketIntakeModal)()).catch(async () => {
            await interaction.reply({ content: "Unable to open intake modal right now.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.TICKET_IDS.watch) {
        const ticket = interaction.channelId ? (0, store_1.findTicketByChannel)(interaction.channelId) : null;
        if (!ticket) {
            await interaction.reply({ content: "This ticket is no longer tracked.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const saved = (0, store_1.addTicketWatcher)(ticket, interaction.user.id);
        await interaction.reply({ content: saved ? `You are now watching ticket #${ticket.id}.` : "Unable to save watcher status. Please retry.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && Object.values(store_1.TICKET_TEMPLATE_IDS).includes(interaction.customId)) {
        const member = interaction.member;
        if (!member || !(0, actions_1.canManageTicketActions)(member)) {
            await interaction.reply({ content: "Only support staff can use response templates.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const ticket = interaction.channelId ? (0, store_1.findTicketByChannel)(interaction.channelId) : null;
        const templateKey = Object.entries(store_1.TICKET_TEMPLATE_IDS).find(([, id]) => id === interaction.customId)?.[0] || "ack";
        const response = store_1.TICKET_RESPONSE_TEMPLATES[templateKey] || store_1.TICKET_RESPONSE_TEMPLATES.ack;
        if (ticket)
            (0, store_1.recordTicketEvent)(ticket, interaction.user.id, "template_used", `Response template '${templateKey}' prepared.`);
        await interaction.reply({ content: response, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.REPORT_IDS.adminOpen) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Admin report panel can only be used in a server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member;
        if (!member?.permissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can file reports from this panel.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.showModal((0, modals_1.buildAdminReportIntakeModal)()).catch(async () => {
            await interaction.reply({ content: "Unable to open admin report intake modal right now.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.REPORT_IDS.open) {
        await interaction.reply({ content: "Public report desk intake is disabled. Admins should use /reportintake or the admin report panel.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.GIVEAWAY_IDS.raidPanelOpen) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Raid item giveaways can only be created in a server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member;
        if (!member || !member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can use this giveaway panel.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.showModal((0, modals_1.buildRaidItemGiveawayModal)()).catch(async () => {
            await interaction.reply({ content: "Unable to open the raid item giveaway modal right now.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${ids_1.GIVEAWAY_IDS.enterPrefix}:`)) {
        const giveawayId = Number.parseInt(interaction.customId.split(":")[1] || "0", 10);
        const giveaway = (0, giveaways_1.getGiveawayById)(giveawayId);
        if (!giveaway) {
            await interaction.reply({ content: "This giveaway no longer exists.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (giveaway.status !== "active" || giveaway.endAt <= Date.now()) {
            if (giveaway.status === "active" && giveaway.endAt <= Date.now()) {
                await (0, giveaways_1.finalizeGiveaway)(giveaway, "timer");
            }
            await interaction.reply({ content: "This giveaway is already closed.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (!interaction.guild) {
            await interaction.reply({ content: "Giveaways can only be entered in a server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (giveaway.roleRequiredId) {
            const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member?.roles.cache.has(giveaway.roleRequiredId)) {
                await interaction.reply({ content: `You need <@&${giveaway.roleRequiredId}> to enter this giveaway.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
                return true;
            }
        }
        if (giveaway.entries.includes(interaction.user.id)) {
            await interaction.reply({ content: `You are already entered in giveaway #${giveaway.id}.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        giveaway.entries.push(interaction.user.id);
        giveaway.updatedAt = Date.now();
        (0, giveaways_1.saveGiveawayStore)();
        await (0, giveaways_1.syncGiveawayMessage)(giveaway);
        (0, audit_1.appendAuditEvent)("giveaway_enter", {
            guildId: giveaway.guildId,
            giveawayId: giveaway.id,
            userId: interaction.user.id,
            entryCount: giveaway.entries.length
        });
        await interaction.reply({ content: `You entered giveaway #${giveaway.id} for **${giveaway.prize}**.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.TICKET_IDS.close) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const tracked = await (0, records_1.ensureTrackedTicketByChannelId)(guild, interaction.channel.id, interaction.user.id);
        if (!tracked) {
            await interaction.reply({ content: "This channel is not a tracked ticket and could not be imported.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const ticket = (0, store_1.findOpenTicketByChannel)(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({ content: "This is not an open ticket.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member;
        if (!member || !(0, actions_1.canManageTicketActions)(member)) {
            await interaction.reply({ content: "Only admins or the handler role can archive tickets.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const msg = await (0, channels_1.closeTicketChannel)(guild, interaction.channel.id, interaction.user.id, "Archived by support panel action");
        const archived = (0, store_1.findArchivedTicketByChannel)(interaction.channel.id);
        if (archived) {
            await interaction.reply({
                embeds: [(0, opsPanel_1.buildTicketCommandEmbed)("🔒 Ticket Archived", "Ticket moved to archive hold queue from panel action.", archived, [
                        { name: "Archived By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Reason", value: "Archived by support panel action", inline: false },
                        { name: "Next Step", value: "Use resolve button or `/resolveticket` when fully complete." }
                    ])],
                flags: discord_js_1.MessageFlags.Ephemeral
            }).catch(() => undefined);
        }
        else {
            await interaction.reply({ content: msg, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.TICKET_IDS.claim) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member;
        if (!member || !(0, actions_1.canManageTicketActions)(member)) {
            await interaction.reply({ content: "Only admins or the handler role can claim tickets.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const msg = await (0, channels_1.claimTicketChannel)(guild, interaction.channel.id, interaction.user.id);
        const claimed = (0, store_1.findTicketByChannel)(interaction.channel.id);
        if (claimed && msg.toLowerCase().includes("claimed")) {
            await interaction.reply({
                embeds: [(0, opsPanel_1.buildTicketCommandEmbed)("🛠️ Ticket Claimed", "Claim succeeded and panel values were updated live.", claimed, [
                        { name: "Claimed By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Result", value: msg, inline: false },
                        { name: "Next Step", value: "Assign handler (`/ticketassign`) or update workflow (`/ticketstatus`)." }
                    ])],
                flags: discord_js_1.MessageFlags.Ephemeral
            }).catch(() => undefined);
        }
        else {
            await interaction.reply({ content: msg, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.TICKET_IDS.resolve) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const tracked = await (0, records_1.ensureTrackedTicketByChannelId)(guild, interaction.channel.id, interaction.user.id);
        if (!tracked) {
            await interaction.reply({ content: "This channel is not a tracked ticket and could not be imported.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const ticket = (0, store_1.findArchivedTicketByChannel)(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({ content: "This ticket must be archived before it can be permanently resolved.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member;
        if (!member || !(0, actions_1.canManageTicketActions)(member)) {
            await interaction.reply({ content: "Only admins or the handler role can permanently resolve tickets.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const msg = await (0, channels_1.resolveTicketChannel)(guild, interaction.channel.id, interaction.user.id, "Resolved by support panel action");
        const resolved = (0, store_1.findTicketByChannel)(interaction.channel.id);
        if (resolved && (0, store_1.normalizeTicketStatus)(resolved.status) === "resolved") {
            await interaction.reply({
                embeds: [(0, opsPanel_1.buildTicketCommandEmbed)("✅ Ticket Resolved Permanently", "Ticket was resolved and closed out from panel action.", resolved, [
                        { name: "Resolved By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Resolution", value: "Resolved by support panel action", inline: false },
                        { name: "Transcript", value: resolved.transcript ? "Captured in ticket metadata/logs." : "No transcript snapshot available." }
                    ])],
                flags: discord_js_1.MessageFlags.Ephemeral
            }).catch(() => undefined);
        }
        else {
            await interaction.reply({ content: msg, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }
    return false;
}
