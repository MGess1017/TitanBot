import { SlashCommandBuilder } from "discord.js";
import { getTokens, removeTokens, addTokens, ensureUser } from "../utils";
import { getRaidOutcome, getRaidRewards } from "../game/raid";

export const data = new SlashCommandBuilder()
    .setName("raid")
    .setDescription("Initiate a raid with your selected PMC character.");

export async function execute(interaction) {
    const userId = interaction.user.id;
    ensureUser(userId);

    const tokensRequired = 10; // Define the cost to initiate a raid
    if (!canAffordTokens(userId, tokensRequired)) {
        return interaction.reply(`You need at least ${tokensRequired} FN Token$ to initiate a raid.`);
    }

    removeTokens(userId, tokensRequired);

    const outcome = getRaidOutcome(userId);
    const rewards = getRaidRewards(outcome);

    addTokens(userId, rewards.tokens);
    // Optionally, you can add XP rewards here as well

    return interaction.reply(`You initiated a raid and ${outcome}. You received **${rewards.tokens} FN Token$** as a reward!`);
}