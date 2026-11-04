// Staff desk (/staff): staff checks, case files, and settings.
import {
    APIEmbed, ChannelType, EmbedBuilder, GuildMember, Message, type APIInteractionGuildMember, MessageFlags,
    PermissionFlagsBits, TextChannel, type Interaction
} from "discord.js";
import {
    FEATURE_TOGGLES, REWARD_SETTINGS, ANTI_RAID_SETTINGS, type ChannelSetting, type FeatureToggle,
    type RewardSetting, type AntiRaidSetting
} from "../../features/botSettings";
import { buildCaseHistoryLines, getChecklist, searchKnowledgeBase } from "../../features/staffDesk";
import {
    buildAntiRaidModal, buildCaseLookupPicker, buildCaseView, buildHealthPayload, buildIncidentLog,
    buildKbAddModal, buildKbResults, buildKbSearchModal, buildRewardsModal, buildSettingsPayload, buildStaffHome,
    parseNumericFields, STAFF_IDS, type SettingsView, type StaffPayload
} from "../../features/staffHub";
import { ensureCheckpointCardPanel } from "../panels/playerCards";
import { client } from "../core/client";
import { ensureXpCratePanel, refreshXpLeaderboardPanel, scheduleXpLeaderboardUpdate } from "../panels/xpPanels";
import {
    antiRaidIncidents, applyRewardSettings, botSettingsStore, knowledgeBase, recordSaveResult
} from "../core/settings";
import { runAsyncWithBoundary } from "../core/metrics";
import { appendAuditEvent } from "../core/audit";
import {
    ensureGuildModeration, getGuildPanelMessageId, getGuildUserReports, type GuildPanelKey, setGuildPanelMessageId
} from "../moderation/store";
import { findTicketByChannel, saveTicketStore, type TicketEntry, ticketStore } from "../tickets/store";
import { handleAntiRaidAction, lastHealthIssues, runStaffHealthCheck } from "./safety";

export function isStaffMember(member: GuildMember | APIInteractionGuildMember | null | undefined): boolean {
    if (!member) return false;
    const permissions = member.permissions;
    const isAdmin = typeof permissions === "string"
        ? (BigInt(permissions) & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator
        : permissions.has(PermissionFlagsBits.Administrator);
    if (isAdmin) return true;
    const roleIds: string[] = Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
    const staffRoles = botSettingsStore.get().staffRoleIds;
    return roleIds.some(id => staffRoles.includes(id));
}

export async function fetchGuildTextChannel(channelId: string): Promise<TextChannel | null> {
    if (!channelId) return null;
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
    return channel && channel.type === ChannelType.GuildText ? channel : null;
}

export async function postStaffAlert(payload: { content?: string; embeds: APIEmbed[]; components?: StaffPayload["components"] }, roleMentions: string[] = []): Promise<Message | null> {
    const channel = await fetchGuildTextChannel(botSettingsStore.get().channels.modAlerts);
    if (!channel) {
        console.warn("[staff] Staff alert channel is missing or not a text channel.");
        return null;
    }
    return channel.send({ ...payload, allowedMentions: { parse: [], roles: roleMentions } });
}

export function buildStaffHomeFor(guildId: string, channelId: string | null): StaffPayload {
    const now = Date.now();
    const ticket = channelId ? findTicketByChannel(channelId) : null;
    return buildStaffHome({
        ticketId: ticket && ticket.guildId === guildId ? ticket.id : null,
        openTickets: ticketStore.tickets.filter(entry => entry.guildId === guildId && (entry.status === "open" || entry.status === "claimed")).length,
        recentIncidents: antiRaidIncidents.recent(guildId, 200).filter(incident => now - incident.at <= 24 * 60 * 60 * 1000).length,
        healthIssues: lastHealthIssues.length
    });
}

function buildCaseFile(guildId: string, userId: string, ticket: TicketEntry | null): StaffPayload {
    const moderation = ensureGuildModeration(guildId);
    const history = buildCaseHistoryLines({
        userId,
        tickets: ticketStore.tickets.filter(entry => entry.guildId === guildId && entry.ownerId === userId),
        reports: getGuildUserReports(guildId).filter(report => report.targetUserId === userId),
        warnings: (moderation.warnings[userId] || []).map(warning => ({ reason: warning.reason, at: warning.timestamp, moderatorId: warning.moderatorId })),
        alerts: antiRaidIncidents.forUser(guildId, userId).map(incident => ({
            kind: incident.kind, at: incident.at, action: incident.actions.length ? incident.actions[incident.actions.length - 1].type : null
        }))
    });
    return buildCaseView({
        userId,
        summary: history.summary,
        sections: history.sections,
        ticket: ticket ? {
            id: ticket.id,
            category: ticket.category || "general",
            reason: ticket.reason,
            checklist: getChecklist(ticket.category),
            done: ticket.checklist || {}
        } : null
    });
}

async function logSettingsChange(actorId: string, summary: string): Promise<void> {
    appendAuditEvent("bot_settings_changed", { actorId, summary });
    await postStaffAlert({
        embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle("⚙️ Bot Settings Changed")
            .setDescription(`${summary}\nBy <@${actorId}>`).setTimestamp().toJSON()]
    }).catch(error => console.warn("[staff] Could not log settings change:", error));
}

async function relocatePanelsForChannel(setting: ChannelSetting, oldChannelId: string, guildId: string): Promise<void> {
    const panels: GuildPanelKey[] = setting === "xpPanels" ? ["xpLeaderboard", "xpCrate"] : setting === "checkpointCards" ? ["checkpointCard"] : [];
    const oldChannel = await fetchGuildTextChannel(oldChannelId);
    for (const panel of panels) {
        const messageId = getGuildPanelMessageId(guildId, panel);
        if (messageId && oldChannel) await oldChannel.messages.delete(messageId).catch(() => undefined);
        setGuildPanelMessageId(guildId, panel, null);
    }
    if (setting === "xpPanels") {
        await refreshXpLeaderboardPanel();
        await ensureXpCratePanel();
    } else if (setting === "checkpointCards") {
        await ensureCheckpointCardPanel();
    }
}

function settingsUpdateFailedReply(): string {
    return "❌ Settings could not be saved to disk, so nothing changed. Check the health report.";
}

async function respondStaff(interaction: Interaction, payload: StaffPayload, content = ""): Promise<void> {
    if (interaction.isMessageComponent()) {
        await interaction.update({ content, embeds: payload.embeds, components: payload.components });
    } else if (interaction.isModalSubmit() && interaction.isFromMessage()) {
        await interaction.update({ content, embeds: payload.embeds, components: payload.components });
    } else if (interaction.isRepliable()) {
        await interaction.reply({ content, embeds: payload.embeds, components: payload.components, flags: MessageFlags.Ephemeral });
    }
}

export async function handleStaffInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isMessageComponent() || interaction.isModalSubmit())) return false;
    const customId = interaction.customId;
    if (!customId.startsWith("staff:") && !customId.startsWith(`${STAFF_IDS.alert}:`)) return false;
    if (!interaction.guild || !isStaffMember(interaction.member)) {
        await interaction.reply({ content: "Staff only.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const guild = interaction.guild;
    const actorId = interaction.user.id;

    if (customId.startsWith(`${STAFF_IDS.alert}:`)) {
        await handleAntiRaidAction(interaction, guild);
        return true;
    }
    if (customId === STAFF_IDS.home) {
        await respondStaff(interaction, buildStaffHomeFor(guild.id, interaction.channelId));
        return true;
    }
    if (customId.startsWith(`${STAFF_IDS.settings}:`)) {
        const view = customId.slice(STAFF_IDS.settings.length + 1) as SettingsView;
        await respondStaff(interaction, buildSettingsPayload(botSettingsStore.get(), view));
        return true;
    }
    if (customId === STAFF_IDS.health && interaction.isButton()) {
        await interaction.deferUpdate();
        const report = await runStaffHealthCheck("manual");
        await interaction.editReply({ content: "", ...buildHealthPayload(report.issues, Date.now(), report.notes) });
        return true;
    }
    if (customId === STAFF_IDS.kbSearch && interaction.isButton()) {
        await interaction.showModal(buildKbSearchModal());
        return true;
    }
    if (customId === STAFF_IDS.kbAdd && interaction.isButton()) {
        await interaction.showModal(buildKbAddModal());
        return true;
    }
    if (customId === STAFF_IDS.kbSearchModal && interaction.isModalSubmit()) {
        const query = interaction.fields.getTextInputValue("query");
        const resolved = ticketStore.tickets
            .filter(ticket => ticket.guildId === guild.id && (ticket.resolvedReason || ticket.closedReason))
            .map(ticket => ({
                id: ticket.id,
                text: `${ticket.reason} ${(ticket.tags || []).join(" ")} ${ticket.category || ""} ${(ticket.internalNotes || []).map(note => note.note).join(" ")}`,
                resolution: ticket.resolvedReason || ticket.closedReason || ""
            }));
        await respondStaff(interaction, buildKbResults(query, searchKnowledgeBase(query, knowledgeBase.all(), resolved)));
        return true;
    }
    if (customId === STAFF_IDS.kbAddModal && interaction.isModalSubmit()) {
        try {
            const article = knowledgeBase.add({
                title: interaction.fields.getTextInputValue("title"),
                body: interaction.fields.getTextInputValue("body"),
                tags: interaction.fields.getTextInputValue("tags").split(","),
                authorId: actorId
            });
            recordSaveResult("knowledgeBase", true);
            appendAuditEvent("kb_article_added", { actorId, articleId: article.id, title: article.title });
            await respondStaff(interaction, buildKbResults(article.title, [{ kind: "article", article, score: 1 }]), `✅ Article **${article.title}** added to the knowledge base.`);
        } catch (error) {
            recordSaveResult("knowledgeBase", false, error);
            await interaction.reply({ content: "❌ The article could not be saved.", flags: MessageFlags.Ephemeral });
        }
        return true;
    }
    if (customId === STAFF_IDS.caseLookup) {
        const ticket = interaction.channelId ? findTicketByChannel(interaction.channelId) : null;
        await respondStaff(interaction, ticket && ticket.guildId === guild.id ? buildCaseFile(guild.id, ticket.ownerId, ticket) : buildCaseLookupPicker());
        return true;
    }
    if (customId === STAFF_IDS.caseUser && interaction.isUserSelectMenu()) {
        await respondStaff(interaction, buildCaseFile(guild.id, interaction.values[0], null));
        return true;
    }
    if (customId.startsWith(`${STAFF_IDS.checklist}:`) && interaction.isButton()) {
        const [ticketIdRaw, itemId] = customId.slice(STAFF_IDS.checklist.length + 1).split(":");
        const ticket = ticketStore.tickets.find(entry => entry.id === Number(ticketIdRaw) && entry.guildId === guild.id);
        if (!ticket || !getChecklist(ticket.category).some(item => item.id === itemId)) {
            await interaction.reply({ content: "That ticket or checklist item no longer exists.", flags: MessageFlags.Ephemeral });
            return true;
        }
        const checklist = { ...(ticket.checklist || {}) };
        if (checklist[itemId]) delete checklist[itemId];
        else checklist[itemId] = { byId: actorId, at: Date.now() };
        const previous = ticket.checklist;
        ticket.checklist = checklist;
        ticket.events = [...(ticket.events || []), { at: Date.now(), actorId, type: "checklist", detail: `${checklist[itemId] ? "Checked" : "Unchecked"}: ${itemId}` }].slice(-100);
        if (!saveTicketStore()) {
            ticket.checklist = previous;
            await interaction.reply({ content: "❌ The checklist could not be saved. Try again.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, buildCaseFile(guild.id, ticket.ownerId, ticket));
        return true;
    }
    if (customId === STAFF_IDS.incidents) {
        await respondStaff(interaction, buildIncidentLog(antiRaidIncidents.recent(guild.id, 15)));
        return true;
    }

    // Settings mutations
    if (customId.startsWith(`${STAFF_IDS.channel}:`) && interaction.isChannelSelectMenu()) {
        const key = customId.slice(STAFF_IDS.channel.length + 1) as ChannelSetting;
        const channelId = interaction.values[0];
        const oldChannelId = botSettingsStore.get().channels[key];
        if (!channelId || channelId === oldChannelId) {
            await respondStaff(interaction, buildSettingsPayload(botSettingsStore.get(), "channels"));
            return true;
        }
        if (!botSettingsStore.update(actorId, draft => { draft.channels[key] = channelId; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, buildSettingsPayload(botSettingsStore.get(), "channels"), `✅ Updated. Moving panels to <#${channelId}>…`);
        void logSettingsChange(actorId, `Channel **${key}**: <#${oldChannelId}> → <#${channelId}>`);
        runAsyncWithBoundary("relocatePanels", () => relocatePanelsForChannel(key, oldChannelId, guild.id));
        return true;
    }
    if (customId === STAFF_IDS.roles && interaction.isRoleSelectMenu()) {
        const roleIds = [...interaction.values];
        if (!botSettingsStore.update(actorId, draft => { draft.staffRoleIds = roleIds; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, buildSettingsPayload(botSettingsStore.get(), "roles"), "✅ Staff roles updated.");
        void logSettingsChange(actorId, `Staff roles: ${roleIds.map(id => `<@&${id}>`).join(" ") || "administrators only"}`);
        return true;
    }
    if (customId.startsWith(`${STAFF_IDS.feature}:`) && interaction.isButton()) {
        const key = customId.slice(STAFF_IDS.feature.length + 1) as FeatureToggle;
        if (!Object.prototype.hasOwnProperty.call(FEATURE_TOGGLES, key)) return true;
        const next = !botSettingsStore.get().features[key];
        if (!botSettingsStore.update(actorId, draft => { draft.features[key] = next; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, buildSettingsPayload(botSettingsStore.get(), "features"));
        void logSettingsChange(actorId, `Feature **${FEATURE_TOGGLES[key]}** turned **${next ? "on" : "off"}**`);
        return true;
    }
    if (customId === STAFF_IDS.rewardsModal && interaction.isButton()) {
        await interaction.showModal(buildRewardsModal(botSettingsStore.get()));
        return true;
    }
    if (customId === STAFF_IDS.antiRaidModal && interaction.isButton()) {
        await interaction.showModal(buildAntiRaidModal(botSettingsStore.get()));
        return true;
    }
    if (customId === STAFF_IDS.rewardsSubmit && interaction.isModalSubmit()) {
        const raw = Object.fromEntries(Object.keys(REWARD_SETTINGS).map(key => [key, interaction.fields.getTextInputValue(key)])) as Record<RewardSetting, string>;
        const parsed = parseNumericFields(raw, REWARD_SETTINGS);
        if (!parsed.ok) {
            await interaction.reply({ content: `❌ Not saved:\n${parsed.errors.map(error => `• ${error}`).join("\n")}`, flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!botSettingsStore.update(actorId, draft => { draft.rewards = { ...parsed.values }; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: MessageFlags.Ephemeral });
            return true;
        }
        applyRewardSettings();
        scheduleXpLeaderboardUpdate();
        await respondStaff(interaction, buildSettingsPayload(botSettingsStore.get(), "rewards"), "✅ Rewards updated and live.");
        void logSettingsChange(actorId, (Object.entries(REWARD_SETTINGS) as Array<[RewardSetting, { label: string }]>)
            .map(([key, spec]) => `${spec.label}: **${parsed.values[key]}**`).join("\n"));
        return true;
    }
    if (customId === STAFF_IDS.antiRaidSubmit && interaction.isModalSubmit()) {
        const raw = Object.fromEntries(Object.keys(ANTI_RAID_SETTINGS).map(key => [key, interaction.fields.getTextInputValue(key)])) as Record<AntiRaidSetting, string>;
        const parsed = parseNumericFields(raw, ANTI_RAID_SETTINGS);
        if (!parsed.ok) {
            await interaction.reply({ content: `❌ Not saved:\n${parsed.errors.map(error => `• ${error}`).join("\n")}`, flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!botSettingsStore.update(actorId, draft => { draft.antiRaid = { ...draft.antiRaid, ...parsed.values }; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, buildSettingsPayload(botSettingsStore.get(), "antiraid"), "✅ Spam alert thresholds updated.");
        void logSettingsChange(actorId, (Object.entries(ANTI_RAID_SETTINGS) as Array<[AntiRaidSetting, { label: string }]>)
            .map(([key, spec]) => `${spec.label}: **${parsed.values[key]}**`).join("\n"));
        return true;
    }
    if (customId === STAFF_IDS.timeoutMinutes && interaction.isStringSelectMenu()) {
        const minutes = Number(interaction.values[0]);
        if (!botSettingsStore.update(actorId, draft => { draft.antiRaid.timeoutMinutes = minutes; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, buildSettingsPayload(botSettingsStore.get(), "antiraid"));
        void logSettingsChange(actorId, `Spam alert timeout length: **${minutes} min**`);
        return true;
    }
    return true;
}
