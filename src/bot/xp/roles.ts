// XP tier roles: sync, dead letters, metrics, and XP intelligence.
import { EmbedBuilder, Guild, GuildMember, PermissionFlagsBits } from "discord.js";
import fs from "fs-extra";
import path from "path";
import {
    ensureUser, getPmcLevel, getPmcPrestigeTier, getPmcProgress, getGameStatsSummary, formatProgressPercent,
    getPoints, getXPLevel, savePoints, syncProgressAchievements, XP_LEVEL_THRESHOLDS, xpBar
} from "../../utils";
import { VOICE_ACHIEVEMENTS, XP_ACHIEVEMENTS } from "../../game/achievements";
import { getEquippedAchievementTitle } from "../../features/achievementTitles";
import "../core/env";
import {
    ACTIVITY_CHANNEL_ID, MAX_XP_ROLE_THRESHOLD, XP_ROLE_DATA_FILE, XP_ROLE_DEAD_LETTER_FILE, XP_ROLE_METRICS_FILE
} from "../core/config";
import { client } from "../core/client";
import { formatVoiceDuration, getLiveVoiceTimeMs } from "./engagement";
import { runAsyncWithBoundary } from "../core/metrics";
import { getPmcTierVisual, getPrestigeBadge } from "../pmc/visuals";
import { appendAuditEvent } from "../core/audit";
import { readJsonWithBackup, writeJsonAtomic } from "../core/storage";

type XpTierConfig = { xp: number; roleId: string; name: string };

export type RoleSanityReport = {
    configuredTierCount: number;
    existingTierCount: number;
    missing: XpTierConfig[];
    hierarchyBlocked: Array<{ tier: XpTierConfig; rolePosition: number }>;
    dryRunDiffs: string[];
    multiTierMembers: number;
    canManageRoles: boolean;
    botHighestRolePosition: number;
    configurationErrors: string[];
};

export const XP_ROLE_SYNC_RUNNING_GUILDS = new Set<string>();
const XP_ROLE_SYNC_RUNNING_MEMBERS = new Set<string>();
export const XP_ROLE_SYNC_QUEUE: Array<{ guild: Guild; userId: string; xp: number }> = [];
let XP_ROLE_SYNC_QUEUE_RUNNING = false;
export let XP_ROLE_SYNC_PAUSED = process.env.XP_ROLE_SYNC_MAINTENANCE === "1";
export function setXpRoleSyncPaused(paused: boolean) {
    XP_ROLE_SYNC_PAUSED = paused;
}
const XP_ROLE_NOTIFICATION_MODE = process.env.XP_ROLE_NOTIFICATION_MODE === "channel" ? "channel" : "dm";
type XpRoleSyncMetrics = { lastSyncAt: number; lastSuccessAt: number; lastDeadLetterReplayAt: number; processed: number; added: number; removed: number; failed: number; retries: number; highestXp: number };

function defaultXpRoleSyncMetrics(): XpRoleSyncMetrics {
    return { lastSyncAt: 0, lastSuccessAt: 0, lastDeadLetterReplayAt: 0, processed: 0, added: 0, removed: 0, failed: 0, retries: 0, highestXp: 0 };
}

function parseXpRoleSyncMetrics(raw: unknown): XpRoleSyncMetrics | null {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Partial<XpRoleSyncMetrics>;
    const seed = defaultXpRoleSyncMetrics();
    return {
        lastSyncAt: typeof value.lastSyncAt === "number" ? value.lastSyncAt : seed.lastSyncAt,
        lastSuccessAt: typeof value.lastSuccessAt === "number" ? value.lastSuccessAt : seed.lastSuccessAt,
        lastDeadLetterReplayAt: typeof value.lastDeadLetterReplayAt === "number" ? value.lastDeadLetterReplayAt : seed.lastDeadLetterReplayAt,
        processed: typeof value.processed === "number" ? value.processed : seed.processed,
        added: typeof value.added === "number" ? value.added : seed.added,
        removed: typeof value.removed === "number" ? value.removed : seed.removed,
        failed: typeof value.failed === "number" ? value.failed : seed.failed,
        retries: typeof value.retries === "number" ? value.retries : seed.retries,
        highestXp: typeof value.highestXp === "number" ? value.highestXp : seed.highestXp
    };
}

export const XP_ROLE_SYNC_METRICS: XpRoleSyncMetrics = readJsonWithBackup(XP_ROLE_METRICS_FILE, parseXpRoleSyncMetrics, defaultXpRoleSyncMetrics());

function saveXpRoleSyncMetrics(): void {
    if (process.env.VERIFY_RUNTIME_NO_PERSIST === "1") return;
    writeJsonAtomic(XP_ROLE_METRICS_FILE, XP_ROLE_SYNC_METRICS);
}

function updateXpRoleSyncMetrics(update: (metrics: XpRoleSyncMetrics) => void): void {
    update(XP_ROLE_SYNC_METRICS);
    saveXpRoleSyncMetrics();
}

export const XP_ROLE_TIERS = [
    { xp: 3000, roleId: "1526854382199771166", name: "Tier 1" },
    { xp: 7500, roleId: "1526854454455046194", name: "Tier 2" },
    { xp: 30000, roleId: "1526854514345246752", name: "Tier 3" },
    { xp: 60000, roleId: "1526854549946634360", name: "Tier 4" },
    { xp: 150000, roleId: "1526854596721508433", name: "Tier 5" },
    { xp: 300000, roleId: "1526854670260244480", name: "Tier 6" },
    { xp: 360000, roleId: "1528237537846493264", name: "Recruit I" },
    { xp: 450000, roleId: "1528237538752467155", name: "Recruit II" },
    { xp: 540000, roleId: "1528237539557769236", name: "Recruit III" },
    { xp: 630000, roleId: "1528237540039983154", name: "Scout I" },
    { xp: 720000, roleId: "1528237540589572217", name: "Scout II" },
    { xp: 810000, roleId: "1528237540828647436", name: "Scout III" },
    { xp: 900000, roleId: "1528237541873029252", name: "Vanguard I" },
    { xp: 990000, roleId: "1528237542590386386", name: "Vanguard II" },
    { xp: 1080000, roleId: "1528237543873576980", name: "Vanguard III" },
    { xp: 1170000, roleId: "1528237544398000199", name: "Ranger I" },
    { xp: 1260000, roleId: "1528237544960036874", name: "Ranger II" },
    { xp: 1350000, roleId: "1528237545597702205", name: "Ranger III" },
    { xp: 1440000, roleId: "1528237546142699530", name: "Striker I" },
    { xp: 1530000, roleId: "1528237546838954087", name: "Striker II" },
    { xp: 1620000, roleId: "1528237547849777232", name: "Striker III" },
    { xp: 1710000, roleId: "1528237548697030747", name: "Sentinel I" },
    { xp: 1800000, roleId: "1528237549795938557", name: "Sentinel II" },
    { xp: 1890000, roleId: "1528237551217803264", name: "Sentinel III" },
    { xp: 1980000, roleId: "1528237551389769779", name: "Warden I" },
    { xp: 2070000, roleId: "1528237552073576521", name: "Warden II" },
    { xp: 2160000, roleId: "1528237553453498368", name: "Warden III" },
    { xp: 2250000, roleId: "1528237554090905861", name: "Elite I" },
    { xp: 2340000, roleId: "1528237554795810967", name: "Elite II" },
    { xp: 2430000, roleId: "1528237555428884591", name: "Elite III" },
    { xp: 2520000, roleId: "1528237556406161521", name: "Titan Commander" },
    { xp: 3000000, roleId: "9999999999999900001", name: "FNT Vanguard" },
    { xp: 7000000, roleId: "9999999999999900002", name: "Void Marshal" },
    { xp: 11000000, roleId: "9999999999999900003", name: "Apex Reclaimer" },
    { xp: 15000000, roleId: "9999999999999900004", name: "Astral Legionnaire" },
    { xp: 19000000, roleId: "9999999999999900005", name: "Eclipse Warden" },
    { xp: 23000000, roleId: "9999999999999900006", name: "Mythic Paragon" },
    { xp: 27000000, roleId: "9999999999999900007", name: "Ascendant Hunter" },
    { xp: 31000000, roleId: "9999999999999900008", name: "Infinite Sovereign" },
    { xp: 35000000, roleId: "9999999999999900009", name: "Aether Commander" },
    { xp: 39000000, roleId: "9999999999999900010", name: "Celestial Titan" },
    { xp: 44000000, roleId: "9999999999999900011", name: "Omniversal Champion" },
    { xp: 50000000, roleId: "9999999999999900012", name: "FNT Immortal" }
] as const;

type XpRoleEntry = { xp: number; roleId: string; name: string };
type XpRoleDeadLetter = { guildId: string; userId: string; xp: number; attempts: number; lastError: string; updatedAt: number };

export function readXpRoleDeadLetters(): XpRoleDeadLetter[] {
    if (!fs.existsSync(XP_ROLE_DEAD_LETTER_FILE)) return [];
    try {
        const raw = fs.readJsonSync(XP_ROLE_DEAD_LETTER_FILE);
        return Array.isArray(raw) ? raw.filter(entry => entry && typeof entry.guildId === "string" && typeof entry.userId === "string") : [];
    } catch { return []; }
}

function saveXpRoleDeadLetters(entries: XpRoleDeadLetter[]): void {
    fs.ensureDirSync(path.dirname(XP_ROLE_DEAD_LETTER_FILE));
    fs.writeJsonSync(XP_ROLE_DEAD_LETTER_FILE, entries.slice(-500), { spaces: 2 });
}

function addXpRoleDeadLetter(job: { guild: Guild; userId: string; xp: number }, lastError: string): void {
    const entries = readXpRoleDeadLetters();
    const existing = entries.find(entry => entry.guildId === job.guild.id && entry.userId === job.userId);
    if (existing) {
        existing.xp = Math.max(existing.xp, job.xp);
        existing.attempts += 1;
        existing.lastError = lastError.slice(0, 240);
        existing.updatedAt = Date.now();
    } else {
        entries.push({ guildId: job.guild.id, userId: job.userId, xp: job.xp, attempts: 1, lastError: lastError.slice(0, 240), updatedAt: Date.now() });
    }
    saveXpRoleDeadLetters(entries);
}

function clearXpRoleDeadLetter(guildId: string, userId: string): void {
    const entries = readXpRoleDeadLetters();
    const remaining = entries.filter(entry => !(entry.guildId === guildId && entry.userId === userId));
    if (remaining.length !== entries.length) saveXpRoleDeadLetters(remaining);
}

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

export function upsertXpRoleEntry(entry: XpRoleEntry): XpRoleEntry[] {
    if (!Number.isFinite(entry.xp) || entry.xp <= 0 || entry.xp > MAX_XP_ROLE_THRESHOLD) {
        throw new Error(`XP role thresholds must be between 1 and ${MAX_XP_ROLE_THRESHOLD.toLocaleString()}.`);
    }
    const entries = getEffectiveXpRoleEntries().filter(item => item.xp !== entry.xp);
    entries.push(entry);
    entries.sort((a, b) => a.xp - b.xp);
    saveXpRoleEntries(entries);
    return entries;
}

export function getPersistedXpRoleMap(): Map<number, XpRoleEntry> {
    const map = new Map<number, XpRoleEntry>();
    for (const entry of readXpRoleEntries()) {
        map.set(entry.xp, entry);
    }
    return map;
}

function mergeXpRoleEntries(persisted: XpRoleEntry[]): XpRoleEntry[] {
    const entries = new Map<number, XpRoleEntry>();
    for (const entry of persisted) {
        if (Number.isFinite(entry.xp) && entry.xp > 0 && entry.xp <= MAX_XP_ROLE_THRESHOLD && Boolean(entry.roleId) && Boolean(entry.name)) {
            entries.set(entry.xp, entry);
        }
    }
    for (const entry of XP_ROLE_TIERS) {
        if (!entries.has(entry.xp)) entries.set(entry.xp, { ...entry });
    }
    return Array.from(entries.values()).sort((first, second) => first.xp - second.xp);
}

export function getEffectiveXpRoleEntries(): XpRoleEntry[] {
    return mergeXpRoleEntries(readXpRoleEntries());
}

export function getXpRoleProgress(xp: number): { currentRole?: XpRoleEntry; nextRole?: XpRoleEntry; progressText: string; progressBar: string; recentUnlocksText: string } {
    const roleEntries = getEffectiveXpRoleEntries();
    const currentRole = roleEntries.filter(entry => xp >= entry.xp).pop();
    const nextRole = roleEntries.find(entry => entry.xp > xp);
    const floor = currentRole?.xp || 0;
    const ceiling = nextRole?.xp || floor;
    const ratio = nextRole ? Math.max(0, Math.min(1, (xp - floor) / Math.max(1, ceiling - floor))) : 1;
    const filled = Math.round(ratio * 10);
    const progressBar = `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${formatProgressPercent(ratio)}`;
    const progressText = currentRole && nextRole
        ? `${Math.max(0, xp - currentRole.xp).toLocaleString()}/${(nextRole.xp - currentRole.xp).toLocaleString()} XP`
        : nextRole
            ? `${xp.toLocaleString()}/${nextRole.xp.toLocaleString()} XP`
            : "Highest configured role reached";
    return { currentRole, nextRole, progressText, progressBar, recentUnlocksText: "" };
}

function formatXpRoleUnlocks(userId: string, limit = 5): string {
    const user = ensureUser(userId);
    const recent = user.xpRoleUnlocks.slice(-limit).reverse();
    return recent.length
        ? recent.map(unlock => `${unlock.roleName} • <t:${Math.floor(unlock.unlockedAt / 1000)}:R>`).join("\n")
        : "No XP role unlocks yet";
}

export function describeXpRoleDiff(member: GuildMember, xp: number, roleEntries: XpRoleEntry[], botHighestPosition: number): { hasChange: boolean; line: string } {
    const existingEntries = roleEntries
        .map(entry => ({ entry, role: member.guild.roles.cache.get(entry.roleId) || null }))
        .filter((pair): pair is { entry: XpRoleEntry; role: NonNullable<typeof pair.role> } => Boolean(pair.role));
    const unlockedPair = existingEntries.filter(pair => xp >= pair.entry.xp).pop();
    const current = existingEntries.filter(pair => member.roles.cache.has(pair.entry.roleId));
    const currentNames = current.map(pair => pair.entry.name).join(", ") || "none";
    const removable = current.filter(pair => pair.entry.roleId !== unlockedPair?.entry.roleId && pair.role.position < botHighestPosition);
    const missingExpected = Boolean(unlockedPair && !member.roles.cache.has(unlockedPair.entry.roleId));
    const hierarchyBlocked = Boolean(unlockedPair && unlockedPair.role.position >= botHighestPosition);
    const hasChange = missingExpected || removable.length > 0 || hierarchyBlocked;
    return {
        hasChange,
        line: `<@${member.id}> ${xp.toLocaleString()} XP | has: ${currentNames} | expected: ${unlockedPair?.entry.name || "none"} | add: ${missingExpected ? unlockedPair?.entry.name : "none"} | remove: ${removable.map(pair => pair.entry.name).join(", ") || "none"}${hierarchyBlocked ? " | blocked: hierarchy" : ""}`
    };
}

export async function getEffectiveXpRoleEntriesForGuild(_guild: Guild): Promise<XpRoleEntry[]> {
    return mergeXpRoleEntries(readXpRoleEntries());
}

const XP_ROLE_COLORS = [0x64748b, 0x38bdf8, 0x22c55e, 0xeab308, 0xf97316, 0xef4444, 0xa855f7, 0x14b8a6] as const;

export function formatXpTierDisplayName(entry: XpRoleEntry): string {
    return `${entry.name} [${entry.xp.toLocaleString()} XP]`;
}

export async function ensureXpTierRoles(guild: Guild): Promise<XpRoleEntry[]> {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return getEffectiveXpRoleEntriesForGuild(guild);
    await guild.roles.fetch().catch(() => undefined);
    const entries = await getEffectiveXpRoleEntriesForGuild(guild);
    let changed = false;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const displayName = formatXpTierDisplayName(entry);
        let role = guild.roles.cache.get(entry.roleId) || guild.roles.cache.find(candidate => candidate.name === entry.name || candidate.name === displayName) || null;
        if (!role) {
            role = await guild.roles.create({
                name: displayName,
                colors: {
                    primaryColor: XP_ROLE_COLORS[Math.min(index, XP_ROLE_COLORS.length - 1)]
                },
                reason: `Create missing XP tier role for ${entry.xp} XP`
            }).catch(() => null);
            if (!role) {
                appendAuditEvent("xp_role_create_failed", { guildId: guild.id, xp: entry.xp, name: entry.name });
                continue;
            }
            appendAuditEvent("xp_role_created", { guildId: guild.id, xp: entry.xp, roleId: role.id, name: entry.name });
        }
        if (role.position >= (me.roles.highest?.position || 0)) {
            appendAuditEvent("xp_role_create_blocked", { guildId: guild.id, xp: entry.xp, roleId: role.id, reason: "role hierarchy" });
            continue;
        }
        // Keep the visible Discord role name in sync with the configured threshold so it never silently goes stale.
        if (role.name !== displayName) {
            const renamed = await role.setName(displayName, `XP tier threshold updated to ${entry.xp}`).catch(() => null);
            if (renamed) {
                appendAuditEvent("xp_role_renamed", { guildId: guild.id, roleId: role.id, xp: entry.xp, name: displayName });
            } else {
                appendAuditEvent("xp_role_rename_failed", { guildId: guild.id, roleId: role.id, xp: entry.xp, name: displayName });
            }
        }
        if (entry.roleId !== role.id) {
            entries[index] = { ...entry, roleId: role.id };
            changed = true;
        }
    }
    if (changed) saveXpRoleEntries(entries);
    return entries;
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
        const added = await refreshedMember.roles.add(unlockedRoleId).then(() => true).catch(() => false);
        updateXpRoleSyncMetrics(metrics => {
            metrics.added += added ? 1 : 0;
            metrics.failed += added ? 0 : 1;
        });
        appendAuditEvent(added ? "xp_role_added" : "xp_role_add_failed", {
            guildId: refreshedMember.guild.id,
            memberId: refreshedMember.id,
            roleId: unlockedRoleId,
            xp
        });
    }

    const removeRoleIds = manageableTierRoleIds.filter(roleId => roleId !== unlockedRoleId && refreshedMember.roles.cache.has(roleId));
    if (removeRoleIds.length) {
        const removed = await refreshedMember.roles.remove(removeRoleIds).then(() => true).catch(() => false);
        updateXpRoleSyncMetrics(metrics => {
            metrics.removed += removed ? removeRoleIds.length : 0;
            metrics.failed += removed ? 0 : 1;
        });
        appendAuditEvent(removed ? "xp_roles_removed" : "xp_roles_remove_failed", {
            guildId: refreshedMember.guild.id,
            memberId: refreshedMember.id,
            roleIds: removeRoleIds,
            xp
        });
    }

    if (unlockedRoleId || removeRoleIds.length) {
        const verified = await refreshedMember.guild.members.fetch(refreshedMember.id).catch(() => null);
        const stillMissingExpected = Boolean(unlockedRoleId && !verified?.roles.cache.has(unlockedRoleId));
        const stillHasRemoved = removeRoleIds.filter(roleId => verified?.roles.cache.has(roleId));
        if (stillMissingExpected || stillHasRemoved.length) {
            updateXpRoleSyncMetrics(metrics => { metrics.failed += 1; });
            appendAuditEvent("xp_role_post_mutation_verify_failed", {
                guildId: refreshedMember.guild.id,
                memberId: refreshedMember.id,
                expectedRoleId: unlockedRoleId || null,
                missingExpected: stillMissingExpected,
                stillPresentRoleIds: stillHasRemoved,
                xp
            });
            throw new Error("XP role post-mutation verification failed");
        }
    }
}

export async function runGuildXpRoleSyncJob(guild: Guild, sourceChannelId: string | null, startedByUserId: string): Promise<{ processed: number; synced: number; skipped: number }> {
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
        try {
            const syncedXp = user.xp;
            await syncMemberXpRoles(member, syncedXp, roleEntries);
            if (user.xp !== syncedXp) enqueueXpRoleSync(guild, member.id, user.xp);
        } catch (error) {
            addXpRoleDeadLetter({ guild, userId: member.id, xp: user.xp }, error instanceof Error ? error.message : String(error));
            skipped += 1;
            processed += 1;
            continue;
        }

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
    updateXpRoleSyncMetrics(metrics => {
        metrics.lastSyncAt = Date.now();
        metrics.lastSuccessAt = Date.now();
        metrics.processed += processed;
        metrics.highestXp = Math.max(metrics.highestXp, ...ticketlessXpValues(guild));
    });

    return { processed, synced, skipped };
}

function ticketlessXpValues(guild: Guild): number[] {
    return Array.from(guild.members.cache.values()).map(member => ensureUser(member.id).xp);
}

export async function notifyXpThresholdUnlock(guild: Guild, userId: string, previousXp: number, nextXp: number): Promise<void> {
    const entry = getEffectiveXpRoleEntries().filter(item => previousXp < item.xp && nextXp >= item.xp).pop();
    if (!entry) return;
    const userState = ensureUser(userId);
    if (userState.xpRoleUnlocks.some(unlock => unlock.roleId === entry.roleId)) return;
    userState.xpRoleUnlocks.push({ xp: entry.xp, roleName: entry.name, roleId: entry.roleId, unlockedAt: Date.now() });
    savePoints();
    const next = getEffectiveXpRoleEntries().find(item => item.xp > entry.xp);
    const message = `XP role unlocked: **${entry.name}** (${entry.xp.toLocaleString()} XP).${next ? ` Next tier: ${next.name} at ${next.xp.toLocaleString()} XP.` : " You reached the highest configured tier."}`;
    const user = await client.users.fetch(userId).catch(() => null);
    if (XP_ROLE_NOTIFICATION_MODE === "dm" && user) await user.send(message).catch(() => undefined);
    const channel = guild.channels.cache.get(ACTIVITY_CHANNEL_ID);
    if (XP_ROLE_NOTIFICATION_MODE === "channel" && channel && channel.isTextBased() && "send" in channel) await channel.send({ content: `<@${userId}> ${message}`, allowedMentions: { users: [userId] } }).catch(() => undefined);
    appendAuditEvent("xp_role_threshold_unlocked", { guildId: guild.id, userId, roleId: entry.roleId, roleName: entry.name, xp: nextXp, nextThreshold: next?.xp || null });
}

export async function syncXpRolesForUserInGuild(guild: Guild, userId: string, xp: number): Promise<boolean> {
    const syncKey = `${guild.id}:${userId}`;
    if (XP_ROLE_SYNC_RUNNING_MEMBERS.has(syncKey)) return false;
    XP_ROLE_SYNC_RUNNING_MEMBERS.add(syncKey);
    try {
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    await syncMemberXpRoles(member, xp);
    // Retry once with a forced fetch to avoid cache/race misses at threshold crossings.
    const refreshed = await guild.members.fetch(userId).catch(() => null);
    if (refreshed) {
        await syncMemberXpRoles(refreshed, xp);
    }
    appendAuditEvent("xp_role_auto_sync", { guildId: guild.id, memberId: userId, xp });
    updateXpRoleSyncMetrics(metrics => {
        metrics.lastSyncAt = Date.now();
        metrics.lastSuccessAt = Date.now();
        metrics.processed += 1;
        metrics.highestXp = Math.max(metrics.highestXp, xp);
    });
    clearXpRoleDeadLetter(guild.id, userId);
    return true;
    } catch (error) {
        appendAuditEvent("xp_role_auto_sync_failed", {
            guildId: guild.id,
            memberId: userId,
            xp,
            reason: error instanceof Error ? error.message : String(error)
        });
        return false;
    } finally {
        XP_ROLE_SYNC_RUNNING_MEMBERS.delete(syncKey);
    }
}

export async function retryXpRoleDeadLetters(): Promise<void> {
    if (XP_ROLE_SYNC_PAUSED) return;
    updateXpRoleSyncMetrics(metrics => { metrics.lastDeadLetterReplayAt = Date.now(); });
    for (const entry of readXpRoleDeadLetters().slice(0, 25)) {
        const guild = client.guilds.cache.get(entry.guildId);
        if (guild) enqueueXpRoleSync(guild, entry.userId, entry.xp);
    }
}

export async function drainXpRoleSyncQueue(): Promise<void> {
    if (XP_ROLE_SYNC_QUEUE_RUNNING || XP_ROLE_SYNC_PAUSED) return;
    XP_ROLE_SYNC_QUEUE_RUNNING = true;
    try {
        while (XP_ROLE_SYNC_QUEUE.length) {
            const job = XP_ROLE_SYNC_QUEUE.shift();
            if (!job) continue;
            let completed = false;
            for (let attempt = 1; attempt <= 3 && !completed; attempt++) {
                // Owner corrections can reduce XP after a job was queued or dead-lettered.
                job.xp = ensureUser(job.userId).xp;
                completed = await syncXpRolesForUserInGuild(job.guild, job.userId, job.xp);
                if (!completed) {
                    updateXpRoleSyncMetrics(metrics => { metrics.retries += 1; });
                    await new Promise(resolve => setTimeout(resolve, attempt * 500));
                }
            }
            if (!completed) {
                addXpRoleDeadLetter(job, "sync attempts exhausted");
                appendAuditEvent("xp_role_auto_sync_dead_letter", { guildId: job.guild.id, memberId: job.userId, xp: job.xp });
            }
        }
    } finally {
        XP_ROLE_SYNC_QUEUE_RUNNING = false;
    }
}

export function enqueueXpRoleSync(guild: Guild, userId: string, xp: number): void {
    if (XP_ROLE_SYNC_PAUSED) return;
    const existing = XP_ROLE_SYNC_QUEUE.find(job => job.guild.id === guild.id && job.userId === userId);
    if (existing) {
        existing.xp = xp;
    } else {
        if (XP_ROLE_SYNC_QUEUE.length >= 1000) {
            XP_ROLE_SYNC_QUEUE.shift();
            appendAuditEvent("xp_role_sync_queue_overflow", { guildId: guild.id, memberId: userId, xp });
        }
        XP_ROLE_SYNC_QUEUE.push({ guild, userId, xp });
    }
    runAsyncWithBoundary("xpRoleSyncQueue", drainXpRoleSyncQueue);
}

/** Detailed progression report; reused as the /profile Progression page. */
export function buildXpIntelligenceEmbed(interaction: { user: { id: string } }): EmbedBuilder {
    const user = ensureUser(interaction.user.id);
    syncProgressAchievements(interaction.user.id);
    const gameStats = getGameStatsSummary(interaction.user.id);
    const prestigeBadge = getPrestigeBadge(user.prestige);
    const engagementLevel = getXPLevel(user.xp);
    const pmcLevel = getPmcLevel(user.pmcXP);
    const pmcPrestigeTier = getPmcPrestigeTier(user.pmcPrestige);
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
        ? user.achievements.slice(-6).reverse().join("\n")
        : "No achievements yet";
    const voiceTimeMs = getLiveVoiceTimeMs(interaction.user.id);
    const voiceMinutes = Math.floor(voiceTimeMs / 60_000);
    const earnedXpAchievements = XP_ACHIEVEMENTS.filter(achievement => user.achievementIds.includes(achievement.id)).length;
    const earnedVoiceAchievements = VOICE_ACHIEVEMENTS.filter(achievement => user.achievementIds.includes(achievement.id)).length;
    const equippedAchievementTitle = getEquippedAchievementTitle(user.achievementTitleId, user.achievementIds);
    const nextXpAchievement = XP_ACHIEVEMENTS.find(achievement => user.xp < achievement.threshold);
    const nextVoiceAchievement = VOICE_ACHIEVEMENTS.find(achievement => voiceMinutes < achievement.threshold);
    const pmcProgress = getPmcProgress(user.pmcXP);
    const roleProgress = getXpRoleProgress(user.xp);
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
                name: "🎖️ XP Role Track",
                value: [
                    `Current: **${roleProgress.currentRole?.name || "No role yet"}**`,
                    `Next: **${roleProgress.nextRole ? `${roleProgress.nextRole.name} at ${roleProgress.nextRole.xp.toLocaleString()} XP` : "Maximum tier"}**`,
                    roleProgress.progressBar,
                    roleProgress.progressText
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
                    `Next PMC Level: **${pmcProgress.needForNext.toLocaleString()} XP away**`,
                    `PMC Prestige: **${pmcPrestigeTier.numeral} • ${pmcPrestigeTier.label}**`
                ].join("\n"),
                inline: true
            },
            {
                name: "🌟 Status Badges",
                value: [
                    `Engagement Prestige: **${user.prestige.toLocaleString()}**`,
                    `Prestige Badge: **${prestigeBadge.label}**`,
                    `PMC Tier: **${tierVisual.label}**`
                ].join("\n"),
                inline: true
            },
            {
                name: "🏆 Achievement Track",
                value: [
                    `XP: ${earnedXpAchievements}/${XP_ACHIEVEMENTS.length}${nextXpAchievement ? ` • Next ${nextXpAchievement.threshold.toLocaleString()} XP` : " • Capstone earned"}`,
                    `Voice: ${earnedVoiceAchievements}/${VOICE_ACHIEVEMENTS.length} • ${formatVoiceDuration(voiceTimeMs)}`,
                    nextVoiceAchievement ? `Next voice award: ${nextVoiceAchievement.title} at ${nextVoiceAchievement.threshold.toLocaleString()} minutes` : "All voice awards earned"
                ].join("\n"),
                inline: false
            },
            {
                name: "✨ Equipped Title",
                value: equippedAchievementTitle?.title || "No achievement title equipped",
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
                name: "✨ Recent Achievements",
                value: achievements,
                inline: false
            },
            {
                name: "🎖️ Recent Role Unlocks",
                value: formatXpRoleUnlocks(interaction.user.id, 5),
                inline: false
            }
        )
        .setFooter({ text: "Detailed progression data is sourced from persisted state." });
    return embed;
}
