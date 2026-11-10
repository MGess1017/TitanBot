import fs from "fs-extra";
import path from "node:path";
import { EmbedBuilder } from "discord.js";

export type WhatsNewSection = { name: string; lines: string[] };
export type WhatsNewRelease = { id: string; title: string; intro: string; sections: WhatsNewSection[]; footer: string };

export const WHATS_NEW_COLOR = 0x9b59b6;

export const WHATS_NEW_RELEASE: WhatsNewRelease = {
    id: "fnt-patch-006",
    title: "FNT Bot — Patch 006: Staff Announcement Studio",
    intro: "Organized personal workspaces and polished staff announcements.",
    sections: [
        {
            name: "01 • Organized Navigation",
            lines: [
                "The Command Hub groups Profiles, Operations, Economy, and Guides & Support. Home, Back, and Refresh keep private navigation tidy.",
                "The existing inquiry panel updates in place. Your commands, player data, leaderboards and crate panels remain available."
            ]
        },
        {
            name: "02 • Staff Embed Studio",
            lines: [
                "Staff can select a destination channel, named color and optional user or role mentions, then compose and publish from a private preview.",
                "Publishing checks destination and mention permissions. Drafts are owner-only, expire after 30 minutes and cannot be submitted twice."
            ]
        },
        {
            name: "03 • Personal Customization",
            lines: [
                "Choose a quick-access destination, tactical card background, and equipped-theme accent. Save or clear a preferred RuneScape player.",
                "Preferences persist across restarts and affect only your experience, never rewards or combat odds."
            ]
        }
    ],
    footer: "FNT Bot • Patch 006 • Member Update"
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
