"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCoreCommand = handleCoreCommand;
const utils_1 = require("../utils");
async function handleCoreCommand(name, interaction) {
    switch (name) {
        case "balance": {
            const userId = interaction.user.id;
            (0, utils_1.ensureUser)(userId);
            return `You have ${(0, utils_1.getTokens)(userId)} FN Token$.`;
        }
        case "token": {
            const target = interaction.options.getUser("user") || interaction.user;
            (0, utils_1.ensureUser)(target.id);
            return target.id === interaction.user.id
                ? `You have ${(0, utils_1.getTokens)(target.id)} FN Token$.`
                : `${target.username} has ${(0, utils_1.getTokens)(target.id)} FN Token$.`;
        }
        case "bank": {
            const target = interaction.options.getUser("user") || interaction.user;
            (0, utils_1.ensureUser)(target.id);
            const wallet = (0, utils_1.getTokens)(target.id);
            const bank = (0, utils_1.getBankTokens)(target.id);
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
