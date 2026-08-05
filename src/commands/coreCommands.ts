import type { ChatInputCommandInteraction } from "discord.js";
import { ensureUser, getBankTokens, getTokens } from "../utils";

export async function handleCoreCommand(name: string, interaction: ChatInputCommandInteraction): Promise<string> {
    switch (name) {
        case "balance": {
            const userId = interaction.user.id;
            ensureUser(userId);
            return `You have ${getTokens(userId)} FN Token$.`;
        }
        case "token": {
            const target = interaction.options.getUser("user") || interaction.user;
            ensureUser(target.id);
            return target.id === interaction.user.id
                ? `You have ${getTokens(target.id)} FN Token$.`
                : `${target.username} has ${getTokens(target.id)} FN Token$.`;
        }
        case "bank": {
            const target = interaction.options.getUser("user") || interaction.user;
            ensureUser(target.id);
            const wallet = getTokens(target.id);
            const bank = getBankTokens(target.id);
            const total = wallet + bank;
            return [
                `🏦 ${target.username} Banking`,
                `Wallet: ${wallet} FN Token$`,
                `Bank: ${bank} FN Token$`,
                `Net Worth: ${total} FN Token$`
            ].join("\n");
        }
        default:
            return "";
    }
}
