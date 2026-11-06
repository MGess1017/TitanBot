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
    id: "fnt-patch-002",
    title: "FNT Bot — Patch 002: Support Workflow Upgrade",
    intro: "Simpler requests, clearer replies, and safer ticket closure.",
    sections: [
        {
            name: "01 • Member Experience",
            lines: [
                "Choose a support category instead of typing one. Failed requests can be edited and retried from saved 24-hour drafts.",
                "Request closure without deleting the case. Ticket status shows whose reply is needed."
            ]
        },
        {
            name: "02 • Staff Workflow",
            lines: [
                "A private Support Queue groups unclaimed cases, waiting members, and overdue staff replies.",
                "Assign Handler and Request Information controls keep follow-up simple. KB is now labeled Help Articles.",
                "Notifications target the handler; intervals and notification preferences are configurable from the queue."
            ]
        },
        {
            name: "03 • Reliability & Closure",
            lines: [
                "Staff must confirm permanent resolution. A complete, verified transcript is required before channel deletion.",
                "Export failures preserve the ticket and alert staff. Unattended tickets now receive reminders instead of automatic closure.",
                "Unchanged cards skip updates, saved panel IDs are reused, and simultaneous case actions are guarded."
            ]
        }
    ],
    footer: "FNT Bot • Patch 002 • Member Update"
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
