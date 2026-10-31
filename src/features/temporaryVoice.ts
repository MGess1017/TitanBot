import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Guild,
    GuildMember,
    ModalBuilder,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
    VoiceChannel
} from "discord.js";

export const TEMP_VOICE_CHANNEL_PREFIX = "temp-vc-";
export const TEMP_VOICE_CONTROL_PREFIX = "temporary_vc_control";
export const TEMP_VOICE_MODAL_PREFIX = "temporary_vc_modal";

export type TemporaryVoiceControlAction = "rename" | "lock" | "unlock" | "limit" | "transfer";
export type TemporaryVoiceModalAction = "rename" | "limit" | "transfer";

export function buildTemporaryVoiceRoomName(displayName: string, ownerId: string): string {
    const safeName = displayName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "member";
    return `${TEMP_VOICE_CHANNEL_PREFIX}${safeName}-${ownerId}`.slice(0, 100);
}

export function getTemporaryVoiceOwnerId(channelName: string): string | null {
    const match = channelName.match(/^temp-vc-[a-z0-9-]+-(\d{17,20})$/);
    return match?.[1] || null;
}

export async function fetchOwnedTemporaryVoiceRoom(guild: Guild, channelId: string, ownerId: string, categoryId: string): Promise<VoiceChannel | null> {
    if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(ownerId)) return null;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice || channel.parentId !== categoryId) return null;
    if (getTemporaryVoiceOwnerId(channel.name) !== ownerId) return null;
    return channel;
}

export async function findOrCreateTemporaryVoiceRoom(guild: Guild, member: GuildMember, categoryId: string): Promise<{ room: VoiceChannel; created: boolean } | { error: string }> {
    const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) return { error: "Temporary voice category is unavailable." };

    const existing = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildVoice
        && channel.parentId === category.id
        && getTemporaryVoiceOwnerId(channel.name) === member.id
    );
    if (existing?.type === ChannelType.GuildVoice) return { room: existing, created: false };

    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { error: "The bot needs Manage Channels permission to create your room." };
    }

    const created = await guild.channels.create({
        name: buildTemporaryVoiceRoomName(member.displayName, member.id),
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
            { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
            { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] }
        ],
        reason: `Temporary voice room requested by ${member.user.tag}`
    }).catch(error => ({ error: error instanceof Error ? error.message : String(error) }));

    if ("error" in created || created.type !== ChannelType.GuildVoice) {
        return { error: "Could not create your voice room. Check the bot's category permissions and try again." };
    }
    return { room: created, created: true };
}

export function buildTemporaryVoiceControlId(action: TemporaryVoiceControlAction, channelId: string, ownerId: string): string {
    return `${TEMP_VOICE_CONTROL_PREFIX}:${action}:${channelId}:${ownerId}`;
}

export function parseTemporaryVoiceControlId(customId: string): {
    action: TemporaryVoiceControlAction;
    channelId: string;
    ownerId: string;
} | null {
    const [prefix, action, channelId, ownerId, ...extra] = customId.split(":");
    if (prefix !== TEMP_VOICE_CONTROL_PREFIX || extra.length || !["rename", "lock", "unlock", "limit", "transfer"].includes(action)) return null;
    if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(ownerId)) return null;
    return { action: action as TemporaryVoiceControlAction, channelId, ownerId };
}

export function buildTemporaryVoiceControlRow(input: {
    channelId: string;
    ownerId: string;
    locked: boolean;
    userLimit: number;
}): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(buildTemporaryVoiceControlId("rename", input.channelId, input.ownerId))
            .setLabel("Rename")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(buildTemporaryVoiceControlId(input.locked ? "unlock" : "lock", input.channelId, input.ownerId))
            .setLabel(input.locked ? "Unlock" : "Lock")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(buildTemporaryVoiceControlId("limit", input.channelId, input.ownerId))
            .setLabel(input.userLimit ? `Limit: ${input.userLimit}` : "Set limit")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(buildTemporaryVoiceControlId("transfer", input.channelId, input.ownerId))
            .setLabel("Transfer")
            .setStyle(ButtonStyle.Secondary)
    );
}

export function buildTemporaryVoiceModal(action: TemporaryVoiceModalAction, channelId: string, ownerId: string): ModalBuilder {
    const isRename = action === "rename";
    const isLimit = action === "limit";
    const label = isRename ? "Room name" : isLimit ? "User limit (0 = unlimited)" : "New owner's user ID or mention";
    const placeholder = isRename ? "My squad room" : isLimit ? "5" : "123456789012345678 or <@id>";
    return new ModalBuilder()
        .setCustomId(`${TEMP_VOICE_MODAL_PREFIX}:${action}:${channelId}:${ownerId}`)
        .setTitle(isRename ? "Rename Voice Room" : isLimit ? "Set Voice Room Limit" : "Transfer Voice Room")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId("value")
                .setLabel(label)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(isRename ? 90 : 64)
                .setPlaceholder(placeholder)
        ));
}

export function parseTemporaryVoiceModalId(customId: string): {
    action: TemporaryVoiceModalAction;
    channelId: string;
    ownerId: string;
} | null {
    const [prefix, action, channelId, ownerId, ...extra] = customId.split(":");
    if (prefix !== TEMP_VOICE_MODAL_PREFIX || extra.length || !["rename", "limit", "transfer"].includes(action)) return null;
    if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(ownerId)) return null;
    return { action: action as TemporaryVoiceModalAction, channelId, ownerId };
}