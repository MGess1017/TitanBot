"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const fs_extra_1 = __importDefault(require("fs-extra"));
const blacklistFile = "./data/blacklist.json";
// Ensure the blacklist file exists
if (!fs_extra_1.default.existsSync(blacklistFile)) {
    fs_extra_1.default.writeJsonSync(blacklistFile, []);
}
let blacklist = fs_extra_1.default.readJsonSync(blacklistFile);
function saveBlacklist() {
    fs_extra_1.default.writeJsonSync(blacklistFile, blacklist, { spaces: 4 });
}
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Manage the blacklist of users.")
    .addUserOption(option => option.setName("user").setDescription("User to blacklist or remove").setRequired(true))
    .addBooleanOption(option => option.setName("remove").setDescription("Remove user from blacklist"));
async function execute(interaction) {
    const user = interaction.options.getUser("user");
    const remove = interaction.options.getBoolean("remove") || false;
    if (remove) {
        if (!blacklist.includes(user.id)) {
            return interaction.reply(`${user.username} is not in the blacklist.`);
        }
        blacklist = blacklist.filter(id => id !== user.id);
        saveBlacklist();
        return interaction.reply(`${user.username} has been removed from the blacklist.`);
    }
    else {
        if (blacklist.includes(user.id)) {
            return interaction.reply(`${user.username} is already in the blacklist.`);
        }
        blacklist.push(user.id);
        saveBlacklist();
        return interaction.reply(`${user.username} has been added to the blacklist.`);
    }
}
