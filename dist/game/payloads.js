"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEAR_UI_IDS = exports.RAID_ENCOUNTER_IDS = exports.RAID_RESULT_ACTION_IDS = void 0;
exports.buildBossRosterPayload = buildBossRosterPayload;
exports.rarityBadge = rarityBadge;
exports.getSellableInventoryOptions = getSellableInventoryOptions;
exports.buildSellPickerPayload = buildSellPickerPayload;
exports.buildInventoryPayload = buildInventoryPayload;
exports.buildShopPayload = buildShopPayload;
exports.buildTradeActionPayload = buildTradeActionPayload;
exports.buildCrateOpenPayload = buildCrateOpenPayload;
exports.buildConsumableUsePayload = buildConsumableUsePayload;
exports.buildRaidResultPayload = buildRaidResultPayload;
exports.buildBossIntelPayload = buildBossIntelPayload;
exports.buildRareRouteDecisionPayload = buildRareRouteDecisionPayload;
exports.buildBossBattlePayload = buildBossBattlePayload;
exports.buildRaidBranchDecisionPayload = buildRaidBranchDecisionPayload;
const discord_js_1 = require("discord.js");
const catalog_1 = require("./catalog");
const domain_1 = require("../raid/domain");
exports.RAID_RESULT_ACTION_IDS = {
    inventory: "raid_result_inventory",
    history: "raid_result_history",
    bosses: "raid_result_bosses",
    mastery: "raid_result_mastery",
    supplies: "raid_result_supplies",
    bossIntel: "raid_boss_intel"
};
function buildBossRosterPayload(bossLeaderboard) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xd97706)
        .setTitle("👑 Raid Boss Roster")
        .setDescription(`${domain_1.RAID_BOSS_ROSTER.length} bosses • Home territories and threat ratings\nSelect a boss below for detailed intel.`)
        .addFields({
        name: "Rotation Key",
        value: Object.values(domain_1.RAID_MAPS).map(map => `${domain_1.RAID_MAP_SHORT_LABELS[map.key]} = ${map.label}`).join("\n"),
        inline: false
    }, {
        name: "Roster Summary",
        value: [
            `Total Bosses: ${domain_1.RAID_BOSS_ROSTER.length}`,
            `Maps Covered: ${Object.keys(domain_1.RAID_MAPS).length}`,
            `Highest Threat: ${Math.max(...domain_1.RAID_BOSS_ROSTER.map(boss => boss.ferocity)).toFixed(2)} ferocity`
        ].join("\n"),
        inline: false
    }, {
        name: "Boss Leaderboard",
        value: bossLeaderboard.slice(0, 5).map((boss, index) => `#${index + 1} ${boss.name} • ${boss.totalKills} kills • Best streak ${boss.bestStreak}`).join("\n") || "No boss kills recorded.",
        inline: false
    });
    const selector = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.bossIntel)
        .setPlaceholder("Boss intel and personal progress")
        .addOptions(domain_1.RAID_BOSS_ROSTER.map(boss => ({ label: boss.name, value: boss.name, description: `${boss.homeMapLabel} • ${boss.ferocity.toFixed(2)}x ferocity` }))));
    return JSON.stringify({ embed: embed.toJSON(), components: [selector.toJSON()] });
}
exports.RAID_ENCOUNTER_IDS = {
    hiddenExit: "raid_route_hidden_exit",
    routeCache: "raid_route_cache",
    securePerimeter: "raid_branch_secure_perimeter",
    pushObjective: "raid_branch_push_objective",
    stayCourse: "raid_route_stay_course",
    surveySite: "raid_objective_survey",
    rescuePatrol: "raid_objective_rescue",
    attack: "raid_boss_attack",
    defend: "raid_boss_defend",
    heal: "raid_boss_heal",
    scan: "raid_boss_scan",
    extract: "raid_boss_extract"
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
    const net = result.net || 0;
    const signedNet = `${net >= 0 ? "+" : ""}${net.toLocaleString()}`;
    const lootStacks = new Map();
    for (const entry of result.loot || []) {
        if (entry.qty > 0)
            lootStacks.set(entry.id, (lootStacks.get(entry.id) || 0) + entry.qty);
    }
    const rarityOrder = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
    const lootEntries = Array.from(lootStacks, ([id, qty]) => ({ id, qty })).map(entry => ({
        ...entry,
        def: catalog_1.ITEM_DEFS[entry.id]
    })).sort((first, second) => rarityOrder.indexOf(second.def?.rarity || "common") - rarityOrder.indexOf(first.def?.rarity || "common") || (0, catalog_1.getVendorSellPrice)(second.id) * second.qty - (0, catalog_1.getVendorSellPrice)(first.id) * first.qty);
    const lootRows = [];
    let lootLength = 0;
    for (const entry of lootEntries.slice(0, 6)) {
        const line = `[${rarityBadge(entry.def?.rarity)}] ${entry.qty}x ${entry.def?.name || entry.id}`;
        if (lootLength + line.length + 1 > 500)
            break;
        lootRows.push(line);
        lootLength += line.length + 1;
    }
    if (lootRows.length < lootEntries.length)
        lootRows.push(`+${lootEntries.length - lootRows.length} more stacks in inventory`);
    const notableEvents = [
        result.bossHeartUnlockedName ? `Boss heart: ${result.bossHeartUnlockedName}` : null,
        result.pmcTierUnlockedLabel ? `${result.pmcTierUnlockedBadge || "🏅"} PMC tier: ${result.pmcTierUnlockedLabel}` : null,
        result.mapReputationTierUnlocked ? `Map rank: ${result.mapReputationTierUnlocked}` : null,
        result.sirGruLevel && result.sirGruLevelBefore && result.sirGruLevel > result.sirGruLevelBefore ? `Sir Gru reached level ${result.sirGruLevel}` : null
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
        name: "Outcome",
        value: [
            `${result.success ? "Extracted" : "Failed"} • ${result.successChance || 0}% chance`,
            result.pmcPrestige ? `PMC Prestige ${result.pmcPrestige}` : null,
            result.approachLabel ? `Approach: ${result.approachLabel}` : null,
            result.extractionRouteLabel ? `Route: ${result.extractionRouteLabel}` : null,
            result.objectiveOutcome ? `Objective: ${result.objectiveOutcome.slice(0, 120)}` : null,
            result.mapEventLabel ? `Event: ${result.mapEventLabel}` : null
        ].filter(Boolean).join("\n"),
        inline: false
    }, {
        name: "Rewards",
        value: [
            `Net: ${signedNet} FN Token$`,
            `Raid XP: +${result.rxpGain || 0}`,
            result.mapReputationGain ? `Map REP: +${result.mapReputationGain}` : null,
            `Loot: ${lootEntries.reduce((total, entry) => total + entry.qty, 0)} items • value ${lootEntries.reduce((total, entry) => total + (0, catalog_1.getVendorSellPrice)(entry.id) * entry.qty, 0).toLocaleString()} FN Token$`
        ].filter(Boolean).join("\n"),
        inline: true
    }, {
        name: "Boss Engagement",
        value: result.bossSpawned ? [
            `${result.bossName || mapCfg.bossName} • ${result.bossDefeated ? "Defeated" : "Still active"}`,
            result.bossDefeated && result.bossBonusXp ? `Boss XP: +${result.bossBonusXp}` : null,
            !result.bossDefeated && result.bossKillChance ? `Takedown chance: ${result.bossKillChance}%` : null,
            result.bossHpMax ? `Boss HP: ${result.bossHpRemaining ?? result.bossHpMax}/${result.bossHpMax}` : null,
            result.pmcHpMax ? `PMC HP: ${result.pmcHpRemaining ?? result.pmcHpMax}/${result.pmcHpMax}` : null,
            result.bossHeartUnlockedName ? `Heart unlocked: ${result.bossHeartUnlockedName}` : null
        ].filter(Boolean).join("\n") : "No boss detected",
        inline: false
    }, {
        name: "Recovered Loot",
        value: lootRows.join("\n") || "No loot secured",
        inline: false
    }, ...(result.newGearNames?.length ? [{
            name: "New Gear",
            value: result.newGearNames.slice(0, 3).join(", ").slice(0, 300),
            inline: false
        }] : []), ...(notableEvents.length ? [{
            name: "Unlocks",
            value: notableEvents.slice(0, 3).join("\n").slice(0, 500),
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
        .setCustomId(mapCfg.key ? `${exports.RAID_RESULT_ACTION_IDS.mastery}:${mapCfg.key}` : exports.RAID_RESULT_ACTION_IDS.mastery)
        .setLabel("Map Mastery")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(exports.RAID_RESULT_ACTION_IDS.supplies)
        .setLabel("Supplies")
        .setStyle(discord_js_1.ButtonStyle.Secondary));
    return JSON.stringify({ embed: embed.toJSON(), components: [actionRow.toJSON()] });
}
function buildBossIntelPayload(input) {
    const boss = domain_1.RAID_BOSS_ROSTER.find(entry => entry.name === input.bossName);
    if (!boss)
        throw new Error("Unknown raid boss.");
    const profile = (0, domain_1.getBossCombatProfile)(boss.name);
    const progress = input.progress;
    const traits = profile.traits.slice(0, 4).map(key => {
        const trait = domain_1.BOSS_TRAITS[key];
        return `${trait.label}${trait.counterApproach ? ` • counter: ${domain_1.RAID_APPROACHES[trait.counterApproach].label}` : ""}`;
    });
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xd97706)
        .setTitle(boss.name)
        .setDescription(`${boss.homeMapLabel} • ${ferocityLabel(boss.ferocity)} ${boss.ferocity.toFixed(2)}x`)
        .addFields({ name: "Combat", value: [
            `Traits: ${traits.join("; ") || "Unknown"}`,
            `Phases: ${[...profile.phases].sort((first, second) => second.thresholdPct - first.thresholdPct).map(phase => `${phase.name} (${phase.thresholdPct}%)`).join(" → ")}`
        ].join("\n"), inline: false }, { name: "Rewards", value: [
            `Raid XP: ${boss.bonusXpRange.join("–")} • Tokens: ${boss.tokenRewardRange.join("–")} • Rare drop ${Math.round(boss.rareDropChance * 100)}%`,
            `Gear: ${[...new Set([...boss.weaponDrops, ...boss.armorDrops])].slice(0, 3).map(id => catalog_1.ITEM_DEFS[id]?.name || id).join(", ") || "None listed"}`
        ].join("\n"), inline: true }, { name: "Your Record", value: progress
            ? `${progress.kills}/${progress.encounters} kills • Best streak ${progress.bestStreak}\nHeart ${progress.heartUpgradeLevel}/3 • Intel ${progress.intelLevel}/5`
            : "No boss encounters yet.", inline: true });
    return JSON.stringify({ embed: embed.toJSON() });
}
function buildRareRouteDecisionPayload(input) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Rare Extraction Route Discovered")
        .setDescription(`${input.route.label} • ${input.mapLabel}\n${input.route.description}`.slice(0, 400))
        .addFields({ name: "Access", value: `[M] ${input.requiredItemName} • retained after use.`, inline: true }, { name: "Route Effects", value: [
            `Hidden Exit: +${Math.round(input.route.safeSuccessBonus * 100)}% extract / -6% tokens`,
            `Cache: -${Math.round(input.route.cacheSuccessPenalty * 100)}% extract / +${Math.round(input.route.cacheTokenBonus * 100)}% tokens / +${input.route.cacheBonusRolls} loot`,
            "Stay Course: no route modifiers"
        ].join("\n"), inline: false })
        .setFooter({ text: "20 seconds • timeout keeps the original route" });
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
    const phase = input.bossCurrentPhase || phaseNames[phaseIndex];
    const finished = input.finished === true || turn >= totalTurns || bossHp <= 0 || pmcHp <= 0;
    const animationFrame = Math.max(0, Math.floor(input.animationFrame || 0)) % 4;
    const animationGlyph = ["◆", "◇", "✦", "◆"][animationFrame];
    const actionLabel = input.action === "defend" ? "Defend" : input.action === "heal" ? "Heal" : input.action === "scan" ? "Scan" : "Attack";
    const actionEffect = input.action === "defend"
        ? "Defending"
        : input.action === "heal"
            ? "Field treatment"
            : input.action === "scan"
                ? `Scanning ${phase}`
                : "Direct strike";
    const status = finished
        ? bossHp <= 0 || input.bossDefeated
            ? `${input.bossName} was neutralized. The PMC holds the field.`
            : pmcHp <= 0
                ? "PMC incapacitated. Combat ended."
                : `The PMC disengaged. ${input.bossName} remains active.`
        : turn === 0
            ? `${animationGlyph} ${input.bossName} entered the combat zone.`
            : turn < totalTurns
                ? `Turn ${turn}: ${actionLabel}. ${actionEffect} ${input.bossName} counters from ${phase}.`
                : input.bossDefeated
                    ? `${input.bossName} was neutralized. The PMC holds the field.`
                    : `The PMC disengaged. ${input.bossName} remains active.`;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(finished ? (bossHp <= 0 || input.bossDefeated ? 0x16a34a : 0xdc2626) : 0xef4444)
        .setTitle(`Boss Battle • ${finished ? "Complete" : `Turn ${turn + 1}/${totalTurns}`}`)
        .setDescription(`**${input.bossName}** • ${phase}`)
        .addFields({
        name: `Boss • ${ferocityLabel(input.bossFerocity)} ${(input.bossFerocity || 1).toFixed(2)}x`,
        value: [
            `HP ${healthBar(bossHp, input.bossHpMax, 16)}`,
            `Takedown chance ${Math.max(0, Math.min(100, Math.floor(input.bossKillChance || 0)))}%`,
            input.bossTraitLabels?.length ? `Traits: ${input.bossTraitLabels.slice(0, 2).join(" • ")}` : null,
            input.phaseMechanic ? input.phaseMechanic.slice(0, 140) : null,
            input.specialAttack ? `⚠ ${input.specialAttack.slice(0, 100)}` : null,
            input.rage ? `Rage ${Math.round(input.rage)}%` : null,
            input.armorBreak ? `Armor break ${Math.round(input.armorBreak)}%` : null,
            input.counteredTraits?.length ? `Countered: ${input.counteredTraits.slice(0, 2).join(", ")}` : null
        ].filter(Boolean).join("\n"),
        inline: true
    }, {
        name: `PMC • Lv ${(input.pmcLevel || 0).toLocaleString()} • P${input.pmcPrestige || 0}`,
        value: [
            `HP ${healthBar(pmcHp, input.pmcHpMax, 16)}`,
            input.weaponName || input.armorName ? `Loadout: ${[input.weaponName, input.armorName].filter(Boolean).join(" / ")}` : null,
            input.medPatchCount !== undefined ? `Med patches: ${input.medPatchCount}` : null,
            input.scanRevealed ? "Boss intel revealed" : null
        ].filter(Boolean).join("\n"),
        inline: true
    }, { name: "Action", value: (input.battleLog?.[input.battleLog.length - 1] || `${actionLabel}: ${actionEffect}. ${status}`).slice(0, 240), inline: false }, ...(!finished && input.decisionDeadline ? [{ name: "Decision", value: `<t:${Math.floor(input.decisionDeadline / 1000)}:R>`, inline: false }] : []))
        .setFooter({ text: `${turn}/${totalTurns} turns` });
    if (input.bossImageUrl)
        embed.setThumbnail(input.bossImageUrl);
    const components = !finished && input.interactive !== false
        ? [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.attack).setLabel("Attack").setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.defend).setLabel("Defend").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.heal).setLabel(input.medPatchCount === undefined ? "Heal" : `Heal (${Math.max(0, input.medPatchCount)})`).setStyle(discord_js_1.ButtonStyle.Success).setDisabled(input.medPatchCount === 0 || pmcHp >= input.pmcHpMax), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.scan).setLabel("Scan").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.extract).setLabel("Extract Now").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON()]
        : [];
    return JSON.stringify({ embed: embed.toJSON(), components });
}
function buildRaidBranchDecisionPayload(input) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("Raid Decision")
        .setDescription(`${input.mapLabel} • ${input.tension} tension`)
        .addFields({
        name: "Choices",
        value: [
            "Secure: +3% extraction / -4% tokens",
            "Push: -3% extraction / +6% tokens / +1 loot",
            ...domain_1.RAID_TACTICAL_OBJECTIVES.map(objective => `${objective.label}: ${objective.description}`),
            `Stay: keep ${input.tension} plan`
        ].join("\n").slice(0, 900),
        inline: false
    })
        .setFooter({ text: "15 seconds • timeout keeps the current plan" });
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.securePerimeter).setLabel("Secure Perimeter").setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.pushObjective).setLabel("Push Objective").setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.surveySite).setLabel("Survey Site").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.rescuePatrol).setLabel("Rescue Patrol").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(exports.RAID_ENCOUNTER_IDS.stayCourse).setLabel("Stay Course").setStyle(discord_js_1.ButtonStyle.Secondary));
    return JSON.stringify({ embed: embed.toJSON(), components: [row.toJSON()] });
}
