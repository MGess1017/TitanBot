"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProgressionCardSnapshot = getProgressionCardSnapshot;
exports.buildXpProfilePayload = buildXpProfilePayload;
exports.progressionCardAttachment = progressionCardAttachment;
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const xpCrates_1 = require("../../game/xpCrates");
const progressionCard_1 = require("../../features/progressionCard");
const engagement_1 = require("../xp/engagement");
const roles_1 = require("../xp/roles");
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
        .setTitle("XP Progress Center")
        .setDescription(`Level **${snapshot.level}** | **${state.xp.toLocaleString("en-US")} XP** | Voice **${snapshot.stats[0].value}**`)
        .setImage("attachment://xp-profile.png")
        .addFields({ name: "Rank", value: `${current?.name || "Unranked"}\n${next ? `${Math.max(0, next.xp - state.xp).toLocaleString("en-US")} XP to ${next.name}` : "Highest configured rank"}`, inline: true }, { name: "Daily Crate", value: `${crate ? `Latest: ${crate.crateId} (+${crate.xp.toLocaleString("en-US")} XP)\n` : "No crate claimed yet.\n"}${nextCrateAt > Date.now() ? `Next: <t:${Math.floor(nextCrateAt / 1000)}:R>` : "Ready to claim"}`, inline: true })
        .setFooter({ text: "Server XP and PMC raid XP are separate. More details in Profile." });
    return JSON.stringify({ embed: embed.toJSON(), progressionCard: "xp" });
}
async function progressionCardAttachment(kind, user, guild) {
    return new discord_js_1.AttachmentBuilder(await (0, progressionCard_1.renderProgressionCard)(getProgressionCardSnapshot(kind, user, guild)), {
        name: `${kind}-profile.png`
    });
}
