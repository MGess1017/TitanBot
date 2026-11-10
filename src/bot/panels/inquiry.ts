import { ChannelType, DiscordAPIError, MessageFlags, type Guild, type Interaction } from "discord.js";
import {
    buildInquiryEntry, buildInquiryHome, buildInquiryIndex, buildInquiryModal, buildInquirySearch,
    INQUIRY_IDS, INQUIRY_TITLE, inquiryControls, type InquiryPayload
} from "../../features/inquiryPanel";
import { buildRs3ProfileEmbed, fetchRs3Profile } from "../../features/runescapeProfile";
import { COMMAND_RATE_LIMIT_WINDOW_MS, PLAYER_COUNT_CHANNEL_ID } from "../core/config";
import { rejectIfRateLimited } from "../../runtime/rateLimit";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { buildXpProfilePayload, progressionCardAttachment } from "../profile/cards";
import { buildProfilePayload } from "../profile/profile";
import { buildPmcProfilePayload } from "../raid/views";

export async function ensureInquiryPanelForGuild(guild: Guild): Promise<void> {
    const channel = guild.channels.cache.get(PLAYER_COUNT_CHANNEL_ID) || await guild.channels.fetch(PLAYER_COUNT_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`[inquiry] Channel ${PLAYER_COUNT_CHANNEL_ID} is missing or is not a text channel in guild ${guild.id}.`);
        return;
    }
    const { embed, components } = buildInquiryHome();
    const payload = { embeds: [embed], components, allowedMentions: { parse: [] as const } };
    const storedId = getGuildPanelMessageId(guild.id, "inquiry");
    if (storedId) {
        const stored = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof DiscordAPIError && error.code === 10008) return null;
            throw error;
        });
        if (stored && stored.author.id === guild.client.user.id && stored.embeds[0]?.title === INQUIRY_TITLE) {
            await stored.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === INQUIRY_TITLE);
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    setGuildPanelMessageId(guild.id, "inquiry", message.id);
}

export async function handleInquiryInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
        || !Object.values(INQUIRY_IDS).includes(interaction.customId)) return false;
    const throttleError = rejectIfRateLimited(
        `${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.customId}`,
        COMMAND_RATE_LIMIT_WINDOW_MS
    );
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: MessageFlags.Ephemeral });
        return true;
    }
    try {
        if (interaction.isButton()) {
            if (interaction.customId === INQUIRY_IDS.search || interaction.customId === INQUIRY_IDS.rs3) {
                await interaction.showModal(buildInquiryModal(interaction.customId === INQUIRY_IDS.rs3 ? "rs3" : "search"));
            } else {
                await interaction.reply({ content: "This control has expired. Use the inquiry panel.", flags: MessageFlags.Ephemeral });
            }
            return true;
        }
        if (interaction.isStringSelectMenu() && interaction.customId === INQUIRY_IDS.result
            && interaction.values[0] === "command:rs3") {
            await interaction.showModal(buildInquiryModal("rs3"));
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (interaction.isModalSubmit()) {
            const query = interaction.fields.getTextInputValue("query");
            const payload = interaction.customId === INQUIRY_IDS.rs3Modal
                ? { embed: buildRs3ProfileEmbed(await fetchRs3Profile(query)).toJSON(), components: inquiryControls() }
                : buildInquirySearch(query);
            await interaction.editReply({ embeds: [payload.embed], components: payload.components, allowedMentions: { parse: [] } });
            return true;
        }
        const selected = interaction.values[0].replace(/^command:(xp|pmc|profile)$/, "$1");
        if (selected === "profile") {
            const profile = buildProfilePayload(interaction.user, "overview", interaction.user.id, interaction.guild);
            await interaction.editReply({ embeds: [profile.embed], components: profile.components, allowedMentions: { parse: [] } });
            return true;
        }
        let payload: InquiryPayload;
        if (selected === "xp" || selected === "pmc") {
            payload = JSON.parse(selected === "xp"
                ? buildXpProfilePayload(interaction.user, interaction.guild)
                : buildPmcProfilePayload(interaction.user));
        } else {
            const entry = buildInquiryIndex().find(item => item.id === selected);
            if (!entry) throw new Error("This result is no longer available. Search again from the inquiry panel.");
            payload = buildInquiryEntry(entry);
        }
        await interaction.editReply({
            embeds: [payload.embed],
            components: payload.components || inquiryControls(),
            files: payload.progressionCard ? [await progressionCardAttachment(payload.progressionCard, interaction.user, interaction.guild)] : [],
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[inquiry] Interaction failed:", error);
        const content = `Inquiry failed: ${error instanceof Error ? error.message : "Please try again."}`.slice(0, 1800);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content, embeds: [], components: inquiryControls(), attachments: [], allowedMentions: { parse: [] } });
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
    }
    return true;
}
