import { CommandInteraction } from "discord.js";
import { points, ensureUser, getPoints } from "../utils"; // Assuming these functions are in utils.ts

export const pointsCommand = {
    name: "points",
    description: "Check mod points of yourself or another user.",
    options: [
        {
            name: "user",
            type: "USER",
            description: "User to check points for",
            required: false
        }
    ],
    async execute(interaction: CommandInteraction) {
        const targetUser = interaction.options.getUser("user") || interaction.user;
        ensureUser(targetUser.id);
        const userPoints = getPoints(targetUser.id);

        return interaction.reply(`${targetUser.username} has **${userPoints}** mod points.`);
    }
};