"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.raidEconomyCommands = void 0;
// Raid, loadout, shop, inventory, and item slash commands.
const utils_1 = require("../../utils");
const economy_1 = require("../../game/economy");
const catalog_1 = require("../../game/catalog");
const payloads_1 = require("../../game/payloads");
const RaidDomain = __importStar(require("../../raid/domain"));
const RaidRuntime = __importStar(require("../../raid/runtime"));
const config_1 = require("../core/config");
const metrics_1 = require("../core/metrics");
const telemetry_1 = require("../core/telemetry");
const audit_1 = require("../core/audit");
const roles_1 = require("../xp/roles");
const ids_1 = require("../ui/ids");
const raids_1 = require("../raid/raids");
const reports_1 = require("../core/reports");
const autocomplete_1 = require("../ui/autocomplete");
const items_1 = require("../economy/items");
const views_1 = require("../raid/views");
/** Raid, loadout, shop, inventory, and item commands. */
exports.raidEconomyCommands = {
    daily: async (interaction) => {
        const userId = interaction.user.id;
        (0, utils_1.ensureUser)(userId);
        const reward = (0, economy_1.claimDaily)(userId);
        if (!reward) {
            return "You already claimed daily rewards. Try again tomorrow.";
        }
        return `Daily claimed: +${reward.bonus} XP and +${reward.tokenBonus} FN Token$. Streak: ${reward.streak} days.`;
    },
    leaderboard: async () => (0, views_1.buildLeaderboardPayload)(),
    loadout: async (interaction) => {
        (0, telemetry_1.trackRaidCommandUsage)("loadout");
        const condition = RaidDomain.rollRaidCondition();
        const mapCfg = RaidDomain.resolveRaidMap("plagued_cemetary");
        return RaidRuntime.formatLoadoutSummary({ userId: interaction.user.id, condition, mapCfg, getInventoryCount: utils_1.getInventoryCount, getBestOwnedGear: autocomplete_1.getBestOwnedGear });
    },
    bosses: async () => {
        (0, telemetry_1.trackRaidCommandUsage)("bosses");
        return (0, views_1.buildBossRosterPayload)();
    },
    conditions: async () => {
        (0, telemetry_1.trackRaidCommandUsage)("conditions");
        return (0, views_1.buildConditionsPayload)();
    },
    gearintel: async (interaction) => {
        (0, telemetry_1.trackRaidCommandUsage)("gearintel");
        const kind = interaction.options.getString("kind") || "all";
        const condition = interaction.options.getString("condition");
        return (0, views_1.buildGearIntelPayload)(kind, condition);
    },
    raidintel: async (interaction) => {
        (0, telemetry_1.trackRaidCommandUsage)("raidintel");
        const mapRaw = interaction.options.getString("map") || "plagued_cemetary";
        const selectedWeaponId = interaction.options.getString("weapon");
        const selectedArmorId = interaction.options.getString("armor");
        const mapCfg = RaidDomain.resolveRaidMap(mapRaw);
        const mapReputation = (0, utils_1.getMapReputationEntry)(interaction.user.id, mapCfg.key);
        const mapReputationProgress = RaidDomain.getMapReputationProgress(mapReputation.points);
        const condition = RaidDomain.rollRaidCondition();
        const details = RaidRuntime.formatLoadoutSummary({ userId: interaction.user.id, condition, mapCfg, selectedWeaponId, selectedArmorId, getInventoryCount: utils_1.getInventoryCount, getBestOwnedGear: autocomplete_1.getBestOwnedGear });
        if (details.startsWith("Selected weapon") || details.startsWith("Selected armor") || details.startsWith("You do not own")) {
            return details;
        }
        const lowProj = RaidDomain.mapProjection(mapCfg, "low");
        const medProj = RaidDomain.mapProjection(mapCfg, "medium");
        const highProj = RaidDomain.mapProjection(mapCfg, "high");
        const previewBonus = RaidRuntime.getRaidLoadoutBonus({ userId: interaction.user.id, condition, selectedWeaponId, selectedArmorId, getInventoryCount: utils_1.getInventoryCount, getBestOwnedGear: autocomplete_1.getBestOwnedGear });
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
            `Territory Rank: ${mapReputationProgress.tier.label} • ${mapReputation.points} REP • ${(0, views_1.formatMapReputationBar)(mapReputationProgress.progressPct)}`,
            `Mastery Perks: +${(mapReputationProgress.tier.successBonus * 100).toFixed(1)}% extraction | +${(mapReputationProgress.tier.tokenBonus * 100).toFixed(1)}% tokens | +${(mapReputationProgress.tier.bossKillBonus * 100).toFixed(1)}% boss kill`,
            `Boss Spawn Chance: ${(mapCfg.bossSpawnChance * 100).toFixed(1)}% | Favored Boss: ${mapCfg.bossName} | Rotation Pool: ${RaidDomain.RAID_BOSS_ROSTER.length} bosses`,
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
    raid: async (interaction) => {
        (0, telemetry_1.trackRaidCommandUsage)("raid");
        const userId = interaction.user.id;
        const userState = (0, utils_1.ensureUser)(userId);
        if (raids_1.activeRaidEncounters.has(userId))
            return "You already have an active raid encounter.";
        const bet = interaction.options.getInteger("bet", true);
        const tension = interaction.options.getString("tension") || "medium";
        const mapRaw = interaction.options.getString("map") || "plagued_cemetary";
        const selectedWeaponId = interaction.options.getString("weapon");
        const selectedArmorId = interaction.options.getString("armor");
        const approachRaw = interaction.options.getString("approach") || "balanced";
        const mapCfg = RaidDomain.resolveRaidMap(mapRaw);
        if (!["low", "medium", "high"].includes(tension))
            return "Tension must be low, medium, or high.";
        if (Date.now() - userState.lastRaid < config_1.RAID_COOLDOWN_MS)
            return `Raid ready <t:${Math.ceil((userState.lastRaid + config_1.RAID_COOLDOWN_MS) / 1000)}:R>.`;
        if (bet < config_1.MIN_RAID_BET)
            return `Minimum raid bet is ${config_1.MIN_RAID_BET} FN Token$.`;
        if (!(0, utils_1.canAffordTokens)(userId, bet))
            return `Not enough FN Token$. Wallet: ${(0, utils_1.getTokens)(userId).toLocaleString()} • Required: ${bet.toLocaleString()}.`;
        const loadoutCheck = RaidRuntime.getRaidLoadoutBonus({ userId, condition: RaidDomain.RAID_CONDITIONS[0], selectedWeaponId, selectedArmorId, getInventoryCount: utils_1.getInventoryCount, getBestOwnedGear: autocomplete_1.getBestOwnedGear });
        if (loadoutCheck.error)
            return loadoutCheck.error;
        raids_1.activeRaidEncounters.add(userId);
        try {
            const reputation = RaidDomain.getMapReputationProgress((0, utils_1.getMapReputationEntry)(userId, mapCfg.key).points);
            const rareRoute = RaidDomain.discoverRareExtractionRoute({ mapKey: mapCfg.key, tension, reputationLevel: reputation.tier.level, inventory: userState.inventory });
            const branchDecision = rareRoute
                ? await (0, raids_1.resolveRareRouteDecision)(interaction, rareRoute, mapCfg.label)
                : RaidDomain.shouldTriggerRaidDecision(tension)
                    ? await (0, raids_1.resolveRaidBranchDecision)(interaction, mapCfg.label, tension)
                    : "stay_course";
            const result = (0, raids_1.performRaid)(userId, bet, tension, mapRaw, selectedWeaponId, selectedArmorId, approachRaw, rareRoute, branchDecision);
            if (result.error)
                return result.error;
            if (result.bossSpawned) {
                const battle = await (0, raids_1.presentBossBattle)(interaction, result);
                if (battle)
                    (0, raids_1.reconcileBossBattleOutcome)(userId, mapCfg, result, battle);
            }
            const [tensionLabel] = (result.tension || tension).split(" | ");
            (0, telemetry_1.recordRaidTelemetry)({
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
                bossDefeated: result.bossDefeated,
                mapReputationGain: result.mapReputationGain,
                mapReputationTierUnlocked: Boolean(result.mapReputationTierUnlocked),
                bossTraits: result.bossTraitLabels,
                bossPhasesReached: result.bossPhasesReached,
                bossPhaseCount: result.bossPhaseNames?.length
            });
            const raidBroadcast = interaction.guild
                ? (0, reports_1.buildRaidUnlockBroadcastEmbed)({ user: interaction.user, result })
                : null;
            if (interaction.guild && raidBroadcast) {
                (0, metrics_1.runAsyncWithBoundary)("raidUnlockBroadcast", () => (0, reports_1.sendOpsBroadcastEmbed)(interaction.guild, raidBroadcast, result.bossName));
                (0, audit_1.appendAuditEvent)("raid_unlock_broadcast", {
                    guildId: interaction.guild.id,
                    userId: interaction.user.id,
                    mapLabel: result.mapLabel || mapCfg.label,
                    bossHeartUnlockedName: result.bossHeartUnlockedName || null,
                    pmcTierUnlockedLabel: result.pmcTierUnlockedLabel || null
                });
            }
            return (0, payloads_1.buildRaidResultPayload)({ result, mapCfg, fallbackTension: tensionLabel, armyIconUrl: config_1.ARMY_ICON_URL });
        }
        finally {
            raids_1.activeRaidEncounters.delete(userId);
        }
    },
    raidhistory: async (interaction) => {
        (0, telemetry_1.trackRaidCommandUsage)("raidhistory");
        return (0, views_1.buildRaidHistoryPayload)(interaction.user.id);
    },
    shop: async (interaction) => {
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        return (0, payloads_1.buildShopPayload)({
            shopItemIds: catalog_1.SHOP_ITEMS,
            inventory: user.inventory,
            wallet: user.fnTokens
        });
    },
    inventory: async (interaction) => {
        const state = (0, utils_1.ensureUser)(interaction.user.id);
        return (0, payloads_1.buildInventoryPayload)({ inventory: state.inventory, wallet: (0, utils_1.getTokens)(interaction.user.id), gearDurability: state.gearDurability, insuredGear: state.insuredGear });
    },
    buy: async (interaction) => {
        const item = interaction.options.getString("item", true).trim().toLowerCase();
        const qty = interaction.options.getInteger("quantity", true);
        const res = (0, items_1.buyItem)(interaction.user.id, item, qty);
        if (res.error)
            return res.error;
        return (0, payloads_1.buildTradeActionPayload)({
            title: "🛒 Procurement Confirmed",
            color: 0x16a34a,
            description: "Armory purchase accepted and inventory updated.",
            summaryLines: [
                `Item: ${catalog_1.ITEM_DEFS[item].name} (${item})`,
                `Quantity: ${qty}`,
                `Cost: ${res.cost} FN Token$`,
                `Owned After Purchase: ${res.total}`
            ],
            nextSteps: ["• /inventory", "• /loadout", "• /raidintel"]
        });
    },
    sell: async (interaction) => {
        const item = interaction.options.getString("item");
        const qty = interaction.options.getInteger("quantity") || 1;
        if (!item) {
            return (0, payloads_1.buildSellPickerPayload)({ inventory: (0, utils_1.ensureUser)(interaction.user.id).inventory, menuId: ids_1.SELL_UI_IDS.menu });
        }
        const res = (0, items_1.sellItem)(interaction.user.id, item, qty);
        if (res.error)
            return res.error;
        return (0, payloads_1.buildTradeActionPayload)({
            title: "💸 Vendor Sale Completed",
            color: 0x0f766e,
            description: "Marketplace sale executed and wallet balance updated.",
            summaryLines: [
                `Item: ${catalog_1.ITEM_DEFS[item].name} (${item})`,
                `Quantity Sold: ${qty}`,
                `Payout: ${res.payout} FN Token$`,
                `Remaining: ${res.remaining}`
            ],
            nextSteps: ["• /inventory", "• /sell", "• /shop"]
        });
    },
    opencrate: async (interaction) => {
        (0, telemetry_1.trackRaidCommandUsage)("opencrate");
        const hadExplicitCrate = Boolean(interaction.options.getString("crate"));
        let crate = interaction.options.getString("crate");
        if (!crate) {
            const autoCrate = (0, items_1.pickBestOwnedCrate)(interaction.user.id);
            if (!autoCrate) {
                return `No crates available to open.\n\nOwned crates:\n${(0, items_1.formatOwnedCratesForPrompt)(interaction.user.id)}`;
            }
            crate = autoCrate;
        }
        if (!items_1.OPENABLE_CRATE_IDS.includes(crate)) {
            return `Invalid crate id: ${crate}\n\nOwned crates:\n${(0, items_1.formatOwnedCratesForPrompt)(interaction.user.id)}`;
        }
        if ((0, utils_1.getInventoryCount)(interaction.user.id, crate) < 1) {
            return `You do not own any ${catalog_1.ITEM_DEFS[crate].name}.\n\nOwned crates:\n${(0, items_1.formatOwnedCratesForPrompt)(interaction.user.id)}`;
        }
        const res = (0, items_1.openCrate)(interaction.user.id, crate);
        if (res.error)
            return `${res.error}\n\nOwned crates:\n${(0, items_1.formatOwnedCratesForPrompt)(interaction.user.id)}`;
        (0, telemetry_1.recordCrateTelemetry)(crate, !hadExplicitCrate, res.contents || []);
        const remaining = (0, utils_1.getInventoryCount)(interaction.user.id, crate);
        return (0, payloads_1.buildCrateOpenPayload)({
            crateId: crate,
            contents: res.contents || [],
            remaining,
            autoSelected: !hadExplicitCrate
        });
    },
    useitem: async (interaction) => {
        (0, telemetry_1.trackRaidCommandUsage)("useitem");
        const xpBefore = (0, utils_1.ensureUser)(interaction.user.id).xp;
        const hadExplicitItem = Boolean(interaction.options.getString("item"));
        let item = interaction.options.getString("item");
        const quantity = interaction.options.getInteger("quantity") || 1;
        if (!item) {
            const autoItem = (0, items_1.pickBestUsableItem)(interaction.user.id);
            if (!autoItem) {
                return `No usable consumables available right now.\n\nOwned usable items:\n${(0, items_1.formatOwnedUsableItemsForPrompt)(interaction.user.id)}`;
            }
            item = autoItem;
        }
        const itemDef = catalog_1.ITEM_DEFS[item];
        if (!itemDef || itemDef.kind !== "consumable") {
            return `That item cannot be used with /useitem.\n\nOwned usable items:\n${(0, items_1.formatOwnedUsableItemsForPrompt)(interaction.user.id)}`;
        }
        const owned = (0, utils_1.getInventoryCount)(interaction.user.id, item);
        if (owned < 1) {
            return `You do not own any ${itemDef.name}.\n\nOwned usable items:\n${(0, items_1.formatOwnedUsableItemsForPrompt)(interaction.user.id)}`;
        }
        let useQty = Math.max(1, Math.floor(quantity));
        let adjustmentNote = "";
        if (useQty > owned) {
            useQty = owned;
            adjustmentNote = `Quantity adjusted to owned amount (${owned}).`;
        }
        if (item === "repair_kit") {
            const scrapOwned = (0, utils_1.getInventoryCount)(interaction.user.id, "scrap");
            const maxByScrap = Math.floor(scrapOwned / 6);
            if (maxByScrap < 1) {
                return `You need at least 6 scrap to use ${itemDef.name}.\n\nOwned usable items:\n${(0, items_1.formatOwnedUsableItemsForPrompt)(interaction.user.id)}`;
            }
            if (useQty > maxByScrap) {
                useQty = maxByScrap;
                adjustmentNote = `Quantity adjusted to ${useQty} based on current scrap reserves.`;
            }
        }
        const res = (0, items_1.useItem)(interaction.user.id, item, useQty);
        if (res.error) {
            (0, telemetry_1.recordConsumableTelemetry)(item, useQty, !hadExplicitItem, true);
            return `${res.error}\n\nOwned usable items:\n${(0, items_1.formatOwnedUsableItemsForPrompt)(interaction.user.id)}`;
        }
        const xpAfter = (0, utils_1.ensureUser)(interaction.user.id).xp;
        if (interaction.guild && xpAfter > xpBefore) {
            await (0, roles_1.syncXpRolesForUserInGuild)(interaction.guild, interaction.user.id, xpAfter);
        }
        (0, telemetry_1.recordConsumableTelemetry)(item, useQty, !hadExplicitItem, false);
        const resultText = res.result || `Used ${useQty}x ${itemDef.name}.`;
        return (0, payloads_1.buildConsumableUsePayload)({
            itemId: item,
            quantity: useQty,
            resultText,
            autoSelected: !hadExplicitItem,
            adjustmentNote: adjustmentNote || undefined
        });
    }
};
