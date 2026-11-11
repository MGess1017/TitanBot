"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAFF_EMBED_TEMPLATES = exports.STAFF_EMBED_COLORS = exports.STAFF_EMBED_PREFIX = exports.STAFF_EMBED_LEGACY_PANEL_TITLE = exports.STAFF_EMBED_PANEL_TITLE = void 0;
exports.parseStaffEmbedSchedule = parseStaffEmbedSchedule;
exports.formatStaffEmbedSchedule = formatStaffEmbedSchedule;
exports.validateStaffEmbedText = validateStaffEmbedText;
exports.buildStaffEmbedMessage = buildStaffEmbedMessage;
exports.buildStaffEmbedPanel = buildStaffEmbedPanel;
exports.buildStaffEmbedHome = buildStaffEmbedHome;
exports.buildStaffEmbedBackRow = buildStaffEmbedBackRow;
exports.buildStaffEmbedEditor = buildStaffEmbedEditor;
exports.buildStaffEmbedSaveModal = buildStaffEmbedSaveModal;
exports.buildStaffEmbedScheduleModal = buildStaffEmbedScheduleModal;
exports.buildStaffEmbedModal = buildStaffEmbedModal;
const discord_js_1 = require("discord.js");
exports.STAFF_EMBED_PANEL_TITLE = "FNTCORD | Staff Embed Studio";
exports.STAFF_EMBED_LEGACY_PANEL_TITLE = "FNT | Staff Embed Studio";
exports.STAFF_EMBED_PREFIX = "staff_embed:";
exports.STAFF_EMBED_COLORS = {
    Purple: 0x9b59b6, Blue: 0x3498db, Green: 0x2ecc71, Gold: 0xf1c40f,
    Orange: 0xe67e22, Red: 0xe74c3c, Teal: 0x1abc9c, White: 0xecf0f1, Midnight: 0x2c3e50
};
exports.STAFF_EMBED_TEMPLATES = {
    announcement: { title: "FNTCORD | Announcement", description: "Here's what's new in FNTCORD.\n\nAdd the details and next steps here.", color: "Purple" },
    event: { title: "FNTCORD | Community Event", description: "**When:** Add the date and timezone\n**Where:** Add the location\n\nDescribe the event and how to join.", color: "Gold" },
    maintenance: { title: "FNTCORD | Maintenance", description: "**Starts:** Add the date and timezone\n**Expected duration:** Add the duration\n**Affected services:** Add details\n\nWe'll share an update when service is restored.", color: "Orange" }
};
function parseStaffEmbedSchedule(input, timezone, now = Date.now()) {
    timezone = timezone.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/.exec(input.trim());
    if (!match)
        throw new Error("Use YYYY-MM-DDTHH:mm with an explicit UTC offset, for example 2027-01-15T18:00-05:00.");
    const runAt = Date.parse(input.trim());
    if (!Number.isFinite(runAt) || runAt < now + 60000 || runAt > now + 366 * 86400000) {
        throw new Error("Choose a valid time at least one minute and at most one year in the future.");
    }
    let parts;
    try {
        parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit",
            day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(runAt);
    }
    catch {
        throw new Error("Enter a valid IANA timezone, for example America/New_York or UTC.");
    }
    const value = (type) => parts.find(part => part.type === type)?.value;
    if (["year", "month", "day", "hour", "minute", "second"].some((type, index) => value(type) !== (match[index + 1] || "00"))) {
        throw new Error("The time and UTC offset do not match that timezone (check daylight saving time).");
    }
    return { runAt, timezone };
}
function formatStaffEmbedSchedule(schedule) {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: schedule.timezone, dateStyle: "full", timeStyle: "long" }).format(schedule.runAt)} (${schedule.timezone}) / ${new Date(schedule.runAt).toISOString()} UTC`;
}
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
                .setDescription("Create a polished FNTCORD announcement.\nOpen your private studio for templates, saved drafts, scheduling and publication history.")
                .setFooter({ text: "STAFF ONLY / PRIVATE PREVIEW / CONTROLLED MENTIONS" })],
        components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}start`).setLabel("Create Announcement").setStyle(discord_js_1.ButtonStyle.Primary))],
        allowedMentions: { parse: [] }
    };
}
function buildStaffEmbedStudioMenu(draft) {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(`${exports.STAFF_EMBED_PREFIX}studio:${draft.id}`).setPlaceholder("Home, templates, drafts, scheduling & history")
        .addOptions({ label: "Home", value: "home" }, { label: "Back", value: "back" }, { label: "Refresh", value: "refresh" }, { label: "Customize", value: "customize" }, ...Object.entries(exports.STAFF_EMBED_TEMPLATES).map(([key, template]) => ({ label: `Template: ${template.title}`, value: `template_${key}` })), { label: "Save draft", value: "save_draft" }, { label: "Load saved draft", value: "load_draft" }, { label: "Schedule publication", value: "schedule" }, { label: "Publication history / cancel schedule", value: "history" }));
}
function buildStaffEmbedHome(draft) {
    return {
        content: "",
        embeds: [new discord_js_1.EmbedBuilder().setColor(exports.STAFF_EMBED_COLORS.Purple).setTitle("FNTCORD | Private Staff Studio")
                .setDescription("**Customize** your announcement, reuse a template, or load a saved draft.\nSave named drafts privately across restarts. Publish now or confirm a timezone and schedule a future post.\nPublication history includes message links and explicit failure details.")
                .setFooter({ text: "PRIVATE / STAFF AUTHORIZATION & DESTINATION PERMISSIONS CHECKED AT PUBLICATION" })],
        components: [
            buildStaffEmbedBackRow(draft, "home"),
            buildStaffEmbedStudioMenu(draft)
        ],
        allowedMentions: { parse: [] }
    };
}
function buildStaffEmbedBackRow(draft, view = "editor") {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}home:${draft.id}`).setLabel("Home").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}back:${draft.id}`).setLabel("Back").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}${view === "home" ? "refresh_home" : "refresh"}:${draft.id}`).setLabel("Refresh").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}customize:${draft.id}`).setLabel("Customize").setStyle(discord_js_1.ButtonStyle.Primary));
}
function buildStaffEmbedEditor(draft) {
    const id = (action) => `${exports.STAFF_EMBED_PREFIX}${action}:${draft.id}`;
    const preview = new discord_js_1.EmbedBuilder().setColor(exports.STAFF_EMBED_COLORS[draft.color])
        .setTitle(draft.title || "Announcement Preview")
        .setDescription(draft.description || "Add a title and message to begin.")
        .setFooter({ text: `FNTCORD PRIVATE PREVIEW / ${draft.color} / Publish now or confirm a schedule` });
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
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(id("text")).setLabel("Edit Message").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(id("everyone")).setLabel(draft.everyone ? "@everyone: On" : "@everyone: Off").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(id("clear")).setLabel("Clear Mentions").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(id("publish")).setLabel("Publish").setStyle(discord_js_1.ButtonStyle.Success).setDisabled(!ready), new discord_js_1.ButtonBuilder().setCustomId(id("cancel")).setLabel("Cancel").setStyle(discord_js_1.ButtonStyle.Danger)),
            buildStaffEmbedStudioMenu(draft)
        ],
        allowedMentions: { parse: [] }
    };
}
function buildStaffEmbedSaveModal(draft) {
    return new discord_js_1.ModalBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}save_draft:${draft.id}`).setTitle("Save Private FNTCORD Draft")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
        .setCustomId("name").setLabel("Draft name (same name replaces saved draft)").setStyle(discord_js_1.TextInputStyle.Short).setMaxLength(80).setRequired(true)));
}
function buildStaffEmbedScheduleModal(draft) {
    return new discord_js_1.ModalBuilder().setCustomId(`${exports.STAFF_EMBED_PREFIX}schedule:${draft.id}`).setTitle("Schedule FNTCORD Announcement")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("datetime")
        .setLabel("Date/time + offset: 2027-01-15T18:00-05:00").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(32)), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("timezone")
        .setLabel("IANA timezone (e.g. America/New_York or UTC)").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(80)));
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
