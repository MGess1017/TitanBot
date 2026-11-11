// Arena Player Rating panel and cards.
import {
    ChannelType, DiscordAPIError, MessageFlags, TextChannel, User, type ButtonInteraction, type Interaction, type ModalSubmitInteraction
} from "discord.js";
import { ensureUser, savePoints } from "../../utils";
import {
    buildCheckpointBreakdownEmbed, buildCheckpointCardMessage, buildCheckpointModal, buildCheckpointNameModal,
    CHECKPOINT_EDIT_PREFIX, CHECKPOINT_MODAL_PREFIX, CHECKPOINT_NAME_ID, CHECKPOINT_NAME_INPUT_ID,
    CHECKPOINT_NAME_MODAL_ID, CHECKPOINT_VIEW_ID, CHECKPOINT_WORKSPACE_ID, CHECKPOINT_REFRESH_ID, CHECKPOINT_RETRY_ID,
    buildCheckpointWorkspace, renderCheckpointCard,
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
import { normalizeHubPreferences } from "../../game/hubPreferences";
import { withHubNavigation } from "../../features/inquiryPanel";
import { rejectIfRateLimited } from "../../runtime/rateLimit";
import { COMMAND_RATE_LIMIT_WINDOW_MS } from "../core/config";

const checkpointCardQueues = new Map<string, Promise<unknown>>();

function queueCheckpointWork<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = checkpointCardQueues.get(userId) || Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tracked = run.finally(() => {
        if (checkpointCardQueues.get(userId) === tracked) checkpointCardQueues.delete(userId);
    });
    checkpointCardQueues.set(userId, tracked);
    return tracked;
}

/** Caller persists the visibility preference and cleared message IDs together. */
export async function removeCheckpointPublicCard(userId: string): Promise<void> {
    await queueCheckpointWork(userId, async () => {
        const profile = ensureUser(userId).checkpointProfile;
        if (!profile?.cardChannelId || !profile.cardMessageId) return;
        const channel = await client.channels.fetch(profile.cardChannelId);
        if (!channel || channel.type !== ChannelType.GuildText) throw new Error("Cannot remove your previous public card: its channel is unavailable.");
        try {
            const message = await channel.messages.fetch(profile.cardMessageId);
            if (message.author.id !== client.user?.id) throw new Error("Cannot remove a card not owned by this bot.");
            await message.delete();
        } catch (error) {
            if (!(error instanceof DiscordAPIError && error.code === 10008)) throw error;
        }
        profile.cardChannelId = null;
        profile.cardMessageId = null;
    });
}

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
        if (!response.ok) throw new Error(`Avatar HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
    } catch (error) {
        console.warn("[checkpointCard] Optional avatar unavailable:", error);
        return null;
    }
}

/** Renders and posts/edits the player's public card. Serialized per user so rapid edits cannot race. */
function publishCheckpointCard(discordUser: User): Promise<string> {
    return queueCheckpointWork(discordUser.id, async () => {
        if (normalizeHubPreferences(ensureUser(discordUser.id).preferences.hub).cardVisibility === "private") {
            throw new Error("Your card is private. Use Refresh Card for a private preview.");
        }
        const profile = ensureUser(discordUser.id).checkpointProfile;
        if (!profile || !profile.ingameName || !isCheckpointComplete(profile.stats)) throw new Error("Checkpoint profile is incomplete.");
        const stats = { ...profile.stats };
        const ingameName = profile.ingameName;
        const avatar = await fetchAvatarBuffer(discordUser.displayAvatarURL({ extension: "png", size: 128 }));
        const rendered = await renderCheckpointCard({
            userId: discordUser.id, ingameName, stats, updatedAt: profile.updatedAt, avatar
        });
        if (normalizeHubPreferences(ensureUser(discordUser.id).preferences.hub).cardVisibility === "private") {
            throw new Error("Your card was switched to private while rendering. Refresh for a private preview.");
        }
        const channel = await getCheckpointCardChannel();
        const storedId = profile.cardChannelId === channel.id ? profile.cardMessageId : null;
        const message = await upsertCheckpointCardMessage(channel, storedId,
            buildCheckpointCardMessage(discordUser.id, ingameName, rendered.rating, rendered.tier, rendered.buffer, profile.updatedAt));
        const latest = ensureUser(discordUser.id).checkpointProfile;
        if (latest && (latest.cardMessageId !== message.id || latest.cardChannelId !== channel.id)) {
            latest.cardMessageId = message.id;
            latest.cardChannelId = channel.id;
            savePoints();
        }
        return message.url;
    });
}

export function getCheckpointCardUrl(profile: { cardChannelId: string | null; cardMessageId: string | null }, guildId: string | null): string | null {
    if (!profile.cardChannelId || !profile.cardMessageId || !guildId) return null;
    return `https://discord.com/channels/${guildId}/${profile.cardChannelId}/${profile.cardMessageId}`;
}

async function finishCheckpointSave(interaction: ModalSubmitInteraction | ButtonInteraction, savedLabel: string): Promise<void> {
    const profile = ensureUser(interaction.user.id).checkpointProfile;
    const preferences = normalizeHubPreferences(ensureUser(interaction.user.id).preferences.hub);
    const stats = profile?.stats || {};
    const ingameName = profile?.ingameName || null;
    const workspace = withHubNavigation(buildCheckpointWorkspace(profile, preferences.cardVisibility), "arena");
    if ((interaction.isButton() || interaction.isFromMessage()) && interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!profile || !ingameName || !isCheckpointComplete(stats)) {
        await interaction.editReply({
            content: `**${savedLabel}.** Finish the remaining setup steps.`,
            embeds: [workspace.embed], components: workspace.components, attachments: []
        });
        return;
    }
    try {
        if (preferences.cardVisibility === "private") {
            const rendered = await renderCheckpointCard({
                userId: interaction.user.id, ingameName, stats, updatedAt: profile.updatedAt
            });
            const preview = buildCheckpointCardMessage(interaction.user.id, ingameName, rendered.rating, rendered.tier, rendered.buffer, profile.updatedAt);
            await interaction.editReply({
                content: `**${savedLabel}.** Private preview / nothing posted publicly.`,
                embeds: preview.embeds, files: preview.files, components: workspace.components, attachments: [], allowedMentions: { parse: [] }
            });
            return;
        }
        const url = await publishCheckpointCard(interaction.user);
        await interaction.editReply({
            content: `**${savedLabel}.** [View your updated card](${url})`,
            embeds: [workspace.embed], components: workspace.components, attachments: [], allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[checkpointCard]", error);
        appendAuditEvent("checkpoint_card_publish_failed", { userId: interaction.user.id, reason: toSafeString(error) });
        await interaction.editReply({
            content: "Your info is saved, but the card could not be rendered or posted. Use Retry Publish (public) or Refresh Card (private).",
            embeds: [workspace.embed], components: workspace.components, attachments: [], allowedMentions: { parse: [] }
        });
    }
}

export async function handleCheckpointInteraction(interaction: Interaction): Promise<boolean> {
    const isCheckpointComponent = (interaction.isButton() || interaction.isModalSubmit())
        && (interaction.customId.startsWith(CHECKPOINT_EDIT_PREFIX) || interaction.customId === CHECKPOINT_VIEW_ID || interaction.customId.startsWith(CHECKPOINT_MODAL_PREFIX)
            || [CHECKPOINT_NAME_ID, CHECKPOINT_NAME_MODAL_ID, CHECKPOINT_WORKSPACE_ID, CHECKPOINT_REFRESH_ID, CHECKPOINT_RETRY_ID].includes(interaction.customId));
    if (!isCheckpointComponent) return false;
    const throttleError = rejectIfRateLimited(`checkpoint:${interaction.guildId || "dm"}:${interaction.user.id}`, COMMAND_RATE_LIMIT_WINDOW_MS);
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (isCheckpointComponent && !isFeatureEnabled("checkpointCards")) {
        await interaction.reply({ content: "Player rating cards are paused by staff right now.", flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.isButton() && interaction.customId === CHECKPOINT_WORKSPACE_ID) {
        const state = ensureUser(interaction.user.id);
        const payload = withHubNavigation(buildCheckpointWorkspace(state.checkpointProfile, normalizeHubPreferences(state.preferences.hub).cardVisibility), "arena");
        const reply = { content: "", embeds: [payload.embed], components: payload.components, attachments: [] };
        if (interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.update(reply);
        else await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.isButton() && [CHECKPOINT_REFRESH_ID, CHECKPOINT_RETRY_ID].includes(interaction.customId)) {
        await finishCheckpointSave(interaction, "Card refreshed");
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
        const previous = user.checkpointProfile;
        user.checkpointProfile = {
            ingameName: parsed.value,
            stats: user.checkpointProfile?.stats || {},
            updatedAt: Date.now(),
            cardChannelId: user.checkpointProfile?.cardChannelId || null,
            cardMessageId: user.checkpointProfile?.cardMessageId || null
        };
        try { savePoints(); } catch (error) {
            user.checkpointProfile = previous;
            console.error("[checkpointCard] Name save failed:", error);
            await interaction.reply({ content: "Your name could not be saved. Please try again.", flags: MessageFlags.Ephemeral });
            return true;
        }
        appendAuditEvent("checkpoint_name_saved", { userId: interaction.user.id });
        await finishCheckpointSave(interaction, "In-game name saved");
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
            const payload = withHubNavigation(buildCheckpointWorkspace(profile, normalizeHubPreferences(ensureUser(interaction.user.id).preferences.hub).cardVisibility), "arena");
            if (interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.update({ embeds: [payload.embed], components: payload.components, attachments: [] });
            else await interaction.reply({ embeds: [payload.embed], components: payload.components, flags: MessageFlags.Ephemeral });
            return true;
        }
        const workspace = withHubNavigation(buildCheckpointWorkspace(profile, normalizeHubPreferences(ensureUser(interaction.user.id).preferences.hub).cardVisibility), "arena:details");
        const reply = { embeds: [buildCheckpointBreakdownEmbed(profile.stats, getCheckpointCardUrl(profile, interaction.guildId), profile.updatedAt)], components: workspace.components, attachments: [] };
        if (interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.update(reply);
        else await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
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

        const previous = user.checkpointProfile;
        user.checkpointProfile = {
            ingameName: user.checkpointProfile?.ingameName || null,
            stats: merged,
            updatedAt: Date.now(),
            cardChannelId: user.checkpointProfile?.cardChannelId || null,
            cardMessageId: user.checkpointProfile?.cardMessageId || null
        };
        try { savePoints(); } catch (error) {
            user.checkpointProfile = previous;
            console.error("[checkpointCard] Stats save failed:", error);
            await interaction.reply({ content: "Your stats could not be saved. Please try again.", flags: MessageFlags.Ephemeral });
            return true;
        }
        appendAuditEvent("checkpoint_stats_saved", { userId: interaction.user.id, section });
        await finishCheckpointSave(interaction, `${CHECKPOINT_SECTIONS[section].title} saved`);
        return true;
    }
    return false;
}
