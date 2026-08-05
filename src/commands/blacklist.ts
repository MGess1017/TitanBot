import { SlashCommandBuilder } from "discord.js";
import fs from "fs-extra";

const blacklistFile = "./data/blacklist.json";

// Ensure the blacklist file exists
if (!fs.existsSync(blacklistFile)) {
    fs.writeJsonSync(blacklistFile, []);
}

let blacklist = fs.readJsonSync(blacklistFile);

function saveBlacklist() {
    fs.writeJsonSync(blacklistFile, blacklist, { spaces: 4 });
}

export const data = new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Manage the blacklist of users.")
    .addUserOption(option => option.setName("user").setDescription("User to blacklist or remove").setRequired(true))
    .addBooleanOption(option => option.setName("remove").setDescription("Remove user from blacklist"));

export async function execute(interaction) {
    const user = interaction.options.getUser("user");
    const remove = interaction.options.getBoolean("remove") || false;

    if (remove) {
        if (!blacklist.includes(user.id)) {
            return interaction.reply(`${user.username} is not in the blacklist.`);
        }
        blacklist = blacklist.filter(id => id !== user.id);
        saveBlacklist();
        return interaction.reply(`${user.username} has been removed from the blacklist.`);
    } else {
        if (blacklist.includes(user.id)) {
            return interaction.reply(`${user.username} is already in the blacklist.`);
        }
        blacklist.push(user.id);
        saveBlacklist();
        return interaction.reply(`${user.username} has been added to the blacklist.`);
    }
}