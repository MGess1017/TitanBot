"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.xpStatsCommand = void 0;
const points_json_1 = require("../data/points.json"); // Assuming points data is imported from points.json
const utils_1 = require("../utils"); // Assuming utility functions are imported from utils
exports.xpStatsCommand = {
    name: "xpstats",
    description: "Show detailed XP statistics",
    async execute(interaction) {
        const userId = interaction.user.id;
        const userStats = points_json_1.points[userId];
        if (!userStats) {
            return interaction.reply("You have no XP data. Please participate in activities to earn XP.");
        }
        const level = (0, utils_1.getXPLevel)(userStats.xp);
        const achievements = userStats.achievements.length > 0 ? userStats.achievements.join(", ") : "None yet";
        const responseEmbed = {
            color: 0x00ffea,
            title: "📊 Your XP Stats",
            description: `Daily streak: **${userStats.dailyStreak} days**\n` +
                `Achievements: ${achievements}\n` +
                `Total XP: **${userStats.xp}**\n` +
                `Level: **${level}**\n` +
                `${(0, utils_1.xpBar)(userStats.xp)}`,
        };
        return interaction.reply({ embeds: [responseEmbed] });
    },
};
