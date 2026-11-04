"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const checkpointCardQueues = new Map();
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
        return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    }
    catch {
        return null;
    }
}
/** Renders and posts/edits the player's public card. Serialized per user so rapid edits cannot race. */
function publishCheckpointCard(discordUser) {
    const previous = checkpointCardQueues.get(discordUser.id) || Promise.resolve();
    let resultUrl = "";
    const run = previous.catch(() => undefined).then(async () => {
        const profile = (0, utils_1.ensureUser)(discordUser.id).checkpointProfile;
        if (!profile || !profile.ingameName || !(0, checkpointRating_1.isCheckpointComplete)(profile.stats))
            throw new Error("Checkpoint profile is incomplete.");
        const stats = { ...profile.stats };
        const ingameName = profile.ingameName;
        const avatar = await fetchAvatarBuffer(discordUser.displayAvatarURL({ extension: "png", size: 128 }));
        const rendered = await (0, checkpointCard_1.renderCheckpointCard)({
            userId: discordUser.id, ingameName, stats, updatedAt: profile.updatedAt, avatar
        });
        const channel = await getCheckpointCardChannel();
        const storedId = profile.cardChannelId === channel.id ? profile.cardMessageId : null;
        const message = await (0, checkpointCard_1.upsertCheckpointCardMessage)(channel, storedId, (0, checkpointCard_1.buildCheckpointCardMessage)(discordUser.id, ingameName, rendered.rating, rendered.tier, rendered.buffer));
        const latest = (0, utils_1.ensureUser)(discordUser.id).checkpointProfile;
        if (latest && (latest.cardMessageId !== message.id || latest.cardChannelId !== channel.id)) {
            latest.cardMessageId = message.id;
            latest.cardChannelId = channel.id;
            (0, utils_1.savePoints)();
        }
        resultUrl = message.url;
    });
    const tracked = run.finally(() => {
        if (checkpointCardQueues.get(discordUser.id) === tracked)
            checkpointCardQueues.delete(discordUser.id);
    });
    checkpointCardQueues.set(discordUser.id, tracked);
    return tracked.then(() => resultUrl);
}
function getCheckpointCardUrl(profile, guildId) {
    if (!profile.cardChannelId || !profile.cardMessageId || !guildId)
        return null;
    return `https://discord.com/channels/${guildId}/${profile.cardChannelId}/${profile.cardMessageId}`;
}
async function finishCheckpointSave(interaction, savedLabel) {
    const profile = (0, utils_1.ensureUser)(interaction.user.id).checkpointProfile;
    const stats = profile?.stats || {};
    const ingameName = profile?.ingameName || null;
    if (!ingameName || !(0, checkpointRating_1.isCheckpointComplete)(stats)) {
        await interaction.reply({
            content: `**${savedLabel} saved.** Finish the remaining steps to generate your card:\n${(0, checkpointCard_1.describeCheckpointProgress)(stats, ingameName)}`,
            flags: discord_js_1.MessageFlags.Ephemeral
        });
        return;
    }
    await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
    try {
        const url = await publishCheckpointCard(interaction.user);
        await interaction.editReply({ embeds: [(0, checkpointCard_1.buildCheckpointBreakdownEmbed)(stats, url)] });
    }
    catch (error) {
        console.error("[checkpointCard]", error);
        (0, audit_1.appendAuditEvent)("checkpoint_card_publish_failed", { userId: interaction.user.id, reason: (0, ops_1.toSafeString)(error) });
        await interaction.editReply({ content: "Your info was saved, but the card could not be posted. Submit any section again to retry." });
    }
}
async function handleCheckpointInteraction(interaction) {
    const isCheckpointComponent = (interaction.isButton() || interaction.isModalSubmit())
        && (interaction.customId.startsWith(checkpointCard_1.CHECKPOINT_EDIT_PREFIX) || interaction.customId === checkpointCard_1.CHECKPOINT_VIEW_ID || interaction.customId.startsWith(checkpointCard_1.CHECKPOINT_MODAL_PREFIX)
            || interaction.customId === checkpointCard_1.CHECKPOINT_NAME_ID || interaction.customId === checkpointCard_1.CHECKPOINT_NAME_MODAL_ID);
    if (isCheckpointComponent && !(0, settings_1.isFeatureEnabled)("checkpointCards")) {
        await interaction.reply({ content: "Player rating cards are paused by staff right now.", flags: discord_js_1.MessageFlags.Ephemeral });
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
        user.checkpointProfile = {
            ingameName: parsed.value,
            stats: user.checkpointProfile?.stats || {},
            updatedAt: Date.now(),
            cardChannelId: user.checkpointProfile?.cardChannelId || null,
            cardMessageId: user.checkpointProfile?.cardMessageId || null
        };
        (0, utils_1.savePoints)();
        (0, audit_1.appendAuditEvent)("checkpoint_name_saved", { userId: interaction.user.id });
        await finishCheckpointSave(interaction, "In-game name");
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
            await interaction.reply({
                content: `Your card unlocks after your in-game name and all four sections are saved.\n${(0, checkpointCard_1.describeCheckpointProgress)(profile?.stats || {}, profile?.ingameName || null)}`,
                flags: discord_js_1.MessageFlags.Ephemeral
            });
            return true;
        }
        await interaction.reply({
            embeds: [(0, checkpointCard_1.buildCheckpointBreakdownEmbed)(profile.stats, getCheckpointCardUrl(profile, interaction.guildId))],
            flags: discord_js_1.MessageFlags.Ephemeral
        });
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
        user.checkpointProfile = {
            ingameName: user.checkpointProfile?.ingameName || null,
            stats: merged,
            updatedAt: Date.now(),
            cardChannelId: user.checkpointProfile?.cardChannelId || null,
            cardMessageId: user.checkpointProfile?.cardMessageId || null
        };
        (0, utils_1.savePoints)();
        (0, audit_1.appendAuditEvent)("checkpoint_stats_saved", { userId: interaction.user.id, section });
        await finishCheckpointSave(interaction, checkpointRating_1.CHECKPOINT_SECTIONS[section].title);
        return true;
    }
    return false;
}
