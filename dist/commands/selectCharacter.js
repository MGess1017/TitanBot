"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectCharacter = void 0;
const utils_1 = require("../utils");
const characters_1 = require("../game/characters");
const selectCharacter = async (interaction) => {
    const userId = interaction.user.id;
    (0, utils_1.ensureUser)(userId);
    const characterName = interaction.options.getString("character");
    const character = characters_1.characters.find(c => c.name.toLowerCase() === characterName.toLowerCase());
    if (!character) {
        return interaction.reply(`Character "${characterName}" not found. Please select a valid character.`);
    }
    utils_1.points[userId].selectedCharacter = characterName;
    (0, utils_1.savePoints)();
    return interaction.reply(`You have successfully selected **${characterName}** as your PMC character!`);
};
exports.selectCharacter = selectCharacter;
