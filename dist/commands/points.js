"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pointsCommand = void 0;
const utils_1 = require("../utils"); // Assuming these functions are in utils.ts
exports.pointsCommand = {
    name: "points",
    description: "Check mod points of yourself or another user.",
    options: [
        {
            name: "user",
            type: "USER",
            description: "User to check points for",
            required: false
        }
    ],
    async execute(interaction) {
        const targetUser = interaction.options.getUser("user") || interaction.user;
        (0, utils_1.ensureUser)(targetUser.id);
        const userPoints = (0, utils_1.getPoints)(targetUser.id);
        return interaction.reply(`${targetUser.username} has **${userPoints}** mod points.`);
    }
};
