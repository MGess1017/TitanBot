"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENABLE_CRATE_IDS = void 0;
exports.isSupportedConsumableId = isSupportedConsumableId;
exports.formatOwnedCratesForPrompt = formatOwnedCratesForPrompt;
exports.pickBestOwnedCrate = pickBestOwnedCrate;
exports.formatOwnedUsableItemsForPrompt = formatOwnedUsableItemsForPrompt;
exports.pickBestUsableItem = pickBestUsableItem;
exports.buyItem = buyItem;
exports.sellItem = sellItem;
exports.openCrate = openCrate;
exports.useItem = useItem;
// Buying, selling, crates, and consumable items.
const utils_1 = require("../../utils");
const catalog_1 = require("../../game/catalog");
const gearEconomy_1 = require("../../game/gearEconomy");
exports.OPENABLE_CRATE_IDS = ["common_crate", "rare_crate", "epic_crate", "tactical_crate", "mythic_crate"];
const CRATE_OPEN_PRIORITY = ["mythic_crate", "tactical_crate", "epic_crate", "rare_crate", "common_crate"];
const USEITEM_PRIORITY = ["scav_beacon", "combat_stim", "field_ration", "repair_kit"];
const USABLE_CONSUMABLE_IDS = ["field_ration", "combat_stim", "repair_kit", "scav_beacon"];
function isSupportedConsumableId(itemId) {
    return USABLE_CONSUMABLE_IDS.includes(itemId);
}
function formatOwnedCratesForPrompt(userId) {
    const owned = exports.OPENABLE_CRATE_IDS
        .map(id => ({ id, def: catalog_1.ITEM_DEFS[id], qty: (0, utils_1.getInventoryCount)(userId, id) }))
        .filter(entry => entry.qty > 0 && entry.def);
    if (owned.length === 0)
        return "None owned right now.";
    return owned
        .map(entry => `* ${entry.def.name} (${entry.id}) x${entry.qty}`)
        .join("\n");
}
function pickBestOwnedCrate(userId) {
    for (const id of CRATE_OPEN_PRIORITY) {
        if ((0, utils_1.getInventoryCount)(userId, id) > 0)
            return id;
    }
    return null;
}
function formatOwnedUsableItemsForPrompt(userId) {
    const owned = Object.entries(catalog_1.ITEM_DEFS)
        .filter(([id, def]) => def.kind === "consumable" && isSupportedConsumableId(id))
        .map(([id, def]) => ({ id, def, qty: (0, utils_1.getInventoryCount)(userId, id) }))
        .filter(entry => entry.qty > 0);
    if (owned.length === 0)
        return "None owned right now.";
    return owned
        .sort((a, b) => b.qty - a.qty || a.def.name.localeCompare(b.def.name))
        .map(entry => `* ${entry.def.name} (${entry.id}) x${entry.qty}`)
        .join("\n");
}
function isUsableNow(userId, itemId) {
    const owned = (0, utils_1.getInventoryCount)(userId, itemId);
    if (owned < 1)
        return false;
    if (itemId === "repair_kit") {
        return (0, utils_1.getInventoryCount)(userId, "scrap") >= 6;
    }
    return true;
}
function pickBestUsableItem(userId) {
    for (const id of USEITEM_PRIORITY) {
        if (isUsableNow(userId, id))
            return id;
    }
    const fallback = Object.entries(catalog_1.ITEM_DEFS)
        .filter(([id, def]) => def.kind === "consumable" && isSupportedConsumableId(id))
        .map(([id]) => id)
        .find(id => isUsableNow(userId, id));
    return fallback || null;
}
function weightedPick(table) {
    const positive = table.filter(entry => entry.weight > 0);
    if (!positive.length)
        return table[0]?.id || "scrap";
    const total = positive.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of positive) {
        roll -= entry.weight;
        if (roll <= 0)
            return entry.id;
    }
    return positive[positive.length - 1].id;
}
function buyItem(userId, itemId, qty) {
    const item = catalog_1.ITEM_DEFS[itemId];
    if (!item)
        return { error: "Item does not exist." };
    if (!catalog_1.SHOP_ITEMS.includes(itemId))
        return { error: "This item is not sold by the vendor. Raid-only discoveries must be recovered in raids." };
    if (qty < 1)
        return { error: "Quantity must be at least 1." };
    const cost = (0, gearEconomy_1.getDynamicVendorPrice)((0, utils_1.ensureUser)(userId), itemId) * qty;
    if (!(0, utils_1.canAffordTokens)(userId, cost))
        return { error: `You need ${cost} FN Token$.` };
    (0, utils_1.removeTokens)(userId, cost);
    const total = (0, utils_1.addInventoryItem)(userId, itemId, qty);
    return { cost, total };
}
function sellItem(userId, itemId, qty) {
    const item = catalog_1.ITEM_DEFS[itemId];
    if (!item)
        return { error: "Item does not exist." };
    if (qty < 1)
        return { error: "Quantity must be at least 1." };
    const owned = (0, utils_1.getInventoryCount)(userId, itemId);
    if (owned < qty)
        return { error: "Not enough item to sell." };
    const payout = (0, catalog_1.getVendorSellPrice)(itemId) * qty;
    const remaining = (0, utils_1.removeInventoryItem)(userId, itemId, qty);
    (0, utils_1.addTokens)(userId, payout);
    return { payout, remaining };
}
function openCrate(userId, crateId) {
    if (!["common_crate", "rare_crate", "epic_crate", "tactical_crate", "mythic_crate"].includes(crateId)) {
        return { error: "That crate cannot be opened." };
    }
    if ((0, utils_1.getInventoryCount)(userId, crateId) < 1) {
        return { error: `You do not have any ${catalog_1.ITEM_DEFS[crateId].name}.` };
    }
    (0, utils_1.removeInventoryItem)(userId, crateId, 1);
    const contents = [];
    const pushLoot = (id, qty) => {
        (0, utils_1.addInventoryItem)(userId, id, qty);
        contents.push({ id, qty });
    };
    const pullTable = (table, pulls) => {
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
    }
    else if (crateId === "rare_crate") {
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
    }
    else if (crateId === "epic_crate") {
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
    }
    else if (crateId === "tactical_crate") {
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
    }
    else {
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
function useItem(userId, itemId, quantity) {
    const item = catalog_1.ITEM_DEFS[itemId];
    if (!item)
        return { error: "Item does not exist." };
    if (item.kind !== "consumable")
        return { error: "That item is not usable with /useitem." };
    if (!isSupportedConsumableId(itemId))
        return { error: "This consumable has no configured effect yet." };
    const qty = Math.max(1, Math.floor(quantity));
    const owned = (0, utils_1.getInventoryCount)(userId, itemId);
    if (owned < qty)
        return { error: `You only have ${owned}x ${item.name}.` };
    (0, utils_1.removeInventoryItem)(userId, itemId, qty);
    const user = (0, utils_1.ensureUser)(userId);
    if (itemId === "field_ration") {
        const gain = qty * (12 + Math.floor(Math.random() * 12));
        (0, utils_1.addTokens)(userId, gain);
        return { result: `Used ${qty}x ${item.name}. Gained ${gain} FN Token$.` };
    }
    if (itemId === "combat_stim") {
        const raidXpGain = qty * (20 + Math.floor(Math.random() * 26));
        const chatXpGain = qty * (8 + Math.floor(Math.random() * 10));
        user.rxp += raidXpGain;
        user.pmcXP += raidXpGain;
        (0, utils_1.addXP)(userId, chatXpGain);
        (0, utils_1.savePoints)();
        return { result: `Used ${qty}x ${item.name}. Raid XP +${raidXpGain}, Engagement XP +${chatXpGain}.` };
    }
    if (itemId === "repair_kit") {
        const scrapNeed = qty * 6;
        const scrapOwned = (0, utils_1.getInventoryCount)(userId, "scrap");
        if (scrapOwned < scrapNeed) {
            (0, utils_1.addInventoryItem)(userId, itemId, qty);
            return { error: `Need ${scrapNeed} scrap to use ${qty}x ${item.name}.` };
        }
        (0, utils_1.removeInventoryItem)(userId, "scrap", scrapNeed);
        const materialYield = qty + Math.floor(Math.random() * (qty + 1));
        (0, utils_1.addInventoryItem)(userId, "rare_material_small", materialYield);
        if (Math.random() < 0.35)
            (0, utils_1.addInventoryItem)(userId, "rare_material", 1);
        return { result: `Used ${qty}x ${item.name}. Converted ${scrapNeed} scrap into ${materialYield} rare material and possible bonus components.` };
    }
    if (itemId === "scav_beacon") {
        const pulls = qty * 2;
        const drops = [];
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
            (0, utils_1.addInventoryItem)(userId, dropId, 1);
            const existing = drops.find(d => d.id === dropId);
            if (existing)
                existing.qty += 1;
            else
                drops.push({ id: dropId, qty: 1 });
        }
        const summary = drops.map(d => `${d.qty}x ${catalog_1.ITEM_DEFS[d.id]?.name || d.id}`).join(", ");
        return { result: `Used ${qty}x ${item.name}. Retrieved: ${summary}.` };
    }
    (0, utils_1.addInventoryItem)(userId, itemId, qty);
    return { error: "Use action failed safely; item was restored." };
}
