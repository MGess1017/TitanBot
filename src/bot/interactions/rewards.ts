// Interaction handlers: XP crate claims and autocomplete.
import { MessageFlags, type Interaction } from "discord.js";
import { ensureUser, savePoints, withDeferredPointsSave } from "../../utils";
import { buildXpCrateRewardEmbed, xpCrateAttachment, XP_CRATE_BUTTON_ID } from "../../features/xpCratePanel";
import { claimXpCrate } from "../../game/xpCrates";
import { awardEngagementXp } from "../xp/engagement";
import { getXpPanelChannelId, isFeatureEnabled } from "../core/settings";
import { toSafeString } from "../core/ops";
import { getCommandKey } from "../commands/keys";
import { appendAuditEvent } from "../core/audit";
import {
    getCatalogItemAutocompleteOptions, getOpenCrateAutocompleteOptions, getRaidGearAutocompleteOptions,
    getSellItemAutocompleteOptions, getShopItemAutocompleteOptions, getTradeOfferAutocompleteOptions,
    getTradeOfferItemAutocompleteOptions, getTradeRequestItemAutocompleteOptions, getUseItemAutocompleteOptions
} from "../ui/autocomplete";

/** XP crate claims and slash-command autocomplete. */
export async function handleRewardAndAutocompleteInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isButton() && interaction.customId === XP_CRATE_BUTTON_ID) {
        if (!interaction.guild || interaction.channelId !== getXpPanelChannelId() || interaction.user.bot) {
            await interaction.reply({ content: "Use the FN Xp Panel in its designated server channel.", flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!isFeatureEnabled("xpCrates")) {
            await interaction.reply({ content: "XP crates are paused by staff right now.", flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const result = withDeferredPointsSave(() => {
                const user = ensureUser(interaction.user.id);
                const claim = claimXpCrate(user);
                if (!claim.ok) return claim;
                awardEngagementXp(interaction.guild, interaction.user.id, claim.reward.xp);
                savePoints();
                return claim;
            });
            if (!result.ok) {
                await interaction.editReply({ content: "Daily limit exceeded" });
                return true;
            }
            appendAuditEvent("daily_xp_crate_claimed", { userId: interaction.user.id, guildId: interaction.guildId, ...result.reward });
            await interaction.editReply({
                embeds: [buildXpCrateRewardEmbed(result.reward)],
                files: [xpCrateAttachment(result.reward.crateId)],
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            console.error("[xpCrateClaim]", error);
            appendAuditEvent("xp_crate_claim_failed", { userId: interaction.user.id, reason: toSafeString(error) });
            await interaction.editReply({ content: "Could not complete the crate response. Check /xp for any saved reward before retrying." });
        }
        return true;
    }
    if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused(true);
        const commandKey = getCommandKey(interaction);

        let options: Array<{ name: string; value: string }> = [];
        if (["raid", "raidintel"].includes(commandKey) && (focused.name === "weapon" || focused.name === "armor")) {
            const kind = focused.name === "weapon" ? "weapon" : "armor";
            options = getRaidGearAutocompleteOptions(interaction.user.id, kind, String(focused.value || ""));
        } else if (commandKey === "buy" && focused.name === "item") {
            options = getShopItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (commandKey === "tradeoffer" && focused.name === "offer_item") {
            options = getTradeOfferItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (commandKey === "tradeoffer" && focused.name === "request_item") {
            options = getTradeRequestItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (commandKey === "tradeaccept" && focused.name === "offer_id") {
            options = getTradeOfferAutocompleteOptions(interaction.user.id, String(focused.value || ""), "incoming");
        } else if (commandKey === "tradedecline" && focused.name === "offer_id") {
            options = getTradeOfferAutocompleteOptions(interaction.user.id, String(focused.value || ""), "all");
        } else if (commandKey === "opencrate" && focused.name === "crate") {
            options = getOpenCrateAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (commandKey === "useitem" && focused.name === "item") {
            options = getUseItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (commandKey === "sell" && focused.name === "item") {
            options = getSellItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else if (commandKey === "itemgiveaway" && focused.name === "item") {
            options = getCatalogItemAutocompleteOptions(interaction.user.id, String(focused.value || ""));
        } else {
            return true;
        }

        await interaction.respond(options).catch(() => undefined);
        return true;
    }
    return false;
}
