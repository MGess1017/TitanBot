"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketIntakeModal = buildTicketIntakeModal;
exports.buildAdminReportIntakeModal = buildAdminReportIntakeModal;
exports.buildRaidItemGiveawayModal = buildRaidItemGiveawayModal;
exports.buildGearActionModal = buildGearActionModal;
exports.buildPmcIdentityModal = buildPmcIdentityModal;
// Intake and action modals (tickets, reports, giveaways, gear, PMC identity).
const discord_js_1 = require("discord.js");
const ids_1 = require("./ids");
function buildTicketIntakeModal() {
    const summaryInput = new discord_js_1.TextInputBuilder()
        .setCustomId(ids_1.TICKET_IDS.intakeSummary)
        .setLabel("What do you need help with?")
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setPlaceholder("Short title: what do you need help with?");
    const categoryInput = new discord_js_1.TextInputBuilder()
        .setCustomId(ids_1.TICKET_IDS.intakeCategory)
        .setLabel("Topic (optional)")
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder("bug, billing, account, report, appeal, general");
    const detailsInput = new discord_js_1.TextInputBuilder()
        .setCustomId(ids_1.TICKET_IDS.intakeDetails)
        .setLabel("Tell us what happened")
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(700)
        .setPlaceholder("What happened and what help you need. Add times or an order ID if relevant.");
    const evidenceInput = new discord_js_1.TextInputBuilder()
        .setCustomId(ids_1.TICKET_IDS.intakeEvidence)
        .setLabel("Screenshot / message links")
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(400)
        .setPlaceholder("Links required for reports, appeals, or billing. Otherwise optional. Add files in the ticket.");
    return new discord_js_1.ModalBuilder()
        .setCustomId(ids_1.TICKET_IDS.intakeModal)
        .setTitle("Open Support Ticket")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(summaryInput), new discord_js_1.ActionRowBuilder().addComponents(detailsInput), new discord_js_1.ActionRowBuilder().addComponents(categoryInput), new discord_js_1.ActionRowBuilder().addComponents(evidenceInput));
}
function buildAdminReportIntakeModal() {
    const targetInput = new discord_js_1.TextInputBuilder()
        .setCustomId(ids_1.REPORT_IDS.adminTarget)
        .setLabel("Target User ID or Mention")
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setPlaceholder("123456789012345678 or <@123...>");
    const summaryInput = new discord_js_1.TextInputBuilder()
        .setCustomId(ids_1.REPORT_IDS.adminSummary)
        .setLabel("Report Summary")
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setPlaceholder("Cheating, harassment, scam, abuse, etc.");
    const detailsInput = new discord_js_1.TextInputBuilder()
        .setCustomId(ids_1.REPORT_IDS.adminDetails)
        .setLabel("Detailed Context")
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(900)
        .setPlaceholder("Optional incident details, timeline, and context.");
    const evidenceInput = new discord_js_1.TextInputBuilder()
        .setCustomId(ids_1.REPORT_IDS.adminEvidence)
        .setLabel("Evidence Links")
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
        .setPlaceholder("Optional screenshots, clips, logs, links.");
    return new discord_js_1.ModalBuilder()
        .setCustomId(ids_1.REPORT_IDS.adminModal)
        .setTitle("Admin Report Intake")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(targetInput), new discord_js_1.ActionRowBuilder().addComponents(summaryInput), new discord_js_1.ActionRowBuilder().addComponents(detailsInput), new discord_js_1.ActionRowBuilder().addComponents(evidenceInput));
}
function buildRaidItemGiveawayModal() {
    return new discord_js_1.ModalBuilder()
        .setCustomId(ids_1.GIVEAWAY_IDS.raidItemModal)
        .setTitle("Raid Item Giveaway")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId(ids_1.GIVEAWAY_IDS.raidItemId).setLabel("Raid Item ID").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder("mythic_crate, fn_coin, reactor_blade")), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId(ids_1.GIVEAWAY_IDS.raidItemQty).setLabel("Quantity Per Winner").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder("1")), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId(ids_1.GIVEAWAY_IDS.raidDuration).setLabel("Duration").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(20).setPlaceholder("30m, 6h, 2d")), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId(ids_1.GIVEAWAY_IDS.raidWinners).setLabel("Winner Count").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder("1")), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId(ids_1.GIVEAWAY_IDS.raidDescription).setLabel("Description").setStyle(discord_js_1.TextInputStyle.Paragraph).setRequired(false).setMaxLength(400).setPlaceholder("Optional context or event blurb")));
}
function buildGearActionModal(action) {
    const modal = new discord_js_1.ModalBuilder().setCustomId(`${ids_1.GEAR_MODAL_PREFIX}${action}`).setTitle(`Gear ${action}`);
    if (action === "loadout") {
        return modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("name").setLabel("Loadout name").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(24)), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("weapon").setLabel("Weapon ID (optional)").setStyle(discord_js_1.TextInputStyle.Short).setRequired(false).setMaxLength(80)), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("armor").setLabel("Armor ID (optional)").setStyle(discord_js_1.TextInputStyle.Short).setRequired(false).setMaxLength(80)), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("ammo").setLabel("Ammo ID (optional)").setStyle(discord_js_1.TextInputStyle.Short).setRequired(false).setMaxLength(80)));
    }
    const label = action === "craft" ? "Recipe output ID" : "Item ID";
    return modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("item").setLabel(label).setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(80)));
}
function buildPmcIdentityModal() {
    return new discord_js_1.ModalBuilder()
        .setCustomId("pmc_identity_modal")
        .setTitle("PMC Identity")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("callsign").setLabel("Callsign").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(24).setPlaceholder("Your field callsign")), new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder().setCustomId("banner").setLabel("Banner name").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true).setMaxLength(24).setPlaceholder("standard, veteran, apex")));
}
