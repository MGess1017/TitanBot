"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradeStore = void 0;
exports.saveTradeStore = saveTradeStore;
exports.createTradeOffer = createTradeOffer;
exports.getOpenTradeOffer = getOpenTradeOffer;
// Player trade offers: storage and lifecycle.
const config_1 = require("../core/config");
const storage_1 = require("../core/storage");
function readTradeStore() {
    return (0, storage_1.readJsonWithBackup)(config_1.TRADE_DATA_FILE, raw => {
        const candidate = raw;
        if (candidate && Array.isArray(candidate.offers) && typeof candidate.nextId === "number") {
            const offers = normalizeTradeOffers(candidate.offers);
            return { nextId: Math.max(1, candidate.nextId), offers };
        }
        return null;
    }, { nextId: 1, offers: [] });
}
function normalizeTradeOffers(rawOffers, now = Date.now()) {
    const openOffers = [];
    const recentClosedOffers = [];
    for (const raw of rawOffers) {
        if (!raw || typeof raw !== "object")
            continue;
        const row = raw;
        if (typeof row.id !== "number" || !Number.isFinite(row.id))
            continue;
        if (typeof row.guildId !== "string" || typeof row.fromUserId !== "string" || typeof row.toUserId !== "string")
            continue;
        if (typeof row.offerItemId !== "string" || typeof row.requestItemId !== "string")
            continue;
        if (typeof row.offerQty !== "number" || typeof row.requestQty !== "number")
            continue;
        const status = row.status === "accepted" || row.status === "declined" || row.status === "cancelled"
            ? row.status
            : "open";
        const createdAt = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : now;
        const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : createdAt;
        const offer = {
            id: Math.max(1, Math.floor(row.id)),
            guildId: row.guildId,
            fromUserId: row.fromUserId,
            toUserId: row.toUserId,
            offerItemId: row.offerItemId,
            offerQty: Math.max(1, Math.floor(row.offerQty)),
            requestItemId: row.requestItemId,
            requestQty: Math.max(1, Math.floor(row.requestQty)),
            status,
            createdAt,
            updatedAt
        };
        if (status === "open") {
            openOffers.push(offer);
            continue;
        }
        if (now - updatedAt <= config_1.CLOSED_TRADE_RETENTION_MS) {
            recentClosedOffers.push(offer);
        }
    }
    recentClosedOffers.sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
    const trimmedClosed = recentClosedOffers.slice(0, config_1.MAX_CLOSED_TRADES);
    return [...openOffers, ...trimmedClosed];
}
function pruneTradeOffers(now = Date.now()) {
    const normalized = normalizeTradeOffers(exports.tradeStore.offers, now);
    if (normalized.length !== exports.tradeStore.offers.length) {
        exports.tradeStore.offers = normalized;
    }
}
exports.tradeStore = readTradeStore();
function saveTradeStore() {
    pruneTradeOffers();
    (0, storage_1.writeJsonAtomic)(config_1.TRADE_DATA_FILE, exports.tradeStore);
}
function createTradeOffer(input) {
    const offer = {
        id: exports.tradeStore.nextId++,
        status: "open",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...input
    };
    exports.tradeStore.offers.push(offer);
    saveTradeStore();
    return offer;
}
function getOpenTradeOffer(offerId) {
    const offer = exports.tradeStore.offers.find(entry => entry.id === offerId);
    if (!offer || offer.status !== "open")
        return null;
    return offer;
}
