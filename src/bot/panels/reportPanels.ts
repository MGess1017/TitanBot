// Admin report panel.
import { ActionRowBuilder, APIEmbed, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild } from "discord.js";
import { REPORT_LOG_CHANNEL_ID } from "../core/config";
import { client } from "../core/client";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { REPORT_IDS } from "../ui/ids";
import { brandLiveEmbed } from "../ui/embeds";

function buildAdminReportPanelPayload(guildName: string) {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("🛡️ Admin Report Panel")
        .setDescription([
            "Administrator-only formal report intake panel.",
            "",
            "Use this to file tracked reports against players.",
            `All submitted reports are automatically logged to <#${REPORT_LOG_CHANNEL_ID}>.`
        ].join("\n"))
        .addFields(
            { name: "Scope", value: "Reports against players only. Support requests must use the support ticket panel.", inline: false },
            { name: "Access", value: "Admins only", inline: true },
            { name: "Server", value: guildName, inline: true }
        ), "FN Admin Report Control", `${guildName} admin report panel`);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(REPORT_IDS.adminOpen)
            .setLabel("File User Report")
            .setEmoji("🚨")
            .setStyle(ButtonStyle.Danger)
    );

    return { embed: embed.toJSON(), components: [row.toJSON()] };
}

export async function upsertAdminReportPanelInChannel(guild: Guild, channelId: string): Promise<{ ok: true; action: "posted" | "updated" } | { ok: false; error: string }> {
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        return { ok: false, error: "Configured admin report panel channel is missing or not a text channel." };
    }

    const payload = buildAdminReportPanelPayload(guild.name);
    const embed = payload.embed as APIEmbed;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(REPORT_IDS.adminOpen)
            .setLabel("File User Report")
            .setEmoji("🚨")
            .setStyle(ButtonStyle.Danger)
    );

    const storedMessageId = getGuildPanelMessageId(guild.id, "reportAdmin");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) {
            return { ok: true, action: "updated" };
        }
        setGuildPanelMessageId(guild.id, "reportAdmin", null);
    }

    let candidateId: string | null = null;
    const duplicateIds: string[] = [];
    let beforeId: string | undefined;
    for (let i = 0; i < 8; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
        if (!batch || !batch.size) break;

        const candidates = batch.filter(message =>
            message.author.id === (client.user?.id || "")
            && (
                message.embeds[0]?.title === "🛡️ Admin Report Panel"
                || message.embeds[0]?.footer?.text?.includes("admin report panel")
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
        const edited = await candidate?.edit({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
        if (!edited) {
            return { ok: false, error: "Failed to refresh admin report panel message. Check bot permissions for this channel." };
        }
        setGuildPanelMessageId(guild.id, "reportAdmin", candidateId);
        for (const duplicateId of duplicateIds) {
            if (duplicateId === candidateId) continue;
            const duplicate = await channel.messages.fetch(duplicateId).catch(() => null);
            await duplicate?.delete().catch(() => undefined);
        }
        return { ok: true, action: "updated" };
    }

    const sent = await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        return { ok: false, error: "Failed to post admin report panel message. Check bot permissions for this channel." };
    }
    setGuildPanelMessageId(guild.id, "reportAdmin", sent.id);
    return { ok: true, action: "posted" };
}
