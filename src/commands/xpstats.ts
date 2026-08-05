import { CommandInteraction } from "discord.js";
import { ensureUser, getXPLevel, XP_LEVEL_THRESHOLDS, xpBar } from "../utils";

export const xpStatsCommand = {
    name: "xpstats",
    description: "Show detailed XP statistics",
    async execute(interaction: CommandInteraction) {
        const userStats = ensureUser(interaction.user.id);
        const level = getXPLevel(userStats.xp);
        const currentThreshold = level > 0 ? XP_LEVEL_THRESHOLDS[level - 1] : 0;
        const nextThreshold = XP_LEVEL_THRESHOLDS[level] ?? currentThreshold;
        const levelSpan = Math.max(1, nextThreshold - currentThreshold);
        const xpIntoLevel = Math.max(0, userStats.xp - currentThreshold);
        const progressPercent = nextThreshold > currentThreshold
            ? Math.round((xpIntoLevel / levelSpan) * 100)
            : 100;
        const xpToNextLevel = nextThreshold > currentThreshold ? Math.max(0, nextThreshold - userStats.xp) : 0;
        const achievements = userStats.achievements.length > 0
            ? userStats.achievements.slice(0, 6).join("\n")
            : "No achievements yet";
        const lastXpAt = userStats.lastXP > 0
            ? `<t:${Math.floor(userStats.lastXP / 1000)}:R>`
            : "No XP earned yet";

        const responseEmbed = {
            color: 0x00ffea,
            title: "📊 XP Stats Snapshot",
            description: [
                `🧠 **Total XP:** ${userStats.xp.toLocaleString()}`,
                `🎚️ **Level ${level}**${nextThreshold > currentThreshold ? ` • ${xpToNextLevel.toLocaleString()} XP to next level` : " • Level cap reached"}`,
                `${xpBar(userStats.xp)}`
            ].join("\n"),
            thumbnail: {
                url: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4ca.png"
            },
            fields: [
                {
                    name: "🎯 Progress",
                    value: [
                        `In level: **${xpIntoLevel.toLocaleString()} / ${levelSpan.toLocaleString()} XP**`,
                        `Completion: **${progressPercent}%**`,
                        `Last XP: **${lastXpAt}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "🔥 Activity",
                    value: [
                        `📆 Daily streak: **${userStats.dailyStreak.toLocaleString()}**`,
                        `🏅 Prestige: **${userStats.prestige.toLocaleString()}**`,
                        `🏆 Achievements: **${userStats.achievements.length.toLocaleString()}**`
                    ].join("\n"),
                    inline: true
                },
                {
                    name: "✨ Unlocks",
                    value: achievements,
                    inline: false
                }
            ],
            footer: { text: "Live data is pulled from persisted XP state." }
        };

        return interaction.reply({ embeds: [responseEmbed] });
    },
};