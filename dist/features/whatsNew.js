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
    id: "fnt-patch-008",
    title: "FNTCORD — Patch 008: Workspace Navigation Repair",
    intro: "Clean public launchers. Private workspaces. Your FNTCORD experience.",
    sections: [
        {
            name: "01 • My Dashboard",
            lines: [
                "Your private dashboard brings together server and PMC levels, your next XP milestone, Arena setup progress, and a favorite shortcut.",
                "Home, Back, Refresh, and Customize keep navigation consistent without adding channel clutter."
            ]
        },
        {
            name: "02 • Card Studio & Settings",
            lines: [
                "Settings are grouped into Appearance, Privacy, Notifications, and Linked Games. Preview XP/PMC art, owned theme accents, and visible highlights privately.",
                "Private mode keeps future profile replies private and removes your stored public Arena card. Old command messages and leaderboards are not erased."
            ]
        },
        {
            name: "03 • Player Card Workflow",
            lines: [
                "Track setup, edit your profile, refresh cards, and retry failed publication without reentering stats.",
                "Cards show only key information; Detailed Breakdown keeps full statistics one button away."
            ]
        },
        {
            name: "04 • Clear Data Sources",
            lines: [
                "Arena ratings are labeled Self-reported. XP/PMC progression is Bot-tracked. RuneScape results are API-sourced with a fetch timestamp.",
                "Saved player names are preferences, not proof of account ownership. Cards are snapshots, not live gameplay."
            ]
        },
        {
            name: "05 • Staff Studio",
            lines: [
                "Reusable templates, saved drafts, confirmed scheduled announcements, and publication history keep staff workflows organized.",
                "Staff access, destination permissions, and mention safeguards remain enforced."
            ]
        },
        {
            name: "06 • Inquiry Navigation Repair",
            lines: [
                "Home and Back now use distinct controls even when they lead to the same workspace, fixing Discord's duplicate-component rejection.",
                "Dashboard, workspace menus, settings, and nested navigation are regression-tested for unique component IDs."
            ]
        }
    ],
    footer: "FNTCORD • Patch 008 • Member Update"
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
