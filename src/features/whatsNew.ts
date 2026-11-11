import fs from "fs-extra";
import path from "node:path";
import { EmbedBuilder } from "discord.js";

export type WhatsNewSection = { name: string; lines: string[] };
export type WhatsNewRelease = { id: string; title: string; intro: string; sections: WhatsNewSection[]; footer: string };

export const WHATS_NEW_COLOR = 0x9b59b6;

export const WHATS_NEW_RELEASE: WhatsNewRelease = {
    id: "fnt-patch-009",
    title: "FNTCORD — Patch 009: Owner Control & Store",
    intro: "Private administration. An organized catalog. Direct owner support.",
    sections: [
        {
            name: "01 • Owner Control",
            lines: [
                "Authorized owners can adjust server XP, PMC XP, FN Tokenz wallets/banks, and Access Points with before/after previews and saved receipts.",
                "Feature switches and reward rates are managed privately. Every change requires a reason and explicit confirmation."
            ]
        },
        {
            name: "02 • Moderation Allowances",
            lines: [
                "Configure per-administrator ban/kick allowances for calendar days, Monday-start weeks, or months in UTC, with individual overrides.",
                "Unlimited until configured; server owner exempt. Administrator authorization and existing Access Point badge tiers remain unchanged. Native Discord actions bypass bot quotas."
            ]
        },
        {
            name: "03 • Owner-Managed Store",
            lines: [
                "The store owner and designated manager can publish permanently numbered items with descriptions, categories and listed costs.",
                "Private management includes previews, confirmed edits, availability controls, archiving and restoration."
            ]
        },
        {
            name: "04 • Private Catalog Requests",
            lines: [
                "Browse, search and view item details privately. Request an item number to open a private ticket assigned directly to the server owner.",
                "The catalog does not charge currency or confirm purchases. Item details and listed cost are saved with the request for manual fulfillment."
            ]
        },
        {
            name: "05 • Reliability & Organization",
            lines: [
                "Public panels remain compact; customer replies and administration stay private. Existing support, inquiry, profiles and cosmetic shopping are preserved.",
                "Persistent moderation reservations, one-use confirmations, stale-edit checks and duplicate-ticket protection keep changes accountable."
            ]
        }
    ],
    footer: "FNTCORD • Patch 009 • Owner & Store Update"
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
