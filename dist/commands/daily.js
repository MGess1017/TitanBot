"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const economy_1 = require("../game/economy");
const utils_1 = require("../utils");
exports.data = {
    name: "daily",
    description: "Claim daily rewards including XP and FN Token$."
};
async function execute(interaction) {
    const userId = interaction.user.id;
    (0, utils_1.ensureUser)(userId);
    const canClaim = await (0, economy_1.claimDaily)(userId);
    if (!canClaim) {
        return interaction.reply("You have already claimed your daily rewards. Try again tomorrow.");
    }
    const { bonus, streak, tokenBonus } = canClaim;
    return interaction.reply(`You claimed **${bonus} XP** and **${tokenBonus} FN Token$**.\n🔥 Current streak: **${streak} days**.`);
}
