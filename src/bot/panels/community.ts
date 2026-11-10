// Self-role selector and temporary voice panel.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild, Role } from "discord.js";
import {
    ROLE_SELECTOR_CHANNEL_ID, SELF_ROLE_SELECTOR_ROLES, SelfRoleSelectorRole, TEMP_VOICE_CATEGORY_ID,
    TEMP_VOICE_PANEL_BUTTON_ID, TEMP_VOICE_PANEL_CHANNEL_NAME
} from "../core/config";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { brandLiveEmbed } from "../ui/embeds";

export async function resolveSelfRoleForGuild(
    guild: Guild,
    configuredRole: SelfRoleSelectorRole,
    createIfMissing = false
): Promise<Role | null> {
    if (configuredRole.id) {
        return guild.roles.cache.get(configuredRole.id)
            || await guild.roles.fetch(configuredRole.id).catch(error => {
                console.warn(`[roleSelector] Could not fetch configured role ${configuredRole.id}:`, error);
                return null;
            });
    }

    if (!configuredRole.roleName) return null;
    let existing = guild.roles.cache.find(role => role.name.toLowerCase() === configuredRole.roleName?.toLowerCase()) || null;
    if (!existing) {
        const roles = await guild.roles.fetch().catch(error => {
            console.warn(`[roleSelector] Could not fetch roles for guild ${guild.id}:`, error);
            return null;
        });
        existing = roles?.find(role => role.name.toLowerCase() === configuredRole.roleName?.toLowerCase()) || null;
    }
    if (existing || !createIfMissing) return existing;

    return guild.roles.create({
        name: configuredRole.roleName,
        reason: "Provision self-selectable RuneScape 3 role"
    }).catch(error => {
        console.warn(`[roleSelector] Could not create role ${configuredRole.roleName} in guild ${guild.id}:`, error);
        return null;
    });
}

function buildSelfRoleSelectorPayload(resolvedRoles: Array<{ configuredRole: SelfRoleSelectorRole; role: Role }>) {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("Choose Your Roles")
        .setDescription("Select a role below to add it to your profile.")
        .addFields(resolvedRoles.map(({ configuredRole, role }) => ({
            name: configuredRole.label,
            value: `<@&${role.id}>`,
            inline: true
        }))), "Role Selector");
    const buttons = resolvedRoles.map(({ configuredRole }) => {
        const button = new ButtonBuilder()
            .setCustomId(configuredRole.buttonId)
            .setLabel(configuredRole.label)
            .setStyle(configuredRole.style);
        if (configuredRole.emoji) button.setEmoji(configuredRole.emoji);
        return button;
    });

    return {
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
        allowedMentions: { parse: [] as const }
    };
}

export async function upsertSelfRoleSelectorForGuild(guild: Guild): Promise<void> {
    const channel = guild.channels.cache.get(ROLE_SELECTOR_CHANNEL_ID)
        || await guild.channels.fetch(ROLE_SELECTOR_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`Role selector skipped for guild ${guild.id}: configured channel is missing or is not a text channel.`);
        return;
    }

    const resolvedRoles = await Promise.all(SELF_ROLE_SELECTOR_ROLES.map(async configuredRole => ({
        configuredRole,
        role: await resolveSelfRoleForGuild(guild, configuredRole, true)
    })));
    if (resolvedRoles.some(entry => !entry.role)) {
        console.warn(`Role selector skipped for guild ${guild.id}: one or more configured roles could not be resolved.`);
        return;
    }
    const payload = buildSelfRoleSelectorPayload(resolvedRoles.filter(
        (entry): entry is { configuredRole: SelfRoleSelectorRole; role: Role } => Boolean(entry.role)
    ));
    const storedMessageId = getGuildPanelMessageId(guild.id, "roleSelector");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit(payload).catch(() => null);
        if (edited) return;
        setGuildPanelMessageId(guild.id, "roleSelector", null);
    }

    const sent = await channel.send(payload).catch(() => null);
    if (!sent) {
        console.warn(`Role selector could not be posted in channel ${ROLE_SELECTOR_CHANNEL_ID}; check bot permissions.`);
        return;
    }
    setGuildPanelMessageId(guild.id, "roleSelector", sent.id);
}

function buildTemporaryVoicePanelPayload() {
    const embed = brandLiveEmbed(new EmbedBuilder()
        .setColor(0x0f766e)
        .setTitle("Create Your VC")
        .setDescription("Create your room anytime. If disconnected, use the room link in the response to join; connected members are moved automatically. Empty rooms close automatically."),
    "Temporary Voice Access", "Private room controls");
    const button = new ButtonBuilder()
        .setCustomId(TEMP_VOICE_PANEL_BUTTON_ID)
        .setLabel("Create my VC")
        .setEmoji("🔊")
        .setStyle(ButtonStyle.Success);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
        allowedMentions: { parse: [] as const }
    };
}

export async function ensureTemporaryVoicePanelForGuild(guild: Guild): Promise<void> {
    const category = guild.channels.cache.get(TEMP_VOICE_CATEGORY_ID)
        || await guild.channels.fetch(TEMP_VOICE_CATEGORY_ID).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
        console.warn(`Temporary voice panel skipped for guild ${guild.id}: category ${TEMP_VOICE_CATEGORY_ID} was not found.`);
        return;
    }

    let panelChannel = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText
        && channel.parentId === category.id
        && channel.name === TEMP_VOICE_PANEL_CHANNEL_NAME
    ) || null;
    if (!panelChannel) {
        panelChannel = await guild.channels.create({
            name: TEMP_VOICE_PANEL_CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: "Create a temporary voice room with the button below."
        }).catch(() => null);
    }
    if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
        console.warn(`Temporary voice panel could not be created in category ${category.id}; check Manage Channels and channel permissions.`);
        return;
    }

    const payload = buildTemporaryVoicePanelPayload();
    const storedMessageId = getGuildPanelMessageId(guild.id, "voiceCreator");
    if (storedMessageId) {
        const stored = await panelChannel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit(payload).catch(() => null);
        if (edited) return;
        setGuildPanelMessageId(guild.id, "voiceCreator", null);
    }

    const sent = await panelChannel.send(payload).catch(() => null);
    if (!sent) {
        console.warn(`Temporary voice panel could not be posted in channel ${panelChannel.id}; check Send Messages and Embed Links.`);
        return;
    }
    setGuildPanelMessageId(guild.id, "voiceCreator", sent.id);
}

export async function cleanupEmptyTemporaryVoiceChannel(guild: Guild, channelId: string): Promise<void> {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    const hasOwnerMarker = Boolean(channel && (
        /^temp-vc-[a-z0-9-]+-\d{17,20}$/.test(channel.name)
        || /^temp-vc-\d{17,20}-[a-z0-9-]+$/.test(channel.name)
    ));
    if (!channel
        || channel.type !== ChannelType.GuildVoice
        || channel.parentId !== TEMP_VOICE_CATEGORY_ID
        || !hasOwnerMarker
        || channel.members.size > 0) return;

    await channel.delete("Temporary voice room is empty").catch(error => {
        console.warn(`[voice] Could not delete empty temporary channel ${channelId}:`, error);
    });
}
