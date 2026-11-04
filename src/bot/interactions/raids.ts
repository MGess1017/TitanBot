// Interaction handlers: raid encounters, raid results, PMC profile and prestige.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type Interaction } from "discord.js";
import {
    ensureUser, getPmcLevel, getPmcPrestigeTier, FOLLOWER_SUPPORT_ROLES, type FollowerSupportRole,
    getBossProgressEntry, PMC_PRESTIGE_CAP, PMC_PRESTIGE_LEVEL_REQUIREMENT, getTokens, performPmcPrestige,
    savePoints
} from "../../utils";
import { ITEM_DEFS, SHOP_ITEMS } from "../../game/catalog";
import { getBossPortraitFiles } from "../../game/bossPortraits";
import {
    buildBossIntelPayload, buildInventoryPayload, buildShopPayload, RAID_ENCOUNTER_IDS, RAID_RESULT_ACTION_IDS
} from "../../game/payloads";
import * as RaidDomain from "../../raid/domain";
import { appendAuditEvent } from "../core/audit";
import { buildPmcIdentityModal } from "../ui/modals";
import { PMC_PRESTIGE_IDS, PMC_PROFILE_IDS, PMC_PROFILE_VIEWS, type PmcProfileView } from "../ui/ids";
import { activeRaidDecisions, activeRaidEncounters } from "../raid/raids";
import { embedFromPayload } from "../ui/embeds";
import {
    buildBossRosterPayload, buildMapMasteryPayload, buildPmcProfilePayload, buildRaidHistoryPayload
} from "../raid/views";

/** Raid encounter, raid result, and PMC profile/prestige controls. */
export async function handleRaidInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isButton() && Object.values(RAID_ENCOUNTER_IDS).includes(interaction.customId as typeof RAID_ENCOUNTER_IDS.attack)) {
        const decision = activeRaidDecisions.get(interaction.message.id);
        const error = !decision || !decision.ids.has(interaction.customId)
            ? "This raid decision has ended."
            : decision.userId !== interaction.user.id
                ? "Only the deployed PMC can choose this raid action."
                : null;
        if (error) await interaction.reply({ content: error, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === RAID_RESULT_ACTION_IDS.bossIntel) {
        const bossName = interaction.values[0];
        if (!RaidDomain.RAID_BOSS_ROSTER.some(boss => boss.name === bossName)) {
            await interaction.reply({ content: "This boss is no longer available.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const payload = JSON.parse(buildBossIntelPayload({ bossName, progress: getBossProgressEntry(interaction.user.id, bossName) }));
        await interaction.reply({
            embeds: [embedFromPayload("bosses", payload.embed, interaction.user)],
            files: getBossPortraitFiles(bossName),
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.isButton() && interaction.customId === RAID_RESULT_ACTION_IDS.supplies) {
        const state = ensureUser(interaction.user.id);
        const payload = JSON.parse(buildShopPayload({ shopItemIds: SHOP_ITEMS.filter(id => ITEM_DEFS[id]?.kind === "consumable"), inventory: state.inventory, wallet: getTokens(interaction.user.id) }));
        await interaction.reply({ embeds: [embedFromPayload("shop", payload.embed, interaction.user)], components: payload.components || [], flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === RAID_RESULT_ACTION_IDS.inventory) {
        const state = ensureUser(interaction.user.id);
        const payload = JSON.parse(buildInventoryPayload({ inventory: state.inventory, wallet: getTokens(interaction.user.id), gearDurability: state.gearDurability, insuredGear: state.insuredGear }));
        await interaction.reply({
            embeds: [embedFromPayload("inventory", payload.embed, interaction.user)],
            components: payload.components || [],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith(`${PMC_PROFILE_IDS.view}:`) || interaction.customId.startsWith(`${PMC_PROFILE_IDS.followerRole}:`))) {
        const ownerId = interaction.customId.split(":")[1];
        if (ownerId !== interaction.user.id) {
            await interaction.reply({ content: "This is another PMC's profile. Open /pmc for your own controls.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        let view: PmcProfileView = "overview";
        const value = interaction.values[0];
        if (interaction.customId.startsWith(`${PMC_PROFILE_IDS.followerRole}:`)) {
            const follower = ensureUser(ownerId).followers?.sir_gru;
            if (!follower || activeRaidEncounters.has(ownerId) || !Object.prototype.hasOwnProperty.call(FOLLOWER_SUPPORT_ROLES, value)) {
                await interaction.reply({ content: "Support roles require an unlocked follower and no active raid.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
                return true;
            }
            follower.supportRole = value as FollowerSupportRole;
            savePoints();
            view = "follower";
        } else if (Object.prototype.hasOwnProperty.call(PMC_PROFILE_VIEWS, value)) view = value as PmcProfileView;
        const payload = JSON.parse(buildPmcProfilePayload(interaction.user, view));
        await interaction.update({ embeds: [embedFromPayload("pmc", payload.embed, interaction.user)], components: payload.components }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === PMC_PRESTIGE_IDS.request) {
        if (activeRaidEncounters.has(interaction.user.id)) {
            await interaction.reply({ content: "Finish your active raid before prestiging.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const state = ensureUser(interaction.user.id);
        const level = getPmcLevel(state.pmcXP);
        if (state.pmcPrestige >= PMC_PRESTIGE_CAP || level < PMC_PRESTIGE_LEVEL_REQUIREMENT) {
            await interaction.reply({ content: state.pmcPrestige >= PMC_PRESTIGE_CAP ? "Maximum PMC Prestige X has already been achieved." : `PMC Level ${PMC_PRESTIGE_LEVEL_REQUIREMENT.toLocaleString()} is required to prestige.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const nextTier = getPmcPrestigeTier(state.pmcPrestige + 1);
        const confirmEmbed = new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle(`${nextTier.badge} Confirm PMC Prestige ${nextTier.numeral}`)
            .setDescription("This is a permanent progression choice. Review the reset boundary before confirming.")
            .addFields(
                { name: "Will Reset", value: `PMC Level ${level.toLocaleString()} → 0\nRaid XP ${state.pmcXP.toLocaleString()} → 0`, inline: true },
                { name: "Will Remain", value: "Inventory and currency\nMap reputation and raid records\nBoss hearts, kills, and achievements\nFollower XP, abilities and support role", inline: true },
                { name: "Permanent Rank", value: `Prestige ${nextTier.numeral} • ${nextTier.label}\nHigher raid XP, success, token, and defense bonuses`, inline: false }
            );
        const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${PMC_PRESTIGE_IDS.confirm}:${state.pmcPrestige}`).setLabel(`Confirm Prestige ${nextTier.numeral}`).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(PMC_PRESTIGE_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === PMC_PRESTIGE_IDS.identity) {
        await interaction.showModal(buildPmcIdentityModal()).catch(() => undefined);
        return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === "pmc_identity_modal") {
        const user = ensureUser(interaction.user.id);
        user.pmcCallsign = (interaction.fields.getTextInputValue("callsign") || "Rookie").replace(/[^a-z0-9 _-]/gi, "").trim().slice(0, 24) || "Rookie";
        user.pmcBanner = (interaction.fields.getTextInputValue("banner") || "standard").replace(/[^a-z0-9 _-]/gi, "").trim().toLowerCase().slice(0, 24) || "standard";
        savePoints();
        await interaction.reply({ content: `PMC identity updated: ${user.pmcCallsign} • ${user.pmcBanner}.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && (interaction.customId === PMC_PRESTIGE_IDS.confirm || interaction.customId.startsWith(`${PMC_PRESTIGE_IDS.confirm}:`))) {
        const rankText = interaction.customId.split(":")[1];
        if (activeRaidEncounters.has(interaction.user.id) || !rankText || !/^\d+$/.test(rankText)) {
            await interaction.update({ content: activeRaidEncounters.has(interaction.user.id) ? "Finish your active raid before prestiging." : "This confirmation has expired. Open /pmc for a fresh preview.", embeds: [], components: [] }).catch(() => undefined);
            return true;
        }
        const result = performPmcPrestige(interaction.user.id, Number(rankText));
        if (result.error) {
            await interaction.update({ content: result.error, embeds: [], components: [] }).catch(() => undefined);
            return true;
        }
        appendAuditEvent("pmc_prestige", { userId: interaction.user.id, prestige: result.prestige, label: result.tier?.label || null });
        const payload = JSON.parse(buildPmcProfilePayload(interaction.user));
        await interaction.update({ embeds: [embedFromPayload("pmc", payload.embed, interaction.user)], components: payload.components || [] }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === PMC_PRESTIGE_IDS.cancel) {
        await interaction.update({ content: "PMC prestige cancelled. No progression was changed.", embeds: [], components: [] }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === RAID_RESULT_ACTION_IDS.history) {
        const payload = JSON.parse(buildRaidHistoryPayload(interaction.user.id));
        await interaction.reply({
            embeds: [embedFromPayload("raidhistory", payload.embed, interaction.user)],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }

    if (interaction.isButton() && interaction.customId === RAID_RESULT_ACTION_IDS.bosses) {
        const payload = JSON.parse(buildBossRosterPayload());
        try {
            await interaction.reply({
                embeds: [embedFromPayload("bosses", payload.embed, interaction.user)],
                components: payload.components || [],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error("Boss roster rich response failed:", error);
            const fallback = RaidDomain.RAID_BOSS_ROSTER
                .map(boss => `${boss.name} • ${boss.homeMapLabel} • Ferocity ${boss.ferocity.toFixed(2)}`)
                .join("\n");
            await interaction.reply({
                content: `Raid Boss Roster\n${fallback}`.slice(0, 2000),
                flags: MessageFlags.Ephemeral
            }).catch(() => undefined);
        }
        return true;
    }

    if (interaction.isButton() && (interaction.customId === RAID_RESULT_ACTION_IDS.mastery || interaction.customId.startsWith(`${RAID_RESULT_ACTION_IDS.mastery}:`))) {
        const selectedMapKey = interaction.customId.slice(RAID_RESULT_ACTION_IDS.mastery.length + 1);
        const mapKey = Object.prototype.hasOwnProperty.call(RaidDomain.RAID_MAPS, selectedMapKey) ? selectedMapKey : ensureUser(interaction.user.id).raidHistory[0]?.mapKey;
        const payload = JSON.parse(buildMapMasteryPayload(interaction.user.id, mapKey));
        await interaction.reply({
            embeds: [embedFromPayload("raidintel", payload.embed, interaction.user)],
            flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }
    return false;
}
