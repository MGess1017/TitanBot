import { CommandInteraction } from "discord.js";
import { getTokens, canAffordTokens, removeTokens, addTokens } from "../utils";
import { resolveCrash } from "../game/economy";

export const crashCommand = {
    name: "crash",
    description: "Play the crash game and cash out before the crash point.",
    options: [
        {
            name: "bet",
            type: "INTEGER",
            description: "Amount of FN Token$ to bet",
            required: true
        },
        {
            name: "target",
            type: "NUMBER",
            description: "Cash out multiplier (1.05 to 10.0)",
            required: true
        }
    ],
    async execute(interaction: CommandInteraction) {
        const bet = interaction.options.getInteger("bet");
        const target = interaction.options.getNumber("target");

        if (bet < 1) {
            return interaction.reply("Minimum bet is 1 FN Token$.");
        }

        if (!canAffordTokens(interaction.user.id, bet)) {
            return interaction.reply(`You need at least ${bet} FN Token$ to play.`);
        }

        if (target < 1.05 || target > 10) {
            return interaction.reply("Target multiplier must be between 1.05 and 10.0.");
        }

        const result = resolveCrash(bet, target);

        if (result.win) {
            addTokens(interaction.user.id, result.payout);
            return interaction.reply(`🚀 Crash multiplier hit **${result.crashPoint}x**\nSuccess! You cashed out at **${target}x** and won **${result.payout} FN Token$**.`);
        } else {
            removeTokens(interaction.user.id, bet);
            return interaction.reply(`💥 Crash at **${result.crashPoint}x**\nYou tried to cash out at **${target}x** and lost **${result.loss} FN Token$**.`);
        }
    }
};