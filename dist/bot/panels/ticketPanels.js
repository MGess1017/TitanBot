"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketPanelPayload = buildTicketPanelPayload;
exports.buildRaidItemGiveawayPanelPayload = buildRaidItemGiveawayPanelPayload;
exports.upsertTicketPanelInChannel = upsertTicketPanelInChannel;
exports.ensurePermanentTicketPanelForGuild = ensurePermanentTicketPanelForGuild;
exports.removeLegacyReportPanelForGuild = removeLegacyReportPanelForGuild;
exports.ensureAdminReportPanelForGuild = ensureAdminReportPanelForGuild;
// Ticket and raid-item giveaway panels.
const discord_js_1 = require("discord.js");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const reportPanels_1 = require("./reportPanels");
const ids_1 = require("../ui/ids");
const embeds_1 = require("../ui/embeds");
function buildTicketPanelPayload(guildName) {
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🎫 FN Support Desk")
        .setDescription([
        "• Click **Open Support Ticket** and tell us what you need.",
        "• Your ticket is private between you and the support team.",
        "• Add screenshots, message links, or order details when relevant.",
        "• Continue an existing open case instead of opening a duplicate."
    ].join("\n")), "FNT Support", `${guildName} support panel`);
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(ids_1.TICKET_IDS.open)
        .setLabel("Open Support Ticket")
        .setEmoji("🎫")
        .setStyle(discord_js_1.ButtonStyle.Success));
    return {
        embed: embed.toJSON(),
        components: [row.toJSON()],
        isTicketPanel: true
    };
}
function buildRaidItemGiveawayPanelPayload(guildName) {
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🎁 Titan Raid Item Giveaway Desk")
        .setDescription([
        `Create auto-awarded raid item giveaways for **${guildName}** using the full raid item catalog.`,
        "",
        "This panel is admin-facing and creates giveaways where winners automatically receive the configured raid item in inventory."
    ].join("\n"))
        .addFields({ name: "Modes", value: "• `/giveaway` for any freeform prize\n• `/itemgiveaway` for slash-driven raid item rewards\n• Button below for quick raid-item creation", inline: false }, { name: "Auto Reward", value: "Raid-item giveaways automatically deliver the selected item to each winner when the giveaway ends.", inline: false }), "Titan Giveaway Control", `${guildName} raid item giveaway panel`);
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(ids_1.GIVEAWAY_IDS.raidPanelOpen)
        .setLabel("Create Raid Item Giveaway")
        .setEmoji("🎁")
        .setStyle(discord_js_1.ButtonStyle.Primary));
    return { embed: embed.toJSON(), components: [row.toJSON()] };
}
function messageHasTicketOpenButton(message) {
    const rows = Array.isArray(message?.components) ? message.components : [];
    return rows.some((row) => {
        const components = Array.isArray(row?.components) ? row.components : [];
        return components.some((component) => component?.customId === ids_1.TICKET_IDS.open);
    });
}
function messageHasReportOpenButton(message) {
    const rows = Array.isArray(message?.components) ? message.components : [];
    return rows.some((row) => {
        const components = Array.isArray(row?.components) ? row.components : [];
        return components.some((component) => component?.customId === ids_1.REPORT_IDS.open);
    });
}
async function upsertTicketPanelInChannel(guild, channelId) {
    const channel = (guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        return { ok: false, error: "Configured ticket panel channel is missing or not a text channel." };
    }
    const { embed, components } = buildTicketPanelPayload(guild.name);
    let candidateId = null;
    let beforeId;
    const expectedTitle = "🎫 FN Support Desk";
    for (let i = 0; i < 5; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) });
        if (!batch.size)
            break;
        const candidate = batch.find(message => message.author.id === (client_1.client.user?.id || "")
            && (messageHasTicketOpenButton(message) || message.embeds[0]?.title === expectedTitle || message.embeds[0]?.title === "⌛ FN Support Desk"));
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
        const candidate = await channel.messages.fetch(candidateId).catch(() => null);
        const edited = await candidate?.edit({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
        if (!edited) {
            return { ok: false, error: "Failed to refresh ticket panel message. Check bot permissions for this channel." };
        }
        return { ok: true, action: "updated" };
    }
    const sent = await channel.send({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        return { ok: false, error: "Failed to post ticket panel message. Check bot permissions for this channel." };
    }
    return { ok: true, action: "posted" };
}
async function ensurePermanentTicketPanelForGuild(guild) {
    if (!config_1.PERMANENT_TICKET_PANEL_CHANNEL_ID)
        return;
    const result = await upsertTicketPanelInChannel(guild, config_1.PERMANENT_TICKET_PANEL_CHANNEL_ID);
    if (result.ok) {
        (0, audit_1.appendAuditEvent)("ticket_panel_permanent_upsert", {
            guildId: guild.id,
            channelId: config_1.PERMANENT_TICKET_PANEL_CHANNEL_ID,
            action: result.action
        });
    }
    else {
        (0, audit_1.appendAuditEvent)("ticket_panel_permanent_upsert_failed", {
            guildId: guild.id,
            channelId: config_1.PERMANENT_TICKET_PANEL_CHANNEL_ID,
            error: result.error
        });
        console.warn(`Permanent ticket panel upsert skipped for guild ${guild.id}: ${result.error}`);
    }
}
async function removeLegacyReportPanelForGuild(guild) {
    if (!config_1.REPORT_PANEL_CHANNEL_ID)
        return;
    const channel = guild.channels.cache.get(config_1.REPORT_PANEL_CHANNEL_ID) || await guild.channels.fetch(config_1.REPORT_PANEL_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
        return;
    const storedReportPanelId = (0, store_1.getGuildPanelMessageId)(guild.id, "report");
    if (storedReportPanelId) {
        const stored = await channel.messages.fetch(storedReportPanelId).catch(() => null);
        await stored?.delete().catch(() => undefined);
        (0, store_1.setGuildPanelMessageId)(guild.id, "report", null);
    }
    let beforeId;
    for (let i = 0; i < 6; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
        if (!batch || !batch.size)
            break;
        const legacy = batch.filter(message => message.author.id === (client_1.client.user?.id || "")
            && (message.embeds[0]?.title === "🚨 FN Report Desk" || messageHasReportOpenButton(message)));
        for (const message of legacy.values()) {
            await message.delete().catch(() => undefined);
        }
        const last = batch.last();
        beforeId = last?.id;
        if (!beforeId)
            break;
    }
}
async function ensureAdminReportPanelForGuild(guild) {
    if (!config_1.REPORT_ADMIN_PANEL_CHANNEL_ID)
        return;
    const result = await (0, reportPanels_1.upsertAdminReportPanelInChannel)(guild, config_1.REPORT_ADMIN_PANEL_CHANNEL_ID);
    if (result.ok) {
        (0, audit_1.appendAuditEvent)("admin_report_panel_upsert", {
            guildId: guild.id,
            channelId: config_1.REPORT_ADMIN_PANEL_CHANNEL_ID,
            action: result.action
        });
    }
    else {
        (0, audit_1.appendAuditEvent)("admin_report_panel_upsert_failed", {
            guildId: guild.id,
            channelId: config_1.REPORT_ADMIN_PANEL_CHANNEL_ID,
            error: result.error
        });
        console.warn(`Admin report panel upsert skipped for guild ${guild.id}: ${result.error}`);
    }
}
