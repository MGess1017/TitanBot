import { CommandInteraction } from "discord.js";
import { points } from "../data/points.json"; // Assuming points data is imported from points.json
import { getXPLevel, xpBar } from "../utils"; // Assuming utility functions are imported from utils

export const xpStatsCommand = {
    name: "xpstats",
    description: "Show detailed XP statistics",
    async execute(interaction: CommandInteraction) {
        const userId = interaction.user.id;
        const userStats = points[userId];

        if (!userStats) {
            return interaction.reply("You have no XP data. Please participate in activities to earn XP.");
        }

        const level = getXPLevel(userStats.xp);
        const achievements = userStats.achievements.length > 0 ? userStats.achievements.join(", ") : "None yet";

        const responseEmbed = {
            color: 0x00ffea,
            title: "📊 Your XP Stats",
            description: `Daily streak: **${userStats.dailyStreak} days**\n` +
                         `Achievements: ${achievements}\n` +
                         `Total XP: **${userStats.xp}**\n` +
                         `Level: **${level}**\n` +
                         `${xpBar(userStats.xp)}`,
        };

        return interaction.reply({ embeds: [responseEmbed] });
    },
};