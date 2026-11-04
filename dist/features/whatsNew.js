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
    id: "2026-11-fnt-season-update",
    title: "✨ What's New with Titan Bot",
    intro: "A big FNT update just landed. Here's everything new for the squad:",
    sections: [
        {
            name: "🏆 Live XP Leaderboard",
            lines: [
                "A purple live leaderboard now ranks everyone with @mentions and updates in real time.",
                "`/xp` shows your current XP multiplier — **1x** or **2x**."
            ]
        },
        {
            name: "🎙️ 2x Voice XP",
            lines: [
                "Stay in voice for **2 hours straight** to unlock **2x XP** — the bot DMs you when it kicks in.",
                "Leaving voice resets you to 1x. There's no AFK penalty."
            ]
        },
        {
            name: "🎁 Daily XP Crates",
            lines: [
                "Hit the **FN Xp Panel** button once every 24 hours for a free crate.",
                "10 color-coded crates up to **100K XP**, plus the super rare **Astral crate worth 1,000,000 XP**.",
                "Your crates show up live in your `/xp` profile."
            ]
        },
        {
            name: "💀 Raid Bosses Reworked",
            lines: [
                "Every raid boss has new, scarier artwork.",
                "Bosses now telegraph their big attacks, so watch for warnings and react as a team."
            ]
        },
        {
            name: "🎯 Arena Player Rating Cards",
            lines: [
                "Enter your Arena in-game name and checkpoint stats in <#1567414626273202286> to get your own sports-style PMC card with a rating out of 100.",
                "Your card shows your **in-game name**. Already have a card? Tap **In-Game Name** to add yours. Updates refresh your card live."
            ]
        },
        {
            name: "🪪 New /profile",
            lines: [
                "One profile for your progression, achievements, collections, activity and preferences.",
                "Spend tokens in the FNT shop on themes, titles and badges. They're cosmetic only and give no gameplay advantage."
            ]
        },
        {
            name: "🛡️ Safer Server",
            lines: [
                "Everyone is welcome. The bot never kicks or removes anyone for joining, no matter how many people join at once.",
                "Repeated spam and mass pings are flagged to staff, and any timeout can be undone."
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
