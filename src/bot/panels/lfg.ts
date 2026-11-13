import { randomUUID } from "node:crypto";
import path from "node:path";
import {
    ChannelType, DiscordAPIError, EmbedBuilder, MessageFlags, type Guild, type Interaction, type Message
} from "discord.js";
import {
    buildLfgDetailsModal, buildLfgPanel, buildLfgPost, buildLfgReportModal, buildLfgSetup,
    buildLfgStartTimeModal, LFG_COLORS, LFG_PANEL_TITLE, LFG_PREFIX, parseLfgStartTime,
    validateLfgRequest, type LfgColor, type LfgSetup, type LfgVoicePreference
} from "../../features/lfg";
import { LFG_PANEL_CHANNEL_ID, LFG_POST_CHANNEL_ID, REPORT_LOG_CHANNEL_ID } from "../core/config";
import { BOT_SRC_DIR } from "../core/paths";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { LfgStore } from "../../runtime/lfgStore";

const setupSessions = new Map<string, LfgSetup & { guildId: string; userId: string; expiresAt: number; listingId: string | null; publishing: boolean }>();
const SETUP_TTL_MS = 15 * 60 * 1000;
const LFG_MAINTENANCE_INTERVAL_MS = 60_000;
const schedulerTimers = new Map<string, NodeJS.Timeout>();
const renderQueues = new Map<string, Promise<void>>();
const reportDeliveries = new Set<string>();
let store: LfgStore | undefined;

function getStore(): LfgStore {
    return store ??= new LfgStore(path.resolve(BOT_SRC_DIR, "..", "src", "data", "lfg-listings.json"));
}

function createSetup(guildId: string, userId: string, listing?: ReturnType<LfgStore["get"]>) {
    for (const [id, session] of setupSessions) {
        if (session.expiresAt <= Date.now()) setupSessions.delete(id);
    }
    const session = {
        id: randomUUID().slice(0, 16), guildId, userId, expiresAt: Date.now() + SETUP_TTL_MS,
        listingId: listing?.id || null, isEditing: Boolean(listing), publishing: false,
        game: listing?.game || "", playerCount: String(listing?.maxPlayers || ""),
        comments: listing?.comments || "", platform: listing?.platform || "", region: listing?.region || "",
        voicePreference: listing?.voicePreference || "any" as LfgVoicePreference,
        startsAt: listing?.startsAt ?? null, color: listing?.color || "Purple" as LfgColor
    };
    setupSessions.set(session.id, session);
    return session;
}

function getSetup(id: string, userId: string, guildId: string) {
    const session = setupSessions.get(id);
    if (!session || session.userId !== userId || session.guildId !== guildId || session.expiresAt <= Date.now()) {
        if (session && session.expiresAt <= Date.now()) setupSessions.delete(id);
        throw new Error("This LFG setup expired or belongs to another member. Start again from the panel.");
    }
    if (session.publishing) throw new Error("Your request is already being saved. Please wait.");
    session.expiresAt = Date.now() + SETUP_TTL_MS;
    return session;
}

async function updateMessage(guild: Guild, listing: ReturnType<LfgStore["get"]>): Promise<void> {
    if (!listing?.messageId) throw new Error("This group request is unavailable.");
    const id = listing.id;
    const previous = renderQueues.get(id);
    const work = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
        const latest = getStore().get(id);
        if (!latest?.messageId || latest.guildId !== guild.id) throw new Error("This group request is unavailable.");
        const channel = await guild.channels.fetch(latest.channelId);
        if (!channel || channel.type !== ChannelType.GuildText) throw new Error("The LFG post channel is unavailable.");
        const message = await channel.messages.fetch(latest.messageId);
        const current = getStore().get(id);
        if (!current) throw new Error("This group request is unavailable.");
        await message.edit(buildLfgPost(current));
        getStore().markRendered(id, current.revision);
    });
    renderQueues.set(id, work);
    try { await work; }
    finally { if (renderQueues.get(id) === work) renderQueues.delete(id); }
}

async function updateFromInteraction(interaction: Interaction, listing: ReturnType<LfgStore["get"]>): Promise<void> {
    if (!listing?.messageId || !interaction.isMessageComponent()) throw new Error("This group request is unavailable.");
    if (interaction.guildId !== listing.guildId || interaction.message.id !== listing.messageId
        || interaction.channelId !== listing.channelId) {
        throw new Error("This control does not match the group request.");
    }
    await interaction.deferUpdate();
    if (!interaction.guild) throw new Error("The server is unavailable.");
    await updateMessage(interaction.guild, listing);
}

async function deliverPendingReports(guild: Guild): Promise<void> {
    if (reportDeliveries.has(guild.id)) return;
    reportDeliveries.add(guild.id);
    try {
    const pending = getStore().pendingReports(guild.id);
    if (!pending.length) return;
    const channel = await guild.channels.fetch(REPORT_LOG_CHANNEL_ID).catch(error => {
        console.error(`[lfg] Could not fetch report log ${REPORT_LOG_CHANNEL_ID}:`, error);
        return null;
    });
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`[lfg] Report log ${REPORT_LOG_CHANNEL_ID} is unavailable; reports remain queued.`);
        return;
    }
    for (const report of pending) {
        const listing = getStore().get(report.listingId);
        const embed = new EmbedBuilder().setColor(0xb91c1c)
            .setTitle("LFG listing report")
            .setDescription(report.reason)
            .addFields(
                { name: "Reporter", value: `<@${report.reporterId}>`, inline: true },
                { name: "Host", value: listing ? `<@${listing.hostId}>` : "Unavailable", inline: true },
                { name: "Game", value: listing?.game || "Unavailable", inline: true },
                { name: "Listing", value: listing?.messageId ? `https://discord.com/channels/${listing.guildId}/${listing.channelId}/${listing.messageId}` : "Message unavailable", inline: false }
            )
            .setFooter({ text: `Report ${report.id}` })
            .setTimestamp(new Date(report.createdAt));
        try {
            await channel.send({
                embeds: [embed], allowedMentions: { parse: [] },
                nonce: report.id.replace(/-/g, "").slice(0, 24), enforceNonce: true
            });
            getStore().markReportSent(report.id);
        } catch (error) {
            console.error(`[lfg] Could not deliver report ${report.id}; it remains queued:`, error);
        }
    }
    } finally { reportDeliveries.delete(guild.id); }
}

export async function runLfgMaintenance(guild: Guild, now = Date.now()): Promise<void> {
    const data = getStore();
    for (const due of data.dueListings(now)) {
        const expired = data.expire(due.id, now);
        if (expired) console.log(`[lfg] Listing ${expired.id} expired.`);
    }
    for (const listing of data.pendingRender(guild.id).slice(0, 100)) {
        try {
            await updateMessage(guild, listing);
        } catch (error) {
            if ((error instanceof DiscordAPIError && (error.code === 10008 || error.code === 10003))
                || (error instanceof Error && error.message === "The LFG post channel is unavailable.")) {
                console.warn(`[lfg] Post ${listing.messageId} or its channel is unavailable; stopping render retries.`);
                data.markRendered(listing.id, listing.revision);
            } else {
                console.error(`[lfg] Could not refresh post ${listing.messageId}:`, error);
            }
        }
    }
    await deliverPendingReports(guild);
}

export async function ensureLfgSchedulerForGuild(guild: Guild): Promise<void> {
    if (schedulerTimers.has(guild.id)) return;
    const tick = () => runLfgMaintenance(guild).catch(error => console.error(`[lfg] Maintenance failed for guild ${guild.id}:`, error));
    const timer = setInterval(tick, LFG_MAINTENANCE_INTERVAL_MS);
    timer.unref();
    schedulerTimers.set(guild.id, timer);
    await tick();
}

export function stopLfgSchedulers(): void {
    for (const timer of schedulerTimers.values()) clearInterval(timer);
    schedulerTimers.clear();
}

export async function ensureLfgPanelForGuild(guild: Guild): Promise<void> {
    const channel = guild.channels.cache.get(LFG_PANEL_CHANNEL_ID) || await guild.channels.fetch(LFG_PANEL_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`[lfg] Panel channel ${LFG_PANEL_CHANNEL_ID} is missing or is not a text channel in guild ${guild.id}.`);
        return;
    }
    const payload = buildLfgPanel();
    const storedId = getGuildPanelMessageId(guild.id, "lfg");
    if (storedId) {
        const stored = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof DiscordAPIError && error.code === 10008) return null;
            throw error;
        });
        if (stored?.author.id === guild.client.user.id && stored.embeds[0]?.title === LFG_PANEL_TITLE) {
            await stored.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === LFG_PANEL_TITLE);
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    setGuildPanelMessageId(guild.id, "lfg", message.id);
}

export async function handleLfgInteraction(interaction: Interaction): Promise<boolean> {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return false;
    if (!interaction.customId.startsWith(LFG_PREFIX)) return false;
    try {
        const [, action, id] = interaction.customId.split(":");
        const guild = interaction.guild;
        if (!guild) throw new Error("LFG requests are available only in a server.");

        if (action === "open" && interaction.isButton()) {
            const session = createSetup(guild.id, interaction.user.id);
            await interaction.reply({ ...buildLfgSetup(session), flags: MessageFlags.Ephemeral });
            return true;
        }

        if ((action === "color" || action === "voice") && interaction.isStringSelectMenu()) {
            const session = getSetup(id, interaction.user.id, guild.id);
            const choice = interaction.values[0];
            if (action === "color") {
                if (!Object.prototype.hasOwnProperty.call(LFG_COLORS, choice)) throw new Error("Choose a color from the menu.");
                session.color = choice as LfgColor;
            } else {
                if (!["any", "required", "not_required"].includes(choice)) throw new Error("Choose a voice chat option from the menu.");
                session.voicePreference = choice as LfgVoicePreference;
            }
            await interaction.update(buildLfgSetup(session));
            return true;
        }

        if (action === "details" && interaction.isButton()) {
            await interaction.showModal(buildLfgDetailsModal(getSetup(id, interaction.user.id, guild.id)));
            return true;
        }

        if (action === "details_submit" && interaction.isModalSubmit()) {
            const session = getSetup(id, interaction.user.id, guild.id);
            const details = validateLfgRequest(
                interaction.fields.getTextInputValue("game"), interaction.fields.getTextInputValue("players"),
                interaction.fields.getTextInputValue("comments"), interaction.fields.getTextInputValue("platform"),
                interaction.fields.getTextInputValue("region")
            );
            Object.assign(session, details);
            session.playerCount = String(details.maxPlayers);
            await interaction.reply({ ...buildLfgSetup(session), flags: MessageFlags.Ephemeral });
            return true;
        }

        if (action === "start_time" && interaction.isButton()) {
            await interaction.showModal(buildLfgStartTimeModal(getSetup(id, interaction.user.id, guild.id)));
            return true;
        }

        if (action === "start_time_submit" && interaction.isModalSubmit()) {
            const session = getSetup(id, interaction.user.id, guild.id);
            session.startsAt = parseLfgStartTime(interaction.fields.getTextInputValue("starts_at"));
            await interaction.reply({ ...buildLfgSetup(session), flags: MessageFlags.Ephemeral });
            return true;
        }

        if (action === "cancel" && interaction.isButton()) {
            getSetup(id, interaction.user.id, guild.id);
            setupSessions.delete(id);
            await interaction.update({ content: "LFG setup canceled.", embeds: [], components: [] });
            return true;
        }

        if (action === "publish" && interaction.isButton()) {
            const session = getSetup(id, interaction.user.id, guild.id);
            const details = validateLfgRequest(session.game, session.playerCount, session.comments, session.platform, session.region);
            if (session.startsAt !== null && session.startsAt + 2 * 60 * 60 * 1000 <= Date.now()) {
                throw new Error("This start time has expired. Set a new start time before saving.");
            }
            session.publishing = true;
            try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (session.listingId) {
                const updated = getStore().update(session.listingId, interaction.user.id, {
                    ...details, color: session.color, voicePreference: session.voicePreference, startsAt: session.startsAt
                });
                try {
                    await updateMessage(guild, updated);
                } catch (error) {
                    console.error(`[lfg] Saved edit ${updated.id} but its post needs reconciliation:`, error);
                    await interaction.editReply("Your changes were saved. The public post could not refresh yet; the bot will retry automatically.");
                    setupSessions.delete(id);
                    return true;
                }
                await interaction.editReply("Your group request was updated.");
                setupSessions.delete(id);
                return true;
            }

            const destination = await guild.channels.fetch(LFG_POST_CHANNEL_ID);
            if (!destination || destination.type !== ChannelType.GuildText) {
                throw new Error(`LFG destination ${LFG_POST_CHANNEL_ID} is missing or is not a text channel.`);
            }
            const input = {
                ...details, guildId: guild.id, channelId: destination.id, hostId: interaction.user.id,
                color: session.color, voicePreference: session.voicePreference, startsAt: session.startsAt
            };
            const listing = getStore().create(input);
            let message: Message | null = null;
            try {
                message = await destination.send({
                    ...buildLfgPost(listing),
                    content: `🎮 New group hosted by <@${listing.hostId}>`,
                    allowedMentions: { users: [listing.hostId], parse: [] }
                });
                const saved = getStore().setMessageId(listing.id, message.id);
                getStore().markRendered(listing.id, saved.revision);
            } catch (error) {
                const cleanupErrors: string[] = [];
                if (message) {
                    try { await message.delete(); }
                    catch (deleteError) {
                        console.error(`[lfg] Could not remove untracked listing ${message.id}:`, deleteError);
                        cleanupErrors.push(`The post may still be visible at ${message.url}`);
                    }
                }
                try { getStore().remove(listing.id); }
                catch (cleanupError) {
                    console.error("[lfg] Could not roll back failed listing:", cleanupError);
                    cleanupErrors.push("The listing state could not be rolled back");
                }
                if (cleanupErrors.length) {
                    throw new Error(`${error instanceof Error ? error.message : "Publishing failed."} ${cleanupErrors.join("; ")}. Check the destination before retrying.`);
                }
                throw error;
            }
            setupSessions.delete(id);
            await interaction.editReply(`Your group request is live: ${message.url}`);
            return true;
            } finally { session.publishing = false; }
        }

        if (["join", "leave", "close", "cancel_listing", "edit"].includes(action) && interaction.isButton()) {
            const listing = getStore().get(id);
            if (!listing || listing.guildId !== guild.id || listing.channelId !== interaction.channelId
                || listing.messageId !== interaction.message.id) throw new Error("This group request is unavailable.");
            if (action === "edit") {
                if (listing.hostId !== interaction.user.id) throw new Error("Only the host can edit this group request.");
                if (listing.status !== "open" || listing.expiresAt <= Date.now()) throw new Error("This group request is unavailable or already closed.");
                const session = createSetup(guild.id, interaction.user.id, listing);
                await interaction.reply({ ...buildLfgSetup(session), flags: MessageFlags.Ephemeral });
                return true;
            }
            if (action === "close" || action === "cancel_listing") {
                const updated = getStore().close(id, interaction.user.id, action === "close" ? "completed" : "canceled");
                await updateFromInteraction(interaction, updated);
                await interaction.followUp({
                    content: action === "close" ? "Your group request is marked complete." : "Your group request was canceled.",
                    flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
                });
                return true;
            }
            const updated = action === "join" ? getStore().join(id, interaction.user.id)
                : getStore().leave(id, interaction.user.id);
            await updateFromInteraction(interaction, updated);
            await interaction.followUp({
                content: action === "join" ? "You joined the group." : "You left the group.",
                flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
            });
            if (interaction.user.id !== listing.hostId) {
                const verb = action === "join" ? "joined" : "left";
                try {
                    const host = await guild.client.users.fetch(listing.hostId);
                    await host.send({
                        content: `<@${interaction.user.id}> ${verb} your ${listing.game} group (${updated.playerIds.length}/${updated.maxPlayers}).`,
                        allowedMentions: { parse: [] }
                    });
                } catch (error) {
                    console.error(`[lfg] Could not notify host ${listing.hostId} about a group ${verb}:`, error);
                }
            }
            return true;
        }

        if (action === "report" && interaction.isButton()) {
            const listing = getStore().get(id);
            if (!listing || listing.guildId !== guild.id || listing.channelId !== interaction.channelId
                || listing.messageId !== interaction.message.id) throw new Error("This group request is unavailable.");
            await interaction.showModal(buildLfgReportModal(id));
            return true;
        }

        if (action === "report_submit" && interaction.isModalSubmit()) {
            const reason = interaction.fields.getTextInputValue("reason").trim();
            if (reason.length < 5 || reason.length > 500) throw new Error("Explain the concern in 5-500 characters.");
            const listing = getStore().get(id);
            if (!listing || listing.guildId !== guild.id) throw new Error("This group request is unavailable.");
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const report = getStore().createReport(id, interaction.user.id, reason);
            await deliverPendingReports(guild);
            const stillPending = getStore().pendingReports(guild.id).some(item => item.id === report.id);
            await interaction.editReply(stillPending
                ? "Your report was saved and is queued for staff notification. If this is urgent, contact a moderator directly."
                : "Your report was sent to staff for review.");
            return true;
        }

        throw new Error("This LFG control is invalid. Reopen the panel and try again.");
    } catch (error) {
        console.error("[lfg]", error);
        const content = error instanceof Error ? error.message : "The LFG action failed unexpectedly.";
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        } else if (interaction.isRepliable()) {
            await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
        return true;
    }
}
