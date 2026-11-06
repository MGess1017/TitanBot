// Ticket and raid-item giveaway panels.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild } from "discord.js";
import {
    PERMANENT_TICKET_PANEL_CHANNEL_ID, REPORT_ADMIN_PANEL_CHANNEL_ID, REPORT_PANEL_CHANNEL_ID
} from "../core/config";
import { client } from "../core/client";
import { appendAuditEvent } from "../core/audit";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { type ComponentLike, type ComponentRowLike, type MessageWithComponents } from "../tickets/store";
import { upsertAdminReportPanelInChannel } from "./reportPanels";
import { GIVEAWAY_IDS, REPORT_IDS, TICKET_IDS } from "../ui/ids";
import { brandLiveEmbed } from "../ui/embeds";

export function buildTicketPanelPayload(guildName: string) {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🎫 FN Support Desk")
        .setDescription([
            "• Click **Open Support Ticket** and tell us what you need.",
            "• Your ticket is private between you and the support team.",
            "• Add screenshots, message links, or order details when relevant.",
            "• Continue an existing open case instead of opening a duplicate."
        ].join("\n")), "FNT Support", `${guildName} support panel`);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(TICKET_IDS.open)
            .setLabel("Open Support Ticket")
            .setEmoji("🎫")
            .setStyle(ButtonStyle.Success)
    );

    return {
        embed: embed.toJSON(),
        components: [row.toJSON()],
        isTicketPanel: true
    };
}

export function buildRaidItemGiveawayPanelPayload(guildName: string) {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🎁 Titan Raid Item Giveaway Desk")
        .setDescription([
            `Create auto-awarded raid item giveaways for **${guildName}** using the full raid item catalog.`,
            "",
            "This panel is admin-facing and creates giveaways where winners automatically receive the configured raid item in inventory."
        ].join("\n"))
        .addFields(
            { name: "Modes", value: "• `/giveaway` for any freeform prize\n• `/itemgiveaway` for slash-driven raid item rewards\n• Button below for quick raid-item creation", inline: false },
            { name: "Auto Reward", value: "Raid-item giveaways automatically deliver the selected item to each winner when the giveaway ends.", inline: false }
        ), "Titan Giveaway Control", `${guildName} raid item giveaway panel`);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(GIVEAWAY_IDS.raidPanelOpen)
            .setLabel("Create Raid Item Giveaway")
            .setEmoji("🎁")
            .setStyle(ButtonStyle.Primary)
    );

    return { embed: embed.toJSON(), components: [row.toJSON()] };
}

function messageHasTicketOpenButton(message: MessageWithComponents | null | undefined): boolean {
    const rows = Array.isArray(message?.components) ? message.components : [];
    return rows.some((row: ComponentRowLike) => {
        const components = Array.isArray(row?.components) ? row.components : [];
        return components.some((component: ComponentLike) => component?.customId === TICKET_IDS.open);
    });
}

function messageHasReportOpenButton(message: MessageWithComponents | null | undefined): boolean {
    const rows = Array.isArray(message?.components) ? message.components : [];
    return rows.some((row: ComponentRowLike) => {
        const components = Array.isArray(row?.components) ? row.components : [];
        return components.some((component: ComponentLike) => component?.customId === REPORT_IDS.open);
    });
}

export async function upsertTicketPanelInChannel(guild: Guild, channelId: string): Promise<{ ok: true; action: "posted" | "updated" } | { ok: false; error: string }> {
    const channel = (guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) {
        return { ok: false, error: "Configured ticket panel channel is missing or not a text channel." };
    }

    const { embed, components } = buildTicketPanelPayload(guild.name);

    let candidateId: string | null = null;
    let beforeId: string | undefined;
    const expectedTitle = "🎫 FN Support Desk";
    for (let i = 0; i < 5; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) });
        if (!batch.size) break;

        const candidate = batch.find(message =>
            message.author.id === (client.user?.id || "")
            && (messageHasTicketOpenButton(message as MessageWithComponents) || message.embeds[0]?.title === expectedTitle || message.embeds[0]?.title === "⌛ FN Support Desk")
        );
        if (candidate) {
            candidateId = candidate.id;
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
            return { ok: false, error: "Failed to refresh ticket panel message. Check bot permissions for this channel." };
        }
        return { ok: true, action: "updated" };
    }

    const sent = await channel.send({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        return { ok: false, error: "Failed to post ticket panel message. Check bot permissions for this channel." };
    }
    return { ok: true, action: "posted" };
}

export async function ensurePermanentTicketPanelForGuild(guild: Guild): Promise<void> {
    if (!PERMANENT_TICKET_PANEL_CHANNEL_ID) return;
    const result = await upsertTicketPanelInChannel(guild, PERMANENT_TICKET_PANEL_CHANNEL_ID);
    if (result.ok) {
        appendAuditEvent("ticket_panel_permanent_upsert", {
            guildId: guild.id,
            channelId: PERMANENT_TICKET_PANEL_CHANNEL_ID,
            action: result.action
        });
    } else {
        appendAuditEvent("ticket_panel_permanent_upsert_failed", {
            guildId: guild.id,
            channelId: PERMANENT_TICKET_PANEL_CHANNEL_ID,
            error: result.error
        });
        console.warn(`Permanent ticket panel upsert skipped for guild ${guild.id}: ${result.error}`);
    }
}

export async function removeLegacyReportPanelForGuild(guild: Guild): Promise<void> {
    if (!REPORT_PANEL_CHANNEL_ID) return;
    const channel = guild.channels.cache.get(REPORT_PANEL_CHANNEL_ID) || await guild.channels.fetch(REPORT_PANEL_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const storedReportPanelId = getGuildPanelMessageId(guild.id, "report");
    if (storedReportPanelId) {
        const stored = await channel.messages.fetch(storedReportPanelId).catch(() => null);
        await stored?.delete().catch(() => undefined);
        setGuildPanelMessageId(guild.id, "report", null);
    }

    let beforeId: string | undefined;
    for (let i = 0; i < 6; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
        if (!batch || !batch.size) break;

        const legacy = batch.filter(message =>
            message.author.id === (client.user?.id || "")
            && (message.embeds[0]?.title === "🚨 FN Report Desk" || messageHasReportOpenButton(message as MessageWithComponents))
        );
        for (const message of legacy.values()) {
            await message.delete().catch(() => undefined);
        }

        const last = batch.last();
        beforeId = last?.id;
        if (!beforeId) break;
    }
}

export async function ensureAdminReportPanelForGuild(guild: Guild): Promise<void> {
    if (!REPORT_ADMIN_PANEL_CHANNEL_ID) return;
    const result = await upsertAdminReportPanelInChannel(guild, REPORT_ADMIN_PANEL_CHANNEL_ID);
    if (result.ok) {
        appendAuditEvent("admin_report_panel_upsert", {
            guildId: guild.id,
            channelId: REPORT_ADMIN_PANEL_CHANNEL_ID,
            action: result.action
        });
    } else {
        appendAuditEvent("admin_report_panel_upsert_failed", {
            guildId: guild.id,
            channelId: REPORT_ADMIN_PANEL_CHANNEL_ID,
            error: result.error
        });
        console.warn(`Admin report panel upsert skipped for guild ${guild.id}: ${result.error}`);
    }
}
