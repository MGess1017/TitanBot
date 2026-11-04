"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertAdminReportPanelInChannel = upsertAdminReportPanelInChannel;
// Admin report panel.
const discord_js_1 = require("discord.js");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const store_1 = require("../moderation/store");
const ids_1 = require("../ui/ids");
const embeds_1 = require("../ui/embeds");
function buildAdminReportPanelPayload(guildName) {
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("🛡️ Admin Report Panel")
        .setDescription([
        "Administrator-only formal report intake panel.",
        "",
        "Use this to file tracked reports against players.",
        `All submitted reports are automatically logged to <#${config_1.REPORT_LOG_CHANNEL_ID}>.`
    ].join("\n"))
        .addFields({ name: "Scope", value: "Reports against players only. Support requests must use the support ticket panel.", inline: false }, { name: "Access", value: "Admins only", inline: true }, { name: "Server", value: guildName, inline: true }), "FN Admin Report Control", `${guildName} admin report panel`);
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(ids_1.REPORT_IDS.adminOpen)
        .setLabel("File User Report")
        .setEmoji("🚨")
        .setStyle(discord_js_1.ButtonStyle.Danger));
    return { embed: embed.toJSON(), components: [row.toJSON()] };
}
async function upsertAdminReportPanelInChannel(guild, channelId) {
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        return { ok: false, error: "Configured admin report panel channel is missing or not a text channel." };
    }
    const payload = buildAdminReportPanelPayload(guild.name);
    const embed = payload.embed;
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(ids_1.REPORT_IDS.adminOpen)
        .setLabel("File User Report")
        .setEmoji("🚨")
        .setStyle(discord_js_1.ButtonStyle.Danger));
    const storedMessageId = (0, store_1.getGuildPanelMessageId)(guild.id, "reportAdmin");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) {
            return { ok: true, action: "updated" };
        }
        (0, store_1.setGuildPanelMessageId)(guild.id, "reportAdmin", null);
    }
    let candidateId = null;
    const duplicateIds = [];
    let beforeId;
    for (let i = 0; i < 8; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
        if (!batch || !batch.size)
            break;
        const candidates = batch.filter(message => message.author.id === (client_1.client.user?.id || "")
            && (message.embeds[0]?.title === "🛡️ Admin Report Panel"
                || message.embeds[0]?.footer?.text?.includes("admin report panel")));
        const candidate = candidates.first();
        if (candidate) {
            candidateId = candidate.id;
            for (const duplicate of candidates.values()) {
                if (duplicate.id !== candidate.id)
                    duplicateIds.push(duplicate.id);
            }
            break;
        }
        const last = batch.last();
        beforeId = last?.id;
        if (!beforeId)
            break;
    }
    if (candidateId) {
        const candidate = await channel.messages.fetch(candidateId).catch(() => null);
        const edited = await candidate?.edit({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
        if (!edited) {
            return { ok: false, error: "Failed to refresh admin report panel message. Check bot permissions for this channel." };
        }
        (0, store_1.setGuildPanelMessageId)(guild.id, "reportAdmin", candidateId);
        for (const duplicateId of duplicateIds) {
            if (duplicateId === candidateId)
                continue;
            const duplicate = await channel.messages.fetch(duplicateId).catch(() => null);
            await duplicate?.delete().catch(() => undefined);
        }
        return { ok: true, action: "updated" };
    }
    const sent = await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        return { ok: false, error: "Failed to post admin report panel message. Check bot permissions for this channel." };
    }
    (0, store_1.setGuildPanelMessageId)(guild.id, "reportAdmin", sent.id);
    return { ok: true, action: "posted" };
}
