// Arena Player Rating panel and cards.
import {
    ChannelType, MessageFlags, TextChannel, User, type Interaction, type ModalSubmitInteraction
} from "discord.js";
import { ensureUser, savePoints } from "../../utils";
import {
    buildCheckpointBreakdownEmbed, buildCheckpointCardMessage, buildCheckpointModal, buildCheckpointNameModal,
    CHECKPOINT_EDIT_PREFIX, CHECKPOINT_MODAL_PREFIX, CHECKPOINT_NAME_ID, CHECKPOINT_NAME_INPUT_ID,
    CHECKPOINT_NAME_MODAL_ID, CHECKPOINT_VIEW_ID, describeCheckpointProgress, renderCheckpointCard,
    upsertCheckpointCardMessage, upsertCheckpointPanel
} from "../../features/checkpointCard";
import {
    CHECKPOINT_SECTIONS, isCheckpointComplete, isCheckpointSectionId, parseCheckpointStat, parseIngameName,
    validateCheckpointStats, type CheckpointStats
} from "../../game/checkpointRating";
import { client } from "../core/client";
import { botSettingsStore, isFeatureEnabled } from "../core/settings";
import { toSafeString } from "../core/ops";
import { appendAuditEvent } from "../core/audit";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";

const checkpointCardQueues = new Map<string, Promise<void>>();

async function getCheckpointCardChannel(): Promise<TextChannel> {
    const channelId = botSettingsStore.get().channels.checkpointCards;
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error(`Player rating channel ${channelId} is missing or is not a text channel.`);
    }
    return channel;
}

export async function ensureCheckpointCardPanel(): Promise<void> {
    if (!client.isReady()) return;
    const channel = await getCheckpointCardChannel();
    const previousId = getGuildPanelMessageId(channel.guild.id, "checkpointCard");
    const messageId = await upsertCheckpointPanel(channel, client.user.id, previousId);
    if (previousId !== messageId) setGuildPanelMessageId(channel.guild.id, "checkpointCard", messageId);
}

async function fetchAvatarBuffer(url: string): Promise<Buffer | null> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    } catch {
        return null;
    }
}

/** Renders and posts/edits the player's public card. Serialized per user so rapid edits cannot race. */
function publishCheckpointCard(discordUser: User): Promise<string> {
    const previous = checkpointCardQueues.get(discordUser.id) || Promise.resolve();
    let resultUrl = "";
    const run = previous.catch(() => undefined).then(async () => {
        const profile = ensureUser(discordUser.id).checkpointProfile;
        if (!profile || !profile.ingameName || !isCheckpointComplete(profile.stats)) throw new Error("Checkpoint profile is incomplete.");
        const stats = { ...profile.stats };
        const ingameName = profile.ingameName;
        const avatar = await fetchAvatarBuffer(discordUser.displayAvatarURL({ extension: "png", size: 128 }));
        const rendered = await renderCheckpointCard({
            userId: discordUser.id, ingameName, stats, updatedAt: profile.updatedAt, avatar
        });
        const channel = await getCheckpointCardChannel();
        const storedId = profile.cardChannelId === channel.id ? profile.cardMessageId : null;
        const message = await upsertCheckpointCardMessage(channel, storedId,
            buildCheckpointCardMessage(discordUser.id, ingameName, rendered.rating, rendered.tier, rendered.buffer));
        const latest = ensureUser(discordUser.id).checkpointProfile;
        if (latest && (latest.cardMessageId !== message.id || latest.cardChannelId !== channel.id)) {
            latest.cardMessageId = message.id;
            latest.cardChannelId = channel.id;
            savePoints();
        }
        resultUrl = message.url;
    });
    const tracked = run.finally(() => {
        if (checkpointCardQueues.get(discordUser.id) === tracked) checkpointCardQueues.delete(discordUser.id);
    });
    checkpointCardQueues.set(discordUser.id, tracked);
    return tracked.then(() => resultUrl);
}

export function getCheckpointCardUrl(profile: { cardChannelId: string | null; cardMessageId: string | null }, guildId: string | null): string | null {
    if (!profile.cardChannelId || !profile.cardMessageId || !guildId) return null;
    return `https://discord.com/channels/${guildId}/${profile.cardChannelId}/${profile.cardMessageId}`;
}

async function finishCheckpointSave(interaction: ModalSubmitInteraction, savedLabel: string): Promise<void> {
    const profile = ensureUser(interaction.user.id).checkpointProfile;
    const stats = profile?.stats || {};
    const ingameName = profile?.ingameName || null;
    if (!ingameName || !isCheckpointComplete(stats)) {
        await interaction.reply({
            content: `**${savedLabel} saved.** Finish the remaining steps to generate your card:\n${describeCheckpointProgress(stats, ingameName)}`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const url = await publishCheckpointCard(interaction.user);
        await interaction.editReply({ embeds: [buildCheckpointBreakdownEmbed(stats, url)] });
    } catch (error) {
        console.error("[checkpointCard]", error);
        appendAuditEvent("checkpoint_card_publish_failed", { userId: interaction.user.id, reason: toSafeString(error) });
        await interaction.editReply({ content: "Your info was saved, but the card could not be posted. Submit any section again to retry." });
    }
}

export async function handleCheckpointInteraction(interaction: Interaction): Promise<boolean> {
    const isCheckpointComponent = (interaction.isButton() || interaction.isModalSubmit())
        && (interaction.customId.startsWith(CHECKPOINT_EDIT_PREFIX) || interaction.customId === CHECKPOINT_VIEW_ID || interaction.customId.startsWith(CHECKPOINT_MODAL_PREFIX)
            || interaction.customId === CHECKPOINT_NAME_ID || interaction.customId === CHECKPOINT_NAME_MODAL_ID);
    if (isCheckpointComponent && !isFeatureEnabled("checkpointCards")) {
        await interaction.reply({ content: "Player rating cards are paused by staff right now.", flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.isButton() && interaction.customId === CHECKPOINT_NAME_ID) {
        if (interaction.user.bot) return true;
        await interaction.showModal(buildCheckpointNameModal(ensureUser(interaction.user.id).checkpointProfile?.ingameName || null));
        return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === CHECKPOINT_NAME_MODAL_ID) {
        const parsed = parseIngameName(interaction.fields.getTextInputValue(CHECKPOINT_NAME_INPUT_ID));
        if (!parsed.ok) {
            await interaction.reply({ content: `**In-game name was not saved:** ${parsed.error}`, flags: MessageFlags.Ephemeral });
            return true;
        }
        const user = ensureUser(interaction.user.id);
        user.checkpointProfile = {
            ingameName: parsed.value,
            stats: user.checkpointProfile?.stats || {},
            updatedAt: Date.now(),
            cardChannelId: user.checkpointProfile?.cardChannelId || null,
            cardMessageId: user.checkpointProfile?.cardMessageId || null
        };
        savePoints();
        appendAuditEvent("checkpoint_name_saved", { userId: interaction.user.id });
        await finishCheckpointSave(interaction, "In-game name");
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(CHECKPOINT_EDIT_PREFIX)) {
        const section = interaction.customId.slice(CHECKPOINT_EDIT_PREFIX.length);
        if (!isCheckpointSectionId(section) || interaction.user.bot) return true;
        const stats = ensureUser(interaction.user.id).checkpointProfile?.stats || {};
        await interaction.showModal(buildCheckpointModal(section, stats));
        return true;
    }

    if (interaction.isButton() && interaction.customId === CHECKPOINT_VIEW_ID) {
        const profile = ensureUser(interaction.user.id).checkpointProfile;
        if (!profile || !profile.ingameName || !isCheckpointComplete(profile.stats)) {
            await interaction.reply({
                content: `Your card unlocks after your in-game name and all four sections are saved.\n${describeCheckpointProgress(profile?.stats || {}, profile?.ingameName || null)}`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        await interaction.reply({
            embeds: [buildCheckpointBreakdownEmbed(profile.stats, getCheckpointCardUrl(profile, interaction.guildId))],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(CHECKPOINT_MODAL_PREFIX)) {
        const section = interaction.customId.slice(CHECKPOINT_MODAL_PREFIX.length);
        if (!isCheckpointSectionId(section)) return true;
        const errors: string[] = [];
        const updates: CheckpointStats = {};
        for (const key of CHECKPOINT_SECTIONS[section].keys) {
            const parsed = parseCheckpointStat(key, interaction.fields.getTextInputValue(key));
            if (parsed.ok) updates[key] = parsed.value;
            else errors.push(parsed.error);
        }
        const user = ensureUser(interaction.user.id);
        const merged: CheckpointStats = { ...(user.checkpointProfile?.stats || {}), ...updates };
        if (!errors.length) errors.push(...validateCheckpointStats(merged));
        if (errors.length) {
            await interaction.reply({
                content: `**${CHECKPOINT_SECTIONS[section].title} was not saved:**\n${errors.map(error => `• ${error}`).join("\n")}`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        user.checkpointProfile = {
            ingameName: user.checkpointProfile?.ingameName || null,
            stats: merged,
            updatedAt: Date.now(),
            cardChannelId: user.checkpointProfile?.cardChannelId || null,
            cardMessageId: user.checkpointProfile?.cardMessageId || null
        };
        savePoints();
        appendAuditEvent("checkpoint_stats_saved", { userId: interaction.user.id, section });
        await finishCheckpointSave(interaction, CHECKPOINT_SECTIONS[section].title);
        return true;
    }
    return false;
}
