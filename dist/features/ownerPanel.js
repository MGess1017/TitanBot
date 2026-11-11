"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_PREFIX = exports.OWNER_PANEL_TITLE = void 0;
exports.ownerNavigation = ownerNavigation;
exports.buildOwnerLauncher = buildOwnerLauncher;
exports.buildOwnerWorkspace = buildOwnerWorkspace;
exports.buildOwnerModal = buildOwnerModal;
exports.buildOwnerConfirmation = buildOwnerConfirmation;
const discord_js_1 = require("discord.js");
const botSettings_1 = require("./botSettings");
const ownerControls_1 = require("../game/ownerControls");
exports.OWNER_PANEL_TITLE = "FNTCORD | Owner Control";
exports.OWNER_PREFIX = "owner:";
function ownerNavigation(workspace) {
    const button = (action, label) => new discord_js_1.ButtonBuilder()
        .setCustomId(`${exports.OWNER_PREFIX}${action}:${workspace.id}`).setLabel(label).setStyle(discord_js_1.ButtonStyle.Secondary);
    return new discord_js_1.ActionRowBuilder().addComponents(button("home", "Home"), button("back", "Back"), button("refresh", "Refresh"), button("customize", "Customize"));
}
function buildOwnerLauncher() {
    return {
        embeds: [new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle(exports.OWNER_PANEL_TITLE)
                .setDescription("Owner-only player controls, moderation limits, and feature management.\nOpen a private workspace to begin.")
                .setFooter({ text: "FNTCORD / AUTHORIZED OWNERS ONLY" })],
        components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.OWNER_PREFIX}start`).setLabel("Open Owner Control").setStyle(discord_js_1.ButtonStyle.Primary))],
        allowedMentions: { parse: [] }
    };
}
function buildOwnerWorkspace(workspace, summary, detailFields = []) {
    const id = (action) => `${exports.OWNER_PREFIX}${action}:${workspace.id}`;
    const select = (action, placeholder, choices, current) => new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId(id(action)).setPlaceholder(placeholder)
        .addOptions(choices.map(choice => ({ ...choice, default: choice.value === current }))));
    const titles = { home: "Owner Control", values: "Player Values", quotas: "Moderation Limits", features: "Feature Controls", guardrails: "Guardrails & History" };
    const embed = new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle(`FNTCORD | ${titles[workspace.page]}`)
        .setDescription(summary).setFooter({ text: "PRIVATE / CHANGES REQUIRE CONFIRMATION / SESSION EXPIRES IN 15 MINUTES" });
    if (detailFields.length)
        embed.addFields(detailFields.slice(0, 10));
    const components = [];
    if (workspace.page === "home") {
        components.push(select("page", "Choose an owner workspace", [
            { value: "values", label: "Player XP, FN Tokenz & Access Points" },
            { value: "quotas", label: "Ban / Kick Limits" }, { value: "features", label: "Feature & XP Rate Controls" },
            { value: "guardrails", label: "Guardrails & Recent History" }
        ]));
    }
    else if (workspace.page === "values") {
        components.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.UserSelectMenuBuilder().setCustomId(id("player")).setPlaceholder("Choose a player").setMaxValues(1)), select("field", "Player value", Object.entries(ownerControls_1.OWNER_VALUE_FIELDS).map(([value, label]) => ({ value, label })), workspace.field), select("operation", "Adjustment mode", [{ value: "set", label: "Set exact total" }, { value: "add", label: "Add amount" }, { value: "remove", label: "Remove amount" }], workspace.operation), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(id("amount")).setLabel("Enter Amount").setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(!workspace.targetId)));
    }
    else if (workspace.page === "quotas") {
        components.push(select("scope", "Limit scope", [{ value: "guild", label: "Default for each administrator" }, { value: "member", label: "Individual administrator override" }], workspace.quotaScope));
        if (workspace.quotaScope === "member")
            components.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.UserSelectMenuBuilder().setCustomId(id("quota_user")).setPlaceholder("Choose an administrator").setMaxValues(1)));
        components.push(select("quota_kind", "Action and calendar timeframe (UTC)", ["ban", "kick"].flatMap(action => ["day", "week", "month"].map(period => ({ value: `${action}_${period}`, label: `${action === "ban" ? "Ban" : "Kick"} / per calendar ${period} (UTC)` }))), `${workspace.quotaAction}_${workspace.period}`));
        components.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(id("quota_edit")).setLabel("Set Allowance").setStyle(discord_js_1.ButtonStyle.Primary)
            .setDisabled(workspace.quotaScope === "member" && !workspace.quotaUserId)));
    }
    else if (workspace.page === "features") {
        components.push(select("feature", "Feature switch", Object.entries(botSettings_1.FEATURE_TOGGLES).map(([value, label]) => ({ value, label })), workspace.feature), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(id("feature_edit")).setLabel("Change Feature State").setStyle(discord_js_1.ButtonStyle.Primary)), select("reward", "XP and cosmetic rate", Object.entries(botSettings_1.REWARD_SETTINGS).map(([value, spec]) => ({ value, label: spec.label })), workspace.reward), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(id("reward_edit")).setLabel("Set Rate").setStyle(discord_js_1.ButtonStyle.Primary)));
    }
    components.push(ownerNavigation(workspace));
    return { content: "", embeds: [embed], components, attachments: [], allowedMentions: { parse: [] } };
}
function buildOwnerModal(workspace, action, label, hint, current) {
    const input = new discord_js_1.TextInputBuilder().setCustomId("value").setLabel(label).setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true).setMaxLength(80).setPlaceholder(hint);
    if (current !== undefined)
        input.setValue(current);
    return new discord_js_1.ModalBuilder().setCustomId(`${exports.OWNER_PREFIX}${action}:${workspace.id}`).setTitle("FNTCORD | Owner Control").addComponents(new discord_js_1.ActionRowBuilder().addComponents(input), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("reason")
        .setLabel("Reason for the change").setStyle(discord_js_1.TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)));
}
function buildOwnerConfirmation(workspace, confirmationId, description) {
    return {
        content: "",
        embeds: [new discord_js_1.EmbedBuilder().setColor(0xf1c40f).setTitle("FNTCORD | Confirm Owner Change").setDescription(description)],
        components: [
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.OWNER_PREFIX}confirm:${workspace.id}:${confirmationId}`).setLabel("Confirm Change").setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId(`${exports.OWNER_PREFIX}cancel:${workspace.id}`).setLabel("Cancel").setStyle(discord_js_1.ButtonStyle.Secondary)), ownerNavigation(workspace)
        ],
        attachments: [], allowedMentions: { parse: [] }
    };
}
