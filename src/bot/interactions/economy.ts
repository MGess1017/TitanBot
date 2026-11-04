// Interaction handlers: casino quick actions and the sell menu.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type Interaction } from "discord.js";
import { claimCasinoDaily, getInventoryCount } from "../../utils";
import { ITEM_DEFS } from "../../game/catalog";
import { rejectIfRateLimitedForCasinoAction } from "../core/ops";
import { CASINO_UI_IDS, SELL_UI_IDS } from "../ui/ids";
import { embedFromPayload, embedFromText } from "../ui/embeds";
import { sellItem } from "../economy/items";
import { parseCasinoActionCustomId } from "../casino/ui";
import { runCasinoQuickAction } from "../casino/quickGames";

/** Casino quick actions and the sell menu. */
export async function handleEconomyInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isButton() && interaction.customId.startsWith(`${CASINO_UI_IDS.prefix}:`)) {
        const parsedAction = parseCasinoActionCustomId(interaction.customId);
        if (!parsedAction) {
            await interaction.reply({ content: "This casino action is invalid or expired.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        if (parsedAction.ownerId !== interaction.user.id) {
            await interaction.reply({ content: "These controls belong to another player. Run your own casino command to get personal quick actions.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const throttleError = rejectIfRateLimitedForCasinoAction(interaction.guildId, interaction.user.id, parsedAction.gameKey);
        if (throttleError) {
            await interaction.reply({ content: "Action cooldown active. Wait a moment before triggering another casino quick action.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }

        const actionResult = await runCasinoQuickAction({
            userId: interaction.user.id,
            action: parsedAction.action,
            gameKey: parsedAction.gameKey,
            bet: parsedAction.bet,
            arg: parsedAction.arg
        });

        try {
            const parsedPayload = JSON.parse(actionResult.payload);
            if (parsedPayload && parsedPayload.embed) {
                const embed = embedFromPayload(actionResult.gameKey, parsedPayload.embed, interaction.user);
                await interaction.reply({ embeds: [embedFromText(actionResult.gameKey, "🎲 Resolving table outcome...", interaction.user)], flags: MessageFlags.Ephemeral }).catch(() => undefined);
                await new Promise(resolve => setTimeout(resolve, 450));
                await interaction.editReply({ embeds: [embed], components: Array.isArray(parsedPayload.components) ? parsedPayload.components : [] }).catch(() => undefined);
                return true;
            }
        } catch {
            // Fall through to text rendering.
        }

        await interaction.reply({
            embeds: [embedFromText(actionResult.gameKey, actionResult.payload, interaction.user)],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${CASINO_UI_IDS.dailyPrefix}:`)) {
        const ownerId = interaction.customId.split(":")[1]?.replace(/\D/g, "");
        if (ownerId !== interaction.user.id) {
            await interaction.reply({ content: "This daily reward belongs to another player.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const result = claimCasinoDaily(interaction.user.id);
        await interaction.reply({ content: result.error || `Daily reward claimed: ${result.reward} FN Token$. Casino streak: ${result.streak}.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === SELL_UI_IDS.menu) {
        const itemId = interaction.values[0] || "";
        const item = ITEM_DEFS[itemId];
        const owned = getInventoryCount(interaction.user.id, itemId);
        if (!item || owned < 1) {
            await interaction.update({
                embeds: [embedFromText("sell", "That item is no longer available to sell. Run /sell again.", interaction.user)],
                components: []
            }).catch(() => undefined);
            return true;
        }

        const unitPayout = Math.max(1, Math.floor(item.price * 0.6));
        const qtyChoices = [1, 5, 10].filter(q => q <= owned);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...qtyChoices.map(q =>
                new ButtonBuilder()
                    .setCustomId(`${SELL_UI_IDS.qtyPrefix}:${itemId}:${q}`)
                    .setLabel(`Sell ${q}`)
                    .setStyle(ButtonStyle.Secondary)
            ),
            new ButtonBuilder()
                .setCustomId(`${SELL_UI_IDS.qtyPrefix}:${itemId}:all`)
                .setLabel("Sell All")
                .setStyle(ButtonStyle.Danger)
        );

        const embed = new EmbedBuilder()
            .setColor(0x0e7490)
            .setTitle("🧾 Confirm Item Sale")
            .setDescription("Choose how many units to sell.")
            .addFields(
                { name: "Item", value: `${item.name} (${item.id})`, inline: false },
                { name: "Rarity", value: String(item.rarity || "common"), inline: true },
                { name: "Owned", value: `${owned}`, inline: true },
                { name: "Per Unit", value: `${unitPayout} FN Token$`, inline: true },
                { name: "Max Payout", value: `${unitPayout * owned} FN Token$`, inline: false }
            );

        await interaction.update({ embeds: [embed], components: [row] }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${SELL_UI_IDS.qtyPrefix}:`)) {
        const parts = interaction.customId.split(":");
        const itemId = parts[1] || "";
        const qtyRaw = parts[2] || "1";
        const item = ITEM_DEFS[itemId];
        const owned = getInventoryCount(interaction.user.id, itemId);

        if (!item || owned < 1) {
            await interaction.update({
                embeds: [embedFromText("sell", "That item is no longer available to sell. Run /sell again.", interaction.user)],
                components: []
            }).catch(() => undefined);
            return true;
        }

        const qty = qtyRaw === "all" ? owned : Math.max(1, Math.min(owned, Number.parseInt(qtyRaw, 10) || 1));
        const result = sellItem(interaction.user.id, itemId, qty);
        if (result.error) {
            await interaction.update({ embeds: [embedFromText("sell", result.error, interaction.user)], components: [] }).catch(() => undefined);
            return true;
        }

        const embed = new EmbedBuilder()
            .setColor(0x16a34a)
            .setTitle("💸 Sale Completed")
            .setDescription(`Sold ${qty}x ${item.name} for ${result.payout} FN Token$.`)
            .addFields(
                { name: "Remaining", value: `${result.remaining}`, inline: true },
                { name: "Unit Value", value: `${Math.max(1, Math.floor(item.price * 0.6))} FN Token$`, inline: true },
                { name: "Tip", value: "Run /sell again to open the picker for another item.", inline: false }
            );

        await interaction.update({ embeds: [embed], components: [] }).catch(() => undefined);
        return true;
    }
    return false;
}
