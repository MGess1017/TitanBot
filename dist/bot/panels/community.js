"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSelfRoleForGuild = resolveSelfRoleForGuild;
exports.upsertSelfRoleSelectorForGuild = upsertSelfRoleSelectorForGuild;
exports.ensureTemporaryVoicePanelForGuild = ensureTemporaryVoicePanelForGuild;
exports.cleanupEmptyTemporaryVoiceChannel = cleanupEmptyTemporaryVoiceChannel;
// Self-role selector and temporary voice panel.
const discord_js_1 = require("discord.js");
const config_1 = require("../core/config");
const store_1 = require("../moderation/store");
const embeds_1 = require("../ui/embeds");
async function resolveSelfRoleForGuild(guild, configuredRole, createIfMissing = false) {
    if (configuredRole.id) {
        return guild.roles.cache.get(configuredRole.id)
            || await guild.roles.fetch(configuredRole.id).catch(error => {
                console.warn(`[roleSelector] Could not fetch configured role ${configuredRole.id}:`, error);
                return null;
            });
    }
    if (!configuredRole.roleName)
        return null;
    let existing = guild.roles.cache.find(role => role.name.toLowerCase() === configuredRole.roleName?.toLowerCase()) || null;
    if (!existing) {
        const roles = await guild.roles.fetch().catch(error => {
            console.warn(`[roleSelector] Could not fetch roles for guild ${guild.id}:`, error);
            return null;
        });
        existing = roles?.find(role => role.name.toLowerCase() === configuredRole.roleName?.toLowerCase()) || null;
    }
    if (existing || !createIfMissing)
        return existing;
    return guild.roles.create({
        name: configuredRole.roleName,
        reason: "Provision self-selectable RuneScape 3 role"
    }).catch(error => {
        console.warn(`[roleSelector] Could not create role ${configuredRole.roleName} in guild ${guild.id}:`, error);
        return null;
    });
}
function buildSelfRoleSelectorPayload(resolvedRoles) {
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("Choose Your Roles")
        .setDescription("Select a role below to add it to your profile.")
        .addFields(resolvedRoles.map(({ configuredRole, role }) => ({
        name: configuredRole.label,
        value: `<@&${role.id}>`,
        inline: true
    }))), "Role Selector");
    const buttons = resolvedRoles.map(({ configuredRole }) => {
        const button = new discord_js_1.ButtonBuilder()
            .setCustomId(configuredRole.buttonId)
            .setLabel(configuredRole.label)
            .setStyle(configuredRole.style);
        if (configuredRole.emoji)
            button.setEmoji(configuredRole.emoji);
        return button;
    });
    return {
        embeds: [embed],
        components: [new discord_js_1.ActionRowBuilder().addComponents(buttons)],
        allowedMentions: { parse: [] }
    };
}
async function upsertSelfRoleSelectorForGuild(guild) {
    const channel = guild.channels.cache.get(config_1.ROLE_SELECTOR_CHANNEL_ID)
        || await guild.channels.fetch(config_1.ROLE_SELECTOR_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        console.warn(`Role selector skipped for guild ${guild.id}: configured channel is missing or is not a text channel.`);
        return;
    }
    const resolvedRoles = await Promise.all(config_1.SELF_ROLE_SELECTOR_ROLES.map(async (configuredRole) => ({
        configuredRole,
        role: await resolveSelfRoleForGuild(guild, configuredRole, true)
    })));
    if (resolvedRoles.some(entry => !entry.role)) {
        console.warn(`Role selector skipped for guild ${guild.id}: one or more configured roles could not be resolved.`);
        return;
    }
    const payload = buildSelfRoleSelectorPayload(resolvedRoles.filter((entry) => Boolean(entry.role)));
    const storedMessageId = (0, store_1.getGuildPanelMessageId)(guild.id, "roleSelector");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit(payload).catch(() => null);
        if (edited)
            return;
        (0, store_1.setGuildPanelMessageId)(guild.id, "roleSelector", null);
    }
    const sent = await channel.send(payload).catch(() => null);
    if (!sent) {
        console.warn(`Role selector could not be posted in channel ${config_1.ROLE_SELECTOR_CHANNEL_ID}; check bot permissions.`);
        return;
    }
    (0, store_1.setGuildPanelMessageId)(guild.id, "roleSelector", sent.id);
}
function buildTemporaryVoicePanelPayload() {
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x0f766e)
        .setTitle("Create Your VC")
        .setDescription("Create your room anytime. If disconnected, use the room link in the response to join; connected members are moved automatically. Empty rooms close automatically."), "Temporary Voice Access", "Private room controls");
    const button = new discord_js_1.ButtonBuilder()
        .setCustomId(config_1.TEMP_VOICE_PANEL_BUTTON_ID)
        .setLabel("Create my VC")
        .setEmoji("🔊")
        .setStyle(discord_js_1.ButtonStyle.Success);
    return {
        embeds: [embed],
        components: [new discord_js_1.ActionRowBuilder().addComponents(button)],
        allowedMentions: { parse: [] }
    };
}
async function ensureTemporaryVoicePanelForGuild(guild) {
    const category = guild.channels.cache.get(config_1.TEMP_VOICE_CATEGORY_ID)
        || await guild.channels.fetch(config_1.TEMP_VOICE_CATEGORY_ID).catch(() => null);
    if (!category || category.type !== discord_js_1.ChannelType.GuildCategory) {
        console.warn(`Temporary voice panel skipped for guild ${guild.id}: category ${config_1.TEMP_VOICE_CATEGORY_ID} was not found.`);
        return;
    }
    let panelChannel = guild.channels.cache.find(channel => channel.type === discord_js_1.ChannelType.GuildText
        && channel.parentId === category.id
        && channel.name === config_1.TEMP_VOICE_PANEL_CHANNEL_NAME) || null;
    if (!panelChannel) {
        panelChannel = await guild.channels.create({
            name: config_1.TEMP_VOICE_PANEL_CHANNEL_NAME,
            type: discord_js_1.ChannelType.GuildText,
            parent: category.id,
            topic: "Create a temporary voice room with the button below."
        }).catch(() => null);
    }
    if (!panelChannel || panelChannel.type !== discord_js_1.ChannelType.GuildText) {
        console.warn(`Temporary voice panel could not be created in category ${category.id}; check Manage Channels and channel permissions.`);
        return;
    }
    const payload = buildTemporaryVoicePanelPayload();
    const storedMessageId = (0, store_1.getGuildPanelMessageId)(guild.id, "voiceCreator");
    if (storedMessageId) {
        const stored = await panelChannel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit(payload).catch(() => null);
        if (edited)
            return;
        (0, store_1.setGuildPanelMessageId)(guild.id, "voiceCreator", null);
    }
    const sent = await panelChannel.send(payload).catch(() => null);
    if (!sent) {
        console.warn(`Temporary voice panel could not be posted in channel ${panelChannel.id}; check Send Messages and Embed Links.`);
        return;
    }
    (0, store_1.setGuildPanelMessageId)(guild.id, "voiceCreator", sent.id);
}
async function cleanupEmptyTemporaryVoiceChannel(guild, channelId) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    const hasOwnerMarker = Boolean(channel && (/^temp-vc-[a-z0-9-]+-\d{17,20}$/.test(channel.name)
        || /^temp-vc-\d{17,20}-[a-z0-9-]+$/.test(channel.name)));
    if (!channel
        || channel.type !== discord_js_1.ChannelType.GuildVoice
        || channel.parentId !== config_1.TEMP_VOICE_CATEGORY_ID
        || !hasOwnerMarker
        || channel.members.size > 0)
        return;
    await channel.delete("Temporary voice room is empty").catch(error => {
        console.warn(`[voice] Could not delete empty temporary channel ${channelId}:`, error);
    });
}
