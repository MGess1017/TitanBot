import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { VOICE_ACHIEVEMENTS, XP_ACHIEVEMENTS, type ProgressAchievement } from "../game/achievements";

export const ACHIEVEMENT_TITLE_BUTTON_ID = "achievement_title_equip";

const ALL_PROGRESS_ACHIEVEMENTS = [...XP_ACHIEVEMENTS, ...VOICE_ACHIEVEMENTS];

export function resolveEarnedAchievementTitle(title: string, earnedIds: string[]): ProgressAchievement | null {
    const normalizedTitle = title.trim().toLowerCase();
    return ALL_PROGRESS_ACHIEVEMENTS.find(achievement =>
        achievement.title.toLowerCase() === normalizedTitle && earnedIds.includes(achievement.id)
    ) || null;
}

export function getEquippedAchievementTitle(titleId: string | null, earnedIds: string[]): ProgressAchievement | null {
    return ALL_PROGRESS_ACHIEVEMENTS.find(achievement =>
        achievement.id === titleId && earnedIds.includes(achievement.id)
    ) || null;
}

export function buildAchievementTitleModal(userId: string, earnedIds: string[]): ModalBuilder | null {
    const earnedTitles = ALL_PROGRESS_ACHIEVEMENTS
        .filter(achievement => earnedIds.includes(achievement.id))
        .map(achievement => achievement.title);
    if (!earnedTitles.length) return null;

    return new ModalBuilder()
        .setCustomId(`achievement_title_modal:${userId}`)
        .setTitle("Equip Achievement Title")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId("title")
                .setLabel(`Earned: ${earnedTitles.slice(0, 3).join(", ")}`.slice(0, 45))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(40)
                .setPlaceholder(earnedTitles[0].slice(0, 100))
        ));
}