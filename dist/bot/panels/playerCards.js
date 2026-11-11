"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeCheckpointPublicCard = removeCheckpointPublicCard;
exports.ensureCheckpointCardPanel = ensureCheckpointCardPanel;
exports.getCheckpointCardUrl = getCheckpointCardUrl;
exports.handleCheckpointInteraction = handleCheckpointInteraction;
// Arena Player Rating panel and cards.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const checkpointCard_1 = require("../../features/checkpointCard");
const checkpointRating_1 = require("../../game/checkpointRating");
const client_1 = require("../core/client");
const settings_1 = require("../core/settings");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const hubPreferences_1 = require("../../game/hubPreferences");
const inquiryPanel_1 = require("../../features/inquiryPanel");
const rateLimit_1 = require("../../runtime/rateLimit");
const config_1 = require("../core/config");
const checkpointCardQueues = new Map();
function queueCheckpointWork(userId, work) {
    const previous = checkpointCardQueues.get(userId) || Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tracked = run.finally(() => {
        if (checkpointCardQueues.get(userId) === tracked)
            checkpointCardQueues.delete(userId);
    });
    checkpointCardQueues.set(userId, tracked);
    return tracked;
}
/** Caller persists the visibility preference and cleared message IDs together. */
async function removeCheckpointPublicCard(userId) {
    await queueCheckpointWork(userId, async () => {
        const profile = (0, utils_1.ensureUser)(userId).checkpointProfile;
        if (!profile?.cardChannelId || !profile.cardMessageId)
            return;
        const channel = await client_1.client.channels.fetch(profile.cardChannelId);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
            throw new Error("Cannot remove your previous public card: its channel is unavailable.");
        try {
            const message = await channel.messages.fetch(profile.cardMessageId);
            if (message.author.id !== client_1.client.user?.id)
                throw new Error("Cannot remove a card not owned by this bot.");
            await message.delete();
        }
        catch (error) {
            if (!(error instanceof discord_js_1.DiscordAPIError && error.code === 10008))
                throw error;
        }
        profile.cardChannelId = null;
        profile.cardMessageId = null;
    });
}
async function getCheckpointCardChannel() {
    const channelId = settings_1.botSettingsStore.get().channels.checkpointCards;
    const channel = client_1.client.channels.cache.get(channelId) || await client_1.client.channels.fetch(channelId);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        throw new Error(`Player rating channel ${channelId} is missing or is not a text channel.`);
    }
    return channel;
}
async function ensureCheckpointCardPanel() {
    if (!client_1.client.isReady())
        return;
    const channel = await getCheckpointCardChannel();
    const previousId = (0, store_1.getGuildPanelMessageId)(channel.guild.id, "checkpointCard");
    const messageId = await (0, checkpointCard_1.upsertCheckpointPanel)(channel, client_1.client.user.id, previousId);
    if (previousId !== messageId)
        (0, store_1.setGuildPanelMessageId)(channel.guild.id, "checkpointCard", messageId);
}
async function fetchAvatarBuffer(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok)
            throw new Error(`Avatar HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
    }
    catch (error) {
        console.warn("[checkpointCard] Optional avatar unavailable:", error);
        return null;
    }
}
/** Renders and posts/edits the player's public card. Serialized per user so rapid edits cannot race. */
function publishCheckpointCard(discordUser) {
    return queueCheckpointWork(discordUser.id, async () => {
        if ((0, hubPreferences_1.normalizeHubPreferences)((0, utils_1.ensureUser)(discordUser.id).preferences.hub).cardVisibility === "private") {
            throw new Error("Your card is private. Use Refresh Card for a private preview.");
        }
        const profile = (0, utils_1.ensureUser)(discordUser.id).checkpointProfile;
        if (!profile || !profile.ingameName || !(0, checkpointRating_1.isCheckpointComplete)(profile.stats))
            throw new Error("Checkpoint profile is incomplete.");
        const stats = { ...profile.stats };
        const ingameName = profile.ingameName;
        const avatar = await fetchAvatarBuffer(discordUser.displayAvatarURL({ extension: "png", size: 128 }));
        const rendered = await (0, checkpointCard_1.renderCheckpointCard)({
            userId: discordUser.id, ingameName, stats, updatedAt: profile.updatedAt, avatar
        });
        if ((0, hubPreferences_1.normalizeHubPreferences)((0, utils_1.ensureUser)(discordUser.id).preferences.hub).cardVisibility === "private") {
            throw new Error("Your card was switched to private while rendering. Refresh for a private preview.");
        }
        const channel = await getCheckpointCardChannel();
        const storedId = profile.cardChannelId === channel.id ? profile.cardMessageId : null;
        const message = await (0, checkpointCard_1.upsertCheckpointCardMessage)(channel, storedId, (0, checkpointCard_1.buildCheckpointCardMessage)(discordUser.id, ingameName, rendered.rating, rendered.tier, rendered.buffer, profile.updatedAt));
        const latest = (0, utils_1.ensureUser)(discordUser.id).checkpointProfile;
        if (latest && (latest.cardMessageId !== message.id || latest.cardChannelId !== channel.id)) {
            latest.cardMessageId = message.id;
            latest.cardChannelId = channel.id;
            (0, utils_1.savePoints)();
        }
        return message.url;
    });
}
function getCheckpointCardUrl(profile, guildId) {
    if (!profile.cardChannelId || !profile.cardMessageId || !guildId)
        return null;
    return `https://discord.com/channels/${guildId}/${profile.cardChannelId}/${profile.cardMessageId}`;
}
async function finishCheckpointSave(interaction, savedLabel) {
    const profile = (0, utils_1.ensureUser)(interaction.user.id).checkpointProfile;
    const preferences = (0, hubPreferences_1.normalizeHubPreferences)((0, utils_1.ensureUser)(interaction.user.id).preferences.hub);
    const stats = profile?.stats || {};
    const ingameName = profile?.ingameName || null;
    const workspace = (0, inquiryPanel_1.withHubNavigation)((0, checkpointCard_1.buildCheckpointWorkspace)(profile, preferences.cardVisibility), "arena");
    if ((interaction.isButton() || interaction.isFromMessage()) && interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral))
        await interaction.deferUpdate();
    else
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
    if (!profile || !ingameName || !(0, checkpointRating_1.isCheckpointComplete)(stats)) {
        await interaction.editReply({
            content: `**${savedLabel}.** Finish the remaining setup steps.`,
            embeds: [workspace.embed], components: workspace.components, attachments: []
        });
        return;
    }
    try {
        if (preferences.cardVisibility === "private") {
            const rendered = await (0, checkpointCard_1.renderCheckpointCard)({
                userId: interaction.user.id, ingameName, stats, updatedAt: profile.updatedAt
            });
            const preview = (0, checkpointCard_1.buildCheckpointCardMessage)(interaction.user.id, ingameName, rendered.rating, rendered.tier, rendered.buffer, profile.updatedAt);
            await interaction.editReply({
                content: `**${savedLabel}.** Private preview / nothing posted publicly.`,
                embeds: preview.embeds, files: preview.files, components: workspace.components, attachments: [], allowedMentions: { parse: [] }
            });
            return;
        }
        const url = await publishCheckpointCard(interaction.user);
        await interaction.editReply({
            content: `**${savedLabel}.** [View your updated card](${url})`,
            embeds: [workspace.embed], components: workspace.components, attachments: [], allowedMentions: { parse: [] }
        });
    }
    catch (error) {
        console.error("[checkpointCard]", error);
        (0, audit_1.appendAuditEvent)("checkpoint_card_publish_failed", { userId: interaction.user.id, reason: (0, ops_1.toSafeString)(error) });
        await interaction.editReply({
            content: "Your info is saved, but the card could not be rendered or posted. Use Retry Publish (public) or Refresh Card (private).",
            embeds: [workspace.embed], components: workspace.components, attachments: [], allowedMentions: { parse: [] }
        });
    }
}
async function handleCheckpointInteraction(interaction) {
    const isCheckpointComponent = (interaction.isButton() || interaction.isModalSubmit())
        && (interaction.customId.startsWith(checkpointCard_1.CHECKPOINT_EDIT_PREFIX) || interaction.customId === checkpointCard_1.CHECKPOINT_VIEW_ID || interaction.customId.startsWith(checkpointCard_1.CHECKPOINT_MODAL_PREFIX)
            || [checkpointCard_1.CHECKPOINT_NAME_ID, checkpointCard_1.CHECKPOINT_NAME_MODAL_ID, checkpointCard_1.CHECKPOINT_WORKSPACE_ID, checkpointCard_1.CHECKPOINT_REFRESH_ID, checkpointCard_1.CHECKPOINT_RETRY_ID].includes(interaction.customId));
    if (!isCheckpointComponent)
        return false;
    const throttleError = (0, rateLimit_1.rejectIfRateLimited)(`checkpoint:${interaction.guildId || "dm"}:${interaction.user.id}`, config_1.COMMAND_RATE_LIMIT_WINDOW_MS);
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    if (isCheckpointComponent && !(0, settings_1.isFeatureEnabled)("checkpointCards")) {
        await interaction.reply({ content: "Player rating cards are paused by staff right now.", flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.isButton() && interaction.customId === checkpointCard_1.CHECKPOINT_WORKSPACE_ID) {
        const state = (0, utils_1.ensureUser)(interaction.user.id);
        const payload = (0, inquiryPanel_1.withHubNavigation)((0, checkpointCard_1.buildCheckpointWorkspace)(state.checkpointProfile, (0, hubPreferences_1.normalizeHubPreferences)(state.preferences.hub).cardVisibility), "arena");
        const reply = { content: "", embeds: [payload.embed], components: payload.components, attachments: [] };
        if (interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral))
            await interaction.update(reply);
        else
            await interaction.reply({ ...reply, flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.isButton() && [checkpointCard_1.CHECKPOINT_REFRESH_ID, checkpointCard_1.CHECKPOINT_RETRY_ID].includes(interaction.customId)) {
        await finishCheckpointSave(interaction, "Card refreshed");
        return true;
    }
    if (interaction.isButton() && interaction.customId === checkpointCard_1.CHECKPOINT_NAME_ID) {
        if (interaction.user.bot)
            return true;
        await interaction.showModal((0, checkpointCard_1.buildCheckpointNameModal)((0, utils_1.ensureUser)(interaction.user.id).checkpointProfile?.ingameName || null));
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId === checkpointCard_1.CHECKPOINT_NAME_MODAL_ID) {
        const parsed = (0, checkpointRating_1.parseIngameName)(interaction.fields.getTextInputValue(checkpointCard_1.CHECKPOINT_NAME_INPUT_ID));
        if (!parsed.ok) {
            await interaction.reply({ content: `**In-game name was not saved:** ${parsed.error}`, flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        const previous = user.checkpointProfile;
        user.checkpointProfile = {
            ingameName: parsed.value,
            stats: user.checkpointProfile?.stats || {},
            updatedAt: Date.now(),
            cardChannelId: user.checkpointProfile?.cardChannelId || null,
            cardMessageId: user.checkpointProfile?.cardMessageId || null
        };
        try {
            (0, utils_1.savePoints)();
        }
        catch (error) {
            user.checkpointProfile = previous;
            console.error("[checkpointCard] Name save failed:", error);
            await interaction.reply({ content: "Your name could not be saved. Please try again.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        (0, audit_1.appendAuditEvent)("checkpoint_name_saved", { userId: interaction.user.id });
        await finishCheckpointSave(interaction, "In-game name saved");
        return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(checkpointCard_1.CHECKPOINT_EDIT_PREFIX)) {
        const section = interaction.customId.slice(checkpointCard_1.CHECKPOINT_EDIT_PREFIX.length);
        if (!(0, checkpointRating_1.isCheckpointSectionId)(section) || interaction.user.bot)
            return true;
        const stats = (0, utils_1.ensureUser)(interaction.user.id).checkpointProfile?.stats || {};
        await interaction.showModal((0, checkpointCard_1.buildCheckpointModal)(section, stats));
        return true;
    }
    if (interaction.isButton() && interaction.customId === checkpointCard_1.CHECKPOINT_VIEW_ID) {
        const profile = (0, utils_1.ensureUser)(interaction.user.id).checkpointProfile;
        if (!profile || !profile.ingameName || !(0, checkpointRating_1.isCheckpointComplete)(profile.stats)) {
            const payload = (0, inquiryPanel_1.withHubNavigation)((0, checkpointCard_1.buildCheckpointWorkspace)(profile, (0, hubPreferences_1.normalizeHubPreferences)((0, utils_1.ensureUser)(interaction.user.id).preferences.hub).cardVisibility), "arena");
            if (interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral))
                await interaction.update({ embeds: [payload.embed], components: payload.components, attachments: [] });
            else
                await interaction.reply({ embeds: [payload.embed], components: payload.components, flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const workspace = (0, inquiryPanel_1.withHubNavigation)((0, checkpointCard_1.buildCheckpointWorkspace)(profile, (0, hubPreferences_1.normalizeHubPreferences)((0, utils_1.ensureUser)(interaction.user.id).preferences.hub).cardVisibility), "arena:details");
        const reply = { embeds: [(0, checkpointCard_1.buildCheckpointBreakdownEmbed)(profile.stats, getCheckpointCardUrl(profile, interaction.guildId), profile.updatedAt)], components: workspace.components, attachments: [] };
        if (interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral))
            await interaction.update(reply);
        else
            await interaction.reply({ ...reply, flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(checkpointCard_1.CHECKPOINT_MODAL_PREFIX)) {
        const section = interaction.customId.slice(checkpointCard_1.CHECKPOINT_MODAL_PREFIX.length);
        if (!(0, checkpointRating_1.isCheckpointSectionId)(section))
            return true;
        const errors = [];
        const updates = {};
        for (const key of checkpointRating_1.CHECKPOINT_SECTIONS[section].keys) {
            const parsed = (0, checkpointRating_1.parseCheckpointStat)(key, interaction.fields.getTextInputValue(key));
            if (parsed.ok)
                updates[key] = parsed.value;
            else
                errors.push(parsed.error);
        }
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        const merged = { ...(user.checkpointProfile?.stats || {}), ...updates };
        if (!errors.length)
            errors.push(...(0, checkpointRating_1.validateCheckpointStats)(merged));
        if (errors.length) {
            await interaction.reply({
                content: `**${checkpointRating_1.CHECKPOINT_SECTIONS[section].title} was not saved:**\n${errors.map(error => `• ${error}`).join("\n")}`,
                flags: discord_js_1.MessageFlags.Ephemeral
            });
            return true;
        }
        const previous = user.checkpointProfile;
        user.checkpointProfile = {
            ingameName: user.checkpointProfile?.ingameName || null,
            stats: merged,
            updatedAt: Date.now(),
            cardChannelId: user.checkpointProfile?.cardChannelId || null,
            cardMessageId: user.checkpointProfile?.cardMessageId || null
        };
        try {
            (0, utils_1.savePoints)();
        }
        catch (error) {
            user.checkpointProfile = previous;
            console.error("[checkpointCard] Stats save failed:", error);
            await interaction.reply({ content: "Your stats could not be saved. Please try again.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        (0, audit_1.appendAuditEvent)("checkpoint_stats_saved", { userId: interaction.user.id, section });
        await finishCheckpointSave(interaction, `${checkpointRating_1.CHECKPOINT_SECTIONS[section].title} saved`);
        return true;
    }
    return false;
}
