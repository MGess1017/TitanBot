"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countPlayers = countPlayers;
exports.adjustPlayerCounts = adjustPlayerCounts;
exports.buildPlayerCountEmbed = buildPlayerCountEmbed;
const discord_js_1 = require("discord.js");
function countPlayers(isBotFlags) {
    let players = 0;
    let members = 0;
    for (const isBot of isBotFlags) {
        members += 1;
        if (!isBot)
            players += 1;
    }
    return { players, members };
}
function adjustPlayerCounts(counts, isBot, direction) {
    const members = Math.max(0, counts.members + direction);
    const players = Math.max(0, Math.min(members, counts.players + (isBot ? 0 : direction)));
    return { players, members };
}
function buildPlayerCountEmbed(counts) {
    const players = Math.max(0, Math.floor(counts.players));
    const members = Math.max(players, Math.floor(counts.members));
    return new discord_js_1.EmbedBuilder()
        .setColor(0x16a34a)
        .setTitle("FNT • Live Player Count")
        .setDescription("Current server population, refreshed as members join and leave.")
        .addFields({ name: "Players", value: players.toLocaleString(), inline: true }, { name: "Total Members", value: members.toLocaleString(), inline: true }, { name: "Bots", value: (members - players).toLocaleString(), inline: true })
        .setFooter({ text: "Updated live" })
        .setTimestamp(new Date());
}
