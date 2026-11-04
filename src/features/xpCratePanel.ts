import path from "node:path";
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, DiscordAPIError,
    EmbedBuilder, type Message, type MessageCreateOptions, type MessageEditOptions, type TextChannel
} from "discord.js";
import { getXpCrateDefinition, XP_CRATE_COOLDOWN_MS, type XpCrateId, type XpCrateReward } from "../game/xpCrates";

export const XP_CRATE_BUTTON_ID = "fn_xp_crate:claim";
export const XP_CRATE_PANEL_TITLE = "FN Xp Panel";

export function xpCrateAttachment(id: XpCrateId): AttachmentBuilder {
    return new AttachmentBuilder(path.resolve(__dirname, `../../assets/xp-crates/${id}.png`), { name: `${id}.png` });
}

export function buildXpCratePanel() {
    return {
        embeds: [new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle(XP_CRATE_PANEL_TITLE)
            .setDescription("Claim 1 random XP crate every 24 hours. Opens instantly and appears in `/xp`.\n"
                + "10 colored crates: 0-100,000 XP. Super-rare Astral crate: **1,000,000 XP**.")
            .setFooter({ text: "100K: 0.01% per regular crate | Astral: 0.001% per claim" })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(XP_CRATE_BUTTON_ID).setLabel("Claim Daily XP Crate").setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: { parse: [] }
    } satisfies MessageCreateOptions & MessageEditOptions;
}

export function buildXpCrateRewardEmbed(reward: XpCrateReward): EmbedBuilder {
    const crate = getXpCrateDefinition(reward.crateId);
    return new EmbedBuilder()
        .setColor(crate.color)
        .setTitle(crate.name)
        .setDescription(`Opened instantly: **+${reward.xp.toLocaleString("en-US")} XP**\nYour reward is saved in \`/xp\`.`)
        .setImage(`attachment://${crate.id}.png`)
        .addFields({
            name: "Next crate",
            value: `<t:${Math.floor((reward.claimedAt + XP_CRATE_COOLDOWN_MS) / 1000)}:R>`
        });
}

export function addXpCrateProfile(embed: EmbedBuilder, reward: XpCrateReward | null, now = Date.now()): EmbedBuilder {
    if (!reward) {
        return embed.addFields({ name: "Daily XP Crate", value: "No crate claimed yet. Use the button in the FN Xp Panel.", inline: false });
    }
    const crate = getXpCrateDefinition(reward.crateId);
    const nextClaimAt = reward.claimedAt + XP_CRATE_COOLDOWN_MS;
    return embed
        .setImage(`attachment://${crate.id}.png`)
        .addFields({
            name: `Latest XP Crate: ${crate.name}`,
            value: `Reward: **+${reward.xp.toLocaleString("en-US")} XP** (already credited)\n`
                + `Claimed: <t:${Math.floor(reward.claimedAt / 1000)}:f>\n`
                + (now >= nextClaimAt ? "**Your next daily crate is ready!**" : `Next claim: <t:${Math.floor(nextClaimAt / 1000)}:R>`),
            inline: false
        });
}

function isCratePanel(message: Message, botId: string): boolean {
    return message.author.id === botId && message.embeds[0]?.title === XP_CRATE_PANEL_TITLE;
}

export async function upsertXpCratePanel(channel: TextChannel, botId: string, storedId: string | null): Promise<string> {
    const payload = buildXpCratePanel();
    if (storedId) {
        try {
            const message = await channel.messages.fetch(storedId);
            if (isCratePanel(message, botId)) {
                await message.edit(payload);
                return message.id;
            }
        } catch (error) {
            if (!(error instanceof DiscordAPIError && error.code === 10008)) throw error;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => isCratePanel(message, botId));
    if (existing) {
        await existing.edit(payload);
        return existing.id;
    }
    return (await channel.send(payload)).id;
}
