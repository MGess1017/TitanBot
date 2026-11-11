import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild, type User } from "discord.js";
import { ensureUser, getPmcPrestigeTier, getPmcProgress, getXPLevel, XP_LEVEL_THRESHOLDS } from "../../utils";
import { XP_CRATE_COOLDOWN_MS } from "../../game/xpCrates";
import { renderProgressionCard, type ProgressionCardKind, type ProgressionCardSnapshot } from "../../features/progressionCard";
import { getCurrentVoiceXpMultiplier } from "../xp/engagement";
import { getEffectiveXpRoleEntries } from "../xp/roles";
import { normalizeHubPreferences } from "../../game/hubPreferences";
import { getThemeColor } from "../../features/profileHub";
import { buildHubDashboard, INQUIRY_IDS, withHubNavigation } from "../../features/inquiryPanel";
import { CHECKPOINT_SECTION_IDS, isSectionComplete } from "../../game/checkpointRating";

export function buildDashboardPayload(user: User, guild: Guild | null) {
    const state = ensureUser(user.id);
    const preferences = normalizeHubPreferences(state.preferences.hub);
    const xp = getProgressionCardSnapshot("xp", user, guild);
    const pmc = getProgressionCardSnapshot("pmc", user, guild);
    const profile = state.checkpointProfile;
    const steps = Number(Boolean(profile?.ingameName))
        + CHECKPOINT_SECTION_IDS.filter(id => isSectionComplete(profile?.stats || {}, id)).length;
    return buildHubDashboard({
        xpLevel: xp.level, pmcLevel: pmc.level, next: xp.next,
        arenaProgress: `${steps}/5 setup steps complete`, rs3Name: preferences.rs3Name, shortcut: preferences.shortcut
    });
}

export function getProgressionCardSnapshot(kind: ProgressionCardKind, user: User, guild: Guild | null): ProgressionCardSnapshot {
    const state = ensureUser(user.id);
    if (kind === "pmc") {
        const progress = getPmcProgress(state.pmcXP);
        return {
            kind, name: state.pmcCallsign, level: progress.level, xp: state.pmcXP,
            prestige: getPmcPrestigeTier(state.pmcPrestige).numeral,
            progress: progress.capped ? 1 : progress.intoLevel / Math.max(1, progress.nextThreshold - progress.currentThreshold),
            next: progress.capped ? "Maximum level reached" : `${progress.needForNext.toLocaleString("en-US")} XP to next level`,
            stats: [
                { label: "Raids", value: state.pmcRaids.toLocaleString("en-US") },
                { label: "Extraction", value: `${state.pmcRaids ? (state.pmcRaidWins / state.pmcRaids * 100).toFixed(1) : "0"}%` },
                { label: "Boss kills", value: state.pmcBossKills.toLocaleString("en-US") }
            ]
        };
    }
    const level = getXPLevel(state.xp);
    const current = level ? XP_LEVEL_THRESHOLDS[level - 1] : 0;
    const next = XP_LEVEL_THRESHOLDS[level];
    return {
        kind, name: user.displayName, level, xp: state.xp, prestige: String(state.prestige),
        progress: next === undefined ? 1 : (state.xp - current) / Math.max(1, next - current),
        next: next === undefined ? "Maximum level reached" : `${Math.max(0, next - state.xp).toLocaleString("en-US")} XP to level ${level + 1}`,
        stats: [
            { label: "Voice bonus", value: `${getCurrentVoiceXpMultiplier(guild, user.id)}x XP` },
            { label: "Streak", value: `${state.dailyStreak} days` },
            { label: "Achievements", value: String(state.achievementIds.length) }
        ]
    };
}

export function buildXpProfilePayload(user: User, guild: Guild | null): string {
    const state = ensureUser(user.id);
    const snapshot = getProgressionCardSnapshot("xp", user, guild);
    const roles = getEffectiveXpRoleEntries();
    const current = roles.filter(role => role.xp <= state.xp).pop();
    const next = roles.find(role => role.xp > state.xp);
    const nextCrateAt = state.latestXpCrate ? state.latestXpCrate.claimedAt + XP_CRATE_COOLDOWN_MS : 0;
    const crate = state.latestXpCrate;
    const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("FNTCORD | XP Card")
        .setDescription(`Level **${snapshot.level}** | **${state.xp.toLocaleString("en-US")} XP** | Voice **${snapshot.stats[0].value}**`)
        .setImage("attachment://xp-profile.png")
        .addFields(
            { name: "Rank", value: `${current?.name || "Unranked"}\n${next ? `${Math.max(0, next.xp - state.xp).toLocaleString("en-US")} XP to ${next.name}` : "Highest configured rank"}`, inline: true },
            { name: "Daily Crate", value: `${crate ? `Latest: ${crate.crateId} (+${crate.xp.toLocaleString("en-US")} XP)\n` : "No crate claimed yet.\n"}${nextCrateAt > Date.now() ? `Next: <t:${Math.floor(nextCrateAt / 1000)}:R>` : "Ready to claim"}`, inline: true }
        )
        .setFooter({ text: "FNTCORD / BOT-TRACKED / SNAPSHOT AT REFRESH" }).setTimestamp();
    return JSON.stringify(withHubNavigation({ embed: embed.toJSON(), progressionCard: "xp", components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}xp:details`).setLabel("Detailed Breakdown").setStyle(ButtonStyle.Secondary)
        ).toJSON()
    ] }, "xp"));
}

export async function progressionCardAttachment(kind: ProgressionCardKind, user: User, guild: Guild | null): Promise<AttachmentBuilder> {
    const state = ensureUser(user.id);
    const preferences = normalizeHubPreferences(state.preferences.hub);
    const snapshot = getProgressionCardSnapshot(kind, user, guild);
    return new AttachmentBuilder(await renderProgressionCard({
        ...snapshot,
        stats: preferences.highlights === "none" ? [] : preferences.highlights === "primary" ? snapshot.stats.slice(0, 1) : snapshot.stats,
        ...(preferences.background !== "automatic" ? { background: preferences.background } : {}),
        ...(preferences.accent === "theme" ? { accent: `#${getThemeColor(state.cosmetics).toString(16).padStart(6, "0")}` } : {})
    }), {
        name: `${kind}-profile.png`
    });
}
