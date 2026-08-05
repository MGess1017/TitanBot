import { SlashCommandBuilder } from "discord.js";
import { getPoints, addPoints, ensureUser } from "../utils";

export const data = new SlashCommandBuilder()
    .setName("addpoints")
    .setDescription("Give mod points to a user")
    .addUserOption(option => 
        option.setName("user")
            .setDescription("The user to add points to")
            .setRequired(true))
    .addIntegerOption(option => 
        option.setName("amount")
            .setDescription("The amount of points to add")
            .setRequired(true));

export async function execute(interaction) {
    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");

    ensureUser(targetUser.id);
    ensureUser(interaction.user.id);

    if (amount <= 0) {
        return interaction.reply("You must add a positive amount of points.");
    }

    addPoints(targetUser.id, amount);
    return interaction.reply(`${targetUser.username} has been awarded **${amount}** mod points. They now have **${getPoints(targetUser.id)}** points.`);
}