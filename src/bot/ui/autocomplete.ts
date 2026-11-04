// Slash-command autocomplete options.
import { ensureUser, getInventoryCount } from "../../utils";
import { ARMOR_IDS, ITEM_DEFS, SHOP_ITEMS, type ItemDef, WEAPON_IDS } from "../../game/catalog";
import { getSellableInventoryOptions, rarityBadge } from "../../game/payloads";
import { tradeStore } from "../economy/trades";
import { isSupportedConsumableId, OPENABLE_CRATE_IDS } from "../economy/items";

function getInventoryAutocompleteOptions(input: {
    userId: string;
    focusedRaw: string;
    allowedKinds?: Array<NonNullable<ItemDef["kind"]>>;
    ownedOnly?: boolean;
    includeUnowned?: boolean;
    sortByOwned?: boolean;
    metricKind?: "weapon" | "armor";
}): Array<{ name: string; value: string }> {
    const focused = input.focusedRaw.trim().toLowerCase();
    const entries = Object.entries(ITEM_DEFS)
        .filter(([, def]) => !input.allowedKinds || input.allowedKinds.includes((def.kind || "resource") as NonNullable<ItemDef["kind"]>))
        .map(([id, def]) => {
            const owned = getInventoryCount(input.userId, id);
            const metric = input.metricKind === "weapon"
                ? Math.round((def.raidAttack || 0) * 100)
                : input.metricKind === "armor"
                    ? Math.round((def.raidDefense || 0) * 100)
                    : 0;
            return { id, def, owned, metric };
        })
        .filter(entry => input.includeUnowned !== false || entry.owned > 0)
        .filter(entry => !input.ownedOnly || entry.owned > 0)
        .filter(entry => {
            if (!focused) return true;
            return `${entry.id} ${entry.def.name} ${entry.def.rarity} ${entry.def.kind || ""}`.toLowerCase().includes(focused);
        })
        .sort((a, b) => {
            if (input.sortByOwned && (b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0)) return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
            if (input.sortByOwned && b.owned !== a.owned) return b.owned - a.owned;
            if (b.metric !== a.metric) return b.metric - a.metric;
            return a.def.name.localeCompare(b.def.name);
        })
        .slice(0, 25);

    return entries.map(entry => {
        const status = entry.owned > 0 ? `OWNED x${entry.owned}` : "NOT OWNED";
        const metricText = input.metricKind === "weapon"
            ? `ATK +${entry.metric}%`
            : input.metricKind === "armor"
                ? `DEF +${entry.metric}%`
                : `${(entry.def.kind || "item").toUpperCase()}`;
        const raw = `${status} | ${entry.def.name} | ${metricText}`;
        return { name: raw.length > 100 ? `${raw.slice(0, 97)}...` : raw, value: entry.id };
    });
}

export function getShopItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    const focused = focusedRaw.trim().toLowerCase();
    return SHOP_ITEMS
        .map(id => {
            const def = ITEM_DEFS[id];
            const owned = getInventoryCount(userId, id);
            return { id, def, owned };
        })
        .filter(entry => Boolean(entry.def))
        .filter(entry => !focused || `${entry.id} ${entry.def.name} ${entry.def.rarity}`.toLowerCase().includes(focused))
        .sort((a, b) => a.def.price - b.def.price || a.def.name.localeCompare(b.def.name))
        .slice(0, 25)
        .map(entry => {
            const raw = `${entry.def.name} | ${entry.id} | ${entry.def.price} FN Token$ | Owned ${entry.owned}`;
            return { name: raw.length > 100 ? `${raw.slice(0, 97)}...` : raw, value: entry.id };
        });
}

export function getTradeOfferItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        ownedOnly: true,
        includeUnowned: false,
        sortByOwned: true
    });
}

export function getTradeRequestItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        includeUnowned: true,
        sortByOwned: true
    });
}

export function getTradeOfferAutocompleteOptions(userId: string, focusedRaw: string, mode: "incoming" | "all"): Array<{ name: string; value: string }> {
    const focused = focusedRaw.trim().toLowerCase();
    return tradeStore.offers
        .filter(offer => offer.status === "open")
        .filter(offer => mode === "incoming" ? offer.toUserId === userId : (offer.toUserId === userId || offer.fromUserId === userId))
        .sort((a, b) => b.id - a.id)
        .filter(offer => {
            const text = `#${offer.id} ${offer.offerItemId} ${offer.requestItemId} ${ITEM_DEFS[offer.offerItemId]?.name || ""} ${ITEM_DEFS[offer.requestItemId]?.name || ""}`.toLowerCase();
            return !focused || text.includes(focused);
        })
        .slice(0, 25)
        .map(offer => {
            const raw = `#${offer.id} | ${offer.offerQty}x ${ITEM_DEFS[offer.offerItemId]?.name || offer.offerItemId} -> ${offer.requestQty}x ${ITEM_DEFS[offer.requestItemId]?.name || offer.requestItemId}`;
            return { name: raw.length > 100 ? `${raw.slice(0, 97)}...` : raw, value: String(offer.id) };
        });
}

export function getBestOwnedGear(userId: string, ids: string[], metric: "raidAttack" | "raidDefense"): ItemDef | null {
    const user = ensureUser(userId);
    let best: ItemDef | null = null;
    for (const id of ids) {
        const qty = user.inventory[id] || 0;
        if (qty <= 0) continue;
        const def = ITEM_DEFS[id];
        if (!def) continue;
        if (!best || (def[metric] || 0) > (best[metric] || 0)) {
            best = def;
        }
    }
    return best;
}

export function getRaidGearAutocompleteOptions(userId: string, kind: "weapon" | "armor", focusedRaw: string): Array<{ name: string; value: string }> {
    const ids = kind === "weapon" ? WEAPON_IDS : ARMOR_IDS;
    const focused = focusedRaw.trim().toLowerCase();
    const metricKey = kind === "weapon" ? "raidAttack" : "raidDefense";

    const entries = ids
        .map(id => {
            const def = ITEM_DEFS[id];
            if (!def) return null;
            const owned = getInventoryCount(userId, id);
            const metric = Math.round(((def[metricKey] || 0) as number) * 100);
            const status = owned > 0 ? `OWNED x${owned}` : "NOT OWNED";
            const metricText = kind === "weapon" ? `ATK +${metric}%` : `DEF +${metric}%`;
            const labelRaw = `${status} | ${def.name} | ${metricText}`;
            const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}...` : labelRaw;
            return {
                id,
                name: def.name,
                rarity: def.rarity,
                owned,
                metric,
                label
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const filtered = focused
        ? entries.filter(entry => {
            const haystack = `${entry.id} ${entry.name} ${entry.rarity}`.toLowerCase();
            return haystack.includes(focused);
        })
        : entries;

    return filtered
        .sort((a, b) => {
            if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0)) return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
            if (b.owned !== a.owned) return b.owned - a.owned;
            if (b.metric !== a.metric) return b.metric - a.metric;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}

export function getCatalogItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        includeUnowned: true,
        sortByOwned: true
    });
}

export function getOpenCrateAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    const focused = focusedRaw.trim().toLowerCase();
    return OPENABLE_CRATE_IDS
        .map(id => {
            const def = ITEM_DEFS[id];
            if (!def) return null;
            const owned = getInventoryCount(userId, id);
            const status = owned > 0 ? `OWNED x${owned}` : "NOT OWNED";
            const labelRaw = `${status} | ${def.name} | ${id}`;
            const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}...` : labelRaw;
            return { id, name: def.name, owned, label };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .filter(entry => {
            if (!focused) return true;
            return `${entry.id} ${entry.name}`.toLowerCase().includes(focused);
        })
        .sort((a, b) => {
            if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0)) return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
            if (b.owned !== a.owned) return b.owned - a.owned;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}

export function getUseItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    const focused = focusedRaw.trim().toLowerCase();
    return Object.entries(ITEM_DEFS)
        .filter(([id, def]) => def.kind === "consumable" && isSupportedConsumableId(id))
        .map(([id, def]) => {
            const owned = getInventoryCount(userId, id);
            const status = owned > 0 ? `OWNED x${owned}` : "NOT OWNED";
            const labelRaw = `${status} | ${def.name} | ${id}`;
            const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}...` : labelRaw;
            return { id, name: def.name, owned, label };
        })
        .filter(entry => {
            if (!focused) return true;
            return `${entry.id} ${entry.name}`.toLowerCase().includes(focused);
        })
        .sort((a, b) => {
            if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0)) return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
            if (b.owned !== a.owned) return b.owned - a.owned;
            return a.name.localeCompare(b.name);
        })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}

export function getSellItemAutocompleteOptions(userId: string, focusedRaw: string): Array<{ name: string; value: string }> {
    return getSellableInventoryOptions({ inventory: ensureUser(userId).inventory, focusedRaw })
        .slice(0, 25)
        .map(entry => {
            const raw = `[${rarityBadge(entry.rarity)}] OWNED x${entry.qty} | ${entry.name} | Sell ${entry.unitPrice}`;
            const label = raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
            return { name: label, value: entry.id };
        });
}
