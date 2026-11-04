"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasInstanceLock = exports.INSTANCE_LOCK_PATH = exports.inFlightTicketCreates = void 0;
exports.toSafeString = toSafeString;
exports.postOpsAlert = postOpsAlert;
exports.pruneRecentCommandExecutions = pruneRecentCommandExecutions;
exports.rejectIfDuplicateCommand = rejectIfDuplicateCommand;
exports.rejectIfRateLimitedForInteraction = rejectIfRateLimitedForInteraction;
exports.rejectIfRateLimitedForCasinoAction = rejectIfRateLimitedForCasinoAction;
exports.updateBotPresence = updateBotPresence;
exports.tryAcquireTicketCreateLock = tryAcquireTicketCreateLock;
exports.releaseTicketCreateLock = releaseTicketCreateLock;
exports.pruneInMemoryRuntimeState = pruneInMemoryRuntimeState;
exports.acquireInstanceLock = acquireInstanceLock;
exports.releaseInstanceLock = releaseInstanceLock;
exports.runStartupPreflight = runStartupPreflight;
exports.summarizePreflightMessages = summarizePreflightMessages;
exports.rememberModerationLog = rememberModerationLog;
exports.shouldSkipRecentModerationLog = shouldSkipRecentModerationLog;
exports.readInstanceLockState = readInstanceLockState;
exports.describeInFlightTicketCreateLocks = describeInFlightTicketCreateLocks;
exports.readRecentTicketOpsEvents = readRecentTicketOpsEvents;
exports.formatDuration = formatDuration;
exports.toIsoOrNever = toIsoOrNever;
exports.statLabel = statLabel;
exports.statSummary = statSummary;
// Ops alerts, command idempotency/rate limits, presence, instance lock, and startup preflight.
const discord_js_1 = require("discord.js");
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_https_1 = __importDefault(require("node:https"));
const node_os_1 = __importDefault(require("node:os"));
const path_1 = __importDefault(require("path"));
const rateLimit_1 = require("../../runtime/rateLimit");
require("./env");
const config_1 = require("./config");
const client_1 = require("./client");
const opsAlertLastSent = new Map();
const recentCommandExecutions = new Map();
exports.inFlightTicketCreates = new Map();
const recentModerationLogEvents = new Map();
exports.INSTANCE_LOCK_PATH = path_1.default.join(node_os_1.default.tmpdir(), `titan-raid-bot.${node_crypto_1.default.createHash("sha1").update(String(process.env.DISCORD_TOKEN || "no-token")).digest("hex").slice(0, 12)}.lock`);
exports.hasInstanceLock = false;
function shouldSendOpsAlert(key) {
    const now = Date.now();
    for (const [entryKey, ts] of opsAlertLastSent.entries()) {
        if (now - ts > config_1.OPS_ALERT_RETENTION_MS)
            opsAlertLastSent.delete(entryKey);
    }
    const last = opsAlertLastSent.get(key) || 0;
    if (now - last < config_1.OPS_ALERT_COOLDOWN_MS)
        return false;
    opsAlertLastSent.set(key, now);
    return true;
}
function toSafeString(value) {
    if (value instanceof Error)
        return `${value.name}: ${value.message}`;
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function postOpsAlert(level, title, details = {}) {
    if (!config_1.OPS_ALERT_WEBHOOK_URL)
        return;
    const key = `${level}:${title}`;
    if (!shouldSendOpsAlert(key))
        return;
    let webhookUrl;
    try {
        webhookUrl = new URL(config_1.OPS_ALERT_WEBHOOK_URL);
    }
    catch {
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
    const req = node_https_1.default.request({
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
            fs_extra_1.default.appendFileSync(config_1.OPS_DEAD_LETTER_FILE, `${JSON.stringify({ at: Date.now(), level, title, details, error: toSafeString(error) })}\n`, "utf8");
        }
        catch {
            // Alert failures must never interrupt bot operation.
        }
    });
    req.write(body);
    req.end();
}
function pruneRecentCommandExecutions(now = Date.now()) {
    if (config_1.COMMAND_IDEMPOTENCY_WINDOW_MS <= 0)
        return;
    for (const [key, ts] of recentCommandExecutions.entries()) {
        if (now - ts > config_1.COMMAND_IDEMPOTENCY_WINDOW_MS) {
            recentCommandExecutions.delete(key);
        }
    }
}
function commandExecutionKey(interaction, fingerprint) {
    return `${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.commandName}:${fingerprint}`;
}
function rejectIfDuplicateCommand(interaction, fingerprint) {
    if (config_1.COMMAND_IDEMPOTENCY_WINDOW_MS <= 0)
        return null;
    pruneRecentCommandExecutions();
    const key = commandExecutionKey(interaction, fingerprint);
    const now = Date.now();
    const last = recentCommandExecutions.get(key);
    if (last && (now - last) <= config_1.COMMAND_IDEMPOTENCY_WINDOW_MS) {
        return "Duplicate command detected. Please wait a few seconds before retrying.";
    }
    recentCommandExecutions.set(key, now);
    return null;
}
function rejectIfRateLimitedForInteraction(interaction) {
    if (config_1.COMMAND_RATE_LIMIT_WINDOW_MS <= 0)
        return null;
    const key = `${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.commandName}`;
    return (0, rateLimit_1.rejectIfRateLimited)(key, config_1.COMMAND_RATE_LIMIT_WINDOW_MS);
}
function rejectIfRateLimitedForCasinoAction(guildId, userId, gameKey) {
    if (config_1.CASINO_ACTION_RATE_LIMIT_WINDOW_MS <= 0)
        return null;
    const key = `${guildId || "dm"}:${userId}:casino:${gameKey}`;
    return (0, rateLimit_1.rejectIfRateLimited)(key, config_1.CASINO_ACTION_RATE_LIMIT_WINDOW_MS);
}
function updateBotPresence() {
    if (!client_1.client.user)
        return;
    const guildCount = client_1.client.guilds.cache.size;
    const label = guildCount > 0
        ? `${config_1.PREFIX}help • ${guildCount} server${guildCount === 1 ? "" : "s"}`
        : `${config_1.PREFIX}help`;
    void client_1.client.user.setPresence({
        activities: [{ name: label, type: discord_js_1.ActivityType.Playing }],
        status: "online"
    });
}
function tryAcquireTicketCreateLock(guildId, ownerId) {
    const now = Date.now();
    for (const [entryKey, ts] of exports.inFlightTicketCreates.entries()) {
        if (now - ts > config_1.TICKET_CREATE_LOCK_MAX_AGE_MS)
            exports.inFlightTicketCreates.delete(entryKey);
    }
    const key = `${guildId}:${ownerId}`;
    if (exports.inFlightTicketCreates.has(key))
        return false;
    exports.inFlightTicketCreates.set(key, now);
    return true;
}
function releaseTicketCreateLock(guildId, ownerId) {
    exports.inFlightTicketCreates.delete(`${guildId}:${ownerId}`);
}
function pruneInMemoryRuntimeState(now = Date.now()) {
    pruneRecentCommandExecutions(now);
    for (const [entryKey, ts] of exports.inFlightTicketCreates.entries()) {
        if (now - ts > config_1.TICKET_CREATE_LOCK_MAX_AGE_MS)
            exports.inFlightTicketCreates.delete(entryKey);
    }
    for (const [entryKey, ts] of recentModerationLogEvents.entries()) {
        if (now - ts > config_1.MOD_LOG_EVENT_RETENTION_MS)
            recentModerationLogEvents.delete(entryKey);
    }
    for (const [entryKey, ts] of opsAlertLastSent.entries()) {
        if (now - ts > config_1.OPS_ALERT_RETENTION_MS)
            opsAlertLastSent.delete(entryKey);
    }
}
function isProcessAlive(pid) {
    if (!Number.isFinite(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function acquireInstanceLock() {
    const now = Date.now();
    const payload = JSON.stringify({ pid: process.pid, startedAt: now });
    try {
        fs_extra_1.default.writeFileSync(exports.INSTANCE_LOCK_PATH, payload, { flag: "wx" });
        exports.hasInstanceLock = true;
        return { ok: true };
    }
    catch {
        const state = readInstanceLockState();
        if (state.ownerPid && state.ownerAlive) {
            return { ok: false, reason: `Another bot instance appears active (PID ${state.ownerPid}).` };
        }
        try {
            fs_extra_1.default.writeFileSync(exports.INSTANCE_LOCK_PATH, payload, { flag: "w" });
            exports.hasInstanceLock = true;
            return { ok: true };
        }
        catch {
            return { ok: false, reason: "Unable to acquire singleton lock file." };
        }
    }
}
function releaseInstanceLock() {
    if (!exports.hasInstanceLock)
        return;
    try {
        const state = readInstanceLockState();
        if (!state.ownerPid || state.ownerPid === process.pid || !state.ownerAlive) {
            fs_extra_1.default.removeSync(exports.INSTANCE_LOCK_PATH);
        }
    }
    catch {
        // Best effort cleanup only.
    }
    finally {
        exports.hasInstanceLock = false;
    }
}
async function runStartupPreflight() {
    const errors = [];
    const warnings = [];
    if (!process.env.DISCORD_TOKEN) {
        errors.push("DISCORD_TOKEN is missing.");
    }
    const optionalDefaults = [
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
            if (config_1.STRICT_ENV_REQUIRED)
                errors.push(`${requirement.key} is required in strict env mode.`);
            else
                warnings.push(requirement.message);
        }
    }
    if (config_1.STRICT_ENV_REQUIRED && !process.env.DISCORD_GUILD_ID) {
        errors.push("DISCORD_GUILD_ID is required in strict env mode.");
    }
    const writablePaths = [
        config_1.POINTS_DATA_FILE,
        config_1.MOD_DATA_FILE,
        config_1.TRADE_DATA_FILE,
        config_1.TICKET_DATA_FILE,
        config_1.BALANCE_TELEMETRY_FILE,
        config_1.EVENT_LOG_FILE,
        config_1.XP_ROLE_DATA_FILE
    ];
    for (const filePath of writablePaths) {
        try {
            fs_extra_1.default.ensureDirSync(path_1.default.dirname(filePath));
            const probePath = `${filePath}.probe`;
            fs_extra_1.default.writeFileSync(probePath, "");
            fs_extra_1.default.unlinkSync(probePath);
        }
        catch {
            errors.push(`Path is not writable: ${filePath}`);
        }
    }
    return { errors, warnings };
}
function summarizePreflightMessages(messages, limit = 3) {
    if (messages.length === 0)
        return "none";
    const preview = messages.slice(0, limit).join(" | ");
    if (messages.length <= limit)
        return preview;
    return `${preview} | +${messages.length - limit} more`;
}
function rememberModerationLog(action, guildId, userId) {
    recentModerationLogEvents.set(`${action}:${guildId}:${userId}`, Date.now());
}
function shouldSkipRecentModerationLog(action, guildId, userId, windowMs = 15000) {
    const now = Date.now();
    const retentionWindow = Math.max(windowMs, config_1.MOD_LOG_EVENT_RETENTION_MS);
    for (const [key, ts] of recentModerationLogEvents.entries()) {
        if (now - ts > retentionWindow)
            recentModerationLogEvents.delete(key);
    }
    const key = `${action}:${guildId}:${userId}`;
    const last = recentModerationLogEvents.get(key) || 0;
    if (now - last <= windowMs)
        return true;
    recentModerationLogEvents.set(key, now);
    return false;
}
function readInstanceLockState() {
    if (!fs_extra_1.default.existsSync(exports.INSTANCE_LOCK_PATH)) {
        return { exists: false, ownerPid: null, ownerStartedAt: null, ownerAlive: false };
    }
    try {
        const raw = fs_extra_1.default.readFileSync(exports.INSTANCE_LOCK_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const ownerPid = Number(parsed?.pid || 0) || null;
        const ownerStartedAt = Number(parsed?.startedAt || 0) || null;
        const ownerAlive = ownerPid ? isProcessAlive(ownerPid) : false;
        return { exists: true, ownerPid, ownerStartedAt, ownerAlive };
    }
    catch {
        return { exists: true, ownerPid: null, ownerStartedAt: null, ownerAlive: false };
    }
}
function describeInFlightTicketCreateLocks(limit = 5) {
    if (!exports.inFlightTicketCreates.size)
        return "none";
    const now = Date.now();
    const entries = Array.from(exports.inFlightTicketCreates.entries())
        .slice(0, Math.max(1, limit))
        .map(([key, ts]) => `${key} (${Math.max(0, Math.floor((now - ts) / 1000))}s)`);
    return entries.join("\n");
}
function readRecentTicketOpsEvents(limit = 8) {
    if (!fs_extra_1.default.existsSync(config_1.EVENT_LOG_FILE))
        return [];
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
        const lines = fs_extra_1.default.readFileSync(config_1.EVENT_LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
        const picked = [];
        for (let i = lines.length - 1; i >= 0; i--) {
            let obj;
            try {
                const parsed = JSON.parse(lines[i]);
                if (!parsed || typeof parsed !== "object")
                    continue;
                obj = parsed;
            }
            catch {
                continue;
            }
            if (!interesting.has(String(obj.eventType || "")))
                continue;
            if (obj.eventType === "uncaught_exception" && !String(obj.message || "").toLowerCase().includes("ticket"))
                continue;
            const tsValue = typeof obj.ts === "number" || typeof obj.ts === "string" ? obj.ts : null;
            const tsText = tsValue !== null ? new Date(tsValue).toLocaleTimeString() : "time?";
            let detail = "";
            if (obj.eventType === "ticket_open") {
                detail = `owner ${obj.ownerId || "?"} channel ${obj.channelId || "?"}`;
            }
            else if (obj.eventType === "ticket_duplicate_channel_deleted") {
                detail = `removed ${obj.channelId || "?"} kept ${obj.canonicalChannelId || "?"}`;
            }
            else if (obj.eventType === "ticket_import") {
                detail = `channel ${obj.channelId || "?"}`;
            }
            else if (obj.eventType === "ticket_panel_permanent_upsert") {
                detail = `${obj.action || "updated"} ${obj.channelId || "?"}`;
            }
            else if (obj.eventType === "uncaught_exception") {
                detail = String(obj.message || "").slice(0, 90);
            }
            else {
                detail = `channel ${obj.channelId || "n/a"}`;
            }
            picked.push(`${tsText} | ${obj.eventType} | ${detail}`);
            if (picked.length >= Math.max(1, limit))
                break;
        }
        return picked;
    }
    catch {
        return [];
    }
}
function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}
function toIsoOrNever(ts) {
    if (!ts || ts <= 0)
        return "never";
    return new Date(ts).toISOString();
}
function statLabel(filePath) {
    try {
        if (!fs_extra_1.default.existsSync(filePath))
            return "missing";
        const stat = fs_extra_1.default.statSync(filePath);
        const kb = Math.max(1, Math.round(stat.size / 1024));
        return `${kb}KB | ${stat.mtime.toISOString()}`;
    }
    catch {
        return "unreadable";
    }
}
function statSummary(filePath) {
    try {
        if (!fs_extra_1.default.existsSync(filePath)) {
            return { exists: false, size: 0, mtime: 0 };
        }
        const stat = fs_extra_1.default.statSync(filePath);
        return { exists: true, size: stat.size, mtime: stat.mtimeMs };
    }
    catch {
        return { exists: false, size: 0, mtime: 0 };
    }
}
