"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMP_VOICE_MODAL_PREFIX = exports.TEMP_VOICE_CONTROL_PREFIX = exports.TEMP_VOICE_CHANNEL_PREFIX = void 0;
exports.buildTemporaryVoiceRoomName = buildTemporaryVoiceRoomName;
exports.getTemporaryVoiceOwnerId = getTemporaryVoiceOwnerId;
exports.fetchOwnedTemporaryVoiceRoom = fetchOwnedTemporaryVoiceRoom;
exports.findOrCreateTemporaryVoiceRoom = findOrCreateTemporaryVoiceRoom;
exports.buildTemporaryVoiceControlId = buildTemporaryVoiceControlId;
exports.parseTemporaryVoiceControlId = parseTemporaryVoiceControlId;
exports.buildTemporaryVoiceControlRow = buildTemporaryVoiceControlRow;
exports.buildTemporaryVoiceModal = buildTemporaryVoiceModal;
exports.parseTemporaryVoiceModalId = parseTemporaryVoiceModalId;
const discord_js_1 = require("discord.js");
exports.TEMP_VOICE_CHANNEL_PREFIX = "temp-vc-";
exports.TEMP_VOICE_CONTROL_PREFIX = "temporary_vc_control";
exports.TEMP_VOICE_MODAL_PREFIX = "temporary_vc_modal";
function buildTemporaryVoiceRoomName(displayName, ownerId) {
    const safeName = displayName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "member";
    return `${exports.TEMP_VOICE_CHANNEL_PREFIX}${safeName}-${ownerId}`.slice(0, 100);
}
function getTemporaryVoiceOwnerId(channelName) {
    const match = channelName.match(/^temp-vc-[a-z0-9-]+-(\d{17,20})$/);
    return match?.[1] || null;
}
async function fetchOwnedTemporaryVoiceRoom(guild, channelId, ownerId, categoryId) {
    if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(ownerId))
        return null;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildVoice || channel.parentId !== categoryId)
        return null;
    if (getTemporaryVoiceOwnerId(channel.name) !== ownerId)
        return null;
    return channel;
}
async function findOrCreateTemporaryVoiceRoom(guild, member, categoryId) {
    const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== discord_js_1.ChannelType.GuildCategory)
        return { error: "Temporary voice category is unavailable." };
    const existing = guild.channels.cache.find(channel => channel.type === discord_js_1.ChannelType.GuildVoice
        && channel.parentId === category.id
        && getTemporaryVoiceOwnerId(channel.name) === member.id);
    if (existing?.type === discord_js_1.ChannelType.GuildVoice)
        return { room: existing, created: false };
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
        return { error: "The bot needs Manage Channels permission to create your room." };
    }
    const created = await guild.channels.create({
        name: buildTemporaryVoiceRoomName(member.displayName, member.id),
        type: discord_js_1.ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.Connect] },
            { id: member.id, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.Connect, discord_js_1.PermissionFlagsBits.Speak] },
            { id: botMember.id, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.Connect, discord_js_1.PermissionFlagsBits.ManageChannels, discord_js_1.PermissionFlagsBits.MoveMembers] }
        ],
        reason: `Temporary voice room requested by ${member.user.tag}`
    }).catch(error => ({ error: error instanceof Error ? error.message : String(error) }));
    if ("error" in created || created.type !== discord_js_1.ChannelType.GuildVoice) {
        return { error: "Could not create your voice room. Check the bot's category permissions and try again." };
    }
    return { room: created, created: true };
}
function buildTemporaryVoiceControlId(action, channelId, ownerId) {
    return `${exports.TEMP_VOICE_CONTROL_PREFIX}:${action}:${channelId}:${ownerId}`;
}
function parseTemporaryVoiceControlId(customId) {
    const [prefix, action, channelId, ownerId, ...extra] = customId.split(":");
    if (prefix !== exports.TEMP_VOICE_CONTROL_PREFIX || extra.length || !["rename", "lock", "unlock", "limit", "transfer"].includes(action))
        return null;
    if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(ownerId))
        return null;
    return { action: action, channelId, ownerId };
}
function buildTemporaryVoiceControlRow(input) {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(buildTemporaryVoiceControlId("rename", input.channelId, input.ownerId))
        .setLabel("Rename")
        .setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder()
        .setCustomId(buildTemporaryVoiceControlId(input.locked ? "unlock" : "lock", input.channelId, input.ownerId))
        .setLabel(input.locked ? "Unlock" : "Lock")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(buildTemporaryVoiceControlId("limit", input.channelId, input.ownerId))
        .setLabel(input.userLimit ? `Limit: ${input.userLimit}` : "Set limit")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(buildTemporaryVoiceControlId("transfer", input.channelId, input.ownerId))
        .setLabel("Transfer")
        .setStyle(discord_js_1.ButtonStyle.Secondary));
}
function buildTemporaryVoiceModal(action, channelId, ownerId) {
    const isRename = action === "rename";
    const isLimit = action === "limit";
    const label = isRename ? "Room name" : isLimit ? "User limit (0 = unlimited)" : "New owner's user ID or mention";
    const placeholder = isRename ? "My squad room" : isLimit ? "5" : "123456789012345678 or <@id>";
    return new discord_js_1.ModalBuilder()
        .setCustomId(`${exports.TEMP_VOICE_MODAL_PREFIX}:${action}:${channelId}:${ownerId}`)
        .setTitle(isRename ? "Rename Voice Room" : isLimit ? "Set Voice Room Limit" : "Transfer Voice Room")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
        .setCustomId("value")
        .setLabel(label)
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(isRename ? 90 : 64)
        .setPlaceholder(placeholder)));
}
function parseTemporaryVoiceModalId(customId) {
    const [prefix, action, channelId, ownerId, ...extra] = customId.split(":");
    if (prefix !== exports.TEMP_VOICE_MODAL_PREFIX || extra.length || !["rename", "limit", "transfer"].includes(action))
        return null;
    if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(ownerId))
        return null;
    return { action: action, channelId, ownerId };
}
