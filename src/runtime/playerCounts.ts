import { EmbedBuilder } from "discord.js";

export type PlayerCounts = {
    players: number;
    members: number;
};

export function countPlayers(isBotFlags: Iterable<boolean>): PlayerCounts {
    let players = 0;
    let members = 0;
    for (const isBot of isBotFlags) {
        members += 1;
        if (!isBot) players += 1;
    }
    return { players, members };
}

export function adjustPlayerCounts(counts: PlayerCounts, isBot: boolean, direction: 1 | -1): PlayerCounts {
    const members = Math.max(0, counts.members + direction);
    const players = Math.max(0, Math.min(members, counts.players + (isBot ? 0 : direction)));
    return { players, members };
}

export function buildPlayerCountEmbed(counts: PlayerCounts): EmbedBuilder {
    const players = Math.max(0, Math.floor(counts.players));
    const members = Math.max(players, Math.floor(counts.members));
    return new EmbedBuilder()
        .setColor(0x16a34a)
        .setTitle("FNT • Live Player Count")
        .setDescription("Current server population, refreshed as members join and leave.")
        .addFields(
            { name: "Players", value: players.toLocaleString(), inline: true },
            { name: "Total Members", value: members.toLocaleString(), inline: true },
            { name: "Bots", value: (members - players).toLocaleString(), inline: true }
        )
        .setFooter({ text: "Updated live" })
        .setTimestamp(new Date());
}