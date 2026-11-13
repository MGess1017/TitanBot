import { randomUUID } from "node:crypto";
import {
    LFG_COLORS, LFG_DEFAULT_TTL_MS, lfgExpiration, type LfgColor, type LfgListing,
    type LfgRequestDetails, type LfgVoicePreference
} from "../features/lfg";
import { readJsonWithBackup, writeJsonAtomicSync } from "../bot/core/storage";

export type LfgReport = {
    id: string;
    guildId: string;
    listingId: string;
    reporterId: string;
    reason: string;
    createdAt: number;
    delivery: "pending" | "sent";
};
type LfgSnapshot = { version: 2; listings: LfgListing[]; reports: LfgReport[] };
type LegacyLfgListing = Omit<Partial<LfgListing>, "status"> & { status?: string };
const MAX_LISTINGS = 1000;
const MAX_REPORTS = 5000;

function isColor(value: unknown): value is LfgColor {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(LFG_COLORS, value);
}

function isVoicePreference(value: unknown): value is LfgVoicePreference {
    return value === "any" || value === "required" || value === "not_required";
}

function parseListing(row: LfgListing): boolean {
    return Boolean(row && typeof row.id === "string" && typeof row.guildId === "string"
        && typeof row.channelId === "string" && (row.messageId === null || typeof row.messageId === "string")
        && typeof row.hostId === "string" && typeof row.game === "string" && row.game.length > 0 && row.game.length <= 80
        && Number.isInteger(row.maxPlayers) && row.maxPlayers >= 2 && row.maxPlayers <= 20
        && typeof row.comments === "string" && row.comments.length <= 500 && isColor(row.color)
        && typeof row.platform === "string" && row.platform.length <= 60
        && typeof row.region === "string" && row.region.length <= 60 && isVoicePreference(row.voicePreference)
        && (row.startsAt === null || Number.isFinite(row.startsAt)) && Number.isFinite(row.expiresAt)
        && Array.isArray(row.playerIds) && row.playerIds.length >= 1 && row.playerIds.length <= row.maxPlayers
        && row.playerIds.every(id => typeof id === "string") && row.playerIds[0] === row.hostId
        && new Set(row.playerIds).size === row.playerIds.length
        && ["open", "completed", "canceled", "expired"].includes(row.status)
        && Number.isFinite(row.createdAt) && Number.isInteger(row.revision) && row.revision >= 1
        && Number.isInteger(row.renderedRevision) && row.renderedRevision >= 0 && row.renderedRevision <= row.revision);
}

function parseSnapshot(raw: unknown): LfgSnapshot | null {
    const data = raw as LfgSnapshot | { version: 1; listings: LegacyLfgListing[] };
    if (!data || !Array.isArray(data.listings)) return null;
    if (data.version === 1) {
        const now = Date.now();
        const listings = data.listings.map(row => {
            const createdAt = Number(row.createdAt) || now;
            const expiresAt = createdAt + LFG_DEFAULT_TTL_MS;
            return {
                ...row,
                status: row.status === "closed" ? "completed" : expiresAt <= now ? "expired" : "open",
                platform: "", region: "", voicePreference: "any" as const, startsAt: null,
                expiresAt, revision: 1, renderedRevision: 0
            } as LfgListing;
        });
        if (listings.some(row => !parseListing(row))) return null;
        return { version: 2, listings, reports: [] };
    }
    if (data.version !== 2 || data.listings.length > MAX_LISTINGS
        || !Array.isArray((data as LfgSnapshot).reports) || (data as LfgSnapshot).reports.length > MAX_REPORTS) return null;
    const snapshot = data as LfgSnapshot;
    if (!snapshot.listings.every(parseListing)
        || new Set(snapshot.listings.map(row => row.id)).size !== snapshot.listings.length
        || !snapshot.reports.every(row => row && typeof row.id === "string" && typeof row.guildId === "string"
            && typeof row.listingId === "string" && typeof row.reporterId === "string"
            && typeof row.reason === "string" && row.reason.length >= 5 && row.reason.length <= 500
            && Number.isFinite(row.createdAt) && (row.delivery === "pending" || row.delivery === "sent"))
        || new Set(snapshot.reports.map(row => row.id)).size !== snapshot.reports.length) return null;
    return snapshot;
}

function copy<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }

export class LfgStore {
    private data: LfgSnapshot;

    constructor(private readonly file: string) {
        this.data = readJsonWithBackup(file, parseSnapshot, { version: 2, listings: [], reports: [] });
    }

    private change<T>(mutate: () => T): T {
        const previous = copy(this.data);
        try {
            const result = mutate();
            writeJsonAtomicSync(this.file, this.data);
            return copy(result);
        } catch (error) {
            this.data = previous;
            throw error;
        }
    }

    get(id: string): LfgListing | null {
        const listing = this.data.listings.find(row => row.id === id);
        return listing ? copy(listing) : null;
    }

    create(input: Omit<LfgListing, "id" | "messageId" | "playerIds" | "status" | "createdAt" | "revision" | "renderedRevision" | "expiresAt">): LfgListing {
        return this.change(() => {
            if (this.data.listings.length >= MAX_LISTINGS) {
                const removable = this.data.listings.findIndex(row => row.status !== "open");
                if (removable < 0) throw new Error("The LFG listing limit has been reached. Close an old listing before creating another.");
                this.data.listings.splice(removable, 1);
            }
            const createdAt = Date.now();
            const listing: LfgListing = {
                ...input, id: randomUUID(), messageId: null, playerIds: [input.hostId],
                status: "open", createdAt, expiresAt: lfgExpiration(createdAt, input.startsAt),
                revision: 1, renderedRevision: 0
            };
            this.data.listings.push(listing);
            return listing;
        });
    }

    setMessageId(id: string, messageId: string): LfgListing {
        return this.change(() => {
            const listing = this.requireOpen(id);
            listing.messageId = messageId;
            return listing;
        });
    }

    markRendered(id: string, revision: number): void {
        this.change(() => {
            const listing = this.data.listings.find(row => row.id === id);
            if (!listing) throw new Error("The group request is unavailable.");
            if (listing.revision === revision) listing.renderedRevision = revision;
        });
    }

    remove(id: string): void {
        this.change(() => { this.data.listings = this.data.listings.filter(row => row.id !== id); });
    }

    join(id: string, userId: string): LfgListing {
        return this.change(() => {
            const listing = this.requireOpen(id);
            if (listing.playerIds.includes(userId)) throw new Error("You are already in this group.");
            if (listing.playerIds.length >= listing.maxPlayers) throw new Error("This group is already full.");
            listing.playerIds.push(userId);
            return this.touch(listing);
        });
    }

    leave(id: string, userId: string): LfgListing {
        return this.change(() => {
            const listing = this.requireOpen(id);
            if (userId === listing.hostId) throw new Error("The host cannot leave; close the listing if the group is done.");
            const index = listing.playerIds.indexOf(userId);
            if (index < 0) throw new Error("You are not in this group.");
            listing.playerIds.splice(index, 1);
            return this.touch(listing);
        });
    }

    update(id: string, hostId: string, input: LfgRequestDetails & {
        color: LfgColor; voicePreference: LfgVoicePreference; startsAt: number | null;
    }): LfgListing {
        return this.change(() => {
            const listing = this.requireOpen(id);
            if (listing.hostId !== hostId) throw new Error("Only the host can edit this group request.");
            if (input.maxPlayers < listing.playerIds.length) throw new Error("Player limit cannot be lower than the current group size.");
            Object.assign(listing, input, { expiresAt: lfgExpiration(Date.now(), input.startsAt) });
            return this.touch(listing);
        });
    }

    close(id: string, hostId: string, status: "completed" | "canceled"): LfgListing {
        return this.change(() => {
            const listing = this.requireOpen(id);
            if (listing.hostId !== hostId) throw new Error("Only the host can manage this group request.");
            listing.status = status;
            return this.touch(listing);
        });
    }

    createReport(listingId: string, reporterId: string, reason: string): LfgReport {
        return this.change(() => {
            const listing = this.data.listings.find(row => row.id === listingId);
            if (!listing || listing.status === "canceled" || listing.status === "expired") {
                throw new Error("This listing can no longer be reported.");
            }
            if (reporterId === listing.hostId) throw new Error("You cannot report your own listing.");
            if (this.data.reports.some(report => report.listingId === listingId && report.reporterId === reporterId)) {
                throw new Error("You have already reported this listing.");
            }
            if (this.data.reports.length >= MAX_REPORTS) throw new Error("The LFG report queue is full. Contact staff directly.");
            const report = { id: randomUUID(), guildId: listing.guildId, listingId, reporterId, reason: reason.trim(), createdAt: Date.now(), delivery: "pending" as const };
            this.data.reports.push(report);
            return report;
        });
    }

    pendingReports(guildId: string): LfgReport[] {
        return copy(this.data.reports.filter(report => report.guildId === guildId && report.delivery === "pending"));
    }

    markReportSent(id: string): void {
        this.change(() => {
            const report = this.data.reports.find(row => row.id === id);
            if (!report) throw new Error("LFG report record is unavailable.");
            report.delivery = "sent";
        });
    }

    dueListings(now = Date.now()): LfgListing[] {
        return copy(this.data.listings.filter(row => row.status === "open" && row.expiresAt <= now));
    }

    pendingRender(guildId: string): LfgListing[] {
        return copy(this.data.listings.filter(row => row.guildId === guildId && row.messageId && row.revision !== row.renderedRevision));
    }

    expire(id: string, now = Date.now()): LfgListing | null {
        return this.change(() => {
            const listing = this.data.listings.find(row => row.id === id && row.status === "open" && row.expiresAt <= now);
            if (!listing) return null;
            listing.status = "expired";
            return this.touch(listing);
        });
    }

    private touch(listing: LfgListing): LfgListing {
        listing.revision += 1;
        return listing;
    }

    private requireOpen(id: string): LfgListing {
        const listing = this.data.listings.find(row => row.id === id);
        if (!listing || listing.status !== "open" || listing.expiresAt <= Date.now()) {
            throw new Error("This group request is unavailable, expired, or already closed.");
        }
        return listing;
    }
}
