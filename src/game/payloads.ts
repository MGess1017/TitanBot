import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";
import { getVendorSellPrice, ITEM_DEFS, type ItemDef } from "./catalog";

export const RAID_RESULT_ACTION_IDS = {
    inventory: "raid_result_inventory",
    history: "raid_result_history",
    bosses: "raid_result_bosses"
} as const;

function kindLabel(kind?: ItemDef["kind"]): string {
    const key = String(kind || "resource");
    if (key === "weapon") return "Weapons";
    if (key === "armor") return "Armor";
    if (key === "crate") return "Crates";
    if (key === "consumable") return "Consumables";
    if (key === "intel") return "Intel";
    if (key === "module") return "Modules";
    if (key === "collectible") return "Collectibles";
    if (key === "key") return "Key Items";
    if (key === "token") return "Tokens";
    if (key === "achievement") return "Trophies";
    return "Resources";
}

function ferocityLabel(value: number | undefined): string {
    const ferocity = Math.max(0, Number(value || 0));
    if (ferocity >= 2) return "Cataclysmic";
    if (ferocity >= 1.7) return "Apex";
    if (ferocity >= 1.35) return "Brutal";
    if (ferocity >= 1) return "Elite";
    if (ferocity >= 0.75) return "Veteran";
    return "Standard";
}

function toPercent(current: number, max: number): number {
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

function healthBar(currentRaw: number, maxRaw: number, width = 14): string {
    const max = Math.max(1, Math.floor(Number(maxRaw) || 0));
    const current = Math.max(0, Math.min(max, Math.floor(Number(currentRaw) || 0)));
    const fill = Math.max(0, Math.min(width, Math.round((current / max) * width)));
    const empty = Math.max(0, width - fill);
    return `[${"#".repeat(fill)}${"-".repeat(empty)}] ${current}/${max} (${toPercent(current, max)}%)`;
}

export function rarityBadge(rarityRaw?: string): string {
    const rarity = String(rarityRaw || "common").toLowerCase();
    if (rarity === "common") return "C";
    if (rarity === "uncommon") return "U";
    if (rarity === "rare") return "R";
    if (rarity === "epic") return "E";
    if (rarity === "legendary") return "L";
    if (rarity === "mythic") return "M";
    return "?";
}

export function getSellableInventoryOptions(input: {
    inventory: Record<string, number>;
    focusedRaw?: string;
}): Array<{ id: string; name: string; qty: number; unitPrice: number; rarity: string }> {
    const focused = (input.focusedRaw || "").trim().toLowerCase();
    return Object.entries(input.inventory)
        .map(([id, qty]) => ({ id, qty: Math.max(0, Math.floor(Number(qty) || 0)), def: ITEM_DEFS[id] }))
        .filter(entry => entry.qty > 0 && entry.def && entry.def.price > 0)
        .map(entry => ({
            id: entry.id,
            name: entry.def.name,
            qty: entry.qty,
            unitPrice: getVendorSellPrice(entry.id),
            rarity: entry.def.rarity || "common"
        }))
        .filter(entry => {
            if (!focused) return true;
            return `${entry.id} ${entry.name} ${entry.rarity}`.toLowerCase().includes(focused);
        })
        .sort((a, b) => b.unitPrice - a.unitPrice || b.qty - a.qty || a.name.localeCompare(b.name));
}

export function buildSellPickerPayload(input: {
    inventory: Record<string, number>;
    menuId: string;
}): string {
    const sellables = getSellableInventoryOptions({ inventory: input.inventory }).slice(0, 25);
    if (!sellables.length) {
        return "No sellable inventory found. Run /raid, /opencrate, or /shop first.";
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(input.menuId)
        .setPlaceholder("Select an owned item to sell")
        .addOptions(
            sellables.map(entry => ({
                label: `${entry.name} x${entry.qty}`.slice(0, 100),
                value: entry.id,
                description: `[${rarityBadge(entry.rarity)}] Sell each for ${entry.unitPrice} FN Token$`.slice(0, 100)
            }))
        );

    const topPreview = sellables
        .slice(0, 6)
        .map(entry => `• [${rarityBadge(entry.rarity)}] ${entry.name} x${entry.qty} -> ${entry.unitPrice} FN Token$ each`)
        .join("\n");

    const embed = new EmbedBuilder()
        .setColor(0x0f766e)
        .setTitle("💼 Marketplace Sell Console")
        .setDescription("Choose an owned item below. After selection, click a quantity button to execute the sale.")
        .addFields(
            { name: "Top Sellable Inventory", value: topPreview || "No data", inline: false },
            { name: "Sell Rule", value: "Vendor payout is 60% of each item base value.", inline: false }
        );

    return JSON.stringify({
        embed: embed.toJSON(),
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu).toJSON()]
    });
}

export function buildInventoryPayload(input: {
    inventory: Record<string, number>;
    wallet: number;
}): string {
    const entries = Object.entries(input.inventory)
        .map(([id, qty]) => ({ id, qty: Math.max(0, Math.floor(Number(qty) || 0)), def: ITEM_DEFS[id] }))
        .filter(entry => entry.qty > 0 && entry.def);

    if (!entries.length) {
        const emptyEmbed = new EmbedBuilder()
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
        .reduce((sum, entry) => sum + getVendorSellPrice(entry.id) * entry.qty, 0);
    const kindOrder: Array<NonNullable<ItemDef["kind"]>> = ["collectible", "achievement", "weapon", "armor", "crate", "consumable", "intel", "key", "module", "resource", "token"];
    const kindLabels: Record<string, string> = {
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
            const aValue = a.qty * getVendorSellPrice(a.id);
            const bValue = b.qty * getVendorSellPrice(b.id);
            return bValue - aValue;
        })
        .slice(0, 8)
        .map(entry => {
            const unit = getVendorSellPrice(entry.id);
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
            if (!items) return null;
            return { name: kindLabels[kind] || "Other", value: items, inline: true };
        })
        .filter((field): field is { name: string; value: string; inline: boolean } => Boolean(field));

    const embed = new EmbedBuilder()
        .setColor(0x0f766e)
        .setTitle("🎒 Field Inventory Console")
        .setDescription("Premium loadout and loot snapshot with real-time liquidation analytics.")
        .addFields(
            {
                name: "Inventory Snapshot",
                value: [
                    `Stacks: ${totalStacks}`,
                    `Units: ${totalUnits}`,
                    `Wallet: ${input.wallet.toLocaleString()} FN Token$`,
                    `Estimated Liquidation: ${liquidationValue.toLocaleString()} FN Token$`
                ].join("\n"),
                inline: false
            },
            {
                name: "Highest Value Holdings",
                value: topByValue || "No valuation data.",
                inline: false
            },
            ...categoryFields.slice(0, 6),
            {
                name: "Next Actions",
                value: "• /sell\n• /opencrate\n• /useitem\n• /raidintel",
                inline: false
            }
        );

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(RAID_RESULT_ACTION_IDS.inventory)
            .setLabel("View Inventory")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(RAID_RESULT_ACTION_IDS.history)
            .setLabel("Raid History")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(RAID_RESULT_ACTION_IDS.bosses)
            .setLabel("Boss Roster")
            .setStyle(ButtonStyle.Secondary)
    );

    return JSON.stringify({ embed: embed.toJSON(), components: [actionRow.toJSON()] });
}

export function buildShopPayload(input: {
    shopItemIds: string[];
    inventory: Record<string, number>;
    wallet: number;
}): string {
    const entries = input.shopItemIds
        .map(id => ({ id, def: ITEM_DEFS[id], owned: Math.max(0, Math.floor(Number(input.inventory[id] || 0))) }))
        .filter(entry => Boolean(entry.def));

    const topValue = entries
        .slice()
        .sort((a, b) => (b.def.price || 0) - (a.def.price || 0))
        .slice(0, 8)
        .map(entry => `• [${rarityBadge(entry.def.rarity)}] ${entry.def.name} (${entry.id}) • ${entry.def.price} FN Token$${entry.owned > 0 ? ` • Owned x${entry.owned}` : ""}`)
        .join("\n");

    const kinds: Array<NonNullable<ItemDef["kind"]>> = ["weapon", "armor", "crate", "consumable", "intel", "module", "resource", "token", "collectible"];
    const fields = kinds
        .map(kind => {
            const lines = entries
                .filter(entry => entry.def.kind === kind)
                .sort((a, b) => a.def.price - b.def.price || a.def.name.localeCompare(b.def.name))
                .slice(0, 6)
                .map(entry => `• [${rarityBadge(entry.def.rarity)}] ${entry.def.name} • ${entry.def.price}${entry.owned > 0 ? ` • x${entry.owned}` : ""}`)
                .join("\n");
            if (!lines) return null;
            return { name: kindLabel(kind), value: lines, inline: true };
        })
        .filter((field): field is { name: string; value: string; inline: boolean } => Boolean(field));

    const embed = new EmbedBuilder()
        .setColor(0x155e75)
        .setTitle("🛒 Titan Armory Exchange")
        .setDescription("Premium procurement board for weapons, armor, field consumables, and raid logistics.")
        .addFields(
            {
                name: "Account Snapshot",
                value: [
                    `Wallet: ${input.wallet.toLocaleString()} FN Token$`,
                    `Catalog Entries: ${entries.length}`,
                    `Owned Shop Items: ${entries.filter(entry => entry.owned > 0).length}`
                ].join("\n"),
                inline: false
            },
            {
                name: "Premium Catalog Highlights",
                value: topValue || "No shop data available.",
                inline: false
            },
            ...fields.slice(0, 6),
            {
                name: "Quick Actions",
                value: "• /buy\n• /inventory\n• /loadout\n• /raidintel",
                inline: false
            }
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

export function buildTradeActionPayload(input: {
    title: string;
    color: number;
    description: string;
    summaryLines: string[];
    nextSteps?: string[];
}): string {
    const embed = new EmbedBuilder()
        .setColor(input.color)
        .setTitle(input.title)
        .setDescription(input.description)
        .addFields(
            { name: "Summary", value: input.summaryLines.join("\n"), inline: false },
            ...(input.nextSteps?.length ? [{ name: "Next Steps", value: input.nextSteps.join("\n"), inline: false }] : [])
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

export function buildCrateOpenPayload(input: {
    crateId: string;
    contents: Array<{ id: string; qty: number }>;
    remaining: number;
    autoSelected: boolean;
}): string {
    const crateDef = ITEM_DEFS[input.crateId];
    const drops = input.contents.map(entry => ({ ...entry, def: ITEM_DEFS[entry.id] }));
    const grouped = ["mythic", "legendary", "epic", "rare", "uncommon", "common"]
        .map(rarity => {
            const lines = drops
                .filter(entry => String(entry.def?.rarity || "common") === rarity)
                .map(entry => `• ${entry.qty}x ${entry.def?.name || entry.id}`)
                .join("\n");
            if (!lines) return null;
            return { name: `${rarity.toUpperCase()} Drops`, value: lines, inline: true };
        })
        .filter((field): field is { name: string; value: string; inline: boolean } => Boolean(field));

    const headline = drops
        .slice()
        .sort((a, b) => (b.def?.price || 0) - (a.def?.price || 0))
        .slice(0, 3)
        .map(entry => `• [${rarityBadge(entry.def?.rarity)}] ${entry.def?.name || entry.id}`)
        .join("\n") || "• No premium drops";

    const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle(`📦 ${crateDef?.name || input.crateId} Opened`)
        .setDescription(input.autoSelected
            ? "Auto-selected your best available crate and processed the opening sequence."
            : "Crate opening complete. Premium loot manifest confirmed.")
        .addFields(
            {
                name: "Crate Status",
                value: [
                    `Remaining: ${input.remaining}`,
                    `Drop Count: ${drops.length}`,
                    `Top Recoveries:`,
                    headline
                ].join("\n"),
                inline: false
            },
            ...grouped.slice(0, 6),
            {
                name: "Next Actions",
                value: "• /inventory\n• /useitem\n• /raid",
                inline: false
            }
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

export function buildConsumableUsePayload(input: {
    itemId: string;
    quantity: number;
    resultText: string;
    autoSelected: boolean;
    adjustmentNote?: string;
}): string {
    const item = ITEM_DEFS[input.itemId];
    const notes = [
        input.autoSelected ? "Auto-selected your highest-priority usable item." : "Manual consumable activation confirmed.",
        input.adjustmentNote || null
    ].filter(Boolean) as string[];

    const embed = new EmbedBuilder()
        .setColor(0x2563eb)
        .setTitle(`🧪 ${item?.name || input.itemId} Activated`)
        .setDescription("Field consumable effect executed and persistence updated.")
        .addFields(
            {
                name: "Use Summary",
                value: [
                    `Item: ${item?.name || input.itemId}`,
                    `Quantity Used: ${input.quantity}`,
                    `Type: ${kindLabel(item?.kind)}`
                ].join("\n"),
                inline: false
            },
            {
                name: "Effect Resolution",
                value: input.resultText,
                inline: false
            },
            {
                name: "Operational Notes",
                value: notes.join("\n") || "No additional notes.",
                inline: false
            }
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

export function buildRaidResultPayload(input: {
    result: {
        success?: boolean;
        net?: number;
        loot?: Array<{ id: string; qty: number }>;
        rxpGain?: number;
        successChance?: number;
        mapLabel?: string;
        tension?: string;
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
    };
    mapCfg: { label: string; bossName: string; lootTier: string };
    fallbackTension: string;
    armyIconUrl: string;
}): string {
    const { result, mapCfg, fallbackTension, armyIconUrl } = input;
    const [tensionLabel, conditionLabel] = (result.tension || fallbackTension).split(" | ");
    const signedNet = (result.net || 0) >= 0 ? `+${result.net}` : `${result.net}`;
    const lootEntries = (result.loot || []).map(entry => ({
        ...entry,
        def: ITEM_DEFS[entry.id]
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
        enhancedDrops.length ? `Enhanced: ${enhancedDrops.map(entry => entry.def?.name || entry.id).join(", ")}` : null,
        mythicDrops.length ? `Mythic: ${mythicDrops.map(entry => entry.def?.name || entry.id).join(", ")}` : null
    ].filter(Boolean) as string[];

    const embed = new EmbedBuilder()
        .setColor(result.success ? 0x16a34a : 0xdc2626)
        .setTitle(result.success ? "✅ Raid Extraction Complete" : "❌ Raid Extraction Failed")
        .setDescription([
            `${result.mapLabel || mapCfg.label}`,
            `${tensionLabel || fallbackTension} • ${conditionLabel || "Standard"}`
        ].join("\n"))
        .setThumbnail(result.bossSpawned && result.bossImageUrl ? result.bossImageUrl : armyIconUrl)
        .addFields(
            {
                name: "Summary",
                value: [
                    `Status: ${result.success ? "Extracted" : "Failed"}`,
                    `Success Chance: ${result.successChance || 0}%`,
                    `Loadout: ${result.selectedWeaponName || "Auto-best"} • ${result.selectedArmorName || "Auto-best"}`
                ].join("\n"),
                inline: false
            },
            {
                name: "Rewards",
                value: [
                    `Net: ${signedNet} FN Token$`,
                    `Raid XP: +${result.rxpGain || 0}`,
                    `Boss XP: +${result.bossBonusXp || 0}`,
                    `Loot: ${lootEntries.length} item${lootEntries.length === 1 ? "" : "s"}`
                ].join("\n"),
                inline: true
            },
            {
                name: "Boss",
                value: [
                    result.bossSpawned ? `${result.bossName || mapCfg.bossName}` : "Boss: No boss detected",
                    bossResolution,
                    heartLine
                ].join("\n"),
                inline: true
            },
            {
                name: "Recovered Loot",
                value: prominentLoot,
                inline: false
            },
            ...(specialMoments.length ? [{
                name: "Highlights",
                value: specialMoments.slice(0, 3).join("\n"),
                inline: false
            }] : [])
        );

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(RAID_RESULT_ACTION_IDS.inventory)
            .setLabel("View Inventory")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(RAID_RESULT_ACTION_IDS.history)
            .setLabel("Raid History")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(RAID_RESULT_ACTION_IDS.bosses)
            .setLabel("Boss Roster")
            .setStyle(ButtonStyle.Secondary)
    );

    return JSON.stringify({ embed: embed.toJSON(), components: [actionRow.toJSON()] });
}