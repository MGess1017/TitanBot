import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder,
    StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";

export const LFG_PREFIX = "lfg:";
export const LFG_PANEL_TITLE = "FNTCORD | Looking for Group";
export const LFG_COLORS = {
    Purple: 0x9b59b6, Blue: 0x3498db, Green: 0x2ecc71, Gold: 0xf1c40f,
    Orange: 0xe67e22, Red: 0xe74c3c, Teal: 0x1abc9c, White: 0xecf0f1, Midnight: 0x2c3e50
} as const;
export type LfgColor = keyof typeof LFG_COLORS;
export type LfgVoicePreference = "any" | "required" | "not_required";
export type LfgStatus = "open" | "completed" | "canceled" | "expired";

export type LfgListing = {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string | null;
    hostId: string;
    game: string;
    maxPlayers: number;
    comments: string;
    platform: string;
    region: string;
    voicePreference: LfgVoicePreference;
    startsAt: number | null;
    expiresAt: number;
    color: LfgColor;
    playerIds: string[];
    status: LfgStatus;
    createdAt: number;
    revision: number;
    renderedRevision: number;
};

export type LfgRequestDetails = {
    game: string;
    maxPlayers: number;
    comments: string;
    platform: string;
    region: string;
};

export const LFG_DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
export const LFG_SCHEDULE_MAX_MS = 14 * 24 * 60 * 60 * 1000;

export function validateLfgRequest(
    game: string, playerCount: string, comments: string, platform = "", region = ""
): LfgRequestDetails {
    const cleanGame = game.trim();
    const cleanComments = comments.trim();
    const cleanPlatform = platform.trim();
    const cleanRegion = region.trim();
    const maxPlayers = Number(playerCount.trim());
    if (!cleanGame || cleanGame.length > 80) throw new Error("Enter a game name (1-80 characters).");
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 20) {
        throw new Error("Player count must be a whole number from 2 to 20, including you as the host.");
    }
    if (cleanComments.length > 500) throw new Error("Comments must be 500 characters or fewer.");
    if (cleanPlatform.length > 60) throw new Error("Platform must be 60 characters or fewer.");
    if (cleanRegion.length > 60) throw new Error("Region must be 60 characters or fewer.");
    return { game: cleanGame, maxPlayers, comments: cleanComments, platform: cleanPlatform, region: cleanRegion };
}

export function parseLfgStartTime(input: string, now = Date.now()): number | null {
    const value = input.trim();
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match) throw new Error("Use YYYY-MM-DDTHH:mm with an explicit UTC offset, such as 2027-01-15T18:00-05:00. Leave blank for starting now.");
    const [, year, month, day, hour, minute, second = "00", zone, sign, offsetHour, offsetMinute] = match;
    const numeric = [month, day, hour, minute, second].map(Number);
    if (numeric[0] < 1 || numeric[0] > 12 || numeric[1] < 1 || numeric[1] > 31
        || numeric[2] > 23 || numeric[3] > 59 || numeric[4] > 59
        || (zone !== "Z" && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) {
        throw new Error("Enter a valid calendar date and time.");
    }
    const startsAt = Date.parse(value);
    if (!Number.isFinite(startsAt)) throw new Error("Enter a valid calendar date and time.");
    const offset = zone === "Z" ? 0 : (sign === "+" ? 1 : -1) * (Number(offsetHour) * 60 + Number(offsetMinute));
    const local = new Date(startsAt + offset * 60_000);
    if ([local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()]
        .some((part, index) => part !== Number([year, month, day, hour, minute, second][index]))) {
        throw new Error("Enter a valid calendar date and time.");
    }
    if (startsAt < now + 5 * 60_000 || startsAt > now + LFG_SCHEDULE_MAX_MS) {
        throw new Error("Choose a start time at least 5 minutes from now and no more than 14 days away.");
    }
    return startsAt;
}

export function lfgExpiration(createdAt: number, startsAt: number | null): number {
    return startsAt === null ? createdAt + LFG_DEFAULT_TTL_MS : startsAt + 2 * 60 * 60 * 1000;
}

export function buildLfgPanel() {
    return {
        embeds: [new EmbedBuilder().setColor(LFG_COLORS.Purple).setTitle(LFG_PANEL_TITLE)
            .setDescription("Looking for teammates? Start a group request with your game, party size, platform, region, voice preference, optional start time, notes, and preferred embed color. Your post will appear in the Looking for Group channel.")
            .setFooter({ text: "OPEN A PRIVATE BUILDER / MANAGE YOUR LISTING FROM ITS POST" })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${LFG_PREFIX}open`).setLabel("Create LFG Request").setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: { parse: [] as const }
    };
}

export type LfgSetup = {
    id: string;
    game: string;
    playerCount: string;
    comments: string;
    platform: string;
    region: string;
    voicePreference: LfgVoicePreference;
    startsAt: number | null;
    color: LfgColor;
    isEditing: boolean;
};

export function buildLfgSetup(session: LfgSetup) {
    const details = validateLfgRequest(
        session.game || "Game", session.playerCount || "2", session.comments, session.platform, session.region
    );
    const game = session.game ? details.game : "Not set";
    const start = session.startsAt === null ? "Starting now" : `<t:${Math.floor(session.startsAt / 1000)}:F>`;
    const voice = session.voicePreference === "any" ? "No preference"
        : session.voicePreference === "required" ? "Required" : "Not required";
    return {
        embeds: [new EmbedBuilder().setColor(LFG_COLORS[session.color])
            .setTitle(session.isEditing ? "Edit your group request" : "Create a group request")
            .setDescription([
                `**Game:** ${game}`,
                `**Total players:** ${session.playerCount || "Not set"} (including host)`,
                `**Platform:** ${session.platform.trim() || "Any"}`,
                `**Region:** ${session.region.trim() || "Any"}`,
                `**Voice chat:** ${voice}`,
                `**Starts:** ${start}`,
                `**Embed color:** ${session.color}`,
                "**Comments:**",
                session.comments.trim() || "None"
            ].join("\n"))],
        components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
                .setCustomId(`${LFG_PREFIX}color:${session.id}`).setPlaceholder("Choose embed color")
                .addOptions(Object.keys(LFG_COLORS).map(name => ({
                    label: name, value: name, default: name === session.color
                })))),
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
                .setCustomId(`${LFG_PREFIX}voice:${session.id}`).setPlaceholder("Voice chat preference")
                .addOptions(
                    { label: "No preference", value: "any", default: session.voicePreference === "any" },
                    { label: "Voice chat required", value: "required", default: session.voicePreference === "required" },
                    { label: "Voice chat not required", value: "not_required", default: session.voicePreference === "not_required" }
                )),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`${LFG_PREFIX}details:${session.id}`).setLabel("Edit group details").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`${LFG_PREFIX}start_time:${session.id}`).setLabel("Set start time").setStyle(ButtonStyle.Secondary)
            ),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`${LFG_PREFIX}publish:${session.id}`)
                    .setLabel(session.isEditing ? "Save changes" : "Publish request").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`${LFG_PREFIX}cancel:${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Danger)
            )
        ],
        allowedMentions: { parse: [] as const }
    };
}

export function buildLfgDetailsModal(session: LfgSetup): ModalBuilder {
    const modal = new ModalBuilder().setCustomId(`${LFG_PREFIX}details_submit:${session.id}`)
        .setTitle(session.isEditing ? "Edit group details" : "Group details");
    const text = (id: string, label: string, value: string, style: TextInputStyle, maxLength: number, required: boolean) => {
        const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)
            .setMaxLength(maxLength).setRequired(required);
        if (value) input.setValue(value);
        return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    };
    return modal.addComponents(
        text("game", "Game", session.game, TextInputStyle.Short, 80, true),
        text("players", "Total players (including you)", session.playerCount, TextInputStyle.Short, 2, true),
        text("platform", "Platform / crossplay (optional)", session.platform, TextInputStyle.Short, 60, false),
        text("region", "Region (optional)", session.region, TextInputStyle.Short, 60, false),
        text("comments", "Comments / requirements (optional)", session.comments, TextInputStyle.Paragraph, 500, false)
    );
}

export function buildLfgStartTimeModal(session: LfgSetup): ModalBuilder {
    const input = new TextInputBuilder().setCustomId("starts_at").setLabel("Start time with UTC offset (blank = now)")
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
        .setPlaceholder("2027-01-15T18:00-05:00");
    if (session.startsAt !== null) input.setValue(new Date(session.startsAt).toISOString().replace(/\.\d{3}Z$/, "Z"));
    return new ModalBuilder().setCustomId(`${LFG_PREFIX}start_time_submit:${session.id}`)
        .setTitle("Set group start time").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function buildLfgReportModal(listingId: string): ModalBuilder {
    return new ModalBuilder().setCustomId(`${LFG_PREFIX}report_submit:${listingId}`).setTitle("Report group request")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
            .setCustomId("reason").setLabel("Why should staff review this listing?")
            .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(5).setMaxLength(500)));
}

export function buildLfgPost(listing: LfgListing) {
    const isFull = listing.playerIds.length >= listing.maxPlayers;
    const status = listing.status === "open" ? (isFull ? "GROUP FULL" : "OPEN")
        : listing.status === "completed" ? "COMPLETED"
            : listing.status === "canceled" ? "CANCELED" : "EXPIRED";
    const embed = new EmbedBuilder().setColor(LFG_COLORS[listing.color])
        .setTitle(`Looking for Group • ${listing.game}`)
        .setDescription(listing.comments || "No extra comments provided.")
        .addFields(
            { name: "Host", value: `<@${listing.hostId}>`, inline: true },
            { name: "Players", value: `${listing.playerIds.length}/${listing.maxPlayers}`, inline: true },
            { name: "Starts", value: listing.startsAt === null ? "Now / flexible" : `<t:${Math.floor(listing.startsAt / 1000)}:F>\n<t:${Math.floor(listing.startsAt / 1000)}:R>`, inline: true },
            { name: "Platform / Crossplay", value: listing.platform || "Any", inline: true },
            { name: "Region", value: listing.region || "Any", inline: true },
            { name: "Voice Chat", value: listing.voicePreference === "any" ? "No preference"
                : listing.voicePreference === "required" ? "Required" : "Not required", inline: true },
            { name: "Group", value: listing.playerIds.map(id => `<@${id}>`).join("\n") || "No players yet", inline: false }
        )
        .setFooter({ text: `${status} • Expires` })
        .setTimestamp(new Date(listing.expiresAt));
    return {
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${LFG_PREFIX}join:${listing.id}`).setLabel("Join Group")
                .setStyle(ButtonStyle.Success).setDisabled(listing.status !== "open" || isFull),
            new ButtonBuilder().setCustomId(`${LFG_PREFIX}leave:${listing.id}`).setLabel("Leave Group")
                .setStyle(ButtonStyle.Secondary).setDisabled(listing.status !== "open"),
            new ButtonBuilder().setCustomId(`${LFG_PREFIX}edit:${listing.id}`).setLabel("Edit")
                .setStyle(ButtonStyle.Primary).setDisabled(listing.status !== "open"),
            new ButtonBuilder().setCustomId(`${LFG_PREFIX}close:${listing.id}`).setLabel("Complete")
                .setStyle(ButtonStyle.Danger).setDisabled(listing.status !== "open"),
            new ButtonBuilder().setCustomId(`${LFG_PREFIX}cancel_listing:${listing.id}`).setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary).setDisabled(listing.status !== "open")
        ), new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${LFG_PREFIX}report:${listing.id}`).setLabel("Report listing")
                .setStyle(ButtonStyle.Secondary).setDisabled(listing.status === "canceled" || listing.status === "expired")
        )],
        allowedMentions: { parse: [], users: listing.playerIds }
    };
}
