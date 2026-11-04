"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XP_LEADERBOARD_CHANNEL_ID = void 0;
exports.buildXpLeaderboardPanel = buildXpLeaderboardPanel;
exports.upsertXpLeaderboardPanel = upsertXpLeaderboardPanel;
const discord_js_1 = require("discord.js");
exports.XP_LEADERBOARD_CHANNEL_ID = "1527571592320651285";
const PANEL_HEADING = "## Live XP Leaderboard";
function buildXpLeaderboardPanel(entries, now = Date.now()) {
    const rows = entries.slice(0, 10).map((entry, index) => `### #${index + 1}  <@${entry.id}>\n`
        + `-# Username: ${(0, discord_js_1.escapeMarkdown)(entry.username)}\n`
        + `**XP** \`${entry.xp.toLocaleString("en-US")}\`  |  **Prestige** \`${entry.prestige}\`  |  **Voice XP** \`${entry.voiceMultiplier}x\``);
    const panel = new discord_js_1.ContainerBuilder()
        .setAccentColor(0x9b59b6)
        .addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(`${PANEL_HEADING}\nTop 10 engagement XP players`))
        .addSeparatorComponents(new discord_js_1.SeparatorBuilder());
    if (rows.length) {
        rows.forEach((row, index) => {
            if (index > 0)
                panel.addSeparatorComponents(new discord_js_1.SeparatorBuilder());
            panel.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(row));
        });
    }
    else {
        panel.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent("No XP earned yet. Chat or join a voice channel to get started."));
    }
    panel.addSeparatorComponents(new discord_js_1.SeparatorBuilder())
        .addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent("### Voice XP Bonus\n100 XP/minute, then 200 XP/minute after 2 continuous hours.\n"
        + "All VCs earn XP. Switching VCs keeps your bonus. Disconnecting from any VC resets it to 1x; earned XP stays.\n"
        + `-# Updates within 15 seconds | Updated <t:${Math.floor(now / 1000)}:T>`));
    return {
        components: [panel],
        flags: discord_js_1.MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    };
}
function isLeaderboardPanel(message, botUserId) {
    return message.author.id === botUserId && message.components.some(component => component.type === discord_js_1.ComponentType.Container && component.components.some(child => child.type === discord_js_1.ComponentType.TextDisplay && child.content.startsWith(PANEL_HEADING)));
}
function isUnknownMessage(error) {
    return error instanceof discord_js_1.DiscordAPIError && error.code === 10008;
}
async function upsertXpLeaderboardPanel(channel, botUserId, storedMessageId, entries) {
    const payload = buildXpLeaderboardPanel(entries);
    if (storedMessageId) {
        try {
            const message = await channel.messages.fetch(storedMessageId);
            if (isLeaderboardPanel(message, botUserId)) {
                await message.edit(payload);
                return message.id;
            }
        }
        catch (error) {
            if (!isUnknownMessage(error))
                throw error;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => isLeaderboardPanel(message, botUserId));
    if (existing) {
        await existing.edit(payload);
        return existing.id;
    }
    return (await channel.send(payload)).id;
}
