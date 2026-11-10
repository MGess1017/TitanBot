"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureStaffEmbedPanelForGuild = ensureStaffEmbedPanelForGuild;
exports.handleStaffEmbedInteraction = handleStaffEmbedInteraction;
const node_crypto_1 = require("node:crypto");
const discord_js_1 = require("discord.js");
const embedBuilder_1 = require("../../features/embedBuilder");
const config_1 = require("../core/config");
const store_1 = require("../moderation/store");
const staffDesk_1 = require("../staff/staffDesk");
const audit_1 = require("../core/audit");
const staffEmbedDrafts = new Map();
const DRAFT_TTL_MS = 30 * 60 * 1000;
async function ensureStaffEmbedPanelForGuild(guild) {
    const channel = guild.channels.cache.get(config_1.STAFF_EMBED_CHANNEL_ID) || await guild.channels.fetch(config_1.STAFF_EMBED_CHANNEL_ID);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        console.warn(`[embedStudio] Channel ${config_1.STAFF_EMBED_CHANNEL_ID} is missing or not a text channel in guild ${guild.id}.`);
        return;
    }
    const payload = (0, embedBuilder_1.buildStaffEmbedPanel)();
    const storedId = (0, store_1.getGuildPanelMessageId)(guild.id, "staffEmbed");
    if (storedId) {
        const message = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof discord_js_1.DiscordAPIError && error.code === 10008)
                return null;
            throw error;
        });
        if (message?.author.id === guild.client.user.id && message.embeds[0]?.title === embedBuilder_1.STAFF_EMBED_PANEL_TITLE) {
            await message.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === embedBuilder_1.STAFF_EMBED_PANEL_TITLE);
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    (0, store_1.setGuildPanelMessageId)(guild.id, "staffEmbed", message.id);
}
async function handleStaffEmbedInteraction(interaction) {
    if (!(interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit())
        || !interaction.customId.startsWith(embedBuilder_1.STAFF_EMBED_PREFIX))
        return false;
    const guild = interaction.guild;
    try {
        const member = guild ? await guild.members.fetch(interaction.user.id) : null;
        if (!guild || !member || !(0, staffDesk_1.isStaffMember)(member)) {
            await interaction.reply({ content: "This announcement builder is for staff only.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        for (const [id, draft] of staffEmbedDrafts) {
            if (draft.expiresAt <= Date.now() && draft.status !== "publishing")
                staffEmbedDrafts.delete(id);
        }
        if (interaction.isButton() && interaction.customId === `${embedBuilder_1.STAFF_EMBED_PREFIX}start`) {
            if (staffEmbedDrafts.size >= 1000)
                throw new Error("The announcement builder is busy. Please try again later.");
            for (const [id, draft] of staffEmbedDrafts) {
                if (draft.ownerId === member.id && draft.guildId === guild.id && draft.status !== "publishing")
                    staffEmbedDrafts.delete(id);
            }
            const draft = {
                id: (0, node_crypto_1.randomUUID)(), ownerId: member.id, guildId: guild.id, expiresAt: Date.now() + DRAFT_TTL_MS,
                channelId: null, color: "Purple", userIds: [], roleIds: [], everyone: false, title: "", description: "", status: "editing"
            };
            staffEmbedDrafts.set(draft.id, draft);
            await interaction.reply({ ...(0, embedBuilder_1.buildStaffEmbedEditor)(draft), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const [action, id, ...extra] = interaction.customId.slice(embedBuilder_1.STAFF_EMBED_PREFIX.length).split(":");
        const draft = staffEmbedDrafts.get(id);
        if (extra.length || !draft || draft.ownerId !== member.id || draft.guildId !== guild.id || draft.status !== "editing") {
            throw new Error("This draft expired, belongs to another staff member, or has already been submitted. Start a new announcement.");
        }
        if (interaction.isButton() && action === "text") {
            await interaction.showModal((0, embedBuilder_1.buildStaffEmbedModal)(draft));
            return true;
        }
        if (interaction.isModalSubmit() && action === "save") {
            const text = (0, embedBuilder_1.validateStaffEmbedText)(interaction.fields.getTextInputValue("title"), interaction.fields.getTextInputValue("description"));
            draft.title = text.title;
            draft.description = text.description;
            if (interaction.isFromMessage())
                await interaction.update((0, embedBuilder_1.buildStaffEmbedEditor)(draft));
            else
                await interaction.reply({ ...(0, embedBuilder_1.buildStaffEmbedEditor)(draft), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        if (!interaction.isMessageComponent())
            throw new Error("This control is invalid. Reopen the builder.");
        if (interaction.isButton() && action === "publish") {
            const payload = (0, embedBuilder_1.buildStaffEmbedMessage)(draft);
            draft.status = "publishing";
            await interaction.deferUpdate();
            try {
                const channel = await guild.channels.fetch(draft.channelId);
                if (!channel || (channel.type !== discord_js_1.ChannelType.GuildText && channel.type !== discord_js_1.ChannelType.GuildAnnouncement)) {
                    throw new Error("Choose a server text or announcement channel.");
                }
                const botMember = await guild.members.fetchMe();
                const memberPermissions = channel.permissionsFor(member);
                const botPermissions = channel.permissionsFor(botMember);
                if (!memberPermissions?.has([discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages])) {
                    throw new Error("You need View Channel and Send Messages in the destination.");
                }
                if (!botPermissions?.has([discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.EmbedLinks])) {
                    throw new Error("The bot needs View Channel, Send Messages and Embed Links in the destination.");
                }
                const canMention = memberPermissions.has(discord_js_1.PermissionFlagsBits.MentionEveryone) && botPermissions.has(discord_js_1.PermissionFlagsBits.MentionEveryone);
                if (draft.everyone && !canMention)
                    throw new Error("Both you and the bot need Mention Everyone permission to use @everyone.");
                for (const roleId of draft.roleIds) {
                    const role = await guild.roles.fetch(roleId);
                    if (!role || role.id === guild.id || (!role.mentionable && !canMention)) {
                        throw new Error("A selected role cannot be notified. Remove it or check Mention Everyone permission.");
                    }
                }
                for (const userId of draft.userIds)
                    await guild.members.fetch(userId);
                const sent = await channel.send(payload);
                draft.status = "published";
                (0, audit_1.appendAuditEvent)("staff_embed_published", {
                    guildId: guild.id, actorId: member.id, channelId: channel.id, messageId: sent.id,
                    color: draft.color, userMentions: draft.userIds.length, roleMentions: draft.roleIds.length, everyone: draft.everyone
                });
                await interaction.editReply({ content: `Announcement posted: ${sent.url}`, embeds: [], components: [], allowedMentions: { parse: [] } });
            }
            catch (error) {
                if (draft.status !== "published")
                    draft.status = "failed";
                throw error;
            }
            return true;
        }
        if (interaction.isChannelSelectMenu() && action === "channel") {
            draft.channelId = interaction.values[0];
        }
        else if (interaction.isStringSelectMenu() && action === "color") {
            const color = interaction.values[0];
            if (!Object.prototype.hasOwnProperty.call(embedBuilder_1.STAFF_EMBED_COLORS, color))
                throw new Error("Choose a named color from the menu.");
            draft.color = color;
        }
        else if (interaction.isMentionableSelectMenu() && action === "mentions") {
            draft.userIds = [...interaction.users.keys()];
            draft.roleIds = [...interaction.roles.keys()];
        }
        else if (interaction.isButton() && action === "everyone") {
            if (!member.permissions.has(discord_js_1.PermissionFlagsBits.MentionEveryone))
                throw new Error("You need Mention Everyone permission to enable that notification.");
            draft.everyone = !draft.everyone;
        }
        else if (interaction.isButton() && action === "clear") {
            draft.userIds = [];
            draft.roleIds = [];
            draft.everyone = false;
        }
        else if (interaction.isButton() && action === "cancel") {
            staffEmbedDrafts.delete(draft.id);
            await interaction.update({ content: "Announcement canceled. Nothing was posted.", embeds: [], components: [] });
            return true;
        }
        else {
            throw new Error("This builder control is invalid. Start a new announcement.");
        }
        await interaction.update((0, embedBuilder_1.buildStaffEmbedEditor)(draft));
    }
    catch (error) {
        console.error("[embedStudio] Interaction failed:", error);
        const content = `Announcement builder: ${error instanceof Error ? error.message : "The request failed."}\nIf publishing failed, check the destination before starting a new announcement.`.slice(0, 1800);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content, embeds: [], components: [], allowedMentions: { parse: [] } });
        }
        else {
            await interaction.reply({ content, flags: discord_js_1.MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
    }
    return true;
}
