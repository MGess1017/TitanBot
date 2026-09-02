export type TicketPriority = "low" | "normal" | "high";
export type TicketStatus = "open" | "claimed" | "archived" | "resolved";
export type TicketCategory = "general" | "bug" | "appeal" | "billing" | "account" | "report";

export type TicketSlaPolicy = {
    name: string;
    firstResponseMs: number;
    resolveMs: number;
};

export type TicketLike = {
    id: number;
    guildId: string;
    ownerId: string;
    reason: string;
    status: TicketStatus;
    priority: TicketPriority;
    createdAt: number;
    resolvedAt: number | null;
    assignedToId: string | null;
    category?: string;
};

export type TicketNote = {
    byId: string;
    at: number;
    note: string;
};

export type TicketCsatRecord = {
    rating: number;
    submittedAt: number;
    submittedById: string;
    comment?: string;
};

export function classifyTicketCategory(reason: string): TicketCategory {
    const text = String(reason || "").toLowerCase();
    if (/appeal|ban|mute|timeout/.test(text)) return "appeal";
    if (/billing|payment|purchase|refund|charge/.test(text)) return "billing";
    if (/account|login|password|verify|2fa/.test(text)) return "account";
    if (/report|abuse|cheat|scam|harass/.test(text)) return "report";
    if (/bug|error|broken|issue|glitch|crash/.test(text)) return "bug";
    return "general";
}

export function getKbSuggestions(reason: string): string[] {
    const category = classifyTicketCategory(reason);
    if (category === "account") {
        return [
            "Reset credentials: use account recovery and verify email ownership.",
            "2FA issues: sync device time and regenerate backup codes.",
            "Login lockout: wait 15 minutes after failed attempts."
        ];
    }
    if (category === "billing") {
        return [
            "Confirm payment status in your transaction history.",
            "Refund windows depend on purchase age and consumed items.",
            "Include order ID for faster support turnaround."
        ];
    }
    if (category === "bug") {
        return [
            "Try relaunching the client and clearing local cache.",
            "Capture exact steps to reproduce the issue.",
            "Attach screenshots or logs when possible."
        ];
    }
    return [
        "Check pinned support resources before opening a case.",
        "Include a short summary and expected outcome.",
        "Share timestamps and channel context if relevant."
    ];
}

function tokenize(text: string): string[] {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(part => part.length >= 3)
        .slice(0, 64);
}

function jaccardSimilarity(a: string[], b: string[]): number {
    if (!a.length || !b.length) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const value of setA) {
        if (setB.has(value)) intersection += 1;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
}

export function findPotentialDuplicateTickets(input: {
    tickets: TicketLike[];
    guildId: string;
    ownerId: string;
    reason: string;
    now?: number;
    lookbackMs?: number;
    minScore?: number;
}): Array<{ ticketId: number; score: number; createdAt: number; status: TicketStatus }> {
    const now = input.now ?? Date.now();
    const lookbackMs = input.lookbackMs ?? 14 * 24 * 60 * 60 * 1000;
    const minScore = input.minScore ?? 0.28;
    const target = tokenize(input.reason);

    return input.tickets
        .filter(ticket => ticket.guildId === input.guildId && ticket.ownerId === input.ownerId)
        .filter(ticket => ticket.status === "open" || ticket.status === "claimed")
        .filter(ticket => now - ticket.createdAt <= lookbackMs)
        .map(ticket => {
            const score = jaccardSimilarity(target, tokenize(ticket.reason));
            return { ticketId: ticket.id, score, createdAt: ticket.createdAt, status: ticket.status };
        })
        .filter(item => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
}

export function getTicketSlaPolicy(category: string, priority: TicketPriority): TicketSlaPolicy {
    const normalized = classifyTicketCategory(category);
    const base: Record<TicketCategory, TicketSlaPolicy> = {
        general: { name: "General", firstResponseMs: 15 * 60 * 1000, resolveMs: 24 * 60 * 60 * 1000 },
        bug: { name: "Bug", firstResponseMs: 12 * 60 * 1000, resolveMs: 18 * 60 * 60 * 1000 },
        appeal: { name: "Appeal", firstResponseMs: 10 * 60 * 1000, resolveMs: 12 * 60 * 60 * 1000 },
        billing: { name: "Billing", firstResponseMs: 8 * 60 * 1000, resolveMs: 8 * 60 * 60 * 1000 },
        account: { name: "Account", firstResponseMs: 10 * 60 * 1000, resolveMs: 12 * 60 * 60 * 1000 },
        report: { name: "Report", firstResponseMs: 10 * 60 * 1000, resolveMs: 16 * 60 * 60 * 1000 }
    };

    const chosen = { ...base[normalized] };
    if (priority === "high") {
        chosen.firstResponseMs = Math.max(2 * 60 * 1000, Math.floor(chosen.firstResponseMs * 0.6));
        chosen.resolveMs = Math.max(2 * 60 * 60 * 1000, Math.floor(chosen.resolveMs * 0.65));
    } else if (priority === "low") {
        chosen.firstResponseMs = Math.floor(chosen.firstResponseMs * 1.2);
        chosen.resolveMs = Math.floor(chosen.resolveMs * 1.2);
    }

    return chosen;
}

export function pickLeastLoadedAssignee(handlerIds: string[], tickets: TicketLike[]): string | null {
    if (!handlerIds.length) return null;

    const load = new Map<string, number>();
    for (const id of handlerIds) {
        load.set(id, 0);
    }

    for (const ticket of tickets) {
        if (!ticket.assignedToId) continue;
        if (ticket.status === "resolved") continue;
        if (!load.has(ticket.assignedToId)) continue;
        load.set(ticket.assignedToId, (load.get(ticket.assignedToId) || 0) + 1);
    }

    return handlerIds
        .map(id => ({ id, load: load.get(id) || 0 }))
        .sort((a, b) => a.load - b.load || a.id.localeCompare(b.id))[0]?.id || null;
}

export function canReopenTicket(reopenUntilAt: number | null | undefined, now = Date.now()): boolean {
    if (!reopenUntilAt) return false;
    return now <= reopenUntilAt;
}

export function extractSearchableTicketText(ticket: Pick<TicketLike, "reason" | "category"> & { notes?: TicketNote[] | null }): string {
    const notesText = (ticket.notes || []).map(note => note.note).join(" ");
    return `${ticket.reason || ""} ${ticket.category || ""} ${notesText}`.toLowerCase();
}

export function shouldPurgeResolvedTicket(ticket: Pick<TicketLike, "status" | "resolvedAt">, retentionDays: number, now = Date.now()): boolean {
    if (ticket.status !== "resolved") return false;
    if (!ticket.resolvedAt || retentionDays <= 0) return false;
    return now - ticket.resolvedAt > retentionDays * 24 * 60 * 60 * 1000;
}

export type TicketIntakeSnapshot = {
    category: string;
    summary: string;
    details: string;
    platform: string;
    orderId: string;
    evidence: string;
};

export function parseTicketIntakeSnapshot(reason: string): TicketIntakeSnapshot {
    const text = String(reason || "");
    const segments = text
        .split(/\s*\|\s*/)
        .map(part => part.trim())
        .filter(Boolean);

    const categorySegment = segments.find(part => /^\[[^\]]+\]$/.test(part));
    const category = categorySegment ? categorySegment.replace(/^\[|\]$/g, "").trim() || "general" : "general";

    let summary = "General support";
    let details = "";
    let platform = "";
    let orderId = "";
    let evidence = "";

    for (const segment of segments) {
        if (segment === categorySegment) continue;
        if (!summary || summary === "General support") {
            if (!/^Details:|^Platform:|^Order:|^Evidence:/.test(segment)) {
                summary = segment.replace(/^[\s|:-]+/, "").trim() || "General support";
            }
        }
        if (/^Details:/i.test(segment)) {
            details = segment.replace(/^Details:\s*/i, "").trim();
        } else if (/^Platform:/i.test(segment)) {
            platform = segment.replace(/^Platform:\s*/i, "").trim();
        } else if (/^Order:/i.test(segment)) {
            orderId = segment.replace(/^Order:\s*/i, "").trim();
        } else if (/^Evidence:/i.test(segment)) {
            evidence = segment.replace(/^Evidence:\s*/i, "").trim();
        }
    }

    if (!details) {
        const detailsIndex = segments.findIndex(segment => /^Details:/i.test(segment));
        if (detailsIndex >= 0) {
            const raw = segments[detailsIndex].replace(/^Details:\s*/i, "").trim();
            details = raw;
        }
    }

    return {
        category,
        summary,
        details,
        platform,
        orderId,
        evidence
    };
}

export function hydrateTicketIntakeFields(
    reason: string,
    current?: Partial<TicketIntakeSnapshot>
): TicketIntakeSnapshot {
    const parsed = parseTicketIntakeSnapshot(reason);
    return {
        category: current?.category || parsed.category || "general",
        summary: current?.summary || parsed.summary || "General support",
        details: current?.details || parsed.details || "No details provided.",
        platform: current?.platform || parsed.platform || "Not provided",
        orderId: current?.orderId || parsed.orderId || "",
        evidence: current?.evidence || parsed.evidence || "No evidence provided"
    };
}

export function buildTicketIntakeReason(input: {
    category: string;
    summary: string;
    details: string;
    platform?: string;
    orderId?: string;
    evidence?: string;
}): string {
    const submittedCategory = String(input.category || "general")
        .replace(/[\[\]|\r\n]/g, " ")
        .trim()
        .slice(0, 40) || "general";
    const summary = String(input.summary || "General support").slice(0, 120);
    const details = String(input.details || "").slice(0, 700);
    const pieces = [
        `[${submittedCategory}]`,
        summary,
        details ? `Details: ${details}` : null,
        input.platform ? `Platform: ${String(input.platform).slice(0, 60)}` : null,
        input.orderId ? `Order: ${String(input.orderId).slice(0, 60)}` : null,
        input.evidence ? `Evidence: ${String(input.evidence).slice(0, 240)}` : null
    ].filter(Boolean);

    return pieces.join(" | ");
}

export function buildReportIntakeReason(input: {
    reportedUser: string;
    summary: string;
    details: string;
    location?: string;
    evidence?: string;
    severity?: string;
}): string {
    const reportedUser = String(input.reportedUser || "Unknown target").slice(0, 80);
    const summary = String(input.summary || "User report").slice(0, 120);
    const details = String(input.details || "").slice(0, 700);
    const pieces = [
        "[report]",
        `Target: ${reportedUser}`,
        summary,
        details ? `Details: ${details}` : null,
        input.location ? `Location: ${String(input.location).slice(0, 120)}` : null,
        input.evidence ? `Evidence: ${String(input.evidence).slice(0, 240)}` : null,
        input.severity ? `Severity: ${String(input.severity).slice(0, 40)}` : null
    ].filter(Boolean);

    return pieces.join(" | ");
}
