"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshXpLeaderboardPanel = refreshXpLeaderboardPanel;
exports.ensureXpCratePanel = ensureXpCratePanel;
exports.scheduleXpLeaderboardUpdate = scheduleXpLeaderboardUpdate;
// Live XP leaderboard and XP crate panels.
const discord_js_1 = require("discord.js");
const economy_1 = require("../../game/economy");
const xpLeaderboard_1 = require("../../features/xpLeaderboard");
const xpCratePanel_1 = require("../../features/xpCratePanel");
const client_1 = require("../core/client");
const engagement_1 = require("../xp/engagement");
const settings_1 = require("../core/settings");
const metrics_1 = require("../core/metrics");
const store_1 = require("../moderation/store");
let xpLeaderboardUpdateTimer = null;
let xpLeaderboardUpdateInFlight = false;
async function refreshXpLeaderboardPanel() {
    if (!client_1.client.isReady() || xpLeaderboardUpdateInFlight)
        return;
    xpLeaderboardUpdateInFlight = true;
    try {
        const channelId = (0, settings_1.getXpPanelChannelId)();
        const channel = client_1.client.channels.cache.get(channelId) || await client_1.client.channels.fetch(channelId);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
            throw new Error(`XP leaderboard channel ${channelId} is missing or is not a text channel.`);
        }
        const now = Date.now();
        const entries = await Promise.all((0, economy_1.getLeaderboard)().map(async (row) => {
            const user = await client_1.client.users.fetch(row.id);
            const voiceMultiplier = (0, engagement_1.getCurrentVoiceXpMultiplier)(channel.guild, row.id, now);
            return { ...row, username: user.username, voiceMultiplier };
        }));
        const previousId = (0, store_1.getGuildPanelMessageId)(channel.guild.id, "xpLeaderboard");
        const messageId = await (0, xpLeaderboard_1.upsertXpLeaderboardPanel)(channel, client_1.client.user.id, previousId, entries);
        if (messageId !== previousId)
            (0, store_1.setGuildPanelMessageId)(channel.guild.id, "xpLeaderboard", messageId);
    }
    finally {
        xpLeaderboardUpdateInFlight = false;
    }
}
async function ensureXpCratePanel() {
    if (!client_1.client.isReady())
        return;
    const channelId = (0, settings_1.getXpPanelChannelId)();
    const channel = client_1.client.channels.cache.get(channelId) || await client_1.client.channels.fetch(channelId);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        throw new Error(`XP crate panel channel ${channelId} is missing or is not a text channel.`);
    }
    const previousId = (0, store_1.getGuildPanelMessageId)(channel.guild.id, "xpCrate");
    const messageId = await (0, xpCratePanel_1.upsertXpCratePanel)(channel, client_1.client.user.id, previousId);
    if (previousId !== messageId)
        (0, store_1.setGuildPanelMessageId)(channel.guild.id, "xpCrate", messageId);
}
function scheduleXpLeaderboardUpdate() {
    if (xpLeaderboardUpdateTimer)
        return;
    xpLeaderboardUpdateTimer = setTimeout(() => {
        xpLeaderboardUpdateTimer = null;
        (0, metrics_1.runAsyncWithBoundary)("xpLeaderboardUpdate", refreshXpLeaderboardPanel);
    }, 1000);
    xpLeaderboardUpdateTimer.unref();
}
