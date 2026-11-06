// Interaction handlers: ticket, report, and giveaway buttons.
import { GuildMember, MessageFlags, PermissionFlagsBits, type Interaction } from "discord.js";
import { finalizeGiveaway, getGiveawayById, saveGiveawayStore, syncGiveawayMessage } from "../giveaways/giveaways";
import { appendAuditEvent } from "../core/audit";
import {
    addTicketWatcher, findArchivedTicketByChannel, findOpenTicketByChannel, findTicketByChannel,
    recordTicketEvent, TICKET_RESPONSE_TEMPLATES, TICKET_TEMPLATE_IDS
} from "../tickets/store";
import { buildAdminReportIntakeModal, buildRaidItemGiveawayModal, buildTicketIntakeModal } from "../ui/modals";
import { ensureTrackedTicketByChannelId } from "../tickets/records";
import { buildTicketStaffComponents, buildTicketStaffEmbed } from "../tickets/opsPanel";
import { canManageTicketActions } from "../tickets/actions";
import { GIVEAWAY_IDS, REPORT_IDS, TICKET_IDS } from "../ui/ids";
import { claimTicketChannel, closeTicketChannel, resolveTicketChannel } from "../tickets/channels";

/** Ticket, report, and giveaway panel buttons. */
export async function handleTicketButtonInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isButton() && interaction.customId === TICKET_IDS.tools) {
        const member = interaction.member as GuildMember | null;
        if (!interaction.guild || !member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "These tools are for support staff only.", flags: MessageFlags.Ephemeral });
            return true;
        }
        const ticket = interaction.channelId ? findTicketByChannel(interaction.channelId) : null;
        if (!ticket || ticket.guildId !== interaction.guild.id) {
            await interaction.reply({ content: "This ticket is no longer tracked.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.reply({
            embeds: [buildTicketStaffEmbed(ticket)],
            components: buildTicketStaffComponents(ticket),
            allowedMentions: { parse: [] },
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

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
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only support staff can close tickets.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tracked = await ensureTrackedTicketByChannelId(guild, interaction.channel.id, interaction.user.id);
        if (!tracked) {
            await interaction.editReply({ content: "This channel is not a tracked ticket and could not be imported." });
            return true;
        }
        const ticket = findOpenTicketByChannel(interaction.channel.id);
        if (!ticket) {
            await interaction.editReply({ content: "This ticket is already closed." });
            return true;
        }

        const msg = await closeTicketChannel(guild, interaction.channel.id, interaction.user.id, "Archived by support panel action");
        const archived = findArchivedTicketByChannel(interaction.channel.id);
        await interaction.editReply({
            content: archived ? `Ticket #${archived.id} closed. Staff can reopen it or finish it from Staff Tools.` : msg,
            allowedMentions: { parse: [] }
        });
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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const msg = await claimTicketChannel(guild, interaction.channel.id, interaction.user.id);
        await interaction.editReply({ content: msg, allowedMentions: { parse: [] } });
        return true;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.resolve) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only support staff can permanently resolve tickets.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tracked = await ensureTrackedTicketByChannelId(guild, interaction.channel.id, interaction.user.id);
        if (!tracked) {
            await interaction.editReply({ content: "This channel is not a tracked ticket and could not be imported." });
            return true;
        }
        const ticket = findArchivedTicketByChannel(interaction.channel.id);
        if (!ticket) {
            await interaction.editReply({ content: "Close this ticket before permanently resolving it." });
            return true;
        }

        const msg = await resolveTicketChannel(guild, interaction.channel.id, interaction.user.id, "Resolved by support panel action");
        await interaction.editReply({ content: msg, allowedMentions: { parse: [] } });
        return true;
    }
    return false;
}
