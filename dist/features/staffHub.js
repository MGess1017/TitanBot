"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAFF_IDS = exports.STAFF_COLOR = void 0;
exports.buildStaffHome = buildStaffHome;
exports.buildSettingsPayload = buildSettingsPayload;
exports.buildRewardsModal = buildRewardsModal;
exports.buildAntiRaidModal = buildAntiRaidModal;
exports.parseNumericFields = parseNumericFields;
exports.buildKbSearchModal = buildKbSearchModal;
exports.buildKbAddModal = buildKbAddModal;
exports.buildKbResults = buildKbResults;
exports.buildCaseLookupPicker = buildCaseLookupPicker;
exports.buildCaseView = buildCaseView;
exports.buildHealthPayload = buildHealthPayload;
exports.healthSignature = healthSignature;
exports.buildIncidentAlert = buildIncidentAlert;
exports.buildIncidentLog = buildIncidentLog;
const discord_js_1 = require("discord.js");
const botSettings_1 = require("./botSettings");
exports.STAFF_COLOR = 0x9b59b6;
exports.STAFF_IDS = {
    home: "staff:home",
    settings: "staff:settings",
    health: "staff:health",
    kbSearch: "staff:kb:search",
    kbAdd: "staff:kb:add",
    kbSearchModal: "staff:kb:searchmodal",
    kbAddModal: "staff:kb:addmodal",
    caseLookup: "staff:case:lookup",
    caseUser: "staff:case:user",
    checklist: "staff:checklist",
    incidents: "staff:incidents",
    channel: "staff:set:channel",
    roles: "staff:set:roles",
    feature: "staff:set:feature",
    rewardsModal: "staff:set:rewardsmodal",
    rewardsSubmit: "staff:set:rewardssubmit",
    antiRaidModal: "staff:set:antiraidmodal",
    antiRaidSubmit: "staff:set:antiraidsubmit",
    timeoutMinutes: "staff:set:timeout",
    alert: "antiraid"
};
const SETTINGS_VIEWS = { channels: "Channels", roles: "Staff Roles", features: "Features", rewards: "Rewards", antiraid: "Anti-Raid" };
function buildStaffHome(input) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(exports.STAFF_COLOR)
        .setTitle("🛡️ FNT Staff Desk")
        .setDescription([
        input.ticketId ? `You are in **ticket #${input.ticketId}**. Use **Case & Checklist** for history and the resolution checklist.` : "Open this desk inside a ticket to get its case history and resolution checklist.",
        "",
        `🎫 Open tickets: **${input.openTickets}**`,
        `🚨 Anti-raid alerts (24h): **${input.recentIncidents}**`,
        `🩺 Health issues: **${input.healthIssues}**`
    ].join("\n"));
    const rows = [
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.caseLookup).setLabel(input.ticketId ? "Case & Checklist" : "Case Lookup").setEmoji("📁").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.kbSearch).setLabel("Search KB").setEmoji("🔎").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.kbAdd).setLabel("Add KB Article").setEmoji("📝").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON(),
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_IDS.settings}:channels`).setLabel("Settings").setEmoji("⚙️").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.health).setLabel("Health Check").setEmoji("🩺").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.incidents).setLabel("Anti-Raid Log").setEmoji("🚨").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON()
    ];
    return { embeds: [embed.toJSON()], components: rows };
}
function homeButton() {
    return new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.home).setLabel("Staff Desk").setEmoji("🏠").setStyle(discord_js_1.ButtonStyle.Secondary);
}
function settingsNav(active) {
    return new discord_js_1.ActionRowBuilder().addComponents(Object.keys(SETTINGS_VIEWS).map(view => new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_IDS.settings}:${view}`).setLabel(SETTINGS_VIEWS[view])
        .setStyle(view === active ? discord_js_1.ButtonStyle.Primary : discord_js_1.ButtonStyle.Secondary))).toJSON();
}
function buildSettingsPayload(settings, view) {
    const embed = new discord_js_1.EmbedBuilder().setColor(exports.STAFF_COLOR).setTitle(`⚙️ Bot Settings • ${SETTINGS_VIEWS[view]}`)
        .setFooter({ text: settings.updatedAt ? `Last change by ${settings.updatedBy ? `user ${settings.updatedBy}` : "unknown"} • changes apply instantly` : "Defaults in use • changes apply instantly" });
    if (settings.updatedAt)
        embed.setTimestamp(settings.updatedAt);
    const rows = [];
    if (view === "channels") {
        embed.setDescription(Object.entries(botSettings_1.CHANNEL_SETTINGS).map(([key, label]) => `**${label}:** <#${settings.channels[key]}>`).join("\n"));
        for (const [key, label] of Object.entries(botSettings_1.CHANNEL_SETTINGS)) {
            rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ChannelSelectMenuBuilder()
                .setCustomId(`${exports.STAFF_IDS.channel}:${key}`).setPlaceholder(label.slice(0, 150))
                .setChannelTypes(discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement)
                .setDefaultChannels(settings.channels[key])).toJSON());
        }
    }
    else if (view === "roles") {
        embed.setDescription(["Members with any of these roles (or Administrator) can use `/staff`, receive staff tools, and act on anti-raid alerts.", "",
            settings.staffRoleIds.map(id => `<@&${id}>`).join(" ") || "No staff roles — administrators only."].join("\n"));
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.RoleSelectMenuBuilder()
            .setCustomId(exports.STAFF_IDS.roles).setPlaceholder("Select staff roles").setMinValues(0).setMaxValues(25)
            .setDefaultRoles(settings.staffRoleIds.slice(0, 25))).toJSON());
    }
    else if (view === "features") {
        embed.setDescription("Toggle features on or off. Disabled features stop immediately; panels remain in place.");
        const buttons = Object.entries(botSettings_1.FEATURE_TOGGLES).map(([key, label]) => new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_IDS.feature}:${key}`).setLabel(`${label}: ${settings.features[key] ? "On" : "Off"}`)
            .setStyle(settings.features[key] ? discord_js_1.ButtonStyle.Success : discord_js_1.ButtonStyle.Danger));
        for (let index = 0; index < buttons.length; index += 4) {
            rows.push(new discord_js_1.ActionRowBuilder().addComponents(buttons.slice(index, index + 4)).toJSON());
        }
    }
    else if (view === "rewards") {
        embed.setDescription(Object.entries(botSettings_1.REWARD_SETTINGS).map(([key, spec]) => `**${spec.label}:** ${settings.rewards[key].toLocaleString()}`).join("\n"));
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.rewardsModal).setLabel("Edit Rewards").setEmoji("✏️").setStyle(discord_js_1.ButtonStyle.Primary)).toJSON());
    }
    else {
        embed.setDescription([
            ...Object.entries(botSettings_1.ANTI_RAID_SETTINGS).map(([key, spec]) => `**${spec.label}:** ${settings.antiRaid[key]}`),
            `**Alert timeout length:** ${settings.antiRaid.timeoutMinutes} min`,
            `**Detection:** ${settings.features.antiRaid ? "On" : "Off"} • alerts go to <#${settings.channels.modAlerts}>`
        ].join("\n"));
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.antiRaidModal).setLabel("Edit Thresholds").setEmoji("✏️").setStyle(discord_js_1.ButtonStyle.Primary)).toJSON());
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(exports.STAFF_IDS.timeoutMinutes).setPlaceholder("Timeout length for alert actions")
            .addOptions([5, 10, 30, 60, 360, 1440].map(minutes => ({
            label: minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`,
            value: String(minutes), default: settings.antiRaid.timeoutMinutes === minutes
        })))).toJSON());
    }
    rows.push(settingsNav(view));
    return { embeds: [embed.toJSON()], components: rows.slice(0, 5) };
}
function numberInput(id, label, value) {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
        .setCustomId(id).setLabel(label.slice(0, 45)).setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(10).setValue(String(value)));
}
function buildRewardsModal(settings) {
    return new discord_js_1.ModalBuilder().setCustomId(exports.STAFF_IDS.rewardsSubmit).setTitle("Edit Rewards").addComponents(Object.entries(botSettings_1.REWARD_SETTINGS).map(([key, spec]) => numberInput(key, `${spec.label} (${spec.min}-${spec.max})`, settings.rewards[key])));
}
function buildAntiRaidModal(settings) {
    return new discord_js_1.ModalBuilder().setCustomId(exports.STAFF_IDS.antiRaidSubmit).setTitle("Anti-Raid Thresholds").addComponents(Object.entries(botSettings_1.ANTI_RAID_SETTINGS).map(([key, spec]) => numberInput(key, `${spec.label} (${spec.min}-${spec.max})`, settings.antiRaid[key])));
}
/** Parses modal numbers strictly; returns per-field errors instead of silently clamping. */
function parseNumericFields(values, specs) {
    const parsed = {};
    const errors = [];
    for (const key of Object.keys(specs)) {
        const spec = specs[key];
        const value = Number(String(values[key] ?? "").replace(/,/g, "").trim());
        if (!Number.isFinite(value) || value < spec.min || value > spec.max)
            errors.push(`${spec.label} must be between ${spec.min} and ${spec.max}.`);
        else
            parsed[key] = value;
    }
    return errors.length ? { ok: false, errors } : { ok: true, values: parsed };
}
function buildKbSearchModal() {
    return new discord_js_1.ModalBuilder().setCustomId(exports.STAFF_IDS.kbSearchModal).setTitle("Search Knowledge Base").addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("query").setLabel("Keywords")
        .setPlaceholder("e.g. voice xp double, crate limit, appeal").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(100)));
}
function buildKbAddModal() {
    return new discord_js_1.ModalBuilder().setCustomId(exports.STAFF_IDS.kbAddModal).setTitle("Add KB Article").addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("title").setLabel("Title").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(100)), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("body").setLabel("Answer / steps").setStyle(discord_js_1.TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("tags").setLabel("Tags (comma separated)").setStyle(discord_js_1.TextInputStyle.Short).setRequired(false).setMaxLength(200)));
}
function buildKbResults(query, hits) {
    const embed = new discord_js_1.EmbedBuilder().setColor(exports.STAFF_COLOR).setTitle(`🔎 Knowledge Base • "${query.slice(0, 60)}"`);
    if (!hits.length)
        embed.setDescription("No matches. Try fewer or different keywords, or add an article from the Staff Desk.");
    for (const hit of hits) {
        if (hit.kind === "article") {
            embed.addFields({ name: `📘 ${hit.article.title}${hit.article.builtIn ? "" : " (staff)"}`.slice(0, 256), value: hit.article.body.slice(0, 1000) });
        }
        else {
            embed.addFields({ name: `🎫 Resolved ticket #${hit.ticketId}`, value: hit.summary || "Resolved without a summary." });
        }
    }
    return {
        embeds: [embed.toJSON()],
        components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.kbSearch).setLabel("New Search").setEmoji("🔎").setStyle(discord_js_1.ButtonStyle.Primary), homeButton()).toJSON()]
    };
}
function buildCaseLookupPicker() {
    return {
        embeds: [new discord_js_1.EmbedBuilder().setColor(exports.STAFF_COLOR).setTitle("📁 Case Lookup").setDescription("Pick a member to see their tickets, reports, warnings, and anti-raid alerts.").toJSON()],
        components: [
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.UserSelectMenuBuilder().setCustomId(exports.STAFF_IDS.caseUser).setPlaceholder("Select a member")).toJSON(),
            new discord_js_1.ActionRowBuilder().addComponents(homeButton()).toJSON()
        ]
    };
}
function buildCaseView(input) {
    const embed = new discord_js_1.EmbedBuilder().setColor(exports.STAFF_COLOR)
        .setTitle(input.ticket ? `📁 Ticket #${input.ticket.id} • Case File` : "📁 Case File")
        .setDescription([`Member: <@${input.userId}>`, input.summary, input.ticket ? `Reason: ${input.ticket.reason.slice(0, 200)}` : ""].filter(Boolean).join("\n"))
        .addFields(input.sections.map(section => ({ ...section, inline: false })));
    const rows = [];
    if (input.ticket) {
        const done = input.ticket.checklist.filter(item => input.ticket.done[item.id]).length;
        embed.addFields({
            name: `✅ Resolution Checklist • ${input.ticket.category} (${done}/${input.ticket.checklist.length})`,
            value: input.ticket.checklist.map((item, index) => {
                const entry = input.ticket.done[item.id];
                return `${entry ? "✅" : "⬜"} ${index + 1}. ${item.label}${entry ? ` — <@${entry.byId}>` : ""}`;
            }).join("\n").slice(0, 1024)
        });
        const buttons = input.ticket.checklist.map((item, index) => new discord_js_1.ButtonBuilder()
            .setCustomId(`${exports.STAFF_IDS.checklist}:${input.ticket.id}:${item.id}`).setLabel(`${index + 1}`)
            .setStyle(input.ticket.done[item.id] ? discord_js_1.ButtonStyle.Success : discord_js_1.ButtonStyle.Secondary));
        for (let index = 0; index < buttons.length; index += 5)
            rows.push(new discord_js_1.ActionRowBuilder().addComponents(buttons.slice(index, index + 5)).toJSON());
    }
    rows.push(new discord_js_1.ActionRowBuilder().addComponents(homeButton()).toJSON());
    return { embeds: [embed.toJSON()], components: rows };
}
function buildHealthPayload(issues, checkedAt, extraLines = []) {
    const critical = issues.filter(issue => issue.severity === "critical");
    const warnings = issues.filter(issue => issue.severity === "warning");
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(critical.length ? 0xdc2626 : warnings.length ? 0xf59e0b : 0x22c55e)
        .setTitle(`🩺 Health Check • ${critical.length ? "Action needed" : warnings.length ? "Warnings" : "All clear"}`)
        .setDescription([`Checked <t:${Math.floor(checkedAt / 1000)}:R>`, ...extraLines].join("\n"));
    if (critical.length)
        embed.addFields({ name: `Critical (${critical.length})`, value: critical.map(issue => `🔴 ${issue.message}`).join("\n").slice(0, 1024) });
    if (warnings.length)
        embed.addFields({ name: `Warnings (${warnings.length})`, value: warnings.map(issue => `🟡 ${issue.message}`).join("\n").slice(0, 1024) });
    if (!issues.length)
        embed.addFields({ name: "Status", value: "✅ Permissions, panels, saves, and startup all look good." });
    return {
        embeds: [embed.toJSON()],
        components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.STAFF_IDS.health).setLabel("Re-run").setEmoji("🔁").setStyle(discord_js_1.ButtonStyle.Primary), homeButton()).toJSON()]
    };
}
/** Stable signature so periodic checks only alert when the issue set changes. */
function healthSignature(issues) {
    return issues.map(issue => issue.key).sort().join("|");
}
const KIND_TITLE = {
    join_flood: "🚨 Join Flood Detected",
    spam: "🚨 Repeated Spam Detected",
    mention_abuse: "🚨 Mention Abuse Detected"
};
function buildIncidentAlert(incident, raidModeAvailable) {
    const acted = incident.actions[incident.actions.length - 1];
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(incident.actions.some(action => action.type === "dismiss") ? 0x6b7280 : 0xdc2626)
        .setTitle(KIND_TITLE[incident.kind])
        .setDescription(incident.detail.slice(0, 2000))
        .addFields({ name: "Members", value: incident.userIds.slice(0, 20).map(id => `<@${id}>`).join(" ").slice(0, 1024) || "Unknown", inline: false }, { name: "Timed out", value: incident.timedOutUserIds.length ? incident.timedOutUserIds.slice(0, 20).map(id => `<@${id}>`).join(" ").slice(0, 1024) : "None", inline: true }, { name: "Raid mode", value: incident.previousVerificationLevel !== null ? "🔒 On" : "Off", inline: true }, { name: "History", value: incident.actions.slice(-5).map(action => `<t:${Math.floor(action.at / 1000)}:t> ${action.type.replace("_", " ")} by <@${action.byId}>${action.count !== undefined ? ` (${action.count})` : ""}`).join("\n") || "No action yet — review and choose below.", inline: false })
        .setFooter({ text: `Incident ${incident.id} • every action here can be undone` })
        .setTimestamp(acted?.at ?? incident.at);
    const id = incident.id;
    const timedOut = incident.timedOutUserIds.length > 0;
    const buttons = [
        new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_IDS.alert}:timeout:${id}`).setLabel(incident.kind === "join_flood" ? "Timeout Joiners" : "Timeout").setStyle(discord_js_1.ButtonStyle.Danger).setDisabled(timedOut),
        new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_IDS.alert}:untimeout:${id}`).setLabel("Undo Timeout").setStyle(discord_js_1.ButtonStyle.Secondary).setDisabled(!timedOut)
    ];
    if (incident.kind === "join_flood" && raidModeAvailable) {
        buttons.push(incident.previousVerificationLevel === null
            ? new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_IDS.alert}:raidmode_on:${id}`).setLabel("Raid Mode").setEmoji("🔒").setStyle(discord_js_1.ButtonStyle.Danger)
            : new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_IDS.alert}:raidmode_off:${id}`).setLabel("End Raid Mode").setEmoji("🔓").setStyle(discord_js_1.ButtonStyle.Success));
    }
    buttons.push(new discord_js_1.ButtonBuilder().setCustomId(`${exports.STAFF_IDS.alert}:dismiss:${id}`).setLabel("False Alarm").setStyle(discord_js_1.ButtonStyle.Secondary));
    return { embeds: [embed.toJSON()], components: [new discord_js_1.ActionRowBuilder().addComponents(buttons).toJSON()] };
}
function buildIncidentLog(incidents) {
    const embed = new discord_js_1.EmbedBuilder().setColor(exports.STAFF_COLOR).setTitle("🚨 Anti-Raid Log")
        .setDescription(incidents.length ? incidents.map(incident => `\`${incident.id}\` <t:${Math.floor(incident.at / 1000)}:R> • **${incident.kind.replace("_", " ")}** • ${incident.userIds.length} member(s)${incident.actions.length ? ` • last: ${incident.actions[incident.actions.length - 1].type.replace("_", " ")}` : " • no action"}`).join("\n").slice(0, 4000) : "No incidents recorded.");
    return { embeds: [embed.toJSON()], components: [new discord_js_1.ActionRowBuilder().addComponents(homeButton()).toJSON()] };
}
