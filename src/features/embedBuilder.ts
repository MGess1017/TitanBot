import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder,
    MentionableSelectMenuBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";

export const STAFF_EMBED_PANEL_TITLE = "FNTCORD | Staff Embed Studio";
export const STAFF_EMBED_LEGACY_PANEL_TITLE = "FNT | Staff Embed Studio";
export const STAFF_EMBED_PREFIX = "staff_embed:";
export const STAFF_EMBED_COLORS = {
    Purple: 0x9b59b6, Blue: 0x3498db, Green: 0x2ecc71, Gold: 0xf1c40f,
    Orange: 0xe67e22, Red: 0xe74c3c, Teal: 0x1abc9c, White: 0xecf0f1, Midnight: 0x2c3e50
} as const;
export type StaffEmbedColor = keyof typeof STAFF_EMBED_COLORS;
export const STAFF_EMBED_TEMPLATES = {
    announcement: { title: "FNTCORD | Announcement", description: "Here's what's new in FNTCORD.\n\nAdd the details and next steps here.", color: "Purple" },
    event: { title: "FNTCORD | Community Event", description: "**When:** Add the date and timezone\n**Where:** Add the location\n\nDescribe the event and how to join.", color: "Gold" },
    maintenance: { title: "FNTCORD | Maintenance", description: "**Starts:** Add the date and timezone\n**Expected duration:** Add the duration\n**Affected services:** Add details\n\nWe'll share an update when service is restored.", color: "Orange" }
} satisfies Record<string, { title: string; description: string; color: StaffEmbedColor }>;
export type StaffEmbedDraft = {
    id: string;
    ownerId: string;
    guildId: string;
    expiresAt: number;
    channelId: string | null;
    color: StaffEmbedColor;
    userIds: string[];
    roleIds: string[];
    everyone: boolean;
    title: string;
    description: string;
    status: "editing" | "publishing" | "published" | "failed";
    pendingSchedule?: { runAt: number; timezone: string; confirmationId?: string };
};

export function parseStaffEmbedSchedule(input: string, timezone: string, now = Date.now()): { runAt: number; timezone: string } {
    timezone = timezone.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/.exec(input.trim());
    if (!match) throw new Error("Use YYYY-MM-DDTHH:mm with an explicit UTC offset, for example 2027-01-15T18:00-05:00.");
    const runAt = Date.parse(input.trim());
    if (!Number.isFinite(runAt) || runAt < now + 60_000 || runAt > now + 366 * 86400_000) {
        throw new Error("Choose a valid time at least one minute and at most one year in the future.");
    }
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit",
            day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(runAt);
    } catch { throw new Error("Enter a valid IANA timezone, for example America/New_York or UTC."); }
    const value = (type: string) => parts.find(part => part.type === type)?.value;
    if (["year", "month", "day", "hour", "minute", "second"].some((type, index) => value(type) !== (match[index + 1] || "00"))) {
        throw new Error("The time and UTC offset do not match that timezone (check daylight saving time).");
    }
    return { runAt, timezone };
}

export function formatStaffEmbedSchedule(schedule: { runAt: number; timezone: string }): string {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: schedule.timezone, dateStyle: "full", timeStyle: "long" }).format(schedule.runAt)} (${schedule.timezone}) / ${new Date(schedule.runAt).toISOString()} UTC`;
}

export function validateStaffEmbedText(title: string, description: string): { title: string; description: string } {
    const text = { title: title.trim(), description: description.trim() };
    if (!text.title || text.title.length > 256 || !text.description || text.description.length > 4000) {
        throw new Error("Provide a title (1-256 characters) and message (1-4000 characters).");
    }
    return text;
}

export function buildStaffEmbedMessage(draft: StaffEmbedDraft) {
    const text = validateStaffEmbedText(draft.title, draft.description);
    if (!draft.channelId) throw new Error("Choose a destination channel before publishing.");
    return {
        content: [...draft.userIds.map(id => `<@${id}>`), ...draft.roleIds.map(id => `<@&${id}>`), ...(draft.everyone ? ["@everyone"] : [])].join(" "),
        embeds: [new EmbedBuilder().setTitle(text.title).setDescription(text.description).setColor(STAFF_EMBED_COLORS[draft.color])],
        allowedMentions: { users: draft.userIds, roles: draft.roleIds, parse: draft.everyone ? ["everyone" as const] : [], repliedUser: false }
    };
}

export function buildStaffEmbedPanel() {
    return {
        embeds: [new EmbedBuilder().setColor(STAFF_EMBED_COLORS.Purple).setTitle(STAFF_EMBED_PANEL_TITLE)
            .setDescription("Create a polished FNTCORD announcement.\nOpen your private studio for templates, saved drafts, scheduling and publication history.")
            .setFooter({ text: "STAFF ONLY / PRIVATE PREVIEW / CONTROLLED MENTIONS" })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${STAFF_EMBED_PREFIX}start`).setLabel("Create Announcement").setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: { parse: [] as const }
    };
}

function buildStaffEmbedStudioMenu(draft: StaffEmbedDraft) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`${STAFF_EMBED_PREFIX}studio:${draft.id}`).setPlaceholder("Home, templates, drafts, scheduling & history")
        .addOptions(
            { label: "Home", value: "home" }, { label: "Back", value: "back" },
            { label: "Refresh", value: "refresh" }, { label: "Customize", value: "customize" },
            ...Object.entries(STAFF_EMBED_TEMPLATES).map(([key, template]) => ({ label: `Template: ${template.title}`, value: `template_${key}` })),
            { label: "Save draft", value: "save_draft" }, { label: "Load saved draft", value: "load_draft" },
            { label: "Schedule publication", value: "schedule" }, { label: "Publication history / cancel schedule", value: "history" }
        ));
}

export function buildStaffEmbedHome(draft: StaffEmbedDraft) {
    return {
        content: "",
        embeds: [new EmbedBuilder().setColor(STAFF_EMBED_COLORS.Purple).setTitle("FNTCORD | Private Staff Studio")
            .setDescription("**Customize** your announcement, reuse a template, or load a saved draft.\nSave named drafts privately across restarts. Publish now or confirm a timezone and schedule a future post.\nPublication history includes message links and explicit failure details.")
            .setFooter({ text: "PRIVATE / STAFF AUTHORIZATION & DESTINATION PERMISSIONS CHECKED AT PUBLICATION" })],
        components: [
            buildStaffEmbedBackRow(draft, "home"),
            buildStaffEmbedStudioMenu(draft)
        ],
        allowedMentions: { parse: [] as const }
    };
}

export function buildStaffEmbedBackRow(draft: StaffEmbedDraft, view = "editor") {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${STAFF_EMBED_PREFIX}home:${draft.id}`).setLabel("Home").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${STAFF_EMBED_PREFIX}back:${draft.id}`).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${STAFF_EMBED_PREFIX}${view === "home" ? "refresh_home" : "refresh"}:${draft.id}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${STAFF_EMBED_PREFIX}customize:${draft.id}`).setLabel("Customize").setStyle(ButtonStyle.Primary));
}

export function buildStaffEmbedEditor(draft: StaffEmbedDraft) {
    const id = (action: string) => `${STAFF_EMBED_PREFIX}${action}:${draft.id}`;
    const preview = new EmbedBuilder().setColor(STAFF_EMBED_COLORS[draft.color])
        .setTitle(draft.title || "Announcement Preview")
        .setDescription(draft.description || "Add a title and message to begin.")
        .setFooter({ text: `FNTCORD PRIVATE PREVIEW / ${draft.color} / Publish now or confirm a schedule` });
    const ready = Boolean(draft.channelId && draft.title && draft.description);
    return {
        content: `**Destination:** ${draft.channelId ? `<#${draft.channelId}>` : "Not selected"}\n**Mentions:** ${
            [...draft.userIds.map(user => `<@${user}>`), ...draft.roleIds.map(role => `<@&${role}>`), ...(draft.everyone ? ["@everyone"] : [])].join(" ") || "None"
        }`,
        embeds: [preview],
        components: [
            new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder()
                .setCustomId(id("channel")).setPlaceholder("Destination channel").setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setMinValues(1).setMaxValues(1)),
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
                .setCustomId(id("color")).setPlaceholder(`Color: ${draft.color}`)
                .addOptions(Object.keys(STAFF_EMBED_COLORS).map(color => ({ label: color, value: color, default: color === draft.color })))),
            new ActionRowBuilder<MentionableSelectMenuBuilder>().addComponents(new MentionableSelectMenuBuilder()
                .setCustomId(id("mentions")).setPlaceholder("Optional people or roles to notify").setMinValues(0).setMaxValues(5)),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(id("text")).setLabel("Edit Message").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(id("everyone")).setLabel(draft.everyone ? "@everyone: On" : "@everyone: Off").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(id("clear")).setLabel("Clear Mentions").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(id("publish")).setLabel("Publish").setStyle(ButtonStyle.Success).setDisabled(!ready),
                new ButtonBuilder().setCustomId(id("cancel")).setLabel("Cancel").setStyle(ButtonStyle.Danger)
            ),
            buildStaffEmbedStudioMenu(draft)
        ],
        allowedMentions: { parse: [] as const }
    };
}

export function buildStaffEmbedSaveModal(draft: StaffEmbedDraft): ModalBuilder {
    return new ModalBuilder().setCustomId(`${STAFF_EMBED_PREFIX}save_draft:${draft.id}`).setTitle("Save Private FNTCORD Draft")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
            .setCustomId("name").setLabel("Draft name (same name replaces saved draft)").setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)));
}

export function buildStaffEmbedScheduleModal(draft: StaffEmbedDraft): ModalBuilder {
    return new ModalBuilder().setCustomId(`${STAFF_EMBED_PREFIX}schedule:${draft.id}`).setTitle("Schedule FNTCORD Announcement")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("datetime")
                .setLabel("Date/time + offset: 2027-01-15T18:00-05:00").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("timezone")
                .setLabel("IANA timezone (e.g. America/New_York or UTC)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)));
}

export function buildStaffEmbedModal(draft: StaffEmbedDraft): ModalBuilder {
    const title = new TextInputBuilder().setCustomId("title").setLabel("Announcement title")
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256);
    const description = new TextInputBuilder().setCustomId("description").setLabel("Message")
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000);
    if (draft.title) title.setValue(draft.title);
    if (draft.description) description.setValue(draft.description);
    return new ModalBuilder().setCustomId(`${STAFF_EMBED_PREFIX}save:${draft.id}`).setTitle("Compose Announcement")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(title),
            new ActionRowBuilder<TextInputBuilder>().addComponents(description));
}
