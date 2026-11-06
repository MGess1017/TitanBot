// Ticket permission checks and assignment.
import { ChannelType, ChatInputCommandInteraction, GuildMember, PermissionFlagsBits, type APIInteractionGuildMember } from "discord.js";
import { TICKET_HANDLER_ROLE_ID } from "../core/config";
import { rejectIfDuplicateCommand } from "../core/ops";
import { appendAuditEvent } from "../core/audit";
import { assignTicketToUser, ensureTrackedTicketByChannelId, sendTicketLog } from "./records";
import { buildTicketCommandEmbedPayload, updateTicketOpsPanelMessage } from "./opsPanel";
import { requireGuild } from "../core/guards";
import { ticketActions } from "../../services/ticketExperience";

export function canManageTicketActions(member: GuildMember | APIInteractionGuildMember): boolean {
    const administrator = typeof member.permissions === "string"
        ? (BigInt(member.permissions) & PermissionFlagsBits.Administrator) !== 0n
        : member.permissions.has(PermissionFlagsBits.Administrator);
    return administrator || (Array.isArray(member.roles)
        ? member.roles.includes(TICKET_HANDLER_ROLE_ID) : member.roles.cache.has(TICKET_HANDLER_ROLE_ID));
}

export function resolveTicketTargetChannelId(interaction: ChatInputCommandInteraction): { channelId: string | null; error: string | null } {
    const selectedChannel = interaction.options.getChannel("ticket_channel");
    const typedChannelId = (interaction.options.getString("ticket_channel_id") || "").trim();

    if (typedChannelId && !/^\d{17,21}$/.test(typedChannelId)) {
        return { channelId: null, error: "ticket_channel_id must be a valid Discord channel ID." };
    }

    const channelId = typedChannelId || selectedChannel?.id || interaction.channelId || null;
    if (!channelId) {
        return { channelId: null, error: "This command must be used in a ticket channel or include ticket_channel/ticket_channel_id." };
    }

    return { channelId, error: null };
}

export async function handleTicketAssignCommand(interaction: ChatInputCommandInteraction, usedAlias = false): Promise<string> {
    const target = resolveTicketTargetChannelId(interaction);
    if (!target.channelId || target.error) return target.error || "Choose a ticket channel.";
    return ticketActions.run(target.channelId, () => performTicketAssignCommand(interaction, usedAlias));
}

async function performTicketAssignCommand(interaction: ChatInputCommandInteraction, usedAlias = false): Promise<string> {
    const guildError = requireGuild(interaction);
    if (guildError) return guildError;

    const member = interaction.member as GuildMember | null;
    if (!member || !canManageTicketActions(member)) {
        return "Only admins or the handler role can assign tickets.";
    }

    const target = resolveTicketTargetChannelId(interaction);
    if (target.error || !target.channelId) {
        return target.error || "Unable to resolve the target ticket channel.";
    }

    const ticket = await ensureTrackedTicketByChannelId(interaction.guild!, target.channelId, interaction.user.id);
    if (!ticket) {
        return "This channel is not a tracked ticket. Use ticket_channel or ticket_channel_id. If needed, run /tickets to list active tracked channels.";
    }

    const assignee = interaction.options.getUser("user", true);
    const assignDedupeError = rejectIfDuplicateCommand(interaction, `ticketassign:${target.channelId}:assignee:${assignee.id}`);
    if (assignDedupeError) return assignDedupeError;
    const assigneeMember = interaction.guild ? await interaction.guild.members.fetch(assignee.id).catch(() => null) : null;
    if (!assigneeMember) return "Unable to find that member in this server.";
    if (!canManageTicketActions(assigneeMember) && !assigneeMember.permissions.has(PermissionFlagsBits.Administrator)) {
        return "Assignee must be an admin or have the ticket handler role.";
    }

    const assigned = assignTicketToUser(target.channelId, assignee.id, true);
    if (!assigned) return "Unable to assign this ticket right now.";
    await updateTicketOpsPanelMessage(interaction.guild!, assigned);

    const assignChannel = interaction.guild
        ? (interaction.guild.channels.cache.get(target.channelId) || await interaction.guild.channels.fetch(target.channelId).catch(() => null))
        : null;
    if (assignChannel && assignChannel.type === ChannelType.GuildText) {
        await assignChannel.send({
            content: `<@${assignee.id}> you have been assigned to Ticket #${assigned.id}.`,
            allowedMentions: { parse: ["users"] }
        }).catch(() => undefined);
    }

    await sendTicketLog(interaction.guildId!, `Ticket #${assigned.id} Assigned`, [
        { name: "Assigned By", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Assigned To", value: `<@${assignee.id}>`, inline: true },
        { name: "Channel", value: `<#${assigned.channelId}>`, inline: true },
        { name: "Workflow Status", value: assigned.workflowStatus, inline: true }
    ]);
    appendAuditEvent("ticket_assign", {
        guildId: interaction.guildId,
        ticketId: assigned.id,
        assignedById: interaction.user.id,
        assignedToId: assignee.id,
        channelId: assigned.channelId,
        ...(usedAlias ? { usedAlias: true } : {})
    });

    return buildTicketCommandEmbedPayload(
        "🎫 Ticket Assignment Updated",
        `Ticket assignment has been updated and the assignee has been tagged in channel.`,
        assigned,
        [
            { name: "Assigned By", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Assigned To", value: `<@${assignee.id}>`, inline: true },
            { name: "Alias Used", value: usedAlias ? "Yes (`/ticketassgin`)" : "No (`/ticketassign`)", inline: true },
            { name: "Next Step", value: "Use `/ticketstatus` to move workflow to `responded`, `waiting_user`, or `escalated`." }
        ]
    );
}
