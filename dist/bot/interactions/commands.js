"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChatInputCommand = handleChatInputCommand;
// Interaction handler: slash command dispatch and reply rendering.
const discord_js_1 = require("discord.js");
const bossPortraits_1 = require("../../game/bossPortraits");
const xpCratePanel_1 = require("../../features/xpCratePanel");
const metrics_1 = require("../core/metrics");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const guards_1 = require("../core/guards");
const ids_1 = require("../ui/ids");
const help_1 = require("../ui/help");
const embeds_1 = require("../ui/embeds");
const handlers_1 = require("../commands/handlers");
/** Runs a slash command handler and renders its reply. */
async function handleChatInputCommand(interaction) {
    if (!interaction.isChatInputCommand())
        return;
    const handler = handlers_1.commandHandlers[interaction.commandName];
    if (!handler) {
        const unknown = (0, embeds_1.embedFromText)("unknown", "Unknown command.", interaction.user);
        try {
            await interaction.reply({ embeds: [unknown] });
        }
        catch (error) {
            if (!(0, guards_1.isUnknownInteractionError)(error)) {
                console.error("Unknown command reply failed:", error);
            }
        }
        return;
    }
    const throttleError = (0, ops_1.rejectIfRateLimitedForInteraction)(interaction);
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return;
    }
    try {
        const startedAt = Date.now();
        await interaction.deferReply({
            flags: ids_1.PRIVATE_SLASH_COMMANDS.has(interaction.commandName) ? discord_js_1.MessageFlags.Ephemeral : undefined
        });
        const rawResult = await handler(interaction);
        const result = typeof rawResult === "string"
            ? rawResult
            : JSON.stringify(rawResult ?? "No response returned.");
        const elapsedMs = Date.now() - startedAt;
        (0, metrics_1.recordCommandOutcome)(interaction.commandName, true, elapsedMs);
        (0, audit_1.appendAuditEvent)("slash_command", {
            command: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            durationMs: elapsedMs
        });
        let parsed = null;
        try {
            parsed = JSON.parse(result);
        }
        catch {
            parsed = null;
        }
        if (parsed?.profilePayload || parsed?.staffPayload) {
            // Themed panels keep their own colors and controls instead of the generic outcome styling.
            await interaction.editReply({
                embeds: parsed.embeds || (parsed.embed ? [parsed.embed] : []),
                components: Array.isArray(parsed.components) ? parsed.components : [],
                allowedMentions: { parse: [] }
            });
        }
        else if (parsed?.embed) {
            try {
                const embed = (0, embeds_1.embedFromPayload)(interaction.commandName, parsed.embed, interaction.user);
                if (parsed.withHelpNav) {
                    const page = ["general", "xp", "raids", "shop", "games", "bank", "moderation"].includes(parsed.helpPage || "")
                        ? parsed.helpPage
                        : "general";
                    await interaction.editReply({
                        embeds: [embed],
                        components: (0, help_1.helpDropdown)(page),
                        allowedMentions: { parse: ["roles"] }
                    });
                }
                else {
                    await interaction.editReply({
                        embeds: [embed],
                        components: Array.isArray(parsed.components) ? parsed.components : [],
                        files: interaction.commandName === "xp" && parsed.xpCrateId
                            ? [(0, xpCratePanel_1.xpCrateAttachment)(parsed.xpCrateId)]
                            : (0, bossPortraits_1.getBossPortraitFiles)(parsed.bossPortraitName),
                        ...(interaction.commandName === "raid" ? { attachments: [] } : {}),
                        allowedMentions: { parse: ["roles"] }
                    });
                }
            }
            catch (structuredError) {
                console.error("Structured command response failed:", structuredError);
                await interaction.editReply({
                    embeds: [(0, embeds_1.embedFromText)(interaction.commandName, "The command completed, but its rich display could not be rendered. Please retry.", interaction.user)],
                    components: []
                }).catch(() => undefined);
            }
        }
        else {
            await interaction.editReply({ embeds: [(0, embeds_1.embedFromText)(interaction.commandName, result, interaction.user)] });
        }
    }
    catch (error) {
        if ((0, guards_1.isUnknownInteractionError)(error)) {
            return;
        }
        console.error("Command execution failed:", error);
        const failureReason = (0, embeds_1.clampText)(error instanceof Error ? error.message : String(error), 220);
        (0, audit_1.appendAuditEvent)("slash_command_error", {
            command: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            reason: failureReason
        });
        (0, metrics_1.recordCommandOutcome)(interaction.commandName, false, 0);
        try {
            const failText = `Command failed: ${failureReason}`;
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [(0, embeds_1.embedFromText)(interaction.commandName, failText, interaction.user)] });
            }
            else {
                await interaction.reply({ embeds: [(0, embeds_1.embedFromText)(interaction.commandName, failText, interaction.user)] });
            }
        }
        catch (responseError) {
            if (!(0, guards_1.isUnknownInteractionError)(responseError)) {
                console.error("Command failure response could not be sent:", responseError);
            }
            // Ignore secondary response errors (e.g. interaction expired)
        }
    }
}
