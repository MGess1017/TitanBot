"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = exports.execute = void 0;
const economy_1 = require("../game/economy");
const utils_1 = require("../utils");
const execute = async (interaction) => {
    const userId = interaction.user.id;
    (0, utils_1.ensureUser)(userId);
    const leaderboard = await (0, economy_1.getLeaderboard)();
    if (!leaderboard.length) {
        return interaction.reply("No XP data available yet.");
    }
    const leaderboardMessage = leaderboard.map((entry, index) => {
        return `**${index + 1}.** <@${entry.id}> — XP: ${entry.xp}, Prestige: ${entry.prestige}`;
    }).join("\n");
    return interaction.reply({
        embeds: [{
                color: 0x00ffea,
                title: "🏆 XP Leaderboard",
                description: leaderboardMessage,
                footer: { text: "Top users by XP and Prestige." }
            }]
    });
};
exports.execute = execute;
exports.data = {
    name: "leaderboard",
    description: "View the XP leaderboard",
};
