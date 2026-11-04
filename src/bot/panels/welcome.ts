// Welcome panel.
import { APIEmbed, ChannelType, EmbedBuilder, Guild } from "discord.js";
import { WELCOME_PANEL_CHANNEL_ID } from "../core/config";
import { client } from "../core/client";
import { appendAuditEvent } from "../core/audit";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { brandLiveEmbed } from "../ui/embeds";

function buildWelcomePayload(guildName: string) {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("Welcome to FN Tarkov")
        .addFields({
            name: "Discord Invite",
            value: "https://discord.gg/fnt"
        }), "Welcome Desk", `${guildName} welcome page`);

    return { embed: embed.toJSON() };
}

async function upsertWelcomePanelInChannel(guild: Guild, channelId: string): Promise<{ ok: true; action: "posted" | "updated" } | { ok: false; error: string }> {
    const channel = (guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) {
        return { ok: false, error: "Configured welcome panel channel is missing or not a text channel." };
    }

    const payload = buildWelcomePayload(guild.name);
    const embed = payload.embed as APIEmbed;

    const storedMessageId = getGuildPanelMessageId(guild.id, "welcome");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) {
            return { ok: true, action: "updated" };
        }
        setGuildPanelMessageId(guild.id, "welcome", null);
    }

    let candidateId: string | null = null;
    const duplicateIds: string[] = [];
    let beforeId: string | undefined;
    const expectedTitle = "Welcome to FN Tarkov";
    for (let i = 0; i < 10; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
        if (!batch || !batch.size) break;

        const candidates = batch.filter(message =>
            message.author.id === (client.user?.id || "")
            && (
                message.embeds[0]?.title === expectedTitle
                || message.embeds[0]?.footer?.text?.includes("welcome page")
            )
        );
        const candidate = candidates.first();
        if (candidate) {
            candidateId = candidate.id;
            for (const duplicate of candidates.values()) {
                if (duplicate.id !== candidate.id) duplicateIds.push(duplicate.id);
            }
            break;
        }

        const last = batch.last();
        beforeId = last?.id;
        if (!beforeId) break;
    }

    if (candidateId) {
        const candidate = await channel.messages.fetch(candidateId).catch(() => null);
        const edited = await candidate?.edit({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        if (!edited) {
            return { ok: false, error: "Failed to refresh welcome panel message. Check bot permissions for this channel." };
        }
        setGuildPanelMessageId(guild.id, "welcome", candidateId);
        for (const duplicateId of duplicateIds) {
            if (duplicateId === candidateId) continue;
            const duplicate = await channel.messages.fetch(duplicateId).catch(() => null);
            await duplicate?.delete().catch(() => undefined);
        }
        return { ok: true, action: "updated" };
    }

    const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        return { ok: false, error: "Failed to post welcome panel message. Check bot permissions for this channel." };
    }
    setGuildPanelMessageId(guild.id, "welcome", sent.id);
    return { ok: true, action: "posted" };
}

export async function ensureWelcomePanelForGuild(guild: Guild): Promise<void> {
    if (!WELCOME_PANEL_CHANNEL_ID) return;
    const result = await upsertWelcomePanelInChannel(guild, WELCOME_PANEL_CHANNEL_ID);
    if (result.ok) {
        appendAuditEvent("welcome_panel_upsert", {
            guildId: guild.id,
            channelId: WELCOME_PANEL_CHANNEL_ID,
            action: result.action
        });
    } else {
        appendAuditEvent("welcome_panel_upsert_failed", {
            guildId: guild.id,
            channelId: WELCOME_PANEL_CHANNEL_ID,
            error: result.error
        });
        console.warn(`Welcome panel upsert skipped for guild ${guild.id}: ${result.error}`);
    }
}
