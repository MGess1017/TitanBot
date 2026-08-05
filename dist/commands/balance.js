"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.balanceCommand = void 0;
const economy_1 = require("../game/economy");
exports.balanceCommand = {
    name: "balance",
    description: "Show your FN Token$ balance",
    async execute(interaction) {
        const userId = interaction.user.id;
        const balance = (0, economy_1.getTokens)(userId);
        return interaction.reply(`You have **${balance} FN Token$**.`);
    }
};
