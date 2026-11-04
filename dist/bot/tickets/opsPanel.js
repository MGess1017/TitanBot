"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketCommandEmbed = buildTicketCommandEmbed;
exports.buildTicketCommandEmbedPayload = buildTicketCommandEmbedPayload;
exports.getTicketNextActionHint = getTicketNextActionHint;
exports.buildTicketOpsEmbed = buildTicketOpsEmbed;
exports.updateTicketOpsPanelMessage = updateTicketOpsPanelMessage;
// Ticket command embeds and the ticket ops panel.
const discord_js_1 = require("discord.js");
const ticketEnhancements_1 = require("../../services/ticketEnhancements");
const client_1 = require("../core/client");
const store_1 = require("./store");
const records_1 = require("./records");
const embeds_1 = require("../ui/embeds");
function buildTicketCommandEmbed(title, description, ticket, fields = []) {
    const statusEmoji = {
        open: "🟢",
        claimed: "🛠️",
        archived: "🗂️",
        resolved: "✅"
    };
    const workflowEmoji = {
        new: "🆕",
        responded: "💬",
        waiting_user: "⏳",
        escalated: "🚨",
        resolved: "✅"
    };
    const priorityEmoji = {
        low: "🟦",
        normal: "🟨",
        high: "🟥"
    };
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x14b8a6)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp(new Date());
    if (ticket) {
        embed.addFields({ name: "🎫 Ticket", value: `#${ticket.id}`, inline: true }, { name: "📍 Channel", value: `<#${ticket.channelId}>`, inline: true }, { name: "👤 Owner", value: `<@${ticket.ownerId}>`, inline: true }, { name: "📌 State", value: `${statusEmoji[ticket.status]} ${ticket.status.toUpperCase()}`, inline: true }, { name: "🧭 Workflow", value: `${workflowEmoji[ticket.workflowStatus]} ${ticket.workflowStatus}`, inline: true }, { name: "⚡ Priority", value: `${priorityEmoji[ticket.priority]} ${ticket.priority.toUpperCase()}`, inline: true });
    }
    if (fields.length) {
        embed.addFields(fields);
    }
    return (0, embeds_1.sanitizeEmbedBuilder)(embed);
}
function buildTicketCommandEmbedPayload(title, description, ticket, fields = []) {
    return JSON.stringify({ embed: buildTicketCommandEmbed(title, description, ticket, fields).toJSON() });
}
function getTicketNextActionHint(ticket) {
    const status = (0, store_1.normalizeTicketStatus)(ticket.status);
    if (status === "open")
        return "Claim or assign the ticket to start handling.";
    if (status === "claimed" && !ticket.assignedToId)
        return "Assign a handler, then update workflow as you respond.";
    if (status === "claimed" && ticket.workflowStatus === "waiting_user")
        return "Waiting on user response. Archive when pending follow-up.";
    if (status === "archived")
        return "Review archive notes, then permanently resolve when complete.";
    if (status === "resolved")
        return "Ticket is complete. Reopen flow is not enabled.";
    return "Update workflow as the case progresses.";
}
function buildTicketOpsEmbed(ticket) {
    const policy = ticket.slaPolicy || (0, ticketEnhancements_1.getTicketSlaPolicy)(ticket.category || "general", ticket.priority);
    const sla = (0, records_1.getTicketSlaState)(ticket, Date.now(), {
        firstResponseWarnMs: Math.max(60000, Math.floor(policy.firstResponseMs * 0.66)),
        firstResponseBreachMs: policy.firstResponseMs,
        resolveWarnMs: Math.max(policy.firstResponseMs, Math.floor(policy.resolveMs * 0.84)),
        resolveBreachMs: policy.resolveMs
    });
    const firstResponseStatus = ticket.firstResponseAt
        ? `Met <t:${Math.floor(ticket.firstResponseAt / 1000)}:R>`
        : (sla.firstResponseOverdue ? "BREACHED" : "Pending");
    const resolveStatus = ticket.resolvedAt
        ? `Resolved <t:${Math.floor(ticket.resolvedAt / 1000)}:R>`
        : (sla.resolveOverdue ? "BREACHED" : "On Track");
    const status = (0, store_1.normalizeTicketStatus)(ticket.status);
    const nextAction = getTicketNextActionHint(ticket);
    const intake = (0, ticketEnhancements_1.hydrateTicketIntakeFields)(ticket.reason, {
        category: ticket.intakeCategory,
        summary: ticket.intakeSummary,
        details: ticket.intakeDetails,
        platform: ticket.intakePlatform,
        orderId: ticket.intakeOrderId,
        evidence: ticket.intakeEvidence
    });
    const intakeSummary = intake.summary || "General support";
    const intakeCategory = intake.category || String(ticket.category || "general");
    const intakeDetails = intake.details || "No details provided.";
    const intakePlatform = intake.platform || "Not provided";
    const intakeEvidence = intake.evidence || "No evidence provided";
    const statusLabel = `${status === "open" ? "🟢" : status === "claimed" ? "🛠️" : status === "archived" ? "🗂️" : "✅"} ${status.toUpperCase()}`;
    const workflowLabel = `${ticket.workflowStatus === "new" ? "🆕" : ticket.workflowStatus === "responded" ? "💬" : ticket.workflowStatus === "waiting_user" ? "⏳" : ticket.workflowStatus === "escalated" ? "🚨" : "✅"} ${ticket.workflowStatus}`;
    const priorityLabel = `${ticket.priority === "low" ? "🟦" : ticket.priority === "normal" ? "🟨" : "🟥"} ${ticket.priority.toUpperCase()}`;
    const intakeSnapshot = [
        `Summary: ${intakeSummary.slice(0, 200)}`,
        `Details: ${intakeDetails.slice(0, 450)}`,
        `Platform / Order: ${intakePlatform === "Not provided" ? "Not provided" : intakePlatform.slice(0, 200)}`,
        `Evidence: ${intakeEvidence.slice(0, 450)}`
    ].join("\n");
    return (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x14b8a6)
        .setTitle(`🏛️ FN Support • Case #${ticket.id} Command Deck`)
        .setDescription("Premium live operations panel for this case.\nStatus, assignment, workflow, and SLA indicators refresh automatically as handlers progress resolution.")
        .addFields({ name: "👤 Requester", value: `<@${ticket.ownerId}>`, inline: true }, { name: "🕒 Opened At", value: `<t:${Math.floor(ticket.createdAt / 1000)}:f>`, inline: true }, { name: "📍 Ticket Thread", value: `<#${ticket.channelId}>`, inline: true }, { name: "⚡ Priority Tier", value: priorityLabel, inline: true }, { name: "🏷️ Submitted Category", value: intakeCategory, inline: true }, { name: "🧭 Workflow Lane", value: workflowLabel, inline: true }, { name: "🛠️ Claim Lead", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "Not claimed yet", inline: true }, { name: "🎯 Assigned Specialist", value: ticket.assignedToId ? `<@${ticket.assignedToId}>` : "Unassigned", inline: true }, { name: "📌 Lifecycle", value: statusLabel, inline: true }, { name: "📥 Intake Snapshot", value: intakeSnapshot, inline: false }, { name: "⏱️ SLA Clock", value: `• Policy: ${policy.name}\n• First response target: ${Math.round(policy.firstResponseMs / 60000)}m (${firstResponseStatus})\n• Resolution target: ${Math.round(policy.resolveMs / 3600000)}h (${resolveStatus})`, inline: false }, { name: "🧬 Case Graph", value: `Parent: ${ticket.parentTicketId ? `#${ticket.parentTicketId}` : "none"} | Linked: ${ticket.linkedTicketId ? `#${ticket.linkedTicketId}` : "none"} | Merged Into: ${ticket.mergedIntoTicketId ? `#${ticket.mergedIntoTicketId}` : "none"}`, inline: false }, { name: "➡️ Recommended Move", value: nextAction, inline: false }, { name: "🧰 Command Strip", value: "`/claimticket` ` /ticketassign` ` /ticketstatus` ` /reopenticket` ` /closeticket` ` /resolveticket`", inline: false })
        .setFooter({ text: `FN Support Tickets • Case #${ticket.id} • Live sync` }), "FN Support Command Deck", "Live case operations");
}
async function updateTicketOpsPanelMessage(guild, ticket) {
    const channel = (guild.channels.cache.get(ticket.channelId)
        || await guild.channels.fetch(ticket.channelId).catch(() => null));
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
        return;
    let panelMessageId = ticket.panelMessageId;
    if (!panelMessageId) {
        const legacyPrefix = `Ticket #${ticket.id} · Operations Desk`;
        const premiumPrefix = `🏛️ FN Support • Case #${ticket.id} Command Deck`;
        let candidateId = null;
        let beforeId;
        // Look through deeper history so legacy tickets still get live panel updates.
        for (let i = 0; i < 5; i++) {
            const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
            if (!batch || !batch.size)
                break;
            const candidate = batch.find(message => message.author.id === (client_1.client.user?.id || "")
                && (message.embeds[0]?.title?.startsWith(legacyPrefix)
                    || message.embeds[0]?.title?.startsWith(premiumPrefix)));
            if (candidate) {
                candidateId = candidate.id;
                break;
            }
            const last = batch.last();
            beforeId = last?.id;
            if (!beforeId)
                break;
        }
        if (candidateId) {
            (0, records_1.setTicketPanelMessageId)(ticket.channelId, candidateId);
            panelMessageId = candidateId;
        }
    }
    if (!panelMessageId)
        return;
    const panelMessage = await channel.messages.fetch(panelMessageId).catch(() => null);
    if (!panelMessage)
        return;
    await panelMessage.edit({ embeds: [buildTicketOpsEmbed(ticket)], components: panelMessage.components }).catch(() => undefined);
}
