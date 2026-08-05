"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const utils_1 = require("../utils");
const raid_1 = require("../game/raid");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName("raid")
    .setDescription("Initiate a raid with your selected PMC character.");
async function execute(interaction) {
    const userId = interaction.user.id;
    (0, utils_1.ensureUser)(userId);
    const tokensRequired = 10; // Define the cost to initiate a raid
    if (!canAffordTokens(userId, tokensRequired)) {
        return interaction.reply(`You need at least ${tokensRequired} FN Token$ to initiate a raid.`);
    }
    (0, utils_1.removeTokens)(userId, tokensRequired);
    const outcome = (0, raid_1.getRaidOutcome)(userId);
    const rewards = (0, raid_1.getRaidRewards)(outcome);
    (0, utils_1.addTokens)(userId, rewards.tokens);
    // Optionally, you can add XP rewards here as well
    return interaction.reply(`You initiated a raid and ${outcome}. You received **${rewards.tokens} FN Token$** as a reward!`);
}
