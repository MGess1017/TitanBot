// Buying, selling, crates, and consumable items.
import {
    addXP, addTokens, addInventoryItem, canAffordTokens, ensureUser, getInventoryCount, removeInventoryItem,
    removeTokens, savePoints
} from "../../utils";
import { getVendorSellPrice, ITEM_DEFS, SHOP_ITEMS } from "../../game/catalog";
import { getDynamicVendorPrice } from "../../game/gearEconomy";

export const OPENABLE_CRATE_IDS = ["common_crate", "rare_crate", "epic_crate", "tactical_crate", "mythic_crate"] as const;
const CRATE_OPEN_PRIORITY = ["mythic_crate", "tactical_crate", "epic_crate", "rare_crate", "common_crate"] as const;
const USEITEM_PRIORITY = ["scav_beacon", "combat_stim", "field_ration", "repair_kit"] as const;
const USABLE_CONSUMABLE_IDS = ["field_ration", "combat_stim", "repair_kit", "scav_beacon"] as const;

export function isSupportedConsumableId(itemId: string): itemId is (typeof USABLE_CONSUMABLE_IDS)[number] {
    return USABLE_CONSUMABLE_IDS.includes(itemId as (typeof USABLE_CONSUMABLE_IDS)[number]);
}

export function formatOwnedCratesForPrompt(userId: string): string {
    const owned = OPENABLE_CRATE_IDS
        .map(id => ({ id, def: ITEM_DEFS[id], qty: getInventoryCount(userId, id) }))
        .filter(entry => entry.qty > 0 && entry.def);

    if (owned.length === 0) return "None owned right now.";
    return owned
        .map(entry => `* ${entry.def.name} (${entry.id}) x${entry.qty}`)
        .join("\n");
}

export function pickBestOwnedCrate(userId: string): string | null {
    for (const id of CRATE_OPEN_PRIORITY) {
        if (getInventoryCount(userId, id) > 0) return id;
    }
    return null;
}

export function formatOwnedUsableItemsForPrompt(userId: string): string {
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

export function pickBestUsableItem(userId: string): string | null {
    for (const id of USEITEM_PRIORITY) {
        if (isUsableNow(userId, id)) return id;
    }

    const fallback = Object.entries(ITEM_DEFS)
        .filter(([id, def]) => def.kind === "consumable" && isSupportedConsumableId(id))
        .map(([id]) => id)
        .find(id => isUsableNow(userId, id));

    return fallback || null;
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

export function buyItem(userId: string, itemId: string, qty: number): { error?: string; cost?: number; total?: number } {
    const item = ITEM_DEFS[itemId];
    if (!item) return { error: "Item does not exist." };
    if (!SHOP_ITEMS.includes(itemId)) return { error: "This item is not sold by the vendor. Raid-only discoveries must be recovered in raids." };
    if (qty < 1) return { error: "Quantity must be at least 1." };
    const cost = getDynamicVendorPrice(ensureUser(userId), itemId) * qty;
    if (!canAffordTokens(userId, cost)) return { error: `You need ${cost} FN Token$.` };

    removeTokens(userId, cost);
    const total = addInventoryItem(userId, itemId, qty);
    return { cost, total };
}

export function sellItem(userId: string, itemId: string, qty: number): { error?: string; payout?: number; remaining?: number } {
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

export function openCrate(userId: string, crateId: string): { error?: string; contents?: Array<{ id: string; qty: number }> } {
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

export function useItem(userId: string, itemId: string, quantity: number): { error?: string; result?: string } {
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
