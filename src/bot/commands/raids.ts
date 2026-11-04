// Raid, loadout, shop, inventory, and item slash commands.
import { canAffordTokens, ensureUser, getInventoryCount, getMapReputationEntry, getTokens } from "../../utils";
import { claimDaily } from "../../game/economy";
import { ITEM_DEFS, SHOP_ITEMS } from "../../game/catalog";
import {
    buildConsumableUsePayload, buildCrateOpenPayload, buildInventoryPayload, buildRaidResultPayload,
    buildSellPickerPayload, buildShopPayload, buildTradeActionPayload
} from "../../game/payloads";
import * as RaidDomain from "../../raid/domain";
import * as RaidRuntime from "../../raid/runtime";
import { ARMY_ICON_URL, MIN_RAID_BET, RAID_COOLDOWN_MS } from "../core/config";
import { runAsyncWithBoundary } from "../core/metrics";
import {
    recordConsumableTelemetry, recordCrateTelemetry, recordRaidTelemetry, trackRaidCommandUsage
} from "../core/telemetry";
import { appendAuditEvent } from "../core/audit";
import { syncXpRolesForUserInGuild } from "../xp/roles";
import { SELL_UI_IDS } from "../ui/ids";
import {
    activeRaidEncounters, performRaid, presentBossBattle, reconcileBossBattleOutcome, resolveRaidBranchDecision,
    resolveRareRouteDecision
} from "../raid/raids";
import { buildRaidUnlockBroadcastEmbed, sendOpsBroadcastEmbed } from "../core/reports";
import { getBestOwnedGear } from "../ui/autocomplete";
import {
    buyItem, formatOwnedCratesForPrompt, formatOwnedUsableItemsForPrompt, OPENABLE_CRATE_IDS, openCrate,
    pickBestOwnedCrate, pickBestUsableItem, sellItem, useItem
} from "../economy/items";
import {
    buildBossRosterPayload, buildConditionsPayload, buildGearIntelPayload, buildLeaderboardPayload,
    buildRaidHistoryPayload, formatMapReputationBar
} from "../raid/views";
import { type CommandHandlerMap } from "./registry";

/** Raid, loadout, shop, inventory, and item commands. */
export const raidEconomyCommands: CommandHandlerMap = {
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
        const mapCfg = RaidDomain.resolveRaidMap("plagued_cemetary");
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
        const mapCfg = RaidDomain.resolveRaidMap(mapRaw);
        const mapReputation = getMapReputationEntry(interaction.user.id, mapCfg.key);
        const mapReputationProgress = RaidDomain.getMapReputationProgress(mapReputation.points);
        const condition = RaidDomain.rollRaidCondition();
        const details = RaidRuntime.formatLoadoutSummary({ userId: interaction.user.id, condition, mapCfg, selectedWeaponId, selectedArmorId, getInventoryCount, getBestOwnedGear });
        if (details.startsWith("Selected weapon") || details.startsWith("Selected armor") || details.startsWith("You do not own")) {
            return details;
        }
        const lowProj = RaidDomain.mapProjection(mapCfg, "low");
        const medProj = RaidDomain.mapProjection(mapCfg, "medium");
        const highProj = RaidDomain.mapProjection(mapCfg, "high");
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
            `Territory Rank: ${mapReputationProgress.tier.label} • ${mapReputation.points} REP • ${formatMapReputationBar(mapReputationProgress.progressPct)}`,
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
    raid: async interaction => {
        trackRaidCommandUsage("raid");
        const userId = interaction.user.id;
        const userState = ensureUser(userId);
        if (activeRaidEncounters.has(userId)) return "You already have an active raid encounter.";
        const bet = interaction.options.getInteger("bet", true);
        const tension = interaction.options.getString("tension") || "medium";
        const mapRaw = interaction.options.getString("map") || "plagued_cemetary";
        const selectedWeaponId = interaction.options.getString("weapon");
        const selectedArmorId = interaction.options.getString("armor");
        const approachRaw = interaction.options.getString("approach") || "balanced";
        const mapCfg = RaidDomain.resolveRaidMap(mapRaw);
        if (!["low", "medium", "high"].includes(tension)) return "Tension must be low, medium, or high.";
        if (Date.now() - userState.lastRaid < RAID_COOLDOWN_MS) return `Raid ready <t:${Math.ceil((userState.lastRaid + RAID_COOLDOWN_MS) / 1000)}:R>.`;
        if (bet < MIN_RAID_BET) return `Minimum raid bet is ${MIN_RAID_BET} FN Token$.`;
        if (!canAffordTokens(userId, bet)) return `Not enough FN Token$. Wallet: ${getTokens(userId).toLocaleString()} • Required: ${bet.toLocaleString()}.`;
        const loadoutCheck = RaidRuntime.getRaidLoadoutBonus({ userId, condition: RaidDomain.RAID_CONDITIONS[0], selectedWeaponId, selectedArmorId, getInventoryCount, getBestOwnedGear });
        if (loadoutCheck.error) return loadoutCheck.error;

        activeRaidEncounters.add(userId);
        try {
            const reputation = RaidDomain.getMapReputationProgress(getMapReputationEntry(userId, mapCfg.key).points);
            const rareRoute = RaidDomain.discoverRareExtractionRoute({ mapKey: mapCfg.key, tension, reputationLevel: reputation.tier.level, inventory: userState.inventory });
            const branchDecision = rareRoute
                ? await resolveRareRouteDecision(interaction, rareRoute, mapCfg.label)
                : RaidDomain.shouldTriggerRaidDecision(tension)
                    ? await resolveRaidBranchDecision(interaction, mapCfg.label, tension)
                    : "stay_course";
            const result = performRaid(userId, bet, tension, mapRaw, selectedWeaponId, selectedArmorId, approachRaw, rareRoute, branchDecision);
            if (result.error) return result.error;
            if (result.bossSpawned) {
                const battle = await presentBossBattle(interaction, result);
                if (battle) reconcileBossBattleOutcome(userId, mapCfg, result, battle);
            }
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
                bossDefeated: result.bossDefeated,
                mapReputationGain: result.mapReputationGain,
                mapReputationTierUnlocked: Boolean(result.mapReputationTierUnlocked),
                bossTraits: result.bossTraitLabels,
                bossPhasesReached: result.bossPhasesReached,
                bossPhaseCount: result.bossPhaseNames?.length
            });

            const raidBroadcast = interaction.guild
                ? buildRaidUnlockBroadcastEmbed({ user: interaction.user, result })
                : null;
            if (interaction.guild && raidBroadcast) {
                runAsyncWithBoundary("raidUnlockBroadcast", () => sendOpsBroadcastEmbed(interaction.guild!, raidBroadcast, result.bossName));
                appendAuditEvent("raid_unlock_broadcast", {
                    guildId: interaction.guild.id,
                    userId: interaction.user.id,
                    mapLabel: result.mapLabel || mapCfg.label,
                    bossHeartUnlockedName: result.bossHeartUnlockedName || null,
                    pmcTierUnlockedLabel: result.pmcTierUnlockedLabel || null
                });
            }

            return buildRaidResultPayload({ result, mapCfg, fallbackTension: tensionLabel, armyIconUrl: ARMY_ICON_URL });
        } finally {
            activeRaidEncounters.delete(userId);
        }
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
        const state = ensureUser(interaction.user.id);
        return buildInventoryPayload({ inventory: state.inventory, wallet: getTokens(interaction.user.id), gearDurability: state.gearDurability, insuredGear: state.insuredGear });
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
    }
};
