// Live XP leaderboard and XP crate panels.
import { ChannelType } from "discord.js";
import { getLeaderboard } from "../../game/economy";
import { upsertXpLeaderboardPanel } from "../../features/xpLeaderboard";
import { upsertXpCratePanel } from "../../features/xpCratePanel";
import { client } from "../core/client";
import { getCurrentVoiceXpMultiplier } from "../xp/engagement";
import { getXpPanelChannelId } from "../core/settings";
import { runAsyncWithBoundary } from "../core/metrics";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";

let xpLeaderboardUpdateTimer: ReturnType<typeof setTimeout> | null = null;
let xpLeaderboardUpdateInFlight = false;

export async function refreshXpLeaderboardPanel(): Promise<void> {
    if (!client.isReady() || xpLeaderboardUpdateInFlight) return;
    xpLeaderboardUpdateInFlight = true;
    try {
        const channelId = getXpPanelChannelId();
        const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error(`XP leaderboard channel ${channelId} is missing or is not a text channel.`);
        }
        const now = Date.now();
        const entries = await Promise.all(getLeaderboard().map(async row => {
            const user = await client.users.fetch(row.id);
            const voiceMultiplier = getCurrentVoiceXpMultiplier(channel.guild, row.id, now);
            return { ...row, username: user.username, voiceMultiplier };
        }));
        const previousId = getGuildPanelMessageId(channel.guild.id, "xpLeaderboard");
        const messageId = await upsertXpLeaderboardPanel(channel, client.user.id, previousId, entries);
        if (messageId !== previousId) setGuildPanelMessageId(channel.guild.id, "xpLeaderboard", messageId);
    } finally {
        xpLeaderboardUpdateInFlight = false;
    }
}

export async function ensureXpCratePanel(): Promise<void> {
    if (!client.isReady()) return;
    const channelId = getXpPanelChannelId();
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error(`XP crate panel channel ${channelId} is missing or is not a text channel.`);
    }
    const previousId = getGuildPanelMessageId(channel.guild.id, "xpCrate");
    const messageId = await upsertXpCratePanel(channel, client.user.id, previousId);
    if (previousId !== messageId) setGuildPanelMessageId(channel.guild.id, "xpCrate", messageId);
}

export function scheduleXpLeaderboardUpdate(): void {
    if (xpLeaderboardUpdateTimer) return;
    xpLeaderboardUpdateTimer = setTimeout(() => {
        xpLeaderboardUpdateTimer = null;
        runAsyncWithBoundary("xpLeaderboardUpdate", refreshXpLeaderboardPanel);
    }, 1000);
    xpLeaderboardUpdateTimer.unref();
}
