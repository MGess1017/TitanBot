"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACHIEVEMENT_TITLE_BUTTON_ID = void 0;
exports.resolveEarnedAchievementTitle = resolveEarnedAchievementTitle;
exports.getEquippedAchievementTitle = getEquippedAchievementTitle;
exports.buildAchievementTitleModal = buildAchievementTitleModal;
const discord_js_1 = require("discord.js");
const achievements_1 = require("../game/achievements");
exports.ACHIEVEMENT_TITLE_BUTTON_ID = "achievement_title_equip";
const ALL_PROGRESS_ACHIEVEMENTS = [...achievements_1.XP_ACHIEVEMENTS, ...achievements_1.VOICE_ACHIEVEMENTS];
function resolveEarnedAchievementTitle(title, earnedIds) {
    const normalizedTitle = title.trim().toLowerCase();
    return ALL_PROGRESS_ACHIEVEMENTS.find(achievement => achievement.title.toLowerCase() === normalizedTitle && earnedIds.includes(achievement.id)) || null;
}
function getEquippedAchievementTitle(titleId, earnedIds) {
    return ALL_PROGRESS_ACHIEVEMENTS.find(achievement => achievement.id === titleId && earnedIds.includes(achievement.id)) || null;
}
function buildAchievementTitleModal(userId, earnedIds) {
    const earnedTitles = ALL_PROGRESS_ACHIEVEMENTS
        .filter(achievement => earnedIds.includes(achievement.id))
        .map(achievement => achievement.title);
    if (!earnedTitles.length)
        return null;
    return new discord_js_1.ModalBuilder()
        .setCustomId(`achievement_title_modal:${userId}`)
        .setTitle("Equip Achievement Title")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
        .setCustomId("title")
        .setLabel(`Earned: ${earnedTitles.slice(0, 3).join(", ")}`.slice(0, 45))
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(40)
        .setPlaceholder(earnedTitles[0].slice(0, 100))));
}
