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
    id: "fnt-patch-010",
    title: "FNTCORD — Patch 010: Verified Store Reviews",
    intro: "Verified feedback. Private records. An uncluttered FNTCORD store.",
    sections: [
        {
            name: "01 • Verified Fulfillment",
            lines: [
                "The server owner can confirm a tracked store request as fulfilled from Owner Control, with a reason and final preview.",
                "Only that request's recipient can leave one review. Closing a ticket does not automatically verify fulfillment."
            ]
        },
        {
            name: "02 • Immediate Item Reviews",
            lines: [
                "Eligible members can leave a 1–5 rating and a short comment from the item's private store view. Reviews publish immediately without owner approval.",
                "Review buttons appear only for items with reviews. Read ratings and paginated feedback privately without filling channels with messages."
            ]
        },
        {
            name: "03 • Private Review Log",
            lines: [
                "Owner Control keeps a persistent, paginated log of fulfillment confirmations and every submitted review, including request references and receipts.",
                "Public review views omit customer IDs and ticket details. Feedback survives restarts; duplicate submissions are rejected."
            ]
        }
    ],
    footer: "FNTCORD • Patch 010 • Verified Reviews"
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
