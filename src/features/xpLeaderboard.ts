import {
    ComponentType,
    ContainerBuilder,
    DiscordAPIError,
    escapeMarkdown,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder,
    type Message,
    type MessageEditOptions,
    type TextChannel
} from "discord.js";

export const XP_LEADERBOARD_CHANNEL_ID = "1527571592320651285";
const PANEL_HEADING = "## Live XP Leaderboard";

export type XpLeaderboardEntry = {
    id: string;
    username: string;
    xp: number;
    prestige: number;
    voiceMultiplier: 1 | 2;
};

export function buildXpLeaderboardPanel(entries: XpLeaderboardEntry[], now = Date.now()) {
    const rows = entries.slice(0, 10).map((entry, index) =>
        `**${index + 1}. ${escapeMarkdown(entry.username)}**\n`
        + `${entry.xp.toLocaleString("en-US")} XP | Prestige ${entry.prestige} | Voice ${entry.voiceMultiplier}x`
    );
    const panel = new ContainerBuilder()
        .setAccentColor(0xf59e0b)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${PANEL_HEADING}\nTop 10 engagement XP players`
        ))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            rows.join("\n\n") || "No XP earned yet. Chat or join a voice channel to get started."
        ))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            "### Voice XP Bonus\n100 XP/minute, then 200 XP/minute after 2 continuous hours.\n"
            + "Normal VC switches keep your bonus. Disconnecting or entering AFK resets it to 1x; earned XP stays.\n"
            + `-# Updates within 15 seconds | Updated <t:${Math.floor(now / 1000)}:T>`
        ));
    return {
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    } satisfies MessageEditOptions;
}

function isLeaderboardPanel(message: Message, botUserId: string): boolean {
    return message.author.id === botUserId && message.components.some(component =>
        component.type === ComponentType.Container && component.components.some(child =>
            child.type === ComponentType.TextDisplay && child.content.startsWith(PANEL_HEADING)
        )
    );
}

function isUnknownMessage(error: unknown): boolean {
    return error instanceof DiscordAPIError && error.code === 10008;
}

export async function upsertXpLeaderboardPanel(
    channel: TextChannel,
    botUserId: string,
    storedMessageId: string | null,
    entries: XpLeaderboardEntry[]
): Promise<string> {
    const payload = buildXpLeaderboardPanel(entries);
    if (storedMessageId) {
        try {
            const message = await channel.messages.fetch(storedMessageId);
            if (isLeaderboardPanel(message, botUserId)) {
                await message.edit(payload);
                return message.id;
            }
        } catch (error) {
            if (!isUnknownMessage(error)) throw error;
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
