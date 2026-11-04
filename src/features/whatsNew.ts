import fs from "fs-extra";
import path from "node:path";
import { EmbedBuilder } from "discord.js";

export type WhatsNewSection = { name: string; lines: string[] };
export type WhatsNewRelease = { id: string; title: string; intro: string; sections: WhatsNewSection[]; footer: string };

export const WHATS_NEW_COLOR = 0x9b59b6;

export const WHATS_NEW_RELEASE: WhatsNewRelease = {
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
