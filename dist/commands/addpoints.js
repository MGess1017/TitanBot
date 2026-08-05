"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const utils_1 = require("../utils");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName("addpoints")
    .setDescription("Give mod points to a user")
    .addUserOption(option => option.setName("user")
    .setDescription("The user to add points to")
    .setRequired(true))
    .addIntegerOption(option => option.setName("amount")
    .setDescription("The amount of points to add")
    .setRequired(true));
async function execute(interaction) {
    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    (0, utils_1.ensureUser)(targetUser.id);
    (0, utils_1.ensureUser)(interaction.user.id);
    if (amount <= 0) {
        return interaction.reply("You must add a positive amount of points.");
    }
    (0, utils_1.addPoints)(targetUser.id, amount);
    return interaction.reply(`${targetUser.username} has been awarded **${amount}** mod points. They now have **${(0, utils_1.getPoints)(targetUser.id)}** points.`);
}
