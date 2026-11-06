import fs from "fs-extra";
import path from "node:path";
import { EmbedBuilder } from "discord.js";

export type WhatsNewSection = { name: string; lines: string[] };
export type WhatsNewRelease = { id: string; title: string; intro: string; sections: WhatsNewSection[]; footer: string };

export const WHATS_NEW_COLOR = 0x9b59b6;

export const WHATS_NEW_RELEASE: WhatsNewRelease = {
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
