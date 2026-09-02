import type { UserState } from "../utils";
import { ITEM_DEFS } from "./catalog";

export type GearOperationResult = { error?: string; changed?: number; cost?: number; recovered?: boolean };

export const GEAR_MAX_DURABILITY = 100;
export const GEAR_MIN_OPERATION_DURABILITY = 5;

export function getGearDurability(user: UserState, itemId: string): number {
    if (!user.gearDurability[itemId]) user.gearDurability[itemId] = GEAR_MAX_DURABILITY;
    return Math.max(0, Math.min(GEAR_MAX_DURABILITY, Math.floor(user.gearDurability[itemId])));
}

export function consumeGearDurability(user: UserState, itemId: string, amount: number): number {
    const next = Math.max(0, getGearDurability(user, itemId) - Math.max(0, Math.floor(amount)));
    user.gearDurability[itemId] = next;
    return next;
}

export function repairGear(user: UserState, itemId: string, amount = GEAR_MAX_DURABILITY): GearOperationResult {
    const item = ITEM_DEFS[itemId];
    if (!item || (item.kind !== "weapon" && item.kind !== "armor")) return { error: "Only weapons and armor can be repaired." };
    if ((user.inventory[itemId] || 0) < 1) return { error: "You do not own that gear." };
    const current = getGearDurability(user, itemId);
    const changed = Math.max(0, Math.min(GEAR_MAX_DURABILITY, Math.floor(amount)) - current);
    const cost = Math.max(1, Math.ceil((item.price || 1) * (changed / GEAR_MAX_DURABILITY) * 0.18));
    if ((user.inventory.repair_kit || 0) < 1 && (user.fnTokens || 0) < cost) return { error: `Repair requires 1 Repair Kit or ${cost} FN Token$.` };
    if ((user.inventory.repair_kit || 0) > 0) user.inventory.repair_kit -= 1;
    else user.fnTokens -= cost;
    user.gearDurability[itemId] = current + changed;
    return { changed, cost };
}

export function insureGear(user: UserState, itemId: string): GearOperationResult {
    const item = ITEM_DEFS[itemId];
    if (!item || (item.kind !== "weapon" && item.kind !== "armor")) return { error: "Only weapons and armor can be insured." };
    if ((user.inventory[itemId] || 0) < 1) return { error: "You do not own that gear." };
    const cost = Math.max(1, Math.ceil((item.price || 1) * 0.08));
    if ((user.fnTokens || 0) < cost) return { error: `Insurance requires ${cost} FN Token$.` };
    user.fnTokens -= cost;
    user.insuredGear[itemId] = Date.now();
    return { cost };
}

export function resolveGearLoss(user: UserState, itemId: string, extracted: boolean, random = Math.random): GearOperationResult {
    if (extracted) {
        consumeGearDurability(user, itemId, 8);
        return { changed: -8, recovered: false };
    }
    consumeGearDurability(user, itemId, 18);
    if (user.insuredGear[itemId] && random() < 0.72) return { changed: -18, recovered: true };
    if ((user.inventory[itemId] || 0) > 0) user.inventory[itemId] -= 1;
    delete user.insuredGear[itemId];
    return { changed: -18, recovered: false };
}

export type CraftRecipe = { outputId: string; quantity: number; inputs: Record<string, number>; minVendorReputation?: number };

export const CRAFT_RECIPES: CraftRecipe[] = [
    { outputId: "upgrade_core", quantity: 1, inputs: { scrap: 30, rare_material: 4, servo_motor: 1 } },
    { outputId: "blueprint_bossbreaker", quantity: 1, inputs: { encrypted_chip: 8, upgrade_core: 2, boss_intel_fragment: 1 }, minVendorReputation: 3 },
    { outputId: "tactical_overdrive", quantity: 1, inputs: { upgrade_core: 1, combat_stim: 2, power_cell: 2 } }
];

export function craftItem(user: UserState, recipe: CraftRecipe): GearOperationResult {
    if ((user.vendorReputation || 0) < (recipe.minVendorReputation || 0)) return { error: "Vendor reputation is too low for this recipe." };
    for (const [itemId, quantity] of Object.entries(recipe.inputs)) if ((user.inventory[itemId] || 0) < quantity) return { error: `Missing crafting input: ${itemId}.` };
    for (const [itemId, quantity] of Object.entries(recipe.inputs)) user.inventory[itemId] -= quantity;
    user.inventory[recipe.outputId] = (user.inventory[recipe.outputId] || 0) + recipe.quantity;
    return { changed: recipe.quantity };
}

export function dismantleGear(user: UserState, itemId: string): GearOperationResult {
    const item = ITEM_DEFS[itemId];
    if (!item || (item.kind !== "weapon" && item.kind !== "armor")) return { error: "Only weapons and armor can be dismantled." };
    if ((user.inventory[itemId] || 0) < 1) return { error: "You do not own that gear." };
    user.inventory[itemId] -= 1;
    const salvage = Math.max(1, Math.floor((item.price || 1) / 180));
    user.inventory.upgrade_core = (user.inventory.upgrade_core || 0) + salvage;
    return { changed: salvage };
}

export function upgradeGear(user: UserState, itemId: string): GearOperationResult {
    const item = ITEM_DEFS[itemId];
    if (!item || (item.kind !== "weapon" && item.kind !== "armor")) return { error: "Only weapons and armor can be upgraded." };
    if ((user.inventory[itemId] || 0) < 1) return { error: "You do not own that gear." };
    if ((user.inventory.upgrade_core || 0) < 1) return { error: "You need 1 Upgrade Core." };
    user.inventory.upgrade_core -= 1;
    user.gearDurability[itemId] = GEAR_MAX_DURABILITY;
    return { changed: 1 };
}

export function getDynamicVendorPrice(user: UserState, itemId: string, marketPressure = 0): number {
    const item = ITEM_DEFS[itemId];
    if (!item) return 0;
    const scarcity = Math.max(-0.2, Math.min(0.35, marketPressure));
    const reputation = Math.max(-0.12, Math.min(0.12, (user.vendorReputation || 0) * 0.02));
    return Math.max(1, Math.floor(item.price * (1 + scarcity - reputation)));
}

export function saveLoadout(user: UserState, name: string, weaponId: string | null, armorId: string | null, ammoId: string | null): GearOperationResult {
    const key = name.trim().toLowerCase().slice(0, 24);
    if (!key) return { error: "Loadout name is required." };
    user.gearLoadouts[key] = { weaponId, armorId, ammoId };
    return { changed: 1 };
}

export type AuctionListing = {
    id: string;
    sellerId: string;
    itemId: string;
    quantity: number;
    minimumBid: number;
    highestBid: number;
    highestBidderId: string | null;
    expiresAt: number;
};

export function calculateDynamicLootValue(itemId: string, marketPressure = 0): number {
    const item = ITEM_DEFS[itemId];
    if (!item) return 0;
    return Math.max(1, Math.floor(item.price * (1 + Math.max(-0.25, Math.min(0.5, marketPressure)))));
}

export function createAuctionListing(user: UserState, sellerId: string, itemId: string, quantity: number, minimumBid: number, expiresAt: number): AuctionListing | { error: string } {
    const item = ITEM_DEFS[itemId];
    const safeQuantity = Math.max(1, Math.floor(quantity));
    if (!item || (user.inventory[itemId] || 0) < safeQuantity) return { error: "Insufficient inventory for auction listing." };
    if (expiresAt <= Date.now() || minimumBid < 1) return { error: "Auction terms are invalid." };
    user.inventory[itemId] -= safeQuantity;
    return { id: `${sellerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sellerId, itemId, quantity: safeQuantity, minimumBid: Math.floor(minimumBid), highestBid: 0, highestBidderId: null, expiresAt };
}

export function placeAuctionBid(listing: AuctionListing, bidder: UserState, bidderId: string, amount: number): GearOperationResult {
    const bid = Math.floor(amount);
    if (listing.expiresAt <= Date.now()) return { error: "Auction has expired." };
    if (listing.sellerId === bidderId) return { error: "You cannot bid on your own listing." };
    if (bid < listing.minimumBid || bid <= listing.highestBid) return { error: "Bid must exceed the current auction bid." };
    if ((bidder.fnTokens || 0) < bid) return { error: "Insufficient FN Token$ for this bid." };
    bidder.fnTokens -= bid;
    listing.highestBid = bid;
    listing.highestBidderId = bidderId;
    return { cost: bid };
}