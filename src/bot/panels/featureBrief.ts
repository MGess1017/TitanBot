// Bot feature brief panel.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, DiscordAPIError, EmbedBuilder, Guild } from "discord.js";
import { BOT_FEATURE_BRIEF_CHANNEL_ID, PERMANENT_TICKET_PANEL_CHANNEL_ID } from "../core/config";
import { client } from "../core/client";
import { appendAuditEvent } from "../core/audit";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { ONBOARDING_IDS } from "../ui/ids";
import { brandLiveEmbed } from "../ui/embeds";

export function buildBotFeatureBriefPayload() {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("Welcome to FNT")
        .setDescription([
            "• **Your profile:** `/profile` shows progress, achievements, and cosmetics.",
            "• **Start free:** claim FN Token$ with `/daily`.",
            "• **Go raiding:** `/raid` earns loot and PMC XP. Start with a small bet and low risk.",
            "• **Earn server XP:** chat or join voice, then check `/xp`.",
            `• **Need help?** Open a private ticket in <#${PERMANENT_TICKET_PANEL_CHANNEL_ID}>.`
        ].join("\n")), "FNT", "FNT • Member Guide");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ONBOARDING_IDS.start).setLabel("Get Started").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ONBOARDING_IDS.commands).setLabel("Command Guide").setStyle(ButtonStyle.Secondary)
    );

    return {
        embed: embed.toJSON(),
        components: [row.toJSON()],
        isBotFeatureBrief: true
    };
}

async function upsertBotFeatureBriefInChannel(guild: Guild, channelId: string): Promise<{ ok: true; action: "posted" | "updated" } | { ok: false; error: string }> {
    const channel = (guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) {
        return { ok: false, error: "Configured bot feature brief channel is missing or not a text channel." };
    }

    const { embed, components } = buildBotFeatureBriefPayload();

    const storedMessageId = getGuildPanelMessageId(guild.id, "featureBrief");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(error => {
            if (error instanceof DiscordAPIError && error.code === 10008) return null;
            throw error;
        });
        if (stored && stored.author.id === client.user?.id) {
            await stored.edit({ embeds: [embed], components, allowedMentions: { parse: [] } });
            return { ok: true, action: "updated" };
        }
        setGuildPanelMessageId(guild.id, "featureBrief", null);
    }

    let candidateId: string | null = null;
    const duplicateIds: string[] = [];
    let beforeId: string | undefined;
    const expectedPrefix = `🛰️ ${guild.name} • About Titan Bot`;
    for (let i = 0; i < 10; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) });
        if (!batch.size) break;

        const candidates = batch.filter(message =>
            message.author.id === (client.user?.id || "")
            && (
                message.embeds[0]?.title === "Welcome to FNT"
                || message.embeds[0]?.footer?.text?.includes("FNT • Member Guide")
                || message.embeds[0]?.title === expectedPrefix
                || message.embeds[0]?.footer?.text?.includes("About Titan Bot")
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
        const edited = await candidate?.edit({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
        if (!edited) {
            return { ok: false, error: "Failed to refresh bot feature brief message. Check bot permissions for this channel." };
        }
        setGuildPanelMessageId(guild.id, "featureBrief", candidateId);
        for (const duplicateId of duplicateIds) {
            if (duplicateId === candidateId) continue;
            const duplicate = await channel.messages.fetch(duplicateId).catch(() => null);
            await duplicate?.delete().catch(error => {
                console.warn(`Could not remove duplicate welcome panel ${duplicateId}:`, error);
            });
        }
        return { ok: true, action: "updated" };
    }

    const sent = await channel.send({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        return { ok: false, error: "Failed to post bot feature brief message. Check bot permissions for this channel." };
    }
    setGuildPanelMessageId(guild.id, "featureBrief", sent.id);
    return { ok: true, action: "posted" };
}

export async function ensureBotFeatureBriefForGuild(guild: Guild): Promise<void> {
    if (!BOT_FEATURE_BRIEF_CHANNEL_ID) return;
    const result = await upsertBotFeatureBriefInChannel(guild, BOT_FEATURE_BRIEF_CHANNEL_ID);
    if (result.ok) {
        appendAuditEvent("bot_feature_brief_upsert", {
            guildId: guild.id,
            channelId: BOT_FEATURE_BRIEF_CHANNEL_ID,
            action: result.action
        });
    } else {
        appendAuditEvent("bot_feature_brief_upsert_failed", {
            guildId: guild.id,
            channelId: BOT_FEATURE_BRIEF_CHANNEL_ID,
            error: result.error
        });
        console.warn(`Bot feature brief upsert skipped for guild ${guild.id}: ${result.error}`);
    }
}
