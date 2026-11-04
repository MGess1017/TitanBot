// Ticket record helpers: lookups, state changes, notes, and logs.
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild, PermissionFlagsBits
} from "discord.js";
import https from "node:https";
import type { TicketTranscriptStub } from "../../services/ticketTranscript";
import { sanitizeTranscriptLine } from "../../services/ticketText";
import {
    archiveTicketByChannel as stateArchiveTicketByChannel, assignTicketToUser as stateAssignTicketToUser,
    claimTicketByChannel as stateClaimTicketByChannel, createTicketEntry as stateCreateTicketEntry,
    getTicketSlaState as stateGetTicketSlaState, reopenTicketByChannel as stateReopenTicketByChannel,
    resolveTicketByChannel as stateResolveTicketByChannel, setTicketPanelMessageId as stateSetTicketPanelMessageId,
    setTicketWorkflowStatus as stateSetTicketWorkflowStatus
} from "../../services/ticketState";
import type { TicketNote } from "../../services/ticketEnhancements";
import { client } from "../core/client";
import { appendAuditEvent } from "../core/audit";
import {
    ensureTicketConfig, findTicketByChannel, saveTicketStore, type TicketEntry, type TicketPriority, ticketStore,
    type TicketWorkflowStatus
} from "./store";
import { TICKET_IDS } from "../ui/ids";
import { brandLiveEmbed } from "../ui/embeds";

export function buildTicketCsatButtons(ticketId: number): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:1`).setLabel("1").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:2`).setLabel("2").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:3`).setLabel("3").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:4`).setLabel("4").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:5`).setLabel("5").setStyle(ButtonStyle.Success)
    );
}

export function addTicketInternalNote(ticket: TicketEntry, note: TicketNote): boolean {
    if (!ticket.internalNotes) ticket.internalNotes = [];
    ticket.internalNotes.push({ ...note, note: sanitizeTranscriptLine(note.note).slice(0, 500) });
    ticket.updatedAt = Date.now();
    return saveTicketStore();
}

export function postJsonToWebhook(webhookUrlRaw: string, payload: Record<string, unknown>): Promise<boolean> {
    return new Promise(resolve => {
        let webhookUrl: URL;
        try {
            webhookUrl = new URL(webhookUrlRaw);
        } catch {
            resolve(false);
            return;
        }

        const body = JSON.stringify(payload);
        const req = https.request({
            protocol: webhookUrl.protocol,
            hostname: webhookUrl.hostname,
            port: webhookUrl.port || (webhookUrl.protocol === "https:" ? 443 : 80),
            path: `${webhookUrl.pathname}${webhookUrl.search}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            }
        }, res => {
            const ok = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
            res.resume();
            resolve(ok);
        });

        req.on("error", () => resolve(false));
        req.write(body);
        req.end();
    });
}

export async function pruneDeletedTicketRecords(guild: Guild): Promise<number> {
    let removed = 0;
    for (let i = ticketStore.tickets.length - 1; i >= 0; i--) {
        const ticket = ticketStore.tickets[i];
        if (ticket.guildId !== guild.id) continue;

        const channel = guild.channels.cache.get(ticket.channelId)
            || await guild.channels.fetch(ticket.channelId).catch(() => null);
        if (channel) continue;

        ticketStore.tickets.splice(i, 1);
        removed += 1;
        appendAuditEvent("ticket_prune_deleted_channel", {
            guildId: guild.id,
            ticketId: ticket.id,
            channelId: ticket.channelId,
            ownerId: ticket.ownerId,
            priorStatus: ticket.status
        });
    }

    if (removed > 0) {
        saveTicketStore();
    }

    return removed;
}

export async function pruneInaccessibleOwnerTicketRecords(guild: Guild): Promise<number> {
    let removed = 0;
    for (let i = ticketStore.tickets.length - 1; i >= 0; i--) {
        const ticket = ticketStore.tickets[i];
        if (ticket.guildId !== guild.id) continue;
        if (!(ticket.status === "open" || ticket.status === "claimed")) continue;

        const channel = guild.channels.cache.get(ticket.channelId)
            || await guild.channels.fetch(ticket.channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) continue;

        const owner = await guild.members.fetch(ticket.ownerId).catch(() => null);
        const ownerCanView = owner ? channel.permissionsFor(owner)?.has(PermissionFlagsBits.ViewChannel) : false;
        if (ownerCanView) continue;

        ticketStore.tickets.splice(i, 1);
        removed += 1;
        appendAuditEvent("ticket_prune_inaccessible_owner", {
            guildId: guild.id,
            ticketId: ticket.id,
            channelId: ticket.channelId,
            ownerId: ticket.ownerId,
            priorStatus: ticket.status
        });
    }

    if (removed > 0) {
        saveTicketStore();
    }

    return removed;
}

export function purgeLegacyImportedTicketRecords(guildId: string): number {
    const legacyReasons = new Set([
        "Imported existing ticket channel",
        "Imported from known ticket button channel"
    ]);
    const before = ticketStore.tickets.length;
    ticketStore.tickets = ticketStore.tickets.filter(ticket => !(
        ticket.guildId === guildId && legacyReasons.has(ticket.reason)
    ));
    const removed = before - ticketStore.tickets.length;
    if (removed > 0) {
        saveTicketStore();
        appendAuditEvent("ticket_legacy_import_purge", { guildId, removed });
    }
    return removed;
}

export function findChannelOwnerFromTopic(topic: string | null | undefined): string | null {
    if (!topic) return null;
    const match = topic.match(/\((\d{17,21})\)\s*$/);
    if (!match) return null;
    return match[1];
}

export async function ensureTrackedTicketByChannelId(_guild: Guild, channelId: string, _fallbackOwnerId: string): Promise<TicketEntry | null> {
    const existing = findTicketByChannel(channelId);
    if (existing) return existing;
    return null;
}

export function createTicketEntry(guildId: string, ownerId: string, channelId: string, reason: string, priority: TicketPriority): TicketEntry | null {
    return stateCreateTicketEntry(ticketStore, guildId, ownerId, channelId, reason, priority, saveTicketStore);
}

export function archiveTicketByChannel(channelId: string, closeReason: string): TicketEntry | null {
    return stateArchiveTicketByChannel(ticketStore.tickets, channelId, closeReason, saveTicketStore);
}

export function claimTicketByChannel(channelId: string, claimedById: string): TicketEntry | null {
    return stateClaimTicketByChannel(ticketStore.tickets, channelId, claimedById, saveTicketStore);
}

export function resolveTicketByChannel(channelId: string, resolvedReason: string, transcript: TicketTranscriptStub | null): TicketEntry | null {
    return stateResolveTicketByChannel(ticketStore.tickets, channelId, resolvedReason, transcript, saveTicketStore);
}

export function setTicketWorkflowStatus(channelId: string, workflowStatus: TicketWorkflowStatus): TicketEntry | null {
    return stateSetTicketWorkflowStatus(ticketStore.tickets, channelId, workflowStatus, saveTicketStore);
}

export function assignTicketToUser(channelId: string, assigneeId: string): TicketEntry | null {
    return stateAssignTicketToUser(ticketStore.tickets, channelId, assigneeId, saveTicketStore);
}

export function reopenTicketByChannel(channelId: string, reopenedById: string, reopenReason: string): TicketEntry | null {
    return stateReopenTicketByChannel(ticketStore.tickets, channelId, reopenedById, reopenReason, saveTicketStore);
}

export function getTicketSlaState(
    ticket: TicketEntry,
    now = Date.now(),
    thresholds?: { firstResponseWarnMs: number; firstResponseBreachMs: number; resolveWarnMs: number; resolveBreachMs: number }
): { firstResponseOverdue: boolean; resolveOverdue: boolean } {
    return stateGetTicketSlaState(ticket, now, thresholds);
}

export function setTicketPanelMessageId(channelId: string, panelMessageId: string): void {
    stateSetTicketPanelMessageId(ticketStore.tickets, channelId, panelMessageId, saveTicketStore);
}

export async function sendTicketLog(
    guildId: string,
    title: string,
    fields: Array<{ name: string; value: string; inline?: boolean }>
): Promise<void> {
    const cfg = ensureTicketConfig(guildId);
    if (!cfg.logChannelId) return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(cfg.logChannelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x2dd4bf)
        .setTitle(`🎫 ${title}`)
        .setTimestamp(new Date())
        .addFields(fields), "FN Support Ticket Stream", "Ticket event feed");
    await channel.send({ embeds: [embed] }).catch(() => undefined);
}

export async function ticketChannelNotice(guild: Guild, ticket: TicketEntry, message: string): Promise<void> {
    const channel = guild.channels.cache.get(ticket.channelId);
    if (channel?.type === ChannelType.GuildText) await channel.send({ content: message, allowedMentions: { parse: [] } }).catch(() => undefined);
}
