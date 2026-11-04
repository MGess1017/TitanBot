"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStaffMember = isStaffMember;
exports.fetchGuildTextChannel = fetchGuildTextChannel;
exports.postStaffAlert = postStaffAlert;
exports.buildStaffHomeFor = buildStaffHomeFor;
exports.handleStaffInteraction = handleStaffInteraction;
// Staff desk (/staff): staff checks, case files, and settings.
const discord_js_1 = require("discord.js");
const botSettings_1 = require("../../features/botSettings");
const staffDesk_1 = require("../../features/staffDesk");
const staffHub_1 = require("../../features/staffHub");
const playerCards_1 = require("../panels/playerCards");
const client_1 = require("../core/client");
const xpPanels_1 = require("../panels/xpPanels");
const settings_1 = require("../core/settings");
const metrics_1 = require("../core/metrics");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const store_2 = require("../tickets/store");
const safety_1 = require("./safety");
function isStaffMember(member) {
    if (!member)
        return false;
    const permissions = member.permissions;
    const isAdmin = typeof permissions === "string"
        ? (BigInt(permissions) & discord_js_1.PermissionFlagsBits.Administrator) === discord_js_1.PermissionFlagsBits.Administrator
        : permissions.has(discord_js_1.PermissionFlagsBits.Administrator);
    if (isAdmin)
        return true;
    const roleIds = Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
    const staffRoles = settings_1.botSettingsStore.get().staffRoleIds;
    return roleIds.some(id => staffRoles.includes(id));
}
async function fetchGuildTextChannel(channelId) {
    if (!channelId)
        return null;
    const channel = client_1.client.channels.cache.get(channelId) || await client_1.client.channels.fetch(channelId).catch(() => null);
    return channel && channel.type === discord_js_1.ChannelType.GuildText ? channel : null;
}
async function postStaffAlert(payload, roleMentions = []) {
    const channel = await fetchGuildTextChannel(settings_1.botSettingsStore.get().channels.modAlerts);
    if (!channel) {
        console.warn("[staff] Staff alert channel is missing or not a text channel.");
        return null;
    }
    return channel.send({ ...payload, allowedMentions: { parse: [], roles: roleMentions } });
}
function buildStaffHomeFor(guildId, channelId) {
    const now = Date.now();
    const ticket = channelId ? (0, store_2.findTicketByChannel)(channelId) : null;
    return (0, staffHub_1.buildStaffHome)({
        ticketId: ticket && ticket.guildId === guildId ? ticket.id : null,
        openTickets: store_2.ticketStore.tickets.filter(entry => entry.guildId === guildId && (entry.status === "open" || entry.status === "claimed")).length,
        recentIncidents: settings_1.antiRaidIncidents.recent(guildId, 200).filter(incident => now - incident.at <= 24 * 60 * 60 * 1000).length,
        healthIssues: safety_1.lastHealthIssues.length
    });
}
function buildCaseFile(guildId, userId, ticket) {
    const moderation = (0, store_1.ensureGuildModeration)(guildId);
    const history = (0, staffDesk_1.buildCaseHistoryLines)({
        userId,
        tickets: store_2.ticketStore.tickets.filter(entry => entry.guildId === guildId && entry.ownerId === userId),
        reports: (0, store_1.getGuildUserReports)(guildId).filter(report => report.targetUserId === userId),
        warnings: (moderation.warnings[userId] || []).map(warning => ({ reason: warning.reason, at: warning.timestamp, moderatorId: warning.moderatorId })),
        alerts: settings_1.antiRaidIncidents.forUser(guildId, userId).map(incident => ({
            kind: incident.kind, at: incident.at, action: incident.actions.length ? incident.actions[incident.actions.length - 1].type : null
        }))
    });
    return (0, staffHub_1.buildCaseView)({
        userId,
        summary: history.summary,
        sections: history.sections,
        ticket: ticket ? {
            id: ticket.id,
            category: ticket.category || "general",
            reason: ticket.reason,
            checklist: (0, staffDesk_1.getChecklist)(ticket.category),
            done: ticket.checklist || {}
        } : null
    });
}
async function logSettingsChange(actorId, summary) {
    (0, audit_1.appendAuditEvent)("bot_settings_changed", { actorId, summary });
    await postStaffAlert({
        embeds: [new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle("⚙️ Bot Settings Changed")
                .setDescription(`${summary}\nBy <@${actorId}>`).setTimestamp().toJSON()]
    }).catch(error => console.warn("[staff] Could not log settings change:", error));
}
async function relocatePanelsForChannel(setting, oldChannelId, guildId) {
    const panels = setting === "xpPanels" ? ["xpLeaderboard", "xpCrate"] : setting === "checkpointCards" ? ["checkpointCard"] : [];
    const oldChannel = await fetchGuildTextChannel(oldChannelId);
    for (const panel of panels) {
        const messageId = (0, store_1.getGuildPanelMessageId)(guildId, panel);
        if (messageId && oldChannel)
            await oldChannel.messages.delete(messageId).catch(() => undefined);
        (0, store_1.setGuildPanelMessageId)(guildId, panel, null);
    }
    if (setting === "xpPanels") {
        await (0, xpPanels_1.refreshXpLeaderboardPanel)();
        await (0, xpPanels_1.ensureXpCratePanel)();
    }
    else if (setting === "checkpointCards") {
        await (0, playerCards_1.ensureCheckpointCardPanel)();
    }
}
function settingsUpdateFailedReply() {
    return "❌ Settings could not be saved to disk, so nothing changed. Check the health report.";
}
async function respondStaff(interaction, payload, content = "") {
    if (interaction.isMessageComponent()) {
        await interaction.update({ content, embeds: payload.embeds, components: payload.components });
    }
    else if (interaction.isModalSubmit() && interaction.isFromMessage()) {
        await interaction.update({ content, embeds: payload.embeds, components: payload.components });
    }
    else if (interaction.isRepliable()) {
        await interaction.reply({ content, embeds: payload.embeds, components: payload.components, flags: discord_js_1.MessageFlags.Ephemeral });
    }
}
async function handleStaffInteraction(interaction) {
    if (!(interaction.isMessageComponent() || interaction.isModalSubmit()))
        return false;
    const customId = interaction.customId;
    if (!customId.startsWith("staff:") && !customId.startsWith(`${staffHub_1.STAFF_IDS.alert}:`))
        return false;
    if (!interaction.guild || !isStaffMember(interaction.member)) {
        await interaction.reply({ content: "Staff only.", flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    const guild = interaction.guild;
    const actorId = interaction.user.id;
    if (customId.startsWith(`${staffHub_1.STAFF_IDS.alert}:`)) {
        await (0, safety_1.handleAntiRaidAction)(interaction, guild);
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.home) {
        await respondStaff(interaction, buildStaffHomeFor(guild.id, interaction.channelId));
        return true;
    }
    if (customId.startsWith(`${staffHub_1.STAFF_IDS.settings}:`)) {
        const view = customId.slice(staffHub_1.STAFF_IDS.settings.length + 1);
        await respondStaff(interaction, (0, staffHub_1.buildSettingsPayload)(settings_1.botSettingsStore.get(), view));
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.health && interaction.isButton()) {
        await interaction.deferUpdate();
        const report = await (0, safety_1.runStaffHealthCheck)("manual");
        await interaction.editReply({ content: "", ...(0, staffHub_1.buildHealthPayload)(report.issues, Date.now(), report.notes) });
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.kbSearch && interaction.isButton()) {
        await interaction.showModal((0, staffHub_1.buildKbSearchModal)());
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.kbAdd && interaction.isButton()) {
        await interaction.showModal((0, staffHub_1.buildKbAddModal)());
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.kbSearchModal && interaction.isModalSubmit()) {
        const query = interaction.fields.getTextInputValue("query");
        const resolved = store_2.ticketStore.tickets
            .filter(ticket => ticket.guildId === guild.id && (ticket.resolvedReason || ticket.closedReason))
            .map(ticket => ({
            id: ticket.id,
            text: `${ticket.reason} ${(ticket.tags || []).join(" ")} ${ticket.category || ""} ${(ticket.internalNotes || []).map(note => note.note).join(" ")}`,
            resolution: ticket.resolvedReason || ticket.closedReason || ""
        }));
        await respondStaff(interaction, (0, staffHub_1.buildKbResults)(query, (0, staffDesk_1.searchKnowledgeBase)(query, settings_1.knowledgeBase.all(), resolved)));
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.kbAddModal && interaction.isModalSubmit()) {
        try {
            const article = settings_1.knowledgeBase.add({
                title: interaction.fields.getTextInputValue("title"),
                body: interaction.fields.getTextInputValue("body"),
                tags: interaction.fields.getTextInputValue("tags").split(","),
                authorId: actorId
            });
            (0, settings_1.recordSaveResult)("knowledgeBase", true);
            (0, audit_1.appendAuditEvent)("kb_article_added", { actorId, articleId: article.id, title: article.title });
            await respondStaff(interaction, (0, staffHub_1.buildKbResults)(article.title, [{ kind: "article", article, score: 1 }]), `✅ Article **${article.title}** added to the knowledge base.`);
        }
        catch (error) {
            (0, settings_1.recordSaveResult)("knowledgeBase", false, error);
            await interaction.reply({ content: "❌ The article could not be saved.", flags: discord_js_1.MessageFlags.Ephemeral });
        }
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.caseLookup) {
        const ticket = interaction.channelId ? (0, store_2.findTicketByChannel)(interaction.channelId) : null;
        await respondStaff(interaction, ticket && ticket.guildId === guild.id ? buildCaseFile(guild.id, ticket.ownerId, ticket) : (0, staffHub_1.buildCaseLookupPicker)());
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.caseUser && interaction.isUserSelectMenu()) {
        await respondStaff(interaction, buildCaseFile(guild.id, interaction.values[0], null));
        return true;
    }
    if (customId.startsWith(`${staffHub_1.STAFF_IDS.checklist}:`) && interaction.isButton()) {
        const [ticketIdRaw, itemId] = customId.slice(staffHub_1.STAFF_IDS.checklist.length + 1).split(":");
        const ticket = store_2.ticketStore.tickets.find(entry => entry.id === Number(ticketIdRaw) && entry.guildId === guild.id);
        if (!ticket || !(0, staffDesk_1.getChecklist)(ticket.category).some(item => item.id === itemId)) {
            await interaction.reply({ content: "That ticket or checklist item no longer exists.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const checklist = { ...(ticket.checklist || {}) };
        if (checklist[itemId])
            delete checklist[itemId];
        else
            checklist[itemId] = { byId: actorId, at: Date.now() };
        const previous = ticket.checklist;
        ticket.checklist = checklist;
        ticket.events = [...(ticket.events || []), { at: Date.now(), actorId, type: "checklist", detail: `${checklist[itemId] ? "Checked" : "Unchecked"}: ${itemId}` }].slice(-100);
        if (!(0, store_2.saveTicketStore)()) {
            ticket.checklist = previous;
            await interaction.reply({ content: "❌ The checklist could not be saved. Try again.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, buildCaseFile(guild.id, ticket.ownerId, ticket));
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.incidents) {
        await respondStaff(interaction, (0, staffHub_1.buildIncidentLog)(settings_1.antiRaidIncidents.recent(guild.id, 15)));
        return true;
    }
    // Settings mutations
    if (customId.startsWith(`${staffHub_1.STAFF_IDS.channel}:`) && interaction.isChannelSelectMenu()) {
        const key = customId.slice(staffHub_1.STAFF_IDS.channel.length + 1);
        const channelId = interaction.values[0];
        const oldChannelId = settings_1.botSettingsStore.get().channels[key];
        if (!channelId || channelId === oldChannelId) {
            await respondStaff(interaction, (0, staffHub_1.buildSettingsPayload)(settings_1.botSettingsStore.get(), "channels"));
            return true;
        }
        if (!settings_1.botSettingsStore.update(actorId, draft => { draft.channels[key] = channelId; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, (0, staffHub_1.buildSettingsPayload)(settings_1.botSettingsStore.get(), "channels"), `✅ Updated. Moving panels to <#${channelId}>…`);
        void logSettingsChange(actorId, `Channel **${key}**: <#${oldChannelId}> → <#${channelId}>`);
        (0, metrics_1.runAsyncWithBoundary)("relocatePanels", () => relocatePanelsForChannel(key, oldChannelId, guild.id));
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.roles && interaction.isRoleSelectMenu()) {
        const roleIds = [...interaction.values];
        if (!settings_1.botSettingsStore.update(actorId, draft => { draft.staffRoleIds = roleIds; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, (0, staffHub_1.buildSettingsPayload)(settings_1.botSettingsStore.get(), "roles"), "✅ Staff roles updated.");
        void logSettingsChange(actorId, `Staff roles: ${roleIds.map(id => `<@&${id}>`).join(" ") || "administrators only"}`);
        return true;
    }
    if (customId.startsWith(`${staffHub_1.STAFF_IDS.feature}:`) && interaction.isButton()) {
        const key = customId.slice(staffHub_1.STAFF_IDS.feature.length + 1);
        if (!Object.prototype.hasOwnProperty.call(botSettings_1.FEATURE_TOGGLES, key))
            return true;
        const next = !settings_1.botSettingsStore.get().features[key];
        if (!settings_1.botSettingsStore.update(actorId, draft => { draft.features[key] = next; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, (0, staffHub_1.buildSettingsPayload)(settings_1.botSettingsStore.get(), "features"));
        void logSettingsChange(actorId, `Feature **${botSettings_1.FEATURE_TOGGLES[key]}** turned **${next ? "on" : "off"}**`);
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.rewardsModal && interaction.isButton()) {
        await interaction.showModal((0, staffHub_1.buildRewardsModal)(settings_1.botSettingsStore.get()));
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.antiRaidModal && interaction.isButton()) {
        await interaction.showModal((0, staffHub_1.buildAntiRaidModal)(settings_1.botSettingsStore.get()));
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.rewardsSubmit && interaction.isModalSubmit()) {
        const raw = Object.fromEntries(Object.keys(botSettings_1.REWARD_SETTINGS).map(key => [key, interaction.fields.getTextInputValue(key)]));
        const parsed = (0, staffHub_1.parseNumericFields)(raw, botSettings_1.REWARD_SETTINGS);
        if (!parsed.ok) {
            await interaction.reply({ content: `❌ Not saved:\n${parsed.errors.map(error => `• ${error}`).join("\n")}`, flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        if (!settings_1.botSettingsStore.update(actorId, draft => { draft.rewards = { ...parsed.values }; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        (0, settings_1.applyRewardSettings)();
        (0, xpPanels_1.scheduleXpLeaderboardUpdate)();
        await respondStaff(interaction, (0, staffHub_1.buildSettingsPayload)(settings_1.botSettingsStore.get(), "rewards"), "✅ Rewards updated and live.");
        void logSettingsChange(actorId, Object.entries(botSettings_1.REWARD_SETTINGS)
            .map(([key, spec]) => `${spec.label}: **${parsed.values[key]}**`).join("\n"));
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.antiRaidSubmit && interaction.isModalSubmit()) {
        const raw = Object.fromEntries(Object.keys(botSettings_1.ANTI_RAID_SETTINGS).map(key => [key, interaction.fields.getTextInputValue(key)]));
        const parsed = (0, staffHub_1.parseNumericFields)(raw, botSettings_1.ANTI_RAID_SETTINGS);
        if (!parsed.ok) {
            await interaction.reply({ content: `❌ Not saved:\n${parsed.errors.map(error => `• ${error}`).join("\n")}`, flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        if (!settings_1.botSettingsStore.update(actorId, draft => { draft.antiRaid = { ...draft.antiRaid, ...parsed.values }; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, (0, staffHub_1.buildSettingsPayload)(settings_1.botSettingsStore.get(), "antiraid"), "✅ Spam alert thresholds updated.");
        void logSettingsChange(actorId, Object.entries(botSettings_1.ANTI_RAID_SETTINGS)
            .map(([key, spec]) => `${spec.label}: **${parsed.values[key]}**`).join("\n"));
        return true;
    }
    if (customId === staffHub_1.STAFF_IDS.timeoutMinutes && interaction.isStringSelectMenu()) {
        const minutes = Number(interaction.values[0]);
        if (!settings_1.botSettingsStore.update(actorId, draft => { draft.antiRaid.timeoutMinutes = minutes; })) {
            await interaction.reply({ content: settingsUpdateFailedReply(), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await respondStaff(interaction, (0, staffHub_1.buildSettingsPayload)(settings_1.botSettingsStore.get(), "antiraid"));
        void logSettingsChange(actorId, `Spam alert timeout length: **${minutes} min**`);
        return true;
    }
    return true;
}
