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
    id: "fnt-patch-004",
    title: "FNT Bot — Patch 004: Player Inquiry & Tactical Cards",
    intro: "A simpler way to find guides, look up players, and check your progress.",
    sections: [
        {
            name: "01 • Player Inquiry",
            lines: [
                "The Player Inquiry panel offers private guide and command searches, personal profiles, and RuneScape player lookups."
            ]
        },
        {
            name: "02 • Tactical Progress Cards",
            lines: [
                "XP and PMC cards now use original AI-generated backgrounds with key progress stats. Detailed PMC sections remain available in the dossier menu.",
                "RuneScape profiles show Jagex avatars and available RuneMetrics stats. Private or unavailable stats are clearly labeled."
            ]
        }
    ],
    footer: "FNT Bot • Patch 004 • Member Update"
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
