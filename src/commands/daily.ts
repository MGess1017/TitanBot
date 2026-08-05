import { CommandInteraction } from "discord.js";
import { claimDaily } from "../game/economy";
import { ensureUser } from "../utils";

export const data = {
    name: "daily",
    description: "Claim daily rewards including XP and FN Token$."
};

export async function execute(interaction: CommandInteraction) {
    const userId = interaction.user.id;
    ensureUser(userId);

    const canClaim = await claimDaily(userId);
    if (!canClaim) {
        return interaction.reply("You have already claimed your daily rewards. Try again tomorrow.");
    }

    const { bonus, streak, tokenBonus } = canClaim;
    return interaction.reply(`You claimed **${bonus} XP** and **${tokenBonus} FN Token$**.\n🔥 Current streak: **${streak} days**.`);
}