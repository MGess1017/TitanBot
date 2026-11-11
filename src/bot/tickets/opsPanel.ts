// Ticket command embeds and the ticket ops panel.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, DiscordAPIError, EmbedBuilder, Guild } from "discord.js";
import { getTicketSlaPolicy, hydrateTicketIntakeFields } from "../../services/ticketEnhancements";
import { client } from "../core/client";
import { normalizeTicketStatus, TICKET_TEMPLATE_IDS, ticketStore, type TicketEntry, type TicketPriority, type TicketWorkflowStatus } from "./store";
import { getTicketSlaState, setTicketPanelMessageId } from "./records";
import { sanitizeEmbedBuilder } from "../ui/embeds";
import { TICKET_IDS } from "../ui/ids";
import { STAFF_IDS } from "../../features/staffHub";
import { ticketDisplayStatus } from "../../services/ticketExperience";
import { buildHandlerSelector } from "./experience";

export function buildTicketCommandEmbed(
    title: string,
    description: string,
    ticket?: TicketEntry,
    fields: Array<{ name: string; value: string; inline?: boolean }> = []
): EmbedBuilder {
    const statusEmoji: Record<TicketEntry["status"], string> = {
        open: "🟢",
        claimed: "🛠️",
        archived: "🗂️",
        resolved: "✅"
    };
    const workflowEmoji: Record<TicketWorkflowStatus, string> = {
        new: "🆕",
        responded: "💬",
        waiting_user: "⏳",
        escalated: "🚨",
        resolved: "✅"
    };
    const priorityEmoji: Record<TicketPriority, string> = {
        low: "🟦",
        normal: "🟨",
        high: "🟥"
    };

    const embed = new EmbedBuilder()
        .setColor(0x14b8a6)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp(new Date());

    if (ticket) {
        embed.addFields(
            { name: "🎫 Ticket", value: `#${ticket.id}`, inline: true },
            { name: "📍 Channel", value: `<#${ticket.channelId}>`, inline: true },
            { name: "👤 Owner", value: `<@${ticket.ownerId}>`, inline: true },
            { name: "📌 State", value: `${statusEmoji[ticket.status]} ${ticket.status.toUpperCase()}`, inline: true },
            { name: "🧭 Workflow", value: `${workflowEmoji[ticket.workflowStatus]} ${ticket.workflowStatus}`, inline: true },
            { name: "⚡ Priority", value: `${priorityEmoji[ticket.priority]} ${ticket.priority.toUpperCase()}`, inline: true }
        );
    }

    if (fields.length) {
        embed.addFields(fields);
    }

    return sanitizeEmbedBuilder(embed);
}

export function buildTicketCommandEmbedPayload(
    title: string,
    description: string,
    ticket?: TicketEntry,
    fields: Array<{ name: string; value: string; inline?: boolean }> = []
): string {
    return JSON.stringify({ embed: buildTicketCommandEmbed(title, description, ticket, fields).toJSON() });
}

export function getTicketNextActionHint(ticket: TicketEntry): string {
    const status = normalizeTicketStatus(ticket.status);
    if (status === "open") return "Claim or assign the ticket to start handling.";
    if (status === "claimed" && !ticket.assignedToId) return "Assign a handler, then update workflow as you respond.";
    if (status === "claimed" && ticket.workflowStatus === "waiting_user") return "Waiting on user response. Archive when pending follow-up.";
    if (status === "archived") return "Review archive notes, then permanently resolve when complete.";
    if (status === "resolved") return "Ticket is complete. Reopen flow is not enabled.";
    return "Update workflow as the case progresses.";
}

export function buildTicketOpsEmbed(ticket: TicketEntry): EmbedBuilder {
    const status = normalizeTicketStatus(ticket.status);
    const statusLabel = ticketDisplayStatus(ticket);
    const intake = hydrateTicketIntakeFields(ticket.reason, {
        summary: ticket.intakeSummary,
        details: ticket.intakeDetails,
        platform: ticket.intakePlatform,
        orderId: ticket.intakeOrderId,
        evidence: ticket.intakeEvidence
    });
    const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(ticket.category === "store" ? `FNTCORD | Store Request #${ticket.id}` : `Support Ticket #${ticket.id}`)
        .setDescription(intake.summary.slice(0, 120))
        .addFields(
            { name: "Member", value: `<@${ticket.ownerId}>`, inline: true },
            { name: "Status", value: statusLabel, inline: true },
            { name: "Handler", value: ticket.assignedToId || ticket.claimedById
                ? `<@${ticket.assignedToId || ticket.claimedById}>` : "Not assigned yet", inline: true },
            { name: "Your request", value: intake.details.slice(0, 700) }
        );
    const reference = [
        intake.platform !== "Not provided" ? intake.platform : "",
        intake.orderId
    ].filter(Boolean).join(" • ");
    if (reference) embed.addFields({ name: "Reference", value: reference.slice(0, 300) });
    if (intake.evidence !== "No evidence provided") {
        embed.addFields({ name: "Attachments / links", value: intake.evidence.slice(0, 450) });
    }
    embed.setFooter({ text: status === "archived" || status === "resolved"
        ? "This ticket is closed. Contact staff if you need it reviewed."
        : ticket.category === "store" ? "Catalog inquiry only. No payment taken. Full request snapshot is attached to the opening message."
            : "Reply here to continue. You can add screenshots or files." });
    return sanitizeEmbedBuilder(embed);
}

export function buildTicketOpsComponents(ticket: TicketEntry): ActionRowBuilder<ButtonBuilder>[] {
    const status = normalizeTicketStatus(ticket.status);
    const closed = status === "archived" || status === "resolved";
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (!closed) {
        row.addComponents(
            new ButtonBuilder().setCustomId(TICKET_IDS.claim)
                .setLabel(ticket.claimedById ? "Claimed" : "Claim Ticket")
                .setStyle(ButtonStyle.Primary).setDisabled(Boolean(ticket.claimedById)),
            new ButtonBuilder().setCustomId(TICKET_IDS.close).setLabel("Close Ticket").setStyle(ButtonStyle.Secondary)
        );
        row.addComponents(new ButtonBuilder().setCustomId(TICKET_IDS.requestClose)
            .setLabel(ticket.closureRequestedAt ? "Closure Requested" : "Request Closure")
            .setDisabled(Boolean(ticket.closureRequestedAt)).setStyle(ButtonStyle.Secondary));
    }
    row.addComponents(new ButtonBuilder().setCustomId(TICKET_IDS.tools)
        .setLabel("Staff Tools").setStyle(ButtonStyle.Secondary));
    return [row];
}

export function buildTicketStaffComponents(ticket: TicketEntry) {
    const status = normalizeTicketStatus(ticket.status);
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(TICKET_IDS.resolve).setLabel("Resolve Permanently")
                .setStyle(ButtonStyle.Danger).setDisabled(status !== "archived"),
            new ButtonBuilder().setCustomId(TICKET_IDS.watch).setLabel("Watch Ticket").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(TICKET_IDS.requestInfo).setLabel("Request Information").setStyle(ButtonStyle.Secondary).setDisabled(status === "archived" || status === "resolved"),
            new ButtonBuilder().setCustomId(STAFF_IDS.home).setLabel("Case History & Checklist").setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(TICKET_TEMPLATE_IDS.ack).setLabel("Acknowledgement").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(TICKET_TEMPLATE_IDS.evidence).setLabel("Request Evidence").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(TICKET_TEMPLATE_IDS.resolved).setLabel("Resolution Reply").setStyle(ButtonStyle.Secondary)
        ),
        buildHandlerSelector()
    ];
}

export function buildTicketStaffEmbed(ticket: TicketEntry): EmbedBuilder {
    const policy = ticket.slaPolicy || getTicketSlaPolicy(ticket.category || "general", ticket.priority);
    const sla = getTicketSlaState(ticket, Date.now(), {
        firstResponseWarnMs: Math.max(60_000, Math.floor(policy.firstResponseMs * 0.66)),
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
    const status = normalizeTicketStatus(ticket.status);
    const nextAction = getTicketNextActionHint(ticket);
    const intake = hydrateTicketIntakeFields(ticket.reason, {
        category: ticket.intakeCategory,
        summary: ticket.intakeSummary,
        details: ticket.intakeDetails,
        platform: ticket.intakePlatform,
        orderId: ticket.intakeOrderId,
        evidence: ticket.intakeEvidence
    });
    const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`Staff • Ticket #${ticket.id}`)
        .setDescription("• `/ticketassign` — change handler\n• `/ticketstatus` — update status\n• `/reopenticket` — reopen a closed case\n• Close the ticket before permanently resolving it.")
        .addFields(
            { name: "Priority", value: ticket.priority, inline: true },
            { name: "Topic", value: intake.category.slice(0, 40), inline: true },
            { name: "State", value: `${status} • ${ticket.workflowStatus}`, inline: true },
            { name: "SLA Clock", value: `First reply: ${Math.round(policy.firstResponseMs / 60000)}m • ${firstResponseStatus}\nResolution: ${Math.round(policy.resolveMs / 3600000)}h • ${resolveStatus}` },
            { name: "Next step", value: nextAction }
        );
    const links = [
        ticket.parentTicketId ? `Parent: #${ticket.parentTicketId}` : "",
        ticket.linkedTicketId ? `Linked: #${ticket.linkedTicketId}` : "",
        ticket.mergedIntoTicketId ? `Merged into: #${ticket.mergedIntoTicketId}` : ""
    ].filter(Boolean);
    if (links.length) embed.addFields({ name: "Related cases", value: links.join(" • ") });
    if (ticket.claimedById && ticket.claimedById !== ticket.assignedToId) {
        embed.addFields({ name: "Claimed by", value: `<@${ticket.claimedById}>` });
    }
    return sanitizeEmbedBuilder(embed);
}

export const ticketPanelSignatures = new Map<string, string>();
export const ticketPanelCheckedAt = new Map<string, number>();
export const ticketPanelUpdates = new Map<string, Promise<void>>();

export async function updateTicketOpsPanelMessage(guild: Guild, ticket: TicketEntry): Promise<void> {
    const previous = ticketPanelUpdates.get(ticket.channelId);
    const pending = (previous || Promise.resolve()).catch(error => {
        console.error(`Previous panel update failed for ticket #${ticket.id}:`, error);
    }).then(() => performTicketPanelUpdate(guild, ticket));
    ticketPanelUpdates.set(ticket.channelId, pending);
    try { await pending; }
    finally { if (ticketPanelUpdates.get(ticket.channelId) === pending) ticketPanelUpdates.delete(ticket.channelId); }
}

async function performTicketPanelUpdate(guild: Guild, ticket: TicketEntry): Promise<void> {
    const embeds = [buildTicketOpsEmbed(ticket)];
    const components = buildTicketOpsComponents(ticket);
    const savedPanelId = ticket.panelMessageId;
    const signature = JSON.stringify({ messageId: ticket.panelMessageId, embeds: embeds.map(embed => embed.toJSON()), components: components.map(row => row.toJSON()) });
    const unchanged = ticket.panelMessageId && ticketPanelSignatures.get(ticket.channelId) === signature;
    if (unchanged && Date.now() - (ticketPanelCheckedAt.get(ticket.channelId) || 0) < 5 * 60_000) return;
    const channel = (guild.channels.cache.get(ticket.channelId)
        || await guild.channels.fetch(ticket.channelId));
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`Ticket #${ticket.id} channel is missing or not text-based.`);
        return;
    }

    let panelMessageId = ticket.panelMessageId;
    let panelMessage = panelMessageId ? await channel.messages.fetch(panelMessageId).catch(error => {
        if (error instanceof DiscordAPIError && error.code === 10008) return null;
        throw error;
    }) : null;
    if (panelMessage && panelMessage.author.id !== client.user?.id) panelMessage = null;
    if (!panelMessage) panelMessageId = null;
    if (!panelMessageId) {
        const legacyPrefix = `Ticket #${ticket.id} · Operations Desk`;
        const premiumPrefix = `🏛️ FN Support • Case #${ticket.id} Command Deck`;
        let candidateId: string | null = null;
        let beforeId: string | undefined;
        // Look through deeper history so legacy tickets still get live panel updates.
        for (let i = 0; i < 5; i++) {
            const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) });
            if (!batch || !batch.size) break;

            const candidate = batch.find(message =>
                message.author.id === (client.user?.id || "")
                && (
                    message.embeds[0]?.title?.startsWith(legacyPrefix)
                    || message.embeds[0]?.title?.startsWith(premiumPrefix)
                    || message.embeds[0]?.title === `Support Ticket #${ticket.id}`
                )
            );
            if (candidate) {
                candidateId = candidate.id;
                break;
            }

            const last = batch.last();
            beforeId = last?.id;
            if (!beforeId) break;
        }
        if (candidateId) {
            setTicketPanelMessageId(ticket.channelId, candidateId);
            panelMessageId = candidateId;
        }
    }

    if (!panelMessage && panelMessageId) panelMessage = await channel.messages.fetch(panelMessageId);
    if (!panelMessage) {
        panelMessage = await channel.send({ embeds, components, allowedMentions: { parse: [] } });
        setTicketPanelMessageId(ticket.channelId, panelMessage.id);
    } else if (!unchanged || panelMessage.id !== savedPanelId) {
        await panelMessage.edit({ embeds, components, allowedMentions: { parse: [] } });
    }
    ticketPanelCheckedAt.set(ticket.channelId, Date.now());
    ticketPanelSignatures.set(ticket.channelId, JSON.stringify({
        messageId: ticket.panelMessageId, embeds: embeds.map(embed => embed.toJSON()), components: components.map(row => row.toJSON())
    }));
}

export async function refreshTicketPanelsForGuild(guild: Guild): Promise<void> {
    for (const ticket of ticketStore.tickets.filter(ticket =>
        ticket.guildId === guild.id && normalizeTicketStatus(ticket.status) !== "resolved")) {
        try {
            await updateTicketOpsPanelMessage(guild, ticket);
        } catch (error) {
            console.error(`Could not migrate ticket #${ticket.id} panel:`, error);
        }
    }
}
