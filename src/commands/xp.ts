import { CommandInteraction } from "discord.js";
import { getTokens, getXPLevel, getPoints, ensureUser } from "../utils";

export const execute = async (interaction: CommandInteraction) => {
    const userId = interaction.user.id;
    ensureUser(userId);

    const userTokens = getTokens(userId);
    const userXP = interaction.user.xp; // Assuming xp is stored in the user object
    const userLevel = getXPLevel(userXP);
    const userPoints = getPoints(userId);

    const responseEmbed = {
        color: 0x00ffea,
        title: "🛡️ Your XP and Tokens",
        description: `Here are your current stats:`,
        fields: [
            {
                name: "FN Token$ Balance",
                value: `**${userTokens}**`,
                inline: true
            },
            {
                name: "XP Level",
                value: `**${userLevel}**`,
                inline: true
            },
            {
                name: "Mod Points",
                value: `**${userPoints}**`,
                inline: true
            }
        ],
        footer: { text: "Keep grinding!" }
    };

    await interaction.reply({ embeds: [responseEmbed] });
};