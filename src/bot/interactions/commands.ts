// Interaction handler: slash command dispatch and reply rendering.
import { APIEmbed, MessageFlags, type APIActionRowComponent, type APIComponentInMessageActionRow, type Interaction } from "discord.js";
import { getBossPortraitFiles } from "../../game/bossPortraits";
import { recordCommandOutcome } from "../core/metrics";
import { rejectIfRateLimitedForInteraction } from "../core/ops";
import { appendAuditEvent } from "../core/audit";
import { isUnknownInteractionError } from "../core/guards";
import { PRIVATE_SLASH_COMMANDS } from "../ui/ids";
import { helpDropdown } from "../ui/help";
import { clampText, embedFromPayload, embedFromText } from "../ui/embeds";
import { commandHandlers } from "../commands/handlers";
import { getCommandKey } from "../commands/keys";
import { progressionCardAttachment } from "../profile/cards";
import type { ProgressionCardKind } from "../../features/progressionCard";
import { ensureUser } from "../../utils";
import { normalizeHubPreferences } from "../../game/hubPreferences";

/** Runs a slash command handler and renders its reply. */
export async function handleChatInputCommand(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    const commandKey = getCommandKey(interaction);
    const handler = commandHandlers[commandKey];
    if (!handler) {
        const unknown = embedFromText("unknown", "Unknown command.", interaction.user);
        try {
            await interaction.reply({ embeds: [unknown] });
        } catch (error) {
            if (!isUnknownInteractionError(error)) {
                console.error("Unknown command reply failed:", error);
            }
        }
        return;
    }

    const throttleError = rejectIfRateLimitedForInteraction(interaction);
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
    }

    try {
        const startedAt = Date.now();
        await interaction.deferReply({
            flags: PRIVATE_SLASH_COMMANDS.has(commandKey)
                || (["xp", "pmc", "profile"].includes(commandKey)
                    && normalizeHubPreferences(ensureUser(interaction.user.id).preferences.hub).cardVisibility === "private")
                ? MessageFlags.Ephemeral : undefined
        });
        const rawResult = await handler(interaction);
        const result = typeof rawResult === "string"
            ? rawResult
            : JSON.stringify(rawResult ?? "No response returned.");
        const elapsedMs = Date.now() - startedAt;
        recordCommandOutcome(commandKey, true, elapsedMs);
        appendAuditEvent("slash_command", {
            command: commandKey,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            durationMs: elapsedMs
        });
        let parsed: { embed?: APIEmbed; embeds?: APIEmbed[]; withHelpNav?: boolean; helpPage?: string; components?: APIActionRowComponent<APIComponentInMessageActionRow>[]; bossPortraitName?: string; profilePayload?: boolean; staffPayload?: boolean; progressionCard?: ProgressionCardKind } | null = null;
        try {
            parsed = JSON.parse(result);
        } catch {
            parsed = null;
        }

        if (parsed?.embed && (parsed.progressionCard === "xp" || parsed.progressionCard === "pmc")) {
            await interaction.editReply({
                embeds: [parsed.embed],
                components: parsed.components || [],
                files: [await progressionCardAttachment(parsed.progressionCard, interaction.user, interaction.guild)],
                attachments: [],
                allowedMentions: { parse: [] }
            });
        } else if (parsed?.profilePayload || parsed?.staffPayload) {
            // Themed panels keep their own colors and controls instead of the generic outcome styling.
            await interaction.editReply({
                embeds: parsed.embeds || (parsed.embed ? [parsed.embed] : []),
                components: Array.isArray(parsed.components) ? parsed.components : [],
                allowedMentions: { parse: [] }
            });
        } else if (parsed?.embed) {
            try {
                const embed = embedFromPayload(commandKey, parsed.embed, interaction.user);
                if (parsed.withHelpNav) {
                    const page = ["general", "xp", "raids", "shop", "games", "bank", "moderation"].includes(parsed.helpPage || "")
                        ? parsed.helpPage as "general" | "xp" | "raids" | "shop" | "games" | "bank" | "moderation"
                        : "general";
                    await interaction.editReply({
                        embeds: [embed],
                        components: helpDropdown(page),
                        allowedMentions: { parse: ["roles"] }
                    });
                } else {
                    await interaction.editReply({
                        embeds: [embed],
                        components: Array.isArray(parsed.components) ? parsed.components : [],
                        files: getBossPortraitFiles(parsed.bossPortraitName),
                        ...(commandKey === "raid" ? { attachments: [] } : {}),
                        allowedMentions: { parse: ["roles"] }
                    });
                }
            } catch (structuredError) {
                console.error("Structured command response failed:", structuredError);
                await interaction.editReply({
                    embeds: [embedFromText(commandKey, "The command completed, but its rich display could not be rendered. Please retry.", interaction.user)],
                    components: []
                }).catch(() => undefined);
            }
        } else {
            await interaction.editReply({ embeds: [embedFromText(commandKey, result, interaction.user)] });
        }
    } catch (error) {
        if (isUnknownInteractionError(error)) {
            return;
        }

        console.error("Command execution failed:", error);
        const failureReason = clampText(error instanceof Error ? error.message : String(error), 220);
        appendAuditEvent("slash_command_error", {
            command: commandKey,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            reason: failureReason
        });
        recordCommandOutcome(commandKey, false, 0);
        try {
            const failText = `Command failed: ${failureReason}`;
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [embedFromText(commandKey, failText, interaction.user)] });
            } else {
                await interaction.reply({ embeds: [embedFromText(commandKey, failText, interaction.user)] });
            }
        } catch (responseError) {
            if (!isUnknownInteractionError(responseError)) {
                console.error("Command failure response could not be sent:", responseError);
            }
            // Ignore secondary response errors (e.g. interaction expired)
        }
    }
}
