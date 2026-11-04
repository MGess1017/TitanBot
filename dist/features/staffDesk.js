"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeBaseStore = exports.BUILT_IN_KB = exports.RESOLUTION_CHECKLISTS = void 0;
exports.getChecklist = getChecklist;
exports.normalizeTicketChecklist = normalizeTicketChecklist;
exports.scoreText = scoreText;
exports.searchKnowledgeBase = searchKnowledgeBase;
exports.buildCaseHistoryLines = buildCaseHistoryLines;
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_path_1 = __importDefault(require("node:path"));
const COMMON_CLOSE = [
    { id: "confirmed", label: "Member confirmed the outcome (or 24h with no reply)" },
    { id: "noted", label: "Resolution summary added as a ticket note" }
];
exports.RESOLUTION_CHECKLISTS = {
    general: [
        { id: "understood", label: "Restated the request and confirmed details" },
        { id: "answered", label: "Answered or linked the relevant guide" },
        ...COMMON_CLOSE
    ],
    bug: [
        { id: "repro", label: "Collected steps, command used, and timestamp" },
        { id: "evidence", label: "Screenshot or error text attached" },
        { id: "checked_state", label: "Checked the member's saved data (/xp, /pmc, inventory)" },
        { id: "fixed_or_logged", label: "Fixed, compensated, or logged for developers" },
        ...COMMON_CLOSE
    ],
    appeal: [
        { id: "case_found", label: "Located the original moderation case and evidence" },
        { id: "second_staff", label: "Reviewed by a second staff member" },
        { id: "decision", label: "Decision explained to the member" },
        { id: "actioned", label: "Unban/untimeout applied or denial recorded" },
        ...COMMON_CLOSE
    ],
    billing: [
        { id: "order", label: "Collected order or transaction reference" },
        { id: "verified", label: "Verified ownership and purchase status" },
        { id: "escalated", label: "Refund/credit handled or escalated to an admin" },
        ...COMMON_CLOSE
    ],
    account: [
        { id: "identity", label: "Verified account ownership" },
        { id: "roles", label: "Checked roles, XP role sync, and permissions" },
        { id: "restored", label: "Restored access or explained next steps" },
        ...COMMON_CLOSE
    ],
    report: [
        { id: "evidence", label: "Evidence captured (message links/screenshots)" },
        { id: "history", label: "Checked the reported member's case history" },
        { id: "action", label: "Action taken (warn/timeout/ban) or no-action reason recorded" },
        { id: "reporter", label: "Reporter informed without sharing private details" },
        ...COMMON_CLOSE
    ]
};
function getChecklist(category) {
    return exports.RESOLUTION_CHECKLISTS[category || "general"] || exports.RESOLUTION_CHECKLISTS.general;
}
function normalizeTicketChecklist(raw) {
    if (!raw || typeof raw !== "object")
        return {};
    const result = {};
    for (const [key, value] of Object.entries(raw).slice(0, 20)) {
        const entry = value;
        if (entry && typeof entry.byId === "string" && typeof entry.at === "number")
            result[key.slice(0, 40)] = { byId: entry.byId, at: entry.at };
    }
    return result;
}
exports.BUILT_IN_KB = [
    { id: "xp-voice", title: "Voice XP and the 2x bonus", tags: ["xp", "voice", "double", "vc", "multiplier"], builtIn: true,
        body: "Every VC earns voice XP per minute. After the configured continuous time (default 2h) it doubles. Switching VCs keeps the timer; disconnecting resets to 1x. /xp shows live 1x/2x status." },
    { id: "xp-crate", title: "Daily XP crates", tags: ["crate", "daily", "limit", "xp", "astral"], builtIn: true,
        body: "One crate per rolling 24h from the FN Xp Panel. Repeat clicks show 'Daily limit exceeded'. The latest crate and next claim time appear in /xp." },
    { id: "xp-missing", title: "Missing XP or rank role", tags: ["xp", "role", "missing", "sync", "rank"], builtIn: true,
        body: "Check /xp for saved XP, then ask an admin to run /xpverify for persistence and /xprolesync to resync XP roles." },
    { id: "raid-boss", title: "Raid boss fights", tags: ["raid", "boss", "defend", "telegraph", "heal"], builtIn: true,
        body: "Bosses telegraph a countercharge every third turn or at 60%+ rage. Defend cuts it by 75%. Heal needs a med patch and missing HP. Extract Now keeps settled rewards." },
    { id: "player-card", title: "Arena player rating card", tags: ["tarkov", "arena", "card", "rating", "checkpoint", "pmc"], builtIn: true,
        body: "Members fill four forms in the Arena Player Rating panel. The card posts once all 16 stats are saved and updates in place on every edit. Stats are self-reported." },
    { id: "cosmetics", title: "Cosmetic shop and refunds", tags: ["cosmetic", "theme", "title", "badge", "shop", "tokens", "refund"], builtIn: true,
        body: "Themes, titles, and badges from /profile are cosmetic only. Purchases spend FN Token$. Staff can verify ownership in the member's /profile collection." },
    { id: "timeouts", title: "Anti-raid alerts and timeouts", tags: ["spam", "raid", "timeout", "mention", "flood", "undo"], builtIn: true,
        body: "Anti-raid posts alerts to the staff alert channel. Staff can apply a timeout from the alert and undo it from the same alert. Raid mode raises server verification and can be restored." },
    { id: "tickets", title: "Ticket workflow", tags: ["ticket", "claim", "close", "resolve", "reopen"], builtIn: true,
        body: "Claim with /claimticket, add notes with /ticketnote, archive with /closeticket, then /resolveticket. Use /staff in a ticket for the checklist and member history." }
];
function tokenize(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(part => part.length >= 2);
}
function scoreText(queryTokens, title, body, tags = []) {
    if (!queryTokens.length)
        return 0;
    const titleTokens = new Set(tokenize(title));
    const bodyTokens = new Set(tokenize(body));
    const tagSet = new Set(tags.map(tag => tag.toLowerCase()));
    let score = 0;
    for (const token of queryTokens) {
        if (tagSet.has(token))
            score += 4;
        if (titleTokens.has(token))
            score += 3;
        if (bodyTokens.has(token))
            score += 1;
        else if ([...bodyTokens].some(word => word.startsWith(token) && token.length >= 3))
            score += 0.5;
    }
    return score;
}
function searchKnowledgeBase(query, articles, resolvedTickets, limit = 6) {
    const tokens = [...new Set(tokenize(query))];
    const hits = [];
    for (const article of articles) {
        const score = scoreText(tokens, article.title, article.body, article.tags);
        if (score > 0)
            hits.push({ kind: "article", article, score: score + 1 });
    }
    for (const ticket of resolvedTickets) {
        const score = scoreText(tokens, "", `${ticket.text} ${ticket.resolution}`);
        if (score >= Math.max(1, tokens.length * 0.5)) {
            hits.push({ kind: "ticket", ticketId: ticket.id, summary: ticket.resolution.slice(0, 160), score });
        }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
class KnowledgeBaseStore {
    constructor(filePath, persist = true) {
        this.filePath = filePath;
        this.persist = persist;
        this.custom = [];
        try {
            const raw = fs_extra_1.default.existsSync(filePath) ? fs_extra_1.default.readJsonSync(filePath) : null;
            if (Array.isArray(raw?.articles)) {
                this.custom = raw.articles.filter((entry) => Boolean(entry && typeof entry === "object"
                    && typeof entry.id === "string" && typeof entry.title === "string"
                    && typeof entry.body === "string"))
                    .map(entry => ({ ...entry, tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [], builtIn: false }));
            }
        }
        catch {
            this.custom = [];
        }
    }
    all() {
        return [...exports.BUILT_IN_KB, ...this.custom];
    }
    add(input) {
        const article = {
            id: `kb-${Date.now().toString(36)}`,
            title: input.title.trim().slice(0, 100),
            body: input.body.trim().slice(0, 1500),
            tags: input.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean).slice(0, 10),
            builtIn: false,
            authorId: input.authorId,
            updatedAt: Date.now()
        };
        const next = [...this.custom, article];
        if (this.persist) {
            fs_extra_1.default.ensureDirSync(node_path_1.default.dirname(this.filePath));
            const temp = `${this.filePath}.${process.pid}.tmp`;
            fs_extra_1.default.writeJsonSync(temp, { articles: next }, { spaces: 2 });
            fs_extra_1.default.moveSync(temp, this.filePath, { overwrite: true });
        }
        this.custom = next;
        return article;
    }
    remove(id) {
        const next = this.custom.filter(article => article.id !== id);
        if (next.length === this.custom.length)
            return false;
        if (this.persist) {
            const temp = `${this.filePath}.${process.pid}.tmp`;
            fs_extra_1.default.writeJsonSync(temp, { articles: next }, { spaces: 2 });
            fs_extra_1.default.moveSync(temp, this.filePath, { overwrite: true });
        }
        this.custom = next;
        return true;
    }
}
exports.KnowledgeBaseStore = KnowledgeBaseStore;
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:d>`;
/** Compact, newest-first summary that fits inside one embed. */
function buildCaseHistoryLines(input, perSection = 5) {
    const openTickets = input.tickets.filter(ticket => ticket.status === "open" || ticket.status === "claimed").length;
    const summary = [
        `Tickets: **${input.tickets.length}** (${openTickets} open)`,
        `Reports against: **${input.reports.length}**`,
        `Warnings: **${input.warnings.length}**`,
        `Anti-raid alerts: **${input.alerts.length}**`
    ].join(" • ");
    const section = (name, lines) => ({ name, value: lines.length ? lines.slice(0, perSection).join("\n").slice(0, 1020) : "None" });
    return {
        summary,
        sections: [
            section("Tickets", [...input.tickets].sort((a, b) => b.createdAt - a.createdAt).map(ticket => `#${ticket.id} ${ticket.category || "general"} • ${ticket.status} • ${ts(ticket.createdAt)}${ticket.resolvedReason || ticket.closedReason ? ` — ${(ticket.resolvedReason || ticket.closedReason || "").slice(0, 60)}` : ""}`)),
            section("Reports", [...input.reports].sort((a, b) => b.createdAt - a.createdAt).map(report => `R${report.id} • ${report.status} • ${ts(report.createdAt)} — ${report.summary.slice(0, 60)}`)),
            section("Warnings", [...input.warnings].sort((a, b) => b.at - a.at).map(warning => `${ts(warning.at)} — ${warning.reason.slice(0, 80)}`)),
            section("Anti-raid", [...input.alerts].sort((a, b) => b.at - a.at).map(alert => `${ts(alert.at)} • ${alert.kind.replace("_", " ")}${alert.action ? ` • ${alert.action}` : ""}`))
        ]
    };
}
