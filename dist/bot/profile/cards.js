"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDashboardPayload = buildDashboardPayload;
exports.getProgressionCardSnapshot = getProgressionCardSnapshot;
exports.buildXpProfilePayload = buildXpProfilePayload;
exports.progressionCardAttachment = progressionCardAttachment;
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const xpCrates_1 = require("../../game/xpCrates");
const progressionCard_1 = require("../../features/progressionCard");
const engagement_1 = require("../xp/engagement");
const roles_1 = require("../xp/roles");
const hubPreferences_1 = require("../../game/hubPreferences");
const profileHub_1 = require("../../features/profileHub");
const inquiryPanel_1 = require("../../features/inquiryPanel");
const checkpointRating_1 = require("../../game/checkpointRating");
function buildDashboardPayload(user, guild) {
    const state = (0, utils_1.ensureUser)(user.id);
    const preferences = (0, hubPreferences_1.normalizeHubPreferences)(state.preferences.hub);
    const xp = getProgressionCardSnapshot("xp", user, guild);
    const pmc = getProgressionCardSnapshot("pmc", user, guild);
    const profile = state.checkpointProfile;
    const steps = Number(Boolean(profile?.ingameName))
        + checkpointRating_1.CHECKPOINT_SECTION_IDS.filter(id => (0, checkpointRating_1.isSectionComplete)(profile?.stats || {}, id)).length;
    return (0, inquiryPanel_1.buildHubDashboard)({
        xpLevel: xp.level, pmcLevel: pmc.level, next: xp.next,
        arenaProgress: `${steps}/5 setup steps complete`, rs3Name: preferences.rs3Name, shortcut: preferences.shortcut
    });
}
function getProgressionCardSnapshot(kind, user, guild) {
    const state = (0, utils_1.ensureUser)(user.id);
    if (kind === "pmc") {
        const progress = (0, utils_1.getPmcProgress)(state.pmcXP);
        return {
            kind, name: state.pmcCallsign, level: progress.level, xp: state.pmcXP,
            prestige: (0, utils_1.getPmcPrestigeTier)(state.pmcPrestige).numeral,
            progress: progress.capped ? 1 : progress.intoLevel / Math.max(1, progress.nextThreshold - progress.currentThreshold),
            next: progress.capped ? "Maximum level reached" : `${progress.needForNext.toLocaleString("en-US")} XP to next level`,
            stats: [
                { label: "Raids", value: state.pmcRaids.toLocaleString("en-US") },
                { label: "Extraction", value: `${state.pmcRaids ? (state.pmcRaidWins / state.pmcRaids * 100).toFixed(1) : "0"}%` },
                { label: "Boss kills", value: state.pmcBossKills.toLocaleString("en-US") }
            ]
        };
    }
    const level = (0, utils_1.getXPLevel)(state.xp);
    const current = level ? utils_1.XP_LEVEL_THRESHOLDS[level - 1] : 0;
    const next = utils_1.XP_LEVEL_THRESHOLDS[level];
    return {
        kind, name: user.displayName, level, xp: state.xp, prestige: String(state.prestige),
        progress: next === undefined ? 1 : (state.xp - current) / Math.max(1, next - current),
        next: next === undefined ? "Maximum level reached" : `${Math.max(0, next - state.xp).toLocaleString("en-US")} XP to level ${level + 1}`,
        stats: [
            { label: "Voice bonus", value: `${(0, engagement_1.getCurrentVoiceXpMultiplier)(guild, user.id)}x XP` },
            { label: "Streak", value: `${state.dailyStreak} days` },
            { label: "Achievements", value: String(state.achievementIds.length) }
        ]
    };
}
function buildXpProfilePayload(user, guild) {
    const state = (0, utils_1.ensureUser)(user.id);
    const snapshot = getProgressionCardSnapshot("xp", user, guild);
    const roles = (0, roles_1.getEffectiveXpRoleEntries)();
    const current = roles.filter(role => role.xp <= state.xp).pop();
    const next = roles.find(role => role.xp > state.xp);
    const nextCrateAt = state.latestXpCrate ? state.latestXpCrate.claimedAt + xpCrates_1.XP_CRATE_COOLDOWN_MS : 0;
    const crate = state.latestXpCrate;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("FNTCORD | XP Card")
        .setDescription(`Level **${snapshot.level}** | **${state.xp.toLocaleString("en-US")} XP** | Voice **${snapshot.stats[0].value}**`)
        .setImage("attachment://xp-profile.png")
        .addFields({ name: "Rank", value: `${current?.name || "Unranked"}\n${next ? `${Math.max(0, next.xp - state.xp).toLocaleString("en-US")} XP to ${next.name}` : "Highest configured rank"}`, inline: true }, { name: "Daily Crate", value: `${crate ? `Latest: ${crate.crateId} (+${crate.xp.toLocaleString("en-US")} XP)\n` : "No crate claimed yet.\n"}${nextCrateAt > Date.now() ? `Next: <t:${Math.floor(nextCrateAt / 1000)}:R>` : "Ready to claim"}`, inline: true })
        .setFooter({ text: "FNTCORD / BOT-TRACKED / SNAPSHOT AT REFRESH" }).setTimestamp();
    return JSON.stringify((0, inquiryPanel_1.withHubNavigation)({ embed: embed.toJSON(), progressionCard: "xp", components: [
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${inquiryPanel_1.INQUIRY_IDS.open}xp:details`).setLabel("Detailed Breakdown").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON()
        ] }, "xp"));
}
async function progressionCardAttachment(kind, user, guild) {
    const state = (0, utils_1.ensureUser)(user.id);
    const preferences = (0, hubPreferences_1.normalizeHubPreferences)(state.preferences.hub);
    const snapshot = getProgressionCardSnapshot(kind, user, guild);
    return new discord_js_1.AttachmentBuilder(await (0, progressionCard_1.renderProgressionCard)({
        ...snapshot,
        stats: preferences.highlights === "none" ? [] : preferences.highlights === "primary" ? snapshot.stats.slice(0, 1) : snapshot.stats,
        ...(preferences.background !== "automatic" ? { background: preferences.background } : {}),
        ...(preferences.accent === "theme" ? { accent: `#${(0, profileHub_1.getThemeColor)(state.cosmetics).toString(16).padStart(6, "0")}` } : {})
    }), {
        name: `${kind}-profile.png`
    });
}
