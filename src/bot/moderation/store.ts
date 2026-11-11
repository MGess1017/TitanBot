// Moderation storage, member reports, and mod logs.
import { ChannelType, EmbedBuilder, Guild, User } from "discord.js";
import { MOD_DATA_FILE, MOD_LOG_CHANNEL_ID, REPORT_LOG_CHANNEL_ID } from "../core/config";
import { client } from "../core/client";
import { appendAuditEvent } from "../core/audit";
import { readJsonWithBackup, writeJsonAtomic } from "../core/storage";
import { brandLiveEmbed } from "../ui/embeds";

type WarnEntry = {
    caseId: number;
    moderatorId: string;
    reason: string;
    timestamp: number;
};

type UserReportEntry = {
    id: number;
    reporterId: string;
    targetUserId: string;
    targetTag: string;
    summary: string;
    details: string;
    evidence: string | null;
    status: "open" | "resolved";
    createdAt: number;
    resolvedAt: number | null;
    resolvedById: string | null;
    resolutionNote: string | null;
};

type GuildModerationState = {
    modLogChannelId: string | null;
    lockdownChannelId: string | null;
    nextCaseId: number;
    nextReportId?: number;
    reports?: UserReportEntry[];
    warnings: Record<string, WarnEntry[]>;
    panelMessageIds?: {
        welcome?: string | null;
        report?: string | null;
        reportAdmin?: string | null;
        featureBrief?: string | null;
        roleSelector?: string | null;
        voiceCreator?: string | null;
        playerCount?: string | null;
        inquiry?: string | null;
        staffEmbed?: string | null;
        owner?: string | null;
        store?: string | null;
        storeAdmin?: string | null;
        xpLeaderboard?: string | null;
        xpCrate?: string | null;
        checkpointCard?: string | null;
    };
};

export type GuildPanelKey = keyof NonNullable<GuildModerationState["panelMessageIds"]>;

type ModerationStore = {
    guilds: Record<string, GuildModerationState>;
};

function readModerationStore(): ModerationStore {
    return readJsonWithBackup(MOD_DATA_FILE, raw => {
        const candidate = raw as Partial<ModerationStore>;
        if (candidate && candidate.guilds && typeof candidate.guilds === "object") {
            return { guilds: candidate.guilds };
        }
        return null;
    }, { guilds: {} });
}

const moderationStore = readModerationStore();

export function saveModerationStore(): void {
    writeJsonAtomic(MOD_DATA_FILE, moderationStore);
}

export function ensureGuildModeration(guildId: string): GuildModerationState {
    if (!moderationStore.guilds[guildId]) {
        moderationStore.guilds[guildId] = {
            modLogChannelId: MOD_LOG_CHANNEL_ID || null,
            lockdownChannelId: null,
            nextCaseId: 1,
            nextReportId: 1,
            reports: [],
            warnings: {},
            panelMessageIds: {}
        };
        saveModerationStore();
    }

    const g = moderationStore.guilds[guildId] as Partial<GuildModerationState>;
    if (!g.modLogChannelId) g.modLogChannelId = MOD_LOG_CHANNEL_ID || null;
    if (g.lockdownChannelId === undefined) g.lockdownChannelId = null;
    if (g.nextCaseId === undefined || g.nextCaseId < 1) g.nextCaseId = 1;
    if (g.nextReportId === undefined || g.nextReportId < 1) g.nextReportId = 1;
    if (!Array.isArray(g.reports)) g.reports = [];
    if (!g.warnings || typeof g.warnings !== "object") g.warnings = {};
    if (!g.panelMessageIds || typeof g.panelMessageIds !== "object") g.panelMessageIds = {};
    moderationStore.guilds[guildId] = g as GuildModerationState;
    saveModerationStore();
    return moderationStore.guilds[guildId];
}

export function getGuildPanelMessageId(guildId: string, panel: GuildPanelKey): string | null {
    const cfg = ensureGuildModeration(guildId);
    const value = cfg.panelMessageIds?.[panel];
    return value ? String(value) : null;
}

export function setGuildPanelMessageId(guildId: string, panel: GuildPanelKey, messageId: string | null): void {
    const cfg = ensureGuildModeration(guildId);
    if (!cfg.panelMessageIds) cfg.panelMessageIds = {};
    cfg.panelMessageIds[panel] = messageId;
    saveModerationStore();
}

export function getGuildUserReports(guildId: string): UserReportEntry[] {
    return ensureGuildModeration(guildId).reports || [];
}

function createGuildUserReport(input: {
    guildId: string;
    reporterId: string;
    targetUserId: string;
    targetTag: string;
    summary: string;
    details: string;
    evidence: string | null;
}): UserReportEntry {
    const cfg = ensureGuildModeration(input.guildId);
    const entry: UserReportEntry = {
        id: cfg.nextReportId || 1,
        reporterId: input.reporterId,
        targetUserId: input.targetUserId,
        targetTag: input.targetTag,
        summary: input.summary.slice(0, 180),
        details: input.details.slice(0, 900),
        evidence: input.evidence ? input.evidence.slice(0, 500) : null,
        status: "open",
        createdAt: Date.now(),
        resolvedAt: null,
        resolvedById: null,
        resolutionNote: null
    };
    cfg.nextReportId = (cfg.nextReportId || 1) + 1;
    if (!cfg.reports) cfg.reports = [];
    cfg.reports.push(entry);
    saveModerationStore();
    return entry;
}

async function sendFormalUserReportLog(guild: Guild, entry: UserReportEntry): Promise<void> {
    const channel = guild.channels.cache.get(REPORT_LOG_CHANNEL_ID) || await guild.channels.fetch(REPORT_LOG_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0xb91c1c)
        .setTitle(`Report #${entry.id} Filed`)
        .addFields(
            { name: "Target", value: `<@${entry.targetUserId}> (${entry.targetTag})`, inline: false },
            { name: "Reporter", value: `<@${entry.reporterId}>`, inline: true },
            { name: "Status", value: entry.status.toUpperCase(), inline: true },
            { name: "Summary", value: entry.summary || "No summary provided.", inline: false },
            { name: "Details", value: entry.details || "No details provided.", inline: false },
            { name: "Evidence", value: entry.evidence || "Not provided", inline: false }
        )
        .setTimestamp(new Date(entry.createdAt)), "FN Admin Report Ledger", `${guild.name} report log`);

    await channel.send({ embeds: [embed.toJSON()], allowedMentions: { parse: [] } }).catch(() => undefined);
}

export function parseUserIdFromReportTarget(raw: string): string | null {
    const trimmed = raw.trim();
    const mentionMatch = trimmed.match(/^<@!?(\d{17,21})>$/);
    if (mentionMatch) return mentionMatch[1];
    if (/^\d{17,21}$/.test(trimmed)) return trimmed;
    return null;
}

export async function submitFormalUserReport(input: {
    guild: Guild;
    reporterId: string;
    targetUser: User;
    summary: string;
    details: string;
    evidence: string | null;
}): Promise<{ entry: UserReportEntry; totalReportsForTarget: number; flagged: boolean }> {
    const entry = createGuildUserReport({
        guildId: input.guild.id,
        reporterId: input.reporterId,
        targetUserId: input.targetUser.id,
        targetTag: input.targetUser.tag || input.targetUser.username,
        summary: input.summary,
        details: input.details,
        evidence: input.evidence
    });

    await sendFormalUserReportLog(input.guild, entry);
    await sendModLog(input.guild.id, `Formal Report Filed #${entry.id}`, [
        { name: "Reporter", value: `<@${entry.reporterId}>`, inline: true },
        { name: "Target", value: `<@${entry.targetUserId}>`, inline: true },
        { name: "Status", value: entry.status.toUpperCase(), inline: true },
        { name: "Summary", value: entry.summary || "No summary provided.", inline: false },
        { name: "Evidence", value: entry.evidence || "Not provided", inline: false }
    ]);

    const totalReportsForTarget = getGuildUserReports(input.guild.id)
        .filter(report => report.targetUserId === input.targetUser.id)
        .length;
    const flagged = totalReportsForTarget >= 10;

    appendAuditEvent("report_intake_submitted", {
        guildId: input.guild.id,
        reportId: entry.id,
        reporterId: input.reporterId,
        targetUserId: input.targetUser.id,
        summary: entry.summary,
        evidenceProvided: Boolean(input.evidence),
        totalReportsForTarget,
        flagged
    });

    return { entry, totalReportsForTarget, flagged };
}

async function sendFormalUserReportResolutionLog(guild: Guild, entry: UserReportEntry): Promise<void> {
    const channel = guild.channels.cache.get(REPORT_LOG_CHANNEL_ID) || await guild.channels.fetch(REPORT_LOG_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x16a34a)
        .setTitle(`Report #${entry.id} Resolved`)
        .addFields(
            { name: "Target", value: `<@${entry.targetUserId}> (${entry.targetTag})`, inline: false },
            { name: "Reporter", value: `<@${entry.reporterId}>`, inline: true },
            { name: "Resolved By", value: entry.resolvedById ? `<@${entry.resolvedById}>` : "Unknown", inline: true },
            { name: "Disposition", value: entry.resolutionNote || "No note provided.", inline: false },
            { name: "Summary", value: entry.summary || "No summary provided.", inline: false }
        )
        .setTimestamp(new Date(entry.resolvedAt || Date.now())), "FN Admin Report Ledger", `${guild.name} report resolution`);

    await channel.send({ embeds: [embed.toJSON()], allowedMentions: { parse: [] } }).catch(() => undefined);
}

export async function resolveFormalUserReport(input: {
    guild: Guild;
    actorId: string;
    targetUserId: string;
    action: string;
    reason: string;
    reportId?: number;
}): Promise<{ ok: true; entry: UserReportEntry; remainingOpenForTarget: number } | { ok: false; error: string }> {
    const cfg = ensureGuildModeration(input.guild.id);
    const reports = cfg.reports || [];
    const openForTarget = reports
        .filter(report => report.targetUserId === input.targetUserId && report.status === "open")
        .sort((a, b) => b.createdAt - a.createdAt);

    if (!openForTarget.length) {
        return { ok: false, error: "No open reports exist for that user." };
    }

    let entry: UserReportEntry | undefined;
    if (input.reportId && input.reportId > 0) {
        entry = openForTarget.find(report => report.id === input.reportId);
        if (!entry) {
            return { ok: false, error: "That report ID is not an open report for this user." };
        }
    } else {
        entry = openForTarget[0];
    }

    entry.status = "resolved";
    entry.resolvedAt = Date.now();
    entry.resolvedById = input.actorId;
    entry.resolutionNote = `[${input.action}] ${input.reason}`.slice(0, 300);
    saveModerationStore();

    await sendFormalUserReportResolutionLog(input.guild, entry);
    await sendModLog(input.guild.id, `Formal Report Resolved #${entry.id}`, [
        { name: "Resolved By", value: `<@${input.actorId}>`, inline: true },
        { name: "Target", value: `<@${entry.targetUserId}>`, inline: true },
        { name: "Disposition", value: input.action, inline: true },
        { name: "Reason", value: input.reason || "No reason provided.", inline: false },
        { name: "Remaining Open Reports On User", value: `${(cfg.reports || []).filter(report => report.targetUserId === input.targetUserId && report.status === "open").length}`, inline: true }
    ]);

    const remainingOpenForTarget = (cfg.reports || []).filter(report => report.targetUserId === input.targetUserId && report.status === "open").length;
    appendAuditEvent("report_resolve", {
        guildId: input.guild.id,
        reportId: entry.id,
        resolverId: input.actorId,
        targetUserId: input.targetUserId,
        action: input.action,
        reason: input.reason,
        remainingOpenForTarget
    });

    return { ok: true, entry, remainingOpenForTarget };
}

export function parseDurationMs(raw: string): number | null {
    const match = raw.trim().toLowerCase().match(/^(\d+)(s|m|h|d)$/);
    if (!match) return null;
    const value = Number.parseInt(match[1], 10);
    const unit = match[2];
    if (value < 1) return null;
    if (unit === "s") return value * 1000;
    if (unit === "m") return value * 60 * 1000;
    if (unit === "h") return value * 60 * 60 * 1000;
    return value * 24 * 60 * 60 * 1000;
}

export async function sendModLog(
    guildId: string,
    title: string,
    fields: Array<{ name: string; value: string; inline?: boolean }>
): Promise<void> {
    const state = ensureGuildModeration(guildId);
    const targetChannelId = state.modLogChannelId || MOD_LOG_CHANNEL_ID;
    if (!targetChannelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle(`🛡️ ${title}`)
        .setTimestamp(new Date())
        .addFields(fields), "FN Moderation Desk", "Moderation live feed");
    await channel.send({ embeds: [embed] }).catch(() => undefined);
}
