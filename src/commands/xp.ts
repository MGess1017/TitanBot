import { CommandInteraction } from "discord.js";
import { ensureUser, formatProgressPercent, getPoints, getTokens, getXPLevel, XP_LEVEL_THRESHOLDS, xpBar } from "../utils";

export const execute = async (interaction: CommandInteraction) => {
    const userId = interaction.user.id;
    const user = ensureUser(userId);

    const userTokens = getTokens(userId);
    const userXP = user.xp;
    const userLevel = getXPLevel(userXP);
    const userPoints = getPoints(userId);
    const currentThreshold = userLevel > 0 ? XP_LEVEL_THRESHOLDS[userLevel - 1] : 0;
    const nextThreshold = XP_LEVEL_THRESHOLDS[userLevel] ?? currentThreshold;
    const xpIntoLevel = Math.max(0, userXP - currentThreshold);
    const xpToNextLevel = nextThreshold > currentThreshold
        ? Math.max(0, nextThreshold - userXP)
        : 0;
    const levelSpan = Math.max(1, nextThreshold - currentThreshold);
    const progressPercent = nextThreshold > currentThreshold
        ? formatProgressPercent(xpIntoLevel / levelSpan)
        : "100%";
    const lastXpAt = user.lastXP > 0
        ? `<t:${Math.floor(user.lastXP / 1000)}:R>`
        : "No XP earned yet";
    const streakText = user.dailyStreak > 0 ? `${user.dailyStreak} day streak` : "No active streak";
    const achievements = user.achievements.length > 0
        ? user.achievements.slice(0, 4).join("\n")
        : "No achievements yet";

    const responseEmbed = {
        color: 0x00ffea,
        title: "📈 XP Progress Center",
        description: [
            `🧠 **Live XP:** ${userXP.toLocaleString()}`,
            `🎚️ **Level ${userLevel}**${nextThreshold > currentThreshold ? ` • ${xpToNextLevel.toLocaleString()} XP to level ${userLevel + 1}` : " • Level cap reached"}`,
            `${xpBar(userXP)}`
        ].join("\n"),
        thumbnail: {
            url: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c8.png"
        },
        fields: [
            {
                name: "💼 Economy",
                value: [
                    `🪙 FN Token$: **${userTokens.toLocaleString()}**`,
                    `🎯 Mod Points: **${userPoints.toLocaleString()}**`,
                    `🏅 Prestige: **${user.prestige.toLocaleString()}**`
                ].join("\n"),
                inline: true
            },
            {
                name: "🧭 Progress",
                value: [
                    `📍 In level: **${xpIntoLevel.toLocaleString()} / ${levelSpan.toLocaleString()} XP**`,
                    `📊 Completion: **${progressPercent}**`,
                    `⏱️ Last XP: **${lastXpAt}**`
                ].join("\n"),
                inline: true
            },
            {
                name: "🔥 Activity",
                value: [
                    `📆 ${streakText}`,
                    `🏆 Achievements: **${user.achievements.length}**`,
                    `📝 Use "/xpstats" for the legacy stat snapshot`
                ].join("\n"),
                inline: true
            },
            {
                name: "✨ Recent Unlocks",
                value: achievements,
                inline: false
            }
        ],
        footer: { text: "Live data is pulled from persisted XP state." }
    };

    await interaction.reply({ embeds: [responseEmbed] });
};