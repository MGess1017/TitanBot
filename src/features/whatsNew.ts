import fs from "fs-extra";
import path from "node:path";
import { EmbedBuilder } from "discord.js";

export type WhatsNewSection = { name: string; lines: string[] };
export type WhatsNewRelease = { id: string; title: string; intro: string; sections: WhatsNewSection[]; footer: string };

export const WHATS_NEW_COLOR = 0x9b59b6;

export const WHATS_NEW_RELEASE: WhatsNewRelease = {
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
