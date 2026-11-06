"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyTicketRecipient = notifyTicketRecipient;
exports.trackTicketReply = trackTicketReply;
exports.runTicketReplyReminders = runTicketReplyReminders;
exports.buildTicketQueue = buildTicketQueue;
exports.buildResolveConfirmation = buildResolveConfirmation;
exports.handleTicketExperienceInteraction = handleTicketExperienceInteraction;
exports.buildHandlerSelector = buildHandlerSelector;
// Member closure requests, reply tracking, private staff queue, and targeted reminders.
const discord_js_1 = require("discord.js");
const ticketExperience_1 = require("../../services/ticketExperience");
const client_1 = require("../core/client");
const ids_1 = require("../ui/ids");
const modals_1 = require("../ui/modals");
const drafts_1 = require("./drafts");
const actions_1 = require("./actions");
const store_1 = require("./store");
const channels_1 = require("./channels");
const opsPanel_1 = require("./opsPanel");
const staffDesk_1 = require("../staff/staffDesk");
const records_1 = require("./records");
const audit_1 = require("../core/audit");
const notifying = new Set();
async function notifyTicketRecipient(ticket, kind, key) {
    const cfg = (0, store_1.ensureTicketConfig)(ticket.guildId);
    if (!cfg.notificationsEnabled)
        return true;
    const userId = (0, ticketExperience_1.ticketNotificationTarget)(ticket, kind);
    const previous = ticket.notifications?.[kind];
    const cooldown = (cfg.reminderMinutes || 30) * 60000;
    if (previous?.key === key || (previous && Date.now() - previous.at < cooldown))
        return true;
    const lock = `${ticket.id}:${kind}`;
    if (notifying.has(lock))
        return true;
    notifying.add(lock);
    try {
        const link = `https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`;
        const description = kind === "staff_reply" ? `Staff replied to ticket #${ticket.id}.`
            : kind === "closure" ? `The member requested closure of ticket #${ticket.id}.`
                : kind === "reminder" ? `Ticket #${ticket.id} needs a staff reply.`
                    : `A member replied to ticket #${ticket.id}.`;
        if (userId) {
            const user = await client_1.client.users.fetch(userId);
            await user.send({ content: `${description}\n${link}`, allowedMentions: { parse: [] } });
        }
        else {
            const sent = await (0, staffDesk_1.postStaffAlert)({
                embeds: [new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle(description).setDescription(`[Open ticket](${link})`).toJSON()]
            });
            if (!sent)
                return false;
        }
        ticket.notifications = { ...(ticket.notifications || {}), [kind]: { key, at: Date.now() } };
        return (0, store_1.saveTicketStore)();
    }
    catch (error) {
        console.warn(`Could not notify ${userId || "staff queue"} about ticket #${ticket.id}:`, error);
        return false;
    }
    finally {
        notifying.delete(lock);
    }
}
async function trackTicketReply(message) {
    if (!message.guild || message.author.bot || (!message.content.trim() && !message.attachments.size))
        return;
    const ticket = (0, store_1.findTicketByChannel)(message.channelId);
    if (!ticket || ticket.guildId !== message.guild.id)
        return;
    const member = message.member || await message.guild.members.fetch(message.author.id);
    await ticketExperience_1.ticketActions.whenIdle(ticket.channelId);
    const previous = { ...ticket };
    if (!(0, ticketExperience_1.applyTicketReply)(ticket, message.author.id, (0, actions_1.canManageTicketActions)(member), message.createdTimestamp))
        return;
    if (!(0, store_1.saveTicketStore)()) {
        Object.assign(ticket, previous);
        await message.reply({ content: "Your message arrived, but the ticket status could not be saved. Staff can review it here.", allowedMentions: { parse: [], repliedUser: false } });
        return;
    }
    await (0, opsPanel_1.updateTicketOpsPanelMessage)(message.guild, ticket);
    await notifyTicketRecipient(ticket, message.author.id === ticket.ownerId ? "member_reply" : "staff_reply", message.id);
}
async function runTicketReplyReminders(guild) {
    for (const ticket of store_1.ticketStore.tickets.filter(ticket => ticket.guildId === guild.id
        && (ticket.status === "open" || ticket.status === "claimed"))) {
        if (ticketExperience_1.ticketActions.isBusy(ticket.channelId))
            continue;
        await (0, opsPanel_1.updateTicketOpsPanelMessage)(guild, ticket);
        if (!(0, ticketExperience_1.isTicketReplyOverdue)(ticket, Date.now()))
            continue;
        const since = ticket.lastReplyAt || ticket.createdAt;
        const interval = ((0, store_1.ensureTicketConfig)(ticket.guildId).reminderMinutes || 30) * 60000;
        await notifyTicketRecipient(ticket, "reminder", `${since}:${ticket.assignedToId || ticket.claimedById || "queue"}:${Math.floor(Date.now() / interval)}`);
    }
}
function buildTicketQueue(guildId, filter = "staff", page = 0) {
    const active = store_1.ticketStore.tickets.filter(ticket => ticket.guildId === guildId && ["open", "claimed"].includes(ticket.status));
    const matches = (ticket, kind) => kind === "unclaimed" ? !ticket.claimedById
        : kind === "member" ? ticket.workflowStatus === "waiting_user"
            : kind === "overdue" ? (0, ticketExperience_1.isTicketReplyOverdue)(ticket, Date.now())
                : ticket.workflowStatus !== "waiting_user";
    const rows = active.filter(ticket => matches(ticket, filter)).sort((a, b) => Number((0, ticketExperience_1.isTicketReplyOverdue)(b, Date.now())) - Number((0, ticketExperience_1.isTicketReplyOverdue)(a, Date.now())) || a.createdAt - b.createdAt);
    const lastPage = Math.max(0, Math.ceil(rows.length / 10) - 1);
    const currentPage = Math.max(0, Math.min(page, lastPage));
    const labels = { unclaimed: "Unclaimed", staff: "Waiting for Staff", member: "Waiting for Member", overdue: "Overdue Replies" };
    const embed = new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle("Support Queue")
        .setDescription([
        Object.entries(labels).map(([key, label]) => `${label}: **${active.filter(ticket => matches(ticket, key)).length}**`).join(" • "),
        "",
        ...rows.slice(currentPage * 10, currentPage * 10 + 10).map(ticket => `**#${ticket.id}** <#${ticket.channelId}> • ${(0, ticketExperience_1.ticketDisplayStatus)(ticket)}\nHandler: ${ticket.assignedToId || ticket.claimedById ? `<@${ticket.assignedToId || ticket.claimedById}>` : "Unassigned"}${ticket.closureRequestedAt ? " • Closure requested" : ""}`),
        ...(!rows.length ? ["No tickets in this view."] : [])
    ].join("\n"))
        .setFooter({ text: `${labels[filter]} • Page ${currentPage + 1}/${lastPage + 1} • Refresh for latest status` });
    const menu = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId(`${ids_1.TICKET_IDS.queue}:filter`).setPlaceholder("Choose a queue")
        .addOptions(Object.entries(labels).map(([value, label]) => ({ label, value, default: value === filter }))));
    const nav = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.queue}:${filter}:${Math.max(0, currentPage - 1)}`).setLabel("Previous").setStyle(discord_js_1.ButtonStyle.Secondary).setDisabled(currentPage === 0), new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.queue}:${filter}:${Math.min(lastPage, currentPage + 1)}`).setLabel("Next").setStyle(discord_js_1.ButtonStyle.Secondary).setDisabled(currentPage === lastPage), new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.queue}:${filter}:${currentPage}`).setLabel("Refresh").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(ids_1.TICKET_IDS.notificationSettings).setLabel("Notification Settings").setStyle(discord_js_1.ButtonStyle.Secondary));
    return { embeds: [embed], components: [menu, nav], allowedMentions: { parse: [] } };
}
function buildResolveConfirmation(ticket, actorId, reason = "Confirmed by support staff") {
    return {
        content: `Permanently resolve ticket #${ticket.id}? A verified transcript will be saved before the channel is deleted. This cannot be undone.`,
        embeds: [new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle("Confirm Permanent Resolution")
                .addFields({ name: "Reason", value: reason.trim().slice(0, 220) || "Confirmed by support staff" })],
        components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.TICKET_IDS.confirmResolve}:${ticket.id}:${actorId}:${ticket.updatedAt}`)
                .setLabel("Confirm Permanent Resolution").setStyle(discord_js_1.ButtonStyle.Danger))],
        allowedMentions: { parse: [] }
    };
}
async function handleTicketExperienceInteraction(interaction) {
    if (!(interaction.isMessageComponent() || interaction.isModalSubmit()))
        return false;
    const id = interaction.customId;
    if (id === ids_1.TICKET_IDS.category && interaction.isStringSelectMenu()) {
        const topic = interaction.values[0];
        if (!interaction.guild || !(0, ticketExperience_1.isTicketTopic)(topic)) {
            await interaction.reply({ content: "Choose a valid support topic in the server.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal((0, modals_1.buildTicketIntakeModal)(topic, (0, drafts_1.getTicketDraft)(interaction.guild.id, interaction.user.id)));
        return true;
    }
    if (id === ids_1.TICKET_IDS.retry && interaction.isButton()) {
        const draft = interaction.guild ? (0, drafts_1.getTicketDraft)(interaction.guild.id, interaction.user.id) : undefined;
        if (!draft) {
            await interaction.reply({ content: "Your draft expired. Open a new request from the support panel.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal((0, modals_1.buildTicketIntakeModal)(draft.category, draft));
        return true;
    }
    if (id === ids_1.TICKET_IDS.requestClose && interaction.isButton()) {
        const ticket = (0, store_1.findTicketByChannel)(interaction.channelId);
        if (!interaction.guild || !ticket || ticket.guildId !== interaction.guild.id || ticket.ownerId !== interaction.user.id) {
            await interaction.reply({ content: "Only the member who opened this ticket can request closure.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        const result = await ticketExperience_1.ticketActions.run(ticket.channelId, async () => {
            if (!["open", "claimed"].includes(ticket.status))
                return "This ticket is already closed.";
            if (ticket.closureRequestedAt)
                return "Staff already have your closure request.";
            const previous = { ...ticket };
            ticket.closureRequestedAt = Date.now();
            ticket.closureRequestedBy = interaction.user.id;
            ticket.updatedAt = Date.now();
            if (!(0, store_1.saveTicketStore)()) {
                Object.assign(ticket, previous);
                return "Your closure request could not be saved. Please retry.";
            }
            await (0, opsPanel_1.updateTicketOpsPanelMessage)(interaction.guild, ticket);
            await notifyTicketRecipient(ticket, "closure", String(ticket.closureRequestedAt));
            (0, audit_1.appendAuditEvent)("ticket_closure_requested", { guildId: ticket.guildId, ticketId: ticket.id, ownerId: ticket.ownerId });
            return "Closure requested. Staff will review it; your ticket remains available until they close it.";
        });
        await interaction.editReply({ content: result });
        return true;
    }
    const relevant = id.startsWith(`${ids_1.TICKET_IDS.confirmResolve}:`) || id.startsWith(ids_1.TICKET_IDS.queue)
        || [ids_1.TICKET_IDS.assign, ids_1.TICKET_IDS.requestInfo, ids_1.TICKET_IDS.requestInfoModal, ids_1.TICKET_IDS.notificationSettings, ids_1.TICKET_IDS.notificationModal].some(value => value === id);
    if (!relevant)
        return false;
    const member = interaction.member;
    if (!interaction.guild || !member || !(0, actions_1.canManageTicketActions)(member)) {
        await interaction.reply({ content: "These tools are for support staff only.", flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    const guild = interaction.guild;
    if (id.startsWith(ids_1.TICKET_IDS.queue)) {
        const filter = interaction.isStringSelectMenu() ? interaction.values[0] : id.split(":")[1] || "staff";
        if (!["unclaimed", "staff", "member", "overdue"].includes(filter)) {
            await interaction.reply({ content: "That queue view is invalid.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const payload = buildTicketQueue(guild.id, filter, Number.parseInt(id.split(":")[2], 10) || 0);
        if (id === ids_1.TICKET_IDS.queue)
            await interaction.reply({ ...payload, flags: discord_js_1.MessageFlags.Ephemeral });
        else if (interaction.isMessageComponent())
            await interaction.update(payload);
        return true;
    }
    if (id === ids_1.TICKET_IDS.notificationSettings && interaction.isButton()) {
        const cfg = (0, store_1.ensureTicketConfig)(guild.id);
        await interaction.showModal(new discord_js_1.ModalBuilder().setCustomId(ids_1.TICKET_IDS.notificationModal).setTitle("Ticket Notifications")
            .addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("enabled").setLabel("Notifications: on / off").setStyle(discord_js_1.TextInputStyle.Short).setValue(cfg.notificationsEnabled ? "on" : "off").setRequired(true)), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("minutes").setLabel("Minimum reminder interval (5–1440 minutes)").setStyle(discord_js_1.TextInputStyle.Short).setValue(String(cfg.reminderMinutes || 30)).setRequired(true))));
        return true;
    }
    if (id === ids_1.TICKET_IDS.notificationModal && interaction.isModalSubmit()) {
        const enabled = interaction.fields.getTextInputValue("enabled").trim().toLowerCase();
        const interval = Number(interaction.fields.getTextInputValue("minutes"));
        if (!["on", "off"].includes(enabled) || !Number.isInteger(interval) || interval < 5 || interval > 1440) {
            await interaction.reply({ content: "Use on/off and a whole interval from 5 to 1440 minutes.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const cfg = (0, store_1.ensureTicketConfig)(guild.id);
        const previous = { ...cfg };
        cfg.notificationsEnabled = enabled === "on";
        cfg.reminderMinutes = interval;
        const saved = (0, store_1.saveTicketStore)();
        if (!saved)
            Object.assign(cfg, previous);
        else
            (0, audit_1.appendAuditEvent)("ticket_notification_settings", { guildId: guild.id, actorId: interaction.user.id, enabled, interval });
        await interaction.reply({ content: saved ? "Ticket notification settings saved." : "Settings could not be saved; nothing changed.", flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    const ticket = id.startsWith(`${ids_1.TICKET_IDS.confirmResolve}:`)
        ? (0, store_1.findTicketById)(Number(id.split(":")[1]))
        : interaction.channelId ? (0, store_1.findTicketByChannel)(interaction.channelId) : null;
    if (!ticket || ticket.guildId !== guild.id) {
        await interaction.reply({ content: "This ticket is no longer tracked.", flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    if (id.startsWith(`${ids_1.TICKET_IDS.confirmResolve}:`) && interaction.isButton()) {
        const [, rawTicketId, actorId, revision] = id.split(":");
        if (Number(rawTicketId) !== ticket.id || actorId !== interaction.user.id || Number(revision) !== ticket.updatedAt || ticket.status !== "archived") {
            await interaction.reply({ content: "This confirmation is stale or belongs to another staff member. Open Staff Tools again.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        if (Number(revision) !== ticket.updatedAt || ticket.status !== "archived") {
            await interaction.editReply({ content: "This ticket changed while you confirmed. Open Staff Tools again." });
            return true;
        }
        const reason = interaction.message.embeds[0]?.fields.find(field => field.name === "Reason")?.value || "Confirmed by support staff";
        const result = await (0, channels_1.resolveTicketChannel)(guild, ticket.channelId, interaction.user.id, reason);
        await interaction.editReply({ content: result, allowedMentions: { parse: [] } });
        return true;
    }
    if (id === ids_1.TICKET_IDS.assign && interaction.isUserSelectMenu()) {
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        const result = await ticketExperience_1.ticketActions.run(ticket.channelId, async () => {
            const assignee = await guild.members.fetch(interaction.values[0]);
            if (assignee.user.bot || !(0, actions_1.canManageTicketActions)(assignee))
                return "Choose a support staff member, not a bot.";
            if (!["open", "claimed"].includes(ticket.status))
                return "Reopen this ticket before assigning a handler.";
            const assigned = (0, records_1.assignTicketToUser)(ticket.channelId, assignee.id, true);
            if (!assigned)
                return "The handler could not be saved.";
            await (0, opsPanel_1.updateTicketOpsPanelMessage)(guild, assigned);
            await notifyTicketRecipient(assigned, "member_reply", `assignment:${assigned.updatedAt}`);
            return `Handler assigned: <@${assignee.id}>.`;
        });
        await interaction.editReply({ content: result, allowedMentions: { parse: [] } });
        return true;
    }
    if (id === ids_1.TICKET_IDS.requestInfo && interaction.isButton()) {
        await interaction.showModal(new discord_js_1.ModalBuilder().setCustomId(ids_1.TICKET_IDS.requestInfoModal).setTitle("Request Information")
            .addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("request").setLabel("What do you need from the member?").setStyle(discord_js_1.TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true))));
        return true;
    }
    if (id === ids_1.TICKET_IDS.requestInfoModal && interaction.isModalSubmit()) {
        const text = interaction.fields.getTextInputValue("request").trim();
        if (!text) {
            await interaction.reply({ content: "Enter the information you need.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        const result = await ticketExperience_1.ticketActions.run(ticket.channelId, async () => {
            if (!["open", "claimed"].includes(ticket.status))
                return "Reopen this ticket before requesting information.";
            const channel = guild.channels.cache.get(ticket.channelId) || await guild.channels.fetch(ticket.channelId);
            if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
                return "This ticket channel is missing.";
            const sent = await channel.send({ content: `**Staff need more information:**\n${text}`, allowedMentions: { parse: [] } });
            const previous = { ...ticket };
            (0, ticketExperience_1.applyTicketReply)(ticket, interaction.user.id, true, sent.createdTimestamp, true);
            if (!(0, store_1.saveTicketStore)()) {
                Object.assign(ticket, previous);
                return "Request sent, but the waiting status could not be saved. Staff should retry the status update.";
            }
            await (0, opsPanel_1.updateTicketOpsPanelMessage)(guild, ticket);
            await notifyTicketRecipient(ticket, "staff_reply", sent.id);
            return "Information requested. The ticket is now waiting for the member.";
        });
        await interaction.editReply({ content: result });
        return true;
    }
    return false;
}
function buildHandlerSelector() {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.UserSelectMenuBuilder().setCustomId(ids_1.TICKET_IDS.assign).setPlaceholder("Assign Handler").setMinValues(1).setMaxValues(1));
}
