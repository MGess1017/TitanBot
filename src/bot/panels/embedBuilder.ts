import { randomUUID } from "node:crypto";
import { ChannelType, DiscordAPIError, MessageFlags, PermissionFlagsBits, type Guild, type Interaction } from "discord.js";
import {
    buildStaffEmbedEditor, buildStaffEmbedMessage, buildStaffEmbedModal, buildStaffEmbedPanel,
    STAFF_EMBED_COLORS, STAFF_EMBED_PANEL_TITLE, STAFF_EMBED_PREFIX, validateStaffEmbedText,
    type StaffEmbedColor, type StaffEmbedDraft
} from "../../features/embedBuilder";
import { STAFF_EMBED_CHANNEL_ID } from "../core/config";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { isStaffMember } from "../staff/staffDesk";
import { appendAuditEvent } from "../core/audit";

const staffEmbedDrafts = new Map<string, StaffEmbedDraft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;

export async function ensureStaffEmbedPanelForGuild(guild: Guild): Promise<void> {
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
        if (message?.author.id === guild.client.user.id && message.embeds[0]?.title === STAFF_EMBED_PANEL_TITLE) {
            await message.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === STAFF_EMBED_PANEL_TITLE);
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    setGuildPanelMessageId(guild.id, "staffEmbed", message.id);
}

export async function handleStaffEmbedInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit())
        || !interaction.customId.startsWith(STAFF_EMBED_PREFIX)) return false;
    const guild = interaction.guild;
    try {
        const member = guild ? await guild.members.fetch(interaction.user.id) : null;
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
        const draft = staffEmbedDrafts.get(id);
        if (extra.length || !draft || draft.ownerId !== member.id || draft.guildId !== guild.id || draft.status !== "editing") {
            throw new Error("This draft expired, belongs to another staff member, or has already been submitted. Start a new announcement.");
        }
        if (interaction.isButton() && action === "text") {
            await interaction.showModal(buildStaffEmbedModal(draft));
            return true;
        }
        if (interaction.isModalSubmit() && action === "save") {
            const text = validateStaffEmbedText(interaction.fields.getTextInputValue("title"), interaction.fields.getTextInputValue("description"));
            draft.title = text.title;
            draft.description = text.description;
            if (interaction.isFromMessage()) await interaction.update(buildStaffEmbedEditor(draft));
            else await interaction.reply({ ...buildStaffEmbedEditor(draft), flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!interaction.isMessageComponent()) throw new Error("This control is invalid. Reopen the builder.");
        if (interaction.isButton() && action === "publish") {
            const payload = buildStaffEmbedMessage(draft);
            draft.status = "publishing";
            await interaction.deferUpdate();
            try {
                const channel = await guild.channels.fetch(draft.channelId!);
                if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
                    throw new Error("Choose a server text or announcement channel.");
                }
                const botMember = await guild.members.fetchMe();
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
                    const role = await guild.roles.fetch(roleId);
                    if (!role || role.id === guild.id || (!role.mentionable && !canMention)) {
                        throw new Error("A selected role cannot be notified. Remove it or check Mention Everyone permission.");
                    }
                }
                for (const userId of draft.userIds) await guild.members.fetch(userId);
                const sent = await channel.send(payload);
                draft.status = "published";
                appendAuditEvent("staff_embed_published", {
                    guildId: guild.id, actorId: member.id, channelId: channel.id, messageId: sent.id,
                    color: draft.color, userMentions: draft.userIds.length, roleMentions: draft.roleIds.length, everyone: draft.everyone
                });
                await interaction.editReply({ content: `Announcement posted: ${sent.url}`, embeds: [], components: [], allowedMentions: { parse: [] } });
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
