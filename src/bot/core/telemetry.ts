// Economy and raid balance telemetry.
import { ITEM_DEFS } from "../../game/catalog";
import { BALANCE_TELEMETRY_FILE } from "./config";
import { readJsonWithBackup, writeJsonAtomic } from "./storage";

export type BalanceSlice = {
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
        reputationAwarded: number;
        reputationTierUps: number;
        bossPhasesReached: number;
        bossPhasesAvailable: number;
        byBossTrait: Record<string, { encounters: number; kills: number }>;
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
            reputationAwarded: 0,
            reputationTierUps: 0,
            bossPhasesReached: 0,
            bossPhasesAvailable: 0,
            byBossTrait: {},
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
            reputationAwarded: typeof raid.reputationAwarded === "number" ? raid.reputationAwarded : 0,
            reputationTierUps: typeof raid.reputationTierUps === "number" ? raid.reputationTierUps : 0,
            bossPhasesReached: typeof raid.bossPhasesReached === "number" ? raid.bossPhasesReached : 0,
            bossPhasesAvailable: typeof raid.bossPhasesAvailable === "number" ? raid.bossPhasesAvailable : 0,
            byBossTrait: raid.byBossTrait && typeof raid.byBossTrait === "object" ? raid.byBossTrait : {},
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

export const balanceTelemetry = readJsonWithBackup<BalanceTelemetryStore>(
    BALANCE_TELEMETRY_FILE,
    parseBalanceTelemetryStore,
    defaultBalanceTelemetryStore()
);

export function saveBalanceTelemetry(): void {
    balanceTelemetry.updatedAt = Date.now();
    writeJsonAtomic(BALANCE_TELEMETRY_FILE, balanceTelemetry);
}

function ensureBalanceSlice(store: Record<string, BalanceSlice>, key: string): BalanceSlice {
    if (!store[key]) store[key] = defaultBalanceSlice();
    return store[key];
}

export function trackRaidCommandUsage(commandName: string): void {
    balanceTelemetry.commands[commandName] = (balanceTelemetry.commands[commandName] || 0) + 1;
    saveBalanceTelemetry();
}

export function recordRaidTelemetry(input: {
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
    mapReputationGain?: number;
    mapReputationTierUnlocked?: boolean;
    bossTraits?: string[];
    bossPhasesReached?: number;
    bossPhaseCount?: number;
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
    raid.reputationAwarded += Math.max(0, Math.floor(input.mapReputationGain || 0));
    if (input.mapReputationTierUnlocked) raid.reputationTierUps += 1;
    raid.bossPhasesReached += Math.max(0, Math.floor(input.bossPhasesReached || 0));
    raid.bossPhasesAvailable += Math.max(0, Math.floor(input.bossPhaseCount || 0));
    if (input.bossSpawned) {
        for (const trait of input.bossTraits || []) {
            const traitKey = String(trait || "unknown").toLowerCase();
            const traitEntry = raid.byBossTrait[traitKey] || { encounters: 0, kills: 0 };
            traitEntry.encounters += 1;
            if (input.bossDefeated) traitEntry.kills += 1;
            raid.byBossTrait[traitKey] = traitEntry;
        }
    }
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

export function recordConsumableTelemetry(itemId: string, qty: number, autoUse: boolean, failed: boolean): void {
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

export function recordCrateTelemetry(crateId: string, autoOpen: boolean, drops: Array<{ id: string; qty: number }>): void {
    const entry = balanceTelemetry.crates[crateId] || { opened: 0, autoOpened: 0, totalDrops: 0 };
    entry.opened += 1;
    if (autoOpen) entry.autoOpened += 1;
    entry.totalDrops += drops.reduce((acc, item) => acc + Math.max(0, Math.floor(item.qty)), 0);
    balanceTelemetry.crates[crateId] = entry;
    saveBalanceTelemetry();
}
