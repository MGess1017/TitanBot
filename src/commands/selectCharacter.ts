import { CommandInteraction } from "discord.js";
import { ensureUser, savePoints, points } from "../utils";
import { characters } from "../game/characters";

export const selectCharacter = async (interaction: CommandInteraction) => {
    const userId = interaction.user.id;
    ensureUser(userId);

    const characterName = interaction.options.getString("character");
    const character = characters.find(c => c.name.toLowerCase() === characterName.toLowerCase());

    if (!character) {
        return interaction.reply(`Character "${characterName}" not found. Please select a valid character.`);
    }

    points[userId].selectedCharacter = characterName;
    savePoints();

    return interaction.reply(`You have successfully selected **${characterName}** as your PMC character!`);
};