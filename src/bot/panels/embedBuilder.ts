import { randomUUID } from "node:crypto";
import path from "node:path";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, ChannelType, DiscordAPIError, MessageFlags, PermissionFlagsBits, type Guild, type Interaction } from "discord.js";
import {
    buildStaffEmbedEditor, buildStaffEmbedMessage, buildStaffEmbedModal, buildStaffEmbedPanel,
    buildStaffEmbedHome, buildStaffEmbedBackRow, buildStaffEmbedSaveModal, buildStaffEmbedScheduleModal, formatStaffEmbedSchedule, parseStaffEmbedSchedule,
    STAFF_EMBED_TEMPLATES, STAFF_EMBED_COLORS, STAFF_EMBED_PANEL_TITLE, STAFF_EMBED_LEGACY_PANEL_TITLE, STAFF_EMBED_PREFIX, validateStaffEmbedText,
    type StaffEmbedColor, type StaffEmbedDraft
} from "../../features/embedBuilder";
import { STAFF_EMBED_CHANNEL_ID } from "../core/config";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { isStaffMember } from "../staff/staffDesk";
import { appendAuditEvent } from "../core/audit";
import { BOT_SRC_DIR } from "../core/paths";
import { EmbedStudioStore, type StudioPublication } from "../../runtime/embedStudioStore";

const staffEmbedDrafts = new Map<string, StaffEmbedDraft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;
let studioStore: EmbedStudioStore | undefined;
const studioTimers = new Map<string, NodeJS.Timeout>();
const studioRunning = new Set<string>();

function getStudioStore(): EmbedStudioStore {
    return studioStore ??= new EmbedStudioStore(path.resolve(BOT_SRC_DIR, "../src/data/embed-studio.json"));
}

async function publishStaffEmbed(guild: Guild, publication: StudioPublication): Promise<string> {
    const draft = publication.draft;
    const member = await guild.members.fetch({ user: draft.ownerId, force: true });
    if (!isStaffMember(member)) throw new Error("The author is no longer authorized staff.");
    const channel = await guild.channels.fetch(draft.channelId!, { force: true });
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
        throw new Error("Choose a server text or announcement channel.");
    }
    const botMember = await guild.members.fetchMe({ force: true });
    const memberPermissions = channel.permissionsFor(member);
    const botPermissions = channel.permissionsFor(botMember);
    if (!memberPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        throw new Error("You need View Channel and Send Messages in the destination.");
    }
    if (!botPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        throw new Error("The bot needs View Channel, Send Messages and Embed Links in the destination.");
    }
    const canMention = memberPermissions.has(PermissionFlagsBits.MentionEveryone) && botPermissions.has(PermissionFlagsBits.MentionEveryone);
    if (draft.everyone && !canMention) throw new Error("Both you and the bot need Mention Everyone permission to use @everyone.");
    for (const roleId of draft.roleIds) {
        const role = await guild.roles.fetch(roleId, { force: true });
        if (!role || role.id === guild.id || (!role.mentionable && !canMention)) {
            throw new Error("A selected role cannot be notified. Remove it or check Mention Everyone permission.");
        }
    }
    for (const userId of draft.userIds) await guild.members.fetch({ user: userId, force: true });
    const sent = await channel.send({ ...buildStaffEmbedMessage(draft), nonce: publication.id.replace(/-/g, "").slice(0, 24), enforceNonce: true });
    return sent.url;
}

async function deliverStaffEmbed(guild: Guild, publication: StudioPublication): Promise<string> {
    let url: string;
    try {
        url = await publishStaffEmbed(guild, publication);
    } catch (error) {
        getStudioStore().finish(publication.id, { error: `${error instanceof Error ? error.message : "Publication failed."} Delivery may be uncertain; check the destination before retrying.` });
        throw error;
    }
    // A failed receipt write must never make this durable claim eligible for another send.
    try { getStudioStore().finish(publication.id, { url }); }
    catch {
        throw new Error(`Announcement was posted: ${url}, but its history receipt could not be saved. Do not retry this publication.`);
    }
    try {
        appendAuditEvent("staff_embed_published", {
            guildId: guild.id, actorId: publication.draft.ownerId, channelId: publication.draft.channelId,
            messageId: url.split("/").pop(), color: publication.draft.color,
            userMentions: publication.draft.userIds.length, roleMentions: publication.draft.roleIds.length,
            everyone: publication.draft.everyone, publicationId: publication.id, url, scheduled: publication.timezone !== "Immediate"
        });
    } catch (error) { console.error("[embedStudio] Publication audit failed:", error); }
    return url;
}

export async function runStaffEmbedSchedules(guild: Guild): Promise<void> {
    if (studioRunning.has(guild.id)) return;
    studioRunning.add(guild.id);
    try {
        for (const due of getStudioStore().due(guild.id)) {
            const claimed = getStudioStore().claim(due.id);
            if (!claimed) continue;
            let content: string;
            try {
                const url = await deliverStaffEmbed(guild, claimed);
                content = `FNTCORD scheduled announcement posted: ${url}`;
            } catch (error) {
                console.error(`[embedStudio] Scheduled publication ${claimed.id} failed:`, error);
                content = `FNTCORD scheduled announcement failed: ${error instanceof Error ? error.message : "Unknown failure"}. Check the destination before retrying. Open the private studio's publication history for details.`;
            }
            try {
                const owner = await guild.client.users.fetch(claimed.draft.ownerId);
                await owner.send({ content: content.slice(0, 1800), allowedMentions: { parse: [] } });
            } catch (error) { console.error(`[embedStudio] Could not notify author for ${claimed.id}; see private history:`, error); }
        }
    } finally { studioRunning.delete(guild.id); }
}

export async function ensureStaffEmbedSchedulerForGuild(guild: Guild): Promise<void> {
    if (!studioTimers.has(guild.id)) {
        getStudioStore();
        const tick = () => runStaffEmbedSchedules(guild).catch(error => console.error("[embedStudio] Scheduler failed:", error));
        const timer = setInterval(tick, 15_000);
        timer.unref();
        studioTimers.set(guild.id, timer);
        await tick();
    }
}

export function stopStaffEmbedScheduler(guildId?: string): void {
    for (const [id, timer] of studioTimers) {
        if (guildId !== undefined && guildId !== id) continue;
        clearInterval(timer);
        studioTimers.delete(id);
    }
}

export async function ensureStaffEmbedPanelForGuild(guild: Guild): Promise<void> {
    await ensureStaffEmbedSchedulerForGuild(guild);
    const channel = guild.channels.cache.get(STAFF_EMBED_CHANNEL_ID) || await guild.channels.fetch(STAFF_EMBED_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`[embedStudio] Channel ${STAFF_EMBED_CHANNEL_ID} is missing or not a text channel in guild ${guild.id}.`);
        return;
    }
    const payload = buildStaffEmbedPanel();
    const storedId = getGuildPanelMessageId(guild.id, "staffEmbed");
    if (storedId) {
        const message = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof DiscordAPIError && error.code === 10008) return null;
            throw error;
        });
        if (message?.author.id === guild.client.user.id
            && [STAFF_EMBED_PANEL_TITLE, STAFF_EMBED_LEGACY_PANEL_TITLE].includes(message.embeds[0]?.title || "")) {
            await message.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id
        && [STAFF_EMBED_PANEL_TITLE, STAFF_EMBED_LEGACY_PANEL_TITLE].includes(message.embeds[0]?.title || ""));
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    setGuildPanelMessageId(guild.id, "staffEmbed", message.id);
}

export async function handleStaffEmbedInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit())
        || !interaction.customId.startsWith(STAFF_EMBED_PREFIX)) return false;
    const guild = interaction.guild;
    try {
        const member = guild ? await guild.members.fetch({ user: interaction.user.id, force: true }) : null;
        if (!guild || !member || !isStaffMember(member)) {
            await interaction.reply({ content: "This announcement builder is for staff only.", flags: MessageFlags.Ephemeral });
            return true;
        }
        for (const [id, draft] of staffEmbedDrafts) {
            if (draft.expiresAt <= Date.now() && draft.status !== "publishing") staffEmbedDrafts.delete(id);
        }
        if (interaction.isButton() && interaction.customId === `${STAFF_EMBED_PREFIX}start`) {
            if (staffEmbedDrafts.size >= 1000) throw new Error("The announcement builder is busy. Please try again later.");
            for (const [id, draft] of staffEmbedDrafts) {
                if (draft.ownerId === member.id && draft.guildId === guild.id && draft.status !== "publishing") staffEmbedDrafts.delete(id);
            }
            const draft: StaffEmbedDraft = {
                id: randomUUID(), ownerId: member.id, guildId: guild.id, expiresAt: Date.now() + DRAFT_TTL_MS,
                channelId: null, color: "Purple", userIds: [], roleIds: [], everyone: false, title: "", description: "", status: "editing"
            };
            staffEmbedDrafts.set(draft.id, draft);
            await interaction.reply({ ...buildStaffEmbedEditor(draft), flags: MessageFlags.Ephemeral });
            return true;
        }
        const [action, id, ...extra] = interaction.customId.slice(STAFF_EMBED_PREFIX.length).split(":");
        let draft = staffEmbedDrafts.get(id);
        const navigating = interaction.isButton() && ["home", "back", "refresh", "refresh_home", "customize"].includes(action);
        if (navigating && !extra.length && draft?.ownerId === member.id && draft.guildId === guild.id && draft.status !== "editing" && draft.status !== "publishing") {
            draft = { ...draft, id: randomUUID(), status: "editing", expiresAt: Date.now() + DRAFT_TTL_MS };
            delete draft.pendingSchedule;
            staffEmbedDrafts.delete(id);
            staffEmbedDrafts.set(draft.id, draft);
        }
        const validConfirmation = action === "confirm_schedule" && extra.length === 1 && extra[0] === draft?.pendingSchedule?.confirmationId;
        if ((extra.length && !validConfirmation) || (action === "confirm_schedule" && !validConfirmation)
            || !draft || draft.ownerId !== member.id || draft.guildId !== guild.id || draft.status !== "editing") {
            throw new Error("This draft expired, belongs to another staff member, or has already been submitted. Start a new announcement.");
        }
        if (interaction.isButton() && action === "text") {
            await interaction.showModal(buildStaffEmbedModal(draft));
            return true;
        }
        if (navigating) {
            delete draft.pendingSchedule;
            await interaction.update(action === "home" || action === "refresh_home" ? buildStaffEmbedHome(draft) : buildStaffEmbedEditor(draft));
            return true;
        }
        if (interaction.isModalSubmit() && action === "save_draft") {
            getStudioStore().save(interaction.fields.getTextInputValue("name"), draft);
            await interaction.reply({ content: "Private draft saved. Reopen the studio and choose Load saved draft to resume, even after a restart.", components: [buildStaffEmbedBackRow(draft)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            return true;
        }
        if (interaction.isModalSubmit() && action === "schedule") {
            buildStaffEmbedMessage(draft);
            draft.pendingSchedule = { ...parseStaffEmbedSchedule(interaction.fields.getTextInputValue("datetime"), interaction.fields.getTextInputValue("timezone")), confirmationId: randomUUID().slice(0, 16) };
            await interaction.reply({
                content: `**Confirm timezone and publication time**\n${formatStaffEmbedSchedule(draft.pendingSchedule)}\nDestination: <#${draft.channelId}>\nNo schedule is created until you confirm. Staff authorization and permissions will be checked again at send time.`,
                components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`${STAFF_EMBED_PREFIX}confirm_schedule:${draft.id}:${draft.pendingSchedule.confirmationId}`).setLabel("Confirm timezone & schedule").setStyle(ButtonStyle.Success)),
                    buildStaffEmbedBackRow(draft)],
                flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
            });
            return true;
        }
        if (interaction.isButton() && action === "confirm_schedule") {
            if (!draft.pendingSchedule || draft.pendingSchedule.runAt < Date.now() + 60_000) throw new Error("Schedule confirmation expired. Choose the time again.");
            buildStaffEmbedMessage(draft);
            const scheduled = getStudioStore().create(draft, draft.pendingSchedule);
            draft.status = "published";
            await interaction.update({ content: `Scheduled for ${formatStaffEmbedSchedule(scheduled)}.\nOpen a new studio → Publication history to review or cancel. Failures are recorded there; a DM is attempted after delivery.`, embeds: [], components: [buildStaffEmbedBackRow(draft)], allowedMentions: { parse: [] } });
            return true;
        }
        if (interaction.isModalSubmit() && action === "save") {
            const text = validateStaffEmbedText(interaction.fields.getTextInputValue("title"), interaction.fields.getTextInputValue("description"));
            draft.title = text.title;
            draft.description = text.description;
            delete draft.pendingSchedule;
            if (interaction.isFromMessage()) await interaction.update(buildStaffEmbedEditor(draft));
            else await interaction.reply({ ...buildStaffEmbedEditor(draft), flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!interaction.isMessageComponent()) throw new Error("This control is invalid. Reopen the builder.");
        if (interaction.isStringSelectMenu() && action === "studio") {
            const choice = interaction.values[0];
            if (["home", "back", "refresh", "customize"].includes(choice)) {
                delete draft.pendingSchedule;
                await interaction.update(choice === "home" ? buildStaffEmbedHome(draft) : buildStaffEmbedEditor(draft));
            } else if (choice.startsWith("template_")) {
                const key = choice.slice(9);
                if (!Object.prototype.hasOwnProperty.call(STAFF_EMBED_TEMPLATES, key)) throw new Error("Choose a template from the menu.");
                Object.assign(draft, STAFF_EMBED_TEMPLATES[key as keyof typeof STAFF_EMBED_TEMPLATES], { userIds: [], roleIds: [], everyone: false });
                delete draft.pendingSchedule;
                await interaction.update(buildStaffEmbedEditor(draft));
            } else if (choice === "save_draft") {
                await interaction.showModal(buildStaffEmbedSaveModal(draft));
            } else if (choice === "schedule") {
                buildStaffEmbedMessage(draft);
                await interaction.showModal(buildStaffEmbedScheduleModal(draft));
            } else if (choice === "load_draft") {
                const saved = getStudioStore().saved(guild.id, member.id);
                if (!saved.length) throw new Error("You have no saved drafts yet. Use Save draft first.");
                await interaction.reply({ content: "Choose one of your private saved drafts. Loading creates a fresh editable copy.",
                    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
                        .setCustomId(`${STAFF_EMBED_PREFIX}load_draft:${draft.id}`).setPlaceholder("Your saved drafts")
                        .addOptions(saved.map(row => ({ label: row.name, value: row.id })))),
                        buildStaffEmbedBackRow(draft)],
                    flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            } else if (choice === "history") {
                const history = getStudioStore().history(guild.id, member.id);
                const pending = history.filter(row => row.status === "scheduled").slice(0, 25);
                const historyEmbed = new EmbedBuilder().setColor(STAFF_EMBED_COLORS.Purple).setTitle("Your FNTCORD publication history")
                    .setDescription("Latest 10 publications. Uncertain deliveries are never retried automatically.");
                if (!history.length) historyEmbed.setDescription("No publications yet.");
                else historyEmbed.addFields(history.slice(0, 10).map(row => ({
                    name: `${row.status.toUpperCase()} · ${row.draft.title.slice(0, 100)}`,
                    value: `${new Date(row.runAt).toISOString()} (${row.timezone.slice(0, 80)})${row.url ? `\n${row.url}` : ""}${row.error ? `\n${row.error.slice(0, 180)}` : ""}`
                })));
                await interaction.reply({ embeds: [historyEmbed],
                    components: [...(pending.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
                        .setCustomId(`${STAFF_EMBED_PREFIX}cancel_schedule:${draft.id}`).setPlaceholder("Cancel a pending schedule")
                        .addOptions(pending.map(row => ({ label: row.draft.title.slice(0, 100), description: new Date(row.runAt).toISOString(), value: row.id }))))] : []),
                        buildStaffEmbedBackRow(draft)],
                    flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            } else throw new Error("Choose a studio action from the menu.");
            return true;
        }
        if (interaction.isStringSelectMenu() && action === "load_draft") {
            const saved = getStudioStore().saved(guild.id, member.id).find(row => row.id === interaction.values[0]);
            if (!saved) throw new Error("That saved draft is unavailable or belongs to another staff member.");
            Object.assign(draft, saved.draft, { id: draft.id, status: "editing", expiresAt: Date.now() + DRAFT_TTL_MS });
            delete draft.pendingSchedule;
            await interaction.update(buildStaffEmbedEditor(draft));
            return true;
        }
        if (interaction.isStringSelectMenu() && action === "cancel_schedule") {
            getStudioStore().cancel(interaction.values[0], guild.id, member.id);
            await interaction.update({ content: "Schedule canceled. Nothing will be posted by that schedule.", embeds: [], components: [buildStaffEmbedBackRow(draft)], allowedMentions: { parse: [] } });
            return true;
        }
        if (interaction.isButton() && action === "publish") {
            buildStaffEmbedMessage(draft);
            const publication = getStudioStore().create(draft);
            draft.status = "publishing";
            try {
                await interaction.deferUpdate();
                const url = await deliverStaffEmbed(guild, publication);
                draft.status = "published";
                await interaction.editReply({ content: `Announcement posted: ${url}\nSaved in your private publication history.`, embeds: [], components: [buildStaffEmbedBackRow(draft)], allowedMentions: { parse: [] } });
            } catch (error) {
                if (draft.status !== "published") draft.status = "failed";
                throw error;
            }
            return true;
        }
        if (interaction.isChannelSelectMenu() && action === "channel") {
            draft.channelId = interaction.values[0];
        } else if (interaction.isStringSelectMenu() && action === "color") {
            const color = interaction.values[0];
            if (!Object.prototype.hasOwnProperty.call(STAFF_EMBED_COLORS, color)) throw new Error("Choose a named color from the menu.");
            draft.color = color as StaffEmbedColor;
        } else if (interaction.isMentionableSelectMenu() && action === "mentions") {
            draft.userIds = [...interaction.users.keys()];
            draft.roleIds = [...interaction.roles.keys()];
        } else if (interaction.isButton() && action === "everyone") {
            if (!member.permissions.has(PermissionFlagsBits.MentionEveryone)) throw new Error("You need Mention Everyone permission to enable that notification.");
            draft.everyone = !draft.everyone;
        } else if (interaction.isButton() && action === "clear") {
            draft.userIds = [];
            draft.roleIds = [];
            draft.everyone = false;
        } else if (interaction.isButton() && action === "cancel") {
            staffEmbedDrafts.delete(draft.id);
            await interaction.update({ content: "Announcement canceled. Nothing was posted.", embeds: [], components: [] });
            return true;
        } else {
            throw new Error("This builder control is invalid. Start a new announcement.");
        }
        delete draft.pendingSchedule;
        await interaction.update(buildStaffEmbedEditor(draft));
    } catch (error) {
        console.error("[embedStudio] Interaction failed:", error);
        const content = `Announcement builder: ${error instanceof Error ? error.message : "The request failed."}\nIf publishing failed, check the destination before starting a new announcement.`.slice(0, 1800);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content, embeds: [], components: [], allowedMentions: { parse: [] } });
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
    }
    return true;
}
