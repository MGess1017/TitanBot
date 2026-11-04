// Interaction handlers: ticket, report, and giveaway buttons.
import { GuildMember, MessageFlags, PermissionFlagsBits, type Interaction } from "discord.js";
import { finalizeGiveaway, getGiveawayById, saveGiveawayStore, syncGiveawayMessage } from "../giveaways/giveaways";
import { appendAuditEvent } from "../core/audit";
import {
    addTicketWatcher, findArchivedTicketByChannel, findOpenTicketByChannel, findTicketByChannel,
    normalizeTicketStatus, recordTicketEvent, TICKET_RESPONSE_TEMPLATES, TICKET_TEMPLATE_IDS
} from "../tickets/store";
import { buildAdminReportIntakeModal, buildRaidItemGiveawayModal, buildTicketIntakeModal } from "../ui/modals";
import { ensureTrackedTicketByChannelId } from "../tickets/records";
import { buildTicketCommandEmbed } from "../tickets/opsPanel";
import { canManageTicketActions } from "../tickets/actions";
import { GIVEAWAY_IDS, REPORT_IDS, TICKET_IDS } from "../ui/ids";
import { claimTicketChannel, closeTicketChannel, resolveTicketChannel } from "../tickets/channels";

/** Ticket, report, and giveaway panel buttons. */
export async function handleTicketButtonInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isButton() && interaction.customId === TICKET_IDS.open) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Tickets can only be opened in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.showModal(buildTicketIntakeModal()).catch(async () => {
            await interaction.reply({ content: "Unable to open intake modal right now.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return true;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.watch) {
        const ticket = interaction.channelId ? findTicketByChannel(interaction.channelId) : null;
        if (!ticket) {
            await interaction.reply({ content: "This ticket is no longer tracked.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const saved = addTicketWatcher(ticket, interaction.user.id);
        await interaction.reply({ content: saved ? `You are now watching ticket #${ticket.id}.` : "Unable to save watcher status. Please retry.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && Object.values(TICKET_TEMPLATE_IDS).includes(interaction.customId as typeof TICKET_TEMPLATE_IDS[keyof typeof TICKET_TEMPLATE_IDS])) {
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only support staff can use response templates.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const ticket = interaction.channelId ? findTicketByChannel(interaction.channelId) : null;
        const templateKey = Object.entries(TICKET_TEMPLATE_IDS).find(([, id]) => id === interaction.customId)?.[0] || "ack";
        const response = TICKET_RESPONSE_TEMPLATES[templateKey] || TICKET_RESPONSE_TEMPLATES.ack;
        if (ticket) recordTicketEvent(ticket, interaction.user.id, "template_used", `Response template '${templateKey}' prepared.`);
        await interaction.reply({ content: response, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === REPORT_IDS.adminOpen) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Admin report panel can only be used in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member as GuildMember | null;
        if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can file reports from this panel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.showModal(buildAdminReportIntakeModal()).catch(async () => {
            await interaction.reply({ content: "Unable to open admin report intake modal right now.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return true;
    }

    if (interaction.isButton() && interaction.customId === REPORT_IDS.open) {
        await interaction.reply({ content: "Public report desk intake is disabled. Admins should use /reportintake or the admin report panel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === GIVEAWAY_IDS.raidPanelOpen) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Raid item giveaways can only be created in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can use this giveaway panel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.showModal(buildRaidItemGiveawayModal()).catch(async () => {
            await interaction.reply({ content: "Unable to open the raid item giveaway modal right now.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${GIVEAWAY_IDS.enterPrefix}:`)) {
        const giveawayId = Number.parseInt(interaction.customId.split(":")[1] || "0", 10);
        const giveaway = getGiveawayById(giveawayId);
        if (!giveaway) {
            await interaction.reply({ content: "This giveaway no longer exists.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (giveaway.status !== "active" || giveaway.endAt <= Date.now()) {
            if (giveaway.status === "active" && giveaway.endAt <= Date.now()) {
                await finalizeGiveaway(giveaway, "timer");
            }
            await interaction.reply({ content: "This giveaway is already closed.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (!interaction.guild) {
            await interaction.reply({ content: "Giveaways can only be entered in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (giveaway.roleRequiredId) {
            const member = interaction.member as GuildMember | null ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member?.roles.cache.has(giveaway.roleRequiredId)) {
                await interaction.reply({ content: `You need <@&${giveaway.roleRequiredId}> to enter this giveaway.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
                return true;
            }
        }
        if (giveaway.entries.includes(interaction.user.id)) {
            await interaction.reply({ content: `You are already entered in giveaway #${giveaway.id}.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        giveaway.entries.push(interaction.user.id);
        giveaway.updatedAt = Date.now();
        saveGiveawayStore();
        await syncGiveawayMessage(giveaway);
        appendAuditEvent("giveaway_enter", {
            guildId: giveaway.guildId,
            giveawayId: giveaway.id,
            userId: interaction.user.id,
            entryCount: giveaway.entries.length
        });
        await interaction.reply({ content: `You entered giveaway #${giveaway.id} for **${giveaway.prize}**.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.close) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const tracked = await ensureTrackedTicketByChannelId(guild, interaction.channel.id, interaction.user.id);
        if (!tracked) {
            await interaction.reply({ content: "This channel is not a tracked ticket and could not be imported.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const ticket = findOpenTicketByChannel(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({ content: "This is not an open ticket.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only admins or the handler role can archive tickets.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const msg = await closeTicketChannel(guild, interaction.channel.id, interaction.user.id, "Archived by support panel action");
        const archived = findArchivedTicketByChannel(interaction.channel.id);
        if (archived) {
            await interaction.reply({
                embeds: [buildTicketCommandEmbed(
                    "🔒 Ticket Archived",
                    "Ticket moved to archive hold queue from panel action.",
                    archived,
                    [
                        { name: "Archived By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Reason", value: "Archived by support panel action", inline: false },
                        { name: "Next Step", value: "Use resolve button or `/resolveticket` when fully complete." }
                    ]
                )],
                flags: MessageFlags.Ephemeral
            }).catch(() => undefined);
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.claim) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only admins or the handler role can claim tickets.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const msg = await claimTicketChannel(guild, interaction.channel.id, interaction.user.id);
        const claimed = findTicketByChannel(interaction.channel.id);
        if (claimed && msg.toLowerCase().includes("claimed")) {
            await interaction.reply({
                embeds: [buildTicketCommandEmbed(
                    "🛠️ Ticket Claimed",
                    "Claim succeeded and panel values were updated live.",
                    claimed,
                    [
                        { name: "Claimed By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Result", value: msg, inline: false },
                        { name: "Next Step", value: "Assign handler (`/ticketassign`) or update workflow (`/ticketstatus`)." }
                    ]
                )],
                flags: MessageFlags.Ephemeral
            }).catch(() => undefined);
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.resolve) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const tracked = await ensureTrackedTicketByChannelId(guild, interaction.channel.id, interaction.user.id);
        if (!tracked) {
            await interaction.reply({ content: "This channel is not a tracked ticket and could not be imported.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const ticket = findArchivedTicketByChannel(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({ content: "This ticket must be archived before it can be permanently resolved.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only admins or the handler role can permanently resolve tickets.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const msg = await resolveTicketChannel(guild, interaction.channel.id, interaction.user.id, "Resolved by support panel action");
        const resolved = findTicketByChannel(interaction.channel.id);
        if (resolved && normalizeTicketStatus(resolved.status) === "resolved") {
            await interaction.reply({
                embeds: [buildTicketCommandEmbed(
                    "✅ Ticket Resolved Permanently",
                    "Ticket was resolved and closed out from panel action.",
                    resolved,
                    [
                        { name: "Resolved By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Resolution", value: "Resolved by support panel action", inline: false },
                        { name: "Transcript", value: resolved.transcript ? "Captured in ticket metadata/logs." : "No transcript snapshot available." }
                    ]
                )],
                flags: MessageFlags.Ephemeral
            }).catch(() => undefined);
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return true;
    }
    return false;
}
