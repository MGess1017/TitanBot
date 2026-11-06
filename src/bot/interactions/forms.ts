// Interaction handlers: ticket, report, gear, and giveaway forms.
import {
    ChannelType, EmbedBuilder, GuildMember, MessageFlags, PermissionFlagsBits, type Interaction
} from "discord.js";
import { ensureUser, savePoints } from "../../utils";
import { buildTicketIntakeReason, classifyTicketCategory } from "../../services/ticketEnhancements";
import { ITEM_DEFS } from "../../game/catalog";
import {
    CRAFT_RECIPES, craftItem, dismantleGear, insureGear, repairGear, saveLoadout, upgradeGear
} from "../../game/gearEconomy";
import { GEAR_UI_IDS } from "../../game/payloads";
import { REPORT_LOG_CHANNEL_ID } from "../core/config";
import { client } from "../core/client";
import { createAndPostGiveaway, sendGiveawayLog } from "../giveaways/giveaways";
import { appendAuditEvent } from "../core/audit";
import { parseDurationMs, parseUserIdFromReportTarget, submitFormalUserReport } from "../moderation/store";
import { findTicketById, saveTicketStore } from "../tickets/store";
import { buildGearActionModal, buildTicketIntakeModal } from "../ui/modals";
import { requireGuild } from "../core/guards";
import { GEAR_MODAL_PREFIX, GIVEAWAY_IDS, REPORT_IDS, TICKET_IDS } from "../ui/ids";
import { createTicketChannel } from "../tickets/channels";

/** Ticket, report, gear, and giveaway forms plus ticket satisfaction ratings. */
export async function handleFormInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isChatInputCommand() && interaction.commandName === "ticketintake") {
        const guildError = requireGuild(interaction);
        if (guildError) {
            await interaction.reply({ content: guildError, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        await interaction.showModal(buildTicketIntakeModal()).catch(async () => {
            await interaction.reply({ content: "Unable to open intake modal right now.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
        });
        return true;
    }


    if (interaction.isButton() && Object.values(GEAR_UI_IDS).includes(interaction.customId as typeof GEAR_UI_IDS[keyof typeof GEAR_UI_IDS])) {
        const action = Object.entries(GEAR_UI_IDS).find(([, id]) => id === interaction.customId)?.[0];
        if (action) await interaction.showModal(buildGearActionModal(action)).catch(() => undefined);
        return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(GEAR_MODAL_PREFIX)) {
        const action = interaction.customId.slice(GEAR_MODAL_PREFIX.length);
        const user = ensureUser(interaction.user.id);
        let result: { error?: string; changed?: number; cost?: number; recovered?: boolean } | null = null;
        if (action === "loadout") {
            result = saveLoadout(user, interaction.fields.getTextInputValue("name"), interaction.fields.getTextInputValue("weapon") || null, interaction.fields.getTextInputValue("armor") || null, interaction.fields.getTextInputValue("ammo") || null);
        } else if (action === "craft") {
            const recipe = CRAFT_RECIPES.find(entry => entry.outputId === interaction.fields.getTextInputValue("item").trim().toLowerCase());
            const recipeExamples = CRAFT_RECIPES.slice(0, 8).map(entry => entry.outputId).join(", ");
            result = recipe ? craftItem(user, recipe) : { error: `Unknown recipe output. Use one of: ${recipeExamples}.` };
        } else {
            const itemId = interaction.fields.getTextInputValue("item").trim().toLowerCase();
            result = action === "repair" ? repairGear(user, itemId) : action === "insure" ? insureGear(user, itemId) : action === "upgrade" ? upgradeGear(user, itemId) : dismantleGear(user, itemId);
        }
        savePoints();
        await interaction.reply({ content: result.error || `Gear ${action} completed${result.cost ? ` for ${result.cost} FN Token$` : ""}.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === TICKET_IDS.intakeModal) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Ticket intake can only be used in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const summary = interaction.fields.getTextInputValue(TICKET_IDS.intakeSummary).trim();
        const category = interaction.fields.getTextInputValue(TICKET_IDS.intakeCategory).trim() || "general";
        const details = interaction.fields.getTextInputValue(TICKET_IDS.intakeDetails).trim();
        // Forms opened before deployment can still include the removed platform field.
        const platform = interaction.fields.fields.has(TICKET_IDS.intakePlatform)
            ? interaction.fields.getTextInputValue(TICKET_IDS.intakePlatform).trim() : "";
        const evidence = interaction.fields.getTextInputValue(TICKET_IDS.intakeEvidence).trim();
        if (!summary || !details) {
            await interaction.reply({
                content: "Please include a short summary and tell us what happened.",
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        const intakeCategory = classifyTicketCategory(category);
        if (["report", "appeal", "billing"].includes(intakeCategory) && !evidence.trim()) {
            await interaction.reply({ content: `Please include a screenshot or message link for a ${intakeCategory} ticket, then submit again.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        const reason = buildTicketIntakeReason({ category, summary, details, platform, evidence });
        const priority = category.toLowerCase().includes("billing") ? "high" : "normal";

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const created = await createTicketChannel(guild, interaction.user.id, reason, priority, false);
        if (created.error) {
            await interaction.editReply({ content: created.error, allowedMentions: { parse: [] } });
            return true;
        }

        if (!created.channelId) {
            console.error("Ticket creation returned no channel:", { guildId: guild.id, ownerId: interaction.user.id });
            await interaction.editReply({ content: "Could not confirm your ticket channel. Please contact staff before trying again." });
            return true;
        }
        await interaction.editReply({
            embeds: [new EmbedBuilder()
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

    if (interaction.isModalSubmit() && interaction.customId === REPORT_IDS.adminModal) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Admin report intake can only be used in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const member = interaction.member as GuildMember | null;
        if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can file reports from this panel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const targetRaw = interaction.fields.getTextInputValue(REPORT_IDS.adminTarget) || "";
        const targetId = parseUserIdFromReportTarget(targetRaw);
        if (!targetId) {
            await interaction.reply({ content: "Target must be a valid Discord user mention or user ID.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const targetUser = await client.users.fetch(targetId).catch(() => null);
        if (!targetUser) {
            await interaction.reply({ content: "Unable to fetch that user from Discord.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const summary = (interaction.fields.getTextInputValue(REPORT_IDS.adminSummary) || "").trim();
        const details = (interaction.fields.getTextInputValue(REPORT_IDS.adminDetails) || "").trim();
        const evidence = (interaction.fields.getTextInputValue(REPORT_IDS.adminEvidence) || "").trim() || null;
        if (!summary) {
            await interaction.reply({ content: "Report summary is required.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const result = await submitFormalUserReport({
            guild,
            reporterId: interaction.user.id,
            targetUser,
            summary,
            details,
            evidence
        });

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(result.flagged ? 0xdc2626 : 0x0ea5e9)
                .setTitle("🚨 Formal User Report Filed")
                .addFields(
                    { name: "Report ID", value: `#${result.entry.id}`, inline: true },
                    { name: "Target", value: `<@${targetUser.id}>`, inline: true },
                    { name: "Reporter", value: `<@${interaction.user.id}>`, inline: true },
                    { name: "Summary", value: result.entry.summary, inline: false },
                    { name: "Evidence", value: evidence || "Not provided", inline: false },
                    { name: "Total Reports On User", value: `${result.totalReportsForTarget}${result.flagged ? " 🚩" : ""}`, inline: true },
                    { name: "Logged Channel", value: `<#${REPORT_LOG_CHANNEL_ID}>`, inline: true }
                )
                .setTimestamp(new Date())],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }


    if (interaction.isModalSubmit() && interaction.customId === GIVEAWAY_IDS.raidItemModal) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: "Raid item giveaways can only be created in a server.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const member = interaction.member as GuildMember | null;
        if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "Only administrators can create raid item giveaways.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const itemId = (interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidItemId) || "").trim().toLowerCase();
        const item = ITEM_DEFS[itemId];
        if (!item) {
            await interaction.reply({ content: `Unknown raid item: ${itemId}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const quantity = Math.max(1, Number.parseInt(interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidItemQty) || "1", 10) || 1);
        const durationRaw = (interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidDuration) || "").trim();
        const durationMs = parseDurationMs(durationRaw);
        if (!durationMs) {
            await interaction.reply({ content: "Invalid duration. Use values like 30m, 6h, or 2d.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const winnerCount = Math.max(1, Math.min(20, Number.parseInt(interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidWinners) || "1", 10) || 1));
        const description = (interaction.fields.getTextInputValue(GIVEAWAY_IDS.raidDescription) || "").slice(0, 400);
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText || !("send" in channel)) {
            await interaction.reply({ content: "This panel must be used in a text channel.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const giveaway = await createAndPostGiveaway({
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
            await interaction.reply({ content: "Failed to post the raid item giveaway.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        appendAuditEvent("giveaway_item_created", {
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
        await sendGiveawayLog(guild.id, `Giveaway #${giveaway.id} Created`, [
            { name: "Raid Item", value: `${item.name} (${itemId}) x${quantity}`, inline: false },
            { name: "Host", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Channel", value: `<#${channel.id}>`, inline: true },
            { name: "Winners", value: `${winnerCount}`, inline: true }
        ]);
        await interaction.reply({ content: `Raid item giveaway #${giveaway.id} is now live in <#${channel.id}>.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${TICKET_IDS.csatPrefix}:`)) {
        const parts = interaction.customId.split(":");
        const ticketId = Number(parts[1]);
        const rating = Math.max(1, Math.min(5, Number(parts[2]) || 5));
        const ticket = findTicketById(ticketId);
        if (!ticket) {
            if (interaction.guildId) {
                await interaction.reply({ content: "Ticket was not found for this feedback.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            } else {
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
        const saved = saveTicketStore();
        if (!saved) {
            if (interaction.guildId) {
                await interaction.reply({ content: "Unable to save feedback due to a store conflict. Please try again.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            } else {
                await interaction.reply({ content: "Unable to save feedback due to a store conflict. Please try again." }).catch(() => undefined);
            }
            return true;
        }

        appendAuditEvent("ticket_csat", {
            ticketId: ticket.id,
            guildId: ticket.guildId,
            rating,
            submittedById: interaction.user.id
        });

        if (interaction.guildId) {
            await interaction.reply({ content: `Thanks for rating ticket #${ticket.id} with ${rating}/5.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        } else {
            await interaction.reply({ content: `Thanks for rating ticket #${ticket.id} with ${rating}/5.` }).catch(() => undefined);
        }
        return true;
    }
    return false;
}
