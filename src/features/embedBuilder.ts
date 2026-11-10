import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder,
    MentionableSelectMenuBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";

export const STAFF_EMBED_PANEL_TITLE = "FNT | Staff Embed Studio";
export const STAFF_EMBED_PREFIX = "staff_embed:";
export const STAFF_EMBED_COLORS = {
    Purple: 0x9b59b6, Blue: 0x3498db, Green: 0x2ecc71, Gold: 0xf1c40f,
    Orange: 0xe67e22, Red: 0xe74c3c, Teal: 0x1abc9c, White: 0xecf0f1, Midnight: 0x2c3e50
} as const;
export type StaffEmbedColor = keyof typeof STAFF_EMBED_COLORS;
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
};

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
            .setDescription("Create a polished announcement.\nChoose a channel, named color and optional mentions. Add your message, review it, then Publish.")
            .setFooter({ text: "STAFF ONLY / PRIVATE PREVIEW / CONTROLLED MENTIONS" })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${STAFF_EMBED_PREFIX}start`).setLabel("Create Announcement").setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: { parse: [] as const }
    };
}

export function buildStaffEmbedEditor(draft: StaffEmbedDraft) {
    const id = (action: string) => `${STAFF_EMBED_PREFIX}${action}:${draft.id}`;
    const preview = new EmbedBuilder().setColor(STAFF_EMBED_COLORS[draft.color])
        .setTitle(draft.title || "Announcement Preview")
        .setDescription(draft.description || "Add a title and message to begin.")
        .setFooter({ text: `PRIVATE PREVIEW / ${draft.color} / Nothing posts until Publish` });
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
            )
        ],
        allowedMentions: { parse: [] as const }
    };
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
