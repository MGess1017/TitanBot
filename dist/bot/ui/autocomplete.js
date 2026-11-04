"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShopItemAutocompleteOptions = getShopItemAutocompleteOptions;
exports.getTradeOfferItemAutocompleteOptions = getTradeOfferItemAutocompleteOptions;
exports.getTradeRequestItemAutocompleteOptions = getTradeRequestItemAutocompleteOptions;
exports.getTradeOfferAutocompleteOptions = getTradeOfferAutocompleteOptions;
exports.getBestOwnedGear = getBestOwnedGear;
exports.getRaidGearAutocompleteOptions = getRaidGearAutocompleteOptions;
exports.getCatalogItemAutocompleteOptions = getCatalogItemAutocompleteOptions;
exports.getOpenCrateAutocompleteOptions = getOpenCrateAutocompleteOptions;
exports.getUseItemAutocompleteOptions = getUseItemAutocompleteOptions;
exports.getSellItemAutocompleteOptions = getSellItemAutocompleteOptions;
// Slash-command autocomplete options.
const utils_1 = require("../../utils");
const catalog_1 = require("../../game/catalog");
const payloads_1 = require("../../game/payloads");
const trades_1 = require("../economy/trades");
const items_1 = require("../economy/items");
function getInventoryAutocompleteOptions(input) {
    const focused = input.focusedRaw.trim().toLowerCase();
    const entries = Object.entries(catalog_1.ITEM_DEFS)
        .filter(([, def]) => !input.allowedKinds || input.allowedKinds.includes((def.kind || "resource")))
        .map(([id, def]) => {
        const owned = (0, utils_1.getInventoryCount)(input.userId, id);
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
        if (!focused)
            return true;
        return `${entry.id} ${entry.def.name} ${entry.def.rarity} ${entry.def.kind || ""}`.toLowerCase().includes(focused);
    })
        .sort((a, b) => {
        if (input.sortByOwned && (b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0))
            return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
        if (input.sortByOwned && b.owned !== a.owned)
            return b.owned - a.owned;
        if (b.metric !== a.metric)
            return b.metric - a.metric;
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
function getShopItemAutocompleteOptions(userId, focusedRaw) {
    const focused = focusedRaw.trim().toLowerCase();
    return catalog_1.SHOP_ITEMS
        .map(id => {
        const def = catalog_1.ITEM_DEFS[id];
        const owned = (0, utils_1.getInventoryCount)(userId, id);
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
function getTradeOfferItemAutocompleteOptions(userId, focusedRaw) {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        ownedOnly: true,
        includeUnowned: false,
        sortByOwned: true
    });
}
function getTradeRequestItemAutocompleteOptions(userId, focusedRaw) {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        includeUnowned: true,
        sortByOwned: true
    });
}
function getTradeOfferAutocompleteOptions(userId, focusedRaw, mode) {
    const focused = focusedRaw.trim().toLowerCase();
    return trades_1.tradeStore.offers
        .filter(offer => offer.status === "open")
        .filter(offer => mode === "incoming" ? offer.toUserId === userId : (offer.toUserId === userId || offer.fromUserId === userId))
        .sort((a, b) => b.id - a.id)
        .filter(offer => {
        const text = `#${offer.id} ${offer.offerItemId} ${offer.requestItemId} ${catalog_1.ITEM_DEFS[offer.offerItemId]?.name || ""} ${catalog_1.ITEM_DEFS[offer.requestItemId]?.name || ""}`.toLowerCase();
        return !focused || text.includes(focused);
    })
        .slice(0, 25)
        .map(offer => {
        const raw = `#${offer.id} | ${offer.offerQty}x ${catalog_1.ITEM_DEFS[offer.offerItemId]?.name || offer.offerItemId} -> ${offer.requestQty}x ${catalog_1.ITEM_DEFS[offer.requestItemId]?.name || offer.requestItemId}`;
        return { name: raw.length > 100 ? `${raw.slice(0, 97)}...` : raw, value: String(offer.id) };
    });
}
function getBestOwnedGear(userId, ids, metric) {
    const user = (0, utils_1.ensureUser)(userId);
    let best = null;
    for (const id of ids) {
        const qty = user.inventory[id] || 0;
        if (qty <= 0)
            continue;
        const def = catalog_1.ITEM_DEFS[id];
        if (!def)
            continue;
        if (!best || (def[metric] || 0) > (best[metric] || 0)) {
            best = def;
        }
    }
    return best;
}
function getRaidGearAutocompleteOptions(userId, kind, focusedRaw) {
    const ids = kind === "weapon" ? catalog_1.WEAPON_IDS : catalog_1.ARMOR_IDS;
    const focused = focusedRaw.trim().toLowerCase();
    const metricKey = kind === "weapon" ? "raidAttack" : "raidDefense";
    const entries = ids
        .map(id => {
        const def = catalog_1.ITEM_DEFS[id];
        if (!def)
            return null;
        const owned = (0, utils_1.getInventoryCount)(userId, id);
        const metric = Math.round((def[metricKey] || 0) * 100);
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
        .filter((entry) => Boolean(entry));
    const filtered = focused
        ? entries.filter(entry => {
            const haystack = `${entry.id} ${entry.name} ${entry.rarity}`.toLowerCase();
            return haystack.includes(focused);
        })
        : entries;
    return filtered
        .sort((a, b) => {
        if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0))
            return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
        if (b.owned !== a.owned)
            return b.owned - a.owned;
        if (b.metric !== a.metric)
            return b.metric - a.metric;
        return a.name.localeCompare(b.name);
    })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}
function getCatalogItemAutocompleteOptions(userId, focusedRaw) {
    return getInventoryAutocompleteOptions({
        userId,
        focusedRaw,
        includeUnowned: true,
        sortByOwned: true
    });
}
function getOpenCrateAutocompleteOptions(userId, focusedRaw) {
    const focused = focusedRaw.trim().toLowerCase();
    return items_1.OPENABLE_CRATE_IDS
        .map(id => {
        const def = catalog_1.ITEM_DEFS[id];
        if (!def)
            return null;
        const owned = (0, utils_1.getInventoryCount)(userId, id);
        const status = owned > 0 ? `OWNED x${owned}` : "NOT OWNED";
        const labelRaw = `${status} | ${def.name} | ${id}`;
        const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}...` : labelRaw;
        return { id, name: def.name, owned, label };
    })
        .filter((entry) => Boolean(entry))
        .filter(entry => {
        if (!focused)
            return true;
        return `${entry.id} ${entry.name}`.toLowerCase().includes(focused);
    })
        .sort((a, b) => {
        if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0))
            return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
        if (b.owned !== a.owned)
            return b.owned - a.owned;
        return a.name.localeCompare(b.name);
    })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}
function getUseItemAutocompleteOptions(userId, focusedRaw) {
    const focused = focusedRaw.trim().toLowerCase();
    return Object.entries(catalog_1.ITEM_DEFS)
        .filter(([id, def]) => def.kind === "consumable" && (0, items_1.isSupportedConsumableId)(id))
        .map(([id, def]) => {
        const owned = (0, utils_1.getInventoryCount)(userId, id);
        const status = owned > 0 ? `OWNED x${owned}` : "NOT OWNED";
        const labelRaw = `${status} | ${def.name} | ${id}`;
        const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}...` : labelRaw;
        return { id, name: def.name, owned, label };
    })
        .filter(entry => {
        if (!focused)
            return true;
        return `${entry.id} ${entry.name}`.toLowerCase().includes(focused);
    })
        .sort((a, b) => {
        if ((b.owned > 0 ? 1 : 0) !== (a.owned > 0 ? 1 : 0))
            return (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0);
        if (b.owned !== a.owned)
            return b.owned - a.owned;
        return a.name.localeCompare(b.name);
    })
        .slice(0, 25)
        .map(entry => ({ name: entry.label, value: entry.id }));
}
function getSellItemAutocompleteOptions(userId, focusedRaw) {
    return (0, payloads_1.getSellableInventoryOptions)({ inventory: (0, utils_1.ensureUser)(userId).inventory, focusedRaw })
        .slice(0, 25)
        .map(entry => {
        const raw = `[${(0, payloads_1.rarityBadge)(entry.rarity)}] OWNED x${entry.qty} | ${entry.name} | Sell ${entry.unitPrice}`;
        const label = raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
        return { name: label, value: entry.id };
    });
}
