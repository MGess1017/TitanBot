"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureInquiryPanelForGuild = ensureInquiryPanelForGuild;
exports.handleInquiryInteraction = handleInquiryInteraction;
const discord_js_1 = require("discord.js");
const inquiryPanel_1 = require("../../features/inquiryPanel");
const runescapeProfile_1 = require("../../features/runescapeProfile");
const config_1 = require("../core/config");
const rateLimit_1 = require("../../runtime/rateLimit");
const store_1 = require("../moderation/store");
const cards_1 = require("../profile/cards");
const profile_1 = require("../profile/profile");
const views_1 = require("../raid/views");
async function ensureInquiryPanelForGuild(guild) {
    const channel = guild.channels.cache.get(config_1.PLAYER_COUNT_CHANNEL_ID) || await guild.channels.fetch(config_1.PLAYER_COUNT_CHANNEL_ID);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        console.warn(`[inquiry] Channel ${config_1.PLAYER_COUNT_CHANNEL_ID} is missing or is not a text channel in guild ${guild.id}.`);
        return;
    }
    const { embed, components } = (0, inquiryPanel_1.buildInquiryHome)();
    const payload = { embeds: [embed], components, allowedMentions: { parse: [] } };
    const storedId = (0, store_1.getGuildPanelMessageId)(guild.id, "inquiry");
    if (storedId) {
        const stored = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof discord_js_1.DiscordAPIError && error.code === 10008)
                return null;
            throw error;
        });
        if (stored && stored.author.id === guild.client.user.id && stored.embeds[0]?.title === inquiryPanel_1.INQUIRY_TITLE) {
            await stored.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === inquiryPanel_1.INQUIRY_TITLE);
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    (0, store_1.setGuildPanelMessageId)(guild.id, "inquiry", message.id);
}
async function handleInquiryInteraction(interaction) {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
        || !Object.values(inquiryPanel_1.INQUIRY_IDS).includes(interaction.customId))
        return false;
    const throttleError = (0, rateLimit_1.rejectIfRateLimited)(`${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.customId}`, config_1.COMMAND_RATE_LIMIT_WINDOW_MS);
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    try {
        if (interaction.isButton()) {
            if (interaction.customId === inquiryPanel_1.INQUIRY_IDS.search || interaction.customId === inquiryPanel_1.INQUIRY_IDS.rs3) {
                await interaction.showModal((0, inquiryPanel_1.buildInquiryModal)(interaction.customId === inquiryPanel_1.INQUIRY_IDS.rs3 ? "rs3" : "search"));
            }
            else {
                await interaction.reply({ content: "This control has expired. Use the inquiry panel.", flags: discord_js_1.MessageFlags.Ephemeral });
            }
            return true;
        }
        if (interaction.isStringSelectMenu() && interaction.customId === inquiryPanel_1.INQUIRY_IDS.result
            && interaction.values[0] === "command:rs3") {
            await interaction.showModal((0, inquiryPanel_1.buildInquiryModal)("rs3"));
            return true;
        }
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        if (interaction.isModalSubmit()) {
            const query = interaction.fields.getTextInputValue("query");
            const payload = interaction.customId === inquiryPanel_1.INQUIRY_IDS.rs3Modal
                ? { embed: (0, runescapeProfile_1.buildRs3ProfileEmbed)(await (0, runescapeProfile_1.fetchRs3Profile)(query)).toJSON(), components: (0, inquiryPanel_1.inquiryControls)() }
                : (0, inquiryPanel_1.buildInquirySearch)(query);
            await interaction.editReply({ embeds: [payload.embed], components: payload.components, allowedMentions: { parse: [] } });
            return true;
        }
        const selected = interaction.values[0].replace(/^command:(xp|pmc|profile)$/, "$1");
        if (selected === "profile") {
            const profile = (0, profile_1.buildProfilePayload)(interaction.user, "overview", interaction.user.id, interaction.guild);
            await interaction.editReply({ embeds: [profile.embed], components: profile.components, allowedMentions: { parse: [] } });
            return true;
        }
        let payload;
        if (selected === "xp" || selected === "pmc") {
            payload = JSON.parse(selected === "xp"
                ? (0, cards_1.buildXpProfilePayload)(interaction.user, interaction.guild)
                : (0, views_1.buildPmcProfilePayload)(interaction.user));
        }
        else {
            const entry = (0, inquiryPanel_1.buildInquiryIndex)().find(item => item.id === selected);
            if (!entry)
                throw new Error("This result is no longer available. Search again from the inquiry panel.");
            payload = (0, inquiryPanel_1.buildInquiryEntry)(entry);
        }
        await interaction.editReply({
            embeds: [payload.embed],
            components: payload.components || (0, inquiryPanel_1.inquiryControls)(),
            files: payload.progressionCard ? [await (0, cards_1.progressionCardAttachment)(payload.progressionCard, interaction.user, interaction.guild)] : [],
            allowedMentions: { parse: [] }
        });
    }
    catch (error) {
        console.error("[inquiry] Interaction failed:", error);
        const content = `Inquiry failed: ${error instanceof Error ? error.message : "Please try again."}`.slice(0, 1800);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content, embeds: [], components: (0, inquiryPanel_1.inquiryControls)(), attachments: [], allowedMentions: { parse: [] } });
        }
        else {
            await interaction.reply({ content, flags: discord_js_1.MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
    }
    return true;
}
