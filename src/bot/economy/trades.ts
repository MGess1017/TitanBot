// Player trade offers: storage and lifecycle.
import { CLOSED_TRADE_RETENTION_MS, MAX_CLOSED_TRADES, TRADE_DATA_FILE } from "../core/config";
import { readJsonWithBackup, writeJsonAtomic } from "../core/storage";

type TradeOfferStatus = "open" | "accepted" | "declined" | "cancelled";

type TradeOffer = {
    id: number;
    guildId: string | null;
    fromUserId: string;
    toUserId: string;
    offerItemId: string;
    offerQty: number;
    requestItemId: string;
    requestQty: number;
    status: TradeOfferStatus;
    createdAt: number;
    updatedAt: number;
};

type TradeStore = {
    nextId: number;
    offers: TradeOffer[];
};

function readTradeStore(): TradeStore {
    return readJsonWithBackup(TRADE_DATA_FILE, raw => {
        const candidate = raw as Partial<TradeStore>;
        if (candidate && Array.isArray(candidate.offers) && typeof candidate.nextId === "number") {
            const offers = normalizeTradeOffers(candidate.offers);
            return { nextId: Math.max(1, candidate.nextId), offers };
        }
        return null;
    }, { nextId: 1, offers: [] });
}

function normalizeTradeOffers(rawOffers: unknown[], now = Date.now()): TradeOffer[] {
    const openOffers: TradeOffer[] = [];
    const recentClosedOffers: TradeOffer[] = [];

    for (const raw of rawOffers) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Partial<TradeOffer>;
        if (typeof row.id !== "number" || !Number.isFinite(row.id)) continue;
        if (typeof row.guildId !== "string" || typeof row.fromUserId !== "string" || typeof row.toUserId !== "string") continue;
        if (typeof row.offerItemId !== "string" || typeof row.requestItemId !== "string") continue;
        if (typeof row.offerQty !== "number" || typeof row.requestQty !== "number") continue;

        const status: TradeOfferStatus = row.status === "accepted" || row.status === "declined" || row.status === "cancelled"
            ? row.status
            : "open";
        const createdAt = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : now;
        const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : createdAt;
        const offer: TradeOffer = {
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

        if (now - updatedAt <= CLOSED_TRADE_RETENTION_MS) {
            recentClosedOffers.push(offer);
        }
    }

    recentClosedOffers.sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
    const trimmedClosed = recentClosedOffers.slice(0, MAX_CLOSED_TRADES);
    return [...openOffers, ...trimmedClosed];
}

function pruneTradeOffers(now = Date.now()): void {
    const normalized = normalizeTradeOffers(tradeStore.offers as unknown[], now);
    if (normalized.length !== tradeStore.offers.length) {
        tradeStore.offers = normalized;
    }
}

export const tradeStore = readTradeStore();

export function saveTradeStore(): void {
    pruneTradeOffers();
    writeJsonAtomic(TRADE_DATA_FILE, tradeStore);
}

export function createTradeOffer(input: Omit<TradeOffer, "id" | "status" | "createdAt" | "updatedAt">): TradeOffer {
    const offer: TradeOffer = {
        id: tradeStore.nextId++,
        status: "open",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...input
    };
    tradeStore.offers.push(offer);
    saveTradeStore();
    return offer;
}

export function getOpenTradeOffer(offerId: number): TradeOffer | null {
    const offer = tradeStore.offers.find(entry => entry.id === offerId);
    if (!offer || offer.status !== "open") return null;
    return offer;
}
