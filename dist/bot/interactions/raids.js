"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRaidInteraction = handleRaidInteraction;
// Interaction handlers: raid encounters, raid results, PMC profile and prestige.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const catalog_1 = require("../../game/catalog");
const bossPortraits_1 = require("../../game/bossPortraits");
const payloads_1 = require("../../game/payloads");
const RaidDomain = __importStar(require("../../raid/domain"));
const audit_1 = require("../core/audit");
const modals_1 = require("../ui/modals");
const ids_1 = require("../ui/ids");
const raids_1 = require("../raid/raids");
const embeds_1 = require("../ui/embeds");
const cards_1 = require("../profile/cards");
const hubPreferences_1 = require("../../game/hubPreferences");
const views_1 = require("../raid/views");
/** Raid encounter, raid result, and PMC profile/prestige controls. */
async function handleRaidInteraction(interaction) {
    if (interaction.isButton() && Object.values(payloads_1.RAID_ENCOUNTER_IDS).includes(interaction.customId)) {
        const decision = raids_1.activeRaidDecisions.get(interaction.message.id);
        const error = !decision || !decision.ids.has(interaction.customId)
            ? "This raid decision has ended."
            : decision.userId !== interaction.user.id
                ? "Only the deployed PMC can choose this raid action."
                : null;
        if (error)
            await interaction.reply({ content: error, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === payloads_1.RAID_RESULT_ACTION_IDS.bossIntel) {
        const bossName = interaction.values[0];
        if (!RaidDomain.RAID_BOSS_ROSTER.some(boss => boss.name === bossName)) {
            await interaction.reply({ content: "This boss is no longer available.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const payload = JSON.parse((0, payloads_1.buildBossIntelPayload)({ bossName, progress: (0, utils_1.getBossProgressEntry)(interaction.user.id, bossName) }));
        await interaction.reply({
            embeds: [(0, embeds_1.embedFromPayload)("bosses", payload.embed, interaction.user)],
            files: (0, bossPortraits_1.getBossPortraitFiles)(bossName),
            flags: discord_js_1.MessageFlags.Ephemeral
        });
        return true;
    }
    if (interaction.isButton() && interaction.customId === payloads_1.RAID_RESULT_ACTION_IDS.supplies) {
        const state = (0, utils_1.ensureUser)(interaction.user.id);
        const payload = JSON.parse((0, payloads_1.buildShopPayload)({ shopItemIds: catalog_1.SHOP_ITEMS.filter(id => catalog_1.ITEM_DEFS[id]?.kind === "consumable"), inventory: state.inventory, wallet: (0, utils_1.getTokens)(interaction.user.id) }));
        await interaction.reply({ embeds: [(0, embeds_1.embedFromPayload)("shop", payload.embed, interaction.user)], components: payload.components || [], flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === payloads_1.RAID_RESULT_ACTION_IDS.inventory) {
        const state = (0, utils_1.ensureUser)(interaction.user.id);
        const payload = JSON.parse((0, payloads_1.buildInventoryPayload)({ inventory: state.inventory, wallet: (0, utils_1.getTokens)(interaction.user.id), gearDurability: state.gearDurability, insuredGear: state.insuredGear }));
        await interaction.reply({
            embeds: [(0, embeds_1.embedFromPayload)("inventory", payload.embed, interaction.user)],
            components: payload.components || [],
            flags: discord_js_1.MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith(`${ids_1.PMC_PROFILE_IDS.view}:`) || interaction.customId.startsWith(`${ids_1.PMC_PROFILE_IDS.followerRole}:`))) {
        const ownerId = interaction.customId.split(":")[1];
        if (ownerId !== interaction.user.id) {
            await interaction.reply({ content: "This is another PMC's profile. Open /pmc for your own controls.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        let view = "overview";
        const value = interaction.values[0];
        if (interaction.customId.startsWith(`${ids_1.PMC_PROFILE_IDS.followerRole}:`)) {
            const follower = (0, utils_1.ensureUser)(ownerId).followers?.sir_gru;
            if (!follower || raids_1.activeRaidEncounters.has(ownerId) || !Object.prototype.hasOwnProperty.call(utils_1.FOLLOWER_SUPPORT_ROLES, value)) {
                await interaction.reply({ content: "Support roles require an unlocked follower and no active raid.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
                return true;
            }
            follower.supportRole = value;
            (0, utils_1.savePoints)();
            view = "follower";
        }
        else if (Object.prototype.hasOwnProperty.call(ids_1.PMC_PROFILE_VIEWS, value))
            view = value;
        const privateReply = (0, hubPreferences_1.normalizeHubPreferences)((0, utils_1.ensureUser)(ownerId).preferences.hub).cardVisibility === "private"
            && !interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral);
        if (privateReply)
            await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        else
            await interaction.deferUpdate();
        const payload = JSON.parse((0, views_1.buildPmcProfilePayload)(interaction.user, view));
        await interaction.editReply({
            embeds: [payload.embed], components: payload.components,
            attachments: [],
            files: view === "overview" ? [await (0, cards_1.progressionCardAttachment)("pmc", interaction.user, interaction.guild)] : [],
            allowedMentions: { parse: [] }
        });
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.PMC_PRESTIGE_IDS.request) {
        if (raids_1.activeRaidEncounters.has(interaction.user.id)) {
            await interaction.reply({ content: "Finish your active raid before prestiging.", flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const state = (0, utils_1.ensureUser)(interaction.user.id);
        const level = (0, utils_1.getPmcLevel)(state.pmcXP);
        if (state.pmcPrestige >= utils_1.PMC_PRESTIGE_CAP || level < utils_1.PMC_PRESTIGE_LEVEL_REQUIREMENT) {
            await interaction.reply({ content: state.pmcPrestige >= utils_1.PMC_PRESTIGE_CAP ? "Maximum PMC Prestige X has already been achieved." : `PMC Level ${utils_1.PMC_PRESTIGE_LEVEL_REQUIREMENT.toLocaleString()} is required to prestige.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return true;
        }
        const nextTier = (0, utils_1.getPmcPrestigeTier)(state.pmcPrestige + 1);
        const confirmEmbed = new discord_js_1.EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle(`${nextTier.badge} Confirm PMC Prestige ${nextTier.numeral}`)
            .setDescription("This is a permanent progression choice. Review the reset boundary before confirming.")
            .addFields({ name: "Will Reset", value: `PMC Level ${level.toLocaleString()} → 0\nRaid XP ${state.pmcXP.toLocaleString()} → 0`, inline: true }, { name: "Will Remain", value: "Inventory and currency\nMap reputation and raid records\nBoss hearts, kills, and achievements\nFollower XP, abilities and support role", inline: true }, { name: "Permanent Rank", value: `Prestige ${nextTier.numeral} • ${nextTier.label}\nHigher raid XP, success, token, and defense bonuses`, inline: false });
        const confirmRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${ids_1.PMC_PRESTIGE_IDS.confirm}:${state.pmcPrestige}`).setLabel(`Confirm Prestige ${nextTier.numeral}`).setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId(ids_1.PMC_PRESTIGE_IDS.cancel).setLabel("Cancel").setStyle(discord_js_1.ButtonStyle.Secondary));
        await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.PMC_PRESTIGE_IDS.identity) {
        await interaction.showModal((0, modals_1.buildPmcIdentityModal)()).catch(() => undefined);
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId === "pmc_identity_modal") {
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        user.pmcCallsign = (interaction.fields.getTextInputValue("callsign") || "Rookie").replace(/[^a-z0-9 _-]/gi, "").trim().slice(0, 24) || "Rookie";
        user.pmcBanner = (interaction.fields.getTextInputValue("banner") || "standard").replace(/[^a-z0-9 _-]/gi, "").trim().toLowerCase().slice(0, 24) || "standard";
        (0, utils_1.savePoints)();
        await interaction.reply({ content: `PMC identity updated: ${user.pmcCallsign} • ${user.pmcBanner}.`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && (interaction.customId === ids_1.PMC_PRESTIGE_IDS.confirm || interaction.customId.startsWith(`${ids_1.PMC_PRESTIGE_IDS.confirm}:`))) {
        const rankText = interaction.customId.split(":")[1];
        if (raids_1.activeRaidEncounters.has(interaction.user.id) || !rankText || !/^\d+$/.test(rankText)) {
            await interaction.update({ content: raids_1.activeRaidEncounters.has(interaction.user.id) ? "Finish your active raid before prestiging." : "This confirmation has expired. Open /pmc for a fresh preview.", embeds: [], components: [] }).catch(() => undefined);
            return true;
        }
        const result = (0, utils_1.performPmcPrestige)(interaction.user.id, Number(rankText));
        if (result.error) {
            await interaction.update({ content: result.error, embeds: [], components: [] }).catch(() => undefined);
            return true;
        }
        (0, audit_1.appendAuditEvent)("pmc_prestige", { userId: interaction.user.id, prestige: result.prestige, label: result.tier?.label || null });
        await interaction.deferUpdate();
        const payload = JSON.parse((0, views_1.buildPmcProfilePayload)(interaction.user));
        await interaction.editReply({
            content: "", embeds: [payload.embed], components: payload.components || [], attachments: [],
            files: [await (0, cards_1.progressionCardAttachment)("pmc", interaction.user, interaction.guild)],
            allowedMentions: { parse: [] }
        });
        return true;
    }
    if (interaction.isButton() && interaction.customId === ids_1.PMC_PRESTIGE_IDS.cancel) {
        await interaction.update({ content: "PMC prestige cancelled. No progression was changed.", embeds: [], components: [] }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === payloads_1.RAID_RESULT_ACTION_IDS.history) {
        const payload = JSON.parse((0, views_1.buildRaidHistoryPayload)(interaction.user.id));
        await interaction.reply({
            embeds: [(0, embeds_1.embedFromPayload)("raidhistory", payload.embed, interaction.user)],
            flags: discord_js_1.MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }
    if (interaction.isButton() && interaction.customId === payloads_1.RAID_RESULT_ACTION_IDS.bosses) {
        const payload = JSON.parse((0, views_1.buildBossRosterPayload)());
        try {
            await interaction.reply({
                embeds: [(0, embeds_1.embedFromPayload)("bosses", payload.embed, interaction.user)],
                components: payload.components || [],
                flags: discord_js_1.MessageFlags.Ephemeral
            });
        }
        catch (error) {
            console.error("Boss roster rich response failed:", error);
            const fallback = RaidDomain.RAID_BOSS_ROSTER
                .map(boss => `${boss.name} • ${boss.homeMapLabel} • Ferocity ${boss.ferocity.toFixed(2)}`)
                .join("\n");
            await interaction.reply({
                content: `Raid Boss Roster\n${fallback}`.slice(0, 2000),
                flags: discord_js_1.MessageFlags.Ephemeral
            }).catch(() => undefined);
        }
        return true;
    }
    if (interaction.isButton() && (interaction.customId === payloads_1.RAID_RESULT_ACTION_IDS.mastery || interaction.customId.startsWith(`${payloads_1.RAID_RESULT_ACTION_IDS.mastery}:`))) {
        const selectedMapKey = interaction.customId.slice(payloads_1.RAID_RESULT_ACTION_IDS.mastery.length + 1);
        const mapKey = Object.prototype.hasOwnProperty.call(RaidDomain.RAID_MAPS, selectedMapKey) ? selectedMapKey : (0, utils_1.ensureUser)(interaction.user.id).raidHistory[0]?.mapKey;
        const payload = JSON.parse((0, views_1.buildMapMasteryPayload)(interaction.user.id, mapKey));
        await interaction.reply({
            embeds: [(0, embeds_1.embedFromPayload)("raidintel", payload.embed, interaction.user)],
            flags: discord_js_1.MessageFlags.Ephemeral
        }).catch(() => undefined);
        return true;
    }
    return false;
}
