import { CommandInteraction } from "discord.js";
import { getLeaderboard } from "../game/economy";
import { ensureUser } from "../utils";

export const execute = async (interaction: CommandInteraction) => {
    const userId = interaction.user.id;
    ensureUser(userId);

    const leaderboard = await getLeaderboard();
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

export const data = {
    name: "leaderboard",
    description: "View the XP leaderboard",
};