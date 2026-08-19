import "dotenv/config";
import * as dotenv from "dotenv";
import {
    ActionRowBuilder,
    APIEmbed,
    AuditLogEvent,
    ButtonBuilder,
    ButtonStyle,
    ActivityType,
    ChannelType,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    Guild,
    GuildMember,
    ModalBuilder,
    MessageFlags,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
    User
} from "discord.js";
import fs from "fs-extra";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import https from "node:https";
import os from "node:os";
import path from "path";
import {
    addPoints,
    addXP,
    addTokens,
    addInventoryItem,
    canAffordTokens,
    depositToBank,
    ensureUser,
    getBankTokens,
    getInventoryCount,
    getPmcBuffs,
    getPmcLevel,
    getPmcProgress,
    getPmcTierForLevel,
    getGameStatsSummary,
    type GameStatKey,
    getXpPersistenceSnapshot,
    formatProgressPercent,
    PMC_LEVEL_CAP,
    pmcBar,
    getPoints,
    getTokens,
    getXPLevel,
    points,
    removeInventoryItem,
    removeTokens,
    recordGameResult,
    savePoints,
    transferWalletTokens,
    withdrawFromBank,
    XP_LEVEL_THRESHOLDS,
    xpBar
} from "./utils";
import {
    buildTicketIntakeReason,
    canReopenTicket,
    classifyTicketCategory,
    findPotentialDuplicateTickets,
    getKbSuggestions,
    getTicketSlaPolicy,
    pickLeastLoadedAssignee,
    shouldPurgeResolvedTicket
} from "./services/ticketEnhancements";
import { claimDaily, getLeaderboard } from "./game/economy";
import { ARMOR_IDS, BOSS_HEART_DEFS, BOSS_HEART_IDS, COLLECTIBLE_ITEM_IDS, getVendorSellPrice, ITEM_DEFS, SHOP_ITEMS, ULTRA_RARE_COLLECTIBLE_IDS, type ItemDef, WEAPON_IDS } from "./game/catalog";
import { awardBossHeartAchievement, getUnlockedBossHeartNames } from "./game/bossHearts";
import { getBossPortraitUrl } from "./game/bossPortraits";
import { buildConsumableUsePayload, buildCrateOpenPayload, buildInventoryPayload, buildRaidResultPayload, buildSellPickerPayload, buildShopPayload, buildTradeActionPayload, getSellableInventoryOptions, RAID_RESULT_ACTION_IDS, rarityBadge } from "./game/payloads";
import { getRaidOutcome, getRaidRewards } from "./game/raid";
import * as RaidDomain from "./raid/domain";
import * as RaidRuntime from "./raid/runtime";
import { buildTicketTranscriptStub, exportTicketTranscript } from "./services/ticketTranscript";
import type { TicketTranscriptStub } from "./services/ticketTranscript";
import { buildTicketCommandHandlers } from "./commands/ticketCommands";
import { buildModerationCommandHandlers } from "./commands/moderationCommands";
import { handleCoreCommand } from "./commands/coreCommands";
import { buildSlashCommands } from "./commands/slashCatalog";
import { buildStartupSummary, buildStatusLines } from "./runtime/health";
import { rejectIfRateLimited } from "./runtime/rateLimit";
import {
    archiveTicketByChannel as stateArchiveTicketByChannel,
    assignTicketToUser as stateAssignTicketToUser,
    canTransitionTicketStatus as stateCanTransitionTicketStatus,
    claimTicketByChannel as stateClaimTicketByChannel,
    createTicketEntry as stateCreateTicketEntry,
    findArchivedTicketByChannel as stateFindArchivedTicketByChannel,
    findOpenTicketByChannel as stateFindOpenTicketByChannel,
    findOpenTicketByOwner as stateFindOpenTicketByOwner,
    findTicketByChannel as stateFindTicketByChannel,
    getTicketSlaState as stateGetTicketSlaState,
    normalizeTicketPriority as stateNormalizeTicketPriority,
    normalizeTicketStatus as stateNormalizeTicketStatus,
    normalizeTicketWorkflowStatus as stateNormalizeTicketWorkflowStatus,
    reopenTicketByChannel as stateReopenTicketByChannel,
    resolveTicketByChannel as stateResolveTicketByChannel,
    setTicketPanelMessageId as stateSetTicketPanelMessageId,
    setTicketWorkflowStatus as stateSetTicketWorkflowStatus,
    type TicketPriority as StateTicketPriority,
    type TicketRecord as StateTicketRecord,
    type TicketStoreState as StateTicketStoreState,
    type TicketWorkflowStatus as StateTicketWorkflowStatus
} from "./services/ticketState";
import type { TicketCsatRecord, TicketNote } from "./services/ticketEnhancements";

// Always resolve env vars from this bot project root, even when npm --prefix is used from another cwd.
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

function readEnvFlag(name: string, fallback = false): boolean {
    const raw = (process.env[name] || "").trim().toLowerCase();
    if (!raw) return fallback;
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const ACTIVITY_CHANNEL_ID = process.env.DISCORD_ACTIVITY_CHANNEL_ID || "";
const HEALTH_REPORT_CHANNEL_ID = process.env.HEALTH_REPORT_CHANNEL_ID || ACTIVITY_CHANNEL_ID || "";
const OPS_ALERT_WEBHOOK_URL = process.env.OPS_ALERT_WEBHOOK_URL || "";
const STRICT_ENV_REQUIRED = readEnvFlag("STRICT_ENV_REQUIRED", false);
const ENABLE_STARTUP_AUTOPANELS = readEnvFlag("ENABLE_STARTUP_AUTOPANELS", true);
const ENABLE_STARTUP_DEPLOYMENT_SUMMARY = readEnvFlag("ENABLE_STARTUP_DEPLOYMENT_SUMMARY", true);
const XP_COOLDOWN_MS = 0;
const RAID_COOLDOWN_MS = 5 * 1000;
const DAILY_HEALTH_REPORT_MS = 24 * 60 * 60 * 1000;
const WEEKLY_BALANCE_REPORT_MS = 7 * 24 * 60 * 60 * 1000;
const HEALTH_WATCHDOG_INTERVAL_MS = 10 * 60 * 1000;
const UNCLAIMED_TICKET_AUTO_CLOSE_MS = 30 * 60 * 1000;
const BACKUP_STALE_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = "$";
const MIN_BET = 1;
const MIN_RAID_BET = 10;
const MOD_DATA_FILE = path.resolve(__dirname, "../src/data/moderation.json");
const TRADE_DATA_FILE = path.resolve(__dirname, "../src/data/trades.json");
const GIVEAWAY_DATA_FILE = path.resolve(__dirname, "../src/data/giveaways.json");
const XP_ROLE_DATA_FILE = path.resolve(__dirname, "../src/data/xp-roles.json");
const POINTS_DATA_FILE = path.resolve(__dirname, "../src/data/points.json");
const POINTS_BACKUP_FILE = `${POINTS_DATA_FILE}.bak`;
const EVENT_LOG_FILE = path.resolve(__dirname, "../src/data/events.jsonl");
const BALANCE_TELEMETRY_FILE = path.resolve(__dirname, "../src/data/balance-telemetry.json");
const METRICS_DATA_FILE = path.resolve(__dirname, "../src/data/runtime-metrics.json");
const TICKET_DATA_FILE = path.resolve(__dirname, "../src/data/tickets.json");
const TICKET_TRANSCRIPT_DIR = path.resolve(__dirname, "../src/data/ticket-transcripts");
const DEFAULT_TICKET_HANDLER_ROLE_ID = "1506184638207361145";
const DEFAULT_TICKET_DEFAULT_CATEGORY_ID = "1523411322430296228";
const DEFAULT_PERMANENT_TICKET_PANEL_CHANNEL_ID = "1506119505720377434";
const DEFAULT_REPORT_PANEL_CHANNEL_ID = DEFAULT_PERMANENT_TICKET_PANEL_CHANNEL_ID;
const DEFAULT_GIVEAWAY_CHANNEL_ID = "1535059013912363008";
const DEFAULT_REPORT_ADMIN_PANEL_CHANNEL_ID = "1535132577059307583";
const DEFAULT_REPORT_LOG_CHANNEL_ID = "1535135958788341770";
const DEFAULT_BOT_FEATURE_BRIEF_CHANNEL_ID = "1528998695624773714";
const DEFAULT_WELCOME_PANEL_CHANNEL_ID = "1536822643414536333";
const DEFAULT_MOD_LOG_CHANNEL_ID = "1529643338041659573";
const DEFAULT_DEPLOYMENT_SUMMARY_CHANNEL_ID = "1534712078089060583";
const TICKET_HANDLER_ROLE_ID = process.env.TICKET_HANDLER_ROLE_ID || DEFAULT_TICKET_HANDLER_ROLE_ID;
const TICKET_DEFAULT_CATEGORY_ID = process.env.TICKET_DEFAULT_CATEGORY_ID || DEFAULT_TICKET_DEFAULT_CATEGORY_ID;
const PERMANENT_TICKET_PANEL_CHANNEL_ID = process.env.PERMANENT_TICKET_PANEL_CHANNEL_ID || DEFAULT_PERMANENT_TICKET_PANEL_CHANNEL_ID;
const REPORT_PANEL_CHANNEL_ID = process.env.REPORT_PANEL_CHANNEL_ID || DEFAULT_REPORT_PANEL_CHANNEL_ID;
const GIVEAWAY_CHANNEL_ID = process.env.GIVEAWAY_CHANNEL_ID || DEFAULT_GIVEAWAY_CHANNEL_ID;
const REPORT_ADMIN_PANEL_CHANNEL_ID = process.env.REPORT_ADMIN_PANEL_CHANNEL_ID || DEFAULT_REPORT_ADMIN_PANEL_CHANNEL_ID;
const REPORT_LOG_CHANNEL_ID = process.env.REPORT_LOG_CHANNEL_ID || DEFAULT_REPORT_LOG_CHANNEL_ID;
const BOT_FEATURE_BRIEF_CHANNEL_ID = process.env.BOT_FEATURE_BRIEF_CHANNEL_ID || DEFAULT_BOT_FEATURE_BRIEF_CHANNEL_ID;
const WELCOME_PANEL_CHANNEL_ID = process.env.WELCOME_PANEL_CHANNEL_ID || DEFAULT_WELCOME_PANEL_CHANNEL_ID;
const MOD_LOG_CHANNEL_ID = process.env.MOD_LOG_CHANNEL_ID || DEFAULT_MOD_LOG_CHANNEL_ID;
const DEPLOYMENT_SUMMARY_CHANNEL_ID = process.env.DEPLOYMENT_SUMMARY_CHANNEL_ID || DEFAULT_DEPLOYMENT_SUMMARY_CHANNEL_ID;
const TICKET_EXPORT_WEBHOOK_URL = process.env.TICKET_EXPORT_WEBHOOK_URL || "";
const ARMY_ICON_URL = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1fa96.png";
const OPS_ALERT_COOLDOWN_MS = 60 * 1000;
const COMMAND_IDEMPOTENCY_WINDOW_MS = Math.max(0, Number(process.env.COMMAND_IDEMPOTENCY_WINDOW_MS || 15000));
const COMMAND_RATE_LIMIT_WINDOW_MS = 1500;
const CASINO_ACTION_RATE_LIMIT_WINDOW_MS = 1200;
const IN_MEMORY_STATE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const OPS_ALERT_RETENTION_MS = Math.max(15 * 60 * 1000, OPS_ALERT_COOLDOWN_MS * 4);
const TICKET_CREATE_LOCK_MAX_AGE_MS = 5 * 60 * 1000;
const MOD_LOG_EVENT_RETENTION_MS = 2 * 60 * 1000;
const CLOSED_TRADE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLOSED_TRADES = 2000;
const CLOSED_GIVEAWAY_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_CLOSED_GIVEAWAYS = 1000;
const opsAlertLastSent = new Map<string, number>();
const recentCommandExecutions = new Map<string, number>();
const inFlightTicketCreates = new Map<string, number>();
const recentModerationLogEvents = new Map<string, number>();
const INSTANCE_LOCK_PATH = path.join(
    os.tmpdir(),
    `titan-raid-bot.${crypto.createHash("sha1").update(String(process.env.DISCORD_TOKEN || "no-token")).digest("hex").slice(0, 12)}.lock`
);
let hasInstanceLock = false;

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

function toSafeString(value: unknown): string {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function postOpsAlert(level: "warn" | "error", title: string, details: Record<string, unknown> = {}): void {
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
    });

    req.write(body);
    req.end();
}

function pruneRecentCommandExecutions(now = Date.now()): void {
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

function rejectIfDuplicateCommand(interaction: ChatInputCommandInteraction, fingerprint: string): string | null {
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

function rejectIfRateLimitedForInteraction(interaction: ChatInputCommandInteraction): string | null {
    if (COMMAND_RATE_LIMIT_WINDOW_MS <= 0) return null;
    const key = `${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.commandName}`;
    return rejectIfRateLimited(key, COMMAND_RATE_LIMIT_WINDOW_MS);
}

function rejectIfRateLimitedForCasinoAction(guildId: string | null, userId: string, gameKey: CasinoGameKey): string | null {
    if (CASINO_ACTION_RATE_LIMIT_WINDOW_MS <= 0) return null;
    const key = `${guildId || "dm"}:${userId}:casino:${gameKey}`;
    return rejectIfRateLimited(key, CASINO_ACTION_RATE_LIMIT_WINDOW_MS);
}

function updateBotPresence(): void {
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

function tryAcquireTicketCreateLock(guildId: string, ownerId: string): boolean {
    const now = Date.now();
    for (const [entryKey, ts] of inFlightTicketCreates.entries()) {
        if (now - ts > TICKET_CREATE_LOCK_MAX_AGE_MS) inFlightTicketCreates.delete(entryKey);
    }

    const key = `${guildId}:${ownerId}`;
    if (inFlightTicketCreates.has(key)) return false;
    inFlightTicketCreates.set(key, now);
    return true;
}

function releaseTicketCreateLock(guildId: string, ownerId: string): void {
    inFlightTicketCreates.delete(`${guildId}:${ownerId}`);
}

function pruneInMemoryRuntimeState(now = Date.now()): void {
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

function acquireInstanceLock(): { ok: true } | { ok: false; reason: string } {
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

function releaseInstanceLock(): void {
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

async function runStartupPreflight(): Promise<{ errors: string[]; warnings: string[] }> {
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

function summarizePreflightMessages(messages: string[], limit = 3): string {
    if (messages.length === 0) return "none";
    const preview = messages.slice(0, limit).join(" | ");
    if (messages.length <= limit) return preview;
    return `${preview} | +${messages.length - limit} more`;
}

type AccessPointBadge = {
    threshold: number;
    label: string;
    iconUrl: string;
};

type PrestigeBadge = {
    threshold: number;
    label: string;
    iconUrl: string;
    color: number;
};

type PmcTierVisual = {
    level: number;
    label: string;
    iconUrl: string;
    color: number;
};

const ACCESS_POINT_BADGES: AccessPointBadge[] = [
    {
        threshold: 1000,
        label: "Elite Access Tier (1000+ AP)",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f451.png"
    },
    {
        threshold: 500,
        label: "Veteran Access Tier (500+ AP)",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2694.png"
    },
    {
        threshold: 250,
        label: "Operator Access Tier (250+ AP)",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f6e1.png"
    },
    {
        threshold: 0,
        label: "Recruit Access Tier",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f539.png"
    }
];

const PRESTIGE_BADGES: PrestigeBadge[] = [
    {
        threshold: 10,
        label: "Celestial Prestige X",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f30c.png",
        color: 0x8b5cf6
    },
    {
        threshold: 5,
        label: "Mythic Prestige V",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f680.png",
        color: 0xf97316
    },
    {
        threshold: 3,
        label: "Diamond Prestige III",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f48e.png",
        color: 0x0ea5e9
    },
    {
        threshold: 1,
        label: "Veteran Prestige I",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3c5.png",
        color: 0xf59e0b
    },
    {
        threshold: 0,
        label: "Unranked Prestige",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f539.png",
        color: 0x4ca7ff
    }
];

const PMC_TIER_VISUALS: PmcTierVisual[] = [
    {
        level: 20000,
        label: "Mythic Overlord",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f30c.png",
        color: 0x7c3aed
    },
    {
        level: 12000,
        label: "Cataclysm Marshal",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f525.png",
        color: 0xdc2626
    },
    {
        level: 8000,
        label: "Apex Sovereign",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f451.png",
        color: 0xd97706
    },
    {
        level: 4000,
        label: "Steel Warlord",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2694.png",
        color: 0x334155
    },
    {
        level: 1000,
        label: "Iron Vanguard",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f6e1.png",
        color: 0x0f766e
    },
    {
        level: 0,
        label: "Field Recruit",
        iconUrl: ARMY_ICON_URL,
        color: 0x0b1f3a
    }
];

function getAccessPointBadge(accessPoints: number): AccessPointBadge {
    for (const badge of ACCESS_POINT_BADGES) {
        if (accessPoints >= badge.threshold) return badge;
    }
    return ACCESS_POINT_BADGES[ACCESS_POINT_BADGES.length - 1];
}

function getPrestigeBadge(prestige: number): PrestigeBadge {
    const p = Math.max(0, Math.floor(prestige));
    for (const badge of PRESTIGE_BADGES) {
        if (p >= badge.threshold) return badge;
    }
    return PRESTIGE_BADGES[PRESTIGE_BADGES.length - 1];
}

function getPmcTierVisual(level: number): PmcTierVisual {
    const lv = Math.max(0, Math.floor(level));
    for (const visual of PMC_TIER_VISUALS) {
        if (lv >= visual.level) return visual;
    }
    return PMC_TIER_VISUALS[PMC_TIER_VISUALS.length - 1];
}

type TradeOfferStatus = "open" | "accepted" | "declined" | "cancelled";

type TradeOffer = {
    id: number;
    guildId: string | null;
    fromUserId: string;
    toUserId: string;
    offerItemId: string;
    offerQty: number;
    requestItemId: string;
    requestQty: number;
    status: TradeOfferStatus;
    createdAt: number;
    updatedAt: number;
};

type TradeStore = {
    nextId: number;
    offers: TradeOffer[];
};

type GiveawayStatus = "active" | "ended" | "cancelled";

type GiveawayEntry = {
    id: number;
    guildId: string;
    channelId: string;
    messageId: string | null;
    hostId: string;
    prize: string;
    description: string;
    rewardKind: "generic" | "item";
    rewardItemId: string | null;
    rewardQty: number;
    winnerCount: number;
    roleRequiredId: string | null;
    createdAt: number;
    endAt: number;
    updatedAt: number;
    status: GiveawayStatus;
    entries: string[];
    winners: string[];
    endedAt: number | null;
};

type GiveawayStore = {
    nextId: number;
    giveaways: GiveawayEntry[];
};

type BalanceSlice = {
    runs: number;
    wins: number;
    net: number;
    totalBet: number;
    totalReward: number;
    successChanceSum: number;
    bossSpawns: number;
    bossKills: number;
    lootValue: number;
    lootItems: number;
};

type BalanceTelemetryStore = {
    createdAt: number;
    updatedAt: number;
    lastWeeklyReportAt: number;
    commands: Record<string, number>;
    raid: {
        runs: number;
        wins: number;
        losses: number;
        totalBet: number;
        totalNet: number;
        bossSpawns: number;
        bossKills: number;
        byTension: Record<string, BalanceSlice>;
        byMap: Record<string, BalanceSlice>;
        byCondition: Record<string, BalanceSlice>;
        byDifficulty: Record<string, BalanceSlice>;
        tokenSources: {
            baseReward: number;
            outcomeBonus: number;
            bossBonus: number;
            failureMitigation: number;
        };
        lootByRarity: Record<string, number>;
    };
    consumables: Record<string, { uses: number; qty: number; failures: number; autoUses: number }>;
    crates: Record<string, { opened: number; autoOpened: number; totalDrops: number }>;
};

type RuntimeMetricsStore = {
    createdAt: number;
    updatedAt: number;
    command: {
        total: number;
        success: number;
        failed: number;
        byCommand: Record<string, { total: number; failed: number; totalDurationMs: number; maxDurationMs: number; lastDurationMs: number }>;
    };
    tickets: {
        createAttempts: number;
        createFailures: number;
        lastFailureAt: number | null;
        lastFailureReason: string | null;
    };
    availability: {
        totalRestarts: number;
        lastStartupAt: number | null;
        lastShutdownAt: number | null;
        trackedDowntimeMs: number;
        lastDowntimeMs: number;
        maxDowntimeMs: number;
    };
    deployment: {
        lastAnnouncedCommit: string | null;
        lastAnnouncedAt: number | null;
        lastAnnouncedChannelId: string | null;
    };
};

type GitDeploymentInfo = {
    commit: string | null;
    shortCommit: string | null;
    branch: string | null;
    subject: string | null;
};

function defaultBalanceSlice(): BalanceSlice {
    return {
        runs: 0,
        wins: 0,
        net: 0,
        totalBet: 0,
        totalReward: 0,
        successChanceSum: 0,
        bossSpawns: 0,
        bossKills: 0,
        lootValue: 0,
        lootItems: 0
    };
}

function defaultBalanceTelemetryStore(): BalanceTelemetryStore {
    const now = Date.now();
    return {
        createdAt: now,
        updatedAt: now,
        lastWeeklyReportAt: 0,
        commands: {},
        raid: {
            runs: 0,
            wins: 0,
            losses: 0,
            totalBet: 0,
            totalNet: 0,
            bossSpawns: 0,
            bossKills: 0,
            byTension: {},
            byMap: {},
            byCondition: {},
            byDifficulty: {},
            tokenSources: {
                baseReward: 0,
                outcomeBonus: 0,
                bossBonus: 0,
                failureMitigation: 0
            },
            lootByRarity: {}
        },
        consumables: {},
        crates: {}
    };
}

function normalizeBalanceSliceMap(raw: unknown): Record<string, BalanceSlice> {
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).map(([key, value]) => {
            const row = (value && typeof value === "object") ? value as Record<string, unknown> : {};
            return [key, {
                runs: typeof row.runs === "number" ? row.runs : 0,
                wins: typeof row.wins === "number" ? row.wins : 0,
                net: typeof row.net === "number" ? row.net : 0,
                totalBet: typeof row.totalBet === "number" ? row.totalBet : 0,
                totalReward: typeof row.totalReward === "number" ? row.totalReward : 0,
                successChanceSum: typeof row.successChanceSum === "number" ? row.successChanceSum : 0,
                bossSpawns: typeof row.bossSpawns === "number" ? row.bossSpawns : 0,
                bossKills: typeof row.bossKills === "number" ? row.bossKills : 0,
                lootValue: typeof row.lootValue === "number" ? row.lootValue : 0,
                lootItems: typeof row.lootItems === "number" ? row.lootItems : 0
            }];
        })
    );
}

function defaultRuntimeMetricsStore(): RuntimeMetricsStore {
    const now = Date.now();
    return {
        createdAt: now,
        updatedAt: now,
        command: {
            total: 0,
            success: 0,
            failed: 0,
            byCommand: {}
        },
        tickets: {
            createAttempts: 0,
            createFailures: 0,
            lastFailureAt: null,
            lastFailureReason: null
        },
        availability: {
            totalRestarts: 0,
            lastStartupAt: null,
            lastShutdownAt: null,
            trackedDowntimeMs: 0,
            lastDowntimeMs: 0,
            maxDowntimeMs: 0
        },
        deployment: {
            lastAnnouncedCommit: null,
            lastAnnouncedAt: null,
            lastAnnouncedChannelId: null
        }
    };
}

function parseRuntimeMetricsStore(raw: unknown): RuntimeMetricsStore | null {
    if (!raw || typeof raw !== "object") return null;
    const seed = defaultRuntimeMetricsStore();
    const value = raw as Partial<RuntimeMetricsStore>;
    const command = value.command || seed.command;
    const tickets = value.tickets || seed.tickets;
    const availability = value.availability || seed.availability;
    const deployment = value.deployment || seed.deployment;

    return {
        createdAt: typeof value.createdAt === "number" ? value.createdAt : seed.createdAt,
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : seed.updatedAt,
        command: {
            total: typeof command.total === "number" ? command.total : 0,
            success: typeof command.success === "number" ? command.success : 0,
            failed: typeof command.failed === "number" ? command.failed : 0,
            byCommand: command.byCommand && typeof command.byCommand === "object"
                ? Object.fromEntries(
                    Object.entries(command.byCommand).map(([key, value]) => {
                        const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
                        return [key, {
                            total: typeof row.total === "number" ? row.total : 0,
                            failed: typeof row.failed === "number" ? row.failed : 0,
                            totalDurationMs: typeof row.totalDurationMs === "number" ? row.totalDurationMs : 0,
                            maxDurationMs: typeof row.maxDurationMs === "number" ? row.maxDurationMs : 0,
                            lastDurationMs: typeof row.lastDurationMs === "number" ? row.lastDurationMs : 0
                        }];
                    })
                )
                : {}
        },
        tickets: {
            createAttempts: typeof tickets.createAttempts === "number" ? tickets.createAttempts : 0,
            createFailures: typeof tickets.createFailures === "number" ? tickets.createFailures : 0,
            lastFailureAt: typeof tickets.lastFailureAt === "number" ? tickets.lastFailureAt : null,
            lastFailureReason: typeof tickets.lastFailureReason === "string" ? tickets.lastFailureReason : null
        },
        availability: {
            totalRestarts: typeof availability.totalRestarts === "number" ? availability.totalRestarts : 0,
            lastStartupAt: typeof availability.lastStartupAt === "number" ? availability.lastStartupAt : null,
            lastShutdownAt: typeof availability.lastShutdownAt === "number" ? availability.lastShutdownAt : null,
            trackedDowntimeMs: typeof availability.trackedDowntimeMs === "number" ? availability.trackedDowntimeMs : 0,
            lastDowntimeMs: typeof availability.lastDowntimeMs === "number" ? availability.lastDowntimeMs : 0,
            maxDowntimeMs: typeof availability.maxDowntimeMs === "number" ? availability.maxDowntimeMs : 0
        },
        deployment: {
            lastAnnouncedCommit: typeof deployment.lastAnnouncedCommit === "string" ? deployment.lastAnnouncedCommit : null,
            lastAnnouncedAt: typeof deployment.lastAnnouncedAt === "number" ? deployment.lastAnnouncedAt : null,
            lastAnnouncedChannelId: typeof deployment.lastAnnouncedChannelId === "string" ? deployment.lastAnnouncedChannelId : null
        }
    };
}

function parseBalanceTelemetryStore(raw: unknown): BalanceTelemetryStore | null {
    if (!raw || typeof raw !== "object") return null;
    const seed = defaultBalanceTelemetryStore();
    const value = raw as Partial<BalanceTelemetryStore>;
    const raid = value.raid || seed.raid;
    return {
        createdAt: typeof value.createdAt === "number" ? value.createdAt : seed.createdAt,
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : seed.updatedAt,
        lastWeeklyReportAt: typeof value.lastWeeklyReportAt === "number" ? value.lastWeeklyReportAt : 0,
        commands: value.commands && typeof value.commands === "object" ? value.commands : {},
        raid: {
            runs: typeof raid.runs === "number" ? raid.runs : 0,
            wins: typeof raid.wins === "number" ? raid.wins : 0,
            losses: typeof raid.losses === "number" ? raid.losses : 0,
            totalBet: typeof raid.totalBet === "number" ? raid.totalBet : 0,
            totalNet: typeof raid.totalNet === "number" ? raid.totalNet : 0,
            bossSpawns: typeof raid.bossSpawns === "number" ? raid.bossSpawns : 0,
            bossKills: typeof raid.bossKills === "number" ? raid.bossKills : 0,
            byTension: normalizeBalanceSliceMap(raid.byTension),
            byMap: normalizeBalanceSliceMap(raid.byMap),
            byCondition: normalizeBalanceSliceMap(raid.byCondition),
            byDifficulty: normalizeBalanceSliceMap(raid.byDifficulty),
            tokenSources: {
                baseReward: typeof raid.tokenSources?.baseReward === "number" ? raid.tokenSources.baseReward : 0,
                outcomeBonus: typeof raid.tokenSources?.outcomeBonus === "number" ? raid.tokenSources.outcomeBonus : 0,
                bossBonus: typeof raid.tokenSources?.bossBonus === "number" ? raid.tokenSources.bossBonus : 0,
                failureMitigation: typeof raid.tokenSources?.failureMitigation === "number" ? raid.tokenSources.failureMitigation : 0
            },
            lootByRarity: raid.lootByRarity && typeof raid.lootByRarity === "object" ? raid.lootByRarity : {}
        },
        consumables: value.consumables && typeof value.consumables === "object" ? value.consumables : {},
        crates: value.crates && typeof value.crates === "object" ? value.crates : {}
    };
}

function readRuntimeMetrics(): RuntimeMetricsStore {
    return readJsonWithBackup(METRICS_DATA_FILE, parseRuntimeMetricsStore, defaultRuntimeMetricsStore());
}

const runtimeMetrics = readRuntimeMetrics();
let shutdownMetricMarked = false;

function saveRuntimeMetrics(): void {
    runtimeMetrics.updatedAt = Date.now();
    writeJsonAtomic(METRICS_DATA_FILE, runtimeMetrics);
}

function recordCommandOutcome(commandName: string, success: boolean, durationMs = 0): void {
    runtimeMetrics.command.total += 1;
    if (success) runtimeMetrics.command.success += 1;
    else runtimeMetrics.command.failed += 1;

    const key = String(commandName || "unknown").toLowerCase();
    const entry = runtimeMetrics.command.byCommand[key] || {
        total: 0,
        failed: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        lastDurationMs: 0
    };
    entry.total += 1;
    if (!success) entry.failed += 1;
    entry.lastDurationMs = Math.max(0, Math.floor(durationMs));
    entry.totalDurationMs += entry.lastDurationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, entry.lastDurationMs);
    runtimeMetrics.command.byCommand[key] = entry;
    saveRuntimeMetrics();
}

function recordTicketCreateAttempt(): void {
    runtimeMetrics.tickets.createAttempts += 1;
    saveRuntimeMetrics();
}

function recordTicketCreateFailure(reason: string): void {
    runtimeMetrics.tickets.createFailures += 1;
    runtimeMetrics.tickets.lastFailureAt = Date.now();
    runtimeMetrics.tickets.lastFailureReason = clampText(String(reason || "unknown failure"), 240);
    saveRuntimeMetrics();
}

function recordRuntimeStartup(): void {
    const now = Date.now();
    const lastShutdown = runtimeMetrics.availability.lastShutdownAt;
    if (typeof lastShutdown === "number" && lastShutdown > 0 && now > lastShutdown) {
        const downtime = now - lastShutdown;
        runtimeMetrics.availability.lastDowntimeMs = downtime;
        runtimeMetrics.availability.trackedDowntimeMs += downtime;
        runtimeMetrics.availability.maxDowntimeMs = Math.max(runtimeMetrics.availability.maxDowntimeMs, downtime);
    }
    runtimeMetrics.availability.totalRestarts += 1;
    runtimeMetrics.availability.lastStartupAt = now;
    shutdownMetricMarked = false;
    saveRuntimeMetrics();
}

function recordRuntimeShutdown(reason: string): void {
    if (shutdownMetricMarked) return;
    shutdownMetricMarked = true;
    runtimeMetrics.availability.lastShutdownAt = Date.now();
    saveRuntimeMetrics();
    appendAuditEvent("runtime_shutdown_marked", { reason });
}

function formatMetricDuration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function appendAuditEvent(eventType: string, payload: Record<string, unknown>): void {
    try {
        fs.ensureDirSync(path.dirname(EVENT_LOG_FILE));
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            eventType,
            ...payload
        });
        fs.appendFileSync(EVENT_LOG_FILE, `${line}\n`, "utf8");
    } catch {
        // Never crash runtime due to audit logging.
    }
}

function readGitOutput(command: string): string | null {
    try {
        const output = execSync(command, {
            cwd: path.resolve(__dirname, ".."),
            stdio: ["ignore", "pipe", "ignore"]
        }).toString("utf8").trim();
        return output || null;
    } catch {
        return null;
    }
}

function getGitDeploymentInfo(): GitDeploymentInfo {
    return {
        commit: readGitOutput("git rev-parse HEAD"),
        shortCommit: readGitOutput("git rev-parse --short HEAD"),
        branch: readGitOutput("git rev-parse --abbrev-ref HEAD"),
        subject: readGitOutput("git log -1 --pretty=%s")
    };
}

async function sendDeploymentSummaryIfNeeded(): Promise<void> {
    if (!DEPLOYMENT_SUMMARY_CHANNEL_ID) return;

    const gitInfo = getGitDeploymentInfo();
    if (
        gitInfo.commit
        && runtimeMetrics.deployment.lastAnnouncedCommit === gitInfo.commit
        && runtimeMetrics.deployment.lastAnnouncedChannelId === DEPLOYMENT_SUMMARY_CHANNEL_ID
    ) {
        return;
    }

    const channel = await client.channels.fetch(DEPLOYMENT_SUMMARY_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
        appendAuditEvent("deployment_summary_failed", {
            channelId: DEPLOYMENT_SUMMARY_CHANNEL_ID,
            commit: gitInfo.commit,
            error: "Configured deployment summary channel is missing or not text-based."
        });
        return;
    }

    const startupAt = runtimeMetrics.availability.lastStartupAt || Date.now();
    const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🚀 Titan Bot Update Deployed")
        .setDescription("A pulled bot update is now live and the bot finished startup successfully.")
        .addFields(
            {
                name: "🧾 Revision",
                value: [
                    `Commit: **${gitInfo.shortCommit || "unknown"}**`,
                    `Branch: **${gitInfo.branch || "unknown"}**`,
                    `Message: ${clampText(gitInfo.subject || "Unavailable", 140)}`
                ].join("\n"),
                inline: false
            },
            {
                name: "✅ Live Status",
                value: [
                    `Ready at: <t:${Math.floor(startupAt / 1000)}:F>`,
                    `Guilds connected: **${client.guilds.cache.size.toLocaleString()}**`,
                    `Slash commands loaded: **${slashCommands.length.toLocaleString()}**`
                ].join("\n"),
                inline: true
            },
            {
                name: "📡 Runtime",
                value: [
                    `Latency: **${Math.round(client.ws.ping)}ms**`,
                    `Memory: **${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS**`,
                    `Tracked restarts: **${runtimeMetrics.availability.totalRestarts.toLocaleString()}**`
                ].join("\n"),
                inline: true
            }
        )
        .setFooter({ text: client.user?.tag ? `${client.user.tag} is online` : "Titan bot is online" })
        .setTimestamp(new Date(startupAt));

    const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        appendAuditEvent("deployment_summary_failed", {
            channelId: DEPLOYMENT_SUMMARY_CHANNEL_ID,
            commit: gitInfo.commit,
            error: "Failed to send deployment summary message."
        });
        return;
    }

    runtimeMetrics.deployment.lastAnnouncedCommit = gitInfo.commit;
    runtimeMetrics.deployment.lastAnnouncedAt = Date.now();
    runtimeMetrics.deployment.lastAnnouncedChannelId = DEPLOYMENT_SUMMARY_CHANNEL_ID;
    saveRuntimeMetrics();
    appendAuditEvent("deployment_summary_sent", {
        channelId: DEPLOYMENT_SUMMARY_CHANNEL_ID,
        commit: gitInfo.commit,
        messageId: sent.id
    });
}

function rememberModerationLog(action: "kick" | "ban", guildId: string, userId: string): void {
    recentModerationLogEvents.set(`${action}:${guildId}:${userId}`, Date.now());
}

function shouldSkipRecentModerationLog(action: "kick" | "ban", guildId: string, userId: string, windowMs = 15_000): boolean {
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

function readInstanceLockState(): {
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

function describeInFlightTicketCreateLocks(limit = 5): string {
    if (!inFlightTicketCreates.size) return "none";
    const now = Date.now();
    const entries = Array.from(inFlightTicketCreates.entries())
        .slice(0, Math.max(1, limit))
        .map(([key, ts]) => `${key} (${Math.max(0, Math.floor((now - ts) / 1000))}s)`);
    return entries.join("\n");
}

function readRecentTicketOpsEvents(limit = 8): string[] {
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

function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function toIsoOrNever(ts: number | null | undefined): string {
    if (!ts || ts <= 0) return "never";
    return new Date(ts).toISOString();
}

function statLabel(filePath: string): string {
    try {
        if (!fs.existsSync(filePath)) return "missing";
        const stat = fs.statSync(filePath);
        const kb = Math.max(1, Math.round(stat.size / 1024));
        return `${kb}KB | ${stat.mtime.toISOString()}`;
    } catch {
        return "unreadable";
    }
}

function statSummary(filePath: string): { exists: boolean; size: number; mtime: number } {
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

function writeJsonAtomic(filePath: string, data: unknown): void {
    const backupPath = `${filePath}.bak`;
    const backupV1Path = `${filePath}.bak.1`;
    const backupV2Path = `${filePath}.bak.2`;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.ensureDirSync(path.dirname(filePath));

    try {
        if (fs.existsSync(backupV1Path)) fs.copyFileSync(backupV1Path, backupV2Path);
        if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, backupV1Path);
    } catch {
        // Best effort backup chain rotation only.
    }

    if (fs.existsSync(filePath)) {
        try {
            fs.copyFileSync(filePath, backupPath);
        } catch {
            // Best-effort backup pre-write.
        }
    }

    try {
        fs.writeJsonSync(tempPath, data, { spaces: 2 });
        fs.moveSync(tempPath, filePath, { overwrite: true });
        try {
            fs.copyFileSync(filePath, backupPath);
        } catch {
            // Best-effort backup post-write.
        }
    } finally {
        if (fs.existsSync(tempPath)) {
            fs.removeSync(tempPath);
        }
    }
}

function readJsonWithBackup<T>(filePath: string, parse: (raw: unknown) => T | null, seed: T): T {
    const backupPath = `${filePath}.bak`;

    if (!fs.existsSync(filePath) && !fs.existsSync(backupPath)) {
        writeJsonAtomic(filePath, seed);
        return seed;
    }

    const readParsed = (candidatePath: string): T | null => {
        if (!fs.existsSync(candidatePath)) return null;
        try {
            const raw = fs.readJsonSync(candidatePath) as unknown;
            return parse(raw);
        } catch {
            return null;
        }
    };

    const primary = readParsed(filePath);
    if (primary) return primary;

    const backup = readParsed(backupPath);
    if (backup) {
        writeJsonAtomic(filePath, backup);
        appendAuditEvent("data_store_recovered_from_backup", { filePath });
        return backup;
    }

    writeJsonAtomic(filePath, seed);
    appendAuditEvent("data_store_reinitialized", { filePath });
    return seed;
}

const balanceTelemetry = readJsonWithBackup<BalanceTelemetryStore>(
    BALANCE_TELEMETRY_FILE,
    parseBalanceTelemetryStore,
    defaultBalanceTelemetryStore()
);

function saveBalanceTelemetry(): void {
    balanceTelemetry.updatedAt = Date.now();
    writeJsonAtomic(BALANCE_TELEMETRY_FILE, balanceTelemetry);
}

function ensureBalanceSlice(store: Record<string, BalanceSlice>, key: string): BalanceSlice {
    if (!store[key]) store[key] = defaultBalanceSlice();
    return store[key];
}

function trackRaidCommandUsage(commandName: string): void {
    balanceTelemetry.commands[commandName] = (balanceTelemetry.commands[commandName] || 0) + 1;
    saveBalanceTelemetry();
}

function recordRaidTelemetry(input: {
    mapLabel: string;
    mapDifficulty: string;
    conditionLabel: string;
    tensionLabel: string;
    success: boolean;
    successChance: number;
    bet: number;
    net: number;
    baseRewardTokens: number;
    outcomeBonusTokens: number;
    bossBonusTokens: number;
    failureMitigationTokens: number;
    loot: Array<{ id: string; qty: number }>;
    bossSpawned?: boolean;
    bossDefeated?: boolean;
}): void {
    const raid = balanceTelemetry.raid;
    const safeBet = Math.max(0, Math.floor(input.bet));
    const safeBaseReward = Math.max(0, Math.floor(input.baseRewardTokens));
    const safeOutcomeBonus = Math.max(0, Math.floor(input.outcomeBonusTokens));
    const safeBossBonus = Math.max(0, Math.floor(input.bossBonusTokens));
    const safeMitigation = Math.max(0, Math.floor(input.failureMitigationTokens));
    const safeReward = safeBaseReward + safeOutcomeBonus + safeBossBonus + safeMitigation;
    const safeSuccessChance = Math.max(0, Math.min(100, Math.floor(input.successChance)));

    raid.runs += 1;
    raid.totalBet += safeBet;
    raid.totalNet += Math.floor(input.net);
    if (input.success) raid.wins += 1;
    else raid.losses += 1;
    if (input.bossSpawned) raid.bossSpawns += 1;
    if (input.bossDefeated) raid.bossKills += 1;
    raid.tokenSources.baseReward += safeBaseReward;
    raid.tokenSources.outcomeBonus += safeOutcomeBonus;
    raid.tokenSources.bossBonus += safeBossBonus;
    raid.tokenSources.failureMitigation += safeMitigation;

    const tensionKey = String(input.tensionLabel || "unknown").toLowerCase();
    const mapKey = String(input.mapLabel || "unknown");
    const difficultyKey = String(input.mapDifficulty || "unknown");
    const conditionKey = String(input.conditionLabel || "unknown").toLowerCase();
    const tensionSlice = ensureBalanceSlice(raid.byTension, tensionKey);
    const mapSlice = ensureBalanceSlice(raid.byMap, mapKey);
    const difficultySlice = ensureBalanceSlice(raid.byDifficulty, difficultyKey);
    const conditionSlice = ensureBalanceSlice(raid.byCondition, conditionKey);

    const lootItems = input.loot.reduce((sum, item) => sum + Math.max(0, Math.floor(item.qty)), 0);
    const lootValue = input.loot.reduce((sum, item) => {
        const qty = Math.max(0, Math.floor(item.qty));
        const unit = Math.max(0, ITEM_DEFS[item.id]?.price || 0);
        return sum + (qty * unit);
    }, 0);

    const recordSlice = (slice: BalanceSlice): void => {
        slice.runs += 1;
        if (input.success) slice.wins += 1;
        slice.net += Math.floor(input.net);
        slice.totalBet += safeBet;
        slice.totalReward += safeReward;
        slice.successChanceSum += safeSuccessChance;
        if (input.bossSpawned) slice.bossSpawns += 1;
        if (input.bossDefeated) slice.bossKills += 1;
        slice.lootItems += lootItems;
        slice.lootValue += lootValue;
    };

    recordSlice(tensionSlice);
    recordSlice(mapSlice);
    recordSlice(difficultySlice);
    recordSlice(conditionSlice);

    for (const item of input.loot) {
        const qty = Math.max(0, Math.floor(item.qty));
        if (!qty) continue;
        const rarity = String(ITEM_DEFS[item.id]?.rarity || "unknown").toLowerCase();
        raid.lootByRarity[rarity] = (raid.lootByRarity[rarity] || 0) + qty;
    }

    saveBalanceTelemetry();
}

function recordConsumableTelemetry(itemId: string, qty: number, autoUse: boolean, failed: boolean): void {
    const entry = balanceTelemetry.consumables[itemId] || { uses: 0, qty: 0, failures: 0, autoUses: 0 };
    if (failed) {
        entry.failures += 1;
    } else {
        entry.uses += 1;
        entry.qty += Math.max(1, Math.floor(qty));
        if (autoUse) entry.autoUses += 1;
    }
    balanceTelemetry.consumables[itemId] = entry;
    saveBalanceTelemetry();
}

function recordCrateTelemetry(crateId: string, autoOpen: boolean, drops: Array<{ id: string; qty: number }>): void {
    const entry = balanceTelemetry.crates[crateId] || { opened: 0, autoOpened: 0, totalDrops: 0 };
    entry.opened += 1;
    if (autoOpen) entry.autoOpened += 1;
    entry.totalDrops += drops.reduce((acc, item) => acc + Math.max(0, Math.floor(item.qty)), 0);
    balanceTelemetry.crates[crateId] = entry;
    saveBalanceTelemetry();
}

function checkpointState(reason: string): void {
    try {
        savePoints();
        saveTradeStore();
        saveGiveawayStore();
        saveModerationStore();
        saveTicketStore();
        saveBalanceTelemetry();
        saveRuntimeMetrics();
        appendAuditEvent("checkpoint", { reason });
    } catch {
        // Best-effort checkpoint only.
    }
}

function readTradeStore(): TradeStore {
    return readJsonWithBackup(TRADE_DATA_FILE, raw => {
        const candidate = raw as Partial<TradeStore>;
        if (candidate && Array.isArray(candidate.offers) && typeof candidate.nextId === "number") {
            const offers = normalizeTradeOffers(candidate.offers);
            return { nextId: Math.max(1, candidate.nextId), offers };
        }
        return null;
    }, { nextId: 1, offers: [] });
}

function normalizeTradeOffers(rawOffers: unknown[], now = Date.now()): TradeOffer[] {
    const openOffers: TradeOffer[] = [];
    const recentClosedOffers: TradeOffer[] = [];

    for (const raw of rawOffers) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Partial<TradeOffer>;
        if (typeof row.id !== "number" || !Number.isFinite(row.id)) continue;
        if (typeof row.guildId !== "string" || typeof row.fromUserId !== "string" || typeof row.toUserId !== "string") continue;
        if (typeof row.offerItemId !== "string" || typeof row.requestItemId !== "string") continue;
        if (typeof row.offerQty !== "number" || typeof row.requestQty !== "number") continue;

        const status: TradeOfferStatus = row.status === "accepted" || row.status === "declined" || row.status === "cancelled"
            ? row.status
            : "open";
        const createdAt = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : now;
        const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : createdAt;
        const offer: TradeOffer = {
            id: Math.max(1, Math.floor(row.id)),
            guildId: row.guildId,
            fromUserId: row.fromUserId,
            toUserId: row.toUserId,
            offerItemId: row.offerItemId,
            offerQty: Math.max(1, Math.floor(row.offerQty)),
            requestItemId: row.requestItemId,
            requestQty: Math.max(1, Math.floor(row.requestQty)),
            status,
            createdAt,
            updatedAt
        };

        if (status === "open") {
            openOffers.push(offer);
            continue;
        }

        if (now - updatedAt <= CLOSED_TRADE_RETENTION_MS) {
            recentClosedOffers.push(offer);
        }
    }

    recentClosedOffers.sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
    const trimmedClosed = recentClosedOffers.slice(0, MAX_CLOSED_TRADES);
    return [...openOffers, ...trimmedClosed];
}

function pruneTradeOffers(now = Date.now()): void {
    const normalized = normalizeTradeOffers(tradeStore.offers as unknown[], now);
    if (normalized.length !== tradeStore.offers.length) {
        tradeStore.offers = normalized;
    }
}

const tradeStore = readTradeStore();

function saveTradeStore(): void {
    pruneTradeOffers();
    writeJsonAtomic(TRADE_DATA_FILE, tradeStore);
}

function normalizeGiveawayStore(raw: unknown): GiveawayStore | null {
    const candidate = raw as Partial<GiveawayStore>;
    if (!candidate || !Array.isArray(candidate.giveaways) || typeof candidate.nextId !== "number") return null;

    const giveaways: GiveawayEntry[] = candidate.giveaways
        .filter(row => Boolean(row && typeof row === "object"))
        .map(row => {
            const entry = row as Partial<GiveawayEntry>;
            const status: GiveawayStatus = entry.status === "ended" || entry.status === "cancelled" ? entry.status : "active";
            const rewardKind: GiveawayEntry["rewardKind"] = entry.rewardKind === "item" ? "item" : "generic";
            return {
            id: Math.max(1, Math.floor(Number(row.id) || 0)),
            guildId: String(entry.guildId || ""),
            channelId: String(entry.channelId || ""),
            messageId: entry.messageId ? String(entry.messageId) : null,
            hostId: String(entry.hostId || ""),
            prize: String(entry.prize || "Giveaway"),
            description: String(entry.description || ""),
            rewardKind,
            rewardItemId: entry.rewardItemId ? String(entry.rewardItemId) : null,
            rewardQty: Math.max(1, Math.floor(Number(entry.rewardQty) || 1)),
            winnerCount: Math.max(1, Math.floor(Number(entry.winnerCount) || 1)),
            roleRequiredId: entry.roleRequiredId ? String(entry.roleRequiredId) : null,
            createdAt: Math.max(0, Math.floor(Number(entry.createdAt) || Date.now())),
            endAt: Math.max(0, Math.floor(Number(entry.endAt) || Date.now())),
            updatedAt: Math.max(0, Math.floor(Number(entry.updatedAt) || Date.now())),
            status,
            entries: Array.from(new Set(Array.isArray(entry.entries) ? entry.entries.map(value => String(value)) : [])),
            winners: Array.from(new Set(Array.isArray(entry.winners) ? entry.winners.map(value => String(value)) : [])),
            endedAt: typeof entry.endedAt === "number" ? entry.endedAt : null
            };
        })
        .filter(entry => entry.id > 0 && entry.guildId && entry.channelId && entry.hostId);

    return { nextId: Math.max(1, Math.floor(candidate.nextId)), giveaways };
}

const giveawayStore = readJsonWithBackup<GiveawayStore>(
    GIVEAWAY_DATA_FILE,
    normalizeGiveawayStore,
    { nextId: 1, giveaways: [] }
);

function pruneGiveaways(now = Date.now()): void {
    const active = giveawayStore.giveaways.filter(entry => entry.status === "active");
    const closed = giveawayStore.giveaways
        .filter(entry => entry.status !== "active")
        .filter(entry => {
            const closedAt = entry.endedAt || entry.updatedAt || entry.endAt;
            return now - closedAt <= CLOSED_GIVEAWAY_RETENTION_MS;
        })
        .sort((a, b) => (b.endedAt || b.updatedAt || b.endAt) - (a.endedAt || a.updatedAt || a.endAt))
        .slice(0, MAX_CLOSED_GIVEAWAYS);

    giveawayStore.giveaways = [...active, ...closed];
}

function saveGiveawayStore(): void {
    pruneGiveaways();
    writeJsonAtomic(GIVEAWAY_DATA_FILE, giveawayStore);
}

function getGiveawayById(id: number): GiveawayEntry | null {
    return giveawayStore.giveaways.find(entry => entry.id === id) || null;
}

function formatGiveawayDuration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds % 60}s`;
}

function shuffleUserIds(ids: string[]): string[] {
    const values = [...ids];
    for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
}

function pickGiveawayWinners(giveaway: GiveawayEntry): string[] {
    return shuffleUserIds(giveaway.entries).slice(0, Math.max(1, giveaway.winnerCount));
}

function buildGiveawayEmbed(giveaway: GiveawayEntry, now = Date.now()): EmbedBuilder {
    const remainingMs = Math.max(0, giveaway.endAt - now);
    const winnersText = giveaway.winners.length ? giveaway.winners.map(id => `<@${id}>`).join(", ") : "Pending draw";
    const rewardDetail = giveaway.rewardKind === "item" && giveaway.rewardItemId
        ? `${ITEM_DEFS[giveaway.rewardItemId]?.name || giveaway.rewardItemId} x${giveaway.rewardQty}`
        : giveaway.prize;
    return new EmbedBuilder()
        .setColor(giveaway.status === "active" ? 0xf59e0b : 0x22c55e)
        .setTitle(`🎉 ${giveaway.prize}`)
        .setDescription(giveaway.description || "Press the button below to enter before the timer ends.")
        .addFields(
            { name: "Giveaway ID", value: `#${giveaway.id}`, inline: true },
            { name: "Hosted By", value: `<@${giveaway.hostId}>`, inline: true },
            { name: "Status", value: giveaway.status.toUpperCase(), inline: true },
            { name: "Winners", value: `${giveaway.winnerCount}`, inline: true },
            { name: "Entries", value: `${giveaway.entries.length}`, inline: true },
            { name: "Reward", value: rewardDetail, inline: false },
            { name: "Role Requirement", value: giveaway.roleRequiredId ? `<@&${giveaway.roleRequiredId}>` : "None", inline: true },
            { name: giveaway.status === "active" ? "Ends" : "Ended", value: giveaway.status === "active" ? `<t:${Math.floor(giveaway.endAt / 1000)}:R>\n<t:${Math.floor(giveaway.endAt / 1000)}:F>` : (giveaway.endedAt ? `<t:${Math.floor(giveaway.endedAt / 1000)}:R>` : "Ended"), inline: false },
            { name: "Current Winners", value: winnersText, inline: false }
        )
        .setFooter({ text: giveaway.status === "active" ? "Press Enter Giveaway below to participate." : "Giveaway closed." })
        .setTimestamp(new Date(giveaway.endAt));
}

function buildGiveawayActionRow(giveaway: GiveawayEntry): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`${GIVEAWAY_IDS.enterPrefix}:${giveaway.id}`)
            .setLabel(giveaway.status === "active" ? "Enter Giveaway" : "Giveaway Closed")
            .setEmoji("🎉")
            .setStyle(giveaway.status === "active" ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(giveaway.status !== "active")
    );
}

async function sendGiveawayLog(guildId: string, title: string, fields: Array<{ name: string; value: string; inline?: boolean }>): Promise<void> {
    const state = ensureGuildModeration(guildId);
    const targetChannelId = state.modLogChannelId || MOD_LOG_CHANNEL_ID || ACTIVITY_CHANNEL_ID || HEALTH_REPORT_CHANNEL_ID;
    if (!targetChannelId) return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle(`🎉 ${title}`)
        .addFields(fields), "FN Giveaway Desk", "Giveaway live feed");
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

async function syncGiveawayMessage(giveaway: GiveawayEntry): Promise<void> {
    if (!giveaway.messageId) return;
    const guild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
    if (!guild) return;
    const channel = guild.channels.cache.get(giveaway.channelId) || await guild.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (!message) return;
    await message.edit({ embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayActionRow(giveaway)] }).catch(() => undefined);
}

async function createAndPostGiveaway(input: {
    guild: Guild;
    channel: TextChannel;
    hostId: string;
    prize: string;
    description: string;
    durationMs: number;
    winnerCount: number;
    roleRequiredId: string | null;
    rewardKind: "generic" | "item";
    rewardItemId?: string | null;
    rewardQty?: number;
    announcementContent?: string;
    mentionUserIds?: string[];
    mentionRoleIds?: string[];
    mentionEveryone?: boolean;
}): Promise<GiveawayEntry | null> {
    const giveaway: GiveawayEntry = {
        id: giveawayStore.nextId++,
        guildId: input.guild.id,
        channelId: input.channel.id,
        messageId: null,
        hostId: input.hostId,
        prize: input.prize,
        description: input.description,
        rewardKind: input.rewardKind,
        rewardItemId: input.rewardItemId || null,
        rewardQty: Math.max(1, input.rewardQty || 1),
        winnerCount: input.winnerCount,
        roleRequiredId: input.roleRequiredId,
        createdAt: Date.now(),
        endAt: Date.now() + input.durationMs,
        updatedAt: Date.now(),
        status: "active",
        entries: [],
        winners: [],
        endedAt: null
    };
    giveawayStore.giveaways.push(giveaway);
    saveGiveawayStore();

    const allowedMentions = {
        parse: input.mentionEveryone ? ["everyone"] as Array<"everyone"> : [],
        users: input.mentionUserIds || [],
        roles: input.mentionRoleIds || []
    };
    const sent = await input.channel.send({ content: input.announcementContent || undefined, embeds: [buildGiveawayEmbed(giveaway)], components: [buildGiveawayActionRow(giveaway)], allowedMentions }).catch(() => null);
    if (!sent) {
        giveawayStore.giveaways = giveawayStore.giveaways.filter(entry => entry.id !== giveaway.id);
        saveGiveawayStore();
        return null;
    }

    giveaway.messageId = sent.id;
    giveaway.updatedAt = Date.now();
    saveGiveawayStore();
    return giveaway;
}

async function resolveConfiguredGiveawayChannel(guild: Guild): Promise<TextChannel | null> {
    if (!GIVEAWAY_CHANNEL_ID) return null;
    const channel = guild.channels.cache.get(GIVEAWAY_CHANNEL_ID) || await guild.channels.fetch(GIVEAWAY_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return channel;
}

function buildGiveawayAnnouncement(input: {
    prize: string;
    mentionRoleId?: string | null;
    mentionUserId?: string | null;
    pingEveryone?: boolean;
}): string {
    const mentions = [
        input.pingEveryone ? "@everyone" : null,
        input.mentionRoleId ? `<@&${input.mentionRoleId}>` : null,
        input.mentionUserId ? `<@${input.mentionUserId}>` : null
    ].filter(Boolean);
    return [
        mentions.join(" ").trim() || null,
        `A new giveaway is now live: **${input.prize}**`
    ].filter(Boolean).join("\n");
}

async function finalizeGiveaway(giveaway: GiveawayEntry, reason: "timer" | "manual" | "reroll" = "timer"): Promise<void> {
    if (giveaway.status !== "active" && reason !== "reroll") return;
    if (reason !== "reroll") {
        giveaway.status = "ended";
        giveaway.endedAt = Date.now();
    }
    giveaway.winners = giveaway.entries.length ? pickGiveawayWinners(giveaway) : [];
    if (giveaway.rewardKind === "item" && giveaway.rewardItemId) {
        for (const winnerId of giveaway.winners) {
            addInventoryItem(winnerId, giveaway.rewardItemId, giveaway.rewardQty);
        }
    }
    giveaway.updatedAt = Date.now();
    saveGiveawayStore();
    await syncGiveawayMessage(giveaway);

    const guild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
    const channel = guild ? (guild.channels.cache.get(giveaway.channelId) || await guild.channels.fetch(giveaway.channelId).catch(() => null)) : null;
    if (channel && channel.isTextBased()) {
        const content = giveaway.winners.length
            ? `🎉 Giveaway #${giveaway.id} ended! Winner${giveaway.winners.length === 1 ? "" : "s"}: ${giveaway.winners.map(id => `<@${id}>`).join(", ")} | Prize: **${giveaway.prize}**`
            : `Giveaway #${giveaway.id} ended with no valid entrants for **${giveaway.prize}**.`;
        await channel.send({ content, allowedMentions: { users: giveaway.winners, parse: [] } }).catch(() => undefined);
    }

    appendAuditEvent(reason === "reroll" ? "giveaway_reroll" : "giveaway_end", {
        guildId: giveaway.guildId,
        giveawayId: giveaway.id,
        channelId: giveaway.channelId,
        winnerIds: giveaway.winners,
        prize: giveaway.prize,
        reason
    });

    await sendGiveawayLog(giveaway.guildId, reason === "reroll" ? `Giveaway #${giveaway.id} Rerolled` : `Giveaway #${giveaway.id} Ended`, [
        { name: "Prize", value: giveaway.prize, inline: false },
        { name: "Winners", value: giveaway.winners.length ? giveaway.winners.map(id => `<@${id}>`).join(", ") : "No valid entrants", inline: false },
        { name: "Entries", value: `${giveaway.entries.length}`, inline: true }
    ]);
}

async function processDueGiveaways(now = Date.now()): Promise<void> {
    const due = giveawayStore.giveaways.filter(giveaway => giveaway.status === "active" && giveaway.endAt <= now);
    for (const giveaway of due) {
        await finalizeGiveaway(giveaway, "timer");
    }
}

async function refreshActiveGiveawayEmbeds(now = Date.now()): Promise<void> {
    const active = giveawayStore.giveaways.filter(giveaway => giveaway.status === "active" && giveaway.endAt > now);
    for (const giveaway of active) {
        await syncGiveawayMessage(giveaway);
    }
}

function createTradeOffer(input: Omit<TradeOffer, "id" | "status" | "createdAt" | "updatedAt">): TradeOffer {
    const offer: TradeOffer = {
        id: tradeStore.nextId++,
        status: "open",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...input
    };
    tradeStore.offers.push(offer);
    saveTradeStore();
    return offer;
}

function getOpenTradeOffer(offerId: number): TradeOffer | null {
    const offer = tradeStore.offers.find(entry => entry.id === offerId);
    if (!offer || offer.status !== "open") return null;
    return offer;
}

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
    };
};

type ModerationStore = {
    guilds: Record<string, GuildModerationState>;
};

type TicketConfig = {
    categoryId: string | null;
    archiveCategoryId: string | null;
    logChannelId: string | null;
    retentionDays: number | null;
    reopenWindowHours: number | null;
    exportWebhookUrl: string | null;
};

type TicketPriority = StateTicketPriority;
type TicketWorkflowStatus = StateTicketWorkflowStatus;
type TicketEntry = StateTicketRecord;
type TicketStore = StateTicketStoreState & {
    guildConfigs: Record<string, TicketConfig>;
};

type XpTierConfig = { xp: number; roleId: string; name: string };

type RoleSanityReport = {
    configuredTierCount: number;
    existingTierCount: number;
    missing: XpTierConfig[];
    hierarchyBlocked: Array<{ tier: XpTierConfig; rolePosition: number }>;
    multiTierMembers: number;
    canManageRoles: boolean;
    botHighestRolePosition: number;
};

type TicketSanityReport = {
    total: number;
    open: number;
    claimed: number;
    archived: number;
    resolved: number;
    missingChannels: number;
    duplicateOpenOwners: number;
    panelMissing: number;
    slaBreaches: number;
};

type TicketRowLike = {
    id?: unknown;
    guildId?: unknown;
    ownerId?: unknown;
    channelId?: unknown;
    reason?: unknown;
    status?: unknown;
    priority?: unknown;
    workflowStatus?: unknown;
    claimedById?: unknown;
    assignedToId?: unknown;
    panelMessageId?: unknown;
    firstResponseAt?: unknown;
    archivedAt?: unknown;
    resolvedAt?: unknown;
    closedReason?: unknown;
    resolvedReason?: unknown;
    transcript?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    category?: unknown;
    tags?: unknown;
    linkedTicketId?: unknown;
    parentTicketId?: unknown;
    childTicketIds?: unknown;
    mergedIntoTicketId?: unknown;
    reopenUntilAt?: unknown;
    reopenedCount?: unknown;
    internalNotes?: unknown;
    csat?: unknown;
    slaPolicy?: unknown;
};

type ComponentLike = {
    customId?: string | null;
};

type ComponentRowLike = {
    components?: ComponentLike[] | null;
};

type MessageWithComponents = {
    components?: ComponentRowLike[] | null;
};

function normalizeTicketStatus(status: unknown): TicketEntry["status"] {
    return stateNormalizeTicketStatus(status);
}

function normalizeTicketPriority(priority: unknown): TicketPriority {
    return stateNormalizeTicketPriority(priority);
}

function normalizeTicketWorkflowStatus(status: unknown): TicketWorkflowStatus {
    return stateNormalizeTicketWorkflowStatus(status);
}

function canTransitionTicketStatus(fromStatus: unknown, toStatus: unknown): boolean {
    return stateCanTransitionTicketStatus(fromStatus, toStatus);
}

function normalizeTicketFromRaw(ticketRaw: TicketRowLike): TicketEntry | null {
    const transcriptRaw = ticketRaw.transcript && typeof ticketRaw.transcript === "object"
        ? ticketRaw.transcript as Record<string, unknown>
        : null;

    const transcript = transcriptRaw
        ? {
            exportedAt: typeof transcriptRaw.exportedAt === "number" ? transcriptRaw.exportedAt : Date.now(),
            messageCountApprox: typeof transcriptRaw.messageCountApprox === "number" ? transcriptRaw.messageCountApprox : 0,
            firstMessageAt: typeof transcriptRaw.firstMessageAt === "number" ? transcriptRaw.firstMessageAt : null,
            lastMessageAt: typeof transcriptRaw.lastMessageAt === "number" ? transcriptRaw.lastMessageAt : null,
            channelName: String(transcriptRaw.channelName || "unknown"),
            transcriptPath: transcriptRaw.transcriptPath ? String(transcriptRaw.transcriptPath) : undefined,
            transcriptFormat: transcriptRaw.transcriptFormat === "txt" ? ("txt" as const) : undefined
        }
        : null;

    const notesRaw = Array.isArray(ticketRaw.internalNotes) ? ticketRaw.internalNotes : [];
    const internalNotes: TicketNote[] = notesRaw
        .map(note => {
            const cast = note as Record<string, unknown>;
            if (!cast || typeof cast !== "object") return null;
            const byId = typeof cast.byId === "string" ? cast.byId : "";
            const at = typeof cast.at === "number" ? cast.at : Date.now();
            const text = typeof cast.note === "string" ? cast.note : "";
            if (!byId || !text) return null;
            return { byId, at, note: text.slice(0, 500) };
        })
        .filter((note): note is TicketNote => note !== null);

    const csatRaw = ticketRaw.csat && typeof ticketRaw.csat === "object"
        ? ticketRaw.csat as Record<string, unknown>
        : null;
    const csat: TicketCsatRecord | null = csatRaw
        ? {
            rating: Math.max(1, Math.min(5, Number(csatRaw.rating) || 5)),
            submittedAt: typeof csatRaw.submittedAt === "number" ? csatRaw.submittedAt : Date.now(),
            submittedById: typeof csatRaw.submittedById === "string" ? csatRaw.submittedById : "unknown",
            ...(typeof csatRaw.comment === "string" ? { comment: csatRaw.comment.slice(0, 300) } : {})
        }
        : null;

    const rawCategory = typeof ticketRaw.category === "string" ? ticketRaw.category : "general";
    const category = classifyTicketCategory(rawCategory);
    const priority = normalizeTicketPriority(ticketRaw.priority);
    const derivedPolicy = getTicketSlaPolicy(category, priority);
    const rawSla = ticketRaw.slaPolicy && typeof ticketRaw.slaPolicy === "object"
        ? ticketRaw.slaPolicy as Record<string, unknown>
        : null;

    const normalized: TicketEntry = {
        id: Number(ticketRaw.id) || 0,
        guildId: String(ticketRaw.guildId || ""),
        ownerId: String(ticketRaw.ownerId || ""),
        channelId: String(ticketRaw.channelId || ""),
        reason: String(ticketRaw.reason || "General support"),
        status: normalizeTicketStatus(ticketRaw.status),
        priority,
        workflowStatus: normalizeTicketWorkflowStatus(ticketRaw.workflowStatus),
        claimedById: ticketRaw.claimedById ? String(ticketRaw.claimedById) : null,
        assignedToId: ticketRaw.assignedToId ? String(ticketRaw.assignedToId) : null,
        panelMessageId: ticketRaw.panelMessageId ? String(ticketRaw.panelMessageId) : null,
        firstResponseAt: typeof ticketRaw.firstResponseAt === "number" ? ticketRaw.firstResponseAt : null,
        archivedAt: typeof ticketRaw.archivedAt === "number" ? ticketRaw.archivedAt : null,
        resolvedAt: typeof ticketRaw.resolvedAt === "number" ? ticketRaw.resolvedAt : null,
        closedReason: ticketRaw.closedReason ? String(ticketRaw.closedReason) : null,
        resolvedReason: ticketRaw.resolvedReason ? String(ticketRaw.resolvedReason) : null,
        transcript,
        createdAt: typeof ticketRaw.createdAt === "number" ? ticketRaw.createdAt : Date.now(),
        updatedAt: typeof ticketRaw.updatedAt === "number" ? ticketRaw.updatedAt : Date.now(),
        category,
        tags: Array.isArray(ticketRaw.tags) ? ticketRaw.tags.map(tag => String(tag).slice(0, 30)) : [],
        linkedTicketId: typeof ticketRaw.linkedTicketId === "number" ? ticketRaw.linkedTicketId : null,
        parentTicketId: typeof ticketRaw.parentTicketId === "number" ? ticketRaw.parentTicketId : null,
        childTicketIds: Array.isArray(ticketRaw.childTicketIds) ? ticketRaw.childTicketIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0) : [],
        mergedIntoTicketId: typeof ticketRaw.mergedIntoTicketId === "number" ? ticketRaw.mergedIntoTicketId : null,
        reopenUntilAt: typeof ticketRaw.reopenUntilAt === "number" ? ticketRaw.reopenUntilAt : null,
        reopenedCount: typeof ticketRaw.reopenedCount === "number" ? ticketRaw.reopenedCount : 0,
        internalNotes,
        csat,
        slaPolicy: {
            name: typeof rawSla?.name === "string" ? rawSla.name : derivedPolicy.name,
            firstResponseMs: typeof rawSla?.firstResponseMs === "number" ? rawSla.firstResponseMs : derivedPolicy.firstResponseMs,
            resolveMs: typeof rawSla?.resolveMs === "number" ? rawSla.resolveMs : derivedPolicy.resolveMs
        }
    };

    if (!(normalized.id > 0 && normalized.guildId && normalized.ownerId && normalized.channelId)) {
        return null;
    }

    return normalized;
}

function readTicketStore(): TicketStore {
    return readJsonWithBackup(TICKET_DATA_FILE, raw => {
        const candidate = raw as Partial<TicketStore>;
        if (candidate && typeof candidate.nextId === "number" && candidate.guildConfigs && Array.isArray(candidate.tickets)) {
            const normalizedTickets = candidate.tickets
                .map(ticketRaw => normalizeTicketFromRaw((ticketRaw && typeof ticketRaw === "object") ? (ticketRaw as TicketRowLike) : {}))
                .filter((ticket): ticket is TicketEntry => ticket !== null);

            const normalizedStore: TicketStore = {
                nextId: Math.max(1, candidate.nextId),
                version: typeof candidate.version === "number" && candidate.version > 0 ? Math.floor(candidate.version) : 1,
                guildConfigs: candidate.guildConfigs,
                tickets: normalizedTickets
            };
            return normalizedStore;
        }
        return null;
    }, { nextId: 1, version: 1, guildConfigs: {}, tickets: [] });
}

const ticketStore = readTicketStore();

function readDiskTicketStoreVersion(): number | null {
    if (!fs.existsSync(TICKET_DATA_FILE)) return null;
    try {
        const raw = fs.readJsonSync(TICKET_DATA_FILE) as { version?: unknown };
        if (typeof raw.version !== "number" || raw.version <= 0) {
            return 1;
        }
        return Math.floor(raw.version);
    } catch {
        return null;
    }
}

function saveTicketStore(): boolean {
    const diskVersion = readDiskTicketStoreVersion();
    if (diskVersion !== null && diskVersion !== ticketStore.version) {
        appendAuditEvent("ticket_store_version_conflict", {
            expectedVersion: ticketStore.version,
            diskVersion
        });
        return false;
    }

    const previousVersion = ticketStore.version;
    ticketStore.version = previousVersion + 1;
    try {
        writeJsonAtomic(TICKET_DATA_FILE, ticketStore);
        return true;
    } catch {
        ticketStore.version = previousVersion;
        return false;
    }
}

function ensureTicketConfig(guildId: string): TicketConfig {
    if (!ticketStore.guildConfigs[guildId]) {
        ticketStore.guildConfigs[guildId] = {
            categoryId: null,
            archiveCategoryId: null,
            logChannelId: null,
            retentionDays: 45,
            reopenWindowHours: 72,
            exportWebhookUrl: null
        };
        saveTicketStore();
    }

    const cfg = ticketStore.guildConfigs[guildId];
    if (cfg.categoryId === undefined) cfg.categoryId = null;
    if (cfg.archiveCategoryId === undefined) cfg.archiveCategoryId = null;
    if (cfg.logChannelId === undefined) cfg.logChannelId = null;
    if (cfg.retentionDays === undefined) cfg.retentionDays = 45;
    if (cfg.reopenWindowHours === undefined) cfg.reopenWindowHours = 72;
    if (cfg.exportWebhookUrl === undefined) cfg.exportWebhookUrl = null;
    return cfg;
}

function findOpenTicketByOwner(guildId: string, ownerId: string): TicketEntry | null {
    return stateFindOpenTicketByOwner(ticketStore.tickets, guildId, ownerId);
}

type TicketCaseBucket = "support" | "report";

function getTicketCaseBucket(categoryOrReason: string | null | undefined): TicketCaseBucket {
    return classifyTicketCategory(categoryOrReason || "general") === "report" ? "report" : "support";
}

function findOpenTicketByOwnerInBucket(guildId: string, ownerId: string, bucket: TicketCaseBucket): TicketEntry | null {
    return ticketStore.tickets.find(ticket =>
        ticket.guildId === guildId
        && ticket.ownerId === ownerId
        && (normalizeTicketStatus(ticket.status) === "open" || normalizeTicketStatus(ticket.status) === "claimed")
        && getTicketCaseBucket(ticket.category || ticket.reason) === bucket
    ) || null;
}

function findOpenTicketByChannel(channelId: string): TicketEntry | null {
    return stateFindOpenTicketByChannel(ticketStore.tickets, channelId);
}

function findTicketByChannel(channelId: string): TicketEntry | null {
    return stateFindTicketByChannel(ticketStore.tickets, channelId);
}

function findArchivedTicketByChannel(channelId: string): TicketEntry | null {
    return stateFindArchivedTicketByChannel(ticketStore.tickets, channelId);
}

function findTicketById(ticketId: number): TicketEntry | null {
    return ticketStore.tickets.find(ticket => ticket.id === ticketId) || null;
}

function buildTicketSlaThresholds(ticket: TicketEntry): { firstResponseWarnMs: number; firstResponseBreachMs: number; resolveWarnMs: number; resolveBreachMs: number } {
    const policy = ticket.slaPolicy || getTicketSlaPolicy(ticket.category || "general", ticket.priority);
    const firstResponseBreachMs = Math.max(2 * 60 * 1000, policy.firstResponseMs);
    const resolveBreachMs = Math.max(2 * 60 * 60 * 1000, policy.resolveMs);
    return {
        firstResponseWarnMs: Math.max(60_000, Math.floor(firstResponseBreachMs * 0.66)),
        firstResponseBreachMs,
        resolveWarnMs: Math.max(firstResponseBreachMs, Math.floor(resolveBreachMs * 0.84)),
        resolveBreachMs
    };
}

async function autoRouteTicket(guild: Guild, ticket: TicketEntry): Promise<void> {
    const role = guild.roles.cache.get(TICKET_HANDLER_ROLE_ID) || await guild.roles.fetch(TICKET_HANDLER_ROLE_ID).catch(() => null);
    if (!role) return;

    const handlerIds = Array.from(role.members.values())
        .filter(member => !member.user.bot)
        .map(member => member.id);
    const best = pickLeastLoadedAssignee(handlerIds, ticketStore.tickets);
    if (!best) return;

    const assigned = assignTicketToUser(ticket.channelId, best);
    if (!assigned) return;
    await updateTicketOpsPanelMessage(guild, assigned);
    appendAuditEvent("ticket_auto_route", {
        guildId: guild.id,
        ticketId: assigned.id,
        assignedToId: best,
        category: assigned.category || "general",
        policy: assigned.slaPolicy?.name || "default"
    });
}

function evaluateTicketDeflection(guildId: string, ownerId: string, reason: string): { blocked: boolean; message?: string } {
    const duplicates = findPotentialDuplicateTickets({
        tickets: ticketStore.tickets,
        guildId,
        ownerId,
        reason,
        lookbackMs: 21 * 24 * 60 * 60 * 1000
    });
    const kb = getKbSuggestions(reason);
    if (!duplicates.length) return { blocked: false };

    const dupLines = duplicates
        .slice(0, 3)
        .map(d => `• #${d.ticketId} (${d.status}) similarity ${(d.score * 100).toFixed(0)}%`)
        .join("\n");

    return {
        blocked: true,
        message: [
            "Potential duplicate detected. Try these first:",
            kb.map(item => `• ${item}`).join("\n"),
            "Recent related tickets:",
            dupLines,
            "If you still need a new case, run /ticketforce."
        ].join("\n")
    };
}

function applyTicketMetadata(ticket: TicketEntry, reason: string): void {
    ticket.category = classifyTicketCategory(reason);
    ticket.slaPolicy = getTicketSlaPolicy(ticket.category, ticket.priority);
    ticket.tags = Array.from(new Set([ticket.category, ticket.priority]));
    ticket.updatedAt = Date.now();
    saveTicketStore();
}

function purgeResolvedTicketsByRetention(guildId: string, now = Date.now()): number {
    const cfg = ensureTicketConfig(guildId);
    const retentionDays = Math.max(1, Number(cfg.retentionDays || 45));
    const before = ticketStore.tickets.length;
    ticketStore.tickets = ticketStore.tickets.filter(ticket => !(
        ticket.guildId === guildId && shouldPurgeResolvedTicket(ticket, retentionDays, now)
    ));
    const removed = before - ticketStore.tickets.length;
    if (removed > 0) {
        saveTicketStore();
        appendAuditEvent("ticket_retention_purge", { guildId, retentionDays, removed });
    }
    return removed;
}

function buildTicketIntakeModal(): ModalBuilder {
    const summaryInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakeSummary)
        .setLabel("Issue Summary")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setPlaceholder("Short title: what do you need help with?");

    const categoryInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakeCategory)
        .setLabel("Category")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(40)
        .setPlaceholder("bug, billing, account, report, appeal, general");

    const detailsInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakeDetails)
        .setLabel("Details")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(900)
        .setPlaceholder("Reproduction steps, timestamps, expected vs actual behavior.");

    const platformInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakePlatform)
        .setLabel("Platform / Order ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setPlaceholder("PC / iOS / Order #...");

    const evidenceInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakeEvidence)
        .setLabel("Evidence Links")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(400)
        .setPlaceholder("Screenshots, clips, logs, message links.");

    return new ModalBuilder()
        .setCustomId(TICKET_IDS.intakeModal)
        .setTitle("Smart Ticket Intake")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(detailsInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(platformInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(evidenceInput)
        );
}

function buildAdminReportIntakeModal(): ModalBuilder {
    const targetInput = new TextInputBuilder()
        .setCustomId(REPORT_IDS.adminTarget)
        .setLabel("Target User ID or Mention")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setPlaceholder("123456789012345678 or <@123...>");

    const summaryInput = new TextInputBuilder()
        .setCustomId(REPORT_IDS.adminSummary)
        .setLabel("Report Summary")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setPlaceholder("Cheating, harassment, scam, abuse, etc.");

    const detailsInput = new TextInputBuilder()
        .setCustomId(REPORT_IDS.adminDetails)
        .setLabel("Detailed Context")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(900)
        .setPlaceholder("Optional incident details, timeline, and context.");

    const evidenceInput = new TextInputBuilder()
        .setCustomId(REPORT_IDS.adminEvidence)
        .setLabel("Evidence Links")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
        .setPlaceholder("Optional screenshots, clips, logs, links.");

    return new ModalBuilder()
        .setCustomId(REPORT_IDS.adminModal)
        .setTitle("Admin Report Intake")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(targetInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(detailsInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(evidenceInput)
        );
}

function buildRaidItemGiveawayModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(GIVEAWAY_IDS.raidItemModal)
        .setTitle("Raid Item Giveaway")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidItemId).setLabel("Raid Item ID").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder("mythic_crate, fn_coin, reactor_blade")
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidItemQty).setLabel("Quantity Per Winner").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder("1")
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidDuration).setLabel("Duration").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setPlaceholder("30m, 6h, 2d")
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidWinners).setLabel("Winner Count").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder("1")
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidDescription).setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400).setPlaceholder("Optional context or event blurb")
            )
        );
}

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

async function upsertAdminReportPanelInChannel(guild: Guild, channelId: string): Promise<{ ok: true; action: "posted" | "updated" } | { ok: false; error: string }> {
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

function buildTicketCsatButtons(ticketId: number): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:1`).setLabel("1").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:2`).setLabel("2").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:3`).setLabel("3").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:4`).setLabel("4").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${TICKET_IDS.csatPrefix}:${ticketId}:5`).setLabel("5").setStyle(ButtonStyle.Success)
    );
}

function addTicketInternalNote(ticket: TicketEntry, note: TicketNote): boolean {
    if (!ticket.internalNotes) ticket.internalNotes = [];
    ticket.internalNotes.push({ ...note, note: note.note.slice(0, 500) });
    ticket.updatedAt = Date.now();
    return saveTicketStore();
}

function postJsonToWebhook(webhookUrlRaw: string, payload: Record<string, unknown>): Promise<boolean> {
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

async function pruneDeletedTicketRecords(guild: Guild): Promise<number> {
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

async function pruneInaccessibleOwnerTicketRecords(guild: Guild): Promise<number> {
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

function findChannelOwnerFromTopic(topic: string | null | undefined): string | null {
    if (!topic) return null;
    const match = topic.match(/\((\d{17,21})\)\s*$/);
    if (!match) return null;
    return match[1];
}

function importTicketEntryForChannel(guildId: string, ownerId: string, channelId: string, reason: string): TicketEntry {
    const existing = findTicketByChannel(channelId);
    if (existing) return existing;

    const ticket: TicketEntry = {
        id: ticketStore.nextId++,
        guildId,
        ownerId,
        channelId,
        reason,
        status: "open",
        priority: "normal",
        workflowStatus: "new",
        claimedById: null,
        assignedToId: null,
        panelMessageId: null,
        firstResponseAt: null,
        archivedAt: null,
        resolvedAt: null,
        closedReason: null,
        resolvedReason: null,
        transcript: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    ticketStore.tickets.push(ticket);
    saveTicketStore();
    return ticket;
}

async function ensureTrackedTicketByChannelId(guild: Guild, channelId: string, fallbackOwnerId: string): Promise<TicketEntry | null> {
    const existing = findTicketByChannel(channelId);
    if (existing) return existing;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return null;

    const ownerFromTopic = findChannelOwnerFromTopic(channel.topic);
    const ownerId = ownerFromTopic || fallbackOwnerId;
    const concurrentExisting = findTicketByChannel(channelId);
    if (concurrentExisting) return concurrentExisting;
    const imported = importTicketEntryForChannel(guild.id, ownerId, channel.id, "Imported existing ticket channel");
    appendAuditEvent("ticket_import", {
        guildId: guild.id,
        ticketId: imported.id,
        channelId: imported.channelId,
        ownerId: imported.ownerId,
        importedByFallback: true
    });
    return imported;
}

function createTicketEntry(guildId: string, ownerId: string, channelId: string, reason: string, priority: TicketPriority): TicketEntry | null {
    return stateCreateTicketEntry(ticketStore, guildId, ownerId, channelId, reason, priority, saveTicketStore);
}

function archiveTicketByChannel(channelId: string, closeReason: string): TicketEntry | null {
    return stateArchiveTicketByChannel(ticketStore.tickets, channelId, closeReason, saveTicketStore);
}

function claimTicketByChannel(channelId: string, claimedById: string): TicketEntry | null {
    return stateClaimTicketByChannel(ticketStore.tickets, channelId, claimedById, saveTicketStore);
}

function resolveTicketByChannel(channelId: string, resolvedReason: string, transcript: TicketTranscriptStub | null): TicketEntry | null {
    return stateResolveTicketByChannel(ticketStore.tickets, channelId, resolvedReason, transcript, saveTicketStore);
}

function setTicketWorkflowStatus(channelId: string, workflowStatus: TicketWorkflowStatus): TicketEntry | null {
    return stateSetTicketWorkflowStatus(ticketStore.tickets, channelId, workflowStatus, saveTicketStore);
}

function assignTicketToUser(channelId: string, assigneeId: string): TicketEntry | null {
    return stateAssignTicketToUser(ticketStore.tickets, channelId, assigneeId, saveTicketStore);
}

function reopenTicketByChannel(channelId: string, reopenedById: string, reopenReason: string): TicketEntry | null {
    return stateReopenTicketByChannel(ticketStore.tickets, channelId, reopenedById, reopenReason, saveTicketStore);
}

function getTicketSlaState(
    ticket: TicketEntry,
    now = Date.now(),
    thresholds?: { firstResponseWarnMs: number; firstResponseBreachMs: number; resolveWarnMs: number; resolveBreachMs: number }
): { firstResponseOverdue: boolean; resolveOverdue: boolean } {
    return stateGetTicketSlaState(ticket, now, thresholds);
}

function setTicketPanelMessageId(channelId: string, panelMessageId: string): void {
    stateSetTicketPanelMessageId(ticketStore.tickets, channelId, panelMessageId, saveTicketStore);
}

function buildTicketCommandEmbed(
    title: string,
    description: string,
    ticket?: TicketEntry,
    fields: Array<{ name: string; value: string; inline?: boolean }> = []
): EmbedBuilder {
    const statusEmoji: Record<TicketEntry["status"], string> = {
        open: "🟢",
        claimed: "🛠️",
        archived: "🗂️",
        resolved: "✅"
    };
    const workflowEmoji: Record<TicketWorkflowStatus, string> = {
        new: "🆕",
        responded: "💬",
        waiting_user: "⏳",
        escalated: "🚨",
        resolved: "✅"
    };
    const priorityEmoji: Record<TicketPriority, string> = {
        low: "🟦",
        normal: "🟨",
        high: "🟥"
    };

    const embed = new EmbedBuilder()
        .setColor(0x14b8a6)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp(new Date());

    if (ticket) {
        embed.addFields(
            { name: "🎫 Ticket", value: `#${ticket.id}`, inline: true },
            { name: "📍 Channel", value: `<#${ticket.channelId}>`, inline: true },
            { name: "👤 Owner", value: `<@${ticket.ownerId}>`, inline: true },
            { name: "📌 State", value: `${statusEmoji[ticket.status]} ${ticket.status.toUpperCase()}`, inline: true },
            { name: "🧭 Workflow", value: `${workflowEmoji[ticket.workflowStatus]} ${ticket.workflowStatus}`, inline: true },
            { name: "⚡ Priority", value: `${priorityEmoji[ticket.priority]} ${ticket.priority.toUpperCase()}`, inline: true }
        );
    }

    if (fields.length) {
        embed.addFields(fields);
    }

    return sanitizeEmbedBuilder(embed);
}

function buildTicketCommandEmbedPayload(
    title: string,
    description: string,
    ticket?: TicketEntry,
    fields: Array<{ name: string; value: string; inline?: boolean }> = []
): string {
    return JSON.stringify({ embed: buildTicketCommandEmbed(title, description, ticket, fields).toJSON() });
}

function getTicketNextActionHint(ticket: TicketEntry): string {
    const status = normalizeTicketStatus(ticket.status);
    if (status === "open") return "Claim or assign the ticket to start handling.";
    if (status === "claimed" && !ticket.assignedToId) return "Assign a handler, then update workflow as you respond.";
    if (status === "claimed" && ticket.workflowStatus === "waiting_user") return "Waiting on user response. Archive when pending follow-up.";
    if (status === "archived") return "Review archive notes, then permanently resolve when complete.";
    if (status === "resolved") return "Ticket is complete. Reopen flow is not enabled.";
    return "Update workflow as the case progresses.";
}

function buildTicketOpsEmbed(ticket: TicketEntry): EmbedBuilder {
    const policy = ticket.slaPolicy || getTicketSlaPolicy(ticket.category || "general", ticket.priority);
    const sla = getTicketSlaState(ticket, Date.now(), {
        firstResponseWarnMs: Math.max(60_000, Math.floor(policy.firstResponseMs * 0.66)),
        firstResponseBreachMs: policy.firstResponseMs,
        resolveWarnMs: Math.max(policy.firstResponseMs, Math.floor(policy.resolveMs * 0.84)),
        resolveBreachMs: policy.resolveMs
    });
    const firstResponseStatus = ticket.firstResponseAt
        ? `Met <t:${Math.floor(ticket.firstResponseAt / 1000)}:R>`
        : (sla.firstResponseOverdue ? "BREACHED" : "Pending");
    const resolveStatus = ticket.resolvedAt
        ? `Resolved <t:${Math.floor(ticket.resolvedAt / 1000)}:R>`
        : (sla.resolveOverdue ? "BREACHED" : "On Track");
    const status = normalizeTicketStatus(ticket.status);
    const nextAction = getTicketNextActionHint(ticket);
    const intake = parseTicketIntakeSnapshot(ticket.reason);
    const intakeSummary = ticket.intakeSummary || intake.summary || "General support";
    const intakeCategory = ticket.intakeCategory || intake.category || String(ticket.category || "general");
    const intakeDetails = ticket.intakeDetails || intake.details || "No details provided.";
    const intakePlatform = ticket.intakePlatform || intake.platform || "Not provided";
    const intakeEvidence = ticket.intakeEvidence || intake.evidence || "No evidence provided";

    const statusLabel = `${status === "open" ? "🟢" : status === "claimed" ? "🛠️" : status === "archived" ? "🗂️" : "✅"} ${status.toUpperCase()}`;
    const workflowLabel = `${ticket.workflowStatus === "new" ? "🆕" : ticket.workflowStatus === "responded" ? "💬" : ticket.workflowStatus === "waiting_user" ? "⏳" : ticket.workflowStatus === "escalated" ? "🚨" : "✅"} ${ticket.workflowStatus}`;
    const priorityLabel = `${ticket.priority === "low" ? "🟦" : ticket.priority === "normal" ? "🟨" : "🟥"} ${ticket.priority.toUpperCase()}`;

    return brandLiveEmbed(new EmbedBuilder()
        .setColor(0x14b8a6)
        .setTitle(`🏛️ FN Support • Case #${ticket.id} Command Deck`)
        .setDescription("Premium live operations panel for this case.\nStatus, assignment, workflow, and SLA indicators refresh automatically as handlers progress resolution.")
        .addFields(
            { name: "👤 Requester", value: `<@${ticket.ownerId}>`, inline: true },
            { name: "🕒 Opened At", value: `<t:${Math.floor(ticket.createdAt / 1000)}:f>`, inline: true },
            { name: "📍 Ticket Thread", value: `<#${ticket.channelId}>`, inline: true },
            { name: "⚡ Priority Tier", value: priorityLabel, inline: true },
            { name: "🏷️ Category", value: String(ticket.category || intakeCategory), inline: true },
            { name: "🧭 Workflow Lane", value: workflowLabel, inline: true },
            { name: "🛠️ Claim Lead", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "Not claimed yet", inline: true },
            { name: "🎯 Assigned Specialist", value: ticket.assignedToId ? `<@${ticket.assignedToId}>` : "Unassigned", inline: true },
            { name: "📌 Lifecycle", value: statusLabel, inline: true },
            { name: "📝 Summary", value: intakeSummary.slice(0, 240), inline: false },
            { name: "📄 Details", value: intakeDetails.slice(0, 700), inline: false },
            { name: "🖥️ Platform / Order", value: intakePlatform === "Not provided" ? "Not provided" : intakePlatform.slice(0, 200), inline: false },
            { name: "🔗 Evidence", value: intakeEvidence.slice(0, 700), inline: false },
            { name: "⏱️ SLA Clock", value: `• Policy: ${policy.name}\n• First response target: ${Math.round(policy.firstResponseMs / 60000)}m (${firstResponseStatus})\n• Resolution target: ${Math.round(policy.resolveMs / 3600000)}h (${resolveStatus})`, inline: false },
            { name: "🧬 Case Graph", value: `Parent: ${ticket.parentTicketId ? `#${ticket.parentTicketId}` : "none"} | Linked: ${ticket.linkedTicketId ? `#${ticket.linkedTicketId}` : "none"} | Merged Into: ${ticket.mergedIntoTicketId ? `#${ticket.mergedIntoTicketId}` : "none"}`, inline: false },
            { name: "➡️ Recommended Move", value: nextAction, inline: false },
            { name: "🧰 Command Strip", value: "`/claimticket` ` /ticketassign` ` /ticketstatus` ` /reopenticket` ` /closeticket` ` /resolveticket`", inline: false }
        )
        .setFooter({ text: `FN Support Tickets • Case #${ticket.id} • Live sync` }), "FN Support Command Deck", "Live case operations");
}

async function updateTicketOpsPanelMessage(guild: Guild, ticket: TicketEntry): Promise<void> {
    const channel = (guild.channels.cache.get(ticket.channelId)
        || await guild.channels.fetch(ticket.channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) return;

    let panelMessageId = ticket.panelMessageId;
    if (!panelMessageId) {
        const legacyPrefix = `Ticket #${ticket.id} · Operations Desk`;
        const premiumPrefix = `🏛️ FN Support • Case #${ticket.id} Command Deck`;
        let candidateId: string | null = null;
        let beforeId: string | undefined;
        // Look through deeper history so legacy tickets still get live panel updates.
        for (let i = 0; i < 5; i++) {
            const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
            if (!batch || !batch.size) break;

            const candidate = batch.find(message =>
                message.author.id === (client.user?.id || "")
                && (
                    message.embeds[0]?.title?.startsWith(legacyPrefix)
                    || message.embeds[0]?.title?.startsWith(premiumPrefix)
                )
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
            setTicketPanelMessageId(ticket.channelId, candidateId);
            panelMessageId = candidateId;
        }
    }

    if (!panelMessageId) return;

    const panelMessage = await channel.messages.fetch(panelMessageId).catch(() => null);
    if (!panelMessage) return;
    await panelMessage.edit({ embeds: [buildTicketOpsEmbed(ticket)], components: panelMessage.components }).catch(() => undefined);
}

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

function saveModerationStore(): void {
    writeJsonAtomic(MOD_DATA_FILE, moderationStore);
}

function ensureGuildModeration(guildId: string): GuildModerationState {
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

function getGuildPanelMessageId(guildId: string, panel: "welcome" | "report" | "reportAdmin" | "featureBrief"): string | null {
    const cfg = ensureGuildModeration(guildId);
    const value = cfg.panelMessageIds?.[panel];
    return value ? String(value) : null;
}

function setGuildPanelMessageId(guildId: string, panel: "welcome" | "report" | "reportAdmin" | "featureBrief", messageId: string | null): void {
    const cfg = ensureGuildModeration(guildId);
    if (!cfg.panelMessageIds) cfg.panelMessageIds = {};
    cfg.panelMessageIds[panel] = messageId;
    saveModerationStore();
}

function getGuildUserReports(guildId: string): UserReportEntry[] {
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

function parseUserIdFromReportTarget(raw: string): string | null {
    const trimmed = raw.trim();
    const mentionMatch = trimmed.match(/^<@!?(\d{17,21})>$/);
    if (mentionMatch) return mentionMatch[1];
    if (/^\d{17,21}$/.test(trimmed)) return trimmed;
    return null;
}

async function submitFormalUserReport(input: {
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

async function resolveFormalUserReport(input: {
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

function parseDurationMs(raw: string): number | null {
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

async function sendModLog(
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

async function sendTicketLog(
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

function requireGuild(interaction: ChatInputCommandInteraction): string | null {
    if (!interaction.guild) return "This command can only be used in a server.";
    return null;
}

function requireAdministrator(interaction: ChatInputCommandInteraction): string | null {
    const guildError = requireGuild(interaction);
    if (guildError) return guildError;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return "Only administrators can run this command.";
    }
    return null;
}

function requireGuildOwner(interaction: ChatInputCommandInteraction): string | null {
    const guildError = requireGuild(interaction);
    if (guildError) return guildError;
    if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
        return "Only the Discord server owner can run this command.";
    }
    return null;
}

function canManageTicketActions(member: GuildMember): boolean {
    return member.permissions.has(PermissionFlagsBits.Administrator)
        || member.roles.cache.has(TICKET_HANDLER_ROLE_ID);
}

function resolveTicketTargetChannelId(interaction: ChatInputCommandInteraction): { channelId: string | null; error: string | null } {
    const selectedChannel = interaction.options.getChannel("ticket_channel");
    const typedChannelId = (interaction.options.getString("ticket_channel_id") || "").trim();

    if (typedChannelId && !/^\d{17,21}$/.test(typedChannelId)) {
        return { channelId: null, error: "ticket_channel_id must be a valid Discord channel ID." };
    }

    const channelId = typedChannelId || selectedChannel?.id || interaction.channelId || null;
    if (!channelId) {
        return { channelId: null, error: "This command must be used in a ticket channel or include ticket_channel/ticket_channel_id." };
    }

    return { channelId, error: null };
}

async function handleTicketAssignCommand(interaction: ChatInputCommandInteraction, usedAlias = false): Promise<string> {
    const guildError = requireGuild(interaction);
    if (guildError) return guildError;

    const member = interaction.member as GuildMember | null;
    if (!member || !canManageTicketActions(member)) {
        return "Only admins or the handler role can assign tickets.";
    }

    const target = resolveTicketTargetChannelId(interaction);
    if (target.error || !target.channelId) {
        return target.error || "Unable to resolve the target ticket channel.";
    }

    const ticket = await ensureTrackedTicketByChannelId(interaction.guild!, target.channelId, interaction.user.id);
    if (!ticket) {
        return "This channel is not a tracked ticket. Use ticket_channel or ticket_channel_id. If needed, run /tickets to list active tracked channels.";
    }

    const assignee = interaction.options.getUser("user", true);
    const assignDedupeError = rejectIfDuplicateCommand(interaction, `ticketassign:${target.channelId}:assignee:${assignee.id}`);
    if (assignDedupeError) return assignDedupeError;
    const assigneeMember = interaction.guild ? await interaction.guild.members.fetch(assignee.id).catch(() => null) : null;
    if (!assigneeMember) return "Unable to find that member in this server.";
    if (!canManageTicketActions(assigneeMember) && !assigneeMember.permissions.has(PermissionFlagsBits.Administrator)) {
        return "Assignee must be an admin or have the ticket handler role.";
    }

    const assigned = assignTicketToUser(target.channelId, assignee.id);
    if (!assigned) return "Unable to assign this ticket right now.";
    await updateTicketOpsPanelMessage(interaction.guild!, assigned);

    const assignChannel = interaction.guild
        ? (interaction.guild.channels.cache.get(target.channelId) || await interaction.guild.channels.fetch(target.channelId).catch(() => null))
        : null;
    if (assignChannel && assignChannel.type === ChannelType.GuildText) {
        await assignChannel.send({
            content: `<@${assignee.id}> you have been assigned to Ticket #${assigned.id}.`,
            allowedMentions: { parse: ["users"] }
        }).catch(() => undefined);
    }

    await sendTicketLog(interaction.guildId!, `Ticket #${assigned.id} Assigned`, [
        { name: "Assigned By", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Assigned To", value: `<@${assignee.id}>`, inline: true },
        { name: "Channel", value: `<#${assigned.channelId}>`, inline: true },
        { name: "Workflow Status", value: assigned.workflowStatus, inline: true }
    ]);
    appendAuditEvent("ticket_assign", {
        guildId: interaction.guildId,
        ticketId: assigned.id,
        assignedById: interaction.user.id,
        assignedToId: assignee.id,
        channelId: assigned.channelId,
        ...(usedAlias ? { usedAlias: true } : {})
    });

    return buildTicketCommandEmbedPayload(
        "🎫 Ticket Assignment Updated",
        `Ticket assignment has been updated and the assignee has been tagged in channel.`,
        assigned,
        [
            { name: "Assigned By", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Assigned To", value: `<@${assignee.id}>`, inline: true },
            { name: "Alias Used", value: usedAlias ? "Yes (`/ticketassgin`)" : "No (`/ticketassign`)", inline: true },
            { name: "Next Step", value: "Use `/ticketstatus` to move workflow to `responded`, `waiting_user`, or `escalated`." }
        ]
    );
}

function isUnknownInteractionError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const maybe = error as { code?: number | string };
    return maybe.code === 10062 || maybe.code === "10062";
}


const HELP_IDS = {
    menu: "help_dropbox",
    general: "general",
    xp: "xp",
    raids: "raids",
    shop: "shop",
    games: "games",
    bank: "bank",
    moderation: "moderation"
} as const;

const RAID_CONDITION_CHOICES = RaidDomain.RAID_CONDITIONS.map(condition => ({
    name: condition.label,
    value: condition.key
}));

const TICKET_IDS = {
    open: "ticket_open",
    claim: "ticket_claim",
    close: "ticket_close",
    resolve: "ticket_resolve",
    intakeModal: "ticket_intake_modal",
    intakeCategory: "ticket_intake_category",
    intakeSummary: "ticket_intake_summary",
    intakeDetails: "ticket_intake_details",
    intakePlatform: "ticket_intake_platform",
    intakeEvidence: "ticket_intake_evidence",
    csatPrefix: "ticket_csat"
} as const;

const REPORT_IDS = {
    open: "report_open",
    adminOpen: "report_admin_open",
    adminModal: "report_admin_modal",
    adminTarget: "report_admin_target",
    adminSummary: "report_admin_summary",
    adminDetails: "report_admin_details",
    adminEvidence: "report_admin_evidence"
} as const;

const GIVEAWAY_IDS = {
    enterPrefix: "giveaway_enter",
    raidPanelOpen: "giveaway_raid_item_open",
    raidItemModal: "giveaway_raid_item_modal",
    raidItemId: "giveaway_raid_item_id",
    raidItemQty: "giveaway_raid_item_qty",
    raidDuration: "giveaway_raid_duration",
    raidWinners: "giveaway_raid_winners",
    raidDescription: "giveaway_raid_description"
} as const;

const SELL_UI_IDS = {
    menu: "sell_item_picker",
    qtyPrefix: "sell_qty"
} as const;

const CASINO_UI_IDS = {
    prefix: "casino_ui"
} as const;

type CasinoGameKey = Exclude<GameStatKey, "raid">;
type CasinoActionKind = "replay" | "double" | "half" | "switch";

const CASINO_GAME_ORDER: CasinoGameKey[] = [
    "dice",
    "roulette",
    "blackjack",
    "crash",
    "magicslots",
    "coinflip",
    "baccarat",
    "hilo",
    "keno"
];

const XP_ROLE_SYNC_RUNNING_GUILDS = new Set<string>();

const XP_ROLE_TIERS = [
    { xp: 1000, roleId: "1526854382199771166", name: "Tier 1" },
    { xp: 2500, roleId: "1526854454455046194", name: "Tier 2" },
    { xp: 10000, roleId: "1526854514345246752", name: "Tier 3" },
    { xp: 20000, roleId: "1526854549946634360", name: "Tier 4" },
    { xp: 50000, roleId: "1526854596721508433", name: "Tier 5" },
    { xp: 100000, roleId: "1526854670260244480", name: "Tier 6" },
    { xp: 120000, roleId: "1528237537846493264", name: "Recruit I" },
    { xp: 150000, roleId: "1528237538752467155", name: "Recruit II" },
    { xp: 180000, roleId: "1528237539557769236", name: "Recruit III" },
    { xp: 210000, roleId: "1528237540039983154", name: "Scout I" },
    { xp: 240000, roleId: "1528237540589572217", name: "Scout II" },
    { xp: 270000, roleId: "1528237540828647436", name: "Scout III" },
    { xp: 300000, roleId: "1528237541873029252", name: "Vanguard I" },
    { xp: 330000, roleId: "1528237542590386386", name: "Vanguard II" },
    { xp: 360000, roleId: "1528237543873576980", name: "Vanguard III" },
    { xp: 390000, roleId: "1528237544398000199", name: "Ranger I" },
    { xp: 420000, roleId: "1528237544960036874", name: "Ranger II" },
    { xp: 450000, roleId: "1528237545597702205", name: "Ranger III" },
    { xp: 480000, roleId: "1528237546142699530", name: "Striker I" },
    { xp: 510000, roleId: "1528237546838954087", name: "Striker II" },
    { xp: 540000, roleId: "1528237547849777232", name: "Striker III" },
    { xp: 570000, roleId: "1528237548697030747", name: "Sentinel I" },
    { xp: 600000, roleId: "1528237549795938557", name: "Sentinel II" },
    { xp: 630000, roleId: "1528237551217803264", name: "Sentinel III" },
    { xp: 660000, roleId: "1528237551389769779", name: "Warden I" },
    { xp: 690000, roleId: "1528237552073576521", name: "Warden II" },
    { xp: 720000, roleId: "1528237553453498368", name: "Warden III" },
    { xp: 750000, roleId: "1528237554090905861", name: "Elite I" },
    { xp: 780000, roleId: "1528237554795810967", name: "Elite II" },
    { xp: 810000, roleId: "1528237555428884591", name: "Elite III" },
    { xp: 840000, roleId: "1528237556406161521", name: "Titan Commander" }
] as const;

type XpRoleEntry = { xp: number; roleId: string; name: string };

function readXpRoleEntries(): XpRoleEntry[] {
    if (!fs.existsSync(XP_ROLE_DATA_FILE)) {
        return [];
    }

    try {
        const raw = fs.readJsonSync(XP_ROLE_DATA_FILE) as { entries?: XpRoleEntry[] };
        if (!raw || !Array.isArray(raw.entries)) return [];
        return raw.entries.filter(entry => typeof entry?.xp === "number" && typeof entry?.roleId === "string" && typeof entry?.name === "string");
    } catch {
        return [];
    }
}

function saveXpRoleEntries(entries: XpRoleEntry[]): void {
    fs.ensureDirSync(path.dirname(XP_ROLE_DATA_FILE));
    fs.writeJsonSync(XP_ROLE_DATA_FILE, { entries }, { spaces: 2 });
}

function getPersistedXpRoleMap(): Map<number, XpRoleEntry> {
    const map = new Map<number, XpRoleEntry>();
    for (const entry of readXpRoleEntries()) {
        map.set(entry.xp, entry);
    }
    return map;
}

function getEffectiveXpRoleEntries(): XpRoleEntry[] {
    const persisted = readXpRoleEntries()
        .filter(entry => Number.isFinite(entry.xp) && entry.xp > 0 && Boolean(entry.roleId))
        .sort((a, b) => a.xp - b.xp);
    if (persisted.length) {
        return persisted;
    }

    return XP_ROLE_TIERS
        .map(entry => ({ xp: entry.xp, roleId: entry.roleId, name: entry.name }))
        .sort((a, b) => a.xp - b.xp);
}

async function getEffectiveXpRoleEntriesForGuild(guild: Guild): Promise<XpRoleEntry[]> {
    const persisted = readXpRoleEntries()
        .filter(entry => Number.isFinite(entry.xp) && entry.xp > 0 && Boolean(entry.roleId) && Boolean(entry.name));

    if (persisted.length) {
        return persisted.sort((a, b) => a.xp - b.xp);
    }

    return XP_ROLE_TIERS
        .map(entry => ({ xp: entry.xp, roleId: entry.roleId, name: entry.name }))
        .sort((a, b) => a.xp - b.xp);
}

async function syncMemberXpRoles(member: GuildMember, xp: number, roleEntriesOverride?: XpRoleEntry[]): Promise<void> {
    const roleEntries = roleEntriesOverride ?? await getEffectiveXpRoleEntriesForGuild(member.guild);
    if (!roleEntries.length) return;

    const me = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return;

    // Ensure role/member caches are current before applying threshold logic.
    await member.guild.roles.fetch().catch(() => undefined);
    const refreshedMember = await member.guild.members.fetch(member.id).catch(() => member);
    const botHighest = me.roles.highest?.position ?? 0;

    const existingEntries = roleEntries
        .map(entry => ({ entry, role: refreshedMember.guild.roles.cache.get(entry.roleId) || null }))
        .filter((pair): pair is { entry: XpRoleEntry; role: NonNullable<typeof pair.role> } => Boolean(pair.role));
    if (!existingEntries.length) return;

    const unlockedPair = existingEntries.filter(pair => xp >= pair.entry.xp).pop();
    const unlockedRoleId = unlockedPair?.entry.roleId;

    // Only manage roles below the bot's highest role.
    const manageableTierRoleIds = existingEntries
        .filter(pair => pair.role.position < botHighest)
        .map(pair => pair.entry.roleId);

    if (unlockedPair && unlockedPair.role.position >= botHighest) {
        appendAuditEvent("xp_role_sync_blocked", {
            guildId: refreshedMember.guild.id,
            memberId: refreshedMember.id,
            roleId: unlockedPair.entry.roleId,
            reason: "target role is above or equal to bot highest role"
        });
        return;
    }

    if (unlockedRoleId && !refreshedMember.roles.cache.has(unlockedRoleId)) {
        await refreshedMember.roles.add(unlockedRoleId).catch(() => undefined);
    }

    const removeRoleIds = manageableTierRoleIds.filter(roleId => roleId !== unlockedRoleId && refreshedMember.roles.cache.has(roleId));
    if (removeRoleIds.length) {
        await refreshedMember.roles.remove(removeRoleIds).catch(() => undefined);
    }
}

async function runGuildXpRoleSyncJob(guild: Guild, sourceChannelId: string | null, startedByUserId: string): Promise<{ processed: number; synced: number; skipped: number }> {
    appendAuditEvent("xp_role_sync_started", {
        guildId: guild.id,
        userId: startedByUserId,
        sourceChannelId
    });

    await guild.members.fetch().catch(() => undefined);
    const members = guild.members.cache.filter(member => !member.user.bot);

    let synced = 0;
    let skipped = 0;
    let processed = 0;
    const roleEntries = await getEffectiveXpRoleEntriesForGuild(guild);

    for (const [, member] of members) {
        const before = roleEntries
            .filter(entry => member.roles.cache.has(entry.roleId))
            .map(entry => entry.roleId)
            .sort()
            .join(",");

        const user = ensureUser(member.id);
        await syncMemberXpRoles(member, user.xp, roleEntries);

        const refreshed = member.guild.members.cache.get(member.id) ?? member;
        const after = roleEntries
            .filter(entry => refreshed.roles.cache.has(entry.roleId))
            .map(entry => entry.roleId)
            .sort()
            .join(",");

        if (before !== after) {
            synced += 1;
        } else {
            skipped += 1;
        }

        processed += 1;
    }

    const completion = `XP role sync complete. Started by <@${startedByUserId}>. Processed ${processed} member(s): ${synced} updated, ${skipped} unchanged.`;
    if (sourceChannelId) {
        const channel = await guild.channels.fetch(sourceChannelId).catch(() => null);
        if (channel && channel.isTextBased() && "send" in channel) {
            await channel.send({ content: completion, allowedMentions: { users: [startedByUserId], parse: [] } }).catch(() => undefined);
        }
    }

    appendAuditEvent("xp_role_sync_completed", {
        guildId: guild.id,
        userId: startedByUserId,
        processed,
        synced,
        skipped
    });

    return { processed, synced, skipped };
}

async function syncXpRolesForUserInGuild(guild: Guild, userId: string, xp: number): Promise<void> {
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    await syncMemberXpRoles(member, xp);
    // Retry once with a forced fetch to avoid cache/race misses at threshold crossings.
    const refreshed = await guild.members.fetch(userId).catch(() => null);
    if (refreshed) {
        await syncMemberXpRoles(refreshed, xp);
    }
}

function getPrimaryGuild(): Guild | null {
    return DISCORD_GUILD_ID
        ? client.guilds.cache.get(DISCORD_GUILD_ID) || null
        : client.guilds.cache.first() || null;
}

function buildHealthEmbed(): EmbedBuilder {
    const heap = process.memoryUsage();
    const usersTracked = Object.keys(points).length;
    const commandTotal = runtimeMetrics.command.total;
    const commandFailed = runtimeMetrics.command.failed;
    const commandErrorRate = commandTotal > 0 ? ((commandFailed / commandTotal) * 100).toFixed(2) : "0.00";
    const ticketAttempts = runtimeMetrics.tickets.createAttempts;
    const ticketFailures = runtimeMetrics.tickets.createFailures;
    const ticketFailureRate = ticketAttempts > 0 ? ((ticketFailures / ticketAttempts) * 100).toFixed(2) : "0.00";
    const availability = runtimeMetrics.availability;
    const downtimeIntervals = Math.max(0, availability.totalRestarts - 1);
    const avgDowntimeMs = downtimeIntervals > 0
        ? Math.floor(availability.trackedDowntimeMs / downtimeIntervals)
        : 0;

    return brandLiveEmbed(new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("🩺 Bot Health")
        .setDescription("Operational diagnostics for runtime, persistence, and sync state.")
        .addFields(
            {
                name: "Runtime",
                value: [
                    `Uptime: ${formatDuration(process.uptime())}`,
                    `Guilds: ${client.guilds.cache.size}`,
                    `Heap: ${(heap.heapUsed / (1024 * 1024)).toFixed(1)}MB / ${(heap.heapTotal / (1024 * 1024)).toFixed(1)}MB`,
                    `RSS: ${(heap.rss / (1024 * 1024)).toFixed(1)}MB`
                ].join("\n"),
                inline: false
            },
            {
                name: "Persistence",
                value: [
                    `Tracked users: ${usersTracked}`,
                    `points.json: ${statLabel(POINTS_DATA_FILE)}`,
                    `points.json.bak: ${statLabel(POINTS_BACKUP_FILE)}`,
                    `events.jsonl: ${statLabel(EVENT_LOG_FILE)}`
                ].join("\n"),
                inline: false
            },
            {
                name: "Ops",
                value: [
                    `Active XP sync jobs: ${XP_ROLE_SYNC_RUNNING_GUILDS.size}`,
                    `tickets.json: ${statLabel(TICKET_DATA_FILE)}`,
                    `trades.json: ${statLabel(TRADE_DATA_FILE)}`,
                    `moderation.json: ${statLabel(MOD_DATA_FILE)}`,
                    `balance-telemetry.json: ${statLabel(BALANCE_TELEMETRY_FILE)}`,
                    `runtime-metrics.json: ${statLabel(METRICS_DATA_FILE)}`
                ].join("\n"),
                inline: false
            },
            {
                name: "SLO Metrics",
                value: [
                    `Command error rate: ${commandFailed}/${commandTotal} (${commandErrorRate}%)`,
                    `Ticket create failures: ${ticketFailures}/${ticketAttempts} (${ticketFailureRate}%)`,
                    `Restarts tracked: ${availability.totalRestarts}`,
                    `Last downtime: ${formatMetricDuration(availability.lastDowntimeMs)}`,
                    `Average downtime: ${formatMetricDuration(avgDowntimeMs)}`,
                    `Total downtime tracked: ${formatMetricDuration(availability.trackedDowntimeMs)}`
                ].join("\n"),
                inline: false
            }
        )
        .setTimestamp(new Date()), "Titan Runtime Health Monitor", "Automated diagnostics");
}

async function collectRoleSanityReport(guild: Guild): Promise<RoleSanityReport> {
    await guild.roles.fetch().catch(() => undefined);
    await guild.members.fetch().catch(() => undefined);

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    const botHighest = me?.roles.highest?.position ?? 0;
    const canManageRoles = Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles));

    const existingTierRoles = XP_ROLE_TIERS
        .map(tier => ({ tier, role: guild.roles.cache.get(tier.roleId) || null }))
        .filter(item => Boolean(item.role));

    const missing = XP_ROLE_TIERS.filter(tier => !guild.roles.cache.has(tier.roleId));
    const hierarchyBlocked = existingTierRoles
        .filter(item => (item.role?.position || 0) >= botHighest)
        .map(item => ({ tier: item.tier, rolePosition: item.role?.position || 0 }));

    let multiTierMembers = 0;
    for (const [, member] of guild.members.cache) {
        if (member.user.bot) continue;
        const count = XP_ROLE_TIERS.filter(tier => member.roles.cache.has(tier.roleId)).length;
        if (count > 1) multiTierMembers += 1;
    }

    return {
        configuredTierCount: XP_ROLE_TIERS.length,
        existingTierCount: existingTierRoles.length,
        missing,
        hierarchyBlocked,
        multiTierMembers,
        canManageRoles,
        botHighestRolePosition: botHighest
    };
}

async function runRoleSanityFix(guild: Guild, startedByUserId: string, sourceChannelId: string | null): Promise<{ started: boolean; reason?: string }> {
    if (XP_ROLE_SYNC_RUNNING_GUILDS.has(guild.id)) {
        return { started: false, reason: "XP role sync already running." };
    }

    XP_ROLE_SYNC_RUNNING_GUILDS.add(guild.id);
    void runGuildXpRoleSyncJob(guild, sourceChannelId, startedByUserId)
        .catch(error => {
            appendAuditEvent("rolesanity_fix_failed", {
                guildId: guild.id,
                userId: startedByUserId,
                error: error instanceof Error ? error.message : String(error)
            });
        })
        .finally(() => {
            XP_ROLE_SYNC_RUNNING_GUILDS.delete(guild.id);
        });

    appendAuditEvent("rolesanity_fix_started", {
        guildId: guild.id,
        userId: startedByUserId,
        sourceChannelId
    });

    return { started: true };
}

async function collectTicketSanityReport(guild: Guild): Promise<TicketSanityReport> {
    const guildTickets = ticketStore.tickets.filter(ticket => ticket.guildId === guild.id);
    const open = guildTickets.filter(ticket => normalizeTicketStatus(ticket.status) === "open").length;
    const claimed = guildTickets.filter(ticket => normalizeTicketStatus(ticket.status) === "claimed").length;
    const archived = guildTickets.filter(ticket => normalizeTicketStatus(ticket.status) === "archived").length;
    const resolved = guildTickets.filter(ticket => normalizeTicketStatus(ticket.status) === "resolved").length;

    const ownerOpenCounts = new Map<string, number>();
    for (const ticket of guildTickets) {
        if (ticket.status !== "open" && ticket.status !== "claimed") continue;
        ownerOpenCounts.set(ticket.ownerId, (ownerOpenCounts.get(ticket.ownerId) || 0) + 1);
    }
    const duplicateOpenOwners = [...ownerOpenCounts.values()].filter(count => count > 1).length;

    let missingChannels = 0;
    for (const ticket of guildTickets) {
        const exists = guild.channels.cache.get(ticket.channelId)
            || await guild.channels.fetch(ticket.channelId).catch(() => null);
        if (!exists) missingChannels += 1;
    }

    const panelMissing = guildTickets.filter(ticket =>
        (ticket.status === "open" || ticket.status === "claimed") && !ticket.panelMessageId
    ).length;

    const slaBreaches = guildTickets
        .filter(ticket => ticket.status !== "resolved")
        .map(ticket => ({ ticket, sla: getTicketSlaState(ticket) }))
        .filter(entry => entry.sla.firstResponseOverdue || entry.sla.resolveOverdue)
        .length;

    return {
        total: guildTickets.length,
        open,
        claimed,
        archived,
        resolved,
        missingChannels,
        duplicateOpenOwners,
        panelMissing,
        slaBreaches
    };
}

function dedupeActiveTicketsByOwner(guildId: string): number {
    const active = ticketStore.tickets
        .filter(ticket => ticket.guildId === guildId && (ticket.status === "open" || ticket.status === "claimed"))
        .sort((a, b) => b.createdAt - a.createdAt);

    const keepOwners = new Set<string>();
    let removed = 0;

    for (const ticket of active) {
        if (!keepOwners.has(ticket.ownerId)) {
            keepOwners.add(ticket.ownerId);
            continue;
        }

        const idx = ticketStore.tickets.findIndex(t => t.id === ticket.id);
        if (idx >= 0) {
            ticketStore.tickets.splice(idx, 1);
            removed += 1;
        }
    }

    if (removed > 0) {
        saveTicketStore();
    }

    return removed;
}

async function runTicketSanityFix(guild: Guild): Promise<{ removedDeleted: number; removedInaccessible: number; deduped: number; panelBackfilled: number }> {
    const removedDeleted = await pruneDeletedTicketRecords(guild);
    const removedInaccessible = await pruneInaccessibleOwnerTicketRecords(guild);
    const deduped = dedupeActiveTicketsByOwner(guild.id);

    let panelBackfilled = 0;
    const activeTickets = ticketStore.tickets.filter(t => t.guildId === guild.id && (t.status === "open" || t.status === "claimed") && !t.panelMessageId);
    for (const ticket of activeTickets) {
        await updateTicketOpsPanelMessage(guild, ticket);
        const refreshed = findTicketByChannel(ticket.channelId);
        if (refreshed?.panelMessageId) panelBackfilled += 1;
    }

    appendAuditEvent("ticketsanity_fix_applied", {
        guildId: guild.id,
        removedDeleted,
        removedInaccessible,
        deduped,
        panelBackfilled
    });

    return { removedDeleted, removedInaccessible, deduped, panelBackfilled };
}

async function sendAutomatedHealthReport(reason: string): Promise<void> {
    const guild = getPrimaryGuild();
    if (!guild) return;

    const channelId = HEALTH_REPORT_CHANNEL_ID || ensureGuildModeration(guild.id).modLogChannelId || "";
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;

    const embed = buildHealthEmbed().setTitle("📊 Automated Health Report").setFooter({ text: `Reason: ${reason}` });
    await channel.send({ embeds: [embed] }).catch(() => undefined);
    appendAuditEvent("health_report_sent", { guildId: guild.id, channelId, reason });
}

function buildBalanceReportEmbed(reason = "manual"): EmbedBuilder {
    const raid = balanceTelemetry.raid;
    const winRate = raid.runs > 0 ? ((raid.wins / raid.runs) * 100).toFixed(1) : "0.0";
    const avgNet = raid.runs > 0 ? (raid.totalNet / raid.runs).toFixed(1) : "0.0";
    const avgBet = raid.runs > 0 ? (raid.totalBet / raid.runs).toFixed(1) : "0.0";
    const avgReward = raid.runs > 0
        ? ((raid.tokenSources.baseReward + raid.tokenSources.outcomeBonus + raid.tokenSources.bossBonus + raid.tokenSources.failureMitigation) / raid.runs).toFixed(1)
        : "0.0";
    const bossKillRate = raid.bossSpawns > 0 ? ((raid.bossKills / raid.bossSpawns) * 100).toFixed(1) : "0.0";

    const formatSlice = (label: string, data: BalanceSlice) => {
        const wr = data.runs > 0 ? ((data.wins / data.runs) * 100).toFixed(1) : "0.0";
        const net = data.runs > 0 ? (data.net / data.runs).toFixed(1) : "0.0";
        const chance = data.runs > 0 ? (data.successChanceSum / data.runs).toFixed(1) : "0.0";
        const lootValue = data.runs > 0 ? (data.lootValue / data.runs).toFixed(1) : "0.0";
        const bossRate = data.bossSpawns > 0 ? ((data.bossKills / data.bossSpawns) * 100).toFixed(1) : "0.0";
        return `${label}: ${data.runs} runs | WR ${wr}% | Avg Net ${net} | Avg Success ${chance}% | Loot Value ${lootValue} | Boss KR ${bossRate}%`;
    };

    const topTensions = Object.entries(raid.byTension)
        .sort((a, b) => b[1].runs - a[1].runs)
        .slice(0, 3)
        .map(([name, data]) => formatSlice(name, data))
        .join("\n") || "No raid telemetry yet.";

    const topMaps = Object.entries(raid.byMap)
        .sort((a, b) => b[1].runs - a[1].runs)
        .slice(0, 3)
        .map(([name, data]) => formatSlice(name, data))
        .join("\n") || "No map telemetry yet.";

    const topDifficulties = Object.entries(raid.byDifficulty)
        .sort((a, b) => b[1].runs - a[1].runs)
        .slice(0, 3)
        .map(([name, data]) => formatSlice(name, data))
        .join("\n") || "No difficulty telemetry yet.";

    const topConditions = Object.entries(raid.byCondition)
        .sort((a, b) => b[1].runs - a[1].runs)
        .slice(0, 3)
        .map(([name, data]) => formatSlice(name, data))
        .join("\n") || "No condition telemetry yet.";

    const tokenSources = [
        `Base Raid Payout: ${raid.tokenSources.baseReward}`,
        `Outcome Bonus: ${raid.tokenSources.outcomeBonus}`,
        `Boss Bonus: ${raid.tokenSources.bossBonus}`,
        `Failure Mitigation: ${raid.tokenSources.failureMitigation}`
    ].join("\n");

    const lootByRarity = Object.entries(raid.lootByRarity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([rarity, qty]) => `${rarity}: ${qty}`)
        .join(" | ") || "No loot rarity telemetry yet.";

    const consumables = Object.entries(balanceTelemetry.consumables)
        .sort((a, b) => b[1].uses - a[1].uses)
        .slice(0, 4)
        .map(([id, data]) => `${ITEM_DEFS[id]?.name || id}: uses ${data.uses}, qty ${data.qty}, fail ${data.failures}`)
        .join("\n") || "No consumable usage yet.";

    const crates = Object.entries(balanceTelemetry.crates)
        .sort((a, b) => b[1].opened - a[1].opened)
        .slice(0, 4)
        .map(([id, data]) => `${ITEM_DEFS[id]?.name || id}: opened ${data.opened}, auto ${data.autoOpened}, drops ${data.totalDrops}`)
        .join("\n") || "No crate telemetry yet.";

    const commandUsage = Object.entries(balanceTelemetry.commands)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count]) => `${name}: ${count}`)
        .join(" | ") || "No tracked command usage yet.";

    return brandLiveEmbed(new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("📈 Balance Telemetry")
        .setDescription("Weekly raid-economy signal pack for tuning drop rates, payouts, and consumable impact.")
        .addFields(
            {
                name: "Raid Core",
                value: [
                    `Runs: ${raid.runs} | Win Rate: ${winRate}%`,
                    `Avg Bet: ${avgBet} | Avg Net: ${avgNet} | Avg Reward: ${avgReward}`,
                    `Boss Spawns: ${raid.bossSpawns} | Boss Kills: ${raid.bossKills} | Boss Kill Rate: ${bossKillRate}%`
                ].join("\n"),
                inline: false
            },
            { name: "Top Tensions", value: topTensions, inline: false },
            { name: "Top Maps", value: topMaps, inline: false },
            { name: "Top Difficulties", value: topDifficulties, inline: false },
            { name: "Top Conditions", value: topConditions, inline: false },
            { name: "Token Sources", value: tokenSources, inline: false },
            { name: "Loot Rarity Mix", value: lootByRarity, inline: false },
            { name: "Consumables", value: consumables, inline: false },
            { name: "Crates", value: crates, inline: false },
            { name: "Raid Command Usage", value: commandUsage, inline: false }
        )
        .setFooter({ text: `Reason: ${reason} | Updated: ${new Date(balanceTelemetry.updatedAt).toISOString()}` })
        .setTimestamp(new Date()), "Titan Economy Observatory", "Balance telemetry stream");
}

function getOpsBroadcastChannelId(guildId: string): string {
    return ACTIVITY_CHANNEL_ID || HEALTH_REPORT_CHANNEL_ID || ensureGuildModeration(guildId).modLogChannelId || "";
}

async function sendOpsBroadcastEmbed(guild: Guild, embed: EmbedBuilder): Promise<void> {
    const channelId = getOpsBroadcastChannelId(guild.id);
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;
    await channel.send({ embeds: [embed] }).catch(() => undefined);
}

function buildRaidUnlockBroadcastEmbed(input: {
    user: User;
    result: {
        mapLabel?: string;
        bossName?: string;
        bossTitle?: string;
        bossImageUrl?: string;
        bossHeartUnlockedName?: string;
        pmcTierUnlockedLabel?: string;
        pmcTierUnlockedBadge?: string;
        pmcLevel?: number;
        loot?: Array<{ id: string; qty: number }>;
    };
}): EmbedBuilder | null {
    const { user, result } = input;
    const loot = result.loot || [];
    const enhancedLoot = loot
        .filter(entry => entry.id.startsWith("enhanced_") && ITEM_DEFS[entry.id])
        .map(entry => ITEM_DEFS[entry.id].name);
    const mythicLoot = loot
        .filter(entry => ITEM_DEFS[entry.id]?.rarity === "mythic")
        .map(entry => ITEM_DEFS[entry.id].name);

    const lines = [
        result.bossHeartUnlockedName ? `• First-kill heart unlocked: ${result.bossHeartUnlockedName}` : null,
        result.pmcTierUnlockedLabel ? `• ${result.pmcTierUnlockedBadge || "🏅"} Reached ${result.pmcTierUnlockedLabel} at PMC Level ${result.pmcLevel || "?"}` : null,
        enhancedLoot.length ? `• Enhanced recoveries: ${enhancedLoot.join(", ")}` : null,
        mythicLoot.length ? `• Mythic recoveries: ${mythicLoot.join(", ")}` : null
    ].filter(Boolean) as string[];

    if (!lines.length) return null;

    return brandLiveEmbed(new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🌟 Premium Unlock Broadcast")
        .setDescription(`${user.username} completed a standout raid operation on **${result.mapLabel || "Unknown AO"}**.`)
        .setThumbnail(result.bossImageUrl || ARMY_ICON_URL)
        .addFields(
            {
                name: "Operator",
                value: `<@${user.id}>`,
                inline: true
            },
            {
                name: "Boss Contact",
                value: result.bossName
                    ? `${result.bossName}${result.bossTitle ? ` • ${result.bossTitle}` : ""}`
                    : "No boss engaged",
                inline: true
            },
            {
                name: "Highlights",
                value: lines.join("\n"),
                inline: false
            }
        ), "Titan Premium Progression Feed", "Rare progression event");
}

async function sendAutomatedBalanceReport(reason: string): Promise<void> {
    const guild = getPrimaryGuild();
    if (!guild) return;

    const channelId = HEALTH_REPORT_CHANNEL_ID || ensureGuildModeration(guild.id).modLogChannelId || "";
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;

    const embed = buildBalanceReportEmbed(reason);
    await channel.send({ embeds: [embed] }).catch(() => undefined);
    balanceTelemetry.lastWeeklyReportAt = Date.now();
    saveBalanceTelemetry();
    appendAuditEvent("balance_report_sent", { guildId: guild.id, channelId, reason });
}

async function runHealthWatchdog(reason: string): Promise<void> {
    const now = Date.now();

    const pointsPrimary = statSummary(POINTS_DATA_FILE);
    const pointsBackup = statSummary(POINTS_BACKUP_FILE);
    const ticketsPrimary = statSummary(TICKET_DATA_FILE);
    const tradePrimary = statSummary(TRADE_DATA_FILE);
    const telemetryPrimary = statSummary(BALANCE_TELEMETRY_FILE);

    const warnings: string[] = [];
    const errors: string[] = [];

    if (!pointsPrimary.exists) errors.push("points.json missing");
    if (!pointsBackup.exists) errors.push("points.json.bak missing");
    if (pointsPrimary.exists && pointsPrimary.size <= 0) errors.push("points.json empty");
    if (pointsBackup.exists && pointsBackup.size <= 0) errors.push("points.json.bak empty");

    if (pointsBackup.exists && now - pointsBackup.mtime > BACKUP_STALE_WARNING_MS) {
        warnings.push("points backup appears stale");
    }

    if (!ticketsPrimary.exists) warnings.push("tickets.json missing");
    if (!tradePrimary.exists) warnings.push("trades.json missing");
    if (!telemetryPrimary.exists) warnings.push("balance-telemetry.json missing");

    if (errors.length) {
        postOpsAlert("error", "Health watchdog critical state", {
            reason,
            errors: errors.join(" | "),
            warnings: warnings.join(" | ") || "none"
        });
    } else if (warnings.length) {
        postOpsAlert("warn", "Health watchdog warning state", {
            reason,
            warnings: warnings.join(" | ")
        });
    }

    appendAuditEvent("health_watchdog", {
        reason,
        status: errors.length ? "error" : warnings.length ? "warn" : "ok",
        errors,
        warnings,
        pointsPrimaryExists: pointsPrimary.exists,
        pointsBackupExists: pointsBackup.exists,
        pointsPrimarySize: pointsPrimary.size,
        pointsBackupSize: pointsBackup.size,
        pointsBackupAgeSec: pointsBackup.exists ? Math.floor((now - pointsBackup.mtime) / 1000) : -1
    });

    const guild = getPrimaryGuild();
    if (guild) {
        await runTicketSlaWatchdog(guild, reason);
        purgeResolvedTicketsByRetention(guild.id, now);
    }
}

async function runTicketSlaWatchdog(guild: Guild, reason: string): Promise<void> {
    const now = Date.now();
    const activeTickets = ticketStore.tickets.filter(t =>
        t.guildId === guild.id &&
        (normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed" || normalizeTicketStatus(t.status) === "archived")
    );

    for (const ticket of activeTickets) {
        const status = normalizeTicketStatus(ticket.status);

        // SLA alerts are disabled. Instead, auto-close stale unclaimed tickets.
        if (status === "open" && !ticket.claimedById && now - ticket.createdAt >= UNCLAIMED_TICKET_AUTO_CLOSE_MS) {
            const closedById = guild.members.me?.id || guild.ownerId;
            await closeTicketChannel(guild, ticket.channelId, closedById, "Auto-closed: ticket was not claimed within 30 minutes.");
            appendAuditEvent("ticket_auto_close_unclaimed", {
                guildId: guild.id,
                ticketId: ticket.id,
                channelId: ticket.channelId,
                ownerId: ticket.ownerId,
                ageMinutes: Math.floor((now - ticket.createdAt) / 60000),
                thresholdMinutes: Math.floor(UNCLAIMED_TICKET_AUTO_CLOSE_MS / 60000),
                reason
            });
        }
    }
}

async function resolveXpRoleLines(guild?: Guild | null): Promise<string[]> {
    if (!guild) {
        return XP_ROLE_TIERS.map(entry => `${entry.xp.toLocaleString()} XP -> ${entry.name}`);
    }

    await guild.roles.fetch().catch(() => undefined);
    const persisted = getPersistedXpRoleMap();
    const lines: string[] = [];

    for (const entry of XP_ROLE_TIERS) {
        const persistedEntry = persisted.get(entry.xp);
        const roleById = persistedEntry
            ? await guild.roles.fetch(persistedEntry.roleId).catch(() => null)
            : await guild.roles.fetch(entry.roleId).catch(() => null);
        const roleName = `${entry.name} [${entry.xp} XP]`;
        const roleByName = guild.roles.cache.find(r => r.name === roleName) || null;
        const role = roleById || roleByName;
        if (role) {
            lines.push(`${entry.xp.toLocaleString()} XP -> <@&${role.id}>`);
        } else {
            lines.push(`${entry.xp.toLocaleString()} XP -> ${entry.name} (not created yet)`);
        }
    }

    return lines;
}

function chunkRoleLines(lines: string[], maxLen = 1000): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > maxLen && current) {
            chunks.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function buildThemedRoleSections(lines: string[]): Array<{ name: string; value: string }> {
    const sectionNames = [
        "Comms Cadet (Levels 1-5)",
        "Pathfinder Wing (Levels 6-10)",
        "Strike Division (Levels 11-15)",
        "Warden Command (Levels 16-20)",
        "Elite Vanguard (Levels 21-25)"
    ];

    const sections: Array<{ name: string; value: string }> = [];
    for (let i = 0; i < sectionNames.length; i++) {
        const start = i * 5;
        const group = lines.slice(start, start + 5);
        if (!group.length) continue;
        sections.push({ name: sectionNames[i], value: group.join("\n") });
    }
    return sections;
}

function helpDropdown(selected: keyof typeof HELP_IDS = "general") {
    return [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(HELP_IDS.menu)
                .setPlaceholder("Select a tactical drop box")
                .addOptions(
                    { label: "Mission Brief", value: HELP_IDS.general, description: "Main command overview", emoji: "🪖", default: selected === "general" },
                    { label: "XP Ops", value: HELP_IDS.xp, description: "XP, levels, and progression", emoji: "🎖️", default: selected === "xp" },
                    { label: "Raid Ops", value: HELP_IDS.raids, description: "Raids and risk settings", emoji: "⚔️", default: selected === "raids" },
                    { label: "Supply Crates", value: HELP_IDS.shop, description: "Shop, items, and inventory", emoji: "📦", default: selected === "shop" },
                    { label: "Training Grounds", value: HELP_IDS.games, description: "Games and betting", emoji: "🎯", default: selected === "games" },
                    { label: "Bank and Trade", value: HELP_IDS.bank, description: "Token banking and item exchange", emoji: "🏦", default: selected === "bank" },
                    { label: "Moderation Desk", value: HELP_IDS.moderation, description: "Moderation and admin safeguards", emoji: "🛡️", default: selected === "moderation" }
                )
        )
    ];
}

function helpPageGeneral() {
    return new EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🪖 Titan Tactical Help")
        .setDescription("Use the tactical drop box below to jump into command categories, quick workflows, and support tools.")
        .addFields(
            {
                name: "🧭 Core Utility",
                value: "• `/help` — open command directory\n\n• `/quickstart` — guided first-run mission flow\n\n• `/ping` — bot latency check\n\n• `/status` — runtime identity\n\n• `/findbots` — list bot accounts in this server\n\n• `/balance` — your wallet tokens\n\n• `/token` — token balance for selected user\n\n• `/ticket` — open support ticket"
            },
            {
                name: "📈 Progress and Economy",
                value: "• `/xp` — engagement XP panel\n\n• `/xpstats` — detailed progression stats\n\n• `/xproles` — themed rank role directory\n\n• `/xprolesync` — admin force-sync all XP roles\n\n• `/pmc` — persistent raid profile\n\n• `/leaderboard` — top XP players\n\n• `/daily` — streak reward claim"
            },
            {
                name: "🗂️ Directory Topics",
                value: "⚔️ Raid Ops\n📦 Supply Crates\n🎯 Training Grounds\n🏦 Bank and Trade\n🛡️ Moderation Desk"
            }
        )
        .setFooter({ text: "Tip: use /ticket for direct FN support and /quickstart for the fastest onboarding route." });
}

function buildQuickstartEmbed(user: User): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("🚀 Quickstart Mission")
        .setDescription("Fast launch path for new or returning operators. Follow these in order for the smoothest start.")
        .addFields(
            {
                name: "1️⃣ Setup Economy",
                value: "Run `/balance` then `/daily` to initialize and claim your streak reward.",
                inline: false
            },
            {
                name: "2️⃣ Gear Up",
                value: "Use `/shop` to browse items, `/buy` to purchase gear, and `/inventory` to confirm your loadout.",
                inline: false
            },
            {
                name: "3️⃣ Raid Preparation",
                value: "Run `/loadout` to preview auto-applied gear bonuses, then `/raidintel` for map and trigger projections.",
                inline: false
            },
            {
                name: "4️⃣ Run Missions",
                value: "Start with `/raid bet:10 tension:low`, then scale risk to `medium`/`high` as your inventory and PMC level improve.",
                inline: false
            },
            {
                name: "5️⃣ Loop Rewards",
                value: "Open crates with `/opencrate`, consume support items with `/useitem`, and track consistency via `/raidhistory` + `/pmc`.",
                inline: false
            }
        )
        .setFooter({ text: `Requested by ${user.tag} • Stay consistent and scale risk gradually.` })
        .setTimestamp(new Date());
}

async function helpPageXP(guild?: Guild | null) {
    const rankLines = await resolveXpRoleLines(guild);
    const rankChunks = chunkRoleLines(rankLines, 900);
    const embed = new EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🎖️ XP Operations")
        .setDescription("Chat XP is earned by eligible messages and drives rank progression.")
        .addFields(
            {
                name: "Command Summary",
                value: "• `/xp` — compact level and progress bar\n\n• `/xpstats` — detailed engagement + PMC progression\n\n• `/xproles` — view 5 themed role sections\n\n• `/xprolesync` — admin force-sync rank roles now\n\n• `/leaderboard` — server-wide engagement XP ranking\n\n• `/daily` — claim streak bonus"
            },
            {
                name: "🪖 Progression Rules",
                value: "• Engagement XP gives +1 for communication actions\n  (chat messages, replies, mentions, attachments).\n\n• Raid XP is tracked separately in your PMC profile."
            }
        );

    if (!rankChunks.length) {
        embed.addFields({ name: "🎖️ Rank Unlock Directory", value: "No rank directory entries available." });
        return embed;
    }

    embed.addFields({ name: "🎖️ Rank Unlock Directory", value: rankChunks[0] });
    for (let i = 1; i < rankChunks.length; i++) {
        embed.addFields({ name: `🎖️ Rank Unlock Directory (${i + 1})`, value: rankChunks[i] });
    }

    return embed;
}

function helpPageRaids() {
    return new EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("⚔️ Raid Operations")
        .setDescription("Raids award persistent PMC Raid XP, tokens, and map-based loot with condition triggers plus boss encounters.")
        .addFields(
            { name: "📦 Risk Drop Box", value: "• **Low** — safer extract profile\n\n• **Medium** — balanced risk/reward\n\n• **High** — volatile, higher payout potential" },
            {
                name: "🗺️ Raid Maps",
                value: "• **FN Plagued Cemetery**\n  Beginner map, higher extraction odds, low-mid loot.\n\n• **FN Slaughterhouse**\n  Mid map, harder extracts, better loot spread, 10% boss spawn.\n\n• **FN BoogersWoodZ**\n  Hard map, premium loot tables, harder boss pressure.\n\n• **FN MegaYachtolopolis**\n  Elite map with luxury-tech loot, claustrophobic kill lanes, and vicious apex pressure.\n\n• **FN Warlords Warcamp**\n  Brutal trench map with war salvage jackpots and relentless open-field punishment.\n\n• **FN SUNKEN VILLAGE**\n  Cataclysmic flooded map loaded with varied crate drops and drowned-boss ambushes."
            },
            {
                name: "🪖 Mission Commands",
                value: `• \`/raid bet:<amount> tension:<low|medium|high> map:<map_name> weapon:<optional> armor:<optional>\`\n\n• \`/raidhistory\` — recent results (map + boss outcomes)\n\n• \`/bosses\` — full boss roster, stats, and rotation weights\n\n• \`/conditions\` — every raid condition, deltas, and armor counters\n\n• \`/gearintel\` — raid gear stat and trait directory\n\n• \`/pmc\` — milestone PMC progression (up to Level ${PMC_LEVEL_CAP})\n\n• \`/loadout\` — best auto-applied weapon/armor bonuses\n\n• \`/raidintel map:<map_name> weapon:<optional> armor:<optional>\``
            },
            { name: "🛡️ Trigger Buffs and Debuffs", value: "• Conditions: `storm`, `fog`, `night`, `heatwave`, `urban`, `radiation`, `drizzle`, `crosswind`, `low_power`, `ashfall`\n\n• Best owned weapon/armor auto-apply with condition-specific modifiers and loss mitigation.\n\n• Some armor pieces now fully negate their matching raid condition." },
            { name: "👑 Boss Mechanics", value: "• Maps pull from boss variants or apex signatures with unique names and ferocity.\n\n• Boss pressure scales with map, tension, and PMC progression.\n\n• Defeating bosses grants map-tuned gear drops, bonus Raid XP, extra token rewards, and permanent heart trophies." },
            { name: "📈 PMC Progression", value: `• PMC XP is separate from chat XP.\n\n• Milestone tiers unlock at 1000 / 4000 / 8000 / 12000 / ${PMC_LEVEL_CAP} with escalating raid buffs.` },
            { name: "⏱️ Operation Rules", value: `Cooldown: 5s | Minimum bet: ${MIN_RAID_BET} FN Token$ | Raid XP saved to persistent PMC profile` }
        );
}

function helpPageShop() {
    return new EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("📦 Supply and Inventory")
        .setDescription("Buy, sell, store, and open loot crates.")
        .addFields(
            { name: "Command Summary", value: "• `/shop` — list purchasable items\n\n• `/inventory` — show owned items and quantities\n\n• `/buy` — purchase item by id and quantity\n\n• `/sell` — sell owned items for tokens\n\n• `/opencrate` — consume crate and roll loot\n\n• `/useitem` — use consumables for instant effects" },
            { name: "Loot Notes", value: "• Raid loot now includes broader resources, consumables, elite crates, and boss-specific drops.\n\n• Best owned loadout auto-applies in raids.\n\n• Inventory and token changes are persisted." }
        );
}

function helpPageGames() {
    return new EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🪖 War Games Command")
        .setDescription("High-risk tactical casino simulations powered by FN Token$ from raids and live operations rewards.")
        .addFields(
            { name: "Battle Deck", value: "• `/dice` — precision or parity strike\n\n• `/roulette` — sector and color control\n\n• `/blackjack` — safe or aggressive command style\n\n• `/crash` — multiplier extraction window\n\n• `/magicslots` — enchanted reels, jackpot arcs, and bonus magic rounds\n\n• `/coinflip` — rapid binary call\n\n• `/baccarat` — player / banker / tie wagers\n\n• `/hilo` — threat escalation call\n\n• `/keno` — tactical number board" },
            { name: "Rules of Engagement", value: "• Stake is committed before each round.\n\n• Result boards use mission colors: WIN=green, LOSS=red, PUSH=yellow.\n\n• Action buttons allow replay, bet scaling, and mode rotation." }
        );
}

function helpPageBank() {
    return new EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🏦 Banking and Trading Directory")
        .setDescription("Organized FN Token$ banking and direct player-to-player trading.")
        .addFields(
            { name: "📦 Banking Commands", value: "• `/bank` — wallet + bank overview\n\n• `/deposit` — move wallet tokens into bank\n\n• `/withdraw` — move bank tokens to wallet\n\n• `/transfer` — wallet-to-wallet token send" },
            { name: "🧾 Trade Commands", value: "• `/tradeoffer` — create item-for-item offer\n\n• `/trades` — list incoming/outgoing open trades\n\n• `/tradeaccept` — complete an incoming offer\n\n• `/tradedecline` — reject/cancel a trade" },
            { name: "🛡️ Trade Rules", value: "• Only inventory items can be traded.\n\n• Both inventories are revalidated at accept time." },
            { name: "📈 Banking Notes", value: "• Bank stores FN Token$ separately from wallet.\n\n• Raid and casino bets consume wallet tokens." }
        );
}

function helpPageModeration() {
    return new EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🛡️ Moderation and Admin Directory")
        .setDescription("Community safety overview. Sensitive admin command details are intentionally hidden from public help.")
        .addFields(
            {
                name: "Community Safety Flow",
                value: "• Staff can issue warnings and escalations for abuse/spam.\n\n• Repeated violations may trigger timeout, removal, or bans.\n\n• Enforcement actions are logged for audit and accountability."
            },
            {
                name: "Support Workflow",
                value: "• Tickets are handled through claim, assignment, workflow updates, archive, reopen, and permanent resolution stages.\n\n• SLA monitoring and audit logs are active for support operations quality."
            },
            {
                name: "Admin Command Visibility",
                value: "Sensitive admin and diagnostics commands are intentionally not listed in public help."
            }
        );
}

async function buildHelpPayload(page: keyof typeof HELP_IDS = "general", guild?: Guild | null) {
    const embed =
        page === "xp" ? await helpPageXP(guild) :
        page === "raids" ? helpPageRaids() :
        page === "shop" ? helpPageShop() :
        page === "bank" ? helpPageBank() :
        page === "moderation" ? helpPageModeration() :
        page === "games" ? helpPageGames() :
        helpPageGeneral();
    return { embed: embed.toJSON(), withHelpNav: true, helpPage: page };
}

function getAvatar(user: User): string {
    return user.displayAvatarURL({ extension: "png", size: 256 });
}

type CommandTheme = {
    color: number;
    icon: string;
    label: string;
};

const RAID_COMMAND_SET = new Set(["raid", "raidintel", "raidhistory", "bosses", "conditions", "gearintel", "loadout", "pmc"]);
const GAME_COMMAND_SET = new Set(["dice", "roulette", "blackjack", "crash", "magicslots", "coinflip", "baccarat", "hilo", "keno"]);

function resolveCommandTheme(commandName: string): CommandTheme {
    const cmd = commandName.toLowerCase();

    const raidCommands = new Set(["raid", "raidintel", "raidhistory", "bosses", "conditions", "gearintel", "loadout", "pmc"]);
    const xpCommands = new Set(["xp", "xpstats", "xproles", "xprolesync", "leaderboard", "daily", "xpverify"]);
    const economyCommands = new Set(["balance", "token", "bank", "deposit", "withdraw", "transfer", "shop", "inventory", "buy", "sell", "opencrate", "useitem", "tradeoffer", "trades", "tradeaccept", "tradedecline"]);
    const gameCommands = new Set(["dice", "roulette", "blackjack", "crash", "magicslots", "coinflip", "baccarat", "hilo", "keno"]);
    const moderationCommands = new Set(["warn", "warnings", "clearwarnings", "tempban", "purge", "points", "pointsuser", "addpoints", "addtoken", "timeout", "kick", "ban", "setmodlog", "modconfig", "xprolesync", "health", "rolesanity", "ticketsanity", "xpverify", "incident"]);
    const ticketCommands = new Set([
        "ticket",
        "ticketintake",
        "ticketforce",
        "ticketpanel",
        "claimticket",
        "ticketassign",
        "ticketstatus",
        "reopenticket",
        "closeticket",
        "resolveticket",
        "ticketconfig",
        "tickets",
        "ticketanalytics",
        "ticketworkload",
        "ticketnote",
        "tickettimeline",
        "ticketmerge",
        "ticketlink",
        "ticketexport",
        "ticketretention"
    ]);

    if (cmd === "pmc") return { color: 0x0b1f3a, icon: "🪖", label: "PMC Profile" };
    if (raidCommands.has(cmd)) return { color: 0xd97706, icon: "⚔️", label: "Raid Ops" };
    if (xpCommands.has(cmd)) return { color: 0x0ea5e9, icon: "🎖️", label: "Progression" };
    if (economyCommands.has(cmd)) return { color: 0x059669, icon: "💰", label: "Economy" };
    if (gameCommands.has(cmd)) return { color: 0xdc2626, icon: "🎯", label: "Games" };
    if (moderationCommands.has(cmd)) return { color: 0x1f2937, icon: "🛡️", label: "Moderation" };
    if (ticketCommands.has(cmd)) return { color: 0x0f766e, icon: "🎫", label: "Support" };
    if (cmd === "help" || cmd === "quickstart") return { color: 0x06b6d4, icon: "🪖", label: "Command Center" };
    return { color: 0x3b82f6, icon: "🪖", label: "Operations" };
}

function resolveOutcomeSignal(text: string): "success" | "failure" | "push" | "neutral" {
    const upper = text.toUpperCase();
    if (/\b(PUSH|DRAW|TIE)\b/.test(upper)) return "push";
    if (/\b(FAILURE|FAILED|LOSS|LOST|DEFEAT|BUST|ELIMINATED|OPERATION FAILED)\b/.test(upper)) return "failure";
    if (/\b(SUCCESS|WIN|WON|VICTORY|EXTRACTED|DEFEATED|OPERATION EXTRACTED)\b/.test(upper)) return "success";
    return "neutral";
}

function resolveOutcomeColor(commandName: string, text: string): number | null {
    const cmd = commandName.toLowerCase();
    const upper = text.toUpperCase();

    // /pmc includes neutral terms like "Loss Mitigation" that should not drive red/green outcome coloring.
    if (cmd === "pmc") return null;

    // Hard guarantee for /raid responses even if wording/format changes.
    if (cmd === "raid") {
        if (/MISSION\s*COMPLETE\s*:\s*SUCCESS/.test(upper) || /OPERATION\s+EXTRACTED/.test(upper)) return 0x22c55e;
        if (/MISSION\s*COMPLETE\s*:\s*FAILURE/.test(upper) || /OPERATION\s+FAILED/.test(upper)) return 0xef4444;
    }

    if (!RAID_COMMAND_SET.has(cmd) && !GAME_COMMAND_SET.has(cmd)) return null;

    const signal = resolveOutcomeSignal(text);
    if (signal === "success") return 0x22c55e;
    if (signal === "failure") return 0xef4444;
    if (signal === "push") return 0xf59e0b;
    return null;
}

function beautifyCommandText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return "No data available.";

    const lines = trimmed.split("\n").map(line => line.trimEnd());
    const beautified = lines.map(line => {
        if (!line) return line;
        if (line.startsWith("* ")) return `• ${line.slice(2)}`;
        if (line.startsWith("- ")) return `• ${line.slice(2)}`;

        const headingOnly = line.match(/^([A-Za-z0-9\s#()/%+\-]{2,40}):$/);
        if (headingOnly) {
            const heading = headingOnly[1].trim();
            return `__${heading}__`;
        }

        const keyValue = line.match(/^([A-Za-z0-9\s#()/%+\-]{2,40}):\s+(.+)$/);
        if (keyValue) {
            const key = keyValue[1].trim();
            const value = keyValue[2].trim();
            return `**${key}:** ${value}`;
        }

        return line;
    });

    return beautified.join("\n");
}

function chunkLines(lines: string[], limit = 1000): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > limit && current) {
            chunks.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function clampText(text: string, limit: number): string {
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function sanitizeEmbedBuilder(embed: EmbedBuilder): EmbedBuilder {
    const raw = embed.toJSON();
    const fields = (raw.fields || []).slice(0, 25).map(field => ({
        name: clampText(field.name || "Field", 256),
        value: clampText(field.value || "-", 1024),
        inline: field.inline
    }));

    const safe = new EmbedBuilder();
    if (raw.title) safe.setTitle(clampText(raw.title, 256));
    if (raw.description) safe.setDescription(clampText(raw.description, 4096));
    if (raw.color !== undefined) safe.setColor(raw.color);
    if (raw.author) safe.setAuthor({
        name: clampText(raw.author.name || "", 256),
        iconURL: raw.author.icon_url,
        url: raw.author.url
    });
    if (raw.thumbnail?.url) safe.setThumbnail(raw.thumbnail.url);
    if (raw.image?.url) safe.setImage(raw.image.url);
    if (raw.footer?.text) safe.setFooter({ text: clampText(raw.footer.text, 2048), iconURL: raw.footer.icon_url });
    if (raw.timestamp) safe.setTimestamp(new Date(raw.timestamp));
    if (fields.length) safe.addFields(fields);
    return safe;
}

function brandEmbedForUser(embed: EmbedBuilder, user: User, commandLabel: string): EmbedBuilder {
    return sanitizeEmbedBuilder(embed
        .setColor(embed.data.color ?? 0x4ca7ff)
    .setAuthor({ name: `${user.username} • ${commandLabel}`, iconURL: getAvatar(user) })
    .setThumbnail(embed.data.thumbnail?.url || ARMY_ICON_URL)
    .setFooter({ text: `Titan Premium Command Suite • Requested by ${user.tag}` })
        .setTimestamp(new Date()));
}

function brandLiveEmbed(embed: EmbedBuilder, scopeLabel: string, footerLabel?: string): EmbedBuilder {
    const existingFooter = embed.data.footer?.text?.trim() || "";
    const footerText = [footerLabel || "Titan Ops Live Feed", existingFooter]
        .filter(Boolean)
        .join(" • ");

    const branded = embed
        .setColor(embed.data.color ?? 0x14b8a6)
        .setAuthor({
            name: scopeLabel,
            iconURL: ARMY_ICON_URL
        })
        .setFooter({ text: footerText.slice(0, 2048) });

    if (!embed.data.timestamp) {
        branded.setTimestamp(new Date());
    }

    return sanitizeEmbedBuilder(branded);
}

function embedFromText(commandName: string, text: string, user: User): APIEmbed {
    const theme = resolveCommandTheme(commandName);
    const cmd = commandName.toLowerCase();
    const bodyRaw = text.length > 4000 ? `${text.slice(0, 3997)}...` : text;
    const body = beautifyCommandText(bodyRaw);
    const lines = body.split("\n");
    const compact = lines.filter(line => line.trim().length > 0);

    let color = cmd === "pmc" ? 0x0b1f3a : theme.color;
    const outcomeColor = resolveOutcomeColor(commandName, body);
    if (outcomeColor !== null) color = outcomeColor;
    if (cmd === "pmc") color = 0x0b1f3a;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${theme.icon} /${commandName} • ${theme.label}`);

    if (compact.length <= 12 && body.length <= 1600) {
        embed.setDescription(body);
    } else {
        const summary = lines.slice(0, 6).join("\n").trim() || "No data available.";
        embed.setDescription(clampText(summary, 1200));

        const details = lines.slice(6).filter(line => line.trim().length > 0);
        const chunks = chunkLines(details, 950).slice(0, 3);
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({ name: i === 0 ? "Details" : `Details ${i + 1}`, value: chunks[i] });
        }
    }

    return brandEmbedForUser(embed, user, `/${commandName}`).toJSON();
}

function embedFromPayload(commandName: string, raw: APIEmbed, user: User): APIEmbed {
    const theme = resolveCommandTheme(commandName);
    const cmd = commandName.toLowerCase();
    const embed = EmbedBuilder.from(raw);
    const payloadText = [
        embed.data.title || "",
        embed.data.description || "",
        ...(embed.data.fields || []).map(field => `${field.name || ""}\n${field.value || ""}`)
    ].join("\n");

    const hasExplicitPayloadColor = typeof embed.data.color === "number";
    const shouldPreserveGamePayloadColor = GAME_COMMAND_SET.has(cmd) && hasExplicitPayloadColor;

    const outcomeColor = shouldPreserveGamePayloadColor ? null : resolveOutcomeColor(commandName, payloadText);
    if (outcomeColor !== null) {
        embed.setColor(outcomeColor);
    } else if (!embed.data.color) {
        embed.setColor(theme.color);
    }
    if (cmd === "pmc") {
        embed.setColor(0x0b1f3a);
    }
    if (!embed.data.title) embed.setTitle(`${theme.icon} /${commandName} • ${theme.label}`);
    return brandEmbedForUser(embed, user, `/${commandName}`).toJSON();
}

function getShopItems(): ItemDef[] {
    return SHOP_ITEMS.map(id => ITEM_DEFS[id]);
}

function formatInventory(userId: string): string {
    const inv = ensureUser(userId).inventory;
    const entries = Object.entries(inv);
    if (!entries.length) return "Empty";
    return entries.map(([id, qty]) => `${qty}x ${ITEM_DEFS[id]?.name || id}`).join("\n");
}

type RaidConditionKey = "storm" | "fog" | "night" | "heatwave" | "urban" | "radiation" | "drizzle" | "crosswind" | "low_power" | "ashfall";

type RaidCondition = {
    key: RaidConditionKey;
    label: string;
    description: string;
    successDelta: number;
    tokenMultiplierDelta: number;
    xpMultiplier: number;
};

const RAID_CONDITIONS: RaidCondition[] = [
    { key: "storm", label: "Storm Front", description: "Visibility drops and extraction lanes are unstable.", successDelta: -0.03, tokenMultiplierDelta: 0.08, xpMultiplier: 1.1 },
    { key: "fog", label: "Dense Fog", description: "Long-range pressure is reduced, stealth routing improves.", successDelta: -0.01, tokenMultiplierDelta: 0.05, xpMultiplier: 1.06 },
    { key: "night", label: "Night Operation", description: "High-risk engagement windows with stealth-focused paths.", successDelta: -0.02, tokenMultiplierDelta: 0.1, xpMultiplier: 1.14 },
    { key: "heatwave", label: "Heatwave", description: "Thermal strain lowers heavy gear efficiency.", successDelta: -0.015, tokenMultiplierDelta: 0.06, xpMultiplier: 1.08 },
    { key: "urban", label: "Urban Collapse", description: "Close-quarters terrain rewards mobility and fast weapons.", successDelta: 0.0, tokenMultiplierDelta: 0.04, xpMultiplier: 1.04 },
    { key: "radiation", label: "Radiation Surge", description: "Hazard zones punish weak protection but increase rewards.", successDelta: -0.025, tokenMultiplierDelta: 0.12, xpMultiplier: 1.18 },
    { key: "drizzle", label: "Cold Drizzle", description: "Minor moisture slicks lanes and softens sightlines without heavily disrupting tempo.", successDelta: -0.006, tokenMultiplierDelta: 0.025, xpMultiplier: 1.03 },
    { key: "crosswind", label: "Crosswind Shear", description: "Light lateral wind nudges ranged consistency and extraction timing.", successDelta: -0.009, tokenMultiplierDelta: 0.03, xpMultiplier: 1.04 },
    { key: "low_power", label: "Low Power Grid", description: "Flickering infrastructure causes subtle routing delays and weaker tactical reads.", successDelta: -0.012, tokenMultiplierDelta: 0.035, xpMultiplier: 1.05 },
    { key: "ashfall", label: "Ashfall", description: "Airborne ash creates persistent low-grade interference across the operation.", successDelta: -0.018, tokenMultiplierDelta: 0.055, xpMultiplier: 1.08 }
];

type RaidDifficulty = "Beginner" | "Mid" | "Hard" | "Elite" | "Brutal" | "Cataclysmic";

type RaidMapKey = "plagued_cemetary" | "slaughterhouse" | "boogerswoodz" | "megayachtolopolis" | "warlords_warcamp" | "sunken_village";

type RaidMapConfig = {
    key: RaidMapKey;
    label: string;
    difficulty: RaidDifficulty;
    helpSummary: string;
    description: string;
    lootTier: string;
    recommendedTension: "low" | "medium" | "high";
    successDelta: number;
    tokenMultiplierDelta: number;
    xpMultiplier: number;
    lootGearChanceBonus: number;
    resourceChanceBonus: number;
    legendaryChanceBonus: number;
    fnCoinChanceBonus: number;
    bossName: string;
    bossSpawnChance: number;
    bossSuccessPenalty: number;
    bossKillPenalty: number;
    bossRaidPressure: number;
    bossBonusXpRange: [number, number];
    bossPool: BossVariant[];
    successWeapons: string[];
    failureWeapons: string[];
    successArmor: string[];
    failureArmor: string[];
    bossKit: { weaponId: string; armorId: string };
    scrapBonus: number;
    bonusLootPool: Array<{ id: string; weight: number }>;
    crateDropTable: Array<{ id: string; weight: number }>;
    bossCrateDropTable: Array<{ id: string; weight: number }>;
};

type RaidLootTuning = {
    successBaseRolls: number;
    successHighTensionBonusRolls: number;
    successHardMapBonusRolls: number;
    failureBaseRolls: number;
    gearSuccessBaseChance: number;
    gearFailureChance: number;
    fnCoinBaseChance: number;
    relicBaseChance: number;
    crateBaseChance: number;
    ultraRareBaseChance: number;
    bossUltraRareBonusChance: number;
};

const RAID_LOOT_TUNING_BY_DIFFICULTY: Record<RaidMapConfig["difficulty"], RaidLootTuning> = {
    Beginner: {
        successBaseRolls: 1,
        successHighTensionBonusRolls: 1,
        successHardMapBonusRolls: 0,
        failureBaseRolls: 1,
        gearSuccessBaseChance: 0.18,
        gearFailureChance: 0.06,
        fnCoinBaseChance: 0.006,
        relicBaseChance: 0.018,
        crateBaseChance: 0.026,
        ultraRareBaseChance: 0.0003,
        bossUltraRareBonusChance: 0.0028
    },
    Mid: {
        successBaseRolls: 1,
        successHighTensionBonusRolls: 1,
        successHardMapBonusRolls: 0,
        failureBaseRolls: 1,
        gearSuccessBaseChance: 0.22,
        gearFailureChance: 0.08,
        fnCoinBaseChance: 0.009,
        relicBaseChance: 0.024,
        crateBaseChance: 0.035,
        ultraRareBaseChance: 0.00075,
        bossUltraRareBonusChance: 0.0035
    },
    Hard: {
        successBaseRolls: 1,
        successHighTensionBonusRolls: 1,
        successHardMapBonusRolls: 1,
        failureBaseRolls: 1,
        gearSuccessBaseChance: 0.26,
        gearFailureChance: 0.1,
        fnCoinBaseChance: 0.012,
        relicBaseChance: 0.03,
        crateBaseChance: 0.042,
        ultraRareBaseChance: 0.0014,
        bossUltraRareBonusChance: 0.0042
    },
    Elite: {
        successBaseRolls: 2,
        successHighTensionBonusRolls: 1,
        successHardMapBonusRolls: 1,
        failureBaseRolls: 1,
        gearSuccessBaseChance: 0.29,
        gearFailureChance: 0.11,
        fnCoinBaseChance: 0.014,
        relicBaseChance: 0.034,
        crateBaseChance: 0.052,
        ultraRareBaseChance: 0.0019,
        bossUltraRareBonusChance: 0.0049
    },
    Brutal: {
        successBaseRolls: 2,
        successHighTensionBonusRolls: 1,
        successHardMapBonusRolls: 1,
        failureBaseRolls: 1,
        gearSuccessBaseChance: 0.31,
        gearFailureChance: 0.115,
        fnCoinBaseChance: 0.016,
        relicBaseChance: 0.039,
        crateBaseChance: 0.06,
        ultraRareBaseChance: 0.0023,
        bossUltraRareBonusChance: 0.0054
    },
    Cataclysmic: {
        successBaseRolls: 2,
        successHighTensionBonusRolls: 2,
        successHardMapBonusRolls: 1,
        failureBaseRolls: 1,
        gearSuccessBaseChance: 0.34,
        gearFailureChance: 0.12,
        fnCoinBaseChance: 0.018,
        relicBaseChance: 0.044,
        crateBaseChance: 0.075,
        ultraRareBaseChance: 0.003,
        bossUltraRareBonusChance: 0.0062
    }
};

type BossVariant = {
    name: string;
    title: string;
    ferocity: number;
    successPenalty: number;
    killPenalty: number;
    raidPressure: number;
    bonusXpRange: [number, number];
    tokenRewardRange: [number, number];
    weaponDrops: string[];
    armorDrops: string[];
    rareDropChance: number;
};

type BossRosterEntry = BossVariant & {
    homeMapKey: RaidMapKey;
    homeMapLabel: string;
    homeMapDifficulty: RaidDifficulty;
};

type RolledBoss = {
    name: string;
    title: string;
    ferocity: number;
    successPenalty: number;
    killPenalty: number;
    raidPressure: number;
    bonusXpRange: [number, number];
    tokenRewardRange: [number, number];
    weaponDrop: string;
    armorDrop: string;
    rareDropChance: number;
    homeMapKey: RaidMapKey;
    homeMapLabel: string;
    spawnSharePct: number;
};

function pickOne<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeightedEntry<T extends { weight: number }>(arr: T[]): T {
    const eligible = arr.filter(entry => entry.weight > 0);
    if (!eligible.length) return arr[0];
    const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of eligible) {
        roll -= entry.weight;
        if (roll <= 0) return entry;
    }
    return eligible[eligible.length - 1];
}

function rollBossVariant(mapCfg: RaidMapConfig): RolledBoss {
    const variant = pickWeightedEntry(getBossRotationTable(mapCfg));
    return {
        name: variant.boss.name,
        title: variant.boss.title,
        ferocity: variant.boss.ferocity,
        successPenalty: variant.boss.successPenalty,
        killPenalty: variant.boss.killPenalty,
        raidPressure: variant.boss.raidPressure,
        bonusXpRange: variant.boss.bonusXpRange,
        tokenRewardRange: variant.boss.tokenRewardRange,
        weaponDrop: pickOne(variant.boss.weaponDrops),
        armorDrop: pickOne(variant.boss.armorDrops),
        rareDropChance: variant.boss.rareDropChance,
        homeMapKey: variant.boss.homeMapKey,
        homeMapLabel: variant.boss.homeMapLabel,
        spawnSharePct: variant.sharePct
    };
}

function isAdvancedRaidDifficulty(difficulty: RaidDifficulty): boolean {
    return difficulty !== "Beginner" && difficulty !== "Mid";
}

const RAID_MAPS: Record<RaidMapKey, RaidMapConfig> = {
    plagued_cemetary: {
        key: "plagued_cemetary",
        label: "FN Plagued Cemetery",
        difficulty: "Beginner",
        helpSummary: "Beginner map, higher extraction odds, low-mid loot.",
        description: "Beginner route with calmer extraction lanes and low-mid tier loot opportunities.",
        lootTier: "Low to Mid",
        recommendedTension: "low",
        successDelta: 0.12,
        tokenMultiplierDelta: -0.12,
        xpMultiplier: 0.88,
        lootGearChanceBonus: -0.08,
        resourceChanceBonus: 0.03,
        legendaryChanceBonus: -0.025,
        fnCoinChanceBonus: -0.02,
        bossName: "The Grave Warden",
        bossSpawnChance: 0.05,
        bossSuccessPenalty: 0.05,
        bossKillPenalty: 0.06,
        bossRaidPressure: 0.01,
        bossBonusXpRange: [24, 52],
        bossPool: [
            { name: "The Grave Warden", title: "Crypt Marshal", ferocity: 0.7, successPenalty: 0.03, killPenalty: 0.05, raidPressure: 0.012, bonusXpRange: [28, 58], tokenRewardRange: [18, 42], weaponDrops: ["marksman_dmr", "scav_smg"], armorDrops: ["guardian_plate", "storm_shell"], rareDropChance: 0.08 },
            { name: "Sister Vell", title: "Bone Oracle", ferocity: 0.82, successPenalty: 0.04, killPenalty: 0.06, raidPressure: 0.013, bonusXpRange: [36, 72], tokenRewardRange: [26, 58], weaponDrops: ["thermal_lance", "marksman_dmr"], armorDrops: ["shadow_cloak", "guardian_plate"], rareDropChance: 0.1 },
            { name: "Morrow Fang", title: "Pit Reaper", ferocity: 0.9, successPenalty: 0.05, killPenalty: 0.07, raidPressure: 0.015, bonusXpRange: [48, 86], tokenRewardRange: [30, 66], weaponDrops: ["mythic_hammer", "plasma_carbine"], armorDrops: ["adaptive_mesh", "juggernaut_frame"], rareDropChance: 0.12 }
        ],
        successWeapons: ["rust_blade", "combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr"],
        failureWeapons: ["rust_blade", "combat_knife", "scav_smg"],
        successArmor: ["field_vest", "scout_weave", "tactical_armor", "guardian_plate", "storm_shell"],
        failureArmor: ["field_vest", "scout_weave", "tactical_armor"],
        bossKit: { weaponId: "marksman_dmr", armorId: "guardian_plate" },
        scrapBonus: 2,
        bonusLootPool: [
            { id: "field_ration", weight: 8 },
            { id: "common_crate", weight: 3 },
            { id: "rare_material_small", weight: 6 },
            { id: "tactical_blueprint", weight: 2 }
        ],
        crateDropTable: [{ id: "tactical_crate", weight: 1 }],
        bossCrateDropTable: [{ id: "tactical_crate", weight: 1 }]
    },
    slaughterhouse: {
        key: "slaughterhouse",
        label: "FN Slaughterhouse",
        difficulty: "Mid",
        helpSummary: "Mid map, harder extracts, better loot spread, 10% boss spawn.",
        description: "Mid-tier combat map with harder extractions, stronger loot spread, and a 10% boss spawn chance.",
        lootTier: "Mid to High",
        recommendedTension: "medium",
        successDelta: -0.04,
        tokenMultiplierDelta: 0.14,
        xpMultiplier: 1.16,
        lootGearChanceBonus: 0.07,
        resourceChanceBonus: 0.08,
        legendaryChanceBonus: 0.03,
        fnCoinChanceBonus: 0.012,
        bossName: "Butcher Prime",
        bossSpawnChance: 0.12,
        bossSuccessPenalty: 0.09,
        bossKillPenalty: 0.1,
        bossRaidPressure: 0.013,
        bossBonusXpRange: [60, 120],
        bossPool: [
            { name: "Butcher Prime", title: "Arena Tyrant", ferocity: 1.05, successPenalty: 0.06, killPenalty: 0.08, raidPressure: 0.016, bonusXpRange: [70, 132], tokenRewardRange: [48, 92], weaponDrops: ["mythic_hammer", "thermal_lance"], armorDrops: ["juggernaut_frame", "void_shield"], rareDropChance: 0.16 },
            { name: "Shardjaw", title: "Steel Maw", ferocity: 1.12, successPenalty: 0.07, killPenalty: 0.09, raidPressure: 0.018, bonusXpRange: [84, 156], tokenRewardRange: [56, 108], weaponDrops: ["rail_sniper", "plasma_carbine"], armorDrops: ["adaptive_mesh", "aegis_exosuit"], rareDropChance: 0.2 },
            { name: "Hexline Rook", title: "Execution Marshal", ferocity: 1.2, successPenalty: 0.08, killPenalty: 0.1, raidPressure: 0.02, bonusXpRange: [92, 168], tokenRewardRange: [62, 118], weaponDrops: ["reactor_blade", "rail_sniper"], armorDrops: ["titan_carapace", "aegis_exosuit"], rareDropChance: 0.22 }
        ],
        successWeapons: ["combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer"],
        failureWeapons: ["rust_blade", "combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr"],
        successArmor: ["scout_weave", "tactical_armor", "guardian_plate", "storm_shell", "shadow_cloak", "void_shield", "adaptive_mesh", "juggernaut_frame"],
        failureArmor: ["field_vest", "scout_weave", "tactical_armor", "guardian_plate", "storm_shell"],
        bossKit: { weaponId: "mythic_hammer", armorId: "juggernaut_frame" },
        scrapBonus: 5,
        bonusLootPool: [
            { id: "weapon_bolts", weight: 7 },
            { id: "repair_kit", weight: 5 },
            { id: "rare_crate", weight: 2 },
            { id: "reactor_matrix", weight: 2 }
        ],
        crateDropTable: [{ id: "tactical_crate", weight: 1 }],
        bossCrateDropTable: [{ id: "tactical_crate", weight: 1 }]
    },
    boogerswoodz: {
        key: "boogerswoodz",
        label: "FN BoogersWoodZ",
        difficulty: "Hard",
        helpSummary: "Hard map, premium loot tables, harder boss pressure.",
        description: "Highest-risk territory with elite loot tables, brutal extraction odds, and harder bosses.",
        lootTier: "High to Legendary",
        recommendedTension: "high",
        successDelta: -0.16,
        tokenMultiplierDelta: 0.28,
        xpMultiplier: 1.34,
        lootGearChanceBonus: 0.14,
        resourceChanceBonus: 0.12,
        legendaryChanceBonus: 0.07,
        fnCoinChanceBonus: 0.04,
        bossName: "Booger King Omega",
        bossSpawnChance: 0.26,
        bossSuccessPenalty: 0.16,
        bossKillPenalty: 0.2,
        bossRaidPressure: 0.016,
        bossBonusXpRange: [140, 260],
        bossPool: [
            { name: "Booger King Omega", title: "Apex Monstrosity", ferocity: 1.4, successPenalty: 0.1, killPenalty: 0.12, raidPressure: 0.022, bonusXpRange: [160, 280], tokenRewardRange: [120, 210], weaponDrops: ["reactor_blade", "rail_sniper"], armorDrops: ["titan_carapace", "aegis_exosuit"], rareDropChance: 0.28 },
            { name: "Queen Sumphex", title: "Rot Sovereign", ferocity: 1.55, successPenalty: 0.12, killPenalty: 0.14, raidPressure: 0.024, bonusXpRange: [190, 320], tokenRewardRange: [140, 245], weaponDrops: ["reactor_blade", "mythic_hammer"], armorDrops: ["titan_carapace", "adaptive_mesh"], rareDropChance: 0.34 },
            { name: "Warlord Nullhide", title: "Void Cannoneer", ferocity: 1.68, successPenalty: 0.14, killPenalty: 0.16, raidPressure: 0.026, bonusXpRange: [220, 360], tokenRewardRange: [160, 290], weaponDrops: ["rail_sniper", "plasma_carbine", "enhanced_plasma_carbine"], armorDrops: ["aegis_exosuit", "titan_carapace"], rareDropChance: 0.38 }
        ],
        successWeapons: ["ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade"],
        failureWeapons: ["combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr", "ion_cannon"],
        successArmor: ["void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace"],
        failureArmor: ["tactical_armor", "guardian_plate", "storm_shell", "shadow_cloak", "void_shield"],
        bossKit: { weaponId: "reactor_blade", armorId: "titan_carapace" },
        scrapBonus: 8,
        bonusLootPool: [
            { id: "servo_motor", weight: 6 },
            { id: "nanofiber_roll", weight: 4 },
            { id: "black_ice_lens", weight: 2 },
            { id: "epic_crate", weight: 2 },
            { id: "spectral_fiber", weight: 2 }
        ],
        crateDropTable: [
            { id: "tactical_crate", weight: 1 },
            { id: "mythic_crate", weight: 3 }
        ],
        bossCrateDropTable: [
            { id: "tactical_crate", weight: 1 },
            { id: "mythic_crate", weight: 4 }
        ]
    },
    megayachtolopolis: {
        key: "megayachtolopolis",
        label: "FN MegaYachtolopolis",
        difficulty: "Elite",
        helpSummary: "Elite yacht city, luxury-tech loot, punishing CQB bosses.",
        description: "Skyline-sized superyacht district packed with luxury-tech vaults, tight interior kill lanes, and brutal command deck extracts.",
        lootTier: "Luxury Tech / High-End",
        recommendedTension: "high",
        successDelta: -0.145,
        tokenMultiplierDelta: 0.31,
        xpMultiplier: 1.42,
        lootGearChanceBonus: 0.17,
        resourceChanceBonus: 0.15,
        legendaryChanceBonus: 0.085,
        fnCoinChanceBonus: 0.045,
        bossName: "Dreadwake Morvane",
        bossSpawnChance: 0.29,
        bossSuccessPenalty: 0.18,
        bossKillPenalty: 0.22,
        bossRaidPressure: 0.019,
        bossBonusXpRange: [210, 360],
        bossPool: [
            { name: "Dreadwake Morvane", title: "Hull Reaper", ferocity: 1.82, successPenalty: 0.15, killPenalty: 0.18, raidPressure: 0.03, bonusXpRange: [250, 390], tokenRewardRange: [180, 320], weaponDrops: ["reactor_blade", "rail_sniper", "enhanced_rail_sniper"], armorDrops: ["titan_carapace", "aegis_exosuit"], rareDropChance: 0.42 }
        ],
        successWeapons: ["ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade"],
        failureWeapons: ["pulse_rifle", "marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine"],
        successArmor: ["void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace"],
        failureArmor: ["guardian_plate", "storm_shell", "shadow_cloak", "void_shield", "adaptive_mesh"],
        bossKit: { weaponId: "reactor_blade", armorId: "titan_carapace" },
        scrapBonus: 9,
        bonusLootPool: [
            { id: "encrypted_chip", weight: 12 },
            { id: "nanofiber_roll", weight: 9 },
            { id: "black_ice_lens", weight: 4 },
            { id: "legendary_token", weight: 3 },
            { id: "tactical_crate", weight: 3 },
            { id: "quantum_logbook", weight: 3 }
        ],
        crateDropTable: [
            { id: "epic_crate", weight: 1 },
            { id: "tactical_crate", weight: 3 },
            { id: "mythic_crate", weight: 2 }
        ],
        bossCrateDropTable: [
            { id: "tactical_crate", weight: 2 },
            { id: "mythic_crate", weight: 3 }
        ]
    },
    warlords_warcamp: {
        key: "warlords_warcamp",
        label: "FN Warlords Warcamp",
        difficulty: "Brutal",
        helpSummary: "Brutal trench map, war salvage jackpots, relentless field pressure.",
        description: "Fortified trench sprawl where roaming commanders, artillery scars, and open kill boxes crush sloppy pushes.",
        lootTier: "War Salvage / High-End",
        recommendedTension: "high",
        successDelta: -0.155,
        tokenMultiplierDelta: 0.34,
        xpMultiplier: 1.48,
        lootGearChanceBonus: 0.19,
        resourceChanceBonus: 0.17,
        legendaryChanceBonus: 0.09,
        fnCoinChanceBonus: 0.05,
        bossName: "Kraghoss the Ashen Standard",
        bossSpawnChance: 0.31,
        bossSuccessPenalty: 0.19,
        bossKillPenalty: 0.23,
        bossRaidPressure: 0.021,
        bossBonusXpRange: [240, 390],
        bossPool: [
            { name: "Kraghoss the Ashen Standard", title: "Siegeblood Khan", ferocity: 1.96, successPenalty: 0.17, killPenalty: 0.2, raidPressure: 0.033, bonusXpRange: [290, 430], tokenRewardRange: [220, 360], weaponDrops: ["mythic_hammer", "plasma_carbine", "enhanced_thermal_lance"], armorDrops: ["aegis_exosuit", "juggernaut_frame"], rareDropChance: 0.46 }
        ],
        successWeapons: ["thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade"],
        failureWeapons: ["marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer"],
        successArmor: ["adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace"],
        failureArmor: ["storm_shell", "shadow_cloak", "void_shield", "adaptive_mesh", "juggernaut_frame"],
        bossKit: { weaponId: "mythic_hammer", armorId: "aegis_exosuit" },
        scrapBonus: 10,
        bonusLootPool: [
            { id: "weapon_bolts", weight: 12 },
            { id: "servo_motor", weight: 10 },
            { id: "combat_stim", weight: 8 },
            { id: "relic_fragment", weight: 4 },
            { id: "tactical_crate", weight: 4 },
            { id: "mythic_crate", weight: 1 },
            { id: "warbond_chip", weight: 2 }
        ],
        crateDropTable: [
            { id: "epic_crate", weight: 1 },
            { id: "tactical_crate", weight: 3 },
            { id: "mythic_crate", weight: 2 }
        ],
        bossCrateDropTable: [
            { id: "tactical_crate", weight: 2 },
            { id: "mythic_crate", weight: 4 }
        ]
    },
    sunken_village: {
        key: "sunken_village",
        label: "FN SUNKEN VILLAGE",
        difficulty: "Cataclysmic",
        helpSummary: "Cataclysmic ruins, varied crate economy, drowned apex boss.",
        description: "Flood-choked ruins with submerged cache routes, ambush angles, and crate-rich shrines that reward disciplined clears.",
        lootTier: "Crate Dense / Legendary",
        recommendedTension: "high",
        successDelta: -0.135,
        tokenMultiplierDelta: 0.3,
        xpMultiplier: 1.44,
        lootGearChanceBonus: 0.16,
        resourceChanceBonus: 0.14,
        legendaryChanceBonus: 0.095,
        fnCoinChanceBonus: 0.055,
        bossName: "Thalrex Mourntide",
        bossSpawnChance: 0.33,
        bossSuccessPenalty: 0.2,
        bossKillPenalty: 0.24,
        bossRaidPressure: 0.023,
        bossBonusXpRange: [270, 430],
        bossPool: [
            { name: "Thalrex Mourntide", title: "Drowned Godspeaker", ferocity: 2.08, successPenalty: 0.19, killPenalty: 0.22, raidPressure: 0.036, bonusXpRange: [340, 520], tokenRewardRange: [260, 420], weaponDrops: ["rail_sniper", "reactor_blade", "enhanced_reactor_blade", "enhanced_starforged_reaper"], armorDrops: ["titan_carapace", "adaptive_mesh"], rareDropChance: 0.5 }
        ],
        successWeapons: ["ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade"],
        failureWeapons: ["marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine", "rail_sniper"],
        successArmor: ["void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace"],
        failureArmor: ["shadow_cloak", "void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit"],
        bossKit: { weaponId: "rail_sniper", armorId: "titan_carapace" },
        scrapBonus: 7,
        bonusLootPool: [
            { id: "common_crate", weight: 7 },
            { id: "rare_crate", weight: 8 },
            { id: "epic_crate", weight: 6 },
            { id: "tactical_crate", weight: 4 },
            { id: "mythic_crate", weight: 2 },
            { id: "scav_beacon", weight: 6 },
            { id: "relic_fragment", weight: 4 },
            { id: "mythic_circuit", weight: 2 }
        ],
        crateDropTable: [
            { id: "common_crate", weight: 4 },
            { id: "rare_crate", weight: 5 },
            { id: "epic_crate", weight: 5 },
            { id: "tactical_crate", weight: 4 },
            { id: "mythic_crate", weight: 3 }
        ],
        bossCrateDropTable: [
            { id: "rare_crate", weight: 2 },
            { id: "epic_crate", weight: 3 },
            { id: "tactical_crate", weight: 4 },
            { id: "mythic_crate", weight: 5 }
        ]
    }
};

const RAID_MAP_CHOICES = Object.values(RAID_MAPS).map(map => ({ name: map.label, value: map.key }));

const RAID_DIFFICULTY_ORDER: RaidDifficulty[] = ["Beginner", "Mid", "Hard", "Elite", "Brutal", "Cataclysmic"];

const RAID_MAP_SHORT_LABELS: Record<RaidMapKey, string> = {
    plagued_cemetary: "CEM",
    slaughterhouse: "SLH",
    boogerswoodz: "BGZ",
    megayachtolopolis: "MYO",
    warlords_warcamp: "WWC",
    sunken_village: "SVL"
};

const RAID_BOSS_ROSTER: BossRosterEntry[] = Object.values(RAID_MAPS).flatMap(mapCfg =>
    mapCfg.bossPool.map(boss => ({
        ...boss,
        homeMapKey: mapCfg.key,
        homeMapLabel: mapCfg.label,
        homeMapDifficulty: mapCfg.difficulty
    }))
);

function getRaidDifficultyIndex(difficulty: RaidDifficulty): number {
    const idx = RAID_DIFFICULTY_ORDER.indexOf(difficulty);
    return idx >= 0 ? idx : 0;
}

function getBossRotationWeight(boss: BossRosterEntry, mapCfg: RaidMapConfig): number {
    const difficultyDistance = Math.abs(getRaidDifficultyIndex(boss.homeMapDifficulty) - getRaidDifficultyIndex(mapCfg.difficulty));
    const sameMapBonus = boss.homeMapKey === mapCfg.key ? 8 : 0;
    const sameDifficultyBonus = boss.homeMapDifficulty === mapCfg.difficulty ? 3 : 0;
    const distanceBonus = Math.max(0, 4 - difficultyDistance);
    const ferocityBias = Math.max(1, Math.round(boss.ferocity * 1.8));
    return Math.max(1, sameMapBonus + sameDifficultyBonus + distanceBonus + ferocityBias);
}

function getBossRotationTable(mapCfg: RaidMapConfig): Array<{ boss: BossRosterEntry; weight: number; sharePct: number }> {
    const weighted = RAID_BOSS_ROSTER.map(boss => ({
        boss,
        weight: getBossRotationWeight(boss, mapCfg)
    }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    return weighted.map(entry => ({
        ...entry,
        sharePct: Math.round((entry.weight / total) * 1000) / 10
    }));
}

function formatBossRotationShares(boss: BossRosterEntry): string {
    return Object.values(RAID_MAPS)
        .map(mapCfg => {
            const tableEntry = getBossRotationTable(mapCfg).find(entry => entry.boss.name === boss.name);
            const share = tableEntry?.sharePct ?? 0;
            return `${RAID_MAP_SHORT_LABELS[mapCfg.key]} ${share.toFixed(1)}%`;
        })
        .join(" | ");
}

function resolveRaidMap(mapKeyRaw?: string | null): RaidMapConfig {
    const key = (mapKeyRaw || "plagued_cemetary") as RaidMapKey;
    return RAID_MAPS[key] || RAID_MAPS.plagued_cemetary;
}

function mapProjection(mapCfg: RaidMapConfig, tension: "low" | "medium" | "high"): {
    successPct: number;
    tokenMultiplier: number;
    xpBand: [number, number];
    expectedNetAt100: number;
    expectedBossBonusXp: number;
    bossKitDropChancePct: number;
} {
    const base = {
        low: { successChance: 0.8, tokenMultiplier: 1.15, xp: [14, 30] as [number, number] },
        medium: { successChance: 0.56, tokenMultiplier: 1.6, xp: [22, 54] as [number, number] },
        high: { successChance: 0.33, tokenMultiplier: 2.38, xp: [38, 88] as [number, number] }
    } as const;

    const avgConditionSuccessDelta = -0.0167;
    const avgConditionTokenDelta = 0.075;
    const bossExpectedPenalty = mapCfg.bossSpawnChance * (mapCfg.bossSuccessPenalty + mapCfg.bossRaidPressure);
    const tensionBossDelta = tension === "high" ? 0.08 : tension === "low" ? -0.03 : 0;
    const baselineBossKillChance = Math.max(0.12, Math.min(0.88, 0.4 + tensionBossDelta - mapCfg.bossKillPenalty - mapCfg.bossRaidPressure * 0.5));
    const avgBossBonusXp = Math.round((mapCfg.bossBonusXpRange[0] + mapCfg.bossBonusXpRange[1]) / 2);

    const successPct = Math.round(Math.max(0.06, Math.min(0.93,
        base[tension].successChance + mapCfg.successDelta + avgConditionSuccessDelta - bossExpectedPenalty
    )) * 100);

    const tokenMultiplier = Math.max(0.7,
        base[tension].tokenMultiplier + mapCfg.tokenMultiplierDelta + avgConditionTokenDelta
    );

    const xpBand: [number, number] = [
        Math.max(1, Math.floor(base[tension].xp[0] * mapCfg.xpMultiplier)),
        Math.max(1, Math.floor(base[tension].xp[1] * mapCfg.xpMultiplier))
    ];

    const successProb = successPct / 100;
    const expectedOutcomeTokens = 17;
    const bet = 100;
    const expectedNetAt100 = Math.round((successProb * bet * tokenMultiplier) + expectedOutcomeTokens - bet);
    const expectedBossBonusXp = Math.round(successProb * mapCfg.bossSpawnChance * baselineBossKillChance * avgBossBonusXp);
    const bossKitDropChancePct = Math.round(successProb * mapCfg.bossSpawnChance * baselineBossKillChance * 100);

    return { successPct, tokenMultiplier, xpBand, expectedNetAt100, expectedBossBonusXp, bossKitDropChancePct };
}

function getInventoryAutocompleteOptions(input: {
    userId: string;
    focusedRaw: string;
    allowedKinds?: Array<NonNullable<ItemDef["kind"]>>;
    ownedOnly?: boolean;
    includeUnowned?: boolean;
    sortByOwned?: boolean;
    metricKind?: "weapon" | "armor";
}): Array<{ name: string; value: string }> {
    const focused = input.focusedRaw.trim().toLowerCase();
    const entries = Object.entries(ITEM_DEFS)
        .filter(([, def]) => !input.allowedKinds || input.allowedKinds.includes((def.kind || "resource") as NonNullable<ItemDef["kind"]>))
        .map(([id, def]) => {
            const owned = getInventoryCount(input.userId, id);
            const metric = input.metricKind === "weapon"
                ? Math.round((def.raidAttack || 0) * 100)
                : input.metricKind === "armor"
                    ? Math.round((def.raidDefense || 0) * 100)
                    : 0;
            return { id, def, owned, metric };
        })
        .filter(entry => input.includeUnowned !== false || entry.owned > 0)
        .filter(entry => !input.ownedOnly || entry.owned > 0)
        .filter(entry => {
            if (!focused) return true;
            return `${entry.id} ${entry.def.name} ${entry.def.rarity} ${entry.def.kind || ""}`.toLowerCase().includes(focused);
        })
        .sort((a, b) => {
            if (input.sortByOwned && (b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0)) return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
            if (input.sortByOwned && b.owned !== a.owned) return b.owned - a.owned;
            if (b.metric !== a.metric) return b.metric - a.metric;
            return a.def.name.localeCompare(b.def.name);
        })
        .slice(0, 25);

    return entries.map(entry => {
        const status = entry.owned > 0 ? `OWNED x${entry.owned}` : "NOT OWNED";
        const metricText = input.metricKind === "weapon"
            ? `ATK +${entry.metric}%`
            : input.metricKind === "armor"
                ? `DEF +${entry.metric}%`
                : `${(entry.def.kind || "item").toUpperCase()}`;
        const raw = `${status} | ${entry.def.name} | ${metricText}`;
        return { name: raw.length > 100 ? `${raw.slice(0, 97)}...` : raw, value: entry.id };
    });
}

function getShopItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    const focused = focusedRaw.trim().toLowerCase();
    return SHOP_ITEMS
        .map(id => {
            const def = ITEM_DEFS[id];
            const owned = getInventoryCount(userId, id);
            return { id, def, owned };
        })
        .filter(entry => Boolean(entry.def))
        .filter(entry => !focused || `${entry.id} ${entry.def.name} ${entry.def.rarity}`.toLowerCase().includes(focused))
        .sort((a, b) => a.def.price - b.def.price || a.def.name.localeCompare(b.def.name))
        .slice(0, 25)
        .map(entry => {
            const raw = `${entry.def.name} | ${entry.id} | ${entry.def.price} FN Token$ | Owned ${entry.owned}`;
            return { name: raw.length > 100 ? `${raw.slice(0, 97)}...` : raw, value: entry.id };
        });
}

function getTradeOfferItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        ownedOnly: true,
        includeUnowned: false,
        sortByOwned: true
    });
}

function getTradeRequestItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        includeUnowned: true,
        sortByOwned: true
    });
}

function getTradeOfferAutocompleteOptions(userId: string, focusedRaw: string, mode: "incoming" | "all"): Array<{ name: string; value: string }> {
    const focused = focusedRaw.trim().toLowerCase();
    return tradeStore.offers
        .filter(offer => offer.status === "open")
        .filter(offer => mode === "incoming" ? offer.toUserId === userId : (offer.toUserId === userId || offer.fromUserId === userId))
        .sort((a, b) => b.id - a.id)
        .filter(offer => {
            const text = `#${offer.id} ${offer.offerItemId} ${offer.requestItemId} ${ITEM_DEFS[offer.offerItemId]?.name || ""} ${ITEM_DEFS[offer.requestItemId]?.name || ""}`.toLowerCase();
            return !focused || text.includes(focused);
        })
        .slice(0, 25)
        .map(offer => {
            const raw = `#${offer.id} | ${offer.offerQty}x ${ITEM_DEFS[offer.offerItemId]?.name || offer.offerItemId} -> ${offer.requestQty}x ${ITEM_DEFS[offer.requestItemId]?.name || offer.requestItemId}`;
            return { name: raw.length > 100 ? `${raw.slice(0, 97)}...` : raw, value: String(offer.id) };
        });
}

function getBestOwnedGear(userId: string, ids: string[], metric: "raidAttack" | "raidDefense"): ItemDef | null {
    const user = ensureUser(userId);
    let best: ItemDef | null = null;
    for (const id of ids) {
        const qty = user.inventory[id] || 0;
        if (qty <= 0) continue;
        const def = ITEM_DEFS[id];
        if (!def) continue;
        if (!best || (def[metric] || 0) > (best[metric] || 0)) {
            best = def;
        }
    }
    return best;
}

function getRaidGearAutocompleteOptions(userId: string, kind: "weapon" | "armor", focusedRaw: string): Array<{ name: string; value: string }> {
    const ids = kind === "weapon" ? WEAPON_IDS : ARMOR_IDS;
    const focused = focusedRaw.trim().toLowerCase();
    const metricKey = kind === "weapon" ? "raidAttack" : "raidDefense";

    const entries = ids
        .map(id => {
            const def = ITEM_DEFS[id];
            if (!def) return null;
            const owned = getInventoryCount(userId, id);
            const metric = Math.round(((def[metricKey] || 0) as number) * 100);
            const status = owned > 0 ? `OWNED x${owned}` : "NOT OWNED";
            const metricText = kind === "weapon" ? `ATK +${metric}%` : `DEF +${metric}%`;
            const labelRaw = `${status} | ${def.name} | ${metricText}`;
            const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}...` : labelRaw;
            return {
                id,
                name: def.name,
                rarity: def.rarity,
                owned,
                metric,
                label
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const filtered = focused
        ? entries.filter(entry => {
            const haystack = `${entry.id} ${entry.name} ${entry.rarity}`.toLowerCase();
            return haystack.includes(focused);
        })
        : entries;

    return filtered
        .sort((a, b) => {
            if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0)) return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
            if (b.owned !== a.owned) return b.owned - a.owned;
            if (b.metric !== a.metric) return b.metric - a.metric;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}

function getCatalogItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        includeUnowned: true,
        sortByOwned: true
    });
}

const OPENABLE_CRATE_IDS = ["common_crate", "rare_crate", "epic_crate", "tactical_crate", "mythic_crate"] as const;
const CRATE_OPEN_PRIORITY = ["mythic_crate", "tactical_crate", "epic_crate", "rare_crate", "common_crate"] as const;
const USEITEM_PRIORITY = ["scav_beacon", "combat_stim", "field_ration", "repair_kit"] as const;
const USABLE_CONSUMABLE_IDS = ["field_ration", "combat_stim", "repair_kit", "scav_beacon"] as const;

function isSupportedConsumableId(itemId: string): itemId is (typeof USABLE_CONSUMABLE_IDS)[number] {
    return USABLE_CONSUMABLE_IDS.includes(itemId as (typeof USABLE_CONSUMABLE_IDS)[number]);
}

function formatOwnedCratesForPrompt(userId: string): string {
    const owned = OPENABLE_CRATE_IDS
        .map(id => ({ id, def: ITEM_DEFS[id], qty: getInventoryCount(userId, id) }))
        .filter(entry => entry.qty > 0 && entry.def);

    if (owned.length === 0) return "None owned right now.";
    return owned
        .map(entry => `* ${entry.def.name} (${entry.id}) x${entry.qty}`)
        .join("\n");
}

function pickBestOwnedCrate(userId: string): string | null {
    for (const id of CRATE_OPEN_PRIORITY) {
        if (getInventoryCount(userId, id) > 0) return id;
    }
    return null;
}

function formatOwnedUsableItemsForPrompt(userId: string): string {
    const owned = Object.entries(ITEM_DEFS)
        .filter(([id, def]) => def.kind === "consumable" && isSupportedConsumableId(id))
        .map(([id, def]) => ({ id, def, qty: getInventoryCount(userId, id) }))
        .filter(entry => entry.qty > 0);

    if (owned.length === 0) return "None owned right now.";
    return owned
        .sort((a, b) => b.qty - a.qty || a.def.name.localeCompare(b.def.name))
        .map(entry => `* ${entry.def.name} (${entry.id}) x${entry.qty}`)
        .join("\n");
}

function isUsableNow(userId: string, itemId: string): boolean {
    const owned = getInventoryCount(userId, itemId);
    if (owned < 1) return false;
    if (itemId === "repair_kit") {
        return getInventoryCount(userId, "scrap") >= 6;
    }
    return true;
}

function pickBestUsableItem(userId: string): string | null {
    for (const id of USEITEM_PRIORITY) {
        if (isUsableNow(userId, id)) return id;
    }

    const fallback = Object.entries(ITEM_DEFS)
        .filter(([id, def]) => def.kind === "consumable" && isSupportedConsumableId(id))
        .map(([id]) => id)
        .find(id => isUsableNow(userId, id));

    return fallback || null;
}

function getOpenCrateAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    const focused = focusedRaw.trim().toLowerCase();
    return OPENABLE_CRATE_IDS
        .map(id => {
            const def = ITEM_DEFS[id];
            if (!def) return null;
            const owned = getInventoryCount(userId, id);
            const status = owned > 0 ? `OWNED x${owned}` : "NOT OWNED";
            const labelRaw = `${status} | ${def.name} | ${id}`;
            const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}...` : labelRaw;
            return { id, name: def.name, owned, label };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .filter(entry => {
            if (!focused) return true;
            return `${entry.id} ${entry.name}`.toLowerCase().includes(focused);
        })
        .sort((a, b) => {
            if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0)) return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
            if (b.owned !== a.owned) return b.owned - a.owned;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}

function getUseItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    const focused = focusedRaw.trim().toLowerCase();
    return Object.entries(ITEM_DEFS)
        .filter(([id, def]) => def.kind === "consumable" && isSupportedConsumableId(id))
        .map(([id, def]) => {
            const owned = getInventoryCount(userId, id);
            const status = owned > 0 ? `OWNED x${owned}` : "NOT OWNED";
            const labelRaw = `${status} | ${def.name} | ${id}`;
            const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}...` : labelRaw;
            return { id, name: def.name, owned, label };
        })
        .filter(entry => {
            if (!focused) return true;
            return `${entry.id} ${entry.name}`.toLowerCase().includes(focused);
        })
        .sort((a, b) => {
            if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0)) return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
            if (b.owned !== a.owned) return b.owned - a.owned;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}

function getSellItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    return getSellableInventoryOptions({ inventory: ensureUser(userId).inventory, focusedRaw })
        .slice(0, 25)
        .map(entry => {
            const raw = `[${rarityBadge(entry.rarity)}] OWNED x${entry.qty} | ${entry.name} | Sell ${entry.unitPrice}`;
            const label = raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
            return { name: label, value: entry.id };
        });
}

function weightedPick(table: Array<{ id: string; weight: number }>): string {
    const positive = table.filter(entry => entry.weight > 0);
    if (!positive.length) return table[0]?.id || "scrap";
    const total = positive.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of positive) {
        roll -= entry.weight;
        if (roll <= 0) return entry.id;
    }
    return positive[positive.length - 1].id;
}

function pushLootStack(loot: Array<{ id: string; qty: number }>, id: string, qty: number): void {
    const amount = Math.max(1, Math.floor(qty));
    const existing = loot.find(entry => entry.id === id);
    if (existing) {
        existing.qty += amount;
        return;
    }
    loot.push({ id, qty: amount });
}

function buyItem(userId: string, itemId: string, qty: number): { error?: string; cost?: number; total?: number } {
    const item = ITEM_DEFS[itemId];
    if (!item) return { error: "Item does not exist." };
    if (qty < 1) return { error: "Quantity must be at least 1." };
    const cost = item.price * qty;
    if (!canAffordTokens(userId, cost)) return { error: `You need ${cost} FN Token$.` };

    removeTokens(userId, cost);
    const total = addInventoryItem(userId, itemId, qty);
    return { cost, total };
}

function sellItem(userId: string, itemId: string, qty: number): { error?: string; payout?: number; remaining?: number } {
    const item = ITEM_DEFS[itemId];
    if (!item) return { error: "Item does not exist." };
    if (qty < 1) return { error: "Quantity must be at least 1." };
    const owned = getInventoryCount(userId, itemId);
    if (owned < qty) return { error: "Not enough item to sell." };

    const payout = getVendorSellPrice(itemId) * qty;
    const remaining = removeInventoryItem(userId, itemId, qty);
    addTokens(userId, payout);
    return { payout, remaining };
}

function openCrate(userId: string, crateId: string): { error?: string; contents?: Array<{ id: string; qty: number }> } {
    if (!["common_crate", "rare_crate", "epic_crate", "tactical_crate", "mythic_crate"].includes(crateId)) {
        return { error: "That crate cannot be opened." };
    }
    if (getInventoryCount(userId, crateId) < 1) {
        return { error: `You do not have any ${ITEM_DEFS[crateId].name}.` };
    }

    removeInventoryItem(userId, crateId, 1);
    const contents: Array<{ id: string; qty: number }> = [];
    const pushLoot = (id: string, qty: number) => {
        addInventoryItem(userId, id, qty);
        contents.push({ id, qty });
    };

    const pullTable = (table: Array<{ id: string; weight: number }>, pulls: number) => {
        for (let i = 0; i < pulls; i++) {
            pushLoot(weightedPick(table), 1);
        }
    };

    if (crateId === "common_crate") {
        pushLoot("scrap", 10 + Math.floor(Math.random() * 8));
        pullTable([
            { id: "rare_material_small", weight: 26 },
            { id: "field_ration", weight: 20 },
            { id: "repair_kit", weight: 14 },
            { id: "combat_stim", weight: 8 },
            { id: "cosmetic_token", weight: 7 },
            { id: "common_crate", weight: 4 }
        ], 2);
    } else if (crateId === "rare_crate") {
        pushLoot("scrap", 15 + Math.floor(Math.random() * 12));
        pullTable([
            { id: "rare_material_small", weight: 28 },
            { id: "rare_material", weight: 18 },
            { id: "encrypted_chip", weight: 12 },
            { id: "combat_stim", weight: 10 },
            { id: "scav_beacon", weight: 8 },
            { id: "cosmetic_token", weight: 8 },
            { id: "legendary_token", weight: 5 },
            { id: "tactical_crate", weight: 3 }
        ], 3);
    } else if (crateId === "epic_crate") {
        pushLoot("scrap", 20 + Math.floor(Math.random() * 16));
        pullTable([
            { id: "rare_material", weight: 24 },
            { id: "data_shard", weight: 12 },
            { id: "intel_cache", weight: 8 },
            { id: "encrypted_chip", weight: 14 },
            { id: "relic_fragment", weight: 9 },
            { id: "legendary_token", weight: 10 },
            { id: "scav_beacon", weight: 8 },
            { id: "power_cell", weight: 9 },
            { id: "med_patch", weight: 10 },
            { id: "mythic_hammer", weight: 5 },
            { id: "void_shield", weight: 5 },
            { id: "volt_smg", weight: 5 },
            { id: "arcskin_vest", weight: 5 },
            { id: "widowmaker_dmr", weight: 4 },
            { id: "nightglass_cloak", weight: 4 },
            { id: "vault_keycard", weight: 3 },
            { id: "signal_array", weight: 3 },
            { id: "tactical_crate", weight: 6 },
            { id: "mythic_crate", weight: 2 }
        ], 4);
    } else if (crateId === "tactical_crate") {
        pushLoot("scrap", 24 + Math.floor(Math.random() * 20));
        pullTable([
            { id: "rare_material", weight: 18 },
            { id: "data_shard", weight: 11 },
            { id: "intel_cache", weight: 8 },
            { id: "encrypted_chip", weight: 14 },
            { id: "legendary_token", weight: 10 },
            { id: "scav_beacon", weight: 9 },
            { id: "power_cell", weight: 8 },
            { id: "thermal_lance", weight: 6 },
            { id: "juggernaut_frame", weight: 6 },
            { id: "rail_sniper", weight: 5 },
            { id: "aegis_exosuit", weight: 5 },
            { id: "rift_carbine", weight: 4 },
            { id: "stormpiercer", weight: 3 },
            { id: "bulwark_plating", weight: 4 },
            { id: "stormforged_aegis", weight: 3 },
            { id: "relic_fragment", weight: 6 },
            { id: "vault_keycard", weight: 4 },
            { id: "signal_array", weight: 4 },
            { id: "mythic_crate", weight: 3 }
        ], 5);
    } else {
        pushLoot("scrap", 30 + Math.floor(Math.random() * 28));
        pullTable([
            { id: "legendary_token", weight: 16 },
            { id: "fn_coin", weight: 6 },
            { id: "relic_fragment", weight: 13 },
            { id: "data_shard", weight: 10 },
            { id: "intel_cache", weight: 8 },
            { id: "blacksite_map", weight: 4 },
            { id: "reactor_blade", weight: 7 },
            { id: "titan_carapace", weight: 7 },
            { id: "rail_sniper", weight: 7 },
            { id: "aegis_exosuit", weight: 7 },
            { id: "phantom_scythe", weight: 3 },
            { id: "sunflare_accelerator", weight: 2 },
            { id: "starforged_reaper", weight: 1 },
            { id: "tidelock_panoply", weight: 3 },
            { id: "voidscale_regalia", weight: 2 },
            { id: "sovereign_bastion", weight: 1 },
            { id: "scav_beacon", weight: 10 },
            { id: "signal_array", weight: 7 },
            { id: "vault_keycard", weight: 5 },
            { id: "med_patch", weight: 9 },
            { id: "encrypted_chip", weight: 12 },
            { id: "mythic_crate", weight: 5 }
        ], 6);
    }

    return { contents };
}

function useItem(userId: string, itemId: string, quantity: number): { error?: string; result?: string } {
    const item = ITEM_DEFS[itemId];
    if (!item) return { error: "Item does not exist." };
    if (item.kind !== "consumable") return { error: "That item is not usable with /useitem." };
    if (!isSupportedConsumableId(itemId)) return { error: "This consumable has no configured effect yet." };

    const qty = Math.max(1, Math.floor(quantity));
    const owned = getInventoryCount(userId, itemId);
    if (owned < qty) return { error: `You only have ${owned}x ${item.name}.` };

    removeInventoryItem(userId, itemId, qty);
    const user = ensureUser(userId);

    if (itemId === "field_ration") {
        const gain = qty * (12 + Math.floor(Math.random() * 12));
        addTokens(userId, gain);
        return { result: `Used ${qty}x ${item.name}. Gained ${gain} FN Token$.` };
    }

    if (itemId === "combat_stim") {
        const raidXpGain = qty * (20 + Math.floor(Math.random() * 26));
        const chatXpGain = qty * (8 + Math.floor(Math.random() * 10));
        user.rxp += raidXpGain;
        user.pmcXP += raidXpGain;
        addXP(userId, chatXpGain);
        savePoints();
        return { result: `Used ${qty}x ${item.name}. Raid XP +${raidXpGain}, Engagement XP +${chatXpGain}.` };
    }

    if (itemId === "repair_kit") {
        const scrapNeed = qty * 6;
        const scrapOwned = getInventoryCount(userId, "scrap");
        if (scrapOwned < scrapNeed) {
            addInventoryItem(userId, itemId, qty);
            return { error: `Need ${scrapNeed} scrap to use ${qty}x ${item.name}.` };
        }
        removeInventoryItem(userId, "scrap", scrapNeed);
        const materialYield = qty + Math.floor(Math.random() * (qty + 1));
        addInventoryItem(userId, "rare_material_small", materialYield);
        if (Math.random() < 0.35) addInventoryItem(userId, "rare_material", 1);
        return { result: `Used ${qty}x ${item.name}. Converted ${scrapNeed} scrap into ${materialYield} rare material and possible bonus components.` };
    }

    if (itemId === "scav_beacon") {
        const pulls = qty * 2;
        const drops: Array<{ id: string; qty: number }> = [];
        for (let i = 0; i < pulls; i++) {
            const dropId = weightedPick([
                { id: "rare_material_small", weight: 24 },
                { id: "rare_material", weight: 14 },
                { id: "encrypted_chip", weight: 12 },
                { id: "cosmetic_token", weight: 9 },
                { id: "legendary_token", weight: 6 },
                { id: "tactical_crate", weight: 4 },
                { id: "mythic_crate", weight: 1 }
            ]);
            addInventoryItem(userId, dropId, 1);
            const existing = drops.find(d => d.id === dropId);
            if (existing) existing.qty += 1;
            else drops.push({ id: dropId, qty: 1 });
        }

        const summary = drops.map(d => `${d.qty}x ${ITEM_DEFS[d.id]?.name || d.id}`).join(", ");
        return { result: `Used ${qty}x ${item.name}. Retrieved: ${summary}.` };
    }

    addInventoryItem(userId, itemId, qty);
    return { error: "Use action failed safely; item was restored." };
}

function performRaid(userId: string, bet: number, tension: string, mapKeyRaw?: string | null, selectedWeaponId?: string | null, selectedArmorId?: string | null): {
    error?: string;
    success?: boolean;
    net?: number;
    loot?: Array<{ id: string; qty: number }>;
    rxpGain?: number;
    successChance?: number;
    bet?: number;
    tension?: string;
    pmcLevel?: number;
    pmcXP?: number;
    mapLabel?: string;
    mapDifficulty?: string;
    conditionLabel?: string;
    bossSpawned?: boolean;
    bossDefeated?: boolean;
    bossName?: string;
    bossTitle?: string;
    bossFerocity?: number;
    bossBonusXp?: number;
    bossKillChance?: number;
    bossImageUrl?: string;
    pmcHpMax?: number;
    pmcHpRemaining?: number;
    bossHpMax?: number;
    bossHpRemaining?: number;
    bossHeartUnlockedName?: string;
    pmcTierUnlockedLabel?: string;
    pmcTierUnlockedBadge?: string;
    selectedWeaponName?: string;
    selectedArmorName?: string;
    baseRewardTokens?: number;
    outcomeBonusTokens?: number;
    bossBonusTokens?: number;
    failureMitigationTokens?: number;
} {
    const user = ensureUser(userId);
    const now = Date.now();

    if (now - user.lastRaid < RAID_COOLDOWN_MS) {
        const remain = Math.ceil((RAID_COOLDOWN_MS - (now - user.lastRaid)) / 1000);
        return { error: `Raid systems recharging. Wait ${remain}s.` };
    }
    if (bet < MIN_RAID_BET) return { error: `Minimum raid bet is ${MIN_RAID_BET} FN Token$.` };
    if (!canAffordTokens(userId, bet)) return { error: "Not enough FN Token$." };

    const mapCfg = resolveRaidMap(mapKeyRaw);
    const table = {
        low: { successChance: 0.78, tokenMultiplier: 1.07, baseRxp: 5 },
        medium: { successChance: 0.53, tokenMultiplier: 1.42, baseRxp: 11 },
        high: { successChance: 0.31, tokenMultiplier: 2.06, baseRxp: 22 }
    } as const;
    const cfg = table[(tension as keyof typeof table)] || table.medium;
    const condition = RaidDomain.rollRaidCondition();
    const gearBonus = RaidRuntime.getRaidLoadoutBonus({ userId, condition, selectedWeaponId, selectedArmorId, getInventoryCount, getBestOwnedGear });
    if (gearBonus.error) return { error: gearBonus.error };
    const effectiveCondition = gearBonus.negatedCondition
        ? { ...condition, successDelta: 0, tokenMultiplierDelta: 0, xpMultiplier: 1 }
        : condition;
    const pmcLevelBeforeRaid = getPmcLevel(user.pmcXP);
    const pmcTierBeforeRaid = getPmcTierForLevel(pmcLevelBeforeRaid);
    const pmcBuffs = getPmcBuffs(pmcLevelBeforeRaid);
    const levelPressure = Math.max(0, Math.min(0.11, pmcLevelBeforeRaid * 0.00075));
    const tensionPressure = tension === "high" ? 0.05 : tension === "medium" ? 0.02 : -0.01;
    const difficultyScalar = 1 + levelPressure + Math.max(0, tensionPressure);

    const mapDifficultyIndex = getRaidDifficultyIndex(mapCfg.difficulty);
    const mapDifficultyBossScale = 1 + (mapDifficultyIndex * 0.055);
    const latePmcBossScale = pmcLevelBeforeRaid >= 8000
        ? 1 + Math.min(0.18, (pmcLevelBeforeRaid - 8000) / 60000)
        : 1;

    const bossSpawnChance = Math.max(
        0.03,
        Math.min(0.82, mapCfg.bossSpawnChance + 0.02 + tensionPressure + levelPressure * 0.5 + mapCfg.bossRaidPressure * 0.35)
    );
    const bossSpawned = Math.random() < bossSpawnChance;
    const boss = bossSpawned ? rollBossVariant(mapCfg) : null;
    const bossPressurePenalty = bossSpawned
        ? (mapCfg.bossSuccessPenalty + mapCfg.bossRaidPressure + (boss?.successPenalty || 0) * difficultyScalar + (boss?.raidPressure || 0) * difficultyScalar) * mapDifficultyBossScale * latePmcBossScale
        : 0;
    const finalSuccessChance = Math.max(
        0.06,
        Math.min(0.93, cfg.successChance + mapCfg.successDelta + effectiveCondition.successDelta + gearBonus.attackBoost + pmcBuffs.successBonus - bossPressurePenalty)
    );

    const success = Math.random() < finalSuccessChance;
    removeTokens(userId, bet);

    let rewardTokens = 0;
    if (success) {
        const conditionTokenBoost = cfg.tokenMultiplier + mapCfg.tokenMultiplierDelta + effectiveCondition.tokenMultiplierDelta + gearBonus.tokenBoost + pmcBuffs.tokenBonus;
        rewardTokens = Math.max(1, Math.floor(bet * (conditionTokenBoost + (Math.random() * 0.12 - 0.07))));
        addTokens(userId, rewardTokens);
    }

    const outcomeText = getRaidOutcome(userId);
    const reward = success ? getRaidRewards(outcomeText) : { tokens: 0 };
    if (reward.tokens > 0) addTokens(userId, reward.tokens);

    let bossDefeated = false;
    let bossKillChance = 0;
    let bossBonusXp = 0;
    let bossTokenBonus = 0;
    let bossHeartUnlockedName: string | undefined;
    if (success && bossSpawned) {
        const tensionBossDelta = tension === "high" ? 0.08 : tension === "low" ? -0.03 : 0;
        const mapAndBossKillPenalty = (mapCfg.bossKillPenalty + mapCfg.bossRaidPressure + (boss?.killPenalty || 0) * difficultyScalar + (boss?.raidPressure || 0) * difficultyScalar) * (1 + mapDifficultyIndex * 0.05) * latePmcBossScale;
        const pmcRaidMastery = Math.max(0, Math.min(0.14, pmcLevelBeforeRaid * 0.00085));
        bossKillChance = Math.max(0.1, Math.min(0.9, 0.42 + gearBonus.attackBoost * 1.8 + pmcRaidMastery + tensionBossDelta - mapAndBossKillPenalty));
        bossDefeated = Math.random() < bossKillChance;
        if (bossDefeated) {
            const rolledBossReward = RaidDomain.rollBossSuccessRewards({
                bet,
                tension,
                mapDifficulty: mapCfg.difficulty,
                bossFerocity: boss?.ferocity || 1,
                bonusXpRange: boss?.bonusXpRange || mapCfg.bossBonusXpRange,
                tokenRewardRange: boss?.tokenRewardRange || [20, 55]
            });
            bossBonusXp = Math.max(1, Math.floor(rolledBossReward.bossBonusXp * RaidDomain.RAID_BOSS_XP_SCALE));
            bossTokenBonus = rolledBossReward.bossTokenBonus;
            addTokens(userId, bossTokenBonus);

            user.pmcBossKills = Math.max(0, Math.floor((user.pmcBossKills || 0) + 1));
            const bossHeartUnlock = awardBossHeartAchievement(userId, boss?.name || mapCfg.bossName);
            if (bossHeartUnlock.awarded) {
                bossHeartUnlockedName = bossHeartUnlock.heartName;
                appendAuditEvent("boss_heart_unlocked", {
                    userId,
                    bossName: boss?.name || mapCfg.bossName,
                    heartName: bossHeartUnlock.heartName || null
                });
            }
        }
    }

    let pmcHpMax = 0;
    let pmcHpRemaining = 0;
    let bossHpMax = 0;
    let bossHpRemaining = 0;
    if (bossSpawned) {
        const pmcPool = 500
            + Math.round(Math.min(260, pmcLevelBeforeRaid * 0.02))
            + Math.round(Math.max(0, gearBonus.defenseBoost) * 340);
        const bossPool = Math.round(
            (520 + mapDifficultyIndex * 45)
            * (boss?.ferocity || 1)
            * (1 + mapCfg.bossRaidPressure * 0.35)
        );

        let pmcRemainingPct = 0;
        let bossRemainingPct = 1;
        if (!success) {
            pmcRemainingPct = Math.max(0.04, Math.min(0.32, 0.11 + gearBonus.defenseBoost * 0.7 + finalSuccessChance * 0.08));
            bossRemainingPct = Math.max(0.62, Math.min(1, 0.82 + (1 - finalSuccessChance) * 0.14));
        } else if (bossDefeated) {
            pmcRemainingPct = Math.max(0.14, Math.min(0.9, 0.28 + bossKillChance * 0.42 + gearBonus.defenseBoost * 0.5));
            bossRemainingPct = 0;
        } else {
            pmcRemainingPct = Math.max(0.06, Math.min(0.54, 0.12 + bossKillChance * 0.24 + gearBonus.defenseBoost * 0.4));
            bossRemainingPct = Math.max(0.1, Math.min(0.88, 0.22 + (1 - bossKillChance) * 0.52));
        }

        pmcHpMax = Math.max(120, pmcPool);
        bossHpMax = Math.max(180, bossPool);
        pmcHpRemaining = Math.max(0, Math.min(pmcHpMax, Math.round(pmcHpMax * pmcRemainingPct)));
        bossHpRemaining = Math.max(0, Math.min(bossHpMax, Math.round(bossHpMax * bossRemainingPct)));
    }

    const loot = RaidRuntime.rollRaidLoot({ success, tension, mapCfg, bossDefeated, boss, difficultyScalar });
    for (const drop of loot) {
        addInventoryItem(userId, drop.id, drop.qty);
    }

    const baseRaidXpGain = RaidDomain.rollRaidXpGain(
        tension,
        success,
        bet,
        effectiveCondition.xpMultiplier * gearBonus.xpMultiplier * (1 + pmcBuffs.xpBonus),
        mapCfg
    );
    const progressionScale = RaidDomain.getPmcXpGainScale(pmcLevelBeforeRaid, mapCfg, tension, success);
    const scaledRaidXpGain = Math.max(1, Math.floor(baseRaidXpGain * progressionScale * RaidDomain.RAID_PMC_XP_SCALE));
    const rxpGain = scaledRaidXpGain + bossBonusXp;
    user.rxp += rxpGain;
    user.pmcXP += rxpGain;
    user.pmcRaids += 1;
    if (success) user.pmcRaidWins += 1;
    user.lastRaid = now;

    const pmcLevelAfterRaid = getPmcLevel(user.pmcXP);
    const pmcTierAfterRaid = getPmcTierForLevel(pmcLevelAfterRaid);
    const pmcTierUnlocked = pmcTierAfterRaid && (!pmcTierBeforeRaid || pmcTierAfterRaid.level > pmcTierBeforeRaid.level)
        ? pmcTierAfterRaid
        : null;

    const failureMitigation = success ? 0 : Math.floor(bet * (gearBonus.defenseBoost + pmcBuffs.defenseBonus) * 0.7);
    if (failureMitigation > 0) addTokens(userId, failureMitigation);
    const baseRewardTokens = rewardTokens;
    const outcomeBonusTokens = reward.tokens;
    const net = baseRewardTokens + outcomeBonusTokens + bossTokenBonus + failureMitigation - bet;
    user.raidHistory.unshift({
        timestamp: now,
        tension,
        map: mapCfg.label,
        condition: gearBonus.negatedCondition ? `${condition.label} (Negated)` : condition.label,
        bet,
        success,
        rewardTokens: baseRewardTokens + outcomeBonusTokens + bossTokenBonus,
        net,
        rxpGain,
        bossSpawned,
        bossDefeated,
        bossName: bossSpawned ? (boss?.name || mapCfg.bossName) : undefined,
        bossBonusXp,
        loot,
        successChance: Math.round(finalSuccessChance * 100)
    });
    if (user.raidHistory.length > 12) user.raidHistory = user.raidHistory.slice(0, 12);
    savePoints();
    recordGameResult(userId, "raid", success ? "win" : "loss", bet, rewardTokens + reward.tokens + bossTokenBonus + failureMitigation);
    appendAuditEvent("raid_result", {
        userId,
        map: mapCfg.label,
        mapDifficulty: mapCfg.difficulty,
        selectedWeaponId: gearBonus.weapon?.id || null,
        selectedArmorId: gearBonus.armor?.id || null,
        pmcBuffs,
        tension,
        condition: condition.label,
        bet,
        success,
        bossSpawned,
        bossDefeated,
        bossName: boss?.name || mapCfg.bossName,
        bossTitle: boss?.title || null,
        bossFerocity: boss?.ferocity || 0,
        bossSpawnChance: Math.round(bossSpawnChance * 100),
        bossKillChance: Math.round(bossKillChance * 100),
        bossBonusXp,
        bossTokenBonus,
        progressionScale,
        baseRaidXpGain,
        scaledRaidXpGain,
        net,
        raidXp: rxpGain,
        pmcXP: user.pmcXP,
        pmcLevel: pmcLevelAfterRaid,
        pmcTierUnlockedLevel: pmcTierUnlocked?.level || null,
        pmcTierUnlockedLabel: pmcTierUnlocked?.label || null
    });

    return {
        success,
        net,
        loot,
        rxpGain,
        successChance: Math.round(finalSuccessChance * 100),
        bet,
        mapLabel: mapCfg.label,
        mapDifficulty: mapCfg.difficulty,
        conditionLabel: condition.label,
        bossSpawned,
        bossDefeated,
        bossName: boss?.name || mapCfg.bossName,
        bossTitle: boss?.title,
        bossFerocity: boss?.ferocity,
        bossBonusXp,
        bossKillChance: Math.round(bossKillChance * 100),
        bossImageUrl: bossSpawned ? getBossPortraitUrl(boss?.name || mapCfg.bossName, boss?.title) || undefined : undefined,
        pmcHpMax: bossSpawned ? pmcHpMax : undefined,
        pmcHpRemaining: bossSpawned ? pmcHpRemaining : undefined,
        bossHpMax: bossSpawned ? bossHpMax : undefined,
        bossHpRemaining: bossSpawned ? bossHpRemaining : undefined,
        bossHeartUnlockedName,
        pmcTierUnlockedLabel: pmcTierUnlocked?.label,
        pmcTierUnlockedBadge: pmcTierUnlocked?.badge,
        selectedWeaponName: gearBonus.weapon?.name,
        selectedArmorName: gearBonus.armor?.name,
        baseRewardTokens,
        outcomeBonusTokens,
        bossBonusTokens: bossTokenBonus,
        failureMitigationTokens: failureMitigation,
        tension: `${tension} | ${condition.label}`,
        pmcXP: user.pmcXP,
        pmcLevel: pmcLevelAfterRaid
    };
}

function formatRaidHistory(userId: string): string {
    const history = ensureUser(userId).raidHistory.slice(0, 8);
    if (!history.length) return "No raids yet.";
    return history.map(entry => {
        const time = new Date(entry.timestamp).toLocaleString();
        const status = entry.success ? "Success" : "Fail";
        const map = entry.map ? ` | Map ${entry.map}` : "";
        const condition = entry.condition ? ` | Cond ${entry.condition}` : "";
        const boss = entry.bossSpawned
            ? ` | Boss ${entry.bossName || "Unknown"} ${entry.bossDefeated ? "defeated" : "engaged"}${entry.bossBonusXp ? ` (+${entry.bossBonusXp} XP)` : ""}`
            : "";
        return `* [${time}] ${status} ${entry.tension}${map}${condition}${boss} | Bet ${entry.bet} | Net ${entry.net} | Rxp +${entry.rxpGain}`;
    }).join("\n");
}

function buildRaidHistoryPayload(userId: string): string {
    const history = ensureUser(userId).raidHistory.slice(0, 8);
    if (!history.length) {
        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(0x334155)
                .setTitle("📜 Raid History")
                .setDescription("No raids logged yet. Deploy with `/raid` to start building your combat record.")
                .toJSON()
        });
    }

    const wins = history.filter(entry => entry.success).length;
    const net = history.reduce((sum, entry) => sum + entry.net, 0);
    const totalBossSpawns = history.filter(entry => entry.bossSpawned).length;
    const totalBossKills = history.filter(entry => entry.bossDefeated).length;
    const recentLines = history.map(entry => {
        const status = entry.success ? "✅" : "❌";
        const boss = entry.bossSpawned
            ? `${entry.bossName || "Unknown"}${entry.bossDefeated ? " • defeated" : " • escaped"}`
            : "No boss";
        return `${status} ${entry.map || "Unknown Map"} • ${entry.tension} • Net ${entry.net >= 0 ? `+${entry.net}` : entry.net} • XP +${entry.rxpGain}\n${boss}`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle("📜 Raid History Console")
        .setDescription("Recent mission log with extraction outcomes, boss encounters, and short-form economy performance.")
        .addFields(
            {
                name: "Recent Combat Snapshot",
                value: [
                    `Entries Loaded: ${history.length}`,
                    `Recent Wins: ${wins}/${history.length}`,
                    `Recent Net: ${net >= 0 ? `+${net}` : net} FN Token$`,
                    `Boss Contacts: ${totalBossSpawns} | Boss Kills: ${totalBossKills}`
                ].join("\n"),
                inline: false
            },
            ...chunkDetailLines(recentLines, 2).slice(0, 4).map((chunk, index) => ({
                name: index === 0 ? "Mission Log" : `Mission Log ${index + 1}`,
                value: chunk,
                inline: false
            }))
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

function buildBossRosterPayload(): string {
    const embed = new EmbedBuilder()
        .setColor(0xd97706)
        .setTitle("👑 Raid Boss Roster")
        .setDescription("Premium tactical index for all bosses, including home map, threat class, reward ranges, and rotation influence.")
        .addFields(
            {
                name: "Rotation Key",
                value: Object.values(RAID_MAPS).map(map => `${RAID_MAP_SHORT_LABELS[map.key]} = ${map.label}`).join("\n"),
                inline: false
            },
            {
                name: "Roster Summary",
                value: [
                    `Total Bosses: ${RAID_BOSS_ROSTER.length}`,
                    `Maps Covered: ${Object.keys(RAID_MAPS).length}`,
                    `Highest Threat: ${Math.max(...RAID_BOSS_ROSTER.map(boss => boss.ferocity)).toFixed(2)} ferocity`
                ].join("\n"),
                inline: false
            }
        );

    for (const boss of RAID_BOSS_ROSTER) {
        const portraitUrl = getBossPortraitUrl(boss.name, boss.title);
        embed.addFields({
            name: `${boss.name} (${boss.title})`,
            value: [
                `Home Map: ${boss.homeMapLabel} (${boss.homeMapDifficulty})`,
                `Threat Class: ${boss.ferocity >= 2 ? "Cataclysmic" : boss.ferocity >= 1.7 ? "Apex" : boss.ferocity >= 1.35 ? "Brutal" : boss.ferocity >= 1 ? "Elite" : "Veteran"}`,
                `Ferocity: ${boss.ferocity.toFixed(2)} | Success Penalty: ${(boss.successPenalty * 100).toFixed(1)}% | Kill Penalty: ${(boss.killPenalty * 100).toFixed(1)}%`,
                `Boss XP: ${boss.bonusXpRange[0]}-${boss.bonusXpRange[1]} | Tokens: ${boss.tokenRewardRange[0]}-${boss.tokenRewardRange[1]} | Rare Drop: ${(boss.rareDropChance * 100).toFixed(1)}%`,
                `Drops: Wpn ${boss.weaponDrops.join(", ")} | Arm ${boss.armorDrops.join(", ")}`,
                `Map Rotation: ${formatBossRotationShares(boss)}`,
                `Portrait: ${portraitUrl ? `[View](${portraitUrl})` : "Unavailable"}`
            ].join("\n"),
            inline: false
        });
    }

    return JSON.stringify({ embed: embed.toJSON() });
}

function buildLeaderboardPayload(): string {
    const top = getLeaderboard();
    if (!top.length) {
        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(0x334155)
                .setTitle("🏆 XP Leaderboard")
                .setDescription("No leaderboard data yet.")
                .toJSON()
        });
    }

    const medals = ["🥇", "🥈", "🥉"];
    const topLines = top.slice(0, 10).map((row, idx) => {
        const medal = medals[idx] || `#${idx + 1}`;
        return `${medal} <@${row.id}>\nXP ${row.xp.toLocaleString()} • Prestige ${row.prestige}`;
    });
    const totalXp = top.reduce((sum, row) => sum + row.xp, 0);

    const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🏆 XP Command Board")
        .setDescription("Server-wide engagement progression standings with premium podium formatting.")
        .addFields(
            {
                name: "Leaderboard Snapshot",
                value: [
                    `Tracked Players: ${top.length}`,
                    `Total XP Across Board: ${totalXp.toLocaleString()}`,
                    `Top Rank XP: ${top[0]?.xp?.toLocaleString() || 0}`
                ].join("\n"),
                inline: false
            },
            ...chunkDetailLines(topLines, 3).slice(0, 4).map((chunk, index) => ({
                name: index === 0 ? "Podium and Ranks" : `Podium and Ranks ${index + 1}`,
                value: chunk,
                inline: false
            }))
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

function buildPmcProfilePayload(user: User): string {
    const state = ensureUser(user.id);
    const gameStats = getGameStatsSummary(user.id);
    const progress = getPmcProgress(state.pmcXP);
    const buffs = getPmcBuffs(progress.level);
    const tier = getPmcTierForLevel(progress.level);
    const tierVisual = getPmcTierVisual(progress.level);
    const raids = Math.max(0, state.pmcRaids);
    const wins = Math.max(0, state.pmcRaidWins);
    const bossKills = Math.max(0, state.pmcBossKills || 0);
    const bossHeartNames = getUnlockedBossHeartNames(user.id);
    const bossHeartsUnlocked = bossHeartNames.length;
    const collectibleEntries = COLLECTIBLE_ITEM_IDS
        .map(id => ({ id, def: ITEM_DEFS[id], qty: getInventoryCount(user.id, id) }))
        .filter(entry => entry.def && entry.qty > 0)
        .sort((a, b) => b.qty - a.qty || a.def.name.localeCompare(b.def.name));
    const ownedCollectibles = collectibleEntries.length;
    const ownedUltraCollectibles = collectibleEntries.filter(entry => ULTRA_RARE_COLLECTIBLE_IDS.includes(entry.id as (typeof ULTRA_RARE_COLLECTIBLE_IDS)[number])).length;
    const collectibleValue = collectibleEntries.reduce((sum, entry) => sum + (getVendorSellPrice(entry.id) * entry.qty), 0);
    const collectibleLine = collectibleEntries.length
        ? collectibleEntries.slice(0, 6).map(entry => `${entry.def.name} x${entry.qty}`).join("\n")
        : "No collectibles found yet. Ultra-rare collectibles can only be found in raids.";
    const winRate = raids > 0 ? ((wins / raids) * 100).toFixed(1) : "0.0";
    const recentTrend = state.raidHistory.slice(0, 5).map(entry => entry.success ? "W" : "L").join(" ") || "No recent raids";
    const thresholdLine = progress.capped
        ? `Final tier reached (${PMC_LEVEL_CAP}).`
        : `${progress.intoLevel}/${Math.max(1, progress.nextThreshold - progress.currentThreshold)} XP in level | ${progress.needForNext} XP to next level`;
    const prestigeLine = progress.capped
        ? "🌌 Mythic Overlord achieved."
        : tier
            ? `${tier.badge} ${tier.label} unlocked at Level ${tier.level}.`
            : "Tier badge unlocks at Level 1000.";
    const tierProgressLine = tier
        ? `${tier.badge} ${tier.label} (Lvl ${tier.level})`
        : "No badge yet";

    const embed = new EmbedBuilder()
        .setColor(tierVisual.color)
        .setTitle(progress.capped ? "🪖 PMC Progression • 👑" : "🪖 PMC Progression")
        .setDescription("Persistent raid profile with milestone progression, combat buffs, and first-kill trophy tracking.")
        .setAuthor({ name: `${user.username} · Army Profile`, iconURL: tierVisual.iconUrl })
        .setThumbnail(tierVisual.iconUrl)
        .addFields(
            {
                name: "Profile Header",
                value: [
                    `Level: ${progress.level}/${PMC_LEVEL_CAP}`,
                    `Raid XP: ${state.pmcXP}`,
                    `Win Rate: ${winRate}%`,
                    `Recent Form: ${recentTrend}`
                ].join("\n"),
                inline: false
            },
            { name: "Milestone Badge", value: tierProgressLine, inline: true },
            { name: "Badge Visual", value: tierVisual.label, inline: true },
            { name: "Tier Status", value: prestigeLine, inline: true },
            { name: "Raid Standing", value: `Raids ${raids} | Wins ${wins} | Boss Kills ${bossKills}`, inline: true },
            { name: "Progress Track", value: `${pmcBar(state.pmcXP)}\n${thresholdLine}`, inline: false },
            {
                name: "Combat Buff Matrix",
                value: [
                    `Success: +${(buffs.successBonus * 100).toFixed(2)}%`,
                    `Token Yield: +${(buffs.tokenBonus * 100).toFixed(2)}%`,
                    `Loss Mitigation: +${(buffs.defenseBonus * 100).toFixed(2)}%`,
                    `Raid XP Gain: +${(buffs.xpBonus * 100).toFixed(2)}%`
                ].join(" | "),
                inline: false
            },
            {
                name: "Boss Trophy Case",
                value: [
                    `Boss Kills: ${bossKills}`,
                    `First-Kill Hearts: ${bossHeartsUnlocked}`,
                    `Unlocked Hearts: ${bossHeartNames.length ? bossHeartNames.join(", ") : "None yet. Defeat a boss for your first heart trophy."}`
                ].join("\n"),
                inline: false
            },
            {
                name: "Collector Vault",
                value: [
                    `Owned: ${ownedCollectibles}/${COLLECTIBLE_ITEM_IDS.length}`,
                    `Ultra-Rare Owned: ${ownedUltraCollectibles}/${ULTRA_RARE_COLLECTIBLE_IDS.length}`,
                    `Vendor Value: ${collectibleValue.toLocaleString()} FN Token$`,
                    collectibleLine
                ].join("\n"),
                inline: false
            },
            {
                name: "Lifetime Raid Economy",
                value: `Wagered: ${gameStats.raid.wagered} | Payout: ${gameStats.raid.payout} | Net: ${gameStats.raid.net >= 0 ? `+${gameStats.raid.net}` : gameStats.raid.net} FN Token$`,
                inline: false
            }
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

function chunkDetailLines(lines: string[], maxLines = 8): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += maxLines) {
        chunks.push(lines.slice(i, i + maxLines).join("\n"));
    }
    return chunks;
}

function buildConditionsPayload(): string {
    const embed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("🌦️ Raid Conditions")
        .setDescription("Condition pressure is now clearer, milder on average, and some armor pieces can fully negate matching raid conditions.");

    for (const condition of RaidDomain.RAID_CONDITIONS) {
        const counters = Object.entries(RaidDomain.ARMOR_TRAITS)
            .filter(([, trait]) => trait?.conditionImmunity?.includes(condition.key))
            .map(([id]) => ITEM_DEFS[id]?.name || id);
        embed.addFields({
            name: condition.label,
            value: [
                condition.description,
                `Success Delta: ${(condition.successDelta * 100).toFixed(1)}%`,
                `Token Delta: ${(condition.tokenMultiplierDelta * 100).toFixed(1)}%`,
                `Raid XP Multiplier: ${condition.xpMultiplier.toFixed(2)}x`,
                `Full Counters: ${counters.length ? counters.join(", ") : "None"}`
            ].join("\n"),
            inline: false
        });
    }

    return JSON.stringify({ embed: embed.toJSON() });
}

function buildGearIntelPayload(kindRaw?: string | null, conditionRaw?: string | null): string {
    const kind = kindRaw === "weapon" || kindRaw === "armor" ? kindRaw : "all";
    const condition = RaidDomain.RAID_CONDITIONS.find(entry => entry.key === conditionRaw);
    const sections: Array<{ title: string; ids: string[]; traitSource: Partial<Record<string, RaidDomain.GearTrait>>; metric: "raidAttack" | "raidDefense" }> = [];

    if (kind === "all" || kind === "weapon") {
        sections.push({ title: "Weapons", ids: WEAPON_IDS, traitSource: RaidDomain.WEAPON_TRAITS, metric: "raidAttack" });
    }
    if (kind === "all" || kind === "armor") {
        sections.push({ title: "Armors", ids: ARMOR_IDS, traitSource: RaidDomain.ARMOR_TRAITS, metric: "raidDefense" });
    }

    const embed = new EmbedBuilder()
        .setColor(0xd97706)
        .setTitle("🧰 Gear Intel")
        .setDescription(condition
            ? `Filtered for ${condition.label}. Matching bonuses and full immunities are highlighted.`
            : "Raid gear stat directory with base bonuses and special trigger traits.");

    for (const section of sections) {
        const lines = section.ids.map(id => {
            const def = ITEM_DEFS[id];
            const trait = section.traitSource[id];
            const basePct = Math.round(((def?.[section.metric] || 0) as number) * 100);
            const condBonus = condition ? trait?.conditionSuccess?.[condition.key] || 0 : 0;
            const immunity = condition && trait?.conditionImmunity?.includes(condition.key) ? " | NEGATES" : "";
            const bonusText = condition && condBonus ? ` | ${condition.key} ${condBonus >= 0 ? "+" : ""}${(condBonus * 100).toFixed(1)}%` : "";
            return `[${rarityBadge(def?.rarity)}] ${def?.name || id} | Base ${section.metric === "raidAttack" ? `ATK +${basePct}%` : `DEF +${basePct}%`}${bonusText}${immunity}${trait?.note ? ` | ${trait.note}` : ""}`;
        });

        const chunks = chunkDetailLines(lines, 7);
        chunks.forEach((chunk, index) => {
            embed.addFields({
                name: index === 0 ? section.title : `${section.title} ${index + 1}`,
                value: chunk,
                inline: false
            });
        });
    }

    return JSON.stringify({ embed: embed.toJSON() });
}

function validateCasinoBet(userId: string, bet: number): string | null {
    if (bet < MIN_BET) return `Minimum bet is ${MIN_BET}.`;
    if (!canAffordTokens(userId, bet)) return `You need at least ${bet} FN Token$.`;
    return null;
}

function rollLuckyMultiplier(): { multiplier: number; label: string } {
    const r = Math.random();
    if (r < 0.18) return { multiplier: 0.7, label: "Cold 0.70x" };
    if (r < 0.4) return { multiplier: 0.85, label: "Low 0.85x" };
    if (r < 0.7) return { multiplier: 1.0, label: "Standard 1.0x" };
    if (r < 0.9) return { multiplier: 1.15, label: "Boost 1.15x" };
    if (r < 0.98) return { multiplier: 1.35, label: "Rare 1.35x" };
    if (r < 0.998) return { multiplier: 1.75, label: "Epic 1.75x" };
    if (r <= 1.0) return { multiplier: 2.5, label: "Legendary 2.5x" };
    return { multiplier: 1.0, label: "Standard 1.0x" };
}

type CasinoOutcome = "win" | "loss" | "push";

function formatTokenAmount(value: number): string {
    return `${value} FN Token$`;
}

function formatNetAmount(value: number): string {
    return `${value >= 0 ? `+${value}` : value} FN Token$`;
}

function getCasinoOddsSnapshot(gameKey: Exclude<GameStatKey, "raid">): string {
    if (gameKey === "dice") return "Exact number pays highest (5.00x base), range calls are safer (2.00x base).";
    if (gameKey === "roulette") return "Number call is highest variance (36.00x base), color/parity offers steadier hit rates (2.00x base).";
    if (gameKey === "blackjack") return "Safe style lowers bust risk, aggressive style raises upside volatility.";
    if (gameKey === "crash") return "Lower targets cash more often, higher targets spike multiplier but fail more often.";
    if (gameKey === "magicslots") return "Magic Slots uses enchanted paylines, rare jackpot arcs, and bonus-round multipliers that can trigger at 2x, 5x, or 10x.";
    if (gameKey === "coinflip") return "Pure 50/50 call before lucky modifier influence.";
    if (gameKey === "baccarat") return "Tie has the largest payout but lowest consistency; player/banker are steadier.";
    if (gameKey === "hilo") return "Large card-distance wins pay more; close outcomes are safer but lower yield.";
    return "More picks reduce hit chance but can unlock larger multiplier ladders.";
}

function getCasinoRiskBand(bet: number, walletBefore: number): string {
    const base = Math.max(1, walletBefore);
    const ratio = bet / base;
    if (ratio >= 0.4) return "High";
    if (ratio >= 0.2) return "Medium";
    return "Low";
}

function buildCasinoStatLine(userId: string, gameKey: Exclude<GameStatKey, "raid">): string {
    const user = ensureUser(userId);
    const gameStats = user.gameStats[gameKey];
    const wr = gameStats.played > 0 ? ((gameStats.wins / gameStats.played) * 100).toFixed(1) : "0.0";
    return [
        `Mode: ${gameKey.toUpperCase()}`,
        `W/L/P: ${gameStats.wins}/${gameStats.losses}/${gameStats.pushes}`,
        `Win Rate: ${wr}%`,
        `Lifetime Net: ${formatNetAmount(gameStats.net)}`
    ].join(" | ");
}

function buildCasinoSessionLine(userId: string): string {
    const stats = getGameStatsSummary(userId);
    return [
        `Sessions: ${stats.casinoPlayed}`,
        `Total W/L/P: ${stats.wins}/${stats.losses}/${stats.pushes}`,
        `Total Wagered: ${formatTokenAmount(stats.wagered)}`,
        `Total Net: ${formatNetAmount(stats.net)}`
    ].join(" | ");
}

function getCasinoOutcomePayload(outcome: CasinoOutcome): { color: number; label: string } {
    if (outcome === "win") return { color: 0x00ff00, label: "WIN" };
    if (outcome === "push") return { color: 0xffff00, label: "PUSH" };
    return { color: 0xff0000, label: "LOSS" };
}

function getNextCasinoGame(gameKey: CasinoGameKey): CasinoGameKey {
    const idx = CASINO_GAME_ORDER.indexOf(gameKey);
    if (idx < 0) return "dice";
    return CASINO_GAME_ORDER[(idx + 1) % CASINO_GAME_ORDER.length];
}

function defaultCasinoArgForGame(gameKey: CasinoGameKey): string {
    if (gameKey === "dice") return "low";
    if (gameKey === "roulette") return "red";
    if (gameKey === "blackjack") return "safe";
    if (gameKey === "crash") return "1.50";
    if (gameKey === "magicslots") return "single";
    if (gameKey === "coinflip") return "heads";
    if (gameKey === "baccarat") return "player";
    if (gameKey === "hilo") return "higher";
    return "3,8,11,24";
}

function sanitizeCasinoActionArg(value: string): string {
    return String(value || "")
        .replace(/\s+/g, "")
        .replace(/[:]/g, "")
        .slice(0, 36);
}

function buildCasinoActionCustomIdForUser(action: CasinoActionKind, gameKey: CasinoGameKey, bet: number, userId: string, arg: string): string {
    const safeBet = Math.max(1, Math.floor(bet));
    const safeArg = sanitizeCasinoActionArg(arg || defaultCasinoArgForGame(gameKey));
    const safeUserId = String(userId || "0").replace(/\D/g, "").slice(0, 24) || "0";
    return `${CASINO_UI_IDS.prefix}:${action}:${gameKey}:${safeBet}:${safeUserId}:${safeArg}`;
}

function parseCasinoActionCustomId(customId: string): {
    action: CasinoActionKind;
    gameKey: CasinoGameKey;
    bet: number;
    ownerId: string;
    arg: string;
} | null {
    const parts = customId.split(":");
    if (parts.length < 6) return null;
    if (parts[0] !== CASINO_UI_IDS.prefix) return null;
    const action = parts[1] as CasinoActionKind;
    const gameKey = parts[2] as CasinoGameKey;
    const bet = Math.max(1, Math.floor(Number.parseInt(parts[3], 10) || 1));
    const ownerId = String(parts[4] || "").replace(/\D/g, "");
    const arg = sanitizeCasinoActionArg(parts.slice(5).join(":"));
    if (!["replay", "double", "half", "switch"].includes(action)) return null;
    if (!CASINO_GAME_ORDER.includes(gameKey)) return null;
    if (!ownerId) return null;
    return { action, gameKey, bet, ownerId, arg };
}

function buildCasinoActionComponents(meta: { userId: string; gameKey: CasinoGameKey; bet: number; arg: string }): Array<ReturnType<ActionRowBuilder<ButtonBuilder>["toJSON"]>> {
    const nextGame = getNextCasinoGame(meta.gameKey);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(buildCasinoActionCustomIdForUser("replay", meta.gameKey, meta.bet, meta.userId, meta.arg))
            .setLabel("Replay")
            .setEmoji("🔁")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(buildCasinoActionCustomIdForUser("double", meta.gameKey, meta.bet, meta.userId, meta.arg))
            .setLabel("Double Bet")
            .setEmoji("⚔️")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(buildCasinoActionCustomIdForUser("half", meta.gameKey, meta.bet, meta.userId, meta.arg))
            .setLabel("Half Bet")
            .setEmoji("🛡️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(buildCasinoActionCustomIdForUser("switch", meta.gameKey, meta.bet, meta.userId, meta.arg))
            .setLabel(`Switch Game -> ${nextGame}`)
            .setEmoji("🧭")
            .setStyle(ButtonStyle.Secondary)
    );
    return [row.toJSON()];
}

function formatCasinoResult(options: {
    userId: string;
    gameKey: Exclude<GameStatKey, "raid">;
    gameIcon: string;
    gameName: string;
    outcome: CasinoOutcome;
    bet: number;
    payout: number;
    walletBefore: number;
    walletAfter: number;
    luckyLabel?: string;
    details?: Array<{ label: string; value: string }>;
    notes?: string[];
    sections?: Array<{ title: string; value: string }>;
    actionMeta?: { bet: number; arg: string };
}): string {
    const net = options.payout - options.bet;
    const outcomePayload = getCasinoOutcomePayload(options.outcome);
    const riskBand = getCasinoRiskBand(options.bet, options.walletBefore);
    const oddsSnapshot = getCasinoOddsSnapshot(options.gameKey);
    const detailLines = (options.details || []).map(detail => `• ${detail.label}: ${detail.value}`);
    const notes = options.notes?.length
        ? options.notes
        : options.outcome === "loss"
            ? ["Reduce risk size or move to lower-variance calls for steadier bankroll control."]
            : ["Bank partial gains to protect long-run bankroll consistency."];

    const embed = new EmbedBuilder()
        .setColor(outcomePayload.color)
        .setTitle(`${options.gameIcon} ${options.gameName} • ${outcomePayload.label}`)
        .setDescription([
            "Casino round summary with direct payout and bankroll telemetry.",
            "Outcome colors: WIN=green, LOSS=red, PUSH=yellow."
        ].join("\n"))
        .addFields(
            {
                name: "Round Ledger",
                value: [
                    `Bet: ${formatTokenAmount(options.bet)}`,
                    `Payout: ${formatTokenAmount(options.payout)}`,
                    `Net: ${formatNetAmount(net)}`,
                    `Wallet: ${formatTokenAmount(options.walletBefore)} -> ${formatTokenAmount(options.walletAfter)}`,
                    `Risk Band: ${riskBand}`,
                    `Lucky Multiplier: ${options.luckyLabel || "Standard 1.0x"}`
                ].join("\n"),
                inline: true
            },
            {
                name: "Performance Intel",
                value: [
                    oddsSnapshot,
                    buildCasinoStatLine(options.userId, options.gameKey),
                    buildCasinoSessionLine(options.userId)
                ].join("\n"),
                inline: false
            }
        );

    if (detailLines.length) {
        const chunks = chunkLines(detailLines, 950).slice(0, 2);
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? "Round Breakdown" : `Round Breakdown ${i + 1}`,
                value: chunks[i],
                inline: false
            });
        }
    }

    if (notes.length) {
        embed.addFields({ name: "Round Notes", value: notes.map(note => `• ${note}`).join("\n"), inline: false });
    }

    for (const section of options.sections || []) {
        embed.addFields({ name: section.title, value: section.value, inline: false });
    }

    const payload: { embed: APIEmbed; components?: Array<ReturnType<ActionRowBuilder<ButtonBuilder>["toJSON"]>> } = {
        embed: embed.toJSON()
    };
    if (options.actionMeta) {
        payload.components = buildCasinoActionComponents({
            userId: options.userId,
            gameKey: options.gameKey,
            bet: Math.max(1, Math.floor(options.actionMeta.bet)),
            arg: sanitizeCasinoActionArg(options.actionMeta.arg || defaultCasinoArgForGame(options.gameKey))
        });
    }
    return JSON.stringify(payload);
}

function magicSlotSymbolEmoji(symbol: MagicSlotSymbol): string {
    if (symbol === "WAND") return "🪄";
    if (symbol === "POTION") return "🧪";
    if (symbol === "DRAGON") return "🐉";
    if (symbol === "SPELLBOOK") return "📘";
    if (symbol === "CRYSTAL") return "🔮";
    return "✨";
}

function formatMagicSlotsResult(options: {
    userId: string;
    outcome: CasinoOutcome;
    bet: number;
    payout: number;
    walletBefore: number;
    walletAfter: number;
    luckyLabel: string;
    boardRows: string[];
    winningLines: Array<{ pattern: string; emojiLine: string; multiplier: number; rule: string }>;
    baseMultiplier: number;
    totalBonusHits: number;
    totalHits: number;
    jackpotRows: number;
    scaledMultiplier: number;
    ultraBonusMode: boolean;
    totalBonusSymbols: number;
    scatterMultiplier: number;
}): string {
    const outcomePayload = getCasinoOutcomePayload(options.outcome);
    const net = options.payout - options.bet;
    const resultLabel = options.jackpotRows > 0 && options.outcome === "win"
        ? "JACKPOT"
        : options.outcome.toUpperCase();
    const resultEmoji = options.jackpotRows > 0 && options.outcome === "win"
        ? "💥"
        : options.outcome === "win"
            ? "✅"
            : options.outcome === "push"
                ? "🟨"
                : "❌";
    const heatScore = options.baseMultiplier + (options.totalHits * 0.65) + (options.totalBonusSymbols * 0.35);
    const reelHeat = heatScore >= 7 ? "🔥" : heatScore >= 3.4 ? "⚡" : "🧊";
    const modeTag = options.ultraBonusMode ? "✨ ULTRA BONUS" : "🎰 STANDARD";
    const winSummary = options.winningLines.length
        ? options.winningLines
            .slice(0, 4)
            .map(win => `• ${win.pattern} ${win.emojiLine}  ${win.multiplier.toFixed(2)}x`)
            .join("\n")
        : "• No line hit";

    const embed = new EmbedBuilder()
        .setColor(outcomePayload.color)
        .setTitle(`${resultEmoji} Magic Slots • ${resultLabel}`)
        .setDescription(`${modeTag}  ${reelHeat}  ✨x${options.totalBonusSymbols}`)
        .addFields(
            {
                name: "💰 Spin",
                value: [
                    `Bet: ${formatTokenAmount(options.bet)}`,
                    `Win: ${formatTokenAmount(options.payout)}`,
                    `Net: ${formatNetAmount(net)}`,
                    `Bank: ${formatTokenAmount(options.walletAfter)}`,
                    `Lines: ${options.winningLines.length}/${options.totalHits}`,
                    `Bonus: ${options.totalBonusHits}  |  Jackpot: ${options.jackpotRows}`,
                    `Scatter: ${options.scatterMultiplier > 0 ? `${options.scatterMultiplier.toFixed(2)}x` : "-"}`
                ].join("\n"),
                inline: false
            },
            {
                name: "🎛️ Reels",
                value: `\`\`\`\n${options.boardRows.join("\n")}\n\`\`\``,
                inline: false
            },
            {
                name: "🏆 Winning Lines",
                value: winSummary,
                inline: false
            }
        )
        .setFooter({ text: buildCasinoSessionLine(options.userId) })
        .setTimestamp(new Date());

    return JSON.stringify({
        embed: embed.toJSON(),
        components: buildCasinoActionComponents({
            userId: options.userId,
            gameKey: "magicslots",
            bet: Math.max(1, Math.floor(options.bet)),
            arg: "single"
        })
    });
}

function playDice(userId: string, bet: number, choice: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const roll = Math.floor(Math.random() * 6) + 1;
    const c = choice.toLowerCase();
    const exact = c === roll.toString();
    const win = exact || (c === "high" && roll >= 4) || (c === "low" && roll <= 3) || (c === "odd" && roll % 2 === 1) || (c === "even" && roll % 2 === 0);
    if (!win) {
        recordGameResult(userId, "dice", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "dice",
            gameIcon: "🎲",
            gameName: "Dice",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Call", value: c },
                { label: "Roll", value: String(roll) },
                { label: "Target Bands", value: "Low=1-3 | High=4-6 | Odd/Even parity" }
            ],
            notes: ["Exact number calls are high volatility. Use parity calls for steadier hit rates."],
            actionMeta: { bet, arg: c }
        });
    }

    const lucky = rollLuckyMultiplier();
    const baseMultiplier = exact ? 5 : 2;
    const payout = Math.max(1, Math.floor(bet * baseMultiplier * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "dice", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "dice",
        gameIcon: "🎲",
        gameName: "Dice",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Call", value: c },
            { label: "Roll", value: String(roll) },
            { label: "Base Multiplier", value: `${baseMultiplier.toFixed(2)}x` }
        ],
        notes: ["Protect upside by banking a share of win streak payouts."],
        actionMeta: { bet, arg: c }
    });
}

function playRoulette(userId: string, bet: number, choice: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const number = Math.floor(Math.random() * 37);
    const color = number === 0 ? "green" : number % 2 === 0 ? "black" : "red";
    const c = choice.toLowerCase();
    let payoutMultiplier = 0;
    if (c === color) payoutMultiplier = color === "green" ? 14 : 2;
    else if (c === "odd" && number % 2 === 1) payoutMultiplier = 2;
    else if (c === "even" && number % 2 === 0 && number !== 0) payoutMultiplier = 2;
    else if (!Number.isNaN(Number.parseInt(c, 10)) && Number.parseInt(c, 10) === number) payoutMultiplier = 36;

    if (payoutMultiplier <= 0) {
        recordGameResult(userId, "roulette", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "roulette",
            gameIcon: "🎡",
            gameName: "Roulette",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Call", value: c },
                { label: "Landed", value: `${number} (${color})` }
            ],
            notes: ["Color/parity calls have lower variance than exact number calls."],
            actionMeta: { bet, arg: c }
        });
    }

    const lucky = rollLuckyMultiplier();
    const payout = Math.max(1, Math.floor(bet * payoutMultiplier * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "roulette", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "roulette",
        gameIcon: "🎡",
        gameName: "Roulette",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Call", value: c },
            { label: "Landed", value: `${number} (${color})` },
            { label: "Base Multiplier", value: `${payoutMultiplier.toFixed(2)}x` }
        ],
        actionMeta: { bet, arg: c }
    });
}

function playBlackjack(userId: string, bet: number, style: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const values = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const deck: string[] = [];
    for (const v of values) for (let i = 0; i < 4; i++) deck.push(v);
    const draw = () => deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
    const handValue = (hand: string[]) => {
        let total = 0;
        let aces = 0;
        for (const card of hand) {
            if (["J", "Q", "K"].includes(card)) total += 10;
            else if (card === "A") { total += 11; aces += 1; }
            else total += Number.parseInt(card, 10);
        }
        while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
        return total;
    };

    const player = [draw(), draw()];
    const dealer = [draw(), draw()];
    while (handValue(player) < (style === "aggressive" ? 18 : 16)) player.push(draw());
    while (handValue(dealer) < 17) dealer.push(draw());

    const p = handValue(player);
    const d = handValue(dealer);
    if (p > 21) {
        recordGameResult(userId, "blackjack", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "blackjack",
            gameIcon: "🃏",
            gameName: "Blackjack",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Style", value: style },
                { label: "Player", value: `${player.join(" ")} (${p})` },
                { label: "Dealer", value: `${dealer.join(" ")} (${d})` }
            ],
            notes: ["Safe style (stand threshold 16) lowers bust frequency compared to aggressive style."],
            actionMeta: { bet, arg: style }
        });
    }

    if (p === d) {
        addTokens(userId, bet);
        recordGameResult(userId, "blackjack", "push", bet, bet);
        return formatCasinoResult({
            userId,
            gameKey: "blackjack",
            gameIcon: "🃏",
            gameName: "Blackjack",
            outcome: "push",
            bet,
            payout: bet,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Style", value: style },
                { label: "Player", value: `${player.join(" ")} (${p})` },
                { label: "Dealer", value: `${dealer.join(" ")} (${d})` }
            ],
            notes: ["Push refunded your stake."],
            actionMeta: { bet, arg: style }
        });
    }

    if (d > 21 || p > d) {
        const lucky = rollLuckyMultiplier();
        const payout = Math.max(1, Math.floor(bet * 1.9 * lucky.multiplier));
        addTokens(userId, payout);
        recordGameResult(userId, "blackjack", "win", bet, payout);
        return formatCasinoResult({
            userId,
            gameKey: "blackjack",
            gameIcon: "🃏",
            gameName: "Blackjack",
            outcome: "win",
            bet,
            payout,
            walletBefore,
            walletAfter: getTokens(userId),
            luckyLabel: lucky.label,
            details: [
                { label: "Style", value: style },
                { label: "Player", value: `${player.join(" ")} (${p})` },
                { label: "Dealer", value: `${dealer.join(" ")} (${d})` },
                { label: "Base Multiplier", value: "1.90x" }
            ],
            actionMeta: { bet, arg: style }
        });
    }

    recordGameResult(userId, "blackjack", "loss", bet, 0);
    return formatCasinoResult({
        userId,
        gameKey: "blackjack",
        gameIcon: "🃏",
        gameName: "Blackjack",
        outcome: "loss",
        bet,
        payout: 0,
        walletBefore,
        walletAfter: getTokens(userId),
        details: [
            { label: "Style", value: style },
            { label: "Player", value: `${player.join(" ")} (${p})` },
            { label: "Dealer", value: `${dealer.join(" ")} (${d})` }
        ],
        actionMeta: { bet, arg: style }
    });
}

type MagicSlotSymbol = "WAND" | "POTION" | "DRAGON" | "SPELLBOOK" | "CRYSTAL" | "BONUS";
type MagicPatternKind = "straight" | "zigzag";

const MAGIC_SLOT_REELS = 6;
const MAGIC_SLOT_ROWS = 6;
const MAGIC_SLOT_RETURN_SCALE = 0.25;
const MAGIC_SLOT_MAX_PAID_PATTERNS = 3;
const MAGIC_SLOT_ULTRA_MAX_PAID_PATTERNS = 4;
const MAGIC_SLOT_BONUS_ROW_JACKPOT_MULTIPLIER = 220;
const MAGIC_SLOT_ULTRA_BONUS_ROW_JACKPOT_MULTIPLIER = 1500;
const MAGIC_SLOT_ZIGZAG_PAYOUT_FACTOR = 0.88;
const MAGIC_SLOT_PAYTABLE: Record<Exclude<MagicSlotSymbol, "BONUS">, Record<3 | 4 | 5 | 6, number>> = {
    WAND: { 3: 0.28, 4: 0.9, 5: 2.8, 6: 7 },
    POTION: { 3: 0.36, 4: 1.2, 5: 3.8, 6: 9.5 },
    SPELLBOOK: { 3: 0.48, 4: 1.7, 5: 5.6, 6: 13.5 },
    CRYSTAL: { 3: 0.72, 4: 2.6, 5: 8.9, 6: 22 },
    DRAGON: { 3: 1.2, 4: 4.8, 5: 17, 6: 68 }
};
const MAGIC_SLOT_REEL_TABLES: Array<Array<{ symbol: MagicSlotSymbol; weight: number }>> = [
    [
        { symbol: "WAND", weight: 40 },
        { symbol: "POTION", weight: 30 },
        { symbol: "SPELLBOOK", weight: 20 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 4 },
        { symbol: "BONUS", weight: 0.9 }
    ],
    [
        { symbol: "WAND", weight: 38 },
        { symbol: "POTION", weight: 31 },
        { symbol: "SPELLBOOK", weight: 19 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 4 },
        { symbol: "BONUS", weight: 0.95 }
    ],
    [
        { symbol: "WAND", weight: 36 },
        { symbol: "POTION", weight: 31 },
        { symbol: "SPELLBOOK", weight: 20 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 5 },
        { symbol: "BONUS", weight: 1.05 }
    ],
    [
        { symbol: "WAND", weight: 36 },
        { symbol: "POTION", weight: 30 },
        { symbol: "SPELLBOOK", weight: 20 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 5 },
        { symbol: "BONUS", weight: 1.05 }
    ],
    [
        { symbol: "WAND", weight: 37 },
        { symbol: "POTION", weight: 30 },
        { symbol: "SPELLBOOK", weight: 19 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 5 },
        { symbol: "BONUS", weight: 0.95 }
    ],
    [
        { symbol: "WAND", weight: 39 },
        { symbol: "POTION", weight: 29 },
        { symbol: "SPELLBOOK", weight: 19 },
        { symbol: "CRYSTAL", weight: 10 },
        { symbol: "DRAGON", weight: 4 },
        { symbol: "BONUS", weight: 0.9 }
    ]
];
const MAGIC_SLOT_PATTERNS: Array<{ name: string; kind: MagicPatternKind; path: number[] }> = [
    { name: "Runic Row 1", kind: "straight", path: [0, 0, 0, 0, 0, 0] },
    { name: "Runic Row 2", kind: "straight", path: [1, 1, 1, 1, 1, 1] },
    { name: "Runic Row 3", kind: "straight", path: [2, 2, 2, 2, 2, 2] },
    { name: "Runic Row 4", kind: "straight", path: [3, 3, 3, 3, 3, 3] },
    { name: "Runic Row 5", kind: "straight", path: [4, 4, 4, 4, 4, 4] },
    { name: "Runic Row 6", kind: "straight", path: [5, 5, 5, 5, 5, 5] },
    { name: "Storm Weave 1", kind: "zigzag", path: [0, 1, 0, 1, 0, 1] },
    { name: "Storm Weave 2", kind: "zigzag", path: [1, 2, 1, 2, 1, 2] },
    { name: "Storm Weave 3", kind: "zigzag", path: [2, 3, 2, 3, 2, 3] },
    { name: "Storm Weave 4", kind: "zigzag", path: [3, 4, 3, 4, 3, 4] },
    { name: "Storm Weave 5", kind: "zigzag", path: [4, 5, 4, 5, 4, 5] },
    { name: "Arcane Crown", kind: "zigzag", path: [0, 1, 2, 1, 0, 1] }
];

function spinMagicSlotSymbol(reelIndex: number): MagicSlotSymbol {
    const table = MAGIC_SLOT_REEL_TABLES[reelIndex] || MAGIC_SLOT_REEL_TABLES[0];
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of table) {
        roll -= entry.weight;
        if (roll <= 0) return entry.symbol;
    }
    return "POTION";
}

function getMagicSlotSymbolBoost(symbol: Exclude<MagicSlotSymbol, "BONUS">): number {
    if (symbol === "DRAGON") return 1.06;
    if (symbol === "CRYSTAL") return 1.04;
    if (symbol === "SPELLBOOK") return 1.02;
    if (symbol === "POTION") return 1.01;
    return 1;
}

function detectUltraBonusWinSpin(grid: MagicSlotSymbol[][], preliminaryWins: Array<{ streak: number; bonusHits: number }>): boolean {
    const totalBonusSymbols = grid.flat().filter(symbol => symbol === "BONUS").length;
    const bonusAssistedPremiumLine = preliminaryWins.some(win => win.streak >= 4 && win.bonusHits >= 1);
    return totalBonusSymbols >= 3 && bonusAssistedPremiumLine;
}

function getMagicSlotScatterMultiplier(totalBonusSymbols: number): number {
    if (totalBonusSymbols >= 6) return 7.0;
    if (totalBonusSymbols === 5) return 2.4;
    if (totalBonusSymbols === 4) return 0.9;
    if (totalBonusSymbols === 3) return 0.35;
    return 0;
}

function scoreMagicPattern(symbols: MagicSlotSymbol[], kind: MagicPatternKind): {
    hit: boolean;
    streak: number;
    anchor: Exclude<MagicSlotSymbol, "BONUS"> | null;
    bonusHits: number;
    multiplier: number;
    rule: string;
    jackpot: boolean;
} {
    const allBonus = symbols.every(symbol => symbol === "BONUS");
    if (allBonus) {
        return {
            hit: true,
            streak: MAGIC_SLOT_REELS,
            anchor: null,
            bonusHits: MAGIC_SLOT_REELS,
            multiplier: MAGIC_SLOT_BONUS_ROW_JACKPOT_MULTIPLIER,
            rule: "full-bonus jackpot row",
            jackpot: true
        };
    }

    let anchor: Exclude<MagicSlotSymbol, "BONUS"> | null = null;
    let streak = 0;
    let bonusHits = 0;

    for (const symbol of symbols) {
        if (symbol === "BONUS") {
            streak += 1;
            bonusHits += 1;
            continue;
        }

        if (!anchor) {
            anchor = symbol;
            streak += 1;
            continue;
        }

        if (symbol === anchor) {
            streak += 1;
            continue;
        }

        break;
    }

    if (!anchor || streak < 3) {
        return {
            hit: false,
            streak,
            anchor,
            bonusHits,
            multiplier: 0,
            rule: "no_match",
            jackpot: false
        };
    }

    const payoutKey = Math.min(6, Math.max(3, streak)) as 3 | 4 | 5 | 6;
    let base = MAGIC_SLOT_PAYTABLE[anchor][payoutKey];
    let rule = `${payoutKey}-${anchor.toLowerCase()} ${kind}`;

    if (kind === "zigzag") {
        base *= MAGIC_SLOT_ZIGZAG_PAYOUT_FACTOR;
    }

    const symbolBoost = getMagicSlotSymbolBoost(anchor);
    const bonusBoost = bonusHits > 0 ? 1 + (bonusHits * 0.06) : 1;
    return {
        hit: true,
        streak,
        anchor,
        bonusHits,
        multiplier: base * symbolBoost * bonusBoost,
        rule,
        jackpot: false
    };
}

function buildCrashMeter(target: number, crashPoint: number): string {
    const max = 10;
    const width = 12;
    const targetPos = Math.max(0, Math.min(width - 1, Math.round((target / max) * (width - 1))));
    const crashPos = Math.max(0, Math.min(width - 1, Math.round((crashPoint / max) * (width - 1))));
    const cells: string[] = [];
    for (let i = 0; i < width; i++) {
        if (i === targetPos && i === crashPos) cells.push("🎯");
        else if (i === targetPos) cells.push("T");
        else if (i === crashPos) cells.push("X");
        else cells.push("-");
    }
    return `[${cells.join("")}]`;
}

function playSlots(userId: string, bet: number): string {
    const totalBet = bet;
    const betError = validateCasinoBet(userId, totalBet);
    if (betError) return betError;

    const walletBefore = getTokens(userId);
    removeTokens(userId, totalBet);

    const machineGrid: MagicSlotSymbol[][] = Array.from({ length: MAGIC_SLOT_ROWS }, () =>
        Array.from({ length: MAGIC_SLOT_REELS }, (_, reelIndex) => spinMagicSlotSymbol(reelIndex))
    );
    const totalBonusSymbols = machineGrid.flat().filter(symbol => symbol === "BONUS").length;

    const activePatterns = MAGIC_SLOT_PATTERNS;
    const preliminaryWins: Array<{ streak: number; bonusHits: number }> = [];
    for (const pattern of activePatterns) {
        const lineSymbols = pattern.path.map((rowIndex, reelIndex) => machineGrid[rowIndex]?.[reelIndex] || "WAND");
        const scored = scoreMagicPattern(lineSymbols, pattern.kind);
        if (!scored.hit || scored.multiplier <= 0) continue;
        preliminaryWins.push({ streak: scored.streak, bonusHits: scored.bonusHits });
    }

    const ultraBonusMode = detectUltraBonusWinSpin(machineGrid, preliminaryWins);
    const lineWins: Array<{ pattern: string; symbols: string; multiplier: number; rule: string; streak: number; bonusHits: number }> = [];
    let jackpotRows = 0;

    for (const pattern of activePatterns) {
        const lineSymbols = pattern.path.map((rowIndex, reelIndex) => machineGrid[rowIndex]?.[reelIndex] || "WAND");
        const scored = scoreMagicPattern(lineSymbols, pattern.kind);
        if (!scored.hit || scored.multiplier <= 0) continue;
        let effectiveMultiplier = scored.multiplier;
        let effectiveRule = scored.rule;

        if (scored.jackpot && ultraBonusMode) {
            effectiveMultiplier = MAGIC_SLOT_ULTRA_BONUS_ROW_JACKPOT_MULTIPLIER;
            effectiveRule = "ultra bonus jackpot row";
            jackpotRows += 1;
        } else if (scored.jackpot) {
            jackpotRows += 1;
        } else if (ultraBonusMode) {
            if (scored.anchor === "DRAGON" && scored.streak >= 6 && scored.bonusHits >= 1) {
                effectiveMultiplier = pattern.kind === "straight" ? 320 : 250;
                effectiveRule = pattern.kind === "straight" ? "ultra dragon line" : "ultra dragon weave";
            } else if (scored.anchor === "CRYSTAL" && scored.streak >= 6 && scored.bonusHits >= 1) {
                effectiveMultiplier = pattern.kind === "straight" ? 110 : 82;
                effectiveRule = pattern.kind === "straight" ? "ultra prism line" : "ultra prism weave";
            }
        }

        lineWins.push({
            pattern: pattern.name,
            symbols: lineSymbols.join(" | "),
            multiplier: effectiveMultiplier,
            rule: effectiveRule,
            streak: scored.streak,
            bonusHits: scored.bonusHits
        });
    }

    const paidLineLimit = ultraBonusMode ? MAGIC_SLOT_ULTRA_MAX_PAID_PATTERNS : MAGIC_SLOT_MAX_PAID_PATTERNS;
    const paidWins = [...lineWins]
        .sort((a, b) => b.multiplier - a.multiplier)
        .slice(0, paidLineLimit);
    const baseMultiplier = paidWins.reduce((sum, win) => sum + win.multiplier, 0);
    const totalBonusHits = paidWins.reduce((sum, win) => sum + win.bonusHits, 0);
    const scatterMultiplier = getMagicSlotScatterMultiplier(totalBonusSymbols);

    const totalMultiplier = Math.max(0, baseMultiplier + scatterMultiplier);
    const scaledMultiplier = totalMultiplier * MAGIC_SLOT_RETURN_SCALE;
    const payout = totalMultiplier > 0 ? Math.max(1, Math.floor(totalBet * scaledMultiplier)) : 0;
    if (payout > 0) addTokens(userId, payout);
    const outcome: CasinoOutcome = payout > totalBet ? "win" : payout === totalBet ? "push" : "loss";
    recordGameResult(userId, "magicslots", outcome, totalBet, payout);

    const boardRows = machineGrid.map((row, idx) => `R${idx + 1} ${row.map(symbol => `[${magicSlotSymbolEmoji(symbol)}]`).join("")}`);
    const winningEmojiLines = paidWins.map(win => ({
        pattern: win.pattern,
        emojiLine: win.symbols.split(" | ").map(symbol => magicSlotSymbolEmoji(symbol as MagicSlotSymbol)).join(" "),
        multiplier: win.multiplier,
        rule: win.rule
    }));

    return formatMagicSlotsResult({
        userId,
        outcome,
        bet: totalBet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: ultraBonusMode ? "Ultra Bonus Win Spin (3+ BONUS + bonus-assisted premium line)" : "Standard reel profile",
        boardRows,
        winningLines: winningEmojiLines,
        baseMultiplier,
        totalBonusHits,
        totalHits: lineWins.length,
        jackpotRows,
        scaledMultiplier,
        ultraBonusMode,
        totalBonusSymbols,
        scatterMultiplier
    });
}

function playCoinflip(userId: string, bet: number, side: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const pick = side.toLowerCase();
    if (!["heads", "tails"].includes(pick)) return "Choose a valid side: heads or tails.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const landed = Math.random() < 0.5 ? "heads" : "tails";
    if (pick !== landed) {
        recordGameResult(userId, "coinflip", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "coinflip",
            gameIcon: "🪙",
            gameName: "Coinflip",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Pick", value: pick },
                { label: "Landed", value: landed }
            ],
            actionMeta: { bet, arg: pick }
        });
    }

    const lucky = rollLuckyMultiplier();
    const payout = Math.max(1, Math.floor(bet * 2 * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "coinflip", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "coinflip",
        gameIcon: "🪙",
        gameName: "Coinflip",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Pick", value: pick },
            { label: "Landed", value: landed },
            { label: "Base Multiplier", value: "2.00x" }
        ],
        actionMeta: { bet, arg: pick }
    });
}

function drawCardValue(): number {
    const rank = Math.floor(Math.random() * 13) + 1;
    if (rank >= 10) return 0;
    return rank;
}

function playBaccarat(userId: string, bet: number, side: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const pick = side.toLowerCase();
    if (!["player", "banker", "tie"].includes(pick)) return "Choose a valid side: player, banker, or tie.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);

    const playerCards = [drawCardValue(), drawCardValue()];
    const bankerCards = [drawCardValue(), drawCardValue()];
    const playerTotal = (playerCards[0] + playerCards[1]) % 10;
    const bankerTotal = (bankerCards[0] + bankerCards[1]) % 10;
    const outcome = playerTotal === bankerTotal ? "tie" : playerTotal > bankerTotal ? "player" : "banker";

    if (pick !== outcome) {
        recordGameResult(userId, "baccarat", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "baccarat",
            gameIcon: "🂡",
            gameName: "Baccarat",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Pick", value: pick },
                { label: "Player Hand", value: `${playerCards.join("+")} => ${playerTotal}` },
                { label: "Banker Hand", value: `${bankerCards.join("+")} => ${bankerTotal}` },
                { label: "Outcome", value: outcome }
            ],
            actionMeta: { bet, arg: pick }
        });
    }

    const lucky = rollLuckyMultiplier();
    const base = outcome === "tie" ? 9 : outcome === "banker" ? 1.95 : 2;
    const payout = Math.max(1, Math.floor(bet * base * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "baccarat", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "baccarat",
        gameIcon: "🂡",
        gameName: "Baccarat",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Pick", value: pick },
            { label: "Player Hand", value: `${playerCards.join("+")} => ${playerTotal}` },
            { label: "Banker Hand", value: `${bankerCards.join("+")} => ${bankerTotal}` },
            { label: "Outcome", value: outcome },
            { label: "Base Multiplier", value: `${base.toFixed(2)}x` }
        ],
        actionMeta: { bet, arg: pick }
    });
}

function playHiLo(userId: string, bet: number, call: string): string {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const pick = call.toLowerCase();
    if (!["higher", "lower"].includes(pick)) return "Call must be higher or lower.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);

    const first = Math.floor(Math.random() * 13) + 1;
    const second = Math.floor(Math.random() * 13) + 1;
    const firstFace = first === 1 ? "A" : first === 11 ? "J" : first === 12 ? "Q" : first === 13 ? "K" : String(first);
    const secondFace = second === 1 ? "A" : second === 11 ? "J" : second === 12 ? "Q" : second === 13 ? "K" : String(second);

    if (first === second) {
        addTokens(userId, bet);
        recordGameResult(userId, "hilo", "push", bet, bet);
        return formatCasinoResult({
            userId,
            gameKey: "hilo",
            gameIcon: "🃏",
            gameName: "High-Low",
            outcome: "push",
            bet,
            payout: bet,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Call", value: pick },
                { label: "First Card", value: firstFace },
                { label: "Second Card", value: secondFace }
            ],
            notes: ["Tie card refunded your stake."],
            actionMeta: { bet, arg: pick }
        });
    }

    const outcome = second > first ? "higher" : "lower";
    if (pick !== outcome) {
        recordGameResult(userId, "hilo", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "hilo",
            gameIcon: "🃏",
            gameName: "High-Low",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: "Your Call", value: pick },
                { label: "First Card", value: firstFace },
                { label: "Second Card", value: secondFace },
                { label: "Outcome", value: outcome }
            ],
            actionMeta: { bet, arg: pick }
        });
    }

    const distance = Math.abs(second - first);
    const base = distance >= 8 ? 2.4 : distance >= 5 ? 2.1 : 1.85;
    const lucky = rollLuckyMultiplier();
    const payout = Math.max(1, Math.floor(bet * base * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "hilo", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "hilo",
        gameIcon: "🃏",
        gameName: "High-Low",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: "Your Call", value: pick },
            { label: "First Card", value: firstFace },
            { label: "Second Card", value: secondFace },
            { label: "Distance Bonus Tier", value: distance >= 8 ? "Extreme" : distance >= 5 ? "Strong" : "Standard" },
            { label: "Base Multiplier", value: `${base.toFixed(2)}x` }
        ],
        actionMeta: { bet, arg: pick }
    });
}

function playKeno(userId: string, bet: number, picksRaw: string): string {
    const numericTokens = (picksRaw.match(/\d+/g) || [])
        .map(part => Number.parseInt(part, 10))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 40);
    const picks = Array.from(new Set(numericTokens));
    if (picks.length < 2 || picks.length > 10) {
        return "Keno picks must contain 2 to 10 unique numbers from 1 to 40. Accepted formats: 3,8,11,24 or 3 8 11 24.";
    }

    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);

    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const draw: number[] = [];
    for (let i = 0; i < 10; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        draw.push(pool[idx]);
        pool.splice(idx, 1);
    }

    const hits = picks.filter(n => draw.includes(n));
    const hitCount = hits.length;
    const spots = picks.length;
    const baseTable: Record<number, number[]> = {
        2: [0, 0.3, 2.8],
        3: [0, 0.2, 1.2, 5.2],
        4: [0, 0.1, 0.5, 2.1, 10.5],
        5: [0, 0.1, 0.4, 1.2, 4.4, 15.5],
        6: [0, 0, 0.3, 0.9, 2.2, 8.8, 23],
        7: [0, 0, 0.2, 0.7, 1.6, 4.1, 12.5, 31],
        8: [0, 0, 0.15, 0.55, 1.25, 3.2, 7.8, 18.2, 42],
        9: [0, 0, 0.1, 0.45, 1.05, 2.5, 6.1, 12.9, 27, 56],
        10: [0, 0, 0.1, 0.35, 0.8, 1.9, 4.4, 9.5, 19.5, 37, 74]
    };
    const baseMultiplier = baseTable[spots]?.[hitCount] || 0;
    const picksText = picks.sort((a, b) => a - b).join(", ");
    const drawText = draw.sort((a, b) => a - b).join(", ");
    const hitsText = hits.sort((a, b) => a - b).join(", ") || "none";

    if (baseMultiplier <= 0) {
        recordGameResult(userId, "keno", "loss", bet, 0);
        return formatCasinoResult({
            userId,
            gameKey: "keno",
            gameIcon: "🎟️",
            gameName: "Keno",
            outcome: "loss",
            bet,
            payout: 0,
            walletBefore,
            walletAfter: getTokens(userId),
            details: [
                { label: `Your Picks (${spots})`, value: picksText },
                { label: "Drawn Numbers", value: drawText },
                { label: "Hits", value: `${hitCount} (${hitsText})` }
            ],
            notes: ["Fewer picks generally improve consistency; more picks chase bigger ladders."],
            actionMeta: { bet, arg: picks.sort((a, b) => a - b).join(",") }
        });
    }

    const lucky = rollLuckyMultiplier();
    const payout = Math.max(1, Math.floor(bet * baseMultiplier * lucky.multiplier));
    addTokens(userId, payout);
    recordGameResult(userId, "keno", "win", bet, payout);
    return formatCasinoResult({
        userId,
        gameKey: "keno",
        gameIcon: "🎟️",
        gameName: "Keno",
        outcome: "win",
        bet,
        payout,
        walletBefore,
        walletAfter: getTokens(userId),
        luckyLabel: lucky.label,
        details: [
            { label: `Your Picks (${spots})`, value: picksText },
            { label: "Drawn Numbers", value: drawText },
            { label: "Hits", value: `${hitCount} (${hitsText})` },
            { label: "Base Multiplier", value: `${baseMultiplier.toFixed(2)}x` }
        ],
        actionMeta: { bet, arg: picks.sort((a, b) => a - b).join(",") }
    });
}

async function playCrash(userId: string, bet: number, target: number): Promise<string> {
    const betError = validateCasinoBet(userId, bet);
    if (betError) return betError;
    if (!target || target < 1.05 || target > 10) return "Target multiplier must be between 1.05 and 10.0.";

    const walletBefore = getTokens(userId);
    removeTokens(userId, bet);
    const result = (await import("./game/economy")).resolveCrash(bet, target);
    if (result.win) {
        const lucky = rollLuckyMultiplier();
        const payout = Math.max(1, Math.floor(result.payout * lucky.multiplier));
        addTokens(userId, payout);
        recordGameResult(userId, "crash", "win", bet, payout);
        return formatCasinoResult({
            userId,
            gameKey: "crash",
            gameIcon: "📈",
            gameName: "Crash",
            outcome: "win",
            bet,
            payout,
            walletBefore,
            walletAfter: getTokens(userId),
            luckyLabel: lucky.label,
            details: [
                { label: "Target", value: `${target.toFixed(2)}x` },
                { label: "Crash Point", value: `${result.crashPoint}x` },
                { label: "Base Payout", value: formatTokenAmount(result.payout) }
            ],
            sections: [
                { title: "Crash Meter", value: buildCrashMeter(target, Number(result.crashPoint)) }
            ],
            actionMeta: { bet, arg: target.toFixed(2) }
        });
    }

    recordGameResult(userId, "crash", "loss", bet, 0);
    return formatCasinoResult({
        userId,
        gameKey: "crash",
        gameIcon: "📈",
        gameName: "Crash",
        outcome: "loss",
        bet,
        payout: 0,
        walletBefore,
        walletAfter: getTokens(userId),
        details: [
            { label: "Target", value: `${target.toFixed(2)}x` },
            { label: "Crash Point", value: `${result.crashPoint}x` }
        ],
        sections: [
            { title: "Crash Meter", value: buildCrashMeter(target, Number(result.crashPoint)) }
        ],
        actionMeta: { bet, arg: target.toFixed(2) }
    });
}

async function runCasinoQuickAction(input: {
    userId: string;
    action: CasinoActionKind;
    gameKey: CasinoGameKey;
    bet: number;
    arg: string;
}): Promise<{ gameKey: CasinoGameKey; payload: string }> {
    const resolvedGame = input.action === "switch" ? getNextCasinoGame(input.gameKey) : input.gameKey;
    const sourceBet = Math.max(1, Math.floor(input.bet));
    const effectiveBet = input.action === "double"
        ? sourceBet * 2
        : input.action === "half"
            ? Math.max(1, Math.floor(sourceBet / 2))
            : sourceBet;
    const arg = sanitizeCasinoActionArg(input.action === "switch" ? defaultCasinoArgForGame(resolvedGame) : (input.arg || defaultCasinoArgForGame(resolvedGame)));

    if (resolvedGame === "dice") return { gameKey: resolvedGame, payload: playDice(input.userId, effectiveBet, arg || "low") };
    if (resolvedGame === "roulette") return { gameKey: resolvedGame, payload: playRoulette(input.userId, effectiveBet, arg || "red") };
    if (resolvedGame === "blackjack") return { gameKey: resolvedGame, payload: playBlackjack(input.userId, effectiveBet, arg || "safe") };
    if (resolvedGame === "crash") {
        const target = Number.parseFloat(arg || "1.50");
        return { gameKey: resolvedGame, payload: await playCrash(input.userId, effectiveBet, Number.isFinite(target) ? target : 1.5) };
    }
    if (resolvedGame === "magicslots") {
        return { gameKey: resolvedGame, payload: playSlots(input.userId, effectiveBet) };
    }
    if (resolvedGame === "coinflip") return { gameKey: resolvedGame, payload: playCoinflip(input.userId, effectiveBet, arg || "heads") };
    if (resolvedGame === "baccarat") return { gameKey: resolvedGame, payload: playBaccarat(input.userId, effectiveBet, arg || "player") };
    if (resolvedGame === "hilo") return { gameKey: resolvedGame, payload: playHiLo(input.userId, effectiveBet, arg || "higher") };
    return { gameKey: "keno", payload: playKeno(input.userId, effectiveBet, arg || "3,8,11,24") };
}

function buildTicketPanelPayload(guildName: string) {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x14b8a6)
        .setTitle("🎫 FN Support tickets.")
        .setDescription([
            `Welcome to **${guildName}** support HQ.`,
            "",
            "Open a private ticket to start a tracked case with live status, assignment flow, and SLA visibility.",
            "",
            "Need fast help? Include screenshots, IDs, and exact steps so handlers can act quickly."
        ].join("\n"))
        .addFields(
            {
                name: "🧭 Desk Purpose",
                value: [
                    "Private support lane for account help, billing, appeals, and operations issues.",
                    "",
                    "Built for clean tracking from open to final resolution."
                ].join("\n")
            },
            {
                name: "🚀 How To Open",
                value: [
                    "Press **Open Support Ticket**.",
                    "",
                    "A private channel is created instantly and a live operations panel is posted."
                ].join("\n")
            },
            {
                name: "📊 Priority Guide",
                value: [
                    "**Low**: General questions",
                    "",
                    "**Normal**: Standard support",
                    "",
                    "**High**: Urgent operational issue"
                ].join("\n")
            },
            {
                name: "🧩 Workflow",
                value: "`new` -> `responded` -> `waiting_user` -> `archived` -> `resolved`"
            },
            {
                name: "🔐 Visibility",
                value: [
                    "Only ticket owner, admins, and handler role can view ticket channels.",
                    "",
                    "Actions are logged for audit and accountability."
                ].join("\n")
            },
            {
                name: "🛠️ Handler Toolkit",
                value: [
                    "Button actions: Claim, Archive, Resolve",
                    "",
                    "Slash actions: `/claimticket` `/ticketassign` `/ticketstatus` `/reopenticket` `/closeticket` `/resolveticket`"
                ].join("\n")
            },
            {
                name: "🧠 Quality Tips",
                value: [
                    "Include screenshots, message links, and IDs.",
                    "",
                    "Write exact steps and expected vs actual behavior."
                ].join("\n")
            },
            {
                name: "⚖️ Rules",
                value: "One active support ticket per user. Spam or abuse may trigger moderation actions."
            }
        ), "FN Support Desk", `${guildName} support panel`);

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

function buildRaidItemGiveawayPanelPayload(guildName: string) {
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

async function upsertTicketPanelInChannel(guild: Guild, channelId: string): Promise<{ ok: true; action: "posted" | "updated" } | { ok: false; error: string }> {
    const channel = (guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) {
        return { ok: false, error: "Configured ticket panel channel is missing or not a text channel." };
    }

    const panel = buildTicketPanelPayload(guild.name);
    const embed = panel.embed as APIEmbed;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(TICKET_IDS.open)
            .setLabel("Open Support Ticket")
            .setEmoji("🎫")
            .setStyle(ButtonStyle.Success)
    );

    let candidateId: string | null = null;
    let beforeId: string | undefined;
    const expectedTitle = "🎫 FN Support tickets.";
    for (let i = 0; i < 5; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
        if (!batch || !batch.size) break;

        const candidate = batch.find(message =>
            message.author.id === (client.user?.id || "")
            && (messageHasTicketOpenButton(message as MessageWithComponents) || message.embeds[0]?.title === expectedTitle)
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
        const edited = await candidate?.edit({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
        if (!edited) {
            return { ok: false, error: "Failed to refresh ticket panel message. Check bot permissions for this channel." };
        }
        return { ok: true, action: "updated" };
    }

    const sent = await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        return { ok: false, error: "Failed to post ticket panel message. Check bot permissions for this channel." };
    }
    return { ok: true, action: "posted" };
}

async function ensurePermanentTicketPanelForGuild(guild: Guild): Promise<void> {
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

async function removeLegacyReportPanelForGuild(guild: Guild): Promise<void> {
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

async function ensureAdminReportPanelForGuild(guild: Guild): Promise<void> {
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

async function ensureWelcomePanelForGuild(guild: Guild): Promise<void> {
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

function buildBotFeatureBriefPayload(guildName: string) {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x0891b2)
        .setTitle(`🛰️ ${guildName} • About Titan Bot`)
        .setDescription([
            `Titan Bot is the primary operations and progression system for **${guildName}**.`,
            "",
            "Use the command menu below to flip through live command pages and read what each bot area does.",
            "",
            "This post is the public command reference for new members, returning players, and staff." 
        ].join("\n"))
        .addFields(
            {
                name: "🧭 What This Bot Covers",
                value: [
                    "• Raid progression and PMC profiles",
                    "• Economy, inventory, crates, and trading",
                    "• Giveaways, moderation, support, and report tooling"
                ].join("\n")
            },
            {
                name: "📚 Browse Command Pages",
                value: [
                    "• Mission Brief",
                    "• XP Ops",
                    "• Raid Ops",
                    "• Supply Crates",
                    "• Training Grounds",
                    "• Bank and Trade",
                    "• Moderation Desk"
                ].join("\n")
            },
            {
                name: "🚀 Fast Start",
                value: [
                    "• `/quickstart` — guided onboarding",
                    "• `/help` — direct personal help menu",
                    "• `/ticket` — support request",
                    "• `/reportintake` — submit a report"
                ].join("\n")
            },
            {
                name: "🔔 Public Guide Rules",
                value: [
                    "• Click the menu to change pages",
                    "• Keep this channel readable; don’t reply with support requests here",
                    "• Use tickets, reports, or commands for action paths"
                ].join("\n")
            }
        ), `${guildName} About Titan Bot`, "About Titan Bot • Official Reference Panel");

    return {
        embed: embed.toJSON(),
        components: helpDropdown("general").map(row => row.toJSON()),
        isBotFeatureBrief: true,
        withHelpNav: true,
        helpPage: "general"
    };
}

async function upsertBotFeatureBriefInChannel(guild: Guild, channelId: string): Promise<{ ok: true; action: "posted" | "updated" } | { ok: false; error: string }> {
    const channel = (guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) {
        return { ok: false, error: "Configured bot feature brief channel is missing or not a text channel." };
    }

    const payload = buildBotFeatureBriefPayload(guild.name);
    const embed = payload.embed as APIEmbed;
    const components = Array.isArray(payload.components) ? payload.components : [];

    const storedMessageId = getGuildPanelMessageId(guild.id, "featureBrief");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) {
            return { ok: true, action: "updated" };
        }
        setGuildPanelMessageId(guild.id, "featureBrief", null);
    }

    let candidateId: string | null = null;
    const duplicateIds: string[] = [];
    let beforeId: string | undefined;
    const expectedPrefix = `🛰️ ${guild.name} • About Titan Bot`;
    for (let i = 0; i < 10; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
        if (!batch || !batch.size) break;

        const candidates = batch.filter(message =>
            message.author.id === (client.user?.id || "")
            && (
                message.embeds[0]?.title === expectedPrefix
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
            await duplicate?.delete().catch(() => undefined);
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

async function ensureBotFeatureBriefForGuild(guild: Guild): Promise<void> {
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

function isOwnerTopicMatch(topic: string | null | undefined, ownerId: string): boolean {
    return findChannelOwnerFromTopic(topic) === ownerId;
}

async function findOwnerActiveTicketChannels(guild: Guild, owner: GuildMember): Promise<string[]> {
    const fetched = await guild.channels.fetch().catch(() => null);
    const channels = fetched ? Array.from(fetched.values()) : Array.from(guild.channels.cache.values());
    const matches: string[] = [];

    for (const ch of channels) {
        if (!ch || ch.type !== ChannelType.GuildText) continue;
        if (!isOwnerTopicMatch(ch.topic, owner.id)) continue;

        const perms = ch.permissionsFor(owner);
        const canView = Boolean(perms?.has(PermissionFlagsBits.ViewChannel));
        const canSend = Boolean(perms?.has(PermissionFlagsBits.SendMessages));
        if (canView && canSend) {
            matches.push(ch.id);
        }
    }

    matches.sort((a, b) => a.localeCompare(b));
    return matches;
}

async function findOwnerActiveTicketChannelsInBucket(guild: Guild, owner: GuildMember, bucket: TicketCaseBucket): Promise<string[]> {
    const activeChannelIds = await findOwnerActiveTicketChannels(guild, owner);
    const matches: string[] = [];

    for (const channelId of activeChannelIds) {
        const tracked = await ensureTrackedTicketByChannelId(guild, channelId, owner.id).catch(() => null);
        if (!tracked) continue;
        if (getTicketCaseBucket(tracked.category || tracked.reason) === bucket) {
            matches.push(channelId);
        }
    }

    return matches.sort((a, b) => a.localeCompare(b));
}

async function removeTicketStoreEntryByChannelId(channelId: string): Promise<void> {
    const idx = ticketStore.tickets.findIndex(t => t.channelId === channelId);
    if (idx >= 0) {
        ticketStore.tickets.splice(idx, 1);
        saveTicketStore();
    }
}

async function reconcileOwnerTicketDuplicates(guild: Guild, owner: GuildMember, canonicalChannelId: string, bucket: TicketCaseBucket): Promise<void> {
    const active = await findOwnerActiveTicketChannelsInBucket(guild, owner, bucket);
    const duplicates = active.filter(channelId => channelId !== canonicalChannelId);
    if (!duplicates.length) return;

    for (const duplicateChannelId of duplicates) {
        const channel = await guild.channels.fetch(duplicateChannelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) continue;

        const recent = await channel.messages.fetch({ limit: 8 }).catch(() => null);
        const hasUserMessages = Boolean(recent && Array.from(recent.values()).some(message => !message.author?.bot));
        if (hasUserMessages) continue;

        await channel.delete("Duplicate ticket channel auto-cleanup").catch(() => undefined);
        await removeTicketStoreEntryByChannelId(channel.id);
        appendAuditEvent("ticket_duplicate_channel_deleted", {
            guildId: guild.id,
            ownerId: owner.id,
            channelId: channel.id,
            canonicalChannelId
        });
    }
}

async function createTicketChannel(guild: Guild, ownerId: string, reason: string, priority: TicketPriority = "normal", bypassDeflection = false): Promise<{ error?: string; channelId?: string; ticketId?: number }> {
    recordTicketCreateAttempt();
    const requestedBucket = getTicketCaseBucket(reason);
    if (!tryAcquireTicketCreateLock(guild.id, ownerId)) {
        recordTicketCreateFailure("in_flight_lock");
        return { error: "Ticket creation is already in progress for your account. Please wait a moment and try again." };
    }

    try {
    if (!bypassDeflection) {
        const deflection = evaluateTicketDeflection(guild.id, ownerId, reason);
        if (deflection.blocked) {
            recordTicketCreateFailure("duplicate_deflection");
            return { error: deflection.message || "Potential duplicate ticket detected." };
        }
    }

    await pruneDeletedTicketRecords(guild);
    await pruneInaccessibleOwnerTicketRecords(guild);

    // Self-heal stale owner records caused by manual/deleted/inaccessible channels so /ticket works immediately.
    // Iterate until we either find a valid active ticket or no owner-open tickets remain.
    let existing = findOpenTicketByOwnerInBucket(guild.id, ownerId, requestedBucket);
    let prunedAny = false;
    while (existing) {
        const stale = existing;
        const existingChannel = guild.channels.cache.get(existing.channelId)
            || await guild.channels.fetch(existing.channelId).catch(() => null);
        const ownerMember = await guild.members.fetch(ownerId).catch(() => null);
        const ownerCanViewExisting = existingChannel && existingChannel.type === ChannelType.GuildText && ownerMember
            ? existingChannel.permissionsFor(ownerMember)?.has(PermissionFlagsBits.ViewChannel)
            : false;

        // Keep exactly one valid visible open/claimed ticket for this owner.
        if (existingChannel && ownerCanViewExisting) {
            break;
        }

        const idx = ticketStore.tickets.findIndex(t => t.id === stale.id);
        if (idx < 0) {
            existing = findOpenTicketByOwnerInBucket(guild.id, ownerId, requestedBucket);
            continue;
        }

        ticketStore.tickets.splice(idx, 1);
        prunedAny = true;
        appendAuditEvent("ticket_prune_stale_owner_open", {
            guildId: guild.id,
            ownerId,
            ticketId: stale.id,
            channelId: stale.channelId,
            reason: "Missing/inaccessible channel during create"
        });

        existing = findOpenTicketByOwnerInBucket(guild.id, ownerId, requestedBucket);
    }
    if (prunedAny) {
        saveTicketStore();
    }
    if (existing) {
        recordTicketCreateFailure("existing_open_ticket_record");
        return { error: requestedBucket === "report"
            ? `You already have an open report case: <#${existing.channelId}>`
            : `You already have an open support ticket: <#${existing.channelId}>` };
    }

    const owner = await guild.members.fetch(ownerId).catch(() => null);
    if (!owner) {
        recordTicketCreateFailure("owner_fetch_failed");
        return { error: "Unable to resolve your member record." };
    }

    const ownerActiveChannels = await findOwnerActiveTicketChannelsInBucket(guild, owner, requestedBucket);
    if (ownerActiveChannels.length > 0) {
        const canonical = ownerActiveChannels[0];
        await ensureTrackedTicketByChannelId(guild, canonical, owner.id);
        recordTicketCreateFailure("existing_open_ticket_channel");
        return { error: requestedBucket === "report"
            ? `You already have an open report case: <#${canonical}>`
            : `You already have an open support ticket: <#${canonical}>` };
    }

    const cfg = ensureTicketConfig(guild.id);

    const configuredOrDefaultCategoryId = cfg.categoryId || TICKET_DEFAULT_CATEGORY_ID;
    const configuredOrDefaultCategory = await guild.channels.fetch(configuredOrDefaultCategoryId).catch(() => null);
    const parentCategoryId = configuredOrDefaultCategory && configuredOrDefaultCategory.type === ChannelType.GuildCategory
        ? configuredOrDefaultCategory.id
        : undefined;

    const channelName = `ops-${owner.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 18) || "member"}`;
    const created = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentCategoryId,
        topic: `Support ticket for ${owner.user.tag} (${owner.id})`,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: owner.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: TICKET_HANDLER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
            ...(guild.members.me ? [{ id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }] : [])
        ],
        reason: `Ticket opened by ${owner.user.tag}`
    }).catch(() => null);

    if (!created || created.type !== ChannelType.GuildText) {
        recordTicketCreateFailure("channel_create_failed");
        return { error: "Failed to create ticket channel." };
    }

    // Cross-process safety: if multiple instances raced and created channels, keep only one owner-active channel.
    const ownerChannelsAfterCreate = await findOwnerActiveTicketChannelsInBucket(guild, owner, requestedBucket);
    if (ownerChannelsAfterCreate.length > 1) {
        const canonical = ownerChannelsAfterCreate[0];
        if (canonical !== created.id) {
            await created.delete("Duplicate ticket channel prevented by dedupe guard").catch(() => undefined);
            await removeTicketStoreEntryByChannelId(created.id);
            await ensureTrackedTicketByChannelId(guild, canonical, owner.id);
            recordTicketCreateFailure("dedupe_race_duplicate_channel");
            return { error: requestedBucket === "report"
                ? `You already have an open report case: <#${canonical}>`
                : `You already have an open support ticket: <#${canonical}>` };
        }
    }

    const ticket = createTicketEntry(guild.id, owner.id, created.id, reason, priority);
    if (!ticket) {
        await created.delete("Ticket persistence conflict; safe rollback").catch(() => undefined);
        recordTicketCreateFailure("ticket_store_save_conflict");
        return { error: "Ticket persistence conflict detected. Please retry in a moment." };
    }
    const intake = parseTicketIntakeSnapshot(reason);
    ticket.intakeSummary = intake.summary;
    ticket.intakeCategory = intake.category;
    ticket.intakeDetails = intake.details;
    ticket.intakePlatform = intake.platform;
    ticket.intakeOrderId = intake.orderId;
    ticket.intakeEvidence = intake.evidence;
    applyTicketMetadata(ticket, reason);
    appendAuditEvent("ticket_open", { guildId: guild.id, ticketId: ticket.id, ownerId: owner.id, channelId: created.id, reason, intake });

    const intro = buildTicketOpsEmbed(ticket);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(TICKET_IDS.claim)
            .setLabel("Claim Ticket")
            .setEmoji("🛠️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(TICKET_IDS.close)
            .setLabel("Archive Ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(TICKET_IDS.resolve)
            .setLabel("Resolve Permanently")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success)
    );
    const panelMessage = await created.send({ content: `<@&${TICKET_HANDLER_ROLE_ID}> <@${owner.id}>`, embeds: [intro], components: [row], allowedMentions: { parse: ["roles", "users"] } }).catch(() => null);
    if (panelMessage) {
        setTicketPanelMessageId(ticket.channelId, panelMessage.id);
    }

    await sendTicketLog(guild.id, `Ticket #${ticket.id} Opened`, [
        { name: "Owner", value: `<@${owner.id}>`, inline: true },
        { name: "Category", value: String(ticket.category || "general").toUpperCase(), inline: true },
        { name: "Priority", value: priority.toUpperCase(), inline: true },
        { name: "Channel", value: `<#${created.id}>`, inline: true },
        { name: "Reason", value: reason || "No reason provided" }
    ]);

    await autoRouteTicket(guild, ticket);

    await reconcileOwnerTicketDuplicates(guild, owner, created.id, requestedBucket);

    return { channelId: created.id, ticketId: ticket.id };
    } finally {
        releaseTicketCreateLock(guild.id, ownerId);
    }
}

async function ensureArchiveCategory(guild: Guild): Promise<string | null> {
    const cfg = ensureTicketConfig(guild.id);
    if (cfg.archiveCategoryId && guild.channels.cache.has(cfg.archiveCategoryId)) {
        return cfg.archiveCategoryId;
    }

    const created = await guild.channels.create({
        name: "ticket-archive-hold",
        type: ChannelType.GuildCategory,
        reason: "Create archive hold category for tickets"
    }).catch(() => null);
    if (!created || created.type !== ChannelType.GuildCategory) return null;

    cfg.archiveCategoryId = created.id;
    saveTicketStore();
    return created.id;
}

async function closeTicketChannel(guild: Guild, channelId: string, closedById: string, closeReason: string): Promise<string> {
    const ticket = archiveTicketByChannel(channelId, closeReason);
    if (!ticket) return "This channel is not an open ticket.";
    const cfg = ensureTicketConfig(guild.id);
    const reopenHours = Math.max(1, Number(cfg.reopenWindowHours || 72));
    ticket.reopenUntilAt = Date.now() + (reopenHours * 60 * 60 * 1000);
    saveTicketStore();
    const channel = guild.channels.cache.get(channelId);
    const archiveCategoryId = await ensureArchiveCategory(guild);
    if (channel && channel.type === ChannelType.GuildText) {
        await channel.setParent(archiveCategoryId, { lockPermissions: false }).catch(() => undefined);
        await channel.permissionOverwrites.edit(ticket.ownerId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: false
        }).catch(() => undefined);
        await channel.permissionOverwrites.edit(TICKET_HANDLER_ROLE_ID, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: true,
            ManageChannels: true
        }).catch(() => undefined);
        await channel.send({ content: `🔒 Ticket archived to hold queue.\n📝 Reason: ${closeReason}` }).catch(() => undefined);
    }
    await sendTicketLog(guild.id, `Ticket #${ticket.id} Archived`, [
        { name: "Owner", value: `<@${ticket.ownerId}>`, inline: true },
        { name: "Archived By", value: `<@${closedById}>`, inline: true },
        { name: "Channel", value: `<#${ticket.channelId}>`, inline: true },
        { name: "Close Reason", value: closeReason },
        { name: "Reopen Window", value: `Until <t:${Math.floor((ticket.reopenUntilAt || Date.now()) / 1000)}:f>` }
    ]);
    appendAuditEvent("ticket_archive", { guildId: guild.id, ticketId: ticket.id, closedById, channelId: ticket.channelId, closeReason });

    return `Archived ticket #${ticket.id} in hold queue. Reason: ${closeReason}`;
}

async function claimTicketChannel(guild: Guild, channelId: string, claimerId: string): Promise<string> {
    let ticket = await ensureTrackedTicketByChannelId(guild, channelId, claimerId);
    if (!ticket) {
        // Permanent QoL fallback: if channel is already in this guild cache, force-import it
        // so button/command claim does not fail with a false "not tracked" on valid ticket channels.
        const cached = guild.channels.cache.get(channelId);
        if (cached && cached.type === ChannelType.GuildText) {
            ticket = ensureTrackedTicketFromKnownChannel(guild, cached, claimerId);
        }
    }
    if (!ticket) {
        return "This channel is not a tracked ticket and could not be imported. Provide ticket_channel_id or run /tickets to verify the channel.";
    }
    const status = normalizeTicketStatus(ticket.status);
    if (status === "resolved") return "This ticket is already permanently resolved.";
    if (status === "archived") return "This ticket is archived. Use /reopenticket to continue handling or /resolveticket for permanent closure.";
    if (ticket.claimedById && ticket.claimedById !== claimerId) {
        return `Ticket already claimed by <@${ticket.claimedById}>.`;
    }

    const claimed = claimTicketByChannel(channelId, claimerId);
    if (!claimed) return "Unable to claim this ticket right now.";

    const sla = getTicketSlaState(claimed);
    await updateTicketOpsPanelMessage(guild, claimed);

    await sendTicketLog(guild.id, `Ticket #${claimed.id} Claimed`, [
        { name: "Claimed By", value: `<@${claimerId}>`, inline: true },
        { name: "Owner", value: `<@${claimed.ownerId}>`, inline: true },
        { name: "Channel", value: `<#${claimed.channelId}>`, inline: true },
        { name: "Workflow Status", value: claimed.workflowStatus, inline: true },
        { name: "First Response SLA", value: sla.firstResponseOverdue ? "BREACHED" : "ON TIME", inline: true }
    ]);
    appendAuditEvent("ticket_claim", {
        guildId: guild.id,
        ticketId: claimed.id,
        claimedById: claimerId,
        channelId: claimed.channelId
    });

    return `Ticket #${claimed.id} claimed by <@${claimerId}>.`;
}

function ensureTrackedTicketFromKnownChannel(guild: Guild, channel: { id: string; topic?: string | null }, fallbackOwnerId: string): TicketEntry {
    const existing = findTicketByChannel(channel.id);
    if (existing) return existing;
    const ownerFromTopic = findChannelOwnerFromTopic(channel.topic);
    const ownerId = ownerFromTopic || fallbackOwnerId;
    const imported = importTicketEntryForChannel(guild.id, ownerId, channel.id, "Imported from known ticket button channel");
    appendAuditEvent("ticket_import", {
        guildId: guild.id,
        ticketId: imported.id,
        channelId: imported.channelId,
        ownerId: imported.ownerId,
        importedFromKnownChannel: true
    });
    return imported;
}

async function resolveTicketChannel(guild: Guild, channelId: string, resolverId: string, resolvedReason: string): Promise<string> {
    const tracked = findTicketByChannel(channelId);
    const exported = tracked
        ? await exportTicketTranscript({
            guild,
            channelId,
            ticketId: tracked.id,
            ownerId: tracked.ownerId,
            resolverId,
            resolvedReason,
            transcriptDir: TICKET_TRANSCRIPT_DIR,
            projectRootDir: path.resolve(__dirname, "..")
        })
        : { transcriptPath: null, messageCount: 0, truncated: false, fetchErrors: 0 };
    const transcript = await buildTicketTranscriptStub(guild, channelId);
    if (transcript && exported.transcriptPath) {
        transcript.transcriptPath = exported.transcriptPath;
        transcript.transcriptFormat = "txt";
        transcript.messageCountApprox = Math.max(transcript.messageCountApprox, exported.messageCount);
    }
    if (transcript) {
        transcript.truncated = exported.truncated;
        transcript.fetchErrors = exported.fetchErrors;
    }
    const ticket = resolveTicketByChannel(channelId, resolvedReason, transcript);
    if (!ticket) return "This channel is not an archived ticket.";

    const exportWebhook = ensureTicketConfig(guild.id).exportWebhookUrl || TICKET_EXPORT_WEBHOOK_URL;
    if (exportWebhook) {
        const exported = await postJsonToWebhook(exportWebhook, {
            type: "ticket_resolved",
            guildId: guild.id,
            ticket: {
                id: ticket.id,
                ownerId: ticket.ownerId,
                channelId: ticket.channelId,
                category: ticket.category || "general",
                priority: ticket.priority,
                status: ticket.status,
                workflowStatus: ticket.workflowStatus,
                createdAt: ticket.createdAt,
                resolvedAt: ticket.resolvedAt,
                resolvedReason: ticket.resolvedReason,
                transcript: ticket.transcript,
                internalNoteCount: ticket.internalNotes?.length || 0
            }
        });
        appendAuditEvent("ticket_export_webhook", {
            guildId: guild.id,
            ticketId: ticket.id,
            ok: exported,
            sinkConfigured: true
        });
    }

    await sendTicketLog(guild.id, `Ticket #${ticket.id} Resolved`, [
        { name: "Owner", value: `<@${ticket.ownerId}>`, inline: true },
        { name: "Resolved By", value: `<@${resolverId}>`, inline: true },
        { name: "Channel", value: `<#${ticket.channelId}>`, inline: true },
        { name: "Resolved Reason", value: resolvedReason },
        { name: "Transcript Stub", value: transcript ? `captured (${transcript.messageCountApprox} msgs approx)` : "not captured" },
        { name: "Transcript File", value: transcript?.transcriptPath ? transcript.transcriptPath : "not exported" }
    ]);
    appendAuditEvent("ticket_resolve", {
        guildId: guild.id,
        ticketId: ticket.id,
        resolverId,
        channelId: ticket.channelId,
        resolvedReason,
        transcript
    });

    const ownerUser = await client.users.fetch(ticket.ownerId).catch(() => null);
    if (ownerUser) {
        await ownerUser.send({
            embeds: [new EmbedBuilder()
                .setColor(0x22c55e)
                .setTitle(`Ticket #${ticket.id} Resolved`)
                .setDescription("How was your support experience? Please rate 1-5 below.")
                .addFields(
                    { name: "Category", value: String(ticket.category || "general"), inline: true },
                    { name: "Priority", value: String(ticket.priority), inline: true },
                    { name: "Reason", value: String(ticket.resolvedReason || "Resolved"), inline: false }
                )],
            components: [buildTicketCsatButtons(ticket.id)]
        }).catch(() => undefined);
    }

    void guild.channels.delete(ticket.channelId, "Ticket permanently resolved").catch(() => undefined);
    return `Resolved ticket #${ticket.id} permanently. Reason: ${resolvedReason}`;
}

const slashCommands = buildSlashCommands({
    raidConditionChoices: RAID_CONDITION_CHOICES,
    raidMapChoices: RAID_MAP_CHOICES
});

const ticketCommandHandlers = buildTicketCommandHandlers({
    requireGuild,
    requireAdministrator,
    canManageTicketActions,
    resolveTicketTargetChannelId,
    ensureTrackedTicketByChannelId,
    createTicketChannel,
    findTicketByChannel,
    buildTicketCommandEmbedPayload,
    upsertTicketPanelInChannel,
    claimTicketChannel,
    handleTicketAssignCommand,
    normalizeTicketPriority,
    normalizeTicketStatus,
    normalizeTicketWorkflowStatus,
    rejectIfDuplicateCommand,
    setTicketWorkflowStatus,
    updateTicketOpsPanelMessage,
    sendTicketLog,
    appendAuditEvent,
    getTicketNextActionHint,
    canTransitionTicketStatus,
    reopenTicketByChannel,
    findOpenTicketByChannel,
    closeTicketChannel,
    findArchivedTicketByChannel,
    resolveTicketChannel,
    ensureTicketConfig,
    saveTicketStore,
    pruneDeletedTicketRecords,
    pruneInaccessibleOwnerTicketRecords,
    getTicketSlaState,
    ticketStore,
    TICKET_HANDLER_ROLE_ID,
    TICKET_DEFAULT_CATEGORY_ID
});

const moderationCommandHandlers = buildModerationCommandHandlers({
    requireAdministrator,
    ensureGuildModeration,
    saveModerationStore,
    rejectIfDuplicateCommand,
    sendModLog,
    parseDurationMs,
    getAvatar
});

const commandHandlers: Record<string, (interaction: ChatInputCommandInteraction) => Promise<string>> = {
    ping: async interaction => {
        return "Pong.";
    },
    help: async interaction => {
        return JSON.stringify(await buildHelpPayload("general", interaction.guild));
    },
    xproles: async interaction => {
        const lines = await resolveXpRoleLines(interaction.guild);
        const sections = buildThemedRoleSections(lines);
        const randomColor = Math.floor(Math.random() * 0xffffff);
        const embed = new EmbedBuilder()
            .setColor(randomColor)
            .setTitle("🎖️ XP Role Directory")
            .setDescription("Engagement XP rank tiers grouped into 5 themed sections")
            .setFooter({ text: `Showing ${lines.length} role entries` });

        for (const section of sections) {
            embed.addFields(section);
        }

        return JSON.stringify({ embed: embed.toJSON() });
    },
    xprolesync: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;

        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        if (XP_ROLE_SYNC_RUNNING_GUILDS.has(guild.id)) {
            return "An XP role sync is already running for this server. Please wait for it to finish.";
        }

        XP_ROLE_SYNC_RUNNING_GUILDS.add(guild.id);
        const sourceChannelId = interaction.channelId || null;
        const startedByUserId = interaction.user.id;

        void runGuildXpRoleSyncJob(guild, sourceChannelId, startedByUserId)
            .catch(error => {
                appendAuditEvent("xp_role_sync_failed", {
                    guildId: guild.id,
                    userId: startedByUserId,
                    error: error instanceof Error ? error.message : String(error)
                });
            })
            .finally(() => {
                XP_ROLE_SYNC_RUNNING_GUILDS.delete(guild.id);
            });

        return "XP role sync started in the background. I will post completion results in this channel.";
    },
    status: async () => {
        const memory = process.memoryUsage();
        return buildStatusLines(client.user?.tag, client.guilds.cache.size, client.ws.ping, memory, Math.floor(process.uptime())).join("\n");
    },
    balance: async interaction => handleCoreCommand("balance", interaction),
    bank: async interaction => handleCoreCommand("bank", interaction),
    deposit: async interaction => {
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0) return "Amount must be greater than 0.";
        const before = getTokens(interaction.user.id);
        if (before < amount) return `You only have ${before} FN Token$ in your wallet.`;
        const res = depositToBank(interaction.user.id, amount);
        return `Deposited ${amount} FN Token$. Wallet: ${res.wallet} | Bank: ${res.bank}`;
    },
    withdraw: async interaction => {
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0) return "Amount must be greater than 0.";
        const before = getBankTokens(interaction.user.id);
        if (before < amount) return `You only have ${before} FN Token$ in bank.`;
        const res = withdrawFromBank(interaction.user.id, amount);
        return `Withdrew ${amount} FN Token$. Wallet: ${res.wallet} | Bank: ${res.bank}`;
    },
    transfer: async interaction => {
        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        if (target.id === interaction.user.id) return "You cannot transfer to yourself.";
        if (amount <= 0) return "Amount must be greater than 0.";
        if (getTokens(interaction.user.id) < amount) return "Not enough wallet tokens.";
        const moved = transferWalletTokens(interaction.user.id, target.id, amount);
        return `Transferred ${moved.moved} FN Token$ to ${target.username}. Your wallet: ${moved.fromWallet}.`;
    },
    addtoken: async interaction => {
        const ownerError = requireGuildOwner(interaction);
        if (ownerError) return ownerError;

        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        if (amount <= 0) return "Amount must be greater than 0.";

        const total = addTokens(target.id, amount);
        await sendModLog(interaction.guildId!, "FN Token$ Granted", [
            { name: "Granted By (Owner)", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Amount", value: `${amount}`, inline: true },
            { name: "New Total", value: `${total}`, inline: true }
        ]);

        return `${target.username} received ${amount} FN Token$ (ultra-rare coins normally found only in raids). New balance: ${total}.`;
    },
    tradeoffer: async interaction => {
        const target = interaction.options.getUser("user", true);
        const offerItemId = interaction.options.getString("offer_item", true).trim().toLowerCase();
        const offerQty = interaction.options.getInteger("offer_qty", true);
        const requestItemId = interaction.options.getString("request_item", true).trim().toLowerCase();
        const requestQty = interaction.options.getInteger("request_qty", true);

        if (target.id === interaction.user.id) return "You cannot create a trade with yourself.";
        if (offerQty <= 0 || requestQty <= 0) return "Trade quantities must be greater than 0.";
        if (!ITEM_DEFS[offerItemId]) return `Unknown offer item: ${offerItemId}`;
        if (!ITEM_DEFS[requestItemId]) return `Unknown request item: ${requestItemId}`;
        if (getInventoryCount(interaction.user.id, offerItemId) < offerQty) return "You do not own enough of the offered item.";

        const offer = createTradeOffer({
            guildId: interaction.guildId,
            fromUserId: interaction.user.id,
            toUserId: target.id,
            offerItemId,
            offerQty,
            requestItemId,
            requestQty
        });

        return [
            `Trade offer #${offer.id} created for ${target.username}.`,
            `You give: ${offerQty}x ${ITEM_DEFS[offerItemId].name}`,
            `You request: ${requestQty}x ${ITEM_DEFS[requestItemId].name}`,
            `Target can accept with /tradeaccept offer_id:${offer.id}`
        ].join("\n");
    },
    trades: async interaction => {
        const userId = interaction.user.id;
        const open = tradeStore.offers.filter(offer => offer.status === "open" && (offer.fromUserId === userId || offer.toUserId === userId));
        if (!open.length) return "No open trades for you.";
        const lines = open.slice(-12).reverse().map(offer => {
            const direction = offer.fromUserId === userId ? "Outgoing" : "Incoming";
            return `#${offer.id} ${direction} | ${offer.offerQty}x ${ITEM_DEFS[offer.offerItemId]?.name || offer.offerItemId} -> ${offer.requestQty}x ${ITEM_DEFS[offer.requestItemId]?.name || offer.requestItemId} | <@${offer.fromUserId}> to <@${offer.toUserId}>`;
        });
        return `Open trades:\n${lines.join("\n")}`;
    },
    tradeaccept: async interaction => {
        const offerId = Number.parseInt(interaction.options.getString("offer_id", true), 10);
        if (!Number.isFinite(offerId)) return "Invalid trade selection.";
        const offer = getOpenTradeOffer(offerId);
        if (!offer) return "Trade offer not found or already closed.";
        if (offer.toUserId !== interaction.user.id) return "Only the target user can accept this trade.";

        if (getInventoryCount(offer.fromUserId, offer.offerItemId) < offer.offerQty) {
            offer.status = "cancelled";
            offer.updatedAt = Date.now();
            saveTradeStore();
            return "Trade cancelled because the sender no longer has the offered item.";
        }
        if (getInventoryCount(offer.toUserId, offer.requestItemId) < offer.requestQty) {
            return "You do not have enough of the requested item to complete this trade.";
        }

        removeInventoryItem(offer.fromUserId, offer.offerItemId, offer.offerQty);
        removeInventoryItem(offer.toUserId, offer.requestItemId, offer.requestQty);
        addInventoryItem(offer.toUserId, offer.offerItemId, offer.offerQty);
        addInventoryItem(offer.fromUserId, offer.requestItemId, offer.requestQty);

        offer.status = "accepted";
        offer.updatedAt = Date.now();
        saveTradeStore();
        return `Trade #${offer.id} accepted and completed.`;
    },
    tradedecline: async interaction => {
        const offerId = Number.parseInt(interaction.options.getString("offer_id", true), 10);
        if (!Number.isFinite(offerId)) return "Invalid trade selection.";
        const offer = getOpenTradeOffer(offerId);
        if (!offer) return "Trade offer not found or already closed.";
        if (offer.toUserId !== interaction.user.id && offer.fromUserId !== interaction.user.id) {
            return "You are not part of this trade.";
        }
        offer.status = offer.toUserId === interaction.user.id ? "declined" : "cancelled";
        offer.updatedAt = Date.now();
        saveTradeStore();
        return `Trade #${offer.id} ${offer.status}.`;
    },
    points: async interaction => {
        const target = interaction.options.getUser("user") || interaction.user;
        ensureUser(target.id);
        return `${target.username} has ${getPoints(target.id)} Access Points.`;
    },
    xp: async interaction => {
        const userId = interaction.user.id;
        const user = ensureUser(userId);
        const accessPoints = getPoints(userId);
        const badge = getAccessPointBadge(accessPoints);
        const prestigeBadge = getPrestigeBadge(user.prestige);
        const pmcLevel = getPmcLevel(user.pmcXP);
        const tierVisual = getPmcTierVisual(pmcLevel);
        const engagementLevel = getXPLevel(user.xp);
        const currentThreshold = engagementLevel > 0 ? XP_LEVEL_THRESHOLDS[engagementLevel - 1] : 0;
        const nextThreshold = XP_LEVEL_THRESHOLDS[engagementLevel] ?? currentThreshold;
        const levelSpan = Math.max(1, nextThreshold - currentThreshold);
        const xpIntoLevel = Math.max(0, user.xp - currentThreshold);
        const xpToNextLevel = nextThreshold > currentThreshold ? Math.max(0, nextThreshold - user.xp) : 0;
        const progressPercent = nextThreshold > currentThreshold
            ? formatProgressPercent(xpIntoLevel / levelSpan)
            : "100%";
        const lastXpAt = user.lastXP > 0 ? `<t:${Math.floor(user.lastXP / 1000)}:R>` : "No XP earned yet";
        const streakText = user.dailyStreak > 0 ? `${user.dailyStreak} day streak` : "No active streak";
        const achievements = user.achievements.length > 0
            ? user.achievements.slice(0, 4).join("\n")
            : "No achievements yet";
        const embed = new EmbedBuilder()
            .setColor(prestigeBadge.color)
            .setTitle("📈 XP Progress Center")
            .setDescription([
                `🧠 **Live XP:** ${user.xp.toLocaleString()}`,
                `🎚️ **Level ${engagementLevel}**${nextThreshold > currentThreshold ? ` • ${xpToNextLevel.toLocaleString()} XP to level ${engagementLevel + 1}` : " • Level cap reached"}`,
                `${xpBar(user.xp)}`
            ].join("\n"))
            .setThumbnail("https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c8.png")
            .addFields(
                {
                    name: "🎯 Engagement",
                    value: [
                        `Level: **${engagementLevel.toLocaleString()}**`,
                        `In level: **${xpIntoLevel.toLocaleString()} / ${levelSpan.toLocaleString()} XP**`,
                        `Completion: **${progressPercent}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "💼 Economy",
                    value: [
                        `🪙 FN Token$: **${user.fnTokens.toLocaleString()}**`,
                        `🏦 Banked: **${user.bankTokens.toLocaleString()}**`,
                        `🎯 Access Points: **${accessPoints.toLocaleString()}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🔥 Activity",
                    value: [
                        `📆 ${streakText}`,
                        `⏱️ Last XP: **${lastXpAt}**`,
                        `🏆 Achievements: **${user.achievements.length.toLocaleString()}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🪖 Raid Track",
                    value: [
                        `PMC Level: **${pmcLevel.toLocaleString()}**`,
                        `Raid XP: **${user.pmcXP.toLocaleString()}**`,
                        `Tier: **${tierVisual.label}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🌟 Status",
                    value: [
                        `Prestige: **${user.prestige.toLocaleString()}**`,
                        `Badge: **${prestigeBadge.label}**`,
                        `Access Tier: **${badge.label}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "✨ Recent Unlocks",
                    value: achievements,
                    inline: true
                }
            )
            .setFooter({ text: "Live data is pulled from persisted XP state." });
        return JSON.stringify({ embed: embed.toJSON() });
    },
    pmc: async interaction => buildPmcProfilePayload(interaction.user),
    xpstats: async interaction => {
        const user = ensureUser(interaction.user.id);
        const gameStats = getGameStatsSummary(interaction.user.id);
        const prestigeBadge = getPrestigeBadge(user.prestige);
        const engagementLevel = getXPLevel(user.xp);
        const pmcLevel = getPmcLevel(user.pmcXP);
        const tierVisual = getPmcTierVisual(pmcLevel);
        const currentThreshold = engagementLevel > 0 ? XP_LEVEL_THRESHOLDS[engagementLevel - 1] : 0;
        const nextThreshold = XP_LEVEL_THRESHOLDS[engagementLevel] ?? currentThreshold;
        const levelSpan = Math.max(1, nextThreshold - currentThreshold);
        const xpIntoLevel = Math.max(0, user.xp - currentThreshold);
        const xpToNextLevel = nextThreshold > currentThreshold ? Math.max(0, nextThreshold - user.xp) : 0;
        const progressPercent = nextThreshold > currentThreshold
            ? formatProgressPercent(xpIntoLevel / levelSpan)
            : "100%";
        const lastXpAt = user.lastXP > 0 ? `<t:${Math.floor(user.lastXP / 1000)}:R>` : "No XP earned yet";
        const achievements = user.achievements.length > 0
            ? user.achievements.slice(0, 6).join("\n")
            : "No achievements yet";
        const pmcProgress = getPmcProgress(user.pmcXP);
        const embed = new EmbedBuilder()
            .setColor(prestigeBadge.color)
            .setTitle("📊 XP Intelligence Report")
            .setDescription([
                `🧠 **Engagement XP:** ${user.xp.toLocaleString()}`,
                `🎚️ **Level ${engagementLevel}**${nextThreshold > currentThreshold ? ` • ${xpToNextLevel.toLocaleString()} XP to level ${engagementLevel + 1}` : " • Level cap reached"}`,
                `${xpBar(user.xp)}`
            ].join("\n"))
            .setThumbnail("https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4ca.png")
            .addFields(
                {
                    name: "🎯 Engagement Breakdown",
                    value: [
                        `Level: **${engagementLevel.toLocaleString()}**`,
                        `In level: **${xpIntoLevel.toLocaleString()} / ${levelSpan.toLocaleString()} XP**`,
                        `Completion: **${progressPercent}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🔥 Activity Signals",
                    value: [
                        `📆 Daily streak: **${user.dailyStreak.toLocaleString()}**`,
                        `⏱️ Last XP: **${lastXpAt}**`,
                        `🏆 Achievements: **${user.achievements.length.toLocaleString()}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "💼 Economy Snapshot",
                    value: [
                        `🪙 Wallet: **${user.fnTokens.toLocaleString()}**`,
                        `🏦 Bank: **${user.bankTokens.toLocaleString()}**`,
                        `🎯 Access Points: **${getPoints(interaction.user.id).toLocaleString()}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🪖 Raid Progression",
                    value: [
                        `PMC Level: **${pmcLevel.toLocaleString()}**`,
                        `Raid XP: **${user.pmcXP.toLocaleString()}**`,
                        `Next PMC Level: **${pmcProgress.needForNext.toLocaleString()} XP away**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🌟 Status Badges",
                    value: [
                        `Prestige: **${user.prestige.toLocaleString()}**`,
                        `Prestige Badge: **${prestigeBadge.label}**`,
                        `PMC Tier: **${tierVisual.label}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🎰 Game Record",
                    value: [
                        `Sessions: **${gameStats.casinoPlayed.toLocaleString()}**`,
                        `W/L/P: **${gameStats.wins}/${gameStats.losses}/${gameStats.pushes}**`,
                        `Net: **${gameStats.net >= 0 ? `+${gameStats.net}` : gameStats.net} FN Token$**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "✨ Recent Unlocks",
                    value: achievements,
                    inline: false
                }
            )
            .setFooter({ text: "Detailed progression data is sourced from persisted state." });
        return JSON.stringify({ embed: embed.toJSON() });
    },
    health: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const embed = buildHealthEmbed();
        return JSON.stringify({ embed: embed.toJSON() });
    },
    balancereport: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const embed = buildBalanceReportEmbed("manual_command");
        return JSON.stringify({ embed: embed.toJSON() });
    },
    incident: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;

        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const fix = interaction.options.getBoolean("fix") || false;
        const restartAfter = interaction.options.getBoolean("restart") || false;
        const roleReport = await collectRoleSanityReport(guild);
        const ticketReport = await collectTicketSanityReport(guild);

        const issueCount =
            roleReport.missing.length
            + roleReport.hierarchyBlocked.length
            + roleReport.multiTierMembers
            + ticketReport.missingChannels
            + ticketReport.duplicateOpenOwners
            + ticketReport.panelMissing
            + ticketReport.slaBreaches;

        let remediationLines: string[] = ["No remediation requested."];
        if (fix) {
            const roleFix = await runRoleSanityFix(guild, interaction.user.id, interaction.channelId || null);
            const ticketFix = await runTicketSanityFix(guild);
            remediationLines = [
                `Role remediation: ${roleFix.started ? "started" : `skipped (${roleFix.reason || "unknown"})`}`,
                `Ticket remediation: removed missing ${ticketFix.removedDeleted}, removed inaccessible ${ticketFix.removedInaccessible}, deduped ${ticketFix.deduped}, panel backfill ${ticketFix.panelBackfilled}`
            ];
        }
        if (restartAfter) {
            remediationLines.push("Restart: scheduled after incident response is sent.");
        }

        const embed = new EmbedBuilder()
            .setColor(issueCount > 0 ? 0xf59e0b : 0x22c55e)
            .setTitle("🚨 Incident Triage")
            .setDescription(issueCount > 0 ? "Issues detected. Review sections below." : "No major issues detected.")
            .addFields(
                {
                    name: "Role Integrity",
                    value: [
                        `Missing role entries: ${roleReport.missing.length}`,
                        `Hierarchy-blocked roles: ${roleReport.hierarchyBlocked.length}`,
                        `Members with multiple tier roles: ${roleReport.multiTierMembers}`,
                        `Manage Roles available: ${roleReport.canManageRoles ? "yes" : "no"}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Ticket Integrity",
                    value: [
                        `Missing channels: ${ticketReport.missingChannels}`,
                        `Duplicate active owners: ${ticketReport.duplicateOpenOwners}`,
                        `Active tickets missing panel IDs: ${ticketReport.panelMissing}`,
                        `Active SLA breaches: ${ticketReport.slaBreaches}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Remediation",
                    value: remediationLines.join("\n"),
                    inline: false
                },
                {
                    name: "Quick Follow-Up",
                    value: "Run `/rolesanity` and `/ticketsanity` for detailed views. Run with `fix:true` for guided remediation.",
                    inline: false
                }
            )
            .setFooter({ text: `Issue score: ${issueCount} | Triggered by ${interaction.user.username}` })
            .setTimestamp(new Date());

        appendAuditEvent("incident_run", {
            guildId: guild.id,
            userId: interaction.user.id,
            issueCount,
            fixRequested: fix,
            restartRequested: restartAfter,
            roleMissing: roleReport.missing.length,
            roleHierarchyBlocked: roleReport.hierarchyBlocked.length,
            roleMultiTierMembers: roleReport.multiTierMembers,
            ticketMissingChannels: ticketReport.missingChannels,
            ticketDuplicateOwners: ticketReport.duplicateOpenOwners,
            ticketPanelMissing: ticketReport.panelMissing,
            ticketSlaBreaches: ticketReport.slaBreaches
        });

        if (restartAfter) {
            setTimeout(() => {
                requestManagedRestart("incident_command", interaction.user.id);
            }, 2500).unref();
        }

        return JSON.stringify({ embed: embed.toJSON() });
    },
    xpverify: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;

        const target = interaction.options.getUser("user", true);
        const snapshot = getXpPersistenceSnapshot(target.id);
        const effectiveXp = Math.max(snapshot.memoryXp, snapshot.primaryXp ?? 0, snapshot.backupXp ?? 0);
        const level = getXPLevel(effectiveXp);
        const unlocked = XP_ROLE_TIERS.filter(entry => effectiveXp >= entry.xp).pop();

        let roleStatus = "No XP tier unlocked yet (below first threshold).";
        if (interaction.guild && unlocked) {
            await interaction.guild.roles.fetch().catch(() => undefined);
            const role = interaction.guild.roles.cache.get(unlocked.roleId) || null;
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            const hasRole = Boolean(role && member?.roles.cache.has(role.id));
            const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
            const hierarchyBlocked = Boolean(role && me && role.position >= me.roles.highest.position);

            roleStatus = [
                `Expected tier: ${unlocked.name} (${unlocked.xp.toLocaleString()} XP)`,
                `Role exists: ${role ? "yes" : "no"}`,
                `Member has role: ${hasRole ? "yes" : "no"}`,
                `Hierarchy blocked: ${hierarchyBlocked ? "yes" : "no"}`
            ].join("\n");
        }

        const mismatch = (
            snapshot.primaryXp !== null && snapshot.primaryXp !== snapshot.memoryXp
        ) || (
            snapshot.backupXp !== null && snapshot.backupXp !== snapshot.memoryXp
        );

        const embed = new EmbedBuilder()
            .setColor(mismatch ? 0xf59e0b : 0x22c55e)
            .setTitle("🔎 XP Persistence Verify")
            .setDescription(`Diagnostics for <@${target.id}>`) 
            .addFields(
                {
                    name: "XP State",
                    value: [
                        `Effective XP: ${effectiveXp.toLocaleString()}`,
                        `Level: ${level}`,
                        `Memory XP: ${snapshot.memoryXp.toLocaleString()}`,
                        `Primary XP: ${snapshot.primaryXp === null ? "missing" : snapshot.primaryXp.toLocaleString()}`,
                        `Backup XP: ${snapshot.backupXp === null ? "missing" : snapshot.backupXp.toLocaleString()}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Write Metadata",
                    value: [
                        `Memory lastXP: ${toIsoOrNever(snapshot.memoryLastXp)}`,
                        `Primary lastXP: ${toIsoOrNever(snapshot.primaryLastXp)}`,
                        `Backup lastXP: ${toIsoOrNever(snapshot.backupLastXp)}`,
                        `points.json size: ${Math.max(0, snapshot.pointsFileSize)} bytes`,
                        `points.json.bak size: ${Math.max(0, snapshot.pointsBackupSize)} bytes`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Role Assignment Check",
                    value: roleStatus,
                    inline: false
                }
            )
            .setFooter({ text: mismatch ? "XP mismatch detected: run /xprolesync after confirming bot instance consistency." : "XP persistence healthy." });

        return JSON.stringify({ embed: embed.toJSON() });
    },
    rolesanity: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";
        const fix = interaction.options.getBoolean("fix") || false;
        const report = await collectRoleSanityReport(guild);
        let fixNote = "No remediation requested.";

        if (fix) {
            const fixResult = await runRoleSanityFix(guild, interaction.user.id, interaction.channelId || null);
            fixNote = fixResult.started
                ? "Remediation started: background XP role sync launched."
                : `Remediation skipped: ${fixResult.reason || "unknown reason"}`;
        }

        const embed = new EmbedBuilder()
            .setColor((report.missing.length || report.hierarchyBlocked.length || report.multiTierMembers > 0) ? 0xf59e0b : 0x22c55e)
            .setTitle("🧪 Role Sanity Audit")
            .setDescription("XP role readiness and assignment integrity checks.")
            .addFields(
                {
                    name: "Coverage",
                    value: [
                        `Configured tiers: ${report.configuredTierCount}`,
                        `Existing tier roles: ${report.existingTierCount}`,
                        `Missing tier roles: ${report.missing.length}`,
                        `Members with multiple tier roles: ${report.multiTierMembers}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Bot Permissions and Hierarchy",
                    value: [
                        `Manage Roles: ${report.canManageRoles ? "yes" : "no"}`,
                        `Bot highest role position: ${report.botHighestRolePosition}`,
                        `Blocked tier roles by hierarchy: ${report.hierarchyBlocked.length}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Fix Mode",
                    value: fixNote,
                    inline: false
                }
            );

        if (report.missing.length) {
            embed.addFields({
                name: "Missing Roles",
                value: report.missing.slice(0, 12).map(tier => `${tier.name} (${tier.xp.toLocaleString()} XP)`).join("\n"),
                inline: false
            });
        }

        if (report.hierarchyBlocked.length) {
            embed.addFields({
                name: "Hierarchy Blocked Roles",
                value: report.hierarchyBlocked.slice(0, 12).map(item => `${item.tier.name} (${item.tier.xp.toLocaleString()} XP)`).join("\n"),
                inline: false
            });
        }

        appendAuditEvent("rolesanity_run", {
            guildId: guild.id,
            userId: interaction.user.id,
            missingRoles: report.missing.length,
            hierarchyBlockedRoles: report.hierarchyBlocked.length,
            multiTierMembers: report.multiTierMembers,
            fixRequested: fix
        });

        return JSON.stringify({ embed: embed.toJSON() });
    },
    ticketsanity: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";
        const fix = interaction.options.getBoolean("fix") || false;
        let fixSummary = "No remediation requested.";

        if (fix) {
            const fixResult = await runTicketSanityFix(guild);
            fixSummary = [
                `Removed missing-channel tickets: ${fixResult.removedDeleted}`,
                `Removed inaccessible-owner tickets: ${fixResult.removedInaccessible}`,
                `Deduped active tickets: ${fixResult.deduped}`,
                `Panel IDs backfilled: ${fixResult.panelBackfilled}`
            ].join("\n");
        }

        const report = await collectTicketSanityReport(guild);

        const embed = new EmbedBuilder()
            .setColor((report.missingChannels || report.duplicateOpenOwners || report.slaBreaches) ? 0xf59e0b : 0x22c55e)
            .setTitle("🧪 Ticket Sanity Audit")
            .setDescription("Ticket store integrity and live channel consistency checks.")
            .addFields(
                {
                    name: "Ticket State Totals",
                    value: [
                        `Total: ${report.total}`,
                        `Open: ${report.open}`,
                        `Claimed: ${report.claimed}`,
                        `Archived: ${report.archived}`,
                        `Resolved: ${report.resolved}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Integrity",
                    value: [
                        `Missing channels: ${report.missingChannels}`,
                        `Owners with duplicate active tickets: ${report.duplicateOpenOwners}`,
                        `Active tickets missing panelMessageId: ${report.panelMissing}`,
                        `SLA breaches (active): ${report.slaBreaches}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Fix Mode",
                    value: fixSummary,
                    inline: false
                }
            );

        appendAuditEvent("ticketsanity_run", {
            guildId: guild.id,
            userId: interaction.user.id,
            total: report.total,
            missingChannels: report.missingChannels,
            duplicateOpenOwners: report.duplicateOpenOwners,
            panelMissing: report.panelMissing,
            slaBreaches: report.slaBreaches,
            fixRequested: fix
        });

        return JSON.stringify({ embed: embed.toJSON() });
    },
    ticketops: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;

        const lock = readInstanceLockState();
        const recent = readRecentTicketOpsEvents(8);
        const guild = interaction.guild;
        const ticketTotals = guild
            ? ticketStore.tickets.filter(t => t.guildId === guild.id)
            : [];
        const activeCount = ticketTotals.filter(t => normalizeTicketStatus(t.status) === "open" || normalizeTicketStatus(t.status) === "claimed").length;

        const embed = new EmbedBuilder()
            .setColor(0x0ea5e9)
            .setTitle("🧭 Ticket Runtime Ops")
            .setDescription("Live diagnostics for singleton process lock, ticket-create lock state, and recent dedupe telemetry.")
            .addFields(
                {
                    name: "Process Lock",
                    value: [
                        `Current PID: ${process.pid}`,
                        `Holding lock in-memory: ${hasInstanceLock ? "yes" : "no"}`,
                        `Lock file exists: ${lock.exists ? "yes" : "no"}`,
                        `Lock owner PID: ${lock.ownerPid || "none"}`,
                        `Lock owner alive: ${lock.ownerAlive ? "yes" : "no"}`,
                        `Owner started: ${toIsoOrNever(lock.ownerStartedAt)}`,
                        `Lock path: ${INSTANCE_LOCK_PATH}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Ticket Create Locks",
                    value: [
                        `In-flight owner locks: ${inFlightTicketCreates.size}`,
                        `Entries:`,
                        describeInFlightTicketCreateLocks(5)
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Ticket Store Snapshot",
                    value: [
                        `Guild tickets tracked: ${ticketTotals.length}`,
                        `Guild active tickets: ${activeCount}`,
                        `Data file: ${statLabel(TICKET_DATA_FILE)}`,
                        `Data backup: ${statLabel(`${TICKET_DATA_FILE}.bak`)}`,
                        `Bot uptime: ${formatDuration(process.uptime())}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "Recent Ticket Ops Events",
                    value: recent.length ? recent.join("\n") : "No recent ticket ops events found.",
                    inline: false
                }
            )
            .setFooter({ text: `Triggered by ${interaction.user.username}` })
            .setTimestamp(new Date());

        appendAuditEvent("ticketops_run", {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            currentPid: process.pid,
            hasInstanceLock,
            lockOwnerPid: lock.ownerPid,
            lockOwnerAlive: lock.ownerAlive,
            inFlightLocks: inFlightTicketCreates.size,
            activeTickets: activeCount
        });

        return JSON.stringify({ embed: embed.toJSON() });
    },
    ticket: async interaction => {
        return await ticketCommandHandlers.ticket(interaction);
    },
    reportintake: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const target = interaction.options.getUser("user", true);
        const summary = interaction.options.getString("summary", true).trim();
        const details = (interaction.options.getString("details") || "").trim();
        const evidence = (interaction.options.getString("evidence") || "").trim() || null;

        const result = await submitFormalUserReport({
            guild,
            reporterId: interaction.user.id,
            targetUser: target,
            summary,
            details,
            evidence
        });

        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(result.flagged ? 0xdc2626 : 0x0ea5e9)
                .setTitle("🚨 Formal User Report Filed")
                .addFields(
                    { name: "Report ID", value: `#${result.entry.id}`, inline: true },
                    { name: "Target", value: `<@${target.id}>`, inline: true },
                    { name: "Reporter", value: `<@${interaction.user.id}>`, inline: true },
                    { name: "Summary", value: result.entry.summary, inline: false },
                    { name: "Evidence", value: evidence || "Not provided", inline: false },
                    { name: "Total Reports On User", value: `${result.totalReportsForTarget}${result.flagged ? " 🚩" : ""}`, inline: true },
                    { name: "Logged Channel", value: `<#${REPORT_LOG_CHANNEL_ID}>`, inline: true }
                )
                .setTimestamp(new Date())
                .toJSON(),
            ephemeral: true
        });
    },
    reportprofile: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const target = interaction.options.getUser("user", true);
        const member = await guild.members.fetch(target.id).catch(() => null);
        const reports = getGuildUserReports(guild.id)
            .filter(report => report.targetUserId === target.id)
            .sort((a, b) => b.createdAt - a.createdAt);

        const flagged = reports.length >= 10;
        const recent = reports.slice(0, 8).map(report => {
            const state = report.status === "resolved" ? "resolved" : "open";
            return `#${report.id} [${state}] by <@${report.reporterId}> | ${report.summary.slice(0, 80)} | <t:${Math.floor(report.createdAt / 1000)}:R>`;
        });

        appendAuditEvent("report_profile_view", {
            guildId: guild.id,
            actorId: interaction.user.id,
            targetUserId: target.id,
            totalReports: reports.length,
            flagged
        });

        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(flagged ? 0xdc2626 : 0x0ea5e9)
                .setTitle(`Report Profile: ${target.username}`)
                .addFields(
                    { name: "Discord User", value: `<@${target.id}>`, inline: true },
                    { name: "User ID", value: target.id, inline: true },
                    { name: "Account Created", value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`, inline: true },
                    { name: "Joined Server", value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Unknown", inline: true },
                    { name: "Reports Filed Against User", value: `${reports.length}`, inline: true },
                    { name: "Risk Flag", value: flagged ? "🚩 Flagged (10+ reports)" : "No flag", inline: true },
                    { name: "Recent Reports", value: recent.length ? recent.join("\n") : "No reports filed against this user.", inline: false }
                )
                .setFooter({ text: `Report logs channel: ${REPORT_LOG_CHANNEL_ID}` })
                .setTimestamp(new Date())
                .toJSON(),
            ephemeral: true
        });
    },
    ticketintake: async () => {
        return "Ticket intake modal is ready. Run /ticketintake again if you did not receive the popup.";
    },
    ticketforce: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const reason = (interaction.options.getString("reason", true) || "General support").slice(0, 180);
        const priority = normalizeTicketPriority(interaction.options.getString("priority") || "normal");
        const created = await createTicketChannel(interaction.guild!, interaction.user.id, reason, priority, true);
        if (created.error) return created.error;
        const ticket = created.channelId ? findTicketByChannel(created.channelId) : null;
        return buildTicketCommandEmbedPayload(
            "🎫 Ticket Force-Opened",
            "Duplicate/KB deflection bypassed by manual override.",
            ticket || undefined,
            [
                { name: "📝 Reason", value: reason, inline: false },
                { name: "⚠️ Override", value: "Deflection bypass enabled.", inline: true }
            ]
        );
    },
    ticketpanel: async interaction => {
        return await ticketCommandHandlers.ticketpanel(interaction);
    },
    claimticket: async interaction => {
        return await ticketCommandHandlers.claimticket(interaction);
    },
    ticketassign: async interaction => {
        return await ticketCommandHandlers.ticketassign(interaction);
    },
    ticketstatus: async interaction => {
        return await ticketCommandHandlers.ticketstatus(interaction);
    },
    reopenticket: async interaction => {
        return await ticketCommandHandlers.reopenticket(interaction);
    },
    closeticket: async interaction => {
        return await ticketCommandHandlers.closeticket(interaction);
    },
    resolveticket: async interaction => {
        return await ticketCommandHandlers.resolveticket(interaction);
    },
    ticketconfig: async interaction => {
        return await ticketCommandHandlers.ticketconfig(interaction);
    },
    tickets: async interaction => {
        return await ticketCommandHandlers.tickets(interaction);
    },
    ticketanalytics: async interaction => {
        return await ticketCommandHandlers.ticketanalytics(interaction);
    },
    reportqueue: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const openReports = getGuildUserReports(guild.id)
            .filter(report => report.status === "open")
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 25);

        if (!openReports.length) return "No active formal reports right now.";

        const lines = openReports.map(report => `#${report.id} target <@${report.targetUserId}> | reporter <@${report.reporterId}> | ${report.summary.slice(0, 90)} | <t:${Math.floor(report.createdAt / 1000)}:R>`);

        appendAuditEvent("report_queue_view", {
            guildId: guild.id,
            actorId: interaction.user.id,
            total: openReports.length,
            source: "admin_report_ledger"
        });

        return ["🚨 Formal Report Queue", `Showing ${openReports.length} open report(s)`, "", ...lines].join("\n");
    },
    reportresolve: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const target = interaction.options.getUser("user", true);
        const action = interaction.options.getString("action", true);
        const reason = (interaction.options.getString("reason") || "Report review completed").trim();
        const reportId = interaction.options.getInteger("report_id") || undefined;

        const resolved = await resolveFormalUserReport({
            guild,
            actorId: interaction.user.id,
            targetUserId: target.id,
            action,
            reason,
            reportId
        });

        if (!resolved.ok) return resolved.error;

        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(0x16a34a)
                .setTitle("✅ Report Closed")
                .addFields(
                    { name: "Report ID", value: `#${resolved.entry.id}`, inline: true },
                    { name: "Target", value: `<@${target.id}>`, inline: true },
                    { name: "Resolved By", value: `<@${interaction.user.id}>`, inline: true },
                    { name: "Disposition", value: action, inline: true },
                    { name: "Reason", value: reason, inline: false },
                    { name: "Remaining Open Reports On User", value: `${resolved.remainingOpenForTarget}`, inline: true },
                    { name: "Logged Channel", value: `<#${REPORT_LOG_CHANNEL_ID}>`, inline: true }
                )
                .setTimestamp(new Date())
                .toJSON(),
            ephemeral: true
        });
    },
    reportanalytics: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const scoped = getGuildUserReports(guild.id);
        const open = scoped.filter(report => report.status === "open").length;
        const resolved = scoped.filter(report => report.status === "resolved").length;
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const createdLast7d = scoped.filter(report => report.createdAt >= sevenDaysAgo).length;
        const resolvedLast7d = scoped.filter(report => report.status === "resolved" && (report.resolvedAt || 0) >= sevenDaysAgo).length;
        const byTarget = new Map<string, number>();
        for (const report of scoped) {
            byTarget.set(report.targetUserId, (byTarget.get(report.targetUserId) || 0) + 1);
        }
        const flaggedUsers = [...byTarget.values()].filter(count => count >= 10).length;

        appendAuditEvent("report_analytics", {
            guildId: guild.id,
            userId: interaction.user.id,
            total: scoped.length,
            open,
            resolved,
            createdLast7d,
            resolvedLast7d,
            flaggedUsers
        });

        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(0xb91c1c)
                .setTitle("🚨 Report Analytics")
                .setDescription("Admin report ledger throughput and risk snapshot.")
                .addFields(
                    { name: "Case Totals", value: [`Total: ${scoped.length}`, `Open: ${open}`, `Resolved: ${resolved}`].join("\n"), inline: false },
                    { name: "7-Day Flow", value: [`Created: ${createdLast7d}`, `Resolved: ${resolvedLast7d}`].join("\n"), inline: true },
                    { name: "Risk", value: `Flagged users (10+ reports): ${flaggedUsers}`, inline: true },
                    { name: "Log Channel", value: `<#${REPORT_LOG_CHANNEL_ID}>`, inline: false }
                )
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    reportsearch: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;

        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;

        const guild = interaction.guild!;
        const owner = interaction.options.getUser("owner");
        const status = interaction.options.getString("status");
        const query = (interaction.options.getString("query") || "").trim().toLowerCase();
        const page = Math.max(1, interaction.options.getInteger("page") || 1);
        const pageSize = Math.max(5, Math.min(20, interaction.options.getInteger("page_size") || 10));

        let scoped = getGuildUserReports(guild.id);

        if (owner) {
            scoped = scoped.filter(report => report.reporterId === owner.id);
        }
        if (status && (status === "open" || status === "resolved")) {
            scoped = scoped.filter(report => report.status === status);
        }
        if (query) {
            scoped = scoped.filter(report => {
                const haystack = [
                    report.summary,
                    report.details,
                    report.evidence || "",
                    report.targetTag,
                    report.targetUserId,
                    report.reporterId
                ].join(" ").toLowerCase();
                return haystack.includes(query);
            });
        }

        scoped = scoped.sort((a, b) => b.createdAt - a.createdAt);
        const total = scoped.length;
        if (!total) {
            return "No formal reports matched your filters.";
        }

        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * pageSize;
        const visible = scoped.slice(start, start + pageSize);

        const lines = visible.map(report => {
            const state = report.status === "resolved" ? "resolved" : "open";
            return `#${report.id} [${state}] target <@${report.targetUserId}> | reporter <@${report.reporterId}> | ${report.summary.slice(0, 90)} | <t:${Math.floor(report.createdAt / 1000)}:R>`;
        });

        appendAuditEvent("report_search", {
            guildId: guild.id,
            actorId: interaction.user.id,
            filters: {
                ownerId: owner?.id || null,
                status: status || null,
                query: query || null,
                page: safePage,
                pageSize
            },
            total
        });

        const filterSummary = [
            owner ? `owner=<@${owner.id}>` : null,
            status ? `status=${status}` : null,
            query ? `query=${query}` : null
        ].filter(Boolean).join(", ") || "none";

        return [
            "🚨 Formal Report Search Results",
            `Filters: ${filterSummary}`,
            `Page ${safePage}/${totalPages} | Showing ${visible.length}/${total}`,
            "",
            ...lines
        ].join("\n");
    },
    giveaway: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const prize = interaction.options.getString("prize", true).slice(0, 200);
        const durationRaw = interaction.options.getString("duration", true);
        const durationMs = parseDurationMs(durationRaw);
        if (!durationMs) return "Invalid duration. Use values like 30m, 6h, or 2d.";
        const winnerCount = Math.max(1, Math.min(20, interaction.options.getInteger("winners") || 1));
        const description = (interaction.options.getString("description") || "").slice(0, 1000);
        const roleRequired = interaction.options.getRole("role_required");
        const mentionRole = interaction.options.getRole("mention_role");
        const mentionUser = interaction.options.getUser("mention_user");
        const pingEveryone = Boolean(interaction.options.getBoolean("ping_everyone"));
        const channel = await resolveConfiguredGiveawayChannel(guild);
        if (!channel) return `Configured giveaway channel ${GIVEAWAY_CHANNEL_ID} is missing or not a text channel.`;

        const giveaway = await createAndPostGiveaway({
            guild,
            channel,
            hostId: interaction.user.id,
            prize,
            description,
            durationMs,
            winnerCount,
            roleRequiredId: roleRequired ? roleRequired.id : null,
            rewardKind: "generic",
            announcementContent: buildGiveawayAnnouncement({ prize, mentionRoleId: mentionRole?.id || null, mentionUserId: mentionUser?.id || null, pingEveryone }),
            mentionRoleIds: mentionRole ? [mentionRole.id] : [],
            mentionUserIds: mentionUser ? [mentionUser.id] : [],
            mentionEveryone: pingEveryone
        });
        if (!giveaway) return "Failed to post giveaway message in the target channel.";

        appendAuditEvent("giveaway_created", {
            guildId: guild.id,
            giveawayId: giveaway.id,
            hostId: interaction.user.id,
            channelId: channel.id,
            prize,
            durationMs,
            winnerCount,
            roleRequiredId: roleRequired?.id || null,
            mentionRoleId: mentionRole?.id || null,
            mentionUserId: mentionUser?.id || null,
            pingEveryone
        });
        await sendGiveawayLog(guild.id, `Giveaway #${giveaway.id} Created`, [
            { name: "Prize", value: prize, inline: false },
            { name: "Reward Type", value: "Generic", inline: true },
            { name: "Host", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Channel", value: `<#${channel.id}>`, inline: true },
            { name: "Winners", value: `${winnerCount}`, inline: true },
            { name: "Duration", value: durationRaw, inline: true },
            { name: "Role Requirement", value: roleRequired ? `<@&${roleRequired.id}>` : "None", inline: true }
        ]);

        return JSON.stringify({ embed: new EmbedBuilder().setColor(0xf59e0b).setTitle("🎉 Giveaway Created").setDescription(`Giveaway #${giveaway.id} is live in <#${channel.id}>.`).addFields({ name: "Prize", value: prize, inline: false }, { name: "Duration", value: durationRaw, inline: true }, { name: "Winners", value: `${winnerCount}`, inline: true }).toJSON() });
    },
    itemgiveaway: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const itemId = interaction.options.getString("item", true).trim().toLowerCase();
        const item = ITEM_DEFS[itemId];
        if (!item) return `Unknown raid item: ${itemId}`;
        const quantity = Math.max(1, interaction.options.getInteger("quantity", true));
        const durationRaw = interaction.options.getString("duration", true);
        const durationMs = parseDurationMs(durationRaw);
        if (!durationMs) return "Invalid duration. Use values like 30m, 6h, or 2d.";
        const winnerCount = Math.max(1, Math.min(20, interaction.options.getInteger("winners") || 1));
        const description = (interaction.options.getString("description") || "").slice(0, 1000);
        const title = (interaction.options.getString("title") || `${item.name} Giveaway`).slice(0, 200);
        const roleRequired = interaction.options.getRole("role_required");
        const mentionRole = interaction.options.getRole("mention_role");
        const mentionUser = interaction.options.getUser("mention_user");
        const pingEveryone = Boolean(interaction.options.getBoolean("ping_everyone"));
        const channel = await resolveConfiguredGiveawayChannel(guild);
        if (!channel) return `Configured giveaway channel ${GIVEAWAY_CHANNEL_ID} is missing or not a text channel.`;

        const giveaway = await createAndPostGiveaway({
            guild,
            channel,
            hostId: interaction.user.id,
            prize: title,
            description,
            durationMs,
            winnerCount,
            roleRequiredId: roleRequired ? roleRequired.id : null,
            rewardKind: "item",
            rewardItemId: itemId,
            rewardQty: quantity,
            announcementContent: buildGiveawayAnnouncement({ prize: title, mentionRoleId: mentionRole?.id || null, mentionUserId: mentionUser?.id || null, pingEveryone }),
            mentionRoleIds: mentionRole ? [mentionRole.id] : [],
            mentionUserIds: mentionUser ? [mentionUser.id] : [],
            mentionEveryone: pingEveryone
        });
        if (!giveaway) return "Failed to post raid item giveaway message in the target channel.";

        appendAuditEvent("giveaway_item_created", {
            guildId: guild.id,
            giveawayId: giveaway.id,
            hostId: interaction.user.id,
            channelId: channel.id,
            itemId,
            quantity,
            durationMs,
            winnerCount,
            roleRequiredId: roleRequired?.id || null,
            mentionRoleId: mentionRole?.id || null,
            mentionUserId: mentionUser?.id || null,
            pingEveryone
        });
        await sendGiveawayLog(guild.id, `Giveaway #${giveaway.id} Created`, [
            { name: "Prize", value: title, inline: false },
            { name: "Reward Type", value: "Raid Item", inline: true },
            { name: "Raid Item", value: `${item.name} (${itemId}) x${quantity}`, inline: false },
            { name: "Host", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Channel", value: `<#${channel.id}>`, inline: true },
            { name: "Winners", value: `${winnerCount}`, inline: true }
        ]);

        return JSON.stringify({ embed: new EmbedBuilder().setColor(0xf59e0b).setTitle("🎁 Raid Item Giveaway Created").setDescription(`Giveaway #${giveaway.id} is live in <#${channel.id}>.`).addFields({ name: "Raid Item", value: `${item.name} x${quantity}`, inline: false }, { name: "Duration", value: durationRaw, inline: true }, { name: "Winners", value: `${winnerCount}`, inline: true }).toJSON() });
    },
    raidgiveawaypanel: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            return "You need Manage Channels to post the raid item giveaway panel.";
        }
        if (!interaction.channel || !interaction.channel.isTextBased()) {
            return "This command requires a text channel.";
        }
        if (!("send" in interaction.channel) || interaction.channel.type !== ChannelType.GuildText) {
            return "This command requires a standard text channel.";
        }
        const payload = buildRaidItemGiveawayPanelPayload(interaction.guild!.name);
        await interaction.channel.send({ embeds: [payload.embed as APIEmbed], components: payload.components as any[], allowedMentions: { parse: [] } }).catch(() => null);
        return "✅ Raid item giveaway panel posted in this channel.";
    },
    giveawayedit: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const giveaway = getGiveawayById(interaction.options.getInteger("id", true));
        if (!giveaway) return "Giveaway not found.";
        if (giveaway.status !== "active") return "Only active giveaways can be edited.";
        const raw = interaction.options.getString("duration", true).trim().toLowerCase();
        const isNegative = raw.startsWith("-");
        const durationMs = parseDurationMs(isNegative ? raw.slice(1) : raw);
        if (!durationMs) return "Invalid duration adjustment. Use values like 30m, 6h, 2d, or -15m.";
        giveaway.endAt += isNegative ? -durationMs : durationMs;
        giveaway.endAt = Math.max(Date.now() + 10_000, giveaway.endAt);
        giveaway.updatedAt = Date.now();
        saveGiveawayStore();
        await syncGiveawayMessage(giveaway);
        appendAuditEvent("giveaway_edit", { guildId: giveaway.guildId, giveawayId: giveaway.id, actorId: interaction.user.id, adjustment: raw, endAt: giveaway.endAt });
        await sendGiveawayLog(giveaway.guildId, `Giveaway #${giveaway.id} Updated`, [
            { name: "Adjustment", value: raw, inline: true },
            { name: "New End", value: `<t:${Math.floor(giveaway.endAt / 1000)}:F>`, inline: true }
        ]);
        return `Giveaway #${giveaway.id} now ends <t:${Math.floor(giveaway.endAt / 1000)}:R>.`;
    },
    giveawayend: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const giveaway = getGiveawayById(interaction.options.getInteger("id", true));
        if (!giveaway) return "Giveaway not found.";
        if (giveaway.status !== "active") return "Giveaway is already closed.";
        await finalizeGiveaway(giveaway, "manual");
        return `Giveaway #${giveaway.id} ended.`;
    },
    giveawayreroll: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const giveaway = getGiveawayById(interaction.options.getInteger("id", true));
        if (!giveaway) return "Giveaway not found.";
        if (!giveaway.entries.length) return "This giveaway has no entrants to reroll.";
        await finalizeGiveaway(giveaway, "reroll");
        return `Giveaway #${giveaway.id} rerolled.`;
    },
    giveawaylist: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const scoped = giveawayStore.giveaways
            .filter(entry => !interaction.guildId || entry.guildId === interaction.guildId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 15);
        if (!scoped.length) return "No giveaways found.";
        return [
            "🎉 Giveaways",
            ...scoped.map(entry => `#${entry.id} [${entry.status}|${entry.rewardKind === "item" ? `item:${entry.rewardItemId || "unknown"}x${entry.rewardQty}` : "generic"}] ${entry.prize} | entries ${entry.entries.length} | winners ${entry.winnerCount} | end <t:${Math.floor(entry.endAt / 1000)}:R>`)
        ].join("\n");
    },
    giveaways: async interaction => {
        return await commandHandlers.giveawaylist(interaction);
    },
    ticketworkload: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild!;
        const active = ticketStore.tickets.filter(ticket => ticket.guildId === guild.id && ticket.status !== "resolved");
        const byAssignee = new Map<string, number>();
        for (const ticket of active) {
            const assignee = ticket.assignedToId || ticket.claimedById || "unassigned";
            byAssignee.set(assignee, (byAssignee.get(assignee) || 0) + 1);
        }

        const rows = Array.from(byAssignee.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([id, count]) => `${id === "unassigned" ? "Unassigned" : `<@${id}>`}: ${count}`);

        const breachRisk = active
            .filter(ticket => {
                const sla = getTicketSlaState(ticket, Date.now(), buildTicketSlaThresholds(ticket));
                return sla.firstResponseOverdue || sla.resolveOverdue;
            }).length;

        const embed = new EmbedBuilder()
            .setColor(0x0891b2)
            .setTitle("🧮 Ticket Workload")
            .addFields(
                { name: "Active Tickets", value: String(active.length), inline: true },
                { name: "SLA Risk", value: String(breachRisk), inline: true },
                { name: "Coverage", value: rows.length ? rows.join("\n") : "No active assignments", inline: false }
            )
            .setTimestamp(new Date());

        return JSON.stringify({ embed: embed.toJSON() });
    },
    ticketnote: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) return "Only admins or the handler role can add internal notes.";
        const target = resolveTicketTargetChannelId(interaction);
        if (target.error || !target.channelId) return target.error || "Unable to resolve ticket channel.";
        const ticket = await ensureTrackedTicketByChannelId(interaction.guild!, target.channelId, interaction.user.id);
        if (!ticket) return "Ticket not found for this channel.";
        const note = (interaction.options.getString("note", true) || "").slice(0, 500);
        const saved = addTicketInternalNote(ticket, { byId: interaction.user.id, at: Date.now(), note });
        if (!saved) return "Unable to persist ticket note due to a store conflict. Please retry.";
        return `Saved internal note on ticket #${ticket.id}.`;
    },
    tickettimeline: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) return "Only admins or the handler role can view internal timelines.";
        const target = resolveTicketTargetChannelId(interaction);
        if (target.error || !target.channelId) return target.error || "Unable to resolve ticket channel.";
        const ticket = await ensureTrackedTicketByChannelId(interaction.guild!, target.channelId, interaction.user.id);
        if (!ticket) return "Ticket not found for this channel.";
        const notes = (ticket.internalNotes || []).slice(-10).map(note => `• <t:${Math.floor(note.at / 1000)}:f> <@${note.byId}>: ${note.note}`);
        const meta = [
            `Ticket #${ticket.id}`,
            `Status: ${ticket.status}/${ticket.workflowStatus}`,
            `Category: ${ticket.category || "general"}`,
            `Parent: ${ticket.parentTicketId ? `#${ticket.parentTicketId}` : "none"}`,
            `Linked: ${ticket.linkedTicketId ? `#${ticket.linkedTicketId}` : "none"}`
        ];
        return `${meta.join("\n")}\n\nNotes:\n${notes.length ? notes.join("\n") : "No internal notes yet."}`;
    },
    ticketmerge: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) return "Only admins or the handler role can merge tickets.";
        const parentId = interaction.options.getInteger("parent_ticket_id", true);
        const childId = interaction.options.getInteger("child_ticket_id", true);
        if (parentId === childId) return "Parent and child ticket IDs must differ.";
        const parent = findTicketById(parentId);
        const child = findTicketById(childId);
        if (!parent || !child || parent.guildId !== interaction.guildId || child.guildId !== interaction.guildId) {
            return "Parent/child ticket was not found in this guild.";
        }
        child.mergedIntoTicketId = parent.id;
        child.linkedTicketId = parent.id;
        child.updatedAt = Date.now();
        parent.childTicketIds = Array.from(new Set([...(parent.childTicketIds || []), child.id]));
        parent.updatedAt = Date.now();
        if (!saveTicketStore()) return "Unable to persist merge due to a store conflict. Please retry.";
        appendAuditEvent("ticket_merge", { guildId: interaction.guildId, parentId, childId, actorId: interaction.user.id });
        return `Merged child ticket #${child.id} into parent #${parent.id}.`;
    },
    ticketlink: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) return "Only admins or the handler role can link tickets.";
        const parentId = interaction.options.getInteger("parent_ticket_id", true);
        const target = resolveTicketTargetChannelId(interaction);
        if (target.error || !target.channelId) return target.error || "Unable to resolve ticket channel.";
        const child = findTicketByChannel(target.channelId);
        const parent = findTicketById(parentId);
        if (!child || !parent || parent.guildId !== interaction.guildId || child.guildId !== interaction.guildId) return "Parent/child ticket not found.";
        child.parentTicketId = parent.id;
        child.linkedTicketId = parent.id;
        child.updatedAt = Date.now();
        parent.childTicketIds = Array.from(new Set([...(parent.childTicketIds || []), child.id]));
        parent.updatedAt = Date.now();
        if (!saveTicketStore()) return "Unable to persist link due to a store conflict. Please retry.";
        appendAuditEvent("ticket_link", { guildId: interaction.guildId, parentId: parent.id, childId: child.id, actorId: interaction.user.id });
        return `Linked ticket #${child.id} under parent #${parent.id}.`;
    },
    ticketexport: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild!;
        const cfg = ensureTicketConfig(guild.id);
        const sink = cfg.exportWebhookUrl || TICKET_EXPORT_WEBHOOK_URL;
        if (!sink) return "No export webhook configured. Set one in ticket config env or /ticketconfig updates.";
        const limit = Math.max(1, Math.min(50, interaction.options.getInteger("limit") || 10));
        const resolved = ticketStore.tickets
            .filter(ticket => ticket.guildId === guild.id && ticket.status === "resolved")
            .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
            .slice(0, limit);
        if (!resolved.length) return "No resolved tickets available for export.";
        let sent = 0;
        for (const ticket of resolved) {
            const ok = await postJsonToWebhook(sink, { type: "ticket_export", guildId: guild.id, ticket });
            if (ok) sent += 1;
        }
        appendAuditEvent("ticket_export_batch", { guildId: guild.id, requested: limit, sent, total: resolved.length });
        return `Exported ${sent}/${resolved.length} resolved tickets.`;
    },
    ticketretention: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild!;
        const cfg = ensureTicketConfig(guild.id);
        const days = interaction.options.getInteger("days");
        if (typeof days === "number") {
            cfg.retentionDays = Math.max(1, Math.min(3650, days));
            saveTicketStore();
        }
        const purgeNow = interaction.options.getBoolean("purge_now") || false;
        const removed = purgeNow ? purgeResolvedTicketsByRetention(guild.id) : 0;
        return [
            `Retention: ${cfg.retentionDays || 45} day(s)`,
            `Reopen window: ${cfg.reopenWindowHours || 72} hour(s)`,
            purgeNow ? `Purged resolved tickets: ${removed}` : "Purge not requested"
        ].join("\n");
    },
    daily: async interaction => {
        const userId = interaction.user.id;
        ensureUser(userId);
        const reward = claimDaily(userId);
        if (!reward) {
            return "You already claimed daily rewards. Try again tomorrow.";
        }
        return `Daily claimed: +${reward.bonus} XP and +${reward.tokenBonus} FN Token$. Streak: ${reward.streak} days.`;
    },
    leaderboard: async () => buildLeaderboardPayload(),
    loadout: async interaction => {
        trackRaidCommandUsage("loadout");
        const condition = RaidDomain.rollRaidCondition();
        const mapCfg = resolveRaidMap("plagued_cemetary");
        return RaidRuntime.formatLoadoutSummary({ userId: interaction.user.id, condition, mapCfg, getInventoryCount, getBestOwnedGear });
    },
    bosses: async () => {
        trackRaidCommandUsage("bosses");
        return buildBossRosterPayload();
    },
    conditions: async () => {
        trackRaidCommandUsage("conditions");
        return buildConditionsPayload();
    },
    gearintel: async interaction => {
        trackRaidCommandUsage("gearintel");
        const kind = interaction.options.getString("kind") || "all";
        const condition = interaction.options.getString("condition");
        return buildGearIntelPayload(kind, condition);
    },
    raidintel: async interaction => {
        trackRaidCommandUsage("raidintel");
        const mapRaw = interaction.options.getString("map") || "plagued_cemetary";
        const selectedWeaponId = interaction.options.getString("weapon");
        const selectedArmorId = interaction.options.getString("armor");
        const mapCfg = resolveRaidMap(mapRaw);
        const condition = RaidDomain.rollRaidCondition();
        const details = RaidRuntime.formatLoadoutSummary({ userId: interaction.user.id, condition, mapCfg, selectedWeaponId, selectedArmorId, getInventoryCount, getBestOwnedGear });
        if (details.startsWith("Selected weapon") || details.startsWith("Selected armor") || details.startsWith("You do not own")) {
            return details;
        }
        const lowProj = mapProjection(mapCfg, "low");
        const medProj = mapProjection(mapCfg, "medium");
        const highProj = mapProjection(mapCfg, "high");
        const previewBonus = RaidRuntime.getRaidLoadoutBonus({ userId: interaction.user.id, condition, selectedWeaponId, selectedArmorId, getInventoryCount, getBestOwnedGear });
        const effectiveConditionSuccess = previewBonus.error || !previewBonus.negatedCondition ? condition.successDelta : 0;
        const effectiveConditionToken = previewBonus.error || !previewBonus.negatedCondition ? condition.tokenMultiplierDelta : 0;
        const effectiveConditionXp = previewBonus.error || !previewBonus.negatedCondition ? condition.xpMultiplier : 1;
        return [
            `Map Intel: ${mapCfg.label} (${mapCfg.difficulty})`,
            mapCfg.description,
            `Loot Tier: ${mapCfg.lootTier} | Recommended Tension: ${mapCfg.recommendedTension}`,
            `Map Base Success Delta: ${(mapCfg.successDelta * 100).toFixed(1)}%`,
            `Map Token Delta: ${(mapCfg.tokenMultiplierDelta * 100).toFixed(1)}%`,
            `Map Raid XP Multiplier: ${mapCfg.xpMultiplier.toFixed(2)}x`,
            `Boss Spawn Chance: ${(mapCfg.bossSpawnChance * 100).toFixed(1)}% | Favored Boss: ${mapCfg.bossName} | Rotation Pool: ${RAID_BOSS_ROSTER.length} bosses`,
            `Projected Low: ${lowProj.successPct}% success | ~${lowProj.tokenMultiplier.toFixed(2)}x token multiplier | XP ${lowProj.xpBand[0]}-${lowProj.xpBand[1]} | EV@100 ${lowProj.expectedNetAt100 >= 0 ? `+${lowProj.expectedNetAt100}` : lowProj.expectedNetAt100} tokens | Boss kit ~${lowProj.bossKitDropChancePct}% | Boss bonus XP ~${lowProj.expectedBossBonusXp}`,
            `Projected Medium: ${medProj.successPct}% success | ~${medProj.tokenMultiplier.toFixed(2)}x token multiplier | XP ${medProj.xpBand[0]}-${medProj.xpBand[1]} | EV@100 ${medProj.expectedNetAt100 >= 0 ? `+${medProj.expectedNetAt100}` : medProj.expectedNetAt100} tokens | Boss kit ~${medProj.bossKitDropChancePct}% | Boss bonus XP ~${medProj.expectedBossBonusXp}`,
            `Projected High: ${highProj.successPct}% success | ~${highProj.tokenMultiplier.toFixed(2)}x token multiplier | XP ${highProj.xpBand[0]}-${highProj.xpBand[1]} | EV@100 ${highProj.expectedNetAt100 >= 0 ? `+${highProj.expectedNetAt100}` : highProj.expectedNetAt100} tokens | Boss kit ~${highProj.bossKitDropChancePct}% | Boss bonus XP ~${highProj.expectedBossBonusXp}`,
            "",
            `Raid Intel Trigger: ${condition.label}`,
            condition.description,
            `Base Trigger Success Delta: ${(condition.successDelta * 100).toFixed(1)}% | Effective: ${(effectiveConditionSuccess * 100).toFixed(1)}%`,
            `Base Trigger Token Delta: ${(condition.tokenMultiplierDelta * 100).toFixed(1)}% | Effective: ${(effectiveConditionToken * 100).toFixed(1)}%`,
            `Base Trigger Raid XP Multiplier: ${condition.xpMultiplier.toFixed(2)}x | Effective: ${effectiveConditionXp.toFixed(2)}x`,
            "",
            details
        ].join("\n");
    },
    raid: async interaction => {
        trackRaidCommandUsage("raid");
        const userId = interaction.user.id;
        ensureUser(userId);
        const bet = interaction.options.getInteger("bet", true);
        const tension = interaction.options.getString("tension") || "medium";
        const mapRaw = interaction.options.getString("map") || "plagued_cemetary";
        const selectedWeaponId = interaction.options.getString("weapon");
        const selectedArmorId = interaction.options.getString("armor");
        const mapCfg = resolveRaidMap(mapRaw);
        if (!["low", "medium", "high"].includes(tension)) return "Tension must be low, medium, or high.";
        const result = performRaid(userId, bet, tension, mapRaw, selectedWeaponId, selectedArmorId);
        if (result.error) return result.error;
        const [tensionLabel] = (result.tension || tension).split(" | ");
        recordRaidTelemetry({
            mapLabel: result.mapLabel || mapCfg.label,
            mapDifficulty: result.mapDifficulty || mapCfg.difficulty,
            conditionLabel: result.conditionLabel || "unknown",
            tensionLabel,
            success: Boolean(result.success),
            successChance: result.successChance || 0,
            bet,
            net: result.net || 0,
            baseRewardTokens: result.baseRewardTokens || 0,
            outcomeBonusTokens: result.outcomeBonusTokens || 0,
            bossBonusTokens: result.bossBonusTokens || 0,
            failureMitigationTokens: result.failureMitigationTokens || 0,
            loot: result.loot || [],
            bossSpawned: result.bossSpawned,
            bossDefeated: result.bossDefeated
        });

        const raidBroadcast = interaction.guild
            ? buildRaidUnlockBroadcastEmbed({ user: interaction.user, result })
            : null;
        if (interaction.guild && raidBroadcast) {
            void sendOpsBroadcastEmbed(interaction.guild, raidBroadcast);
            appendAuditEvent("raid_unlock_broadcast", {
                guildId: interaction.guild.id,
                userId: interaction.user.id,
                mapLabel: result.mapLabel || mapCfg.label,
                bossHeartUnlockedName: result.bossHeartUnlockedName || null,
                pmcTierUnlockedLabel: result.pmcTierUnlockedLabel || null
            });
        }

        return buildRaidResultPayload({ result, mapCfg, fallbackTension: tensionLabel, armyIconUrl: ARMY_ICON_URL });
    },
    raidhistory: async interaction => {
        trackRaidCommandUsage("raidhistory");
        return buildRaidHistoryPayload(interaction.user.id);
    },
    shop: async interaction => {
        const user = ensureUser(interaction.user.id);
        return buildShopPayload({
            shopItemIds: SHOP_ITEMS,
            inventory: user.inventory,
            wallet: user.fnTokens
        });
    },
    inventory: async interaction => {
        return buildInventoryPayload({ inventory: ensureUser(interaction.user.id).inventory, wallet: getTokens(interaction.user.id) });
    },
    buy: async interaction => {
        const item = interaction.options.getString("item", true).trim().toLowerCase();
        const qty = interaction.options.getInteger("quantity", true);
        const res = buyItem(interaction.user.id, item, qty);
        if (res.error) return res.error;
        return buildTradeActionPayload({
            title: "🛒 Procurement Confirmed",
            color: 0x16a34a,
            description: "Armory purchase accepted and inventory updated.",
            summaryLines: [
                `Item: ${ITEM_DEFS[item].name} (${item})`,
                `Quantity: ${qty}`,
                `Cost: ${res.cost} FN Token$`,
                `Owned After Purchase: ${res.total}`
            ],
            nextSteps: ["• /inventory", "• /loadout", "• /raidintel"]
        });
    },
    sell: async interaction => {
        const item = interaction.options.getString("item");
        const qty = interaction.options.getInteger("quantity") || 1;
        if (!item) {
            return buildSellPickerPayload({ inventory: ensureUser(interaction.user.id).inventory, menuId: SELL_UI_IDS.menu });
        }
        const res = sellItem(interaction.user.id, item, qty);
        if (res.error) return res.error;
        return buildTradeActionPayload({
            title: "💸 Vendor Sale Completed",
            color: 0x0f766e,
            description: "Marketplace sale executed and wallet balance updated.",
            summaryLines: [
                `Item: ${ITEM_DEFS[item].name} (${item})`,
                `Quantity Sold: ${qty}`,
                `Payout: ${res.payout} FN Token$`,
                `Remaining: ${res.remaining}`
            ],
            nextSteps: ["• /inventory", "• /sell", "• /shop"]
        });
    },
    opencrate: async interaction => {
        trackRaidCommandUsage("opencrate");
        const hadExplicitCrate = Boolean(interaction.options.getString("crate"));
        let crate = interaction.options.getString("crate");
        if (!crate) {
            const autoCrate = pickBestOwnedCrate(interaction.user.id);
            if (!autoCrate) {
                return `No crates available to open.\n\nOwned crates:\n${formatOwnedCratesForPrompt(interaction.user.id)}`;
            }
            crate = autoCrate;
        }
        if (!OPENABLE_CRATE_IDS.includes(crate as (typeof OPENABLE_CRATE_IDS)[number])) {
            return `Invalid crate id: ${crate}\n\nOwned crates:\n${formatOwnedCratesForPrompt(interaction.user.id)}`;
        }
        if (getInventoryCount(interaction.user.id, crate) < 1) {
            return `You do not own any ${ITEM_DEFS[crate].name}.\n\nOwned crates:\n${formatOwnedCratesForPrompt(interaction.user.id)}`;
        }

        const res = openCrate(interaction.user.id, crate);
        if (res.error) return `${res.error}\n\nOwned crates:\n${formatOwnedCratesForPrompt(interaction.user.id)}`;
        recordCrateTelemetry(crate, !hadExplicitCrate, res.contents || []);
        const remaining = getInventoryCount(interaction.user.id, crate);
        return buildCrateOpenPayload({
            crateId: crate,
            contents: res.contents || [],
            remaining,
            autoSelected: !hadExplicitCrate
        });
    },
    useitem: async interaction => {
        trackRaidCommandUsage("useitem");
        const xpBefore = ensureUser(interaction.user.id).xp;
        const hadExplicitItem = Boolean(interaction.options.getString("item"));
        let item = interaction.options.getString("item");
        const quantity = interaction.options.getInteger("quantity") || 1;
        if (!item) {
            const autoItem = pickBestUsableItem(interaction.user.id);
            if (!autoItem) {
                return `No usable consumables available right now.\n\nOwned usable items:\n${formatOwnedUsableItemsForPrompt(interaction.user.id)}`;
            }
            item = autoItem;
        }

        const itemDef = ITEM_DEFS[item];
        if (!itemDef || itemDef.kind !== "consumable") {
            return `That item cannot be used with /useitem.\n\nOwned usable items:\n${formatOwnedUsableItemsForPrompt(interaction.user.id)}`;
        }

        const owned = getInventoryCount(interaction.user.id, item);
        if (owned < 1) {
            return `You do not own any ${itemDef.name}.\n\nOwned usable items:\n${formatOwnedUsableItemsForPrompt(interaction.user.id)}`;
        }

        let useQty = Math.max(1, Math.floor(quantity));
        let adjustmentNote = "";
        if (useQty > owned) {
            useQty = owned;
            adjustmentNote = `Quantity adjusted to owned amount (${owned}).`;
        }

        if (item === "repair_kit") {
            const scrapOwned = getInventoryCount(interaction.user.id, "scrap");
            const maxByScrap = Math.floor(scrapOwned / 6);
            if (maxByScrap < 1) {
                return `You need at least 6 scrap to use ${itemDef.name}.\n\nOwned usable items:\n${formatOwnedUsableItemsForPrompt(interaction.user.id)}`;
            }
            if (useQty > maxByScrap) {
                useQty = maxByScrap;
                adjustmentNote = `Quantity adjusted to ${useQty} based on current scrap reserves.`;
            }
        }

        const res = useItem(interaction.user.id, item, useQty);
        if (res.error) {
            recordConsumableTelemetry(item, useQty, !hadExplicitItem, true);
            return `${res.error}\n\nOwned usable items:\n${formatOwnedUsableItemsForPrompt(interaction.user.id)}`;
        }

        const xpAfter = ensureUser(interaction.user.id).xp;
        if (interaction.guild && xpAfter > xpBefore) {
            await syncXpRolesForUserInGuild(interaction.guild, interaction.user.id, xpAfter);
        }

        recordConsumableTelemetry(item, useQty, !hadExplicitItem, false);
        const resultText = res.result || `Used ${useQty}x ${itemDef.name}.`;
        return buildConsumableUsePayload({
            itemId: item,
            quantity: useQty,
            resultText,
            autoSelected: !hadExplicitItem,
            adjustmentNote: adjustmentNote || undefined
        });
    },
    dice: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const choice = interaction.options.getString("choice", true);
        return playDice(interaction.user.id, bet, choice);
    },
    roulette: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const choice = interaction.options.getString("choice", true);
        return playRoulette(interaction.user.id, bet, choice);
    },
    blackjack: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const style = interaction.options.getString("style") || "safe";
        return playBlackjack(interaction.user.id, bet, style);
    },
    crash: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const target = interaction.options.getNumber("target", true);
        return await playCrash(interaction.user.id, bet, target);
    },
    magicslots: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        return playSlots(interaction.user.id, bet);
    },
    coinflip: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const side = interaction.options.getString("side", true);
        return playCoinflip(interaction.user.id, bet, side);
    },
    baccarat: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const side = interaction.options.getString("side", true);
        return playBaccarat(interaction.user.id, bet, side);
    },
    hilo: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const call = interaction.options.getString("call", true);
        return playHiLo(interaction.user.id, bet, call);
    },
    keno: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const picks = interaction.options.getString("picks", true);
        return playKeno(interaction.user.id, bet, picks);
    },
    addpoints: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const user = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        const addPointsDedupeError = rejectIfDuplicateCommand(interaction, `addpoints:user:${user.id}:amount:${amount}`);
        if (addPointsDedupeError) return addPointsDedupeError;
        const total = addPoints(user.id, amount);
        await sendModLog(interaction.guildId!, "Access Points Added", [
            { name: "Admin", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${user.id}>`, inline: true },
            { name: "Amount", value: `${amount}`, inline: true },
            { name: "New Total", value: `${total}`, inline: true }
        ]);
        return `${user.username} now has ${total} Access Points.`;
    },
    timeout: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const target = interaction.options.getUser("user", true);
        const timeoutDedupeError = rejectIfDuplicateCommand(interaction, `timeout:user:${target.id}`);
        if (timeoutDedupeError) return timeoutDedupeError;
        const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;
        if (!member) return "Unable to find that member in this server.";
        await member.timeout(5 * 60 * 1000, "Timeout by administrator action");
        await sendModLog(interaction.guildId!, "Timeout", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Duration", value: "5m", inline: true },
            { name: "Reason", value: "Timeout by administrator action" }
        ]);
        return `${target.username} has been timed out for 5 minutes.`;
    },
    kick: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const target = interaction.options.getUser("user", true);
        const kickDedupeError = rejectIfDuplicateCommand(interaction, `kick:user:${target.id}`);
        if (kickDedupeError) return kickDedupeError;
        const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;
        if (!member) return "Unable to find that member in this server.";
        await member.kick("Kick by administrator action");
        rememberModerationLog("kick", interaction.guildId!, target.id);
        await sendModLog(interaction.guildId!, "Kick", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Reason", value: "Kick by administrator action" }
        ]);
        return `${target.username} has been kicked.`;
    },
    ban: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const target = interaction.options.getUser("user", true);
        const banDedupeError = rejectIfDuplicateCommand(interaction, `ban:user:${target.id}`);
        if (banDedupeError) return banDedupeError;
        const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;
        if (!member) return "Unable to find that member in this server.";
        await member.ban({ reason: "Ban by administrator action" });
        rememberModerationLog("ban", interaction.guildId!, target.id);
        await sendModLog(interaction.guildId!, "Ban", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${target.id}>`, inline: true },
            { name: "Reason", value: "Ban by administrator action" }
        ]);
        return `${target.username} has been banned.`;
    },
    unban: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const userId = interaction.options.getString("user_id", true).trim();
        const reason = interaction.options.getString("reason")?.trim() || "Unban by administrator action";
        if (!/^\d{17,20}$/.test(userId)) return "Provide a valid Discord user ID.";
        if (!interaction.guild) return "This command can only be used in a server.";

        const unbanDedupeError = rejectIfDuplicateCommand(interaction, `unban:user:${userId}`);
        if (unbanDedupeError) return unbanDedupeError;

        try {
            await interaction.guild.members.unban(userId, reason);
        } catch {
            return "Unable to unban that user. They may not be banned or I lack Ban Members permission.";
        }

        await sendModLog(interaction.guildId!, "Unban", [
            { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Target", value: `<@${userId}> (${userId})`, inline: true },
            { name: "Reason", value: reason }
        ]);
        return `User ${userId} has been unbanned.`;
    },
    setmodlog: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.setmodlog(interaction);
    },
    setlockdown: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.setlockdown(interaction);
    },
    lockdownnotice: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.lockdownnotice(interaction);
    },
    modconfig: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.modconfig(interaction);
    },
    warn: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.warn(interaction);
    },
    warnings: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.warnings(interaction);
    },
    clearwarnings: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.clearwarnings(interaction);
    },
    tempban: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.tempban(interaction);
    },
    purge: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.purge(interaction);
    },
    announce: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        return await moderationCommandHandlers.announce(interaction);
    }
};

client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user?.tag ?? "unknown-user"}`);
    console.log(`[startup] Preparing to register ${slashCommands.length} guild slash commands.`);
    if (slashCommands.length > 100) {
        console.error(`[startup] Slash command count ${slashCommands.length} exceeds Discord guild limit (100). Some commands will not register.`);
    }
    updateBotPresence();
    console.log(`[startup] ${buildStartupSummary(client.guilds.cache.size, Math.floor(process.uptime()), process.memoryUsage())}`);
    appendAuditEvent("startup", {
        userTag: client.user?.tag,
        guildCount: client.guilds.cache.size
    });

    // Keep this bot guild-scoped to avoid duplicate global+guild slash entries.
    await client.application?.commands.set([]).catch(() => undefined);

    if (DISCORD_GUILD_ID) {
        const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch(() => null);
        if (guild) {
            await guild.commands.set(slashCommands);
            console.log(`Registered slash commands for guild ${guild.id}`);
            if (ENABLE_STARTUP_AUTOPANELS) {
                await removeLegacyReportPanelForGuild(guild);
                await ensureAdminReportPanelForGuild(guild);
                await ensurePermanentTicketPanelForGuild(guild);
                await ensureBotFeatureBriefForGuild(guild);
                await ensureWelcomePanelForGuild(guild);
            }
            if (ENABLE_STARTUP_DEPLOYMENT_SUMMARY) {
                await sendDeploymentSummaryIfNeeded();
            }
        } else {
            console.warn("DISCORD_GUILD_ID is set but the guild could not be fetched.");
        }
        return;
    }

    if (client.guilds.cache.size > 0) {
        for (const guild of client.guilds.cache.values()) {
            await guild.commands.set(slashCommands).catch(() => undefined);
            if (ENABLE_STARTUP_AUTOPANELS) {
                await removeLegacyReportPanelForGuild(guild);
                await ensureAdminReportPanelForGuild(guild);
                await ensurePermanentTicketPanelForGuild(guild);
                await ensureBotFeatureBriefForGuild(guild);
                await ensureWelcomePanelForGuild(guild);
            }
        }
        if (ENABLE_STARTUP_DEPLOYMENT_SUMMARY) {
            await sendDeploymentSummaryIfNeeded();
        }
        console.log(`Registered slash commands in ${client.guilds.cache.size} guild(s) for instant updates.`);
    }

    console.log("Global slash commands cleared to prevent duplicate command entries.");
    console.log("Guild-only slash commands are active.");
});

client.on("guildBanAdd", async ban => {
    const guildId = ban.guild.id;
    const userId = ban.user.id;
    if (shouldSkipRecentModerationLog("ban", guildId, userId)) return;

    const audit = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 6 }).catch(() => null);
    const entry = audit?.entries.find(item => {
        const targetId = item.target && "id" in item.target ? item.target.id : null;
        return targetId === userId && Date.now() - item.createdTimestamp < 15_000;
    });

    const moderatorId = entry?.executor?.id;
    const reason = entry?.reason || "No reason provided";
    await sendModLog(guildId, "Ban", [
        { name: "Moderator", value: moderatorId ? `<@${moderatorId}>` : "Unknown", inline: true },
        { name: "Target", value: `<@${userId}>`, inline: true },
        { name: "Reason", value: reason }
    ]);
});

client.on("guildMemberRemove", async member => {
    const guildId = member.guild.id;
    const userId = member.id;
    const audit = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 6 }).catch(() => null);
    const entry = audit?.entries.find(item => {
        const targetId = item.target && "id" in item.target ? item.target.id : null;
        return targetId === userId && Date.now() - item.createdTimestamp < 15_000;
    });
    if (!entry) return;
    if (shouldSkipRecentModerationLog("kick", guildId, userId)) return;

    const moderatorId = entry.executor?.id;
    const reason = entry.reason || "No reason provided";
    await sendModLog(guildId, "Kick", [
        { name: "Moderator", value: moderatorId ? `<@${moderatorId}>` : "Unknown", inline: true },
        { name: "Target", value: `<@${userId}>`, inline: true },
        { name: "Reason", value: reason }
    ]);
});

setInterval(() => {
    checkpointState("interval_30s");
}, 30_000).unref();

setInterval(() => {
    updateBotPresence();
}, 10 * 60 * 1000).unref();

if (COMMAND_IDEMPOTENCY_WINDOW_MS > 0) {
    setInterval(() => {
        pruneRecentCommandExecutions();
    }, Math.max(5_000, COMMAND_IDEMPOTENCY_WINDOW_MS)).unref();
}

setInterval(() => {
    pruneInMemoryRuntimeState();
}, IN_MEMORY_STATE_PRUNE_INTERVAL_MS).unref();

setInterval(() => {
    void sendAutomatedHealthReport("interval_24h");
}, DAILY_HEALTH_REPORT_MS).unref();

setInterval(() => {
    void runHealthWatchdog("interval_10m");
}, HEALTH_WATCHDOG_INTERVAL_MS).unref();

setInterval(() => {
    void sendAutomatedBalanceReport("interval_7d");
}, WEEKLY_BALANCE_REPORT_MS).unref();

setInterval(() => {
    void processDueGiveaways();
}, 15_000).unref();

setInterval(() => {
    void refreshActiveGiveawayEmbeds();
}, 60_000).unref();

setTimeout(() => {
    void sendAutomatedHealthReport("startup_warmup");
}, 90_000).unref();

setTimeout(() => {
    void runHealthWatchdog("startup_warmup");
}, 45_000).unref();

setTimeout(() => {
    void sendAutomatedBalanceReport("startup_warmup");
}, 120_000).unref();

function requestManagedRestart(trigger: string, requestedByUserId: string | null = null): void {
    const pm2IdRaw = String(process.env.pm_id || "").trim();
    const pm2Name = String(process.env.name || process.env.PM2_PROCESS_NAME || "").trim();
    const restartTargets: string[] = [];

    if (/^\d+$/.test(pm2IdRaw)) {
        restartTargets.push(pm2IdRaw);
    }
    if (pm2Name) {
        restartTargets.push(pm2Name);
    }

    for (const target of restartTargets) {
        try {
            execSync(`pm2 restart ${target}`, { stdio: "ignore" });
            appendAuditEvent("process_restart_requested", {
                trigger,
                requestedByUserId,
                strategy: "pm2_restart",
                target
            });
            console.log(`[restart] Requested PM2 restart via target '${target}' from ${trigger}.`);
            return;
        } catch (error) {
            appendAuditEvent("process_restart_attempt_failed", {
                trigger,
                requestedByUserId,
                strategy: "pm2_restart",
                target,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Fallback: crash-exit so supervisors configured to auto-restart on failures still recover.
    appendAuditEvent("process_restart_fallback_exit", {
        trigger,
        requestedByUserId,
        strategy: "exit_code_1"
    });
    console.warn(`[restart] PM2 restart target unavailable for ${trigger}; exiting with code 1.`);
    setTimeout(() => process.exit(1), 100).unref();
}

process.on("SIGINT", () => {
    recordRuntimeShutdown("sigint");
    checkpointState("sigint");
    releaseInstanceLock();
    process.exit(0);
});

process.on("SIGTERM", () => {
    recordRuntimeShutdown("sigterm");
    checkpointState("sigterm");
    releaseInstanceLock();
    process.exit(0);
});

process.on("beforeExit", () => {
    recordRuntimeShutdown("before_exit");
    checkpointState("before_exit");
    releaseInstanceLock();
});

client.on("interactionCreate", async interaction => {
    if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused(true);

        let options: Array<{ name: string; value: string }> = [];
        if (["raid", "raidintel"].includes(interaction.commandName) && (focused.name === "weapon" || focused.name === "armor")) {
            const kind = focused.name === "weapon" ? "weapon" : "armor";
            options = getRaidGearAutocompleteOptions(interaction.user.id, kind, String(focused.value || ""));
        } else if (interaction.commandName === "buy" && focused.name === "item") {
            options = getShopItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (interaction.commandName === "tradeoffer" && focused.name === "offer_item") {
            options = getTradeOfferItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (interaction.commandName === "tradeoffer" && focused.name === "request_item") {
            options = getTradeRequestItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (interaction.commandName === "tradeaccept" && focused.name === "offer_id") {
            options = getTradeOfferAutocompleteOptions(interaction.user.id, String(focused.value || ""), "incoming");
        } else if (interaction.commandName === "tradedecline" && focused.name === "offer_id") {
            options = getTradeOfferAutocompleteOptions(interaction.user.id, String(focused.value || ""), "all");
        } else if (interaction.commandName === "opencrate" && focused.name === "crate") {
            options = getOpenCrateAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (interaction.commandName === "useitem" && focused.name === "item") {
            options = getUseItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (interaction.commandName === "sell" && focused.name === "item") {
            options = getSellItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (interaction.commandName === "itemgiveaway" && focused.name === "item") {
            options = getCatalogItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else {
            return;
        }

        await interaction.respond(options).catch(() => undefined);
        return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "ticketintake") {
        const guildError = requireGuild(interaction);
        if (guildError) {
            await interaction.reply({ content: guildError, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        await interaction.showModal(buildTicketIntakeModal()).catch(async () => {
            await interaction.reply({ content: "Unable to open intake modal right now.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return;
    }


    if (interaction.isModalSubmit() && interaction.customId === TICKET_IDS.intakeModal) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Ticket intake can only be used in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const summary = interaction.fields.getTextInputValue(TICKET_IDS.intakeSummary) || "General support";
        const category = interaction.fields.getTextInputValue(TICKET_IDS.intakeCategory) || "general";
        const details = interaction.fields.getTextInputValue(TICKET_IDS.intakeDetails) || "";
        const platform = interaction.fields.getTextInputValue(TICKET_IDS.intakePlatform) || "";
        const evidence = interaction.fields.getTextInputValue(TICKET_IDS.intakeEvidence) || "";
        const reason = buildTicketIntakeReason({ category, summary, details, platform, evidence });
        const priority = category.toLowerCase().includes("billing") ? "high" : "normal";

        const created = await createTicketChannel(guild, interaction.user.id, reason, priority, false);
        if (created.error) {
            await interaction.reply({ content: created.error, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const ticket = created.channelId ? findTicketByChannel(created.channelId) : null;
        await interaction.reply({
            embeds: [buildTicketCommandEmbed(
                "🎫 Intake Submitted",
                "Your structured support request was submitted successfully.",
                ticket || undefined,
                [
                    { name: "Category", value: classifyTicketCategory(category), inline: true },
                    { name: "Summary", value: summary.slice(0, 120), inline: false },
                    { name: "KB References", value: getKbSuggestions(reason).map(item => `• ${item}`).join("\n"), inline: false }
                ]
            )],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId === REPORT_IDS.adminModal) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Admin report intake can only be used in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const member = interaction.member as GuildMember | null;
        if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can file reports from this panel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const targetRaw = interaction.fields.getTextInputValue(REPORT_IDS.adminTarget) || "";
        const targetId = parseUserIdFromReportTarget(targetRaw);
        if (!targetId) {
            await interaction.reply({ content: "Target must be a valid Discord user mention or user ID.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const targetUser = await client.users.fetch(targetId).catch(() => null);
        if (!targetUser) {
            await interaction.reply({ content: "Unable to fetch that user from Discord.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const summary = (interaction.fields.getTextInputValue(REPORT_IDS.adminSummary) || "").trim();
        const details = (interaction.fields.getTextInputValue(REPORT_IDS.adminDetails) || "").trim();
        const evidence = (interaction.fields.getTextInputValue(REPORT_IDS.adminEvidence) || "").trim() || null;
        if (!summary) {
            await interaction.reply({ content: "Report summary is required.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const result = await submitFormalUserReport({
            guild,
            reporterId: interaction.user.id,
            targetUser,
            summary,
            details,
            evidence
        });

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(result.flagged ? 0xdc2626 : 0x0ea5e9)
                .setTitle("🚨 Formal User Report Filed")
                .addFields(
                    { name: "Report ID", value: `#${result.entry.id}`, inline: true },
                    { name: "Target", value: `<@${targetUser.id}>`, inline: true },
                    { name: "Reporter", value: `<@${interaction.user.id}>`, inline: true },
                    { name: "Summary", value: result.entry.summary, inline: false },
                    { name: "Evidence", value: evidence || "Not provided", inline: false },
                    { name: "Total Reports On User", value: `${result.totalReportsForTarget}${result.flagged ? " 🚩" : ""}`, inline: true },
                    { name: "Logged Channel", value: `<#${REPORT_LOG_CHANNEL_ID}>`, inline: true }
                )
                .setTimestamp(new Date())],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return;
    }


    if (interaction.isModalSubmit() && interaction.customId === GIVEAWAY_IDS.raidItemModal) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Raid item giveaways can only be created in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can create raid item giveaways.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const itemId = (interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidItemId) || "").trim().toLowerCase();
        const item = ITEM_DEFS[itemId];
        if (!item) {
            await interaction.reply({ content: `Unknown raid item: ${itemId}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const quantity = Math.max(1, Number.parseInt(interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidItemQty) || "1", 10) || 1);
        const durationRaw = (interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidDuration) || "").trim();
        const durationMs = parseDurationMs(durationRaw);
        if (!durationMs) {
            await interaction.reply({ content: "Invalid duration. Use values like 30m, 6h, or 2d.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const winnerCount = Math.max(1, Math.min(20, Number.parseInt(interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidWinners) || "1", 10) || 1));
        const description = (interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidDescription) || "").slice(0, 400);
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText || !("send" in channel)) {
            await interaction.reply({ content: "This panel must be used in a text channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const giveaway = await createAndPostGiveaway({
            guild,
            channel,
            hostId: interaction.user.id,
            prize: `${item.name} Giveaway`,
            description,
            durationMs,
            winnerCount,
            roleRequiredId: null,
            rewardKind: "item",
            rewardItemId: itemId,
            rewardQty: quantity
        });
        if (!giveaway) {
            await interaction.reply({ content: "Failed to post the raid item giveaway.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        appendAuditEvent("giveaway_item_created", {
            guildId: guild.id,
            giveawayId: giveaway.id,
            hostId: interaction.user.id,
            channelId: channel.id,
            itemId,
            quantity,
            durationMs,
            winnerCount,
            source: "panel"
        });
        await sendGiveawayLog(guild.id, `Giveaway #${giveaway.id} Created`, [
            { name: "Raid Item", value: `${item.name} (${itemId}) x${quantity}`, inline: false },
            { name: "Host", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Channel", value: `<#${channel.id}>`, inline: true },
            { name: "Winners", value: `${winnerCount}`, inline: true }
        ]);
        await interaction.reply({ content: `Raid item giveaway #${giveaway.id} is now live in <#${channel.id}>.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${TICKET_IDS.csatPrefix}:`)) {
        const parts = interaction.customId.split(":");
        const ticketId = Number(parts[1]);
        const rating = Math.max(1, Math.min(5, Number(parts[2]) || 5));
        const ticket = findTicketById(ticketId);
        if (!ticket) {
            if (interaction.guildId) {
                await interaction.reply({ content: "Ticket was not found for this feedback.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            } else {
                await interaction.reply({ content: "Ticket was not found for this feedback." }).catch(() => undefined);
            }
            return;
        }

        ticket.csat = {
            rating,
            submittedAt: Date.now(),
            submittedById: interaction.user.id
        };
        ticket.updatedAt = Date.now();
        const saved = saveTicketStore();
        if (!saved) {
            if (interaction.guildId) {
                await interaction.reply({ content: "Unable to save feedback due to a store conflict. Please try again.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            } else {
                await interaction.reply({ content: "Unable to save feedback due to a store conflict. Please try again." }).catch(() => undefined);
            }
            return;
        }

        appendAuditEvent("ticket_csat", {
            ticketId: ticket.id,
            guildId: ticket.guildId,
            rating,
            submittedById: interaction.user.id
        });

        if (interaction.guildId) {
            await interaction.reply({ content: `Thanks for rating ticket #${ticket.id} with ${rating}/5.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        } else {
            await interaction.reply({ content: `Thanks for rating ticket #${ticket.id} with ${rating}/5.` }).catch(() => undefined);
        }
        return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === HELP_IDS.menu) {
        const selected = interaction.values[0] as keyof typeof HELP_IDS;
        const page = ["general", "xp", "raids", "shop", "games", "bank", "moderation"].includes(selected)
            ? (selected as "general" | "xp" | "raids" | "shop" | "games" | "bank" | "moderation")
            : "general";
        const payload = await buildHelpPayload(page, interaction.guild);
        try {
            const embed = embedFromPayload("help", payload.embed, interaction.user);
            await interaction.update({ embeds: [embed], components: helpDropdown(page) });
        } catch (error) {
            if (!isUnknownInteractionError(error)) {
                console.error("Help menu interaction failed:", error);
            }
        }
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${CASINO_UI_IDS.prefix}:`)) {
        const parsedAction = parseCasinoActionCustomId(interaction.customId);
        if (!parsedAction) {
            await interaction.reply({ content: "This casino action is invalid or expired.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        if (parsedAction.ownerId !== interaction.user.id) {
            await interaction.reply({ content: "These controls belong to another player. Run your own casino command to get personal quick actions.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const throttleError = rejectIfRateLimitedForCasinoAction(interaction.guildId, interaction.user.id, parsedAction.gameKey);
        if (throttleError) {
            await interaction.reply({ content: "Action cooldown active. Wait a moment before triggering another casino quick action.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const actionResult = await runCasinoQuickAction({
            userId: interaction.user.id,
            action: parsedAction.action,
            gameKey: parsedAction.gameKey,
            bet: parsedAction.bet,
            arg: parsedAction.arg
        });

        try {
            const parsedPayload = JSON.parse(actionResult.payload);
            if (parsedPayload && parsedPayload.embed) {
                const embed = embedFromPayload(actionResult.gameKey, parsedPayload.embed, interaction.user);
                await interaction.reply({
                    embeds: [embed],
                    components: Array.isArray(parsedPayload.components) ? parsedPayload.components : [],
                    flags: MessageFlags.Ephemeral
                }).catch(() => undefined);
                return;
            }
        } catch {
            // Fall through to text rendering.
        }

        await interaction.reply({
            embeds: [embedFromText(actionResult.gameKey, actionResult.payload, interaction.user)],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === SELL_UI_IDS.menu) {
        const itemId = interaction.values[0] || "";
        const item = ITEM_DEFS[itemId];
        const owned = getInventoryCount(interaction.user.id, itemId);
        if (!item || owned < 1) {
            await interaction.update({
                embeds: [embedFromText("sell", "That item is no longer available to sell. Run /sell again.", interaction.user)],
                components: []
            }).catch(() => undefined);
            return;
        }

        const unitPayout = Math.max(1, Math.floor(item.price * 0.6));
        const qtyChoices = [1, 5, 10].filter(q => q <= owned);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...qtyChoices.map(q =>
                new ButtonBuilder()
                    .setCustomId(`${SELL_UI_IDS.qtyPrefix}:${itemId}:${q}`)
                    .setLabel(`Sell ${q}`)
                    .setStyle(ButtonStyle.Secondary)
            ),
            new ButtonBuilder()
                .setCustomId(`${SELL_UI_IDS.qtyPrefix}:${itemId}:all`)
                .setLabel("Sell All")
                .setStyle(ButtonStyle.Danger)
        );

        const embed = new EmbedBuilder()
            .setColor(0x0e7490)
            .setTitle("🧾 Confirm Item Sale")
            .setDescription("Choose how many units to sell.")
            .addFields(
                { name: "Item", value: `${item.name} (${item.id})`, inline: false },
                { name: "Rarity", value: String(item.rarity || "common"), inline: true },
                { name: "Owned", value: `${owned}`, inline: true },
                { name: "Per Unit", value: `${unitPayout} FN Token$`, inline: true },
                { name: "Max Payout", value: `${unitPayout * owned} FN Token$`, inline: false }
            );

        await interaction.update({ embeds: [embed], components: [row] }).catch(() => undefined);
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${SELL_UI_IDS.qtyPrefix}:`)) {
        const parts = interaction.customId.split(":");
        const itemId = parts[1] || "";
        const qtyRaw = parts[2] || "1";
        const item = ITEM_DEFS[itemId];
        const owned = getInventoryCount(interaction.user.id, itemId);

        if (!item || owned < 1) {
            await interaction.update({
                embeds: [embedFromText("sell", "That item is no longer available to sell. Run /sell again.", interaction.user)],
                components: []
            }).catch(() => undefined);
            return;
        }

        const qty = qtyRaw === "all" ? owned : Math.max(1, Math.min(owned, Number.parseInt(qtyRaw, 10) || 1));
        const result = sellItem(interaction.user.id, itemId, qty);
        if (result.error) {
            await interaction.update({ embeds: [embedFromText("sell", result.error, interaction.user)], components: [] }).catch(() => undefined);
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x16a34a)
            .setTitle("💸 Sale Completed")
            .setDescription(`Sold ${qty}x ${item.name} for ${result.payout} FN Token$.`)
            .addFields(
                { name: "Remaining", value: `${result.remaining}`, inline: true },
                { name: "Unit Value", value: `${Math.max(1, Math.floor(item.price * 0.6))} FN Token$`, inline: true },
                { name: "Tip", value: "Run /sell again to open the picker for another item.", inline: false }
            );

        await interaction.update({ embeds: [embed], components: [] }).catch(() => undefined);
        return;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.open) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Tickets can only be opened in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        await interaction.showModal(buildTicketIntakeModal()).catch(async () => {
            await interaction.reply({ content: "Unable to open intake modal right now.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return;
    }

    if (interaction.isButton() && interaction.customId === REPORT_IDS.adminOpen) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Admin report panel can only be used in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can file reports from this panel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        await interaction.showModal(buildAdminReportIntakeModal()).catch(async () => {
            await interaction.reply({ content: "Unable to open admin report intake modal right now.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return;
    }

    if (interaction.isButton() && interaction.customId === REPORT_IDS.open) {
        await interaction.reply({ content: "Public report desk intake is disabled. Admins should use /reportintake or the admin report panel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
    }

    if (interaction.isButton() && interaction.customId === GIVEAWAY_IDS.raidPanelOpen) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Raid item giveaways can only be created in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can use this giveaway panel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        await interaction.showModal(buildRaidItemGiveawayModal()).catch(async () => {
            await interaction.reply({ content: "Unable to open the raid item giveaway modal right now.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${GIVEAWAY_IDS.enterPrefix}:`)) {
        const giveawayId = Number.parseInt(interaction.customId.split(":")[1] || "0", 10);
        const giveaway = getGiveawayById(giveawayId);
        if (!giveaway) {
            await interaction.reply({ content: "This giveaway no longer exists.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        if (giveaway.status !== "active" || giveaway.endAt <= Date.now()) {
            if (giveaway.status === "active" && giveaway.endAt <= Date.now()) {
                await finalizeGiveaway(giveaway, "timer");
            }
            await interaction.reply({ content: "This giveaway is already closed.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        if (!interaction.guild) {
            await interaction.reply({ content: "Giveaways can only be entered in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        if (giveaway.roleRequiredId) {
            const member = interaction.member as GuildMember | null ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member?.roles.cache.has(giveaway.roleRequiredId)) {
                await interaction.reply({ content: `You need <@&${giveaway.roleRequiredId}> to enter this giveaway.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
                return;
            }
        }
        if (giveaway.entries.includes(interaction.user.id)) {
            await interaction.reply({ content: `You are already entered in giveaway #${giveaway.id}.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        giveaway.entries.push(interaction.user.id);
        giveaway.updatedAt = Date.now();
        saveGiveawayStore();
        await syncGiveawayMessage(giveaway);
        appendAuditEvent("giveaway_enter", {
            guildId: giveaway.guildId,
            giveawayId: giveaway.id,
            userId: interaction.user.id,
            entryCount: giveaway.entries.length
        });
        await interaction.reply({ content: `You entered giveaway #${giveaway.id} for **${giveaway.prize}**.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.close) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const tracked = await ensureTrackedTicketByChannelId(guild, interaction.channel.id, interaction.user.id);
        if (!tracked) {
            await interaction.reply({ content: "This channel is not a tracked ticket and could not be imported.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const ticket = findOpenTicketByChannel(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({ content: "This is not an open ticket.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only admins or the handler role can archive tickets.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const msg = await closeTicketChannel(guild, interaction.channel.id, interaction.user.id, "Archived by support panel action");
        const archived = findArchivedTicketByChannel(interaction.channel.id);
        if (archived) {
            await interaction.reply({
                embeds: [buildTicketCommandEmbed(
                    "🔒 Ticket Archived",
                    "Ticket moved to archive hold queue from panel action.",
                    archived,
                    [
                        { name: "Archived By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Reason", value: "Archived by support panel action", inline: false },
                        { name: "Next Step", value: "Use resolve button or `/resolveticket` when fully complete." }
                    ]
                )],
                flags: MessageFlags.Ephemeral
            }).catch(() => undefined);
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.claim) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only admins or the handler role can claim tickets.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        // QoL hardening: if this is a valid ticket channel context, ensure it is tracked
        // before claim to avoid false "not tracked" responses from stale/missing store rows.
        if (interaction.channel.isTextBased() && interaction.channel.type === ChannelType.GuildText) {
            ensureTrackedTicketFromKnownChannel(guild, interaction.channel, interaction.user.id);
        }

        let msg = await claimTicketChannel(guild, interaction.channel.id, interaction.user.id);
        if (msg.includes("not a tracked ticket") && interaction.channel.isTextBased() && interaction.channel.type === ChannelType.GuildText) {
            ensureTrackedTicketFromKnownChannel(guild, interaction.channel, interaction.user.id);
            msg = await claimTicketChannel(guild, interaction.channel.id, interaction.user.id);
        }
        const claimed = findTicketByChannel(interaction.channel.id);
        if (claimed && msg.toLowerCase().includes("claimed")) {
            await interaction.reply({
                embeds: [buildTicketCommandEmbed(
                    "🛠️ Ticket Claimed",
                    "Claim succeeded and panel values were updated live.",
                    claimed,
                    [
                        { name: "Claimed By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Result", value: msg, inline: false },
                        { name: "Next Step", value: "Assign handler (`/ticketassign`) or update workflow (`/ticketstatus`)." }
                    ]
                )],
                flags: MessageFlags.Ephemeral
            }).catch(() => undefined);
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return;
    }

    if (interaction.isButton() && interaction.customId === TICKET_IDS.resolve) {
        const guild = interaction.guild;
        if (!guild || !interaction.channel) {
            await interaction.reply({ content: "This action must be used inside a ticket channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const tracked = await ensureTrackedTicketByChannelId(guild, interaction.channel.id, interaction.user.id);
        if (!tracked) {
            await interaction.reply({ content: "This channel is not a tracked ticket and could not be imported.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const ticket = findArchivedTicketByChannel(interaction.channel.id);
        if (!ticket) {
            await interaction.reply({ content: "This ticket must be archived before it can be permanently resolved.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) {
            await interaction.reply({ content: "Only admins or the handler role can permanently resolve tickets.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }

        const msg = await resolveTicketChannel(guild, interaction.channel.id, interaction.user.id, "Resolved by support panel action");
        const resolved = findTicketByChannel(interaction.channel.id);
        if (resolved && normalizeTicketStatus(resolved.status) === "resolved") {
            await interaction.reply({
                embeds: [buildTicketCommandEmbed(
                    "✅ Ticket Resolved Permanently",
                    "Ticket was resolved and closed out from panel action.",
                    resolved,
                    [
                        { name: "Resolved By", value: `<@${interaction.user.id}>`, inline: true },
                        { name: "Resolution", value: "Resolved by support panel action", inline: false },
                        { name: "Transcript", value: resolved.transcript ? "Captured in ticket metadata/logs." : "No transcript snapshot available." }
                    ]
                )],
                flags: MessageFlags.Ephemeral
            }).catch(() => undefined);
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        return;
    }

    if (interaction.isButton() && interaction.customId === RAID_RESULT_ACTION_IDS.inventory) {
        const payload = JSON.parse(buildInventoryPayload({ inventory: ensureUser(interaction.user.id).inventory, wallet: getTokens(interaction.user.id) }));
        await interaction.reply({
            embeds: [embedFromPayload("inventory", payload.embed, interaction.user)],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return;
    }

    if (interaction.isButton() && interaction.customId === RAID_RESULT_ACTION_IDS.history) {
        const payload = JSON.parse(buildRaidHistoryPayload(interaction.user.id));
        await interaction.reply({
            embeds: [embedFromPayload("raidhistory", payload.embed, interaction.user)],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return;
    }

    if (interaction.isButton() && interaction.customId === RAID_RESULT_ACTION_IDS.bosses) {
        const payload = JSON.parse(buildBossRosterPayload());
        await interaction.reply({
            embeds: [embedFromPayload("bosses", payload.embed, interaction.user)],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const handler = commandHandlers[interaction.commandName];
    if (!handler) {
        const unknown = embedFromText("unknown", "Unknown command.", interaction.user);
        try {
            await interaction.reply({ embeds: [unknown] });
        } catch (error) {
            if (!isUnknownInteractionError(error)) {
                console.error("Unknown command reply failed:", error);
            }
        }
        return;
    }

    const throttleError = rejectIfRateLimitedForInteraction(interaction);
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
    }

    try {
        const startedAt = Date.now();
        await interaction.deferReply();
        const rawResult = await handler(interaction);
        const result = typeof rawResult === "string"
            ? rawResult
            : JSON.stringify(rawResult ?? "No response returned.");
        const elapsedMs = Date.now() - startedAt;
        recordCommandOutcome(interaction.commandName, true, elapsedMs);
        appendAuditEvent("slash_command", {
            command: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            durationMs: elapsedMs
        });
        try {
            const parsed = JSON.parse(result);
            if (parsed && parsed.embed && parsed.withHelpNav) {
                const embed = embedFromPayload(interaction.commandName, parsed.embed, interaction.user);
                const page = parsed.helpPage || "general";
                await interaction.editReply({
                    embeds: [embed],
                    components: helpDropdown(page),
                    allowedMentions: { parse: ["roles"] }
                });
            } else if (parsed && parsed.embed) {
                const embed = embedFromPayload(interaction.commandName, parsed.embed, interaction.user);
                await interaction.editReply({
                    embeds: [embed],
                    components: Array.isArray(parsed.components) ? parsed.components : [],
                    allowedMentions: { parse: ["roles"] }
                });
            } else {
                await interaction.editReply({ embeds: [embedFromText(interaction.commandName, result, interaction.user)] });
            }
        } catch {
            await interaction.editReply({ embeds: [embedFromText(interaction.commandName, result, interaction.user)] });
        }
    } catch (error) {
        if (isUnknownInteractionError(error)) {
            return;
        }

        console.error("Command execution failed:", error);
        const failureReason = clampText(error instanceof Error ? error.message : String(error), 220);
        appendAuditEvent("slash_command_error", {
            command: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            reason: failureReason
        });
        recordCommandOutcome(interaction.commandName, false, 0);
        try {
            const failText = `Command failed: ${failureReason}`;
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [embedFromText(interaction.commandName, failText, interaction.user)] });
            } else {
                await interaction.reply({ embeds: [embedFromText(interaction.commandName, failText, interaction.user)] });
            }
        } catch (responseError) {
            if (!isUnknownInteractionError(responseError)) {
                console.error("Command failure response could not be sent:", responseError);
            }
            // Ignore secondary response errors (e.g. interaction expired)
        }
    }
});

client.on("messageCreate", async message => {
    if (message.author.bot) return;

    if (message.guildId) {
        const state = ensureGuildModeration(message.guildId);
        if (state.lockdownChannelId && message.channelId === state.lockdownChannelId) {
            const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
            const isAdmin = Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
            if (!isAdmin) {
                const reason = "Lockdown channel violation: non-admin message sent in protected channel.";
                await message.delete().catch(() => undefined);
                if (member) {
                    await member.ban({ reason }).catch(() => undefined);
                }
                await sendModLog(message.guildId, "Lockdown Ban", [
                    { name: "Target", value: `<@${message.author.id}>`, inline: true },
                    { name: "Channel", value: `<#${message.channelId}>`, inline: true },
                    { name: "Reason", value: reason }
                ]).catch(() => undefined);
                appendAuditEvent("lockdown_ban", {
                    guildId: message.guildId,
                    channelId: message.channelId,
                    userId: message.author.id,
                    reason
                });
                return;
            }
        }
    }

    const isCommunicationEvent =
        message.content.trim().length > 0 ||
        message.mentions.users.size > 0 ||
        Boolean(message.reference) ||
        message.attachments.size > 0;

    if (isCommunicationEvent) {
        const nextXp = addXP(message.author.id, 1);
        appendAuditEvent("engagement_xp", {
            userId: message.author.id,
            guildId: message.guildId,
            channelId: message.channelId,
            xpDelta: 1,
            totalXp: nextXp,
            reference: Boolean(message.reference),
            mentionCount: message.mentions.users.size,
            attachmentCount: message.attachments.size
        });
        if (message.guild) {
            await syncXpRolesForUserInGuild(message.guild, message.author.id, nextXp);
        }
    }

    if (message.content.trim().toLowerCase() === `${PREFIX}ping`) {
        void message.reply("Pong.");
    }
});

process.on("unhandledRejection", reason => {
    console.error("Unhandled promise rejection:", reason);
    recordRuntimeShutdown("unhandled_rejection_late_handler");
    appendAuditEvent("unhandled_rejection", { reason: toSafeString(reason) });
    checkpointState("unhandled_rejection");
    postOpsAlert("error", "Unhandled promise rejection", {
        reason: toSafeString(reason)
    });
    releaseInstanceLock();
});

process.on("uncaughtException", error => {
    console.error("Uncaught exception:", error);
    recordRuntimeShutdown("uncaught_exception_late_handler");
    appendAuditEvent("uncaught_exception", { message: error.message, stack: error.stack });
    checkpointState("uncaught_exception");
    postOpsAlert("error", "Uncaught exception", {
        name: error.name,
        message: error.message
    });
    releaseInstanceLock();
    setTimeout(() => process.exit(1), 250);
});

async function bootServices(): Promise<void> {
    const lock = acquireInstanceLock();
    if (!lock.ok) {
        console.error(`[preflight] ${lock.reason}`);
        process.exit(1);
        return;
    }

    const preflight = await runStartupPreflight();
    if (preflight.warnings.length > 0) {
        console.warn(`[preflight] warnings=${preflight.warnings.length} ${summarizePreflightMessages(preflight.warnings)}`);
    }

    if (preflight.errors.length > 0) {
        console.error(`[preflight] errors=${preflight.errors.length} ${summarizePreflightMessages(preflight.errors)}`);
        postOpsAlert("error", "Startup preflight failed", {
            errors: preflight.errors.join(" | "),
            warnings: preflight.warnings.join(" | ")
        });
        process.exit(1);
        return;
    }

    recordRuntimeStartup();
    await client.login(process.env.DISCORD_TOKEN);
}

void bootServices().catch(error => {
    console.error("Boot failed:", error);
    recordRuntimeShutdown("boot_failed");
    postOpsAlert("error", "Boot failed", {
        reason: toSafeString(error)
    });
    process.exit(1);
});