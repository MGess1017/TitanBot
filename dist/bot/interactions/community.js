"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCommunityInteraction = handleCommunityInteraction;
// Interaction handlers: help menu, achievement titles, self roles, temporary voice.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const achievementTitles_1 = require("../../features/achievementTitles");
const temporaryVoice_1 = require("../../features/temporaryVoice");
const config_1 = require("../core/config");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const guards_1 = require("../core/guards");
const ids_1 = require("../ui/ids");
const help_1 = require("../ui/help");
const embeds_1 = require("../ui/embeds");
/** Help menu, achievement titles, self roles, and temporary voice rooms. */
async function handleCommunityInteraction(interaction) {
    if (interaction.isButton() && interaction.customId === ids_1.ONBOARDING_IDS.start) {
        await interaction.reply({
            embeds: [(0, help_1.buildGettingStartedEmbed)()],
            allowedMentions: { parse: [] },
            flags: discord_js_1.MessageFlags.Ephemeral
        });
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.ONBOARDING_IDS.commands) {
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        const payload = await (0, help_1.buildHelpPayload)("general", interaction.guild);
        await interaction.editReply({
            embeds: [payload.embed],
            components: (0, help_1.helpDropdown)("general"),
            allowedMentions: { parse: [] }
        });
        return true;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === ids_1.HELP_IDS.menu) {
        const selected = interaction.values[0];
        const page = ["general", "xp", "raids", "shop", "games", "bank", "moderation"].includes(selected)
            ? selected
            : "general";
        const payload = await (0, help_1.buildHelpPayload)(page, interaction.guild);
        try {
            const embed = (0, embeds_1.embedFromPayload)("help", payload.embed, interaction.user);
            await interaction.update({ embeds: [embed], components: (0, help_1.helpDropdown)(page) });
        }
        catch (error) {
            if (!(0, guards_1.isUnknownInteractionError)(error)) {
                console.error("Help menu interaction failed:", error);
            }
        }
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("achievement_title_modal:")) {
        const [, ownerId, ...extra] = interaction.customId.split(":");
        if (extra.length || ownerId !== interaction.user.id) {
            await interaction.reply({ content: "This achievement-title form is invalid or expired.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        (0, utils_1.syncProgressAchievements)(interaction.user.id);
        const requestedTitle = interaction.fields.getTextInputValue("title").trim();
        if (requestedTitle.toLowerCase() === "none") {
            user.achievementTitleId = null;
            (0, utils_1.savePoints)();
            await interaction.reply({ content: "Your achievement title has been cleared.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const earnedTitle = (0, achievementTitles_1.resolveEarnedAchievementTitle)(requestedTitle, user.achievementIds);
        if (!earnedTitle) {
            await interaction.reply({ content: "Enter the exact title of an achievement you have earned, or enter `none` to clear it.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        user.achievementTitleId = earnedTitle.id;
        (0, utils_1.savePoints)();
        await interaction.reply({ content: `Equipped achievement title: **${earnedTitle.title}**.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${temporaryVoice_1.TEMP_VOICE_MODAL_PREFIX}:`)) {
        const parsed = (0, temporaryVoice_1.parseTemporaryVoiceModalId)(interaction.customId);
        const guild = interaction.guild;
        if (!parsed || !guild) {
            await interaction.reply({ content: "These voice-room controls are invalid or expired.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (interaction.user.id !== parsed.ownerId) {
            await interaction.reply({ content: "Only the current room owner can use these controls.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const room = await (0, temporaryVoice_1.fetchOwnedTemporaryVoiceRoom)(guild, parsed.channelId, parsed.ownerId, config_1.TEMP_VOICE_CATEGORY_ID);
        if (!room) {
            await interaction.reply({ content: "This room no longer belongs to you or has already closed.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ManageChannels)
            || !room.permissionsFor(botMember)?.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
            await interaction.reply({ content: "The bot needs Manage Channels permission for this room.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const value = interaction.fields.getTextInputValue("value").trim();
        if (parsed.action === "rename") {
            const name = (0, temporaryVoice_1.buildTemporaryVoiceRoomName)(value, parsed.ownerId);
            if (name === room.name) {
                await interaction.reply({ content: "That room name is already in use.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
                return true;
            }
            const renamed = await room.setName(name, `Room renamed by owner ${parsed.ownerId}`).then(() => true).catch(error => {
                console.warn(`[voice] Rename failed for room ${room.id}:`, (0, ops_1.toSafeString)(error));
                return false;
            });
            await interaction.reply({
                content: renamed ? `Room renamed to **${name}**.` : "Could not rename the room. Check Manage Channels permission.",
                flags: discord_js_1.MessageFlags.Ephemeral
            }).catch(() => undefined);
            return true;
        }
        if (parsed.action === "limit") {
            if (!/^\d{1,2}$/.test(value) || Number(value) > 99) {
                await interaction.reply({ content: "Enter a whole number from 0 to 99. Use 0 for no limit.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
                return true;
            }
            const userLimit = Number(value);
            const changed = await room.setUserLimit(userLimit, `Room limit changed by owner ${parsed.ownerId}`).then(() => true).catch(error => {
                console.warn(`[voice] User limit update failed for room ${room.id}:`, (0, ops_1.toSafeString)(error));
                return false;
            });
            await interaction.reply({
                content: changed ? `Room member limit set to ${userLimit || "unlimited"}.` : "Could not update the room limit. Check Manage Channels permission.",
                flags: discord_js_1.MessageFlags.Ephemeral
            }).catch(() => undefined);
            return true;
        }
        const mention = value.match(/^<@!?(\d{17,20})>$/);
        const newOwnerId = mention?.[1] || (/^\d{17,20}$/.test(value) ? value : null);
        if (!newOwnerId || newOwnerId === parsed.ownerId) {
            await interaction.reply({ content: "Enter another member's valid user ID or mention.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const newOwner = await guild.members.fetch(newOwnerId).catch(() => null);
        if (!newOwner || newOwner.user.bot) {
            await interaction.reply({ content: "The new owner must be a non-bot member of this server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const newOwnerAccess = await room.permissionOverwrites.edit(newOwner.id, {
            ViewChannel: true,
            Connect: true,
            Speak: true
        }, { reason: `Temporary room ownership transfer to ${newOwner.id}` }).then(() => true).catch(error => {
            console.warn(`[voice] Could not grant room access to transfer target ${newOwner.id}:`, (0, ops_1.toSafeString)(error));
            return false;
        });
        if (!newOwnerAccess) {
            await interaction.reply({ content: "Could not grant the new owner access. Check Manage Channels permission.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const oldName = room.name;
        const newName = (0, temporaryVoice_1.buildTemporaryVoiceRoomName)(newOwner.displayName, newOwner.id);
        const renamed = await room.setName(newName, `Temporary room ownership transferred to ${newOwner.id}`).then(() => true).catch(error => {
            console.warn(`[voice] Could not rename room ${room.id} during transfer:`, (0, ops_1.toSafeString)(error));
            return false;
        });
        if (!renamed) {
            await room.permissionOverwrites.delete(newOwner.id, "Ownership transfer rolled back").catch(() => undefined);
            await interaction.reply({ content: "Could not transfer ownership because the room could not be renamed.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (room.permissionOverwrites.cache.has(parsed.ownerId)) {
            await room.permissionOverwrites.delete(parsed.ownerId, `Room ownership transferred to ${newOwner.id}`).catch(error => {
                console.warn(`[voice] Could not remove prior owner access from room ${room.id}:`, (0, ops_1.toSafeString)(error));
                return null;
            });
        }
        (0, audit_1.appendAuditEvent)("temporary_voice_owner_transferred", { guildId: guild.id, channelId: room.id, previousOwnerId: parsed.ownerId, newOwnerId: newOwner.id, oldName });
        await interaction.reply({ content: `Room ownership transferred to <@${newOwner.id}>.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && config_1.SELF_ROLE_SELECTOR_ROLES.some(role => role.buttonId === interaction.customId)) {
        const guild = interaction.guild;
        const configuredRole = config_1.SELF_ROLE_SELECTOR_ROLES.find(role => role.buttonId === interaction.customId);
        if (!guild || !configuredRole) {
            await interaction.reply({ content: "This role selector is unavailable.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!member || !botMember) {
            await interaction.reply({ content: "Unable to verify your member roles right now. Please try again.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (member.roles.cache.has(configuredRole.id)) {
            await interaction.reply({ content: `You already have ${configuredRole.label}.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const role = guild.roles.cache.get(configuredRole.id) || await guild.roles.fetch(configuredRole.id).catch(() => null);
        if (!role) {
            await interaction.reply({ content: `${configuredRole.label} could not be found.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (role.managed || role.comparePositionTo(botMember.roles.highest) >= 0) {
            await interaction.reply({ content: `The bot cannot manage ${configuredRole.label}. Move its role above the selected role and grant Manage Roles.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const succeeded = await member.roles.add(role).then(() => true).catch(() => false);
        await interaction.reply({
            content: succeeded
                ? `${configuredRole.label} added.`
                : `Could not add ${configuredRole.label}. Check the bot's Manage Roles permission.`,
            flags: discord_js_1.MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === achievementTitles_1.ACHIEVEMENT_TITLE_BUTTON_ID) {
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        (0, utils_1.syncProgressAchievements)(interaction.user.id);
        const modal = (0, achievementTitles_1.buildAchievementTitleModal)(interaction.user.id, user.achievementIds);
        if (!modal) {
            await interaction.reply({ content: "Earn an XP or voice achievement before equipping a title.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.showModal(modal).catch(async () => {
            await interaction.reply({ content: "Could not open the title form. Please try again.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${temporaryVoice_1.TEMP_VOICE_CONTROL_PREFIX}:`)) {
        const parsed = (0, temporaryVoice_1.parseTemporaryVoiceControlId)(interaction.customId);
        const guild = interaction.guild;
        if (!parsed || !guild) {
            await interaction.reply({ content: "These voice-room controls are invalid or expired.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (interaction.user.id !== parsed.ownerId) {
            await interaction.reply({ content: "Only the current room owner can use these controls.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const room = await (0, temporaryVoice_1.fetchOwnedTemporaryVoiceRoom)(guild, parsed.channelId, parsed.ownerId, config_1.TEMP_VOICE_CATEGORY_ID);
        if (!room) {
            await interaction.reply({ content: "This room no longer belongs to you or has already closed.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ManageChannels)
            || !room.permissionsFor(botMember)?.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
            await interaction.reply({ content: "The bot needs Manage Channels permission for this room.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (parsed.action === "rename" || parsed.action === "limit" || parsed.action === "transfer") {
            await interaction.showModal((0, temporaryVoice_1.buildTemporaryVoiceModal)(parsed.action, room.id, parsed.ownerId)).catch(async () => {
                await interaction.reply({ content: "Could not open the room control form. Please try again.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            });
            return true;
        }
        const locked = parsed.action === "lock";
        const everyoneOverwrite = room.permissionOverwrites.cache.get(guild.roles.everyone.id);
        const wasLocked = Boolean(everyoneOverwrite?.deny.has(discord_js_1.PermissionFlagsBits.Connect));
        if (wasLocked === locked) {
            await interaction.reply({ content: `Your room is already ${locked ? "locked" : "unlocked"}.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const updated = await room.permissionOverwrites.edit(guild.roles.everyone.id, {
            ViewChannel: locked ? false : null,
            Connect: locked ? false : null
        }, { reason: `${locked ? "Lock" : "Unlock"} requested by room owner ${parsed.ownerId}` }).then(() => true).catch(error => {
            console.warn(`[voice] Could not ${locked ? "lock" : "unlock"} room ${room.id}:`, (0, ops_1.toSafeString)(error));
            return false;
        });
        if (!updated) {
            await interaction.reply({ content: `Could not ${locked ? "lock" : "unlock"} the room. Check Manage Channels permission.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.update({
            content: `Room ${locked ? "locked" : "unlocked"}: <#${room.id}>`,
            components: [(0, temporaryVoice_1.buildTemporaryVoiceControlRow)({ channelId: room.id, ownerId: parsed.ownerId, locked, userLimit: room.userLimit })]
        }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === config_1.TEMP_VOICE_PANEL_BUTTON_ID) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Temporary voice rooms are only available in a server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        if (!await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral }).then(() => true).catch(() => false))
            return true;
        const category = guild.channels.cache.get(config_1.TEMP_VOICE_CATEGORY_ID)
            || await guild.channels.fetch(config_1.TEMP_VOICE_CATEGORY_ID).catch(() => null);
        if (!category || category.type !== discord_js_1.ChannelType.GuildCategory) {
            await interaction.editReply("The temporary voice category is unavailable. Please notify a server administrator.").catch(() => undefined);
            return true;
        }
        const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
            await interaction.editReply("The bot needs Manage Channels permission to create your room.").catch(() => undefined);
            return true;
        }
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            await interaction.editReply("Unable to find your server member record. Please try again.").catch(() => undefined);
            return true;
        }
        const roomResult = await (0, temporaryVoice_1.findOrCreateTemporaryVoiceRoom)(guild, member, category.id);
        if ("error" in roomResult) {
            await interaction.editReply(roomResult.error).catch(() => undefined);
            return true;
        }
        const { room, created: createdRoom } = roomResult;
        if (!room.permissionsFor(botMember)?.has(discord_js_1.PermissionFlagsBits.MoveMembers)) {
            if (createdRoom)
                await room.delete("Bot cannot move the member into the temporary room").catch(() => undefined);
            await interaction.editReply("The bot needs Move Members permission in the temporary voice category to move you into the room.").catch(() => undefined);
            return true;
        }
        if (!room.permissionsFor(member)?.has(discord_js_1.PermissionFlagsBits.Connect)) {
            if (createdRoom)
                await room.delete("Member cannot connect to the temporary room").catch(() => undefined);
            await interaction.editReply("You do not have Connect permission for the temporary room. Check the category's voice permissions.").catch(() => undefined);
            return true;
        }
        const replyWithRoomControls = async (content) => {
            const everyoneOverwrite = room.permissionOverwrites.cache.get(guild.roles.everyone.id);
            await interaction.editReply({
                content,
                components: [(0, temporaryVoice_1.buildTemporaryVoiceControlRow)({
                        channelId: room.id,
                        ownerId: member.id,
                        locked: Boolean(everyoneOverwrite?.deny.has(discord_js_1.PermissionFlagsBits.Connect)),
                        userLimit: room.userLimit
                    })]
            }).catch(() => undefined);
        };
        const currentSourceChannelId = guild.voiceStates.cache.get(member.id)?.channelId || member.voice.channelId;
        if (!currentSourceChannelId) {
            await replyWithRoomControls(`Your room is ready: <#${room.id}>. Discord cannot connect a disconnected member automatically, so use the room link to join.`);
            return true;
        }
        if (currentSourceChannelId !== room.id) {
            const sourceChannel = guild.channels.cache.get(currentSourceChannelId)
                || await guild.channels.fetch(currentSourceChannelId).catch(() => null);
            if (!sourceChannel || !sourceChannel.isVoiceBased()) {
                await replyWithRoomControls(`Your room is ready: <#${room.id}>. Join any voice channel, then click Create my VC again to move in.`);
                return true;
            }
            if (!sourceChannel.permissionsFor(botMember)?.has(discord_js_1.PermissionFlagsBits.MoveMembers)) {
                await replyWithRoomControls(`Your room is ready: <#${room.id}>. The bot needs Move Members permission in your current voice channel to move you.`);
                return true;
            }
            const moveError = await member.voice.setChannel(room.id, "Moved into a temporary voice room").then(() => null).catch(error => error);
            if (moveError) {
                const code = typeof moveError === "object" && "code" in moveError ? String(moveError.code) : "unknown";
                (0, audit_1.appendAuditEvent)("temporary_voice_move_failed", { guildId: guild.id, userId: member.id, roomId: room.id, code });
                if (code === "40032") {
                    await replyWithRoomControls(`Your room is ready: <#${room.id}>. You disconnected before the move; use the room link to join.`);
                    return true;
                }
                console.warn(`[voice] Could not move member ${member.id} to temporary room ${room.id} (Discord ${code}):`, (0, ops_1.toSafeString)(moveError));
                await replyWithRoomControls(`Your room is ready: <#${room.id}>. Discord rejected the move; check Move Members in both voice channels and try again.`);
                return true;
            }
        }
        await replyWithRoomControls(`Your temporary room is ready: <#${room.id}>`);
        return true;
    }
    return false;
}
