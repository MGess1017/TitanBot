// Live member count panel.
import { ChannelType, Guild, GuildMember } from "discord.js";
import { adjustPlayerCounts, buildPlayerCountEmbed, countPlayers, type PlayerCounts } from "../../runtime/playerCounts";
import { PLAYER_COUNT_CHANNEL_ID } from "../core/config";
import { client } from "../core/client";
import { runAsyncWithBoundary } from "../core/metrics";
import { appendAuditEvent } from "../core/audit";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";

const PLAYER_COUNTS_BY_GUILD = new Map<string, PlayerCounts>();
const PLAYER_COUNT_UPDATE_TIMERS = new Map<string, ReturnType<typeof setTimeout>>();

async function upsertPlayerCountPanelForGuild(guild: Guild, counts: PlayerCounts): Promise<void> {
    const channel = guild.channels.cache.get(PLAYER_COUNT_CHANNEL_ID)
        || await guild.channels.fetch(PLAYER_COUNT_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`[players] Count panel channel ${PLAYER_COUNT_CHANNEL_ID} is missing or is not a text channel.`);
        return;
    }

    const embed = buildPlayerCountEmbed(counts);
    const storedMessageId = getGuildPanelMessageId(guild.id, "playerCount");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) return;
        setGuildPanelMessageId(guild.id, "playerCount", null);
    }

    const recentMessages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const existing = recentMessages?.find(message =>
        message.author.id === (client.user?.id || "")
        && message.embeds[0]?.title === "FNT • Live Player Count"
    );
    if (existing) {
        const edited = await existing.edit({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) {
            setGuildPanelMessageId(guild.id, "playerCount", existing.id);
            return;
        }
    }

    const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(error => {
        console.warn(`[players] Could not post the live player-count panel in ${channel.id}:`, error);
        return null;
    });
    if (sent) setGuildPanelMessageId(guild.id, "playerCount", sent.id);
}

export async function ensurePlayerCountPanelForGuild(guild: Guild): Promise<void> {
    const members = await guild.members.fetch().catch(error => {
        console.warn(`[players] Could not fetch the full member list for ${guild.id}:`, error);
        return null;
    });
    if (!members) return;

    const counts = countPlayers(Array.from(members.values(), member => member.user.bot));
    PLAYER_COUNTS_BY_GUILD.set(guild.id, counts);
    await upsertPlayerCountPanelForGuild(guild, counts);
}

function schedulePlayerCountPanelUpdate(guild: Guild): void {
    const existingTimer = PLAYER_COUNT_UPDATE_TIMERS.get(guild.id);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
        PLAYER_COUNT_UPDATE_TIMERS.delete(guild.id);
        const counts = PLAYER_COUNTS_BY_GUILD.get(guild.id);
        if (counts) void upsertPlayerCountPanelForGuild(guild, counts);
    }, 750);
    PLAYER_COUNT_UPDATE_TIMERS.set(guild.id, timer);
    timer.unref();
}

export function trackGuildMemberChange(member: Pick<GuildMember, "guild" | "id" | "user">, direction: 1 | -1): void {
    const eventType = direction > 0 ? "guild_member_joined" : "guild_member_left";
    appendAuditEvent(eventType, {
        guildId: member.guild.id,
        userId: member.id,
        username: member.user.username,
        isBot: member.user.bot
    });

    const current = PLAYER_COUNTS_BY_GUILD.get(member.guild.id);
    if (!current) {
        runAsyncWithBoundary("playerCountPanelInit", () => ensurePlayerCountPanelForGuild(member.guild));
        return;
    }
    PLAYER_COUNTS_BY_GUILD.set(member.guild.id, adjustPlayerCounts(current, member.user.bot, direction));
    schedulePlayerCountPanelUpdate(member.guild);
}
