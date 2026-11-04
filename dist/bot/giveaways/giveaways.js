"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.giveawayStore = void 0;
exports.saveGiveawayStore = saveGiveawayStore;
exports.getGiveawayById = getGiveawayById;
exports.sendGiveawayLog = sendGiveawayLog;
exports.syncGiveawayMessage = syncGiveawayMessage;
exports.createAndPostGiveaway = createAndPostGiveaway;
exports.resolveConfiguredGiveawayChannel = resolveConfiguredGiveawayChannel;
exports.buildGiveawayAnnouncement = buildGiveawayAnnouncement;
exports.finalizeGiveaway = finalizeGiveaway;
exports.processDueGiveaways = processDueGiveaways;
exports.refreshActiveGiveawayEmbeds = refreshActiveGiveawayEmbeds;
// Giveaway storage, embeds, entry, and winner selection.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const catalog_1 = require("../../game/catalog");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const audit_1 = require("../core/audit");
const storage_1 = require("../core/storage");
const store_1 = require("../moderation/store");
const ids_1 = require("../ui/ids");
const embeds_1 = require("../ui/embeds");
function normalizeGiveawayStore(raw) {
    const candidate = raw;
    if (!candidate || !Array.isArray(candidate.giveaways) || typeof candidate.nextId !== "number")
        return null;
    const giveaways = candidate.giveaways
        .filter(row => Boolean(row && typeof row === "object"))
        .map(row => {
        const entry = row;
        const status = entry.status === "ended" || entry.status === "cancelled" ? entry.status : "active";
        const rewardKind = entry.rewardKind === "item" ? "item" : "generic";
        return {
            id: Math.max(1, Math.floor(Number(row.id) || 0)),
            guildId: String(entry.guildId || ""),
            channelId: String(entry.channelId || ""),
            messageId: entry.messageId ? String(entry.messageId) : null,
            hostId: String(entry.hostId || ""),
            prize: String(entry.prize || "Giveaway"),
            description: String(entry.description || ""),
            rewardKind,
            rewardItemId: entry.rewardItemId ? String(entry.rewardItemId) : null,
            rewardQty: Math.max(1, Math.floor(Number(entry.rewardQty) || 1)),
            winnerCount: Math.max(1, Math.floor(Number(entry.winnerCount) || 1)),
            roleRequiredId: entry.roleRequiredId ? String(entry.roleRequiredId) : null,
            createdAt: Math.max(0, Math.floor(Number(entry.createdAt) || Date.now())),
            endAt: Math.max(0, Math.floor(Number(entry.endAt) || Date.now())),
            updatedAt: Math.max(0, Math.floor(Number(entry.updatedAt) || Date.now())),
            status,
            entries: Array.from(new Set(Array.isArray(entry.entries) ? entry.entries.map(value => String(value)) : [])),
            winners: Array.from(new Set(Array.isArray(entry.winners) ? entry.winners.map(value => String(value)) : [])),
            endedAt: typeof entry.endedAt === "number" ? entry.endedAt : null
        };
    })
        .filter(entry => entry.id > 0 && entry.guildId && entry.channelId && entry.hostId);
    return { nextId: Math.max(1, Math.floor(candidate.nextId)), giveaways };
}
exports.giveawayStore = (0, storage_1.readJsonWithBackup)(config_1.GIVEAWAY_DATA_FILE, normalizeGiveawayStore, { nextId: 1, giveaways: [] });
function pruneGiveaways(now = Date.now()) {
    const active = exports.giveawayStore.giveaways.filter(entry => entry.status === "active");
    const closed = exports.giveawayStore.giveaways
        .filter(entry => entry.status !== "active")
        .filter(entry => {
        const closedAt = entry.endedAt || entry.updatedAt || entry.endAt;
        return now - closedAt <= config_1.CLOSED_GIVEAWAY_RETENTION_MS;
    })
        .sort((a, b) => (b.endedAt || b.updatedAt || b.endAt) - (a.endedAt || a.updatedAt || a.endAt))
        .slice(0, config_1.MAX_CLOSED_GIVEAWAYS);
    exports.giveawayStore.giveaways = [...active, ...closed];
}
function saveGiveawayStore() {
    pruneGiveaways();
    (0, storage_1.writeJsonAtomic)(config_1.GIVEAWAY_DATA_FILE, exports.giveawayStore);
}
function getGiveawayById(id) {
    return exports.giveawayStore.giveaways.find(entry => entry.id === id) || null;
}
function shuffleUserIds(ids) {
    const values = [...ids];
    for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
}
function pickGiveawayWinners(giveaway) {
    return shuffleUserIds(giveaway.entries).slice(0, Math.max(1, giveaway.winnerCount));
}
function buildGiveawayEmbed(giveaway) {
    const winnersText = giveaway.winners.length ? giveaway.winners.map(id => `<@${id}>`).join(", ") : "Pending draw";
    const rewardDetail = giveaway.rewardKind === "item" && giveaway.rewardItemId
        ? `${catalog_1.ITEM_DEFS[giveaway.rewardItemId]?.name || giveaway.rewardItemId} x${giveaway.rewardQty}`
        : giveaway.prize;
    return new discord_js_1.EmbedBuilder()
        .setColor(giveaway.status === "active" ? 0xf59e0b : 0x22c55e)
        .setTitle(`🎉 ${giveaway.prize}`)
        .setDescription(giveaway.description || "Press the button below to enter before the timer ends.")
        .addFields({ name: "Giveaway ID", value: `#${giveaway.id}`, inline: true }, { name: "Hosted By", value: `<@${giveaway.hostId}>`, inline: true }, { name: "Status", value: giveaway.status.toUpperCase(), inline: true }, { name: "Winners", value: `${giveaway.winnerCount}`, inline: true }, { name: "Entries", value: `${giveaway.entries.length}`, inline: true }, { name: "Reward", value: rewardDetail, inline: false }, { name: "Role Requirement", value: giveaway.roleRequiredId ? `<@&${giveaway.roleRequiredId}>` : "None", inline: true }, { name: giveaway.status === "active" ? "Ends" : "Ended", value: giveaway.status === "active" ? `<t:${Math.floor(giveaway.endAt / 1000)}:R>\n<t:${Math.floor(giveaway.endAt / 1000)}:F>` : (giveaway.endedAt ? `<t:${Math.floor(giveaway.endedAt / 1000)}:R>` : "Ended"), inline: false }, { name: "Current Winners", value: winnersText, inline: false })
        .setFooter({ text: giveaway.status === "active" ? "Press Enter Giveaway below to participate." : "Giveaway closed." })
        .setTimestamp(new Date(giveaway.endAt));
}
function buildGiveawayActionRow(giveaway) {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(`${ids_1.GIVEAWAY_IDS.enterPrefix}:${giveaway.id}`)
        .setLabel(giveaway.status === "active" ? "Enter Giveaway" : "Giveaway Closed")
        .setEmoji("🎉")
        .setStyle(giveaway.status === "active" ? discord_js_1.ButtonStyle.Success : discord_js_1.ButtonStyle.Secondary)
        .setDisabled(giveaway.status !== "active"));
}
async function sendGiveawayLog(guildId, title, fields) {
    const state = (0, store_1.ensureGuildModeration)(guildId);
    const targetChannelId = state.modLogChannelId || config_1.MOD_LOG_CHANNEL_ID || config_1.ACTIVITY_CHANNEL_ID || config_1.HEALTH_REPORT_CHANNEL_ID;
    if (!targetChannelId)
        return;
    const guild = client_1.client.guilds.cache.get(guildId);
    if (!guild)
        return;
    const channel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased())
        return;
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle(`🎉 ${title}`)
        .addFields(fields), "FN Giveaway Desk", "Giveaway live feed");
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}
async function syncGiveawayMessage(giveaway) {
    if (!giveaway.messageId)
        return;
    const guild = client_1.client.guilds.cache.get(giveaway.guildId) || await client_1.client.guilds.fetch(giveaway.guildId).catch(() => null);
    if (!guild)
        return;
    const channel = guild.channels.cache.get(giveaway.channelId) || await guild.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
        return;
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (!message)
        return;
    await message.edit({ embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayActionRow(giveaway)] }).catch(() => undefined);
}
async function createAndPostGiveaway(input) {
    const giveaway = {
        id: exports.giveawayStore.nextId++,
        guildId: input.guild.id,
        channelId: input.channel.id,
        messageId: null,
        hostId: input.hostId,
        prize: input.prize,
        description: input.description,
        rewardKind: input.rewardKind,
        rewardItemId: input.rewardItemId || null,
        rewardQty: Math.max(1, input.rewardQty || 1),
        winnerCount: input.winnerCount,
        roleRequiredId: input.roleRequiredId,
        createdAt: Date.now(),
        endAt: Date.now() + input.durationMs,
        updatedAt: Date.now(),
        status: "active",
        entries: [],
        winners: [],
        endedAt: null
    };
    exports.giveawayStore.giveaways.push(giveaway);
    saveGiveawayStore();
    const allowedMentions = {
        parse: input.mentionEveryone ? ["everyone"] : [],
        users: input.mentionUserIds || [],
        roles: input.mentionRoleIds || []
    };
    const sent = await input.channel.send({ content: input.announcementContent || undefined, embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayActionRow(giveaway)], allowedMentions }).catch(() => null);
    if (!sent) {
        exports.giveawayStore.giveaways = exports.giveawayStore.giveaways.filter(entry => entry.id !== giveaway.id);
        saveGiveawayStore();
        return null;
    }
    giveaway.messageId = sent.id;
    giveaway.updatedAt = Date.now();
    saveGiveawayStore();
    return giveaway;
}
async function resolveConfiguredGiveawayChannel(guild) {
    if (!config_1.GIVEAWAY_CHANNEL_ID)
        return null;
    const channel = guild.channels.cache.get(config_1.GIVEAWAY_CHANNEL_ID) || await guild.channels.fetch(config_1.GIVEAWAY_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
        return null;
    return channel;
}
function buildGiveawayAnnouncement(input) {
    const mentions = [
        input.pingEveryone ? "@everyone" : null,
        input.mentionRoleId ? `<@&${input.mentionRoleId}>` : null,
        input.mentionUserId ? `<@${input.mentionUserId}>` : null
    ].filter(Boolean);
    return [
        mentions.join(" ").trim() || null,
        `A new giveaway is now live: **${input.prize}**`
    ].filter(Boolean).join("\n");
}
async function finalizeGiveaway(giveaway, reason = "timer") {
    if (giveaway.status !== "active" && reason !== "reroll")
        return;
    if (reason !== "reroll") {
        giveaway.status = "ended";
        giveaway.endedAt = Date.now();
    }
    giveaway.winners = giveaway.entries.length ? pickGiveawayWinners(giveaway) : [];
    if (giveaway.rewardKind === "item" && giveaway.rewardItemId) {
        for (const winnerId of giveaway.winners) {
            (0, utils_1.addInventoryItem)(winnerId, giveaway.rewardItemId, giveaway.rewardQty);
        }
    }
    giveaway.updatedAt = Date.now();
    saveGiveawayStore();
    await syncGiveawayMessage(giveaway);
    const guild = client_1.client.guilds.cache.get(giveaway.guildId) || await client_1.client.guilds.fetch(giveaway.guildId).catch(() => null);
    const channel = guild ? (guild.channels.cache.get(giveaway.channelId) || await guild.channels.fetch(giveaway.channelId).catch(() => null)) : null;
    if (channel && channel.isTextBased()) {
        const content = giveaway.winners.length
            ? `🎉 Giveaway #${giveaway.id} ended! Winner${giveaway.winners.length === 1 ? "" : "s"}: ${giveaway.winners.map(id => `<@${id}>`).join(", ")} | Prize: **${giveaway.prize}**`
            : `Giveaway #${giveaway.id} ended with no valid entrants for **${giveaway.prize}**.`;
        await channel.send({ content, allowedMentions: { users: giveaway.winners, parse: [] } }).catch(() => undefined);
    }
    (0, audit_1.appendAuditEvent)(reason === "reroll" ? "giveaway_reroll" : "giveaway_end", {
        guildId: giveaway.guildId,
        giveawayId: giveaway.id,
        channelId: giveaway.channelId,
        winnerIds: giveaway.winners,
        prize: giveaway.prize,
        reason
    });
    await sendGiveawayLog(giveaway.guildId, reason === "reroll" ? `Giveaway #${giveaway.id} Rerolled` : `Giveaway #${giveaway.id} Ended`, [
        { name: "Prize", value: giveaway.prize, inline: false },
        { name: "Winners", value: giveaway.winners.length ? giveaway.winners.map(id => `<@${id}>`).join(", ") : "No valid entrants", inline: false },
        { name: "Entries", value: `${giveaway.entries.length}`, inline: true }
    ]);
}
async function processDueGiveaways(now = Date.now()) {
    const due = exports.giveawayStore.giveaways.filter(giveaway => giveaway.status === "active" && giveaway.endAt <= now);
    for (const giveaway of due) {
        await finalizeGiveaway(giveaway, "timer");
    }
}
async function refreshActiveGiveawayEmbeds(now = Date.now()) {
    const active = exports.giveawayStore.giveaways.filter(giveaway => giveaway.status === "active" && giveaway.endAt > now);
    for (const giveaway of active) {
        await syncGiveawayMessage(giveaway);
    }
}
