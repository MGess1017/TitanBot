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
    id: "2026-11-casino-commands",
    title: "🎰 Casino Commands Moved Under /casino",
    intro: "All casino games now live under one command, which makes room for new features. Your tokens, stats and odds are unchanged.",
    sections: [
        {
            name: "🎲 How to Play Now",
            lines: [
                "Type `/casino` and pick a game: `dice`, `roulette`, `blackjack`, `crash`, `slots`, `coinflip`, `baccarat`, `hilo` or `keno`.",
                "Example: `/casino dice bet:100 choice:high` (was `/dice`). Magic Slots is now `/casino slots`."
            ]
        },
        {
            name: "🏛️ Casino Floor",
            lines: [
                "`/casino lobby` opens the button-based game floor, with replay, double and halve on every result."
            ]
        }
    ],
    footer: "FNT • Titan Bot • Questions? Open a ticket anytime."
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
