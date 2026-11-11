"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsNewStore = exports.WHATS_NEW_RELEASE = exports.WHATS_NEW_COLOR = void 0;
exports.buildWhatsNewEmbed = buildWhatsNewEmbed;
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_path_1 = __importDefault(require("node:path"));
const discord_js_1 = require("discord.js");
exports.WHATS_NEW_COLOR = 0x9b59b6;
exports.WHATS_NEW_RELEASE = {
    id: "fnt-patch-009",
    title: "FNTCORD — Patch 009: Owner Control & Store",
    intro: "Private administration. An organized catalog. Direct owner support.",
    sections: [
        {
            name: "01 • Owner Control",
            lines: [
                "Authorized owners can adjust server XP, PMC XP, FN Tokenz wallets/banks, and Access Points with before/after previews and saved receipts.",
                "Feature switches and reward rates are managed privately. Every change requires a reason and explicit confirmation."
            ]
        },
        {
            name: "02 • Moderation Allowances",
            lines: [
                "Configure per-administrator ban/kick allowances for calendar days, Monday-start weeks, or months in UTC, with individual overrides.",
                "Unlimited until configured; server owner exempt. Administrator authorization and existing Access Point badge tiers remain unchanged. Native Discord actions bypass bot quotas."
            ]
        },
        {
            name: "03 • Owner-Managed Store",
            lines: [
                "The store owner and designated manager can publish permanently numbered items with descriptions, categories and listed costs.",
                "Private management includes previews, confirmed edits, availability controls, archiving and restoration."
            ]
        },
        {
            name: "04 • Private Catalog Requests",
            lines: [
                "Browse, search and view item details privately. Request an item number to open a private ticket assigned directly to the server owner.",
                "The catalog does not charge currency or confirm purchases. Item details and listed cost are saved with the request for manual fulfillment."
            ]
        },
        {
            name: "05 • Reliability & Organization",
            lines: [
                "Public panels remain compact; customer replies and administration stay private. Existing support, inquiry, profiles and cosmetic shopping are preserved.",
                "Persistent moderation reservations, one-use confirmations, stale-edit checks and duplicate-ticket protection keep changes accountable."
            ]
        }
    ],
    footer: "FNTCORD • Patch 009 • Owner & Store Update"
};
function buildWhatsNewEmbed(release = exports.WHATS_NEW_RELEASE) {
    return new discord_js_1.EmbedBuilder()
        .setColor(exports.WHATS_NEW_COLOR)
        .setTitle(release.title.slice(0, 256))
        .setDescription(release.intro.slice(0, 4096))
        .addFields(release.sections.slice(0, 25).map(section => ({
        name: section.name.slice(0, 256),
        value: section.lines.map(line => `• ${line}`).join("\n").slice(0, 1024),
        inline: false
    })))
        .setFooter({ text: release.footer.slice(0, 2048) })
        .setTimestamp();
}
/** Remembers which releases were announced in which channel so each release posts exactly once. */
class WhatsNewStore {
    constructor(filePath, persist = true) {
        this.filePath = filePath;
        this.persist = persist;
        this.posted = {};
        try {
            if (persist && fs_extra_1.default.existsSync(filePath)) {
                const raw = fs_extra_1.default.readJsonSync(filePath);
                if (raw?.posted && typeof raw.posted === "object")
                    this.posted = raw.posted;
            }
        }
        catch {
            this.posted = {};
        }
    }
    hasPosted(releaseId, channelId) {
        return this.posted[releaseId]?.channelId === channelId;
    }
    markPosted(releaseId, channelId, messageId, now = Date.now()) {
        this.posted[releaseId] = { channelId, messageId, at: now };
        if (!this.persist)
            return;
        fs_extra_1.default.ensureDirSync(node_path_1.default.dirname(this.filePath));
        const temp = `${this.filePath}.${process.pid}.tmp`;
        fs_extra_1.default.writeJsonSync(temp, { posted: this.posted }, { spaces: 2 });
        fs_extra_1.default.moveSync(temp, this.filePath, { overwrite: true });
    }
}
exports.WhatsNewStore = WhatsNewStore;
