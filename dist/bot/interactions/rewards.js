"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRewardAndAutocompleteInteraction = handleRewardAndAutocompleteInteraction;
// Interaction handlers: XP crate claims and autocomplete.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const xpCratePanel_1 = require("../../features/xpCratePanel");
const xpCrates_1 = require("../../game/xpCrates");
const engagement_1 = require("../xp/engagement");
const settings_1 = require("../core/settings");
const ops_1 = require("../core/ops");
const keys_1 = require("../commands/keys");
const audit_1 = require("../core/audit");
const autocomplete_1 = require("../ui/autocomplete");
/** XP crate claims and slash-command autocomplete. */
async function handleRewardAndAutocompleteInteraction(interaction) {
    if (interaction.isButton() && interaction.customId === xpCratePanel_1.XP_CRATE_BUTTON_ID) {
        if (!interaction.guild || interaction.channelId !== (0, settings_1.getXpPanelChannelId)() || interaction.user.bot) {
            await interaction.reply({ content: "Use the FN Xp Panel in its designated server channel.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        if (!(0, settings_1.isFeatureEnabled)("xpCrates")) {
            await interaction.reply({ content: "XP crates are paused by staff right now.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        try {
            const result = (0, utils_1.withDeferredPointsSave)(() => {
                const user = (0, utils_1.ensureUser)(interaction.user.id);
                const claim = (0, xpCrates_1.claimXpCrate)(user);
                if (!claim.ok)
                    return claim;
                (0, engagement_1.awardEngagementXp)(interaction.guild, interaction.user.id, claim.reward.xp);
                (0, utils_1.savePoints)();
                return claim;
            });
            if (!result.ok) {
                await interaction.editReply({ content: "Daily limit exceeded" });
                return true;
            }
            (0, audit_1.appendAuditEvent)("daily_xp_crate_claimed", { userId: interaction.user.id, guildId: interaction.guildId, ...result.reward });
            await interaction.editReply({
                embeds: [(0, xpCratePanel_1.buildXpCrateRewardEmbed)(result.reward)],
                files: [(0, xpCratePanel_1.xpCrateAttachment)(result.reward.crateId)],
                allowedMentions: { parse: [] }
            });
        }
        catch (error) {
            console.error("[xpCrateClaim]", error);
            (0, audit_1.appendAuditEvent)("xp_crate_claim_failed", { userId: interaction.user.id, reason: (0, ops_1.toSafeString)(error) });
            await interaction.editReply({ content: "Could not complete the crate response. Check /xp for any saved reward before retrying." });
        }
        return true;
    }
    if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused(true);
        const commandKey = (0, keys_1.getCommandKey)(interaction);
        let options = [];
        if (["raid", "raidintel"].includes(commandKey) && (focused.name === "weapon" || focused.name === "armor")) {
            const kind = focused.name === "weapon" ? "weapon" : "armor";
            options = (0, autocomplete_1.getRaidGearAutocompleteOptions)(interaction.user.id, kind, String(focused.value || ""));
        }
        else if (commandKey === "buy" && focused.name === "item") {
            options = (0, autocomplete_1.getShopItemAutocompleteOptions)(interaction.user.id, String(focused.value || ""));
        }
        else if (commandKey === "tradeoffer" && focused.name === "offer_item") {
            options = (0, autocomplete_1.getTradeOfferItemAutocompleteOptions)(interaction.user.id, String(focused.value || ""));
        }
        else if (commandKey === "tradeoffer" && focused.name === "request_item") {
            options = (0, autocomplete_1.getTradeRequestItemAutocompleteOptions)(interaction.user.id, String(focused.value || ""));
        }
        else if (commandKey === "tradeaccept" && focused.name === "offer_id") {
            options = (0, autocomplete_1.getTradeOfferAutocompleteOptions)(interaction.user.id, String(focused.value || ""), "incoming");
        }
        else if (commandKey === "tradedecline" && focused.name === "offer_id") {
            options = (0, autocomplete_1.getTradeOfferAutocompleteOptions)(interaction.user.id, String(focused.value || ""), "all");
        }
        else if (commandKey === "opencrate" && focused.name === "crate") {
            options = (0, autocomplete_1.getOpenCrateAutocompleteOptions)(interaction.user.id, String(focused.value || ""));
        }
        else if (commandKey === "useitem" && focused.name === "item") {
            options = (0, autocomplete_1.getUseItemAutocompleteOptions)(interaction.user.id, String(focused.value || ""));
        }
        else if (commandKey === "sell" && focused.name === "item") {
            options = (0, autocomplete_1.getSellItemAutocompleteOptions)(interaction.user.id, String(focused.value || ""));
        }
        else if (commandKey === "itemgiveaway" && focused.name === "item") {
            options = (0, autocomplete_1.getCatalogItemAutocompleteOptions)(interaction.user.id, String(focused.value || ""));
        }
        else {
            return true;
        }
        await interaction.respond(options).catch(() => undefined);
        return true;
    }
    return false;
}
