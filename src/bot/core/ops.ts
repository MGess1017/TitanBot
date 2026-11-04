// Ops alerts, command idempotency/rate limits, presence, instance lock, and startup preflight.
import { ActivityType, ChatInputCommandInteraction } from "discord.js";
import fs from "fs-extra";
import crypto from "node:crypto";
import https from "node:https";
import os from "node:os";
import path from "path";
import { rejectIfRateLimited } from "../../runtime/rateLimit";
import "./env";
import {
    BALANCE_TELEMETRY_FILE, CASINO_ACTION_RATE_LIMIT_WINDOW_MS, COMMAND_IDEMPOTENCY_WINDOW_MS,
    COMMAND_RATE_LIMIT_WINDOW_MS, EVENT_LOG_FILE, MOD_DATA_FILE, MOD_LOG_EVENT_RETENTION_MS, OPS_ALERT_COOLDOWN_MS,
    OPS_ALERT_RETENTION_MS, OPS_ALERT_WEBHOOK_URL, OPS_DEAD_LETTER_FILE, POINTS_DATA_FILE, PREFIX,
    STRICT_ENV_REQUIRED, TICKET_CREATE_LOCK_MAX_AGE_MS, TICKET_DATA_FILE, TRADE_DATA_FILE, XP_ROLE_DATA_FILE
} from "./config";
import { client } from "./client";
import { type CasinoGameKey } from "../ui/ids";

const opsAlertLastSent = new Map<string, number>();
const recentCommandExecutions = new Map<string, number>();
export const inFlightTicketCreates = new Map<string, number>();
const recentModerationLogEvents = new Map<string, number>();
export const INSTANCE_LOCK_PATH = path.join(
    os.tmpdir(),
    `titan-raid-bot.${crypto.createHash("sha1").update(String(process.env.DISCORD_TOKEN || "no-token")).digest("hex").slice(0, 12)}.lock`
);
export let hasInstanceLock = false;

function shouldSendOpsAlert(key: string): boolean {
    const now = Date.now();
    for (const [entryKey, ts] of opsAlertLastSent.entries()) {
        if (now - ts > OPS_ALERT_RETENTION_MS) opsAlertLastSent.delete(entryKey);
    }
    const last = opsAlertLastSent.get(key) || 0;
    if (now - last < OPS_ALERT_COOLDOWN_MS) return false;
    opsAlertLastSent.set(key, now);
    return true;
}

export function toSafeString(value: unknown): string {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function postOpsAlert(level: "warn" | "error", title: string, details: Record<string, unknown> = {}): void {
    if (!OPS_ALERT_WEBHOOK_URL) return;

    const key = `${level}:${title}`;
    if (!shouldSendOpsAlert(key)) return;

    let webhookUrl: URL;
    try {
        webhookUrl = new URL(OPS_ALERT_WEBHOOK_URL);
    } catch {
        console.error("OPS_ALERT_WEBHOOK_URL is invalid.");
        return;
    }

    const detailLines = Object.entries(details)
        .map(([k, v]) => `${k}: ${toSafeString(v)}`)
        .slice(0, 12);

    const content = [
        `**Titan Bot ${level.toUpperCase()}**`,
        title,
        ...detailLines
    ].join("\n");

    const body = JSON.stringify({
        username: "Titan Ops Alerts",
        content: content.slice(0, 1800)
    });

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
        if (res.statusCode && res.statusCode >= 400) {
            console.error(`Ops alert webhook failed with status ${res.statusCode}.`);
        }
        res.resume();
    });

    req.on("error", error => {
        console.error(`Ops alert webhook error: ${toSafeString(error)}`);
        try {
            fs.appendFileSync(OPS_DEAD_LETTER_FILE, `${JSON.stringify({ at: Date.now(), level, title, details, error: toSafeString(error) })}\n`, "utf8");
        } catch {
            // Alert failures must never interrupt bot operation.
        }
    });

    req.write(body);
    req.end();
}

export function pruneRecentCommandExecutions(now = Date.now()): void {
    if (COMMAND_IDEMPOTENCY_WINDOW_MS <= 0) return;
    for (const [key, ts] of recentCommandExecutions.entries()) {
        if (now - ts > COMMAND_IDEMPOTENCY_WINDOW_MS) {
            recentCommandExecutions.delete(key);
        }
    }
}

function commandExecutionKey(interaction: ChatInputCommandInteraction, fingerprint: string): string {
    return `${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.commandName}:${fingerprint}`;
}

export function rejectIfDuplicateCommand(interaction: ChatInputCommandInteraction, fingerprint: string): string | null {
    if (COMMAND_IDEMPOTENCY_WINDOW_MS <= 0) return null;
    pruneRecentCommandExecutions();

    const key = commandExecutionKey(interaction, fingerprint);
    const now = Date.now();
    const last = recentCommandExecutions.get(key);
    if (last && (now - last) <= COMMAND_IDEMPOTENCY_WINDOW_MS) {
        return "Duplicate command detected. Please wait a few seconds before retrying.";
    }

    recentCommandExecutions.set(key, now);
    return null;
}

export function rejectIfRateLimitedForInteraction(interaction: ChatInputCommandInteraction): string | null {
    if (COMMAND_RATE_LIMIT_WINDOW_MS <= 0) return null;
    const key = `${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.commandName}`;
    return rejectIfRateLimited(key, COMMAND_RATE_LIMIT_WINDOW_MS);
}

export function rejectIfRateLimitedForCasinoAction(guildId: string | null, userId: string, gameKey: CasinoGameKey): string | null {
    if (CASINO_ACTION_RATE_LIMIT_WINDOW_MS <= 0) return null;
    const key = `${guildId || "dm"}:${userId}:casino:${gameKey}`;
    return rejectIfRateLimited(key, CASINO_ACTION_RATE_LIMIT_WINDOW_MS);
}

export function updateBotPresence(): void {
    if (!client.user) return;

    const guildCount = client.guilds.cache.size;
    const label = guildCount > 0
        ? `${PREFIX}help • ${guildCount} server${guildCount === 1 ? "" : "s"}`
        : `${PREFIX}help`;

    void client.user.setPresence({
        activities: [{ name: label, type: ActivityType.Playing }],
        status: "online"
    });
}

export function tryAcquireTicketCreateLock(guildId: string, ownerId: string): boolean {
    const now = Date.now();
    for (const [entryKey, ts] of inFlightTicketCreates.entries()) {
        if (now - ts > TICKET_CREATE_LOCK_MAX_AGE_MS) inFlightTicketCreates.delete(entryKey);
    }

    const key = `${guildId}:${ownerId}`;
    if (inFlightTicketCreates.has(key)) return false;
    inFlightTicketCreates.set(key, now);
    return true;
}

export function releaseTicketCreateLock(guildId: string, ownerId: string): void {
    inFlightTicketCreates.delete(`${guildId}:${ownerId}`);
}

export function pruneInMemoryRuntimeState(now = Date.now()): void {
    pruneRecentCommandExecutions(now);

    for (const [entryKey, ts] of inFlightTicketCreates.entries()) {
        if (now - ts > TICKET_CREATE_LOCK_MAX_AGE_MS) inFlightTicketCreates.delete(entryKey);
    }

    for (const [entryKey, ts] of recentModerationLogEvents.entries()) {
        if (now - ts > MOD_LOG_EVENT_RETENTION_MS) recentModerationLogEvents.delete(entryKey);
    }

    for (const [entryKey, ts] of opsAlertLastSent.entries()) {
        if (now - ts > OPS_ALERT_RETENTION_MS) opsAlertLastSent.delete(entryKey);
    }
}

function isProcessAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function acquireInstanceLock(): { ok: true } | { ok: false; reason: string } {
    const now = Date.now();
    const payload = JSON.stringify({ pid: process.pid, startedAt: now });

    try {
        fs.writeFileSync(INSTANCE_LOCK_PATH, payload, { flag: "wx" });
        hasInstanceLock = true;
        return { ok: true };
    } catch {
        const state = readInstanceLockState();
        if (state.ownerPid && state.ownerAlive) {
            return { ok: false, reason: `Another bot instance appears active (PID ${state.ownerPid}).` };
        }
        try {
            fs.writeFileSync(INSTANCE_LOCK_PATH, payload, { flag: "w" });
            hasInstanceLock = true;
            return { ok: true };
        } catch {
            return { ok: false, reason: "Unable to acquire singleton lock file." };
        }
    }
}

export function releaseInstanceLock(): void {
    if (!hasInstanceLock) return;
    try {
        const state = readInstanceLockState();
        if (!state.ownerPid || state.ownerPid === process.pid || !state.ownerAlive) {
            fs.removeSync(INSTANCE_LOCK_PATH);
        }
    } catch {
        // Best effort cleanup only.
    } finally {
        hasInstanceLock = false;
    }
}

export async function runStartupPreflight(): Promise<{ errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!process.env.DISCORD_TOKEN) {
        errors.push("DISCORD_TOKEN is missing.");
    }
    const optionalDefaults: Array<{ key: string; message: string }> = [
        { key: "TICKET_HANDLER_ROLE_ID", message: "TICKET_HANDLER_ROLE_ID not set; using built-in default role id." },
        { key: "TICKET_DEFAULT_CATEGORY_ID", message: "TICKET_DEFAULT_CATEGORY_ID not set; using built-in default category id." },
        { key: "PERMANENT_TICKET_PANEL_CHANNEL_ID", message: "PERMANENT_TICKET_PANEL_CHANNEL_ID not set; using built-in default channel id." },
        { key: "BOT_FEATURE_BRIEF_CHANNEL_ID", message: "BOT_FEATURE_BRIEF_CHANNEL_ID not set; using built-in default channel id." },
        { key: "WELCOME_PANEL_CHANNEL_ID", message: "WELCOME_PANEL_CHANNEL_ID not set; using built-in default channel id." },
        { key: "MOD_LOG_CHANNEL_ID", message: "MOD_LOG_CHANNEL_ID not set; using built-in default channel id." },
        { key: "DEPLOYMENT_SUMMARY_CHANNEL_ID", message: "DEPLOYMENT_SUMMARY_CHANNEL_ID not set; using built-in default channel id." }
    ];

    for (const requirement of optionalDefaults) {
        if (!process.env[requirement.key]) {
            if (STRICT_ENV_REQUIRED) errors.push(`${requirement.key} is required in strict env mode.`);
            else warnings.push(requirement.message);
        }
    }

    if (STRICT_ENV_REQUIRED && !process.env.DISCORD_GUILD_ID) {
        errors.push("DISCORD_GUILD_ID is required in strict env mode.");
    }

    const writablePaths = [
        POINTS_DATA_FILE,
        MOD_DATA_FILE,
        TRADE_DATA_FILE,
        TICKET_DATA_FILE,
        BALANCE_TELEMETRY_FILE,
        EVENT_LOG_FILE,
        XP_ROLE_DATA_FILE
    ];

    for (const filePath of writablePaths) {
        try {
            fs.ensureDirSync(path.dirname(filePath));
            const probePath = `${filePath}.probe`;
            fs.writeFileSync(probePath, "");
            fs.unlinkSync(probePath);
        } catch {
            errors.push(`Path is not writable: ${filePath}`);
        }
    }

    return { errors, warnings };
}

export function summarizePreflightMessages(messages: string[], limit = 3): string {
    if (messages.length === 0) return "none";
    const preview = messages.slice(0, limit).join(" | ");
    if (messages.length <= limit) return preview;
    return `${preview} | +${messages.length - limit} more`;
}

export function rememberModerationLog(action: "kick" | "ban", guildId: string, userId: string): void {
    recentModerationLogEvents.set(`${action}:${guildId}:${userId}`, Date.now());
}

export function shouldSkipRecentModerationLog(action: "kick" | "ban", guildId: string, userId: string, windowMs = 15_000): boolean {
    const now = Date.now();
    const retentionWindow = Math.max(windowMs, MOD_LOG_EVENT_RETENTION_MS);
    for (const [key, ts] of recentModerationLogEvents.entries()) {
        if (now - ts > retentionWindow) recentModerationLogEvents.delete(key);
    }

    const key = `${action}:${guildId}:${userId}`;
    const last = recentModerationLogEvents.get(key) || 0;
    if (now - last <= windowMs) return true;
    recentModerationLogEvents.set(key, now);
    return false;
}

export function readInstanceLockState(): {
    exists: boolean;
    ownerPid: number | null;
    ownerStartedAt: number | null;
    ownerAlive: boolean;
} {
    if (!fs.existsSync(INSTANCE_LOCK_PATH)) {
        return { exists: false, ownerPid: null, ownerStartedAt: null, ownerAlive: false };
    }

    try {
        const raw = fs.readFileSync(INSTANCE_LOCK_PATH, "utf8");
        const parsed = JSON.parse(raw) as { pid?: number; startedAt?: number };
        const ownerPid = Number(parsed?.pid || 0) || null;
        const ownerStartedAt = Number(parsed?.startedAt || 0) || null;
        const ownerAlive = ownerPid ? isProcessAlive(ownerPid) : false;
        return { exists: true, ownerPid, ownerStartedAt, ownerAlive };
    } catch {
        return { exists: true, ownerPid: null, ownerStartedAt: null, ownerAlive: false };
    }
}

export function describeInFlightTicketCreateLocks(limit = 5): string {
    if (!inFlightTicketCreates.size) return "none";
    const now = Date.now();
    const entries = Array.from(inFlightTicketCreates.entries())
        .slice(0, Math.max(1, limit))
        .map(([key, ts]) => `${key} (${Math.max(0, Math.floor((now - ts) / 1000))}s)`);
    return entries.join("\n");
}

export function readRecentTicketOpsEvents(limit = 8): string[] {
    if (!fs.existsSync(EVENT_LOG_FILE)) return [];

    const interesting = new Set([
        "ticket_open",
        "ticket_duplicate_channel_deleted",
        "ticket_prune_deleted_channel",
        "ticket_prune_stale_owner_open",
        "ticket_import",
        "ticket_panel_permanent_upsert",
        "uncaught_exception"
    ]);

    try {
        const lines = fs.readFileSync(EVENT_LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
        const picked: string[] = [];

        for (let i = lines.length - 1; i >= 0; i--) {
            let obj: Record<string, unknown>;
            try {
                const parsed = JSON.parse(lines[i]);
                if (!parsed || typeof parsed !== "object") continue;
                obj = parsed as Record<string, unknown>;
            } catch {
                continue;
            }

            if (!interesting.has(String(obj.eventType || ""))) continue;
            if (obj.eventType === "uncaught_exception" && !String(obj.message || "").toLowerCase().includes("ticket")) continue;

            const tsValue = typeof obj.ts === "number" || typeof obj.ts === "string" ? obj.ts : null;
            const tsText = tsValue !== null ? new Date(tsValue).toLocaleTimeString() : "time?";
            let detail = "";
            if (obj.eventType === "ticket_open") {
                detail = `owner ${obj.ownerId || "?"} channel ${obj.channelId || "?"}`;
            } else if (obj.eventType === "ticket_duplicate_channel_deleted") {
                detail = `removed ${obj.channelId || "?"} kept ${obj.canonicalChannelId || "?"}`;
            } else if (obj.eventType === "ticket_import") {
                detail = `channel ${obj.channelId || "?"}`;
            } else if (obj.eventType === "ticket_panel_permanent_upsert") {
                detail = `${obj.action || "updated"} ${obj.channelId || "?"}`;
            } else if (obj.eventType === "uncaught_exception") {
                detail = String(obj.message || "").slice(0, 90);
            } else {
                detail = `channel ${obj.channelId || "n/a"}`;
            }

            picked.push(`${tsText} | ${obj.eventType} | ${detail}`);
            if (picked.length >= Math.max(1, limit)) break;
        }

        return picked;
    } catch {
        return [];
    }
}

export function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

export function toIsoOrNever(ts: number | null | undefined): string {
    if (!ts || ts <= 0) return "never";
    return new Date(ts).toISOString();
}

export function statLabel(filePath: string): string {
    try {
        if (!fs.existsSync(filePath)) return "missing";
        const stat = fs.statSync(filePath);
        const kb = Math.max(1, Math.round(stat.size / 1024));
        return `${kb}KB | ${stat.mtime.toISOString()}`;
    } catch {
        return "unreadable";
    }
}

export function statSummary(filePath: string): { exists: boolean; size: number; mtime: number } {
    try {
        if (!fs.existsSync(filePath)) {
            return { exists: false, size: 0, mtime: 0 };
        }
        const stat = fs.statSync(filePath);
        return { exists: true, size: stat.size, mtime: stat.mtimeMs };
    } catch {
        return { exists: false, size: 0, mtime: 0 };
    }
}
