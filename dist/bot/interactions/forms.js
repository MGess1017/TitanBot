"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFormInteraction = handleFormInteraction;
// Interaction handlers: ticket, report, gear, and giveaway forms.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const ticketEnhancements_1 = require("../../services/ticketEnhancements");
const catalog_1 = require("../../game/catalog");
const gearEconomy_1 = require("../../game/gearEconomy");
const payloads_1 = require("../../game/payloads");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const giveaways_1 = require("../giveaways/giveaways");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const store_2 = require("../tickets/store");
const modals_1 = require("../ui/modals");
const guards_1 = require("../core/guards");
const ids_1 = require("../ui/ids");
const channels_1 = require("../tickets/channels");
const ticketExperience_1 = require("../../services/ticketExperience");
const drafts_1 = require("../tickets/drafts");
/** Ticket, report, gear, and giveaway forms plus ticket satisfaction ratings. */
async function handleFormInteraction(interaction) {
    if (interaction.isChatInputCommand() && (interaction.commandName === "ticketintake"
        || (interaction.commandName === "ticket" && !interaction.options.getString("reason")))) {
        const guildError = (0, guards_1.requireGuild)(interaction);
        if (guildError) {
            await interaction.reply({ content: guildError, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.reply({ ...(0, modals_1.buildTicketCategoryPicker)(), flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.isButton() && Object.values(payloads_1.GEAR_UI_IDS).includes(interaction.customId)) {
        const action = Object.entries(payloads_1.GEAR_UI_IDS).find(([, id]) => id === interaction.customId)?.[0];
        if (action)
            await interaction.showModal((0, modals_1.buildGearActionModal)(action)).catch(() => undefined);
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(ids_1.GEAR_MODAL_PREFIX)) {
        const action = interaction.customId.slice(ids_1.GEAR_MODAL_PREFIX.length);
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        let result = null;
        if (action === "loadout") {
            result = (0, gearEconomy_1.saveLoadout)(user, interaction.fields.getTextInputValue("name"), interaction.fields.getTextInputValue("weapon") || null, interaction.fields.getTextInputValue("armor") || null, interaction.fields.getTextInputValue("ammo") || null);
        }
        else if (action === "craft") {
            const recipe = gearEconomy_1.CRAFT_RECIPES.find(entry => entry.outputId === interaction.fields.getTextInputValue("item").trim().toLowerCase());
            const recipeExamples = gearEconomy_1.CRAFT_RECIPES.slice(0, 8).map(entry => entry.outputId).join(", ");
            result = recipe ? (0, gearEconomy_1.craftItem)(user, recipe) : { error: `Unknown recipe output. Use one of: ${recipeExamples}.` };
        }
        else {
            const itemId = interaction.fields.getTextInputValue("item").trim().toLowerCase();
            result = action === "repair" ? (0, gearEconomy_1.repairGear)(user, itemId) : action === "insure" ? (0, gearEconomy_1.insureGear)(user, itemId) : action === "upgrade" ? (0, gearEconomy_1.upgradeGear)(user, itemId) : (0, gearEconomy_1.dismantleGear)(user, itemId);
        }
        (0, utils_1.savePoints)();
        await interaction.reply({ content: result.error || `Gear ${action} completed${result.cost ? ` for ${result.cost} FN Token$` : ""}.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isModalSubmit() && (interaction.customId === ids_1.TICKET_IDS.intakeModal
        || interaction.customId.startsWith(`${ids_1.TICKET_IDS.intakeModal}:`))) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Ticket intake can only be used in a server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const summary = interaction.fields.getTextInputValue(ids_1.TICKET_IDS.intakeSummary).trim();
        const selectedCategory = interaction.customId.split(":")[1];
        if (selectedCategory && !(0, ticketExperience_1.isTicketTopic)(selectedCategory)) {
            await interaction.reply({ content: "This ticket form has an invalid topic. Open a new form from the support panel.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const legacyCategory = !selectedCategory && interaction.fields.fields.has(ids_1.TICKET_IDS.intakeCategory)
            ? interaction.fields.getTextInputValue(ids_1.TICKET_IDS.intakeCategory).trim() : "";
        const category = selectedCategory || (0, ticketEnhancements_1.classifyTicketCategory)(legacyCategory || "general");
        const details = interaction.fields.getTextInputValue(ids_1.TICKET_IDS.intakeDetails).trim();
        // Forms opened before deployment can still include the removed platform field.
        const platform = interaction.fields.fields.has(ids_1.TICKET_IDS.intakePlatform)
            ? interaction.fields.getTextInputValue(ids_1.TICKET_IDS.intakePlatform).trim() : "";
        const evidence = interaction.fields.getTextInputValue(ids_1.TICKET_IDS.intakeEvidence).trim();
        const draft = {
            category: (0, ticketExperience_1.isTicketTopic)(category) ? category : "general",
            summary, details, evidence, platform: platform || (0, drafts_1.getTicketDraft)(guild.id, interaction.user.id)?.platform,
            at: Date.now()
        };
        const retained = (0, drafts_1.saveTicketDraft)(guild.id, interaction.user.id, draft);
        const retry = retained ? [(0, modals_1.buildTicketRetryRow)()] : [];
        const retentionWarning = retained ? "" : " Your draft could not be saved. Copy your details before retrying.";
        if (!summary || !details) {
            await interaction.reply({
                content: `Please include a short summary and tell us what happened.${retentionWarning}`,
                components: retry,
                flags: discord_js_1.MessageFlags.Ephemeral
            });
            return true;
        }
        const intakeCategory = (0, ticketEnhancements_1.classifyTicketCategory)(category);
        if (["report", "appeal", "billing"].includes(intakeCategory) && !evidence.trim()) {
            await interaction.reply({ content: `Please include a screenshot or message link for a ${intakeCategory} ticket, then submit again.${retentionWarning}`, components: retry, flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const reason = (0, ticketEnhancements_1.buildTicketIntakeReason)({ category, summary, details, platform: draft.platform, evidence });
        const priority = category.toLowerCase().includes("billing") ? "high" : "normal";
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        let created;
        try {
            created = await (0, channels_1.createTicketChannel)(guild, interaction.user.id, reason, priority, false, draft);
        }
        catch (error) {
            console.error("Ticket creation failed; draft retained where possible:", error);
            await interaction.editReply({ content: `Could not create your ticket. Check for an existing ticket before retrying.${retentionWarning}`, components: retry });
            return true;
        }
        if (created.error) {
            await interaction.editReply({ content: created.error + retentionWarning, components: retry, allowedMentions: { parse: [] } });
            return true;
        }
        if (!created.channelId) {
            console.error("Ticket creation returned no channel:", { guildId: guild.id, ownerId: interaction.user.id });
            await interaction.editReply({ content: "Could not confirm your ticket channel. Please contact staff before trying again.", components: retry });
            return true;
        }
        if (!(0, drafts_1.saveTicketDraft)(guild.id, interaction.user.id, null))
            console.warn("Could not clear the submitted ticket draft.");
        await interaction.editReply({
            embeds: [new discord_js_1.EmbedBuilder()
                    .setColor(0x9b59b6)
                    .setTitle("Ticket Opened")
                    .setDescription([
                    `• Continue in <#${created.channelId}>.`,
                    "• Add any screenshots or files there.",
                    "• The support team will reply in your ticket."
                ].join("\n"))],
            allowedMentions: { parse: [] }
        });
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId === ids_1.REPORT_IDS.adminModal) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Admin report intake can only be used in a server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member;
        if (!member?.permissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can file reports from this panel.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const targetRaw = interaction.fields.getTextInputValue(ids_1.REPORT_IDS.adminTarget) || "";
        const targetId = (0, store_1.parseUserIdFromReportTarget)(targetRaw);
        if (!targetId) {
            await interaction.reply({ content: "Target must be a valid Discord user mention or user ID.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const targetUser = await client_1.client.users.fetch(targetId).catch(() => null);
        if (!targetUser) {
            await interaction.reply({ content: "Unable to fetch that user from Discord.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const summary = (interaction.fields.getTextInputValue(ids_1.REPORT_IDS.adminSummary) || "").trim();
        const details = (interaction.fields.getTextInputValue(ids_1.REPORT_IDS.adminDetails) || "").trim();
        const evidence = (interaction.fields.getTextInputValue(ids_1.REPORT_IDS.adminEvidence) || "").trim() || null;
        if (!summary) {
            await interaction.reply({ content: "Report summary is required.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const result = await (0, store_1.submitFormalUserReport)({
            guild,
            reporterId: interaction.user.id,
            targetUser,
            summary,
            details,
            evidence
        });
        await interaction.reply({
            embeds: [new discord_js_1.EmbedBuilder()
                    .setColor(result.flagged ? 0xdc2626 : 0x0ea5e9)
                    .setTitle("🚨 Formal User Report Filed")
                    .addFields({ name: "Report ID", value: `#${result.entry.id}`, inline: true }, { name: "Target", value: `<@${targetUser.id}>`, inline: true }, { name: "Reporter", value: `<@${interaction.user.id}>`, inline: true }, { name: "Summary", value: result.entry.summary, inline: false }, { name: "Evidence", value: evidence || "Not provided", inline: false }, { name: "Total Reports On User", value: `${result.totalReportsForTarget}${result.flagged ? " 🚩" : ""}`, inline: true }, { name: "Logged Channel", value: `<#${config_1.REPORT_LOG_CHANNEL_ID}>`, inline: true })
                    .setTimestamp(new Date())],
            flags: discord_js_1.MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId === ids_1.GIVEAWAY_IDS.raidItemModal) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Raid item giveaways can only be created in a server.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member;
        if (!member || !member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can create raid item giveaways.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const itemId = (interaction.fields.getTextInputValue(ids_1.GIVEAWAY_IDS.raidItemId) || "").trim().toLowerCase();
        const item = catalog_1.ITEM_DEFS[itemId];
        if (!item) {
            await interaction.reply({ content: `Unknown raid item: ${itemId}`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const quantity = Math.max(1, Number.parseInt(interaction.fields.getTextInputValue(ids_1.GIVEAWAY_IDS.raidItemQty) || "1", 10) || 1);
        const durationRaw = (interaction.fields.getTextInputValue(ids_1.GIVEAWAY_IDS.raidDuration) || "").trim();
        const durationMs = (0, store_1.parseDurationMs)(durationRaw);
        if (!durationMs) {
            await interaction.reply({ content: "Invalid duration. Use values like 30m, 6h, or 2d.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const winnerCount = Math.max(1, Math.min(20, Number.parseInt(interaction.fields.getTextInputValue(ids_1.GIVEAWAY_IDS.raidWinners) || "1", 10) || 1));
        const description = (interaction.fields.getTextInputValue(ids_1.GIVEAWAY_IDS.raidDescription) || "").slice(0, 400);
        const channel = interaction.channel;
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText || !("send" in channel)) {
            await interaction.reply({ content: "This panel must be used in a text channel.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const giveaway = await (0, giveaways_1.createAndPostGiveaway)({
            guild,
            channel,
            hostId: interaction.user.id,
            prize: `${item.name} Giveaway`,
            description,
            durationMs,
            winnerCount,
            roleRequiredId: null,
            rewardKind: "item",
            rewardItemId: itemId,
            rewardQty: quantity
        });
        if (!giveaway) {
            await interaction.reply({ content: "Failed to post the raid item giveaway.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        (0, audit_1.appendAuditEvent)("giveaway_item_created", {
            guildId: guild.id,
            giveawayId: giveaway.id,
            hostId: interaction.user.id,
            channelId: channel.id,
            itemId,
            quantity,
            durationMs,
            winnerCount,
            source: "panel"
        });
        await (0, giveaways_1.sendGiveawayLog)(guild.id, `Giveaway #${giveaway.id} Created`, [
            { name: "Raid Item", value: `${item.name} (${itemId}) x${quantity}`, inline: false },
            { name: "Host", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Channel", value: `<#${channel.id}>`, inline: true },
            { name: "Winners", value: `${winnerCount}`, inline: true }
        ]);
        await interaction.reply({ content: `Raid item giveaway #${giveaway.id} is now live in <#${channel.id}>.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${ids_1.TICKET_IDS.csatPrefix}:`)) {
        const parts = interaction.customId.split(":");
        const ticketId = Number(parts[1]);
        const rating = Math.max(1, Math.min(5, Number(parts[2]) || 5));
        const ticket = (0, store_2.findTicketById)(ticketId);
        if (!ticket) {
            if (interaction.guildId) {
                await interaction.reply({ content: "Ticket was not found for this feedback.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            }
            else {
                await interaction.reply({ content: "Ticket was not found for this feedback." }).catch(() => undefined);
            }
            return true;
        }
        ticket.csat = {
            rating,
            submittedAt: Date.now(),
            submittedById: interaction.user.id
        };
        ticket.updatedAt = Date.now();
        const saved = (0, store_2.saveTicketStore)();
        if (!saved) {
            if (interaction.guildId) {
                await interaction.reply({ content: "Unable to save feedback due to a store conflict. Please try again.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            }
            else {
                await interaction.reply({ content: "Unable to save feedback due to a store conflict. Please try again." }).catch(() => undefined);
            }
            return true;
        }
        (0, audit_1.appendAuditEvent)("ticket_csat", {
            ticketId: ticket.id,
            guildId: ticket.guildId,
            rating,
            submittedById: interaction.user.id
        });
        if (interaction.guildId) {
            await interaction.reply({ content: `Thanks for rating ticket #${ticket.id} with ${rating}/5.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        }
        else {
            await interaction.reply({ content: `Thanks for rating ticket #${ticket.id} with ${rating}/5.` }).catch(() => undefined);
        }
        return true;
    }
    return false;
}
