import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder,
    TextInputBuilder, TextInputStyle, UserSelectMenuBuilder
} from "discord.js";
import { FEATURE_TOGGLES, REWARD_SETTINGS, type FeatureToggle, type RewardSetting } from "./botSettings";
import { OWNER_VALUE_FIELDS, type OwnerValueField, type OwnerValueOperation } from "../game/ownerControls";

export const OWNER_PANEL_TITLE = "FNTCORD | Owner Control";
export const OWNER_PREFIX = "owner:";
export type OwnerPage = "home" | "values" | "quotas" | "features" | "guardrails" | "reviews";
export type OwnerWorkspace = {
    id: string; actorId: string; guildId: string; expiresAt: number; page: OwnerPage;
    targetId: string | null; field: OwnerValueField; operation: OwnerValueOperation;
    quotaUserId: string | null; quotaScope: "guild" | "member"; quotaAction: "ban" | "kick"; period: "day" | "week" | "month";
    feature: FeatureToggle; reward: RewardSetting;
    reviewPage?: number;
};

export function ownerNavigation(workspace: OwnerWorkspace) {
    const button = (action: string, label: string) => new ButtonBuilder()
        .setCustomId(`${OWNER_PREFIX}${action}:${workspace.id}`).setLabel(label).setStyle(ButtonStyle.Secondary);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("home", "Home"), button("back", "Back"), button("refresh", "Refresh"), button("customize", "Customize")
    );
}

export function buildOwnerLauncher() {
    return {
        embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(OWNER_PANEL_TITLE)
            .setDescription("Owner-only player controls, moderation limits, and feature management.\nOpen a private workspace to begin.")
            .setFooter({ text: "FNTCORD / AUTHORIZED OWNERS ONLY" })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${OWNER_PREFIX}start`).setLabel("Open Owner Control").setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: { parse: [] as const }
    };
}

export function buildOwnerWorkspace(workspace: OwnerWorkspace, summary: string, detailFields: Array<{ name: string; value: string }> = []) {
    const id = (action: string) => `${OWNER_PREFIX}${action}:${workspace.id}`;
    const select = (action: string, placeholder: string, choices: Array<{ value: string; label: string }>, current?: string) =>
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(id(action)).setPlaceholder(placeholder)
            .addOptions(choices.map(choice => ({ ...choice, default: choice.value === current }))));
    const titles: Record<OwnerPage, string> = { home: "Owner Control", values: "Player Values", quotas: "Moderation Limits", features: "Feature Controls", guardrails: "Guardrails & History", reviews: "Store Review Log" };
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(`FNTCORD | ${titles[workspace.page]}`)
        .setDescription(summary).setFooter({ text: "PRIVATE / CHANGES REQUIRE CONFIRMATION / SESSION EXPIRES IN 15 MINUTES" });
    if (detailFields.length) embed.addFields(detailFields.slice(0, 10));
    const components: Array<ReturnType<typeof select> | ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<UserSelectMenuBuilder>> = [];
    if (workspace.page === "home") {
        components.push(select("page", "Choose an owner workspace", [
            { value: "values", label: "Player XP, FN Tokenz & Access Points" },
            { value: "quotas", label: "Ban / Kick Limits" }, { value: "features", label: "Feature & XP Rate Controls" },
            { value: "guardrails", label: "Guardrails & Recent History" },
            { value: "reviews", label: "Store Fulfillment & Review Log" }
        ]));
    } else if (workspace.page === "values") {
        components.push(
            new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(id("player")).setPlaceholder("Choose a player").setMaxValues(1)),
            select("field", "Player value", Object.entries(OWNER_VALUE_FIELDS).map(([value, label]) => ({ value, label })), workspace.field),
            select("operation", "Adjustment mode", [{ value: "set", label: "Set exact total" }, { value: "add", label: "Add amount" }, { value: "remove", label: "Remove amount" }], workspace.operation),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(id("amount")).setLabel("Enter Amount").setStyle(ButtonStyle.Primary).setDisabled(!workspace.targetId)
            )
        );
    } else if (workspace.page === "quotas") {
        components.push(select("scope", "Limit scope", [{ value: "guild", label: "Default for each administrator" }, { value: "member", label: "Individual administrator override" }], workspace.quotaScope));
        if (workspace.quotaScope === "member") components.push(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder().setCustomId(id("quota_user")).setPlaceholder("Choose an administrator").setMaxValues(1)
        ));
        components.push(select("quota_kind", "Action and calendar timeframe (UTC)", ["ban", "kick"].flatMap(action =>
            ["day", "week", "month"].map(period => ({ value: `${action}_${period}`, label: `${action === "ban" ? "Ban" : "Kick"} / per calendar ${period} (UTC)` }))
        ), `${workspace.quotaAction}_${workspace.period}`));
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(id("quota_edit")).setLabel("Set Allowance").setStyle(ButtonStyle.Primary)
                .setDisabled(workspace.quotaScope === "member" && !workspace.quotaUserId)
        ));
    } else if (workspace.page === "reviews") {
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(id("fulfill")).setLabel("Confirm Store Fulfillment").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(id("reviews_previous")).setLabel("Previous Log Page").setStyle(ButtonStyle.Secondary).setDisabled(!(workspace.reviewPage || 0)),
            new ButtonBuilder().setCustomId(id("reviews_next")).setLabel("Next Log Page").setStyle(ButtonStyle.Secondary)
        ));
    } else if (workspace.page === "features") {
        components.push(
            select("feature", "Feature switch", Object.entries(FEATURE_TOGGLES).map(([value, label]) => ({ value, label })), workspace.feature),
            new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(id("feature_edit")).setLabel("Change Feature State").setStyle(ButtonStyle.Primary)),
            select("reward", "XP and cosmetic rate", Object.entries(REWARD_SETTINGS).map(([value, spec]) => ({ value, label: spec.label })), workspace.reward),
            new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(id("reward_edit")).setLabel("Set Rate").setStyle(ButtonStyle.Primary))
        );
    }
    components.push(ownerNavigation(workspace));
    return { content: "", embeds: [embed], components, attachments: [], allowedMentions: { parse: [] as const } };
}

export function buildFulfillmentModal(workspace: OwnerWorkspace) {
    return new ModalBuilder().setCustomId(`${OWNER_PREFIX}fulfill_modal:${workspace.id}`).setTitle("FNTCORD | Confirm Fulfillment")
        .addComponents(...[["ticket", "Store request ticket number"], ["reason", "Fulfillment details (no private info)"]].map(([id, label]) =>
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label)
                .setStyle(id === "reason" ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(true).setMaxLength(id === "reason" ? 300 : 12))));
}

export function buildOwnerModal(workspace: OwnerWorkspace, action: string, label: string, hint: string, current?: string) {
    const input = new TextInputBuilder().setCustomId("value").setLabel(label).setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(80).setPlaceholder(hint);
    if (current !== undefined) input.setValue(current);
    return new ModalBuilder().setCustomId(`${OWNER_PREFIX}${action}:${workspace.id}`).setTitle("FNTCORD | Owner Control").addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(input),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason")
            .setLabel("Reason for the change").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300))
    );
}

export function buildOwnerConfirmation(workspace: OwnerWorkspace, confirmationId: string, description: string) {
    return {
        content: "",
        embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle("FNTCORD | Confirm Owner Change").setDescription(description)],
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`${OWNER_PREFIX}confirm:${workspace.id}:${confirmationId}`).setLabel("Confirm Change").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`${OWNER_PREFIX}cancel:${workspace.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
            ), ownerNavigation(workspace)
        ],
        attachments: [], allowedMentions: { parse: [] as const }
    };
}
