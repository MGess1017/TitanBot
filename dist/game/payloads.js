"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEAR_UI_IDS = exports.RAID_ENCOUNTER_IDS = exports.RAID_RESULT_ACTION_IDS = void 0;
exports.rarityBadge = rarityBadge;
exports.getSellableInventoryOptions = getSellableInventoryOptions;
exports.buildSellPickerPayload = buildSellPickerPayload;
exports.buildInventoryPayload = buildInventoryPayload;
exports.buildShopPayload = buildShopPayload;
exports.buildTradeActionPayload = buildTradeActionPayload;
exports.buildCrateOpenPayload = buildCrateOpenPayload;
exports.buildConsumableUsePayload = buildConsumableUsePayload;
exports.buildRaidResultPayload = buildRaidResultPayload;
exports.buildRareRouteDecisionPayload = buildRareRouteDecisionPayload;
exports.buildBossBattlePayload = buildBossBattlePayload;
exports.buildRaidBranchDecisionPayload = buildRaidBranchDecisionPayload;
const discord_js_1 = require("discord.js");
const catalog_1 = require("./catalog");
exports.RAID_RESULT_ACTION_IDS = {
    inventory: "raid_result_inventory",
    history: "raid_result_history",
    bosses: "raid_result_bosses",
    mastery: "raid_result_mastery"
};
exports.RAID_ENCOUNTER_IDS = {
    hiddenExit: "raid_route_hidden_exit",
    routeCache: "raid_route_cache",
    securePerimeter: "raid_branch_secure_perimeter",
    pushObjective: "raid_branch_push_objective",
    stayCourse: "raid_route_stay_course",
    attack: "raid_boss_attack",
    defend: "raid_boss_defend",
    heal: "raid_boss_heal",
    scan: "raid_boss_scan"
};
exports.GEAR_UI_IDS = {
    repair: "gear_repair",
    insure: "gear_insure",
    craft: "gear_craft",
    upgrade: "gear_upgrade",
    dismantle: "gear_dismantle",
    loadout: "gear_loadout"
};
function kindLabel(kind) {
    const key = String(kind || "resource");
    if (key === "weapon")
        return "Weapons";
    if (key === "armor")
        return "Armor";
    if (key === "crate")
        return "Crates";
    if (key === "consumable")
        return "Consumables";
    if (key === "intel")
        return "Intel";
    if (key === "module")
        return "Modules";
    if (key === "collectible")
        return "Collectibles";
    if (key === "key")
        return "Key Items";
    if (key === "token")
        return "Tokens";
    if (key === "achievement")
        return "Trophies";
    return "Resources";
}
function ferocityLabel(value) {
    const ferocity = Math.max(0, Number(value || 0));
    if (ferocity >= 2)
        return "Cataclysmic";
    if (ferocity >= 1.7)
        return "Apex";
    if (ferocity >= 1.35)
        return "Brutal";
    if (ferocity >= 1)
        return "Elite";
    if (ferocity >= 0.75)
        return "Veteran";
    return "Standard";
}
function toPercent(current, max) {
    if (max <= 0)
        return 0;
    return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}
function healthBar(currentRaw, maxRaw, width = 14) {
    const max = Math.max(1, Math.floor(Number(maxRaw) || 0));
    const current = Math.max(0, Math.min(max, Math.floor(Number(currentRaw) || 0)));
    const fill = Math.max(0, Math.min(width, Math.round((current / max) * width)));
    const empty = Math.max(0, width - fill);
    return `[${"#".repeat(fill)}${"-".repeat(empty)}] ${current}/${max} (${toPercent(current, max)}%)`;
}
function rarityBadge(rarityRaw) {
    const rarity = String(rarityRaw || "common").toLowerCase();
    if (rarity === "common")
        return "C";
    if (rarity === "uncommon")
        return "U";
    if (rarity === "rare")
        return "R";
    if (rarity === "epic")
        return "E";
    if (rarity === "legendary")
        return "L";
    if (rarity === "mythic")
        return "M";
    return "?";
}
function getSellableInventoryOptions(input) {
    const focused = (input.focusedRaw || "").trim().toLowerCase();
    return Object.entries(input.inventory)
        .map(([id, qty]) => ({ id, qty: Math.max(0, Math.floor(Number(qty) || 0)), def: catalog_1.ITEM_DEFS[id] }))
        .filter(entry => entry.qty > 0 && entry.def && entry.def.price > 0)
        .map(entry => ({
        id: entry.id,
        name: entry.def.name,
        qty: entry.qty,
        unitPrice: (0, catalog_1.getVendorSellPrice)(entry.id),
        rarity: entry.def.rarity || "common"
    }))
        .filter(entry => {
        if (!focused)
            return true;
        return `${entry.id} ${entry.name} ${entry.rarity}`.toLowerCase().includes(focused);
    })
        .sort((a, b) => b.unitPrice - a.unitPrice || b.qty - a.qty || a.name.localeCompare(b.name));
}
function buildSellPickerPayload(input) {
    const sellables = getSellableInventoryOptions({ inventory: input.inventory }).slice(0, 25);
    if (!sellables.length) {
        return "No sellable inventory found. Run /raid, /opencrate, or /shop first.";
    }
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(input.menuId)
        .setPlaceholder("Select an owned item to sell")
        .addOptions(sellables.map(entry => ({
        label: `${entry.name} x${entry.qty}`.slice(0, 100),
        value: entry.id,
        description: `[${rarityBadge(entry.rarity)}] Sell each for ${entry.unitPrice} FN Token$`.slice(0, 100)
    })));
    const topPreview = sellables
        .slice(0, 6)
        .map(entry => `• [${rarityBadge(entry.rarity)}] ${entry.name} x${entry.qty} -> ${entry.unitPrice} FN Token$ each`)
        .join("\n");
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x0f766e)
        .setTitle("💼 Marketplace Sell Console")
        .setDescription("Choose an owned item below. After selection, click a quantity button to execute the sale.")
        .addFields({ name: "Top Sellable Inventory", value: topPreview || "No data", inline: false }, { name: "Sell Rule", value: "Vendor payout is 60% of each item base value.", inline: false });
    return JSON.stringify({
        embed: embed.toJSON(),
        components: [new discord_js_1.ActionRowBuilder().addComponents(menu).toJSON()]
    });
}
function buildInventoryPayload(input) {
    const entries = Object.entries(input.inventory)
        .map(([id, qty]) => ({ id, qty: Math.max(0, Math.floor(Number(qty) || 0)), def: catalog_1.ITEM_DEFS[id] }))
        .filter(entry => entry.qty > 0 && entry.def);
    if (!entries.length) {
        const emptyEmbed = new discord_js_1.EmbedBuilder()
            .setColor(0x0f766e)
            .setTitle("🎒 Field Inventory")
            .setDescription("Your inventory is currently empty. Run raids, open crates, or buy items to build your loadout.")
            .addFields({ name: "Quick Actions", value: "• /raid\n• /opencrate\n• /shop", inline: false });
        return JSON.stringify({ embed: emptyEmbed.toJSON() });
    }
    const totalStacks = entries.length;
    const totalUnits = entries.reduce((sum, entry) => sum + entry.qty, 0);
    const liquidationValue = entries
        .filter(entry => entry.def.kind !== "achievement")
        .reduce((sum, entry) => sum + (0, catalog_1.getVendorSellPrice)(entry.id) * entry.qty, 0);
    const kindOrder = ["collectible", "achievement", "weapon", "armor", "crate", "consumable", "intel", "key", "module", "resource", "token"];
    const kindLabels = {
        collectible: "Collectibles",
        achievement: "Boss Hearts",
        weapon: "Weapons",
        armor: "Armor",
        crate: "Crates",
        consumable: "Consumables",
        resource: "Resources",
        token: "Tokens",
        intel: "Intel",
        key: "Key Items",
        module: "Modules"
    };
    const topByValue = entries
        .filter(entry => entry.def.kind !== "achievement")
        .sort((a, b) => {
        const aValue = a.qty * (0, catalog_1.getVendorSellPrice)(a.id);
        const bValue = b.qty * (0, catalog_1.getVendorSellPrice)(b.id);
        return bValue - aValue;
    })
        .slice(0, 8)
        .map(entry => {
        const unit = (0, catalog_1.getVendorSellPrice)(entry.id);
        return `• [${rarityBadge(entry.def.rarity)}] ${entry.def.name} x${entry.qty} -> ${(unit * entry.qty).toLocaleString()} FN Token$`;
    })
        .join("\n");
    const categoryFields = kindOrder
        .map(kind => {
        const items = entries
            .filter(entry => entry.def.kind === kind)
            .sort((a, b) => b.qty - a.qty || a.def.name.localeCompare(b.def.name))
            .slice(0, 6)
            .map(entry => `• [${rarityBadge(entry.def.rarity)}] ${entry.def.name} x${entry.qty}`)
            .join("\n");
        if (!items)
            return null;
        return { name: kindLabels[kind] || "Other", value: items, inline: true };
    })
        .filter((field) => Boolean(field));
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x0f766e)
        .setTitle("🎒 Field Inventory Console")
        .setDescription("Premium loadout and loot snapshot with real-time liquidation analytics.")
        .addFields({
        name: "Inventory Snapshot",
        value: [
            `Stacks: ${totalStacks}`,
            `Units: ${totalUnits}`,
            `Wallet: ${input.wallet.toLocaleString()} FN Token$`,
            `Estimated Liquidation: ${liquidationValue.toLocaleString()} FN Token$`
        ].join("\n"),
        inline: false
    }, {
        name: "Highest Value Holdings",
        value: topByValue || "No valuation data.",
        inline: false
    }, {
        name: "Gear Condition",
        value: entries.filter(entry => entry.def.kind === "weapon" || entry.def.kind === "armor").slice(0, 8).map(entry => `${entry.def.name}: ${Math.max(0, Math.min(100, Math.floor(input.gearDurability?.[entry.id] ?? 100)))}%${input.insuredGear?.[entry.id] ? " • Insured" : ""}`).join("\n") || "No weapons or armor tracked.",
        inline: false
    }, ...categoryFields.slice(0, 6), {
        name: "Next Actions",
        value: "• /sell\n• /opencrate\n• /useitem\n• /raidintel",
        inline: false
    });
    const actionRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.inventory)
        .setLabel("View Inventory")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.history)
        .setLabel("Raid History")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.bosses)
        .setLabel("Boss Roster")
        .setStyle(discord_js_1.ButtonStyle.Secondary));
    return JSON.stringify({ embed: embed.toJSON(), components: [actionRow.toJSON()] });
}
function buildShopPayload(input) {
    const entries = input.shopItemIds
        .map(id => ({ id, def: catalog_1.ITEM_DEFS[id], owned: Math.max(0, Math.floor(Number(input.inventory[id] || 0))) }))
        .filter(entry => Boolean(entry.def));
    const topValue = entries
        .slice()
        .sort((a, b) => (b.def.price || 0) - (a.def.price || 0))
        .slice(0, 8)
        .map(entry => `• [${rarityBadge(entry.def.rarity)}] ${entry.def.name} (${entry.id}) • ${entry.def.price} FN Token$${entry.owned > 0 ? ` • Owned x${entry.owned}` : ""}`)
        .join("\n");
    const kinds = ["weapon", "armor", "crate", "consumable", "intel", "module", "resource", "token", "collectible"];
    const fields = kinds
        .map(kind => {
        const lines = entries
            .filter(entry => entry.def.kind === kind)
            .sort((a, b) => a.def.price - b.def.price || a.def.name.localeCompare(b.def.name))
            .slice(0, 6)
            .map(entry => `• [${rarityBadge(entry.def.rarity)}] ${entry.def.name} • ${entry.def.price}${entry.owned > 0 ? ` • x${entry.owned}` : ""}`)
            .join("\n");
        if (!lines)
            return null;
        return { name: kindLabel(kind), value: lines, inline: true };
    })
        .filter((field) => Boolean(field));
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x155e75)
        .setTitle("🛒 Titan Armory Exchange")
        .setDescription("Premium procurement board for weapons, armor, field consumables, and raid logistics.")
        .addFields({
        name: "Account Snapshot",
        value: [
            `Wallet: ${input.wallet.toLocaleString()} FN Token$`,
            `Catalog Entries: ${entries.length}`,
            `Owned Shop Items: ${entries.filter(entry => entry.owned > 0).length}`
        ].join("\n"),
        inline: false
    }, {
        name: "Premium Catalog Highlights",
        value: topValue || "No shop data available.",
        inline: false
    }, ...fields.slice(0, 6), {
        name: "Quick Actions",
        value: "• /buy\n• /inventory\n• /loadout\n• /raidintel",
        inline: false
    });
    const economyRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.GEAR_UI_IDS.repair).setLabel("Repair").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(exports.GEAR_UI_IDS.insure).setLabel("Insure").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(exports.GEAR_UI_IDS.craft).setLabel("Craft").setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(exports.GEAR_UI_IDS.upgrade).setLabel("Upgrade").setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId(exports.GEAR_UI_IDS.dismantle).setLabel("Dismantle").setStyle(discord_js_1.ButtonStyle.Secondary));
    const loadoutRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.GEAR_UI_IDS.loadout).setLabel("Save Loadout").setStyle(discord_js_1.ButtonStyle.Primary));
    return JSON.stringify({ embed: embed.toJSON(), components: [economyRow.toJSON(), loadoutRow.toJSON()] });
}
function buildTradeActionPayload(input) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(input.color)
        .setTitle(input.title)
        .setDescription(input.description)
        .addFields({ name: "Summary", value: input.summaryLines.join("\n"), inline: false }, ...(input.nextSteps?.length ? [{ name: "Next Steps", value: input.nextSteps.join("\n"), inline: false }] : []));
    return JSON.stringify({ embed: embed.toJSON() });
}
function buildCrateOpenPayload(input) {
    const crateDef = catalog_1.ITEM_DEFS[input.crateId];
    const drops = input.contents.map(entry => ({ ...entry, def: catalog_1.ITEM_DEFS[entry.id] }));
    const grouped = ["mythic", "legendary", "epic", "rare", "uncommon", "common"]
        .map(rarity => {
        const lines = drops
            .filter(entry => String(entry.def?.rarity || "common") === rarity)
            .map(entry => `• ${entry.qty}x ${entry.def?.name || entry.id}`)
            .join("\n");
        if (!lines)
            return null;
        return { name: `${rarity.toUpperCase()} Drops`, value: lines, inline: true };
    })
        .filter((field) => Boolean(field));
    const headline = drops
        .slice()
        .sort((a, b) => (b.def?.price || 0) - (a.def?.price || 0))
        .slice(0, 3)
        .map(entry => `• [${rarityBadge(entry.def?.rarity)}] ${entry.def?.name || entry.id}`)
        .join("\n") || "• No premium drops";
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle(`📦 ${crateDef?.name || input.crateId} Opened`)
        .setDescription(input.autoSelected
        ? "Auto-selected your best available crate and processed the opening sequence."
        : "Crate opening complete. Premium loot manifest confirmed.")
        .addFields({
        name: "Crate Status",
        value: [
            `Remaining: ${input.remaining}`,
            `Drop Count: ${drops.length}`,
            `Top Recoveries:`,
            headline
        ].join("\n"),
        inline: false
    }, ...grouped.slice(0, 6), {
        name: "Next Actions",
        value: "• /inventory\n• /useitem\n• /raid",
        inline: false
    });
    return JSON.stringify({ embed: embed.toJSON() });
}
function buildConsumableUsePayload(input) {
    const item = catalog_1.ITEM_DEFS[input.itemId];
    const notes = [
        input.autoSelected ? "Auto-selected your highest-priority usable item." : "Manual consumable activation confirmed.",
        input.adjustmentNote || null
    ].filter(Boolean);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x2563eb)
        .setTitle(`🧪 ${item?.name || input.itemId} Activated`)
        .setDescription("Field consumable effect executed and persistence updated.")
        .addFields({
        name: "Use Summary",
        value: [
            `Item: ${item?.name || input.itemId}`,
            `Quantity Used: ${input.quantity}`,
            `Type: ${kindLabel(item?.kind)}`
        ].join("\n"),
        inline: false
    }, {
        name: "Effect Resolution",
        value: input.resultText,
        inline: false
    }, {
        name: "Operational Notes",
        value: notes.join("\n") || "No additional notes.",
        inline: false
    });
    return JSON.stringify({ embed: embed.toJSON() });
}
function buildRaidResultPayload(input) {
    const { result, mapCfg, fallbackTension, armyIconUrl } = input;
    const [tensionLabel, conditionLabel] = (result.tension || fallbackTension).split(" | ");
    const signedNet = (result.net || 0) >= 0 ? `+${result.net}` : `${result.net}`;
    const lootEntries = (result.loot || []).map(entry => ({
        ...entry,
        def: catalog_1.ITEM_DEFS[entry.id]
    }));
    const lootRows = lootEntries.length
        ? lootEntries.map(entry => `• [${rarityBadge(entry.def?.rarity)}] ${entry.qty}x ${entry.def?.name || entry.id}`)
        : ["• No loot secured"];
    const enhancedDrops = lootEntries.filter(entry => entry.id.startsWith("enhanced_") && entry.def);
    const mythicDrops = lootEntries.filter(entry => String(entry.def?.rarity || "") === "mythic");
    const highValueLoot = lootEntries
        .filter(entry => entry.def)
        .sort((a, b) => (b.def?.price || 0) - (a.def?.price || 0))
        .slice(0, 4)
        .map(entry => `• ${entry.def?.name || entry.id} x${entry.qty}`)
        .join("\n") || "• No high-value drops";
    const bossResolution = !result.bossSpawned
        ? "Boss: No boss detected"
        : result.bossDefeated
            ? `${result.bossName || mapCfg.bossName} neutralized${result.bossBonusXp ? ` • +${result.bossBonusXp} raid XP` : ""}`
            : `${result.bossName || mapCfg.bossName} active • ${result.bossKillChance || 0}% kill chance`;
    const heartLine = result.bossHeartUnlockedName
        ? `Boss Heart: ${result.bossHeartUnlockedName}`
        : result.bossDefeated
            ? "Boss Heart: Not awarded"
            : "Boss Heart: Not claimed";
    const prominentLoot = lootEntries.slice(0, 3).map(entry => `${entry.qty}x ${entry.def?.name || entry.id}`).join(" • ") || "No loot secured";
    const specialMoments = [
        result.bossHeartUnlockedName ? `Boss Heart: ${result.bossHeartUnlockedName}` : null,
        result.pmcTierUnlockedLabel ? `${result.pmcTierUnlockedBadge || "🏅"} ${result.pmcTierUnlockedLabel}` : null,
        result.mapReputationTierUnlocked ? `Territory Rank: ${result.mapReputationTierUnlocked}` : null,
        enhancedDrops.length ? `Enhanced: ${enhancedDrops.map(entry => entry.def?.name || entry.id).join(", ")}` : null,
        mythicDrops.length ? `Mythic: ${mythicDrops.map(entry => entry.def?.name || entry.id).join(", ")}` : null
    ].filter(Boolean);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(result.success ? 0x16a34a : 0xdc2626)
        .setTitle(result.success ? "✅ Raid Extraction Complete" : "❌ Raid Extraction Failed")
        .setDescription([
        `${result.mapLabel || mapCfg.label}`,
        `${tensionLabel || fallbackTension} • ${conditionLabel || "Standard"}`
    ].join("\n"))
        .setThumbnail(result.bossSpawned && result.bossImageUrl ? result.bossImageUrl : armyIconUrl)
        .addFields({
        name: "Summary",
        value: [
            `Status: ${result.success ? "Extracted" : "Failed"}`,
            `Success Chance: ${result.successChance || 0}%`,
            `Approach: ${result.approachLabel || "Balanced"}`,
            `Route: ${result.extractionRouteLabel ? `${result.extractionRouteLabel} • ${result.branchDecisionLabel || "Original Route"}` : result.branchDecisionLabel || "Standard extraction lanes"}`,
            `Map Event: ${result.mapEventLabel || "None"}`,
            `PMC: Prestige ${result.pmcPrestige || 0} • ${result.pmcPrestigeLabel || "Unprestiged"}`,
            `Loadout: ${result.selectedWeaponName || "Auto-best"} • ${result.selectedArmorName || "Auto-best"}`,
            `Territory: ${result.mapReputationTier || "Unproven"} • ${result.mapReputationPoints || 0} REP`
        ].join("\n"),
        inline: false
    }, {
        name: "Rewards",
        value: [
            `Net: ${signedNet} FN Token$`,
            `Raid XP: +${result.rxpGain || 0}`,
            `Boss XP: +${result.bossBonusXp || 0}`,
            `Loot: ${lootEntries.length} item${lootEntries.length === 1 ? "" : "s"}`,
            `Map REP: +${result.mapReputationGain || 0}`
        ].join("\n"),
        inline: true
    }, {
        name: "Boss Encounter",
        value: [
            result.bossSpawned ? `${result.bossName || mapCfg.bossName}` : "Boss: No boss detected",
            bossResolution,
            heartLine,
            result.bossSpawned ? `Traits: ${result.bossTraitLabels?.join(" • ") || "Unknown"}` : null
        ].filter(Boolean).join("\n"),
        inline: true
    }, ...(result.bossSpawned ? [{
            name: "Combat Sequence",
            value: [
                `Phases Cleared: ${result.bossPhasesReached || 0}/${result.bossPhaseNames?.length || 0}`,
                `Active/Final Phase: ${result.bossCurrentPhase || "Contact"}`,
                `Sequence: ${result.bossPhaseNames?.join(" → ") || "Contact"}`,
                `Counter Intel: ${result.bossCounteredTraits?.length ? result.bossCounteredTraits.join(", ") : "No trait counter matched"}`,
                `Threat Reward Scale: ${(result.bossCombatRewardMultiplier || 1).toFixed(2)}x`,
                `Streak: ${result.bossCurrentStreak || 0} current / ${result.bossBestStreak || 0} best • Intel Lv ${result.bossIntelLevel || 0}`,
                `Heart Upgrade: ${result.bossHeartUpgradeLevel || 0}/3 • Alternate Form: ${result.bossAlternateFormUnlocked ? "Unlocked" : "Locked"}`
            ].join("\n"),
            inline: false
        }] : []), {
        name: "Recovered Loot",
        value: prominentLoot,
        inline: false
    }, ...(specialMoments.length ? [{
            name: "Premium Event Flags",
            value: specialMoments.slice(0, 3).join("\n"),
            inline: false
        }] : []));
    const actionRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.inventory)
        .setLabel("View Inventory")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.history)
        .setLabel("Raid History")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.bosses)
        .setLabel("Boss Roster")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.mastery)
        .setLabel("Map Mastery")
        .setStyle(discord_js_1.ButtonStyle.Secondary));
    return JSON.stringify({ embed: embed.toJSON(), components: [actionRow.toJSON()] });
}
function buildRareRouteDecisionPayload(input) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Rare Extraction Route Discovered")
        .setDescription(`${input.route.label}\n${input.route.description}`)
        .addFields({ name: "Access Artifact", value: `[M] ${input.requiredItemName}\nThe artifact is retained after route access.`, inline: true }, { name: "Operation Zone", value: input.mapLabel, inline: true }, { name: "Hidden Exit", value: `+${Math.round(input.route.safeSuccessBonus * 100)}% extraction chance\n-6% token multiplier`, inline: true }, { name: "Breach Route Cache", value: `-${Math.round(input.route.cacheSuccessPenalty * 100)}% extraction chance\n+${Math.round(input.route.cacheTokenBonus * 100)}% token multiplier\n+${input.route.cacheBonusRolls} loot rolls`, inline: true }, { name: "Original Route", value: "Continue without route modifiers.", inline: true })
        .setFooter({ text: "Route signal expires in 20 seconds. Timeout continues on the original route." });
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.hiddenExit).setLabel("Take Hidden Exit").setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.routeCache).setLabel("Breach Cache").setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.stayCourse).setLabel("Stay Course").setStyle(discord_js_1.ButtonStyle.Secondary));
    return JSON.stringify({ embed: embed.toJSON(), components: [row.toJSON()] });
}
function buildBossBattlePayload(input) {
    const totalTurns = Math.max(1, Math.floor(input.totalTurns));
    const turn = Math.max(0, Math.min(totalTurns, Math.floor(input.turn)));
    const progress = turn / totalTurns;
    const bossHp = input.bossHpCurrent === undefined
        ? Math.max(0, Math.round(input.bossHpMax - ((input.bossHpMax - input.bossHpFinal) * progress)))
        : Math.max(0, Math.min(input.bossHpMax, Math.floor(input.bossHpCurrent)));
    const pmcHp = input.pmcHpCurrent === undefined
        ? Math.max(0, Math.round(input.pmcHpMax - ((input.pmcHpMax - input.pmcHpFinal) * progress)))
        : Math.max(0, Math.min(input.pmcHpMax, Math.floor(input.pmcHpCurrent)));
    const phaseNames = input.bossPhaseNames?.length ? input.bossPhaseNames : ["Contact"];
    const phaseIndex = Math.min(phaseNames.length - 1, Math.floor(progress * phaseNames.length));
    const phase = turn >= totalTurns ? input.bossCurrentPhase || phaseNames[phaseIndex] : phaseNames[phaseIndex];
    const animationFrame = Math.max(0, Math.floor(input.animationFrame || 0)) % 4;
    const animationLabel = ["ENTRANCE", "CHARGE", "IMPACT", "AFTERMATH"][animationFrame];
    const animationGlyph = ["◆", "◇", "✦", "◆"][animationFrame];
    const actionLabel = input.action === "defend" ? "Defend" : input.action === "heal" ? "Heal" : input.action === "scan" ? "Scan" : "Attack";
    const actionEffect = input.action === "defend"
        ? "Damage mitigated while the PMC reads the boss counter."
        : input.action === "heal"
            ? "Field treatment stabilizes the PMC's health."
            : input.action === "scan"
                ? `Intel acquired: ${phase} phase and ${input.bossTraitLabels?.join(" / ") || "unknown traits"}.`
                : "The PMC commits a direct strike.";
    const status = turn === 0
        ? `${animationGlyph} ${input.bossName} entered the combat zone.`
        : turn < totalTurns
            ? `Turn ${turn}: ${actionLabel}. ${actionEffect} ${input.bossName} counters from ${phase}.`
            : input.bossDefeated
                ? `${input.bossName} was neutralized. The PMC holds the field.`
                : `The PMC disengaged. ${input.bossName} remains active.`;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(turn >= totalTurns ? (input.bossDefeated ? 0x16a34a : 0xdc2626) : 0xef4444)
        .setTitle(`Boss Battle • Turn ${turn}/${totalTurns}`)
        .setDescription(`**${input.bossName}${input.bossTitle ? ` • ${input.bossTitle}` : ""}** challenges the PMC.`)
        .addFields({
        name: `${input.bossName} • ${ferocityLabel(input.bossFerocity)}`,
        value: [
            `HP ${healthBar(bossHp, input.bossHpMax, 16)}`,
            `Phase: ${phase}`,
            `Traits: ${input.bossTraitLabels?.join(" • ") || "Unknown"}`,
            `Threat: ${(input.bossFerocity || 1).toFixed(2)}x • Rage ${Math.round(input.rage || 0)}%`,
            `Armor Break: ${Math.round(input.armorBreak || 0)}%${input.specialAttack ? ` • ⚠ ${input.specialAttack}` : ""}`
        ].join("\n"),
        inline: true
    }, {
        name: `PMC • Level ${(input.pmcLevel || 0).toLocaleString()} • Prestige ${input.pmcPrestige || 0}`,
        value: [
            `HP ${healthBar(pmcHp, input.pmcHpMax, 16)}`,
            `Weapon: ${input.weaponName || "Auto-best weapon"}`,
            `Armor: ${input.armorName || "Auto-best armor"}`,
            `Boss Takedown Chance: ${input.bossKillChance || 0}%${input.scanRevealed ? " • Intel revealed" : ""}`
        ].join("\n"),
        inline: true
    }, { name: `${animationLabel} • Battle Feed`, value: status, inline: false })
        .setFooter({ text: `Combat simulation • ${phaseNames.join(" -> ")}` });
    if (input.bossImageUrl)
        embed.setThumbnail(input.bossImageUrl);
    const components = turn < totalTurns && input.interactive !== false
        ? [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.attack).setLabel("Attack").setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.defend).setLabel("Defend").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.heal).setLabel("Heal").setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.scan).setLabel("Scan").setStyle(discord_js_1.ButtonStyle.Primary)).toJSON()]
        : [];
    return JSON.stringify({ embed: embed.toJSON(), components });
}
function buildRaidBranchDecisionPayload(input) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("Mid-Raid Tactical Fork")
        .setDescription(`The operation on **${input.mapLabel}** has reached an unstable decision point.`)
        .addFields({ name: "Secure Perimeter", value: "+3% extraction chance\n-4% token multiplier", inline: true }, { name: "Push Objective", value: "-3% extraction chance\n+6% token multiplier\n+1 loot roll", inline: true }, { name: "Stay Course", value: `Keep the original ${input.tension} tension plan.`, inline: true })
        .setFooter({ text: "Decision window: 15 seconds. Timeout keeps the original plan." });
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.securePerimeter).setLabel("Secure Perimeter").setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.pushObjective).setLabel("Push Objective").setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.stayCourse).setLabel("Stay Course").setStyle(discord_js_1.ButtonStyle.Secondary));
    return JSON.stringify({ embed: embed.toJSON(), components: [row.toJSON()] });
}
