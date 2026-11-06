"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canManageTicketActions = canManageTicketActions;
exports.resolveTicketTargetChannelId = resolveTicketTargetChannelId;
exports.handleTicketAssignCommand = handleTicketAssignCommand;
// Ticket permission checks and assignment.
const discord_js_1 = require("discord.js");
const config_1 = require("../core/config");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const records_1 = require("./records");
const opsPanel_1 = require("./opsPanel");
const guards_1 = require("../core/guards");
const ticketExperience_1 = require("../../services/ticketExperience");
function canManageTicketActions(member) {
    const administrator = typeof member.permissions === "string"
        ? (BigInt(member.permissions) & discord_js_1.PermissionFlagsBits.Administrator) !== 0n
        : member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator);
    return administrator || (Array.isArray(member.roles)
        ? member.roles.includes(config_1.TICKET_HANDLER_ROLE_ID) : member.roles.cache.has(config_1.TICKET_HANDLER_ROLE_ID));
}
function resolveTicketTargetChannelId(interaction) {
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
async function handleTicketAssignCommand(interaction, usedAlias = false) {
    const target = resolveTicketTargetChannelId(interaction);
    if (!target.channelId || target.error)
        return target.error || "Choose a ticket channel.";
    return ticketExperience_1.ticketActions.run(target.channelId, () => performTicketAssignCommand(interaction, usedAlias));
}
async function performTicketAssignCommand(interaction, usedAlias = false) {
    const guildError = (0, guards_1.requireGuild)(interaction);
    if (guildError)
        return guildError;
    const member = interaction.member;
    if (!member || !canManageTicketActions(member)) {
        return "Only admins or the handler role can assign tickets.";
    }
    const target = resolveTicketTargetChannelId(interaction);
    if (target.error || !target.channelId) {
        return target.error || "Unable to resolve the target ticket channel.";
    }
    const ticket = await (0, records_1.ensureTrackedTicketByChannelId)(interaction.guild, target.channelId, interaction.user.id);
    if (!ticket) {
        return "This channel is not a tracked ticket. Use ticket_channel or ticket_channel_id. If needed, run /tickets to list active tracked channels.";
    }
    const assignee = interaction.options.getUser("user", true);
    const assignDedupeError = (0, ops_1.rejectIfDuplicateCommand)(interaction, `ticketassign:${target.channelId}:assignee:${assignee.id}`);
    if (assignDedupeError)
        return assignDedupeError;
    const assigneeMember = interaction.guild ? await interaction.guild.members.fetch(assignee.id).catch(() => null) : null;
    if (!assigneeMember)
        return "Unable to find that member in this server.";
    if (!canManageTicketActions(assigneeMember) && !assigneeMember.permissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
        return "Assignee must be an admin or have the ticket handler role.";
    }
    const assigned = (0, records_1.assignTicketToUser)(target.channelId, assignee.id, true);
    if (!assigned)
        return "Unable to assign this ticket right now.";
    await (0, opsPanel_1.updateTicketOpsPanelMessage)(interaction.guild, assigned);
    const assignChannel = interaction.guild
        ? (interaction.guild.channels.cache.get(target.channelId) || await interaction.guild.channels.fetch(target.channelId).catch(() => null))
        : null;
    if (assignChannel && assignChannel.type === discord_js_1.ChannelType.GuildText) {
        await assignChannel.send({
            content: `<@${assignee.id}> you have been assigned to Ticket #${assigned.id}.`,
            allowedMentions: { parse: ["users"] }
        }).catch(() => undefined);
    }
    await (0, records_1.sendTicketLog)(interaction.guildId, `Ticket #${assigned.id} Assigned`, [
        { name: "Assigned By", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Assigned To", value: `<@${assignee.id}>`, inline: true },
        { name: "Channel", value: `<#${assigned.channelId}>`, inline: true },
        { name: "Workflow Status", value: assigned.workflowStatus, inline: true }
    ]);
    (0, audit_1.appendAuditEvent)("ticket_assign", {
        guildId: interaction.guildId,
        ticketId: assigned.id,
        assignedById: interaction.user.id,
        assignedToId: assignee.id,
        channelId: assigned.channelId,
        ...(usedAlias ? { usedAlias: true } : {})
    });
    return (0, opsPanel_1.buildTicketCommandEmbedPayload)("🎫 Ticket Assignment Updated", `Ticket assignment has been updated and the assignee has been tagged in channel.`, assigned, [
        { name: "Assigned By", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Assigned To", value: `<@${assignee.id}>`, inline: true },
        { name: "Alias Used", value: usedAlias ? "Yes (`/ticketassgin`)" : "No (`/ticketassign`)", inline: true },
        { name: "Next Step", value: "Use `/ticketstatus` to move workflow to `responded`, `waiting_user`, or `escalated`." }
    ]);
}
