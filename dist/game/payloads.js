"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RAID_RESULT_ACTION_IDS = void 0;
exports.rarityBadge = rarityBadge;
exports.getSellableInventoryOptions = getSellableInventoryOptions;
exports.buildSellPickerPayload = buildSellPickerPayload;
exports.buildInventoryPayload = buildInventoryPayload;
exports.buildShopPayload = buildShopPayload;
exports.buildTradeActionPayload = buildTradeActionPayload;
exports.buildCrateOpenPayload = buildCrateOpenPayload;
exports.buildConsumableUsePayload = buildConsumableUsePayload;
exports.buildRaidResultPayload = buildRaidResultPayload;
const discord_js_1 = require("discord.js");
const catalog_1 = require("./catalog");
exports.RAID_RESULT_ACTION_IDS = {
    inventory: "raid_result_inventory",
    history: "raid_result_history",
    bosses: "raid_result_bosses"
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
    return JSON.stringify({ embed: embed.toJSON() });
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
        ? "No boss signature detected."
        : result.bossDefeated
            ? `${result.bossName || mapCfg.bossName} neutralized.${result.bossBonusXp ? ` Bonus Raid XP +${result.bossBonusXp}.` : ""}`
            : `${result.bossName || mapCfg.bossName} spawned but was not defeated.${result.bossKillChance ? ` Kill chance rolled at ${result.bossKillChance}%.` : ""}`;
    const heartLine = result.bossHeartUnlockedName
        ? `First-Kill Trophy: ${result.bossHeartUnlockedName}`
        : result.bossDefeated
            ? "First-Kill Trophy: already claimed previously or boss heart not eligible."
            : "First-Kill Trophy: no heart awarded because the boss was not defeated.";
    const bossIdentity = result.bossSpawned
        ? `${result.bossName || mapCfg.bossName}${result.bossTitle ? ` • ${result.bossTitle}` : ""}`
        : "No boss signature detected.";
    const bossFerocityLine = result.bossSpawned
        ? `Threat Class: ${ferocityLabel(result.bossFerocity)}${result.bossFerocity ? ` • Ferocity ${result.bossFerocity.toFixed(2)}` : ""}`
        : "Threat Class: Clear";
    const specialMoments = [
        result.bossHeartUnlockedName ? `• New Boss Heart Unlocked: ${result.bossHeartUnlockedName}` : null,
        result.pmcTierUnlockedLabel ? `• Milestone Tier Reached: ${result.pmcTierUnlockedBadge || "🏅"} ${result.pmcTierUnlockedLabel}` : null,
        enhancedDrops.length ? `• Enhanced Recovery: ${enhancedDrops.map(entry => entry.def?.name || entry.id).join(", ")}` : null,
        mythicDrops.length ? `• Mythic Cache Hit: ${mythicDrops.map(entry => entry.def?.name || entry.id).join(", ")}` : null
    ].filter(Boolean);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(result.success ? 0x16a34a : 0xdc2626)
        .setTitle(result.success ? "✅ Raid Operation Extracted" : "❌ Raid Operation Failed")
        .setDescription(result.success
        ? "Strike team returned with confirmed extraction and premium-grade combat telemetry."
        : "Extraction failed. Review loadout synergy, map pressure, and tension before redeploy.")
        .setThumbnail(armyIconUrl)
        .addFields({
        name: "Mission Header",
        value: [
            `Map: ${result.mapLabel || mapCfg.label}`,
            `Tension: ${tensionLabel || fallbackTension}`,
            `Condition: ${conditionLabel || "Standard"}`,
            `Map Tier: ${mapCfg.lootTier}`
        ].join("\n"),
        inline: false
    }, {
        name: "Combat Readout",
        value: [
            `Weapon: ${result.selectedWeaponName || "Auto-best"}`,
            `Armor: ${result.selectedArmorName || "Auto-best"}`,
            `Success Chance: ${result.successChance || 0}%`,
            `Outcome Status: ${result.success ? "SUCCESS" : "FAILURE"}`
        ].join("\n"),
        inline: true
    }, {
        name: "Reward Snapshot",
        value: [
            `Net Token Delta: ${signedNet} FN Token$`,
            `Raid XP Gained: +${result.rxpGain || 0}`,
            `Boss XP Bonus: +${result.bossBonusXp || 0}`,
            `Boss Kill Chance: ${result.bossKillChance || 0}%`
        ].join("\n"),
        inline: true
    }, {
        name: "Boss Encounter",
        value: [
            bossIdentity,
            result.bossSpawned ? `Threat Level: ${result.bossDefeated ? "ELIMINATED" : "ACTIVE CONTACT"}` : "Threat Level: Clear",
            bossFerocityLine,
            bossResolution,
            heartLine
        ].join("\n"),
        inline: false
    }, {
        name: "Recovered Loot",
        value: lootRows.slice(0, 10).join("\n"),
        inline: false
    }, {
        name: "Highest Value Recoveries",
        value: highValueLoot,
        inline: false
    }, ...(specialMoments.length ? [{
            name: "Premium Event Flags",
            value: specialMoments.join("\n"),
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
        .setStyle(discord_js_1.ButtonStyle.Secondary));
    return JSON.stringify({ embed: embed.toJSON(), components: [actionRow.toJSON()] });
}
