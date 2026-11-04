// Giveaway storage, embeds, entry, and winner selection.
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild, TextChannel
} from "discord.js";
import { addInventoryItem } from "../../utils";
import { ITEM_DEFS } from "../../game/catalog";
import {
    ACTIVITY_CHANNEL_ID, CLOSED_GIVEAWAY_RETENTION_MS, GIVEAWAY_CHANNEL_ID, GIVEAWAY_DATA_FILE,
    HEALTH_REPORT_CHANNEL_ID, MAX_CLOSED_GIVEAWAYS, MOD_LOG_CHANNEL_ID
} from "../core/config";
import { client } from "../core/client";
import { appendAuditEvent } from "../core/audit";
import { readJsonWithBackup, writeJsonAtomic } from "../core/storage";
import { ensureGuildModeration } from "../moderation/store";
import { GIVEAWAY_IDS } from "../ui/ids";
import { brandLiveEmbed } from "../ui/embeds";

type GiveawayStatus = "active" | "ended" | "cancelled";

type GiveawayEntry = {
    id: number;
    guildId: string;
    channelId: string;
    messageId: string | null;
    hostId: string;
    prize: string;
    description: string;
    rewardKind: "generic" | "item";
    rewardItemId: string | null;
    rewardQty: number;
    winnerCount: number;
    roleRequiredId: string | null;
    createdAt: number;
    endAt: number;
    updatedAt: number;
    status: GiveawayStatus;
    entries: string[];
    winners: string[];
    endedAt: number | null;
};

type GiveawayStore = {
    nextId: number;
    giveaways: GiveawayEntry[];
};

function normalizeGiveawayStore(raw: unknown): GiveawayStore | null {
    const candidate = raw as Partial<GiveawayStore>;
    if (!candidate || !Array.isArray(candidate.giveaways) || typeof candidate.nextId !== "number") return null;

    const giveaways: GiveawayEntry[] = candidate.giveaways
        .filter(row => Boolean(row && typeof row === "object"))
        .map(row => {
            const entry = row as Partial<GiveawayEntry>;
            const status: GiveawayStatus = entry.status === "ended" || entry.status === "cancelled" ? entry.status : "active";
            const rewardKind: GiveawayEntry["rewardKind"] = entry.rewardKind === "item" ? "item" : "generic";
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

export const giveawayStore = readJsonWithBackup<GiveawayStore>(
    GIVEAWAY_DATA_FILE,
    normalizeGiveawayStore,
    { nextId: 1, giveaways: [] }
);

function pruneGiveaways(now = Date.now()): void {
    const active = giveawayStore.giveaways.filter(entry => entry.status === "active");
    const closed = giveawayStore.giveaways
        .filter(entry => entry.status !== "active")
        .filter(entry => {
            const closedAt = entry.endedAt || entry.updatedAt || entry.endAt;
            return now - closedAt <= CLOSED_GIVEAWAY_RETENTION_MS;
        })
        .sort((a, b) => (b.endedAt || b.updatedAt || b.endAt) - (a.endedAt || a.updatedAt || a.endAt))
        .slice(0, MAX_CLOSED_GIVEAWAYS);

    giveawayStore.giveaways = [...active, ...closed];
}

export function saveGiveawayStore(): void {
    pruneGiveaways();
    writeJsonAtomic(GIVEAWAY_DATA_FILE, giveawayStore);
}

export function getGiveawayById(id: number): GiveawayEntry | null {
    return giveawayStore.giveaways.find(entry => entry.id === id) || null;
}

function shuffleUserIds(ids: string[]): string[] {
    const values = [...ids];
    for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
}

function pickGiveawayWinners(giveaway: GiveawayEntry): string[] {
    return shuffleUserIds(giveaway.entries).slice(0, Math.max(1, giveaway.winnerCount));
}

function buildGiveawayEmbed(giveaway: GiveawayEntry): EmbedBuilder {
    const winnersText = giveaway.winners.length ? giveaway.winners.map(id => `<@${id}>`).join(", ") : "Pending draw";
    const rewardDetail = giveaway.rewardKind === "item" && giveaway.rewardItemId
        ? `${ITEM_DEFS[giveaway.rewardItemId]?.name || giveaway.rewardItemId} x${giveaway.rewardQty}`
        : giveaway.prize;
    return new EmbedBuilder()
        .setColor(giveaway.status === "active" ? 0xf59e0b : 0x22c55e)
        .setTitle(`🎉 ${giveaway.prize}`)
        .setDescription(giveaway.description || "Press the button below to enter before the timer ends.")
        .addFields(
            { name: "Giveaway ID", value: `#${giveaway.id}`, inline: true },
            { name: "Hosted By", value: `<@${giveaway.hostId}>`, inline: true },
            { name: "Status", value: giveaway.status.toUpperCase(), inline: true },
            { name: "Winners", value: `${giveaway.winnerCount}`, inline: true },
            { name: "Entries", value: `${giveaway.entries.length}`, inline: true },
            { name: "Reward", value: rewardDetail, inline: false },
            { name: "Role Requirement", value: giveaway.roleRequiredId ? `<@&${giveaway.roleRequiredId}>` : "None", inline: true },
            { name: giveaway.status === "active" ? "Ends" : "Ended", value: giveaway.status === "active" ? `<t:${Math.floor(giveaway.endAt / 1000)}:R>\n<t:${Math.floor(giveaway.endAt / 1000)}:F>` : (giveaway.endedAt ? `<t:${Math.floor(giveaway.endedAt / 1000)}:R>` : "Ended"), inline: false },
            { name: "Current Winners", value: winnersText, inline: false }
        )
        .setFooter({ text: giveaway.status === "active" ? "Press Enter Giveaway below to participate." : "Giveaway closed." })
        .setTimestamp(new Date(giveaway.endAt));
}

function buildGiveawayActionRow(giveaway: GiveawayEntry): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`${GIVEAWAY_IDS.enterPrefix}:${giveaway.id}`)
            .setLabel(giveaway.status === "active" ? "Enter Giveaway" : "Giveaway Closed")
            .setEmoji("🎉")
            .setStyle(giveaway.status === "active" ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(giveaway.status !== "active")
    );
}

export async function sendGiveawayLog(guildId: string, title: string, fields: Array<{ name: string; value: string; inline?: boolean }>): Promise<void> {
    const state = ensureGuildModeration(guildId);
    const targetChannelId = state.modLogChannelId || MOD_LOG_CHANNEL_ID || ACTIVITY_CHANNEL_ID || HEALTH_REPORT_CHANNEL_ID;
    if (!targetChannelId) return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle(`🎉 ${title}`)
        .addFields(fields), "FN Giveaway Desk", "Giveaway live feed");
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

export async function syncGiveawayMessage(giveaway: GiveawayEntry): Promise<void> {
    if (!giveaway.messageId) return;
    const guild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
    if (!guild) return;
    const channel = guild.channels.cache.get(giveaway.channelId) || await guild.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (!message) return;
    await message.edit({ embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayActionRow(giveaway)] }).catch(() => undefined);
}

export async function createAndPostGiveaway(input: {
    guild: Guild;
    channel: TextChannel;
    hostId: string;
    prize: string;
    description: string;
    durationMs: number;
    winnerCount: number;
    roleRequiredId: string | null;
    rewardKind: "generic" | "item";
    rewardItemId?: string | null;
    rewardQty?: number;
    announcementContent?: string;
    mentionUserIds?: string[];
    mentionRoleIds?: string[];
    mentionEveryone?: boolean;
}): Promise<GiveawayEntry | null> {
    const giveaway: GiveawayEntry = {
        id: giveawayStore.nextId++,
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
    giveawayStore.giveaways.push(giveaway);
    saveGiveawayStore();

    const allowedMentions = {
        parse: input.mentionEveryone ? ["everyone"] as Array<"everyone"> : [],
        users: input.mentionUserIds || [],
        roles: input.mentionRoleIds || []
    };
    const sent = await input.channel.send({ content: input.announcementContent || undefined, embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayActionRow(giveaway)], allowedMentions }).catch(() => null);
    if (!sent) {
        giveawayStore.giveaways = giveawayStore.giveaways.filter(entry => entry.id !== giveaway.id);
        saveGiveawayStore();
        return null;
    }

    giveaway.messageId = sent.id;
    giveaway.updatedAt = Date.now();
    saveGiveawayStore();
    return giveaway;
}

export async function resolveConfiguredGiveawayChannel(guild: Guild): Promise<TextChannel | null> {
    if (!GIVEAWAY_CHANNEL_ID) return null;
    const channel = guild.channels.cache.get(GIVEAWAY_CHANNEL_ID) || await guild.channels.fetch(GIVEAWAY_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return channel;
}

export function buildGiveawayAnnouncement(input: {
    prize: string;
    mentionRoleId?: string | null;
    mentionUserId?: string | null;
    pingEveryone?: boolean;
}): string {
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

export async function finalizeGiveaway(giveaway: GiveawayEntry, reason: "timer" | "manual" | "reroll" = "timer"): Promise<void> {
    if (giveaway.status !== "active" && reason !== "reroll") return;
    if (reason !== "reroll") {
        giveaway.status = "ended";
        giveaway.endedAt = Date.now();
    }
    giveaway.winners = giveaway.entries.length ? pickGiveawayWinners(giveaway) : [];
    if (giveaway.rewardKind === "item" && giveaway.rewardItemId) {
        for (const winnerId of giveaway.winners) {
            addInventoryItem(winnerId, giveaway.rewardItemId, giveaway.rewardQty);
        }
    }
    giveaway.updatedAt = Date.now();
    saveGiveawayStore();
    await syncGiveawayMessage(giveaway);

    const guild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
    const channel = guild ? (guild.channels.cache.get(giveaway.channelId) || await guild.channels.fetch(giveaway.channelId).catch(() => null)) : null;
    if (channel && channel.isTextBased()) {
        const content = giveaway.winners.length
            ? `🎉 Giveaway #${giveaway.id} ended! Winner${giveaway.winners.length === 1 ? "" : "s"}: ${giveaway.winners.map(id => `<@${id}>`).join(", ")} | Prize: **${giveaway.prize}**`
            : `Giveaway #${giveaway.id} ended with no valid entrants for **${giveaway.prize}**.`;
        await channel.send({ content, allowedMentions: { users: giveaway.winners, parse: [] } }).catch(() => undefined);
    }

    appendAuditEvent(reason === "reroll" ? "giveaway_reroll" : "giveaway_end", {
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

export async function processDueGiveaways(now = Date.now()): Promise<void> {
    const due = giveawayStore.giveaways.filter(giveaway => giveaway.status === "active" && giveaway.endAt <= now);
    for (const giveaway of due) {
        await finalizeGiveaway(giveaway, "timer");
    }
}

export async function refreshActiveGiveawayEmbeds(now = Date.now()): Promise<void> {
    const active = giveawayStore.giveaways.filter(giveaway => giveaway.status === "active" && giveaway.endAt > now);
    for (const giveaway of active) {
        await syncGiveawayMessage(giveaway);
    }
}
