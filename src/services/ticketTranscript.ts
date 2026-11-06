import { ChannelType, Guild, type Message } from "discord.js";
import fs from "fs-extra";
import path from "path";
import { sanitizeTranscriptLine } from "./ticketText";
import { createHash } from "node:crypto";

const TRANSCRIPT_FETCH_PAGE_LIMIT = 101;
const TRANSCRIPT_FETCH_BATCH_SIZE = 100;

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
}): Promise<{ transcriptPath: string; messageCount: number; truncated: false; fetchErrors: 0; stub: TicketTranscriptStub }> {
    const { guild, channelId, ticketId, ownerId, resolverId, resolvedReason, transcriptDir, projectRootDir } = input;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error("Transcript channel is missing or not a text channel.");
    }

    const allMessages: Message[] = [];
    let complete = false;
    let beforeId: string | undefined;
    for (let i = 0; i < TRANSCRIPT_FETCH_PAGE_LIMIT; i++) {
        const batch = await channel.messages.fetch({
            limit: TRANSCRIPT_FETCH_BATCH_SIZE,
            ...(beforeId ? { before: beforeId } : {})
        });
        if (!batch.size) { complete = true; break; }
        allMessages.push(...Array.from(batch.values()));
        if (allMessages.length > 10_000) throw new Error("Ticket exceeds the 10,000-message export limit. Preserve the channel for a manual export.");
        if (batch.size < TRANSCRIPT_FETCH_BATCH_SIZE) { complete = true; break; }
        const last = batch.last();
        if (!last || last.id === beforeId) throw new Error("Transcript pagination did not advance.");
        beforeId = last?.id;
    }

    if (!complete) throw new Error("Ticket exceeds the 10,000-message export limit. Preserve the channel for a manual export.");

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
        "Truncated: no",
        "Fetch Errors: 0",
        "",
        "--- Messages ---"
    ];

    for (const msg of sorted) {
        const stamp = new Date(msg.createdTimestamp).toISOString();
        const author = `${msg.author?.tag || msg.author?.username || "unknown"} (${msg.author?.id || "unknown"})`;
        const content = sanitizeTranscriptLine(msg.content || "");
        const attachments = msg.attachments?.size
            ? ` | attachments: ${Array.from(msg.attachments.values()).map(attachment => attachment.url).join(", ")}`
            : "";
        const line = `[${stamp}] ${author}: ${content || "(no text content)"}${attachments}`;
        lines.push(line);
        for (const embed of msg.embeds) lines.push(`  Embed: ${sanitizeTranscriptLine(JSON.stringify(embed.toJSON()))}`);
    }

    fs.ensureDirSync(transcriptDir);
    const safeChannel = String(channel.name || "ticket").replace(/[^a-z0-9-]/gi, "-").slice(0, 32);
    const fileName = `ticket-${ticketId}-${safeChannel}-${Date.now()}.txt`;
    const fullPath = path.join(transcriptDir, fileName);
    const body = lines.join("\n");
    const temporaryPath = `${fullPath}.${process.pid}.tmp`;
    try {
        const descriptor = fs.openSync(temporaryPath, "wx");
        try {
            fs.writeFileSync(descriptor, body, "utf8");
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporaryPath, fullPath);
        const expected = createHash("sha256").update(body).digest("hex");
        const actual = createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
        if (actual !== expected) throw new Error("Transcript verification failed.");
    } finally {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
    const relativePath = path.relative(projectRootDir, fullPath).replace(/\\/g, "/");
    return {
        transcriptPath: relativePath, messageCount: sorted.length, truncated: false, fetchErrors: 0,
        stub: {
            exportedAt: Date.now(), messageCountApprox: sorted.length,
            firstMessageAt: sorted[0]?.createdTimestamp || null,
            lastMessageAt: sorted[sorted.length - 1]?.createdTimestamp || null,
            channelName: channel.name, transcriptPath: relativePath, transcriptFormat: "txt",
            truncated: false, fetchErrors: 0
        }
    };
}
