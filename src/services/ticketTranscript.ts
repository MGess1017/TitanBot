import { ChannelType, Guild } from "discord.js";
import fs from "fs-extra";
import path from "path";
import { clampTranscriptLine, sanitizeTranscriptLine } from "./ticketText";

const TRANSCRIPT_FETCH_PAGE_LIMIT = 10;
const TRANSCRIPT_FETCH_BATCH_SIZE = 100;
const TRANSCRIPT_MESSAGE_LIMIT = 1000;

export type TicketTranscriptStub = {
    exportedAt: number;
    messageCountApprox: number;
    firstMessageAt: number | null;
    lastMessageAt: number | null;
    channelName: string;
    transcriptPath?: string;
    transcriptFormat?: "txt";
    truncated?: boolean;
    fetchErrors?: number;
};

export async function buildTicketTranscriptStub(guild: Guild, channelId: string): Promise<TicketTranscriptStub | null> {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return null;

    const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const messages = fetched ? Array.from(fetched.values()) : [];
    const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const firstMessageAt = sorted.length ? sorted[0].createdTimestamp : null;
    const lastMessageAt = sorted.length ? sorted[sorted.length - 1].createdTimestamp : null;

    return {
        exportedAt: Date.now(),
        messageCountApprox: messages.length,
        firstMessageAt,
        lastMessageAt,
        channelName: channel.name
    };
}

export async function exportTicketTranscript(input: {
    guild: Guild;
    channelId: string;
    ticketId: number;
    ownerId: string;
    resolverId: string;
    resolvedReason: string;
    transcriptDir: string;
    projectRootDir: string;
}): Promise<{ transcriptPath: string | null; messageCount: number; truncated: boolean; fetchErrors: number }> {
    const { guild, channelId, ticketId, ownerId, resolverId, resolvedReason, transcriptDir, projectRootDir } = input;
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
        return { transcriptPath: null, messageCount: 0, truncated: false, fetchErrors: 0 };
    }

    const allMessages: any[] = [];
    let fetchErrors = 0;
    let truncated = false;
    let beforeId: string | undefined;
    for (let i = 0; i < TRANSCRIPT_FETCH_PAGE_LIMIT; i++) {
        const batch = await channel.messages.fetch({
            limit: TRANSCRIPT_FETCH_BATCH_SIZE,
            ...(beforeId ? { before: beforeId } : {})
        }).catch(() => null);
        if (!batch) {
            fetchErrors += 1;
            break;
        }
        if (!batch || !batch.size) break;
        allMessages.push(...Array.from(batch.values()));
        if (allMessages.length >= TRANSCRIPT_MESSAGE_LIMIT) {
            truncated = true;
            allMessages.length = TRANSCRIPT_MESSAGE_LIMIT;
            break;
        }
        const last = batch.last();
        beforeId = last?.id;
        if (!beforeId) break;
    }

    if (!truncated && allMessages.length >= TRANSCRIPT_FETCH_PAGE_LIMIT * TRANSCRIPT_FETCH_BATCH_SIZE) {
        truncated = true;
    }

    const sorted = allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = [
        `Ticket #${ticketId} Transcript`,
        `Guild: ${guild.name} (${guild.id})`,
        `Channel: ${channel.name} (${channel.id})`,
        `Owner: ${ownerId}`,
        `Resolved By: ${resolverId}`,
        `Resolved Reason: ${sanitizeTranscriptLine(resolvedReason)}`,
        `Exported At: ${new Date().toISOString()}`,
        `Messages: ${sorted.length}`,
        `Truncated: ${truncated ? "yes" : "no"}`,
        `Fetch Errors: ${fetchErrors}`,
        "",
        "--- Messages ---"
    ];

    for (const msg of sorted) {
        const stamp = new Date(msg.createdTimestamp).toISOString();
        const author = `${msg.author?.tag || msg.author?.username || "unknown"} (${msg.author?.id || "unknown"})`;
        const content = sanitizeTranscriptLine(msg.content || "");
        const attachments = msg.attachments?.size
            ? ` | attachments: ${Array.from(msg.attachments.values()).map((a: any) => a.url).join(", ")}`
            : "";
        const line = `[${stamp}] ${author}: ${content || "(no text content)"}${attachments}`;
        lines.push(clampTranscriptLine(line));
    }

    try {
        fs.ensureDirSync(transcriptDir);
        const safeChannel = String(channel.name || "ticket").replace(/[^a-z0-9-]/gi, "-").slice(0, 32);
        const fileName = `ticket-${ticketId}-${safeChannel}-${Date.now()}.txt`;
        const fullPath = path.join(transcriptDir, fileName);
        fs.writeFileSync(fullPath, lines.join("\n"), "utf8");

        const relativePath = path.relative(projectRootDir, fullPath).replace(/\\/g, "/");
        return { transcriptPath: relativePath, messageCount: sorted.length, truncated, fetchErrors };
    } catch {
        return { transcriptPath: null, messageCount: sorted.length, truncated, fetchErrors };
    }
}
