import fs from "fs-extra";
import path from "node:path";
import { EmbedBuilder } from "discord.js";

export type WhatsNewSection = { name: string; lines: string[] };
export type WhatsNewRelease = { id: string; title: string; intro: string; sections: WhatsNewSection[]; footer: string };

export const WHATS_NEW_COLOR = 0x9b59b6;

export const WHATS_NEW_RELEASE: WhatsNewRelease = {
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

export function buildWhatsNewEmbed(release: WhatsNewRelease = WHATS_NEW_RELEASE): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(WHATS_NEW_COLOR)
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

export type WhatsNewPostRecord = { channelId: string; messageId: string; at: number };

/** Remembers which releases were announced in which channel so each release posts exactly once. */
export class WhatsNewStore {
    private posted: Record<string, WhatsNewPostRecord> = {};

    constructor(private readonly filePath: string, private readonly persist = true) {
        try {
            if (persist && fs.existsSync(filePath)) {
                const raw = fs.readJsonSync(filePath) as { posted?: unknown };
                if (raw?.posted && typeof raw.posted === "object") this.posted = raw.posted as Record<string, WhatsNewPostRecord>;
            }
        } catch {
            this.posted = {};
        }
    }

    hasPosted(releaseId: string, channelId: string): boolean {
        return this.posted[releaseId]?.channelId === channelId;
    }

    markPosted(releaseId: string, channelId: string, messageId: string, now = Date.now()): void {
        this.posted[releaseId] = { channelId, messageId, at: now };
        if (!this.persist) return;
        fs.ensureDirSync(path.dirname(this.filePath));
        const temp = `${this.filePath}.${process.pid}.tmp`;
        fs.writeJsonSync(temp, { posted: this.posted }, { spaces: 2 });
        fs.moveSync(temp, this.filePath, { overwrite: true });
    }
}
