"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execute = void 0;
const utils_1 = require("../utils");
const execute = async (interaction) => {
    const userId = interaction.user.id;
    (0, utils_1.ensureUser)(userId);
    const userTokens = (0, utils_1.getTokens)(userId);
    const userXP = interaction.user.xp; // Assuming xp is stored in the user object
    const userLevel = (0, utils_1.getXPLevel)(userXP);
    const userPoints = (0, utils_1.getPoints)(userId);
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
exports.execute = execute;
