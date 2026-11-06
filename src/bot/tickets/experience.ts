// Member closure requests, reply tracking, private staff queue, and targeted reminders.
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild, GuildMember,
    Message, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
    UserSelectMenuBuilder, type Interaction, type MessageMentionTypes
} from "discord.js";
import {
    applyTicketReply, isTicketReplyOverdue, isTicketTopic, ticketActions, ticketDisplayStatus,
    ticketNotificationTarget
} from "../../services/ticketExperience";
import { client } from "../core/client";
import { TICKET_IDS } from "../ui/ids";
import { buildTicketIntakeModal } from "../ui/modals";
import { getTicketDraft } from "./drafts";
import { canManageTicketActions } from "./actions";
import { ensureTicketConfig, findTicketByChannel, findTicketById, saveTicketStore, ticketStore, type TicketEntry } from "./store";
import { resolveTicketChannel } from "./channels";
import { updateTicketOpsPanelMessage } from "./opsPanel";
import { postStaffAlert } from "../staff/staffDesk";
import { assignTicketToUser } from "./records";
import { appendAuditEvent } from "../core/audit";

const notifying = new Set<string>();

export async function notifyTicketRecipient(ticket: TicketEntry, kind: "member_reply" | "staff_reply" | "closure" | "reminder", key: string): Promise<boolean> {
    const cfg = ensureTicketConfig(ticket.guildId);
    if (!cfg.notificationsEnabled) return true;
    const userId = ticketNotificationTarget(ticket, kind);
    const previous = ticket.notifications?.[kind];
    const cooldown = (cfg.reminderMinutes || 30) * 60_000;
    if (previous?.key === key || (previous && Date.now() - previous.at < cooldown)) return true;
    const lock = `${ticket.id}:${kind}`;
    if (notifying.has(lock)) return true;
    notifying.add(lock);
    try {
        const link = `https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`;
        const description = kind === "staff_reply" ? `Staff replied to ticket #${ticket.id}.`
            : kind === "closure" ? `The member requested closure of ticket #${ticket.id}.`
                : kind === "reminder" ? `Ticket #${ticket.id} needs a staff reply.`
                    : `A member replied to ticket #${ticket.id}.`;
        if (userId) {
            const user = await client.users.fetch(userId);
            await user.send({ content: `${description}\n${link}`, allowedMentions: { parse: [] } });
        } else {
            const sent = await postStaffAlert({
                embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(description).setDescription(`[Open ticket](${link})`).toJSON()]
            });
            if (!sent) return false;
        }
        ticket.notifications = { ...(ticket.notifications || {}), [kind]: { key, at: Date.now() } };
        return saveTicketStore();
    } catch (error) {
        console.warn(`Could not notify ${userId || "staff queue"} about ticket #${ticket.id}:`, error);
        return false;
    } finally { notifying.delete(lock); }
}

export async function trackTicketReply(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || (!message.content.trim() && !message.attachments.size)) return;
    const ticket = findTicketByChannel(message.channelId);
    if (!ticket || ticket.guildId !== message.guild.id) return;
    const member = message.member || await message.guild.members.fetch(message.author.id);
    await ticketActions.whenIdle(ticket.channelId);
    const previous = { ...ticket };
    if (!applyTicketReply(ticket, message.author.id, canManageTicketActions(member), message.createdTimestamp)) return;
    if (!saveTicketStore()) {
        Object.assign(ticket, previous);
        await message.reply({ content: "Your message arrived, but the ticket status could not be saved. Staff can review it here.", allowedMentions: { parse: [], repliedUser: false } });
        return;
    }
    await updateTicketOpsPanelMessage(message.guild, ticket);
    await notifyTicketRecipient(ticket, message.author.id === ticket.ownerId ? "member_reply" : "staff_reply", message.id);
}

export async function runTicketReplyReminders(guild: Guild): Promise<void> {
    for (const ticket of ticketStore.tickets.filter(ticket => ticket.guildId === guild.id
        && (ticket.status === "open" || ticket.status === "claimed"))) {
        if (ticketActions.isBusy(ticket.channelId)) continue;
        await updateTicketOpsPanelMessage(guild, ticket);
        if (!isTicketReplyOverdue(ticket, Date.now())) continue;
        const since = ticket.lastReplyAt || ticket.createdAt;
        const interval = (ensureTicketConfig(ticket.guildId).reminderMinutes || 30) * 60_000;
        await notifyTicketRecipient(ticket, "reminder", `${since}:${ticket.assignedToId || ticket.claimedById || "queue"}:${Math.floor(Date.now() / interval)}`);
    }
}

type QueueFilter = "unclaimed" | "staff" | "member" | "overdue";
export function buildTicketQueue(guildId: string, filter: QueueFilter = "staff", page = 0) {
    const active = ticketStore.tickets.filter(ticket => ticket.guildId === guildId && ["open", "claimed"].includes(ticket.status));
    const matches = (ticket: TicketEntry, kind: QueueFilter) => kind === "unclaimed" ? !ticket.claimedById
        : kind === "member" ? ticket.workflowStatus === "waiting_user"
            : kind === "overdue" ? isTicketReplyOverdue(ticket, Date.now())
                : ticket.workflowStatus !== "waiting_user";
    const rows = active.filter(ticket => matches(ticket, filter)).sort((a, b) =>
        Number(isTicketReplyOverdue(b, Date.now())) - Number(isTicketReplyOverdue(a, Date.now())) || a.createdAt - b.createdAt);
    const lastPage = Math.max(0, Math.ceil(rows.length / 10) - 1);
    const currentPage = Math.max(0, Math.min(page, lastPage));
    const labels: Record<QueueFilter, string> = { unclaimed: "Unclaimed", staff: "Waiting for Staff", member: "Waiting for Member", overdue: "Overdue Replies" };
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("Support Queue")
        .setDescription([
            Object.entries(labels).map(([key, label]) => `${label}: **${active.filter(ticket => matches(ticket, key as QueueFilter)).length}**`).join(" • "),
            "",
            ...rows.slice(currentPage * 10, currentPage * 10 + 10).map(ticket =>
                `**#${ticket.id}** <#${ticket.channelId}> • ${ticketDisplayStatus(ticket)}\nHandler: ${ticket.assignedToId || ticket.claimedById ? `<@${ticket.assignedToId || ticket.claimedById}>` : "Unassigned"}${ticket.closureRequestedAt ? " • Closure requested" : ""}`),
            ...(!rows.length ? ["No tickets in this view."] : [])
        ].join("\n"))
        .setFooter({ text: `${labels[filter]} • Page ${currentPage + 1}/${lastPage + 1} • Refresh for latest status` });
    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${TICKET_IDS.queue}:filter`).setPlaceholder("Choose a queue")
            .addOptions(Object.entries(labels).map(([value, label]) => ({ label, value, default: value === filter })))
    );
    const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${TICKET_IDS.queue}:${filter}:${Math.max(0, currentPage - 1)}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.queue}:${filter}:${Math.min(lastPage, currentPage + 1)}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(currentPage === lastPage),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.queue}:${filter}:${currentPage}`).setLabel("Refresh").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(TICKET_IDS.notificationSettings).setLabel("Notification Settings").setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [menu, nav], allowedMentions: { parse: [] as MessageMentionTypes[] } };
}

export function buildResolveConfirmation(ticket: TicketEntry, actorId: string, reason = "Confirmed by support staff") {
    return {
        content: `Permanently resolve ticket #${ticket.id}? A verified transcript will be saved before the channel is deleted. This cannot be undone.`,
        embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle("Confirm Permanent Resolution")
            .addFields({ name: "Reason", value: reason.trim().slice(0, 220) || "Confirmed by support staff" })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${TICKET_IDS.confirmResolve}:${ticket.id}:${actorId}:${ticket.updatedAt}`)
                .setLabel("Confirm Permanent Resolution").setStyle(ButtonStyle.Danger)
        )],
        allowedMentions: { parse: [] as MessageMentionTypes[] }
    };
}

export async function handleTicketExperienceInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isMessageComponent() || interaction.isModalSubmit())) return false;
    const id = interaction.customId;
    if (id === TICKET_IDS.category && interaction.isStringSelectMenu()) {
        const topic = interaction.values[0];
        if (!interaction.guild || !isTicketTopic(topic)) {
            await interaction.reply({ content: "Choose a valid support topic in the server.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(buildTicketIntakeModal(topic, getTicketDraft(interaction.guild.id, interaction.user.id)));
        return true;
    }
    if (id === TICKET_IDS.retry && interaction.isButton()) {
        const draft = interaction.guild ? getTicketDraft(interaction.guild.id, interaction.user.id) : undefined;
        if (!draft) {
            await interaction.reply({ content: "Your draft expired. Open a new request from the support panel.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(buildTicketIntakeModal(draft.category, draft));
        return true;
    }
    if (id === TICKET_IDS.requestClose && interaction.isButton()) {
        const ticket = findTicketByChannel(interaction.channelId);
        if (!interaction.guild || !ticket || ticket.guildId !== interaction.guild.id || ticket.ownerId !== interaction.user.id) {
            await interaction.reply({ content: "Only the member who opened this ticket can request closure.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await ticketActions.run(ticket.channelId, async () => {
            if (!["open", "claimed"].includes(ticket.status)) return "This ticket is already closed.";
            if (ticket.closureRequestedAt) return "Staff already have your closure request.";
            const previous = { ...ticket };
            ticket.closureRequestedAt = Date.now();
            ticket.closureRequestedBy = interaction.user.id;
            ticket.updatedAt = Date.now();
            if (!saveTicketStore()) { Object.assign(ticket, previous); return "Your closure request could not be saved. Please retry."; }
            await updateTicketOpsPanelMessage(interaction.guild!, ticket);
            await notifyTicketRecipient(ticket, "closure", String(ticket.closureRequestedAt));
            appendAuditEvent("ticket_closure_requested", { guildId: ticket.guildId, ticketId: ticket.id, ownerId: ticket.ownerId });
            return "Closure requested. Staff will review it; your ticket remains available until they close it.";
        });
        await interaction.editReply({ content: result });
        return true;
    }
    const relevant = id.startsWith(`${TICKET_IDS.confirmResolve}:`) || id.startsWith(TICKET_IDS.queue)
        || [TICKET_IDS.assign, TICKET_IDS.requestInfo, TICKET_IDS.requestInfoModal, TICKET_IDS.notificationSettings, TICKET_IDS.notificationModal].some(value => value === id);
    if (!relevant) return false;
    const member = interaction.member as GuildMember | null;
    if (!interaction.guild || !member || !canManageTicketActions(member)) {
        await interaction.reply({ content: "These tools are for support staff only.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const guild = interaction.guild;
    if (id.startsWith(TICKET_IDS.queue)) {
        const filter = interaction.isStringSelectMenu() ? interaction.values[0] : id.split(":")[1] || "staff";
        if (!["unclaimed", "staff", "member", "overdue"].includes(filter)) {
            await interaction.reply({ content: "That queue view is invalid.", flags: MessageFlags.Ephemeral });
            return true;
        }
        const payload = buildTicketQueue(guild.id, filter as QueueFilter, Number.parseInt(id.split(":")[2], 10) || 0);
        if (id === TICKET_IDS.queue) await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        else if (interaction.isMessageComponent()) await interaction.update(payload);
        return true;
    }
    if (id === TICKET_IDS.notificationSettings && interaction.isButton()) {
        const cfg = ensureTicketConfig(guild.id);
        await interaction.showModal(new ModalBuilder().setCustomId(TICKET_IDS.notificationModal).setTitle("Ticket Notifications")
            .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("enabled").setLabel("Notifications: on / off").setStyle(TextInputStyle.Short).setValue(cfg.notificationsEnabled ? "on" : "off").setRequired(true)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("minutes").setLabel("Minimum reminder interval (5–1440 minutes)").setStyle(TextInputStyle.Short).setValue(String(cfg.reminderMinutes || 30)).setRequired(true))
            ));
        return true;
    }
    if (id === TICKET_IDS.notificationModal && interaction.isModalSubmit()) {
        const enabled = interaction.fields.getTextInputValue("enabled").trim().toLowerCase();
        const interval = Number(interaction.fields.getTextInputValue("minutes"));
        if (!["on", "off"].includes(enabled) || !Number.isInteger(interval) || interval < 5 || interval > 1440) {
            await interaction.reply({ content: "Use on/off and a whole interval from 5 to 1440 minutes.", flags: MessageFlags.Ephemeral });
            return true;
        }
        const cfg = ensureTicketConfig(guild.id);
        const previous = { ...cfg };
        cfg.notificationsEnabled = enabled === "on";
        cfg.reminderMinutes = interval;
        const saved = saveTicketStore();
        if (!saved) Object.assign(cfg, previous);
        else appendAuditEvent("ticket_notification_settings", { guildId: guild.id, actorId: interaction.user.id, enabled, interval });
        await interaction.reply({ content: saved ? "Ticket notification settings saved." : "Settings could not be saved; nothing changed.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const ticket = id.startsWith(`${TICKET_IDS.confirmResolve}:`)
        ? findTicketById(Number(id.split(":")[1]))
        : interaction.channelId ? findTicketByChannel(interaction.channelId) : null;
    if (!ticket || ticket.guildId !== guild.id) {
        await interaction.reply({ content: "This ticket is no longer tracked.", flags: MessageFlags.Ephemeral });
        return true;
    }
    if (id.startsWith(`${TICKET_IDS.confirmResolve}:`) && interaction.isButton()) {
        const [, rawTicketId, actorId, revision] = id.split(":");
        if (Number(rawTicketId) !== ticket.id || actorId !== interaction.user.id || Number(revision) !== ticket.updatedAt || ticket.status !== "archived") {
            await interaction.reply({ content: "This confirmation is stale or belongs to another staff member. Open Staff Tools again.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (Number(revision) !== ticket.updatedAt || ticket.status !== "archived") {
            await interaction.editReply({ content: "This ticket changed while you confirmed. Open Staff Tools again." });
            return true;
        }
        const reason = interaction.message.embeds[0]?.fields.find(field => field.name === "Reason")?.value || "Confirmed by support staff";
        const result = await resolveTicketChannel(guild, ticket.channelId, interaction.user.id, reason);
        await interaction.editReply({ content: result, allowedMentions: { parse: [] } });
        return true;
    }
    if (id === TICKET_IDS.assign && interaction.isUserSelectMenu()) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await ticketActions.run(ticket.channelId, async () => {
            const assignee = await guild.members.fetch(interaction.values[0]);
            if (assignee.user.bot || !canManageTicketActions(assignee)) return "Choose a support staff member, not a bot.";
            if (!["open", "claimed"].includes(ticket.status)) return "Reopen this ticket before assigning a handler.";
            const assigned = assignTicketToUser(ticket.channelId, assignee.id, true);
            if (!assigned) return "The handler could not be saved.";
            await updateTicketOpsPanelMessage(guild, assigned);
            await notifyTicketRecipient(assigned, "member_reply", `assignment:${assigned.updatedAt}`);
            return `Handler assigned: <@${assignee.id}>.`;
        });
        await interaction.editReply({ content: result, allowedMentions: { parse: [] } });
        return true;
    }
    if (id === TICKET_IDS.requestInfo && interaction.isButton()) {
        await interaction.showModal(new ModalBuilder().setCustomId(TICKET_IDS.requestInfoModal).setTitle("Request Information")
            .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId("request").setLabel("What do you need from the member?").setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)
            )));
        return true;
    }
    if (id === TICKET_IDS.requestInfoModal && interaction.isModalSubmit()) {
        const text = interaction.fields.getTextInputValue("request").trim();
        if (!text) { await interaction.reply({ content: "Enter the information you need.", flags: MessageFlags.Ephemeral }); return true; }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await ticketActions.run(ticket.channelId, async () => {
            if (!["open", "claimed"].includes(ticket.status)) return "Reopen this ticket before requesting information.";
            const channel = guild.channels.cache.get(ticket.channelId) || await guild.channels.fetch(ticket.channelId);
            if (!channel || channel.type !== ChannelType.GuildText) return "This ticket channel is missing.";
            const sent = await channel.send({ content: `**Staff need more information:**\n${text}`, allowedMentions: { parse: [] } });
            const previous = { ...ticket };
            applyTicketReply(ticket, interaction.user.id, true, sent.createdTimestamp, true);
            if (!saveTicketStore()) { Object.assign(ticket, previous); return "Request sent, but the waiting status could not be saved. Staff should retry the status update."; }
            await updateTicketOpsPanelMessage(guild, ticket);
            await notifyTicketRecipient(ticket, "staff_reply", sent.id);
            return "Information requested. The ticket is now waiting for the member.";
        });
        await interaction.editReply({ content: result });
        return true;
    }
    return false;
}

export function buildHandlerSelector() {
    return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder().setCustomId(TICKET_IDS.assign).setPlaceholder("Assign Handler").setMinValues(1).setMaxValues(1)
    );
}
