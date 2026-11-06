// Intake and action modals (tickets, reports, giveaways, gear, PMC identity).
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { GEAR_MODAL_PREFIX, GIVEAWAY_IDS, REPORT_IDS, TICKET_IDS } from "./ids";

export function buildTicketIntakeModal(): ModalBuilder {
    const summaryInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakeSummary)
        .setLabel("What do you need help with?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setPlaceholder("Short title: what do you need help with?");

    const categoryInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakeCategory)
        .setLabel("Topic (optional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder("bug, billing, account, report, appeal, general");

    const detailsInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakeDetails)
        .setLabel("Tell us what happened")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(700)
        .setPlaceholder("What happened and what help you need. Add times or an order ID if relevant.");

    const evidenceInput = new TextInputBuilder()
        .setCustomId(TICKET_IDS.intakeEvidence)
        .setLabel("Screenshot / message links")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(400)
        .setPlaceholder("Links required for reports, appeals, or billing. Otherwise optional. Add files in the ticket.");

    return new ModalBuilder()
        .setCustomId(TICKET_IDS.intakeModal)
        .setTitle("Open Support Ticket")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(detailsInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(evidenceInput)
        );
}

export function buildAdminReportIntakeModal(): ModalBuilder {
    const targetInput = new TextInputBuilder()
        .setCustomId(REPORT_IDS.adminTarget)
        .setLabel("Target User ID or Mention")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setPlaceholder("123456789012345678 or <@123...>");

    const summaryInput = new TextInputBuilder()
        .setCustomId(REPORT_IDS.adminSummary)
        .setLabel("Report Summary")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setPlaceholder("Cheating, harassment, scam, abuse, etc.");

    const detailsInput = new TextInputBuilder()
        .setCustomId(REPORT_IDS.adminDetails)
        .setLabel("Detailed Context")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(900)
        .setPlaceholder("Optional incident details, timeline, and context.");

    const evidenceInput = new TextInputBuilder()
        .setCustomId(REPORT_IDS.adminEvidence)
        .setLabel("Evidence Links")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
        .setPlaceholder("Optional screenshots, clips, logs, links.");

    return new ModalBuilder()
        .setCustomId(REPORT_IDS.adminModal)
        .setTitle("Admin Report Intake")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(targetInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(detailsInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(evidenceInput)
        );
}

export function buildRaidItemGiveawayModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(GIVEAWAY_IDS.raidItemModal)
        .setTitle("Raid Item Giveaway")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidItemId).setLabel("Raid Item ID").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder("mythic_crate, fn_coin, reactor_blade")
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidItemQty).setLabel("Quantity Per Winner").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder("1")
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidDuration).setLabel("Duration").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setPlaceholder("30m, 6h, 2d")
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidWinners).setLabel("Winner Count").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder("1")
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId(GIVEAWAY_IDS.raidDescription).setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400).setPlaceholder("Optional context or event blurb")
            )
        );
}

export function buildGearActionModal(action: string): ModalBuilder {
    const modal = new ModalBuilder().setCustomId(`${GEAR_MODAL_PREFIX}${action}`).setTitle(`Gear ${action}`);
    if (action === "loadout") {
        return modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Loadout name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(24)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("weapon").setLabel("Weapon ID (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("armor").setLabel("Armor ID (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("ammo").setLabel("Ammo ID (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80))
        );
    }
    const label = action === "craft" ? "Recipe output ID" : "Item ID";
    return modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("item").setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
    ));
}

export function buildPmcIdentityModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId("pmc_identity_modal")
        .setTitle("PMC Identity")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("callsign").setLabel("Callsign").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(24).setPlaceholder("Your field callsign")),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("banner").setLabel("Banner name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(24).setPlaceholder("standard, veteran, apex"))
        );
}
