"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePlayerCountPanelForGuild = ensurePlayerCountPanelForGuild;
exports.trackGuildMemberChange = trackGuildMemberChange;
// Live member count panel.
const discord_js_1 = require("discord.js");
const playerCounts_1 = require("../../runtime/playerCounts");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const metrics_1 = require("../core/metrics");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const PLAYER_COUNTS_BY_GUILD = new Map();
const PLAYER_COUNT_UPDATE_TIMERS = new Map();
async function upsertPlayerCountPanelForGuild(guild, counts) {
    const channel = guild.channels.cache.get(config_1.PLAYER_COUNT_CHANNEL_ID)
        || await guild.channels.fetch(config_1.PLAYER_COUNT_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        console.warn(`[players] Count panel channel ${config_1.PLAYER_COUNT_CHANNEL_ID} is missing or is not a text channel.`);
        return;
    }
    const embed = (0, playerCounts_1.buildPlayerCountEmbed)(counts);
    const storedMessageId = (0, store_1.getGuildPanelMessageId)(guild.id, "playerCount");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        if (edited)
            return;
        (0, store_1.setGuildPanelMessageId)(guild.id, "playerCount", null);
    }
    const recentMessages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const existing = recentMessages?.find(message => message.author.id === (client_1.client.user?.id || "")
        && message.embeds[0]?.title === "FNT • Live Player Count");
    if (existing) {
        const edited = await existing.edit({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) {
            (0, store_1.setGuildPanelMessageId)(guild.id, "playerCount", existing.id);
            return;
        }
    }
    const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(error => {
        console.warn(`[players] Could not post the live player-count panel in ${channel.id}:`, error);
        return null;
    });
    if (sent)
        (0, store_1.setGuildPanelMessageId)(guild.id, "playerCount", sent.id);
}
async function ensurePlayerCountPanelForGuild(guild) {
    const members = await guild.members.fetch().catch(error => {
        console.warn(`[players] Could not fetch the full member list for ${guild.id}:`, error);
        return null;
    });
    if (!members)
        return;
    const counts = (0, playerCounts_1.countPlayers)(Array.from(members.values(), member => member.user.bot));
    PLAYER_COUNTS_BY_GUILD.set(guild.id, counts);
    await upsertPlayerCountPanelForGuild(guild, counts);
}
function schedulePlayerCountPanelUpdate(guild) {
    const existingTimer = PLAYER_COUNT_UPDATE_TIMERS.get(guild.id);
    if (existingTimer)
        clearTimeout(existingTimer);
    const timer = setTimeout(() => {
        PLAYER_COUNT_UPDATE_TIMERS.delete(guild.id);
        const counts = PLAYER_COUNTS_BY_GUILD.get(guild.id);
        if (counts)
            void upsertPlayerCountPanelForGuild(guild, counts);
    }, 750);
    PLAYER_COUNT_UPDATE_TIMERS.set(guild.id, timer);
    timer.unref();
}
function trackGuildMemberChange(member, direction) {
    const eventType = direction > 0 ? "guild_member_joined" : "guild_member_left";
    (0, audit_1.appendAuditEvent)(eventType, {
        guildId: member.guild.id,
        userId: member.id,
        username: member.user.username,
        isBot: member.user.bot
    });
    const current = PLAYER_COUNTS_BY_GUILD.get(member.guild.id);
    if (!current) {
        (0, metrics_1.runAsyncWithBoundary)("playerCountPanelInit", () => ensurePlayerCountPanelForGuild(member.guild));
        return;
    }
    PLAYER_COUNTS_BY_GUILD.set(member.guild.id, (0, playerCounts_1.adjustPlayerCounts)(current, member.user.bot, direction));
    schedulePlayerCountPanelUpdate(member.guild);
}
