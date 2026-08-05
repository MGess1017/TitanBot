import { CommandInteraction } from "discord.js";
import { getTokens } from "../game/economy";

export const balanceCommand = {
    name: "balance",
    description: "Show your FN Token$ balance",
    async execute(interaction: CommandInteraction) {
        const userId = interaction.user.id;
        const balance = getTokens(userId);
        
        return interaction.reply(`You have **${balance} FN Token$**.`);
    }
};