"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAFF_EMBED_COLORS = exports.STAFF_EMBED_PREFIX = exports.STAFF_EMBED_PANEL_TITLE = void 0;
exports.validateStaffEmbedText = validateStaffEmbedText;
exports.buildStaffEmbedMessage = buildStaffEmbedMessage;
exports.buildStaffEmbedPanel = buildStaffEmbedPanel;
exports.buildStaffEmbedEditor = buildStaffEmbedEditor;
exports.buildStaffEmbedModal = buildStaffEmbedModal;
const discord_js_1 = require("discord.js");
exports.STAFF_EMBED_PANEL_TITLE = "FNT | Staff Embed Studio";
exports.STAFF_EMBED_PREFIX = "staff_embed:";
exports.STAFF_EMBED_COLORS = {
    Purple: 0x9b59b6, Blue: 0x3498db, Green: 0x2ecc71, Gold: 0xf1c40f,
    Orange: 0xe67e22, Red: 0xe74c3c, Teal: 0x1abc9c, White: 0xecf0f1, Midnight: 0x2c3e50
};
function validateStaffEmbedText(title, description) {
    const text = { title: title.trim(), description: description.trim() };
    if (!text.title || text.title.length > 256 || !text.description || text.description.length > 4000) {
        throw new Error("Provide a title (1-256 characters) and message (1-4000 characters).");
    }
    return text;
}
function buildStaffEmbedMessage(draft) {
    const text = validateStaffEmbedText(draft.title, draft.description);
    if (!draft.channelId)
        throw new Error("Choose a destination channel before publishing.");
    return {
        content: [...draft.userIds.map(id => `<@${id}>`), ...draft.roleIds.map(id => `<@&${id}>`), ...(draft.everyone ? ["@everyone"] : [])].join(" "),
        embeds: [new discord_js_1.EmbedBuilder().setTitle(text.title).setDescription(text.description).setColor(exports.STAFF_EMBED_COLORS[draft.color])],
        allowedMentions: { users: draft.userIds, roles: draft.roleIds, parse: draft.everyone ? ["everyone"] : [], repliedUser: false }
    };
}
function buildStaffEmbedPanel() {
    return {
        embeds: [new discord_js_1.EmbedBuilder().setColor(exports.STAFF_EMBED_COLORS.Purple).setTitle(exports.STAFF_EMBED_PANEL_TITLE)
                .setDescription("Create a polished announcement.\nChoose a channel, named color and optional mentions. Add your message, review it, then Publish.")
                .setFooter({ text: "STAFF ONLY / PRIVATE PREVIEW / CONTROLLED MENTIONS" })],
        components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}start`).setLabel("Create Announcement").setStyle(discord_js_1.ButtonStyle.Primary))],
        allowedMentions: { parse: [] }
    };
}
function buildStaffEmbedEditor(draft) {
    const id = (action) => `${exports.STAFF_EMBED_PREFIX}${action}:${draft.id}`;
    const preview = new discord_js_1.EmbedBuilder().setColor(exports.STAFF_EMBED_COLORS[draft.color])
        .setTitle(draft.title || "Announcement Preview")
        .setDescription(draft.description || "Add a title and message to begin.")
        .setFooter({ text: `PRIVATE PREVIEW / ${draft.color} / Nothing posts until Publish` });
    const ready = Boolean(draft.channelId && draft.title && draft.description);
    return {
        content: `**Destination:** ${draft.channelId ? `<#${draft.channelId}>` : "Not selected"}\n**Mentions:** ${[...draft.userIds.map(user => `<@${user}>`), ...draft.roleIds.map(role => `<@&${role}>`), ...(draft.everyone ? ["@everyone"] : [])].join(" ") || "None"}`,
        embeds: [preview],
        components: [
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ChannelSelectMenuBuilder()
                .setCustomId(id("channel")).setPlaceholder("Destination channel").setChannelTypes(discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement)
                .setMinValues(1).setMaxValues(1)),
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(id("color")).setPlaceholder(`Color: ${draft.color}`)
                .addOptions(Object.keys(exports.STAFF_EMBED_COLORS).map(color => ({ label: color, value: color, default: color === draft.color })))),
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.MentionableSelectMenuBuilder()
                .setCustomId(id("mentions")).setPlaceholder("Optional people or roles to notify").setMinValues(0).setMaxValues(5)),
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(id("text")).setLabel("Edit Message").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(id("everyone")).setLabel(draft.everyone ? "@everyone: On" : "@everyone: Off").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(id("clear")).setLabel("Clear Mentions").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(id("publish")).setLabel("Publish").setStyle(discord_js_1.ButtonStyle.Success).setDisabled(!ready), new discord_js_1.ButtonBuilder().setCustomId(id("cancel")).setLabel("Cancel").setStyle(discord_js_1.ButtonStyle.Danger))
        ],
        allowedMentions: { parse: [] }
    };
}
function buildStaffEmbedModal(draft) {
    const title = new discord_js_1.TextInputBuilder().setCustomId("title").setLabel("Announcement title")
        .setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(256);
    const description = new discord_js_1.TextInputBuilder().setCustomId("description").setLabel("Message")
        .setStyle(discord_js_1.TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000);
    if (draft.title)
        title.setValue(draft.title);
    if (draft.description)
        description.setValue(draft.description);
    return new discord_js_1.ModalBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}save:${draft.id}`).setTitle("Compose Announcement")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(title), new discord_js_1.ActionRowBuilder().addComponents(description));
}
