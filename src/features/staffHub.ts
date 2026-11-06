import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, ModalBuilder,
    RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
    type APIActionRowComponent, type APIComponentInMessageActionRow, type APIEmbed
} from "discord.js";
import {
    ANTI_RAID_SETTINGS, CHANNEL_SETTINGS, FEATURE_TOGGLES, REWARD_SETTINGS,
    type AntiRaidSetting, type BotSettings, type ChannelSetting, type FeatureToggle, type RewardSetting
} from "./botSettings";
import type { AntiRaidIncident } from "./antiRaid";
import type { ChecklistItem, KbSearchHit } from "./staffDesk";
import { TICKET_IDS } from "../bot/ui/ids";

export const STAFF_COLOR = 0x9b59b6;
export const STAFF_IDS = {
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
} as const;

export type SettingsView = "channels" | "roles" | "features" | "rewards" | "antiraid";
const SETTINGS_VIEWS: Record<SettingsView, string> = { channels: "Channels", roles: "Staff Roles", features: "Features", rewards: "Rewards", antiraid: "Spam Alerts" };

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;
export type StaffPayload = { embeds: APIEmbed[]; components: Row[] };

export function buildStaffHome(input: { ticketId: number | null; openTickets: number; recentIncidents: number; healthIssues: number }): StaffPayload {
    const embed = new EmbedBuilder()
        .setColor(STAFF_COLOR)
        .setTitle("🛡️ FNT Staff Desk")
        .setDescription([
            input.ticketId ? `You are in **ticket #${input.ticketId}**. Use **Case & Checklist** for history and the resolution checklist.` : "Open this desk inside a ticket to get its case history and resolution checklist.",
            "",
            `🎫 Open tickets: **${input.openTickets}**`,
            `🚨 Spam alerts (24h): **${input.recentIncidents}**`,
            `🩺 Health issues: **${input.healthIssues}**`
        ].join("\n"));
    const rows: Row[] = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(STAFF_IDS.caseLookup).setLabel(input.ticketId ? "Case & Checklist" : "Case Lookup").setEmoji("📁").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(STAFF_IDS.kbSearch).setLabel("Help Articles").setEmoji("🔎").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(STAFF_IDS.kbAdd).setLabel("Add Help Article").setEmoji("📝").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(TICKET_IDS.queue).setLabel("Support Queue").setStyle(ButtonStyle.Primary)
        ).toJSON(),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${STAFF_IDS.settings}:channels`).setLabel("Settings").setEmoji("⚙️").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(STAFF_IDS.health).setLabel("Health Check").setEmoji("🩺").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(STAFF_IDS.incidents).setLabel("Spam Alert Log").setEmoji("🚨").setStyle(ButtonStyle.Secondary)
        ).toJSON()
    ];
    return { embeds: [embed.toJSON()], components: rows };
}

function homeButton(): ButtonBuilder {
    return new ButtonBuilder().setCustomId(STAFF_IDS.home).setLabel("Staff Desk").setEmoji("🏠").setStyle(ButtonStyle.Secondary);
}

function settingsNav(active: SettingsView): Row {
    return new ActionRowBuilder<ButtonBuilder>().addComponents((Object.keys(SETTINGS_VIEWS) as SettingsView[]).map(view =>
        new ButtonBuilder().setCustomId(`${STAFF_IDS.settings}:${view}`).setLabel(SETTINGS_VIEWS[view])
            .setStyle(view === active ? ButtonStyle.Primary : ButtonStyle.Secondary))).toJSON();
}

export function buildSettingsPayload(settings: Readonly<BotSettings>, view: SettingsView): StaffPayload {
    const embed = new EmbedBuilder().setColor(STAFF_COLOR).setTitle(`⚙️ Bot Settings • ${SETTINGS_VIEWS[view]}`)
        .setFooter({ text: settings.updatedAt ? `Last change by ${settings.updatedBy ? `user ${settings.updatedBy}` : "unknown"} • changes apply instantly` : "Defaults in use • changes apply instantly" });
    if (settings.updatedAt) embed.setTimestamp(settings.updatedAt);
    const rows: Row[] = [];
    if (view === "channels") {
        embed.setDescription((Object.entries(CHANNEL_SETTINGS) as Array<[ChannelSetting, string]>).map(([key, label]) => `**${label}:** <#${settings.channels[key]}>`).join("\n"));
        for (const [key, label] of Object.entries(CHANNEL_SETTINGS) as Array<[ChannelSetting, string]>) {
            rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder()
                .setCustomId(`${STAFF_IDS.channel}:${key}`).setPlaceholder(label.slice(0, 150))
                .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setDefaultChannels(settings.channels[key])).toJSON());
        }
    } else if (view === "roles") {
        embed.setDescription(["Members with any of these roles (or Administrator) can use `/staff`, receive staff tools, and act on spam alerts.", "",
            settings.staffRoleIds.map(id => `<@&${id}>`).join(" ") || "No staff roles — administrators only."].join("\n"));
        rows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder()
            .setCustomId(STAFF_IDS.roles).setPlaceholder("Select staff roles").setMinValues(0).setMaxValues(25)
            .setDefaultRoles(settings.staffRoleIds.slice(0, 25))).toJSON());
    } else if (view === "features") {
        embed.setDescription("Toggle features on or off. Disabled features stop immediately; panels remain in place.");
        const buttons = (Object.entries(FEATURE_TOGGLES) as Array<[FeatureToggle, string]>).map(([key, label]) =>
            new ButtonBuilder().setCustomId(`${STAFF_IDS.feature}:${key}`).setLabel(`${label}: ${settings.features[key] ? "On" : "Off"}`)
                .setStyle(settings.features[key] ? ButtonStyle.Success : ButtonStyle.Danger));
        for (let index = 0; index < buttons.length; index += 4) {
            rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 4)).toJSON());
        }
    } else if (view === "rewards") {
        embed.setDescription((Object.entries(REWARD_SETTINGS) as Array<[RewardSetting, { label: string }]>).map(([key, spec]) => `**${spec.label}:** ${settings.rewards[key].toLocaleString()}`).join("\n"));
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(STAFF_IDS.rewardsModal).setLabel("Edit Rewards").setEmoji("✏️").setStyle(ButtonStyle.Primary)).toJSON());
    } else {
        embed.setDescription([
            ...(Object.entries(ANTI_RAID_SETTINGS) as Array<[AntiRaidSetting, { label: string }]>).map(([key, spec]) => `**${spec.label}:** ${settings.antiRaid[key]}`),
            `**Alert timeout length:** ${settings.antiRaid.timeoutMinutes} min`,
            `**Detection:** ${settings.features.antiRaid ? "On" : "Off"} • alerts go to <#${settings.channels.modAlerts}>`,
            "New members are always welcome — joins are never tracked, and alerts never kick or ban."
        ].join("\n"));
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(STAFF_IDS.antiRaidModal).setLabel("Edit Thresholds").setEmoji("✏️").setStyle(ButtonStyle.Primary)).toJSON());
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
            .setCustomId(STAFF_IDS.timeoutMinutes).setPlaceholder("Timeout length for alert actions")
            .addOptions([5, 10, 30, 60, 360, 1440].map(minutes => ({
                label: minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`,
                value: String(minutes), default: settings.antiRaid.timeoutMinutes === minutes
            })))).toJSON());
    }
    rows.push(settingsNav(view));
    return { embeds: [embed.toJSON()], components: rows.slice(0, 5) };
}

function numberInput(id: string, label: string, value: number): ActionRowBuilder<TextInputBuilder> {
    return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
        .setCustomId(id).setLabel(label.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setValue(String(value)));
}

export function buildRewardsModal(settings: Readonly<BotSettings>): ModalBuilder {
    return new ModalBuilder().setCustomId(STAFF_IDS.rewardsSubmit).setTitle("Edit Rewards").addComponents(
        (Object.entries(REWARD_SETTINGS) as Array<[RewardSetting, { label: string; min: number; max: number }]>).map(([key, spec]) =>
            numberInput(key, `${spec.label} (${spec.min}-${spec.max})`, settings.rewards[key])));
}

export function buildAntiRaidModal(settings: Readonly<BotSettings>): ModalBuilder {
    return new ModalBuilder().setCustomId(STAFF_IDS.antiRaidSubmit).setTitle("Spam Alert Thresholds").addComponents(
        (Object.entries(ANTI_RAID_SETTINGS) as Array<[AntiRaidSetting, { label: string; min: number; max: number }]>).map(([key, spec]) =>
            numberInput(key, `${spec.label} (${spec.min}-${spec.max})`, settings.antiRaid[key])));
}

/** Parses modal numbers strictly; returns per-field errors instead of silently clamping. */
export function parseNumericFields<K extends string>(values: Record<K, string>, specs: Record<K, { label: string; min: number; max: number }>): { ok: true; values: Record<K, number> } | { ok: false; errors: string[] } {
    const parsed = {} as Record<K, number>;
    const errors: string[] = [];
    for (const key of Object.keys(specs) as K[]) {
        const spec = specs[key];
        const value = Number(String(values[key] ?? "").replace(/,/g, "").trim());
        if (!Number.isFinite(value) || value < spec.min || value > spec.max) errors.push(`${spec.label} must be between ${spec.min} and ${spec.max}.`);
        else parsed[key] = value;
    }
    return errors.length ? { ok: false, errors } : { ok: true, values: parsed };
}

export function buildKbSearchModal(): ModalBuilder {
    return new ModalBuilder().setCustomId(STAFF_IDS.kbSearchModal).setTitle("Search Help Articles").addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("query").setLabel("Keywords")
            .setPlaceholder("e.g. voice xp double, crate limit, appeal").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)));
}

export function buildKbAddModal(): ModalBuilder {
    return new ModalBuilder().setCustomId(STAFF_IDS.kbAddModal).setTitle("Add Help Article").addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Title").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("body").setLabel("Answer / steps").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("tags").setLabel("Tags (comma separated)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)));
}

export function buildKbResults(query: string, hits: KbSearchHit[]): StaffPayload {
    const embed = new EmbedBuilder().setColor(STAFF_COLOR).setTitle(`🔎 Help Articles • "${query.slice(0, 60)}"`);
    if (!hits.length) embed.setDescription("No matches. Try fewer or different keywords, or add an article from the Staff Desk.");
    for (const hit of hits) {
        if (hit.kind === "article") {
            embed.addFields({ name: `📘 ${hit.article.title}${hit.article.builtIn ? "" : " (staff)"}`.slice(0, 256), value: hit.article.body.slice(0, 1000) });
        } else {
            embed.addFields({ name: `🎫 Resolved ticket #${hit.ticketId}`, value: hit.summary || "Resolved without a summary." });
        }
    }
    return {
        embeds: [embed.toJSON()],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(STAFF_IDS.kbSearch).setLabel("New Search").setEmoji("🔎").setStyle(ButtonStyle.Primary), homeButton()).toJSON()]
    };
}

export function buildCaseLookupPicker(): StaffPayload {
    return {
        embeds: [new EmbedBuilder().setColor(STAFF_COLOR).setTitle("📁 Case Lookup").setDescription("Pick a member to see their tickets, reports, warnings, and spam alerts.").toJSON()],
        components: [
            new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(STAFF_IDS.caseUser).setPlaceholder("Select a member")).toJSON(),
            new ActionRowBuilder<ButtonBuilder>().addComponents(homeButton()).toJSON()
        ]
    };
}

export function buildCaseView(input: {
    userId: string;
    summary: string;
    sections: Array<{ name: string; value: string }>;
    ticket: { id: number; category: string; reason: string; checklist: ChecklistItem[]; done: Record<string, { byId: string; at: number }> } | null;
}): StaffPayload {
    const embed = new EmbedBuilder().setColor(STAFF_COLOR)
        .setTitle(input.ticket ? `📁 Ticket #${input.ticket.id} • Case File` : "📁 Case File")
        .setDescription([`Member: <@${input.userId}>`, input.summary, input.ticket ? `Reason: ${input.ticket.reason.slice(0, 200)}` : ""].filter(Boolean).join("\n"))
        .addFields(input.sections.map(section => ({ ...section, inline: false })));
    const rows: Row[] = [];
    if (input.ticket) {
        const done = input.ticket.checklist.filter(item => input.ticket!.done[item.id]).length;
        embed.addFields({
            name: `✅ Resolution Checklist • ${input.ticket.category} (${done}/${input.ticket.checklist.length})`,
            value: input.ticket.checklist.map((item, index) => {
                const entry = input.ticket!.done[item.id];
                return `${entry ? "✅" : "⬜"} ${index + 1}. ${item.label}${entry ? ` — <@${entry.byId}>` : ""}`;
            }).join("\n").slice(0, 1024)
        });
        const buttons = input.ticket.checklist.map((item, index) => new ButtonBuilder()
            .setCustomId(`${STAFF_IDS.checklist}:${input.ticket!.id}:${item.id}`).setLabel(`${index + 1}`)
            .setStyle(input.ticket!.done[item.id] ? ButtonStyle.Success : ButtonStyle.Secondary));
        for (let index = 0; index < buttons.length; index += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)).toJSON());
    }
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(homeButton()).toJSON());
    return { embeds: [embed.toJSON()], components: rows };
}

export type HealthIssue = { key: string; severity: "critical" | "warning"; message: string };

export function buildHealthPayload(issues: HealthIssue[], checkedAt: number, extraLines: string[] = []): StaffPayload {
    const critical = issues.filter(issue => issue.severity === "critical");
    const warnings = issues.filter(issue => issue.severity === "warning");
    const embed = new EmbedBuilder()
        .setColor(critical.length ? 0xdc2626 : warnings.length ? 0xf59e0b : 0x22c55e)
        .setTitle(`🩺 Health Check • ${critical.length ? "Action needed" : warnings.length ? "Warnings" : "All clear"}`)
        .setDescription([`Checked <t:${Math.floor(checkedAt / 1000)}:R>`, ...extraLines].join("\n"));
    if (critical.length) embed.addFields({ name: `Critical (${critical.length})`, value: critical.map(issue => `🔴 ${issue.message}`).join("\n").slice(0, 1024) });
    if (warnings.length) embed.addFields({ name: `Warnings (${warnings.length})`, value: warnings.map(issue => `🟡 ${issue.message}`).join("\n").slice(0, 1024) });
    if (!issues.length) embed.addFields({ name: "Status", value: "✅ Permissions, panels, saves, and startup all look good." });
    return {
        embeds: [embed.toJSON()],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(STAFF_IDS.health).setLabel("Re-run").setEmoji("🔁").setStyle(ButtonStyle.Primary), homeButton()).toJSON()]
    };
}

/** Stable signature so periodic checks only alert when the issue set changes. */
export function healthSignature(issues: HealthIssue[]): string {
    return issues.map(issue => issue.key).sort().join("|");
}

const KIND_TITLE: Record<AntiRaidIncident["kind"], string> = {
    spam: "🚨 Repeated Spam Detected",
    mention_abuse: "🚨 Mention Abuse Detected"
};

export function buildIncidentAlert(incident: AntiRaidIncident): StaffPayload {
    const acted = incident.actions[incident.actions.length - 1];
    const embed = new EmbedBuilder()
        .setColor(incident.actions.some(action => action.type === "dismiss") ? 0x6b7280 : 0xdc2626)
        .setTitle(KIND_TITLE[incident.kind])
        .setDescription(incident.detail.slice(0, 2000))
        .addFields(
            { name: "Members", value: incident.userIds.slice(0, 20).map(id => `<@${id}>`).join(" ").slice(0, 1024) || "Unknown", inline: false },
            { name: "Timed out", value: incident.timedOutUserIds.length ? incident.timedOutUserIds.slice(0, 20).map(id => `<@${id}>`).join(" ").slice(0, 1024) : "None", inline: true },
            { name: "History", value: incident.actions.slice(-5).map(action => `<t:${Math.floor(action.at / 1000)}:t> ${action.type} by <@${action.byId}>${action.count !== undefined ? ` (${action.count})` : ""}`).join("\n") || "No action yet — review and choose below.", inline: false }
        )
        .setFooter({ text: `Incident ${incident.id} • timeouts are reversible • the bot never kicks or bans from alerts` })
        .setTimestamp(acted?.at ?? incident.at);
    const id = incident.id;
    const timedOut = incident.timedOutUserIds.length > 0;
    const buttons = [
        new ButtonBuilder().setCustomId(`${STAFF_IDS.alert}:timeout:${id}`).setLabel("Timeout").setStyle(ButtonStyle.Danger).setDisabled(timedOut),
        new ButtonBuilder().setCustomId(`${STAFF_IDS.alert}:untimeout:${id}`).setLabel("Undo Timeout").setStyle(ButtonStyle.Secondary).setDisabled(!timedOut)
    ];
    buttons.push(new ButtonBuilder().setCustomId(`${STAFF_IDS.alert}:dismiss:${id}`).setLabel("False Alarm").setStyle(ButtonStyle.Secondary));
    return { embeds: [embed.toJSON()], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons).toJSON()] };
}

export function buildIncidentLog(incidents: AntiRaidIncident[]): StaffPayload {
    const embed = new EmbedBuilder().setColor(STAFF_COLOR).setTitle("🚨 Spam Alert Log")
        .setDescription(incidents.length ? incidents.map(incident =>
            `\`${incident.id}\` <t:${Math.floor(incident.at / 1000)}:R> • **${incident.kind.replace("_", " ")}** • ${incident.userIds.length} member(s)${incident.actions.length ? ` • last: ${incident.actions[incident.actions.length - 1].type.replace("_", " ")}` : " • no action"}`
        ).join("\n").slice(0, 4000) : "No incidents recorded.");
    return { embeds: [embed.toJSON()], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(homeButton()).toJSON()] };
}
