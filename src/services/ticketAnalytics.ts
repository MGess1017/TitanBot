type TicketLike = {
    id: number;
    guildId: string;
    reason: string;
    status: "open" | "claimed" | "archived" | "resolved";
    createdAt: number;
    firstResponseAt: number | null;
    resolvedAt: number | null;
    csat?: { rating: number } | null;
};

type CategorySummary = {
    category: string;
    count: number;
    medianResolutionMinutes: number | null;
};

export type TicketAnalyticsSummary = {
    total: number;
    open: number;
    claimed: number;
    archived: number;
    resolved: number;
    active: number;
    medianFirstResponseMinutes: number | null;
    medianResolutionMinutes: number | null;
    createdLast7d: number;
    resolvedLast7d: number;
    medianFirstResponseLast7dMinutes: number | null;
    medianResolutionLast7dMinutes: number | null;
    categories: CategorySummary[];
    csatAverage: number | null;
    csatCount: number;
};

function median(values: number[]): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function toMinutes(ms: number): number {
    return Math.round((ms / 60000) * 10) / 10;
}

function classifyReason(reason: string): string {
    const text = (reason || "").toLowerCase();
    if (/appeal|ban|mute|timeout/.test(text)) return "appeal";
    if (/bug|error|broken|issue|glitch/.test(text)) return "bug";
    if (/account|login|password|verify/.test(text)) return "account";
    if (/report|player|abuse|cheat|scam/.test(text)) return "report";
    if (/billing|payment|purchase|refund/.test(text)) return "billing";
    return "general";
}

export function summarizeTicketAnalytics(tickets: TicketLike[], guildId: string, now = Date.now()): TicketAnalyticsSummary {
    const scoped = tickets.filter(t => t.guildId === guildId);
    const open = scoped.filter(t => t.status === "open").length;
    const claimed = scoped.filter(t => t.status === "claimed").length;
    const archived = scoped.filter(t => t.status === "archived").length;
    const resolved = scoped.filter(t => t.status === "resolved").length;

    const firstResponseDurations = scoped
        .filter(t => typeof t.firstResponseAt === "number" && t.firstResponseAt! >= t.createdAt)
        .map(t => t.firstResponseAt! - t.createdAt);

    const resolutionDurations = scoped
        .filter(t => t.status === "resolved" && typeof t.resolvedAt === "number" && t.resolvedAt! >= t.createdAt)
        .map(t => t.resolvedAt! - t.createdAt);

    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const createdLast7d = scoped.filter(t => t.createdAt >= sevenDaysAgo).length;
    const resolvedLast7dTickets = scoped.filter(t => t.status === "resolved" && typeof t.resolvedAt === "number" && t.resolvedAt! >= sevenDaysAgo);
    const resolvedLast7d = resolvedLast7dTickets.length;

    const firstResponse7d = scoped
        .filter(t => t.createdAt >= sevenDaysAgo && typeof t.firstResponseAt === "number" && t.firstResponseAt! >= t.createdAt)
        .map(t => t.firstResponseAt! - t.createdAt);

    const resolution7d = resolvedLast7dTickets
        .filter(t => typeof t.resolvedAt === "number" && t.resolvedAt! >= t.createdAt)
        .map(t => t.resolvedAt! - t.createdAt);

    const byCategory = new Map<string, number[]>();
    for (const ticket of scoped) {
        const category = classifyReason(ticket.reason);
        if (!byCategory.has(category)) byCategory.set(category, []);
        if (ticket.status === "resolved" && typeof ticket.resolvedAt === "number" && ticket.resolvedAt >= ticket.createdAt) {
            byCategory.get(category)!.push(ticket.resolvedAt - ticket.createdAt);
        }
    }

    const categoryCounts = new Map<string, number>();
    for (const ticket of scoped) {
        const category = classifyReason(ticket.reason);
        categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }

    const categories: CategorySummary[] = Array.from(categoryCounts.entries())
        .map(([category, count]) => {
            const medianMs = median(byCategory.get(category) || []);
            return {
                category,
                count,
                medianResolutionMinutes: medianMs === null ? null : toMinutes(medianMs)
            };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    const medianFirstResponseMs = median(firstResponseDurations);
    const medianResolutionMs = median(resolutionDurations);
    const medianFirstResponse7dMs = median(firstResponse7d);
    const medianResolution7dMs = median(resolution7d);
    const csatRatings = scoped
        .map(ticket => ticket.csat?.rating)
        .filter((rating): rating is number => typeof rating === "number" && rating >= 1 && rating <= 5);
    const csatAverage = csatRatings.length
        ? Math.round((csatRatings.reduce((sum, rating) => sum + rating, 0) / csatRatings.length) * 100) / 100
        : null;

    return {
        total: scoped.length,
        open,
        claimed,
        archived,
        resolved,
        active: open + claimed + archived,
        medianFirstResponseMinutes: medianFirstResponseMs === null ? null : toMinutes(medianFirstResponseMs),
        medianResolutionMinutes: medianResolutionMs === null ? null : toMinutes(medianResolutionMs),
        createdLast7d,
        resolvedLast7d,
        medianFirstResponseLast7dMinutes: medianFirstResponse7dMs === null ? null : toMinutes(medianFirstResponse7dMs),
        medianResolutionLast7dMinutes: medianResolution7dMs === null ? null : toMinutes(medianResolution7dMs),
        categories,
        csatAverage,
        csatCount: csatRatings.length
    };
}
