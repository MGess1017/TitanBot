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
exports.buildRaidHistoryPayload = buildRaidHistoryPayload;
exports.formatMapReputationBar = formatMapReputationBar;
exports.buildMapMasteryPayload = buildMapMasteryPayload;
exports.buildBossRosterPayload = buildBossRosterPayload;
exports.buildLeaderboardPayload = buildLeaderboardPayload;
exports.buildPmcProfilePayload = buildPmcProfilePayload;
exports.buildConditionsPayload = buildConditionsPayload;
exports.buildGearIntelPayload = buildGearIntelPayload;
// Raid history, mastery, boss roster, leaderboards, PMC profile, and intel views.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const economy_1 = require("../../game/economy");
const catalog_1 = require("../../game/catalog");
const bossHearts_1 = require("../../game/bossHearts");
const payloads_1 = require("../../game/payloads");
const RaidDomain = __importStar(require("../../raid/domain"));
const visuals_1 = require("../pmc/visuals");
const ids_1 = require("../ui/ids");
const raids_1 = require("./raids");
const autocomplete_1 = require("../ui/autocomplete");
const inquiryPanel_1 = require("../../features/inquiryPanel");
function buildRaidHistoryPayload(userId) {
    const state = (0, utils_1.ensureUser)(userId);
    const history = state.raidHistory.slice(0, 8);
    if (!history.length) {
        return JSON.stringify({
            embed: new discord_js_1.EmbedBuilder()
                .setColor(0x334155)
                .setTitle("📜 Raid History")
                .setDescription("No raids logged yet. Deploy with `/raid` to start building your combat record.")
                .toJSON()
        });
    }
    const wins = history.filter(entry => entry.success).length;
    const net = history.reduce((sum, entry) => sum + entry.net, 0);
    const totalBossSpawns = history.filter(entry => entry.bossSpawned).length;
    const totalBossKills = history.filter(entry => entry.bossDefeated).length;
    const reputationLeaders = Object.values(RaidDomain.RAID_MAPS)
        .map(map => ({ map, entry: (0, utils_1.getMapReputationEntry)(userId, map.key) }))
        .sort((a, b) => b.entry.points - a.entry.points)
        .slice(0, 3)
        .map(({ map, entry }) => {
        const progress = RaidDomain.getMapReputationProgress(entry.points);
        return `${RaidDomain.RAID_MAP_SHORT_LABELS[map.key]} • ${progress.tier.label} • ${entry.points} REP`;
    });
    const recentLines = history.map(entry => {
        const status = entry.success ? "✅" : "❌";
        const boss = entry.bossSpawned
            ? `${entry.bossName || "Unknown"}${entry.bossDefeated ? " • defeated" : " • escaped"}`
            : "No boss";
        return `${status} ${entry.map || "Unknown Map"} • ${entry.approach || "Balanced"} • ${entry.tension} • Net ${entry.net >= 0 ? `+${entry.net}` : entry.net} • XP +${entry.rxpGain}\n${boss}`;
    });
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle("📜 Raid History Console")
        .setDescription("Recent mission log with extraction outcomes, boss encounters, and short-form economy performance.")
        .addFields({
        name: "Recent Combat Snapshot",
        value: [
            `Entries Loaded: ${history.length}`,
            `Recent Wins: ${wins}/${history.length}`,
            `Recent Net: ${net >= 0 ? `+${net}` : net} FN Token$`,
            `Boss Contacts: ${totalBossSpawns} | Boss Kills: ${totalBossKills}`
        ].join("\n"),
        inline: false
    }, {
        name: "Territory Network",
        value: reputationLeaders.join("\n") || "No map reputation established.",
        inline: false
    }, ...chunkDetailLines(recentLines, 2).slice(0, 4).map((chunk, index) => ({
        name: index === 0 ? "Mission Log" : `Mission Log ${index + 1}`,
        value: chunk,
        inline: false
    })));
    return JSON.stringify({ embed: embed.toJSON() });
}
function formatMapReputationBar(progressPct) {
    const width = 12;
    const filled = Math.max(0, Math.min(width, Math.round((progressPct / 100) * width)));
    return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${progressPct}%`;
}
function buildMapMasteryPayload(userId, focusMapKey) {
    const maps = Object.values(RaidDomain.RAID_MAPS)
        .map(map => {
        const entry = (0, utils_1.getMapReputationEntry)(userId, map.key);
        return { map, entry, progress: RaidDomain.getMapReputationProgress(entry.points) };
    })
        .sort((a, b) => (a.map.key === focusMapKey ? -1 : b.map.key === focusMapKey ? 1 : b.entry.points - a.entry.points));
    const totalReputation = maps.reduce((sum, item) => sum + item.entry.points, 0);
    const masteredMaps = maps.filter(item => !item.progress.nextTier).length;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xeab308)
        .setTitle("🗺️ Territory Network • Map Mastery")
        .setDescription("Persistent local reputation earned through deployments, extractions, high-tension operations, and boss victories.")
        .addFields({
        name: "Network Status",
        value: [
            `Network REP: ${totalReputation.toLocaleString()}`,
            `Mastered Territories: ${masteredMaps}/${maps.length}`,
            `Highest Rank: ${maps[0]?.progress.tier.label || "Unproven"}`
        ].join("\n"),
        inline: false
    });
    for (const { map, entry, progress } of maps) {
        embed.addFields({
            name: `${map.key === focusMapKey ? "◆ " : ""}${map.label} • ${progress.tier.label}`,
            value: [
                `${formatMapReputationBar(progress.progressPct)}`,
                progress.nextTier ? `${entry.points}/${progress.nextTier.threshold} REP • ${progress.pointsToNext} to ${progress.nextTier.label}` : `${entry.points} REP • Maximum rank achieved`,
                `Deployments ${entry.raids} • Extracts ${entry.extracts} • Bosses ${entry.bossKills}/${entry.bossEncounters}`,
                `Perks: +${(progress.tier.successBonus * 100).toFixed(1)}% extraction • +${(progress.tier.tokenBonus * 100).toFixed(1)}% tokens • +${(progress.tier.bossKillBonus * 100).toFixed(1)}% boss kill`,
                progress.tier.description
            ].join("\n"),
            inline: false
        });
    }
    return JSON.stringify({ embed: embed.toJSON() });
}
function buildBossRosterPayload() {
    const bossLeaderboard = RaidDomain.RAID_BOSS_ROSTER.map(boss => {
        const progress = Object.values(utils_1.points).map(user => user.bossProgress?.[boss.name]).filter(entry => entry && entry.kills > 0);
        return {
            name: boss.name,
            totalKills: progress.reduce((sum, entry) => sum + (entry?.kills || 0), 0),
            bestStreak: Math.max(0, ...progress.map(entry => entry?.bestStreak || 0))
        };
    }).sort((a, b) => b.totalKills - a.totalKills).slice(0, 5);
    return (0, payloads_1.buildBossRosterPayload)(bossLeaderboard);
}
function buildLeaderboardPayload() {
    const top = (0, economy_1.getLeaderboard)();
    const voiceLeaders = Object.entries(utils_1.points)
        .map(([id, user]) => ({ id, voiceMinutes: user.voiceMinutes || 0 }))
        .filter(row => row.voiceMinutes > 0)
        .sort((a, b) => b.voiceMinutes - a.voiceMinutes)
        .slice(0, 5);
    const achievementLeaders = Object.entries(utils_1.points)
        .map(([id, user]) => ({ id, achievements: user.achievementIds?.length || 0 }))
        .filter(row => row.achievements > 0)
        .sort((a, b) => b.achievements - a.achievements)
        .slice(0, 5);
    if (!top.length) {
        return JSON.stringify({
            embed: new discord_js_1.EmbedBuilder()
                .setColor(0x334155)
                .setTitle("🏆 XP Leaderboard")
                .setDescription("No leaderboard data yet.")
                .toJSON()
        });
    }
    const medals = ["🥇", "🥈", "🥉"];
    const topLines = top.slice(0, 10).map((row, idx) => {
        const medal = medals[idx] || `#${idx + 1}`;
        return `${medal} <@${row.id}>\nXP ${row.xp.toLocaleString()} • Prestige ${row.prestige}`;
    });
    const totalXp = Object.values(utils_1.points).reduce((sum, user) => sum + (user.xp || 0), 0);
    const formatRankings = (rows, suffix) => rows.length
        ? rows.map((row, index) => `${medals[index] || `#${index + 1}`} <@${row.id}> • ${row.value.toLocaleString()} ${suffix}`).join("\n")
        : "No ranking data yet.";
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🏆 XP Command Board")
        .setDescription("Server-wide engagement progression standings with premium podium formatting.")
        .addFields({
        name: "Leaderboard Snapshot",
        value: [
            `Tracked Players: ${top.length}`,
            `Total XP Across Board: ${totalXp.toLocaleString()}`,
            `Tracked Players: ${Object.keys(utils_1.points).length.toLocaleString()}`,
            `Top Rank XP: ${top[0]?.xp?.toLocaleString() || 0}`
        ].join("\n"),
        inline: false
    }, ...chunkDetailLines(topLines, 3).slice(0, 4).map((chunk, index) => ({
        name: index === 0 ? "Podium and Ranks" : `Podium and Ranks ${index + 1}`,
        value: chunk,
        inline: false
    })), {
        name: "Voice Time Leaders",
        value: formatRankings(voiceLeaders.map(row => ({ id: row.id, value: row.voiceMinutes })), "minutes"),
        inline: true
    }, {
        name: "Achievement Leaders",
        value: formatRankings(achievementLeaders.map(row => ({ id: row.id, value: row.achievements })), "unlocks"),
        inline: true
    });
    return JSON.stringify({ embed: embed.toJSON() });
}
function buildPmcProfilePayload(user, view = "overview") {
    const state = (0, utils_1.ensureUser)(user.id);
    const gameStats = (0, utils_1.getGameStatsSummary)(user.id);
    const progress = (0, utils_1.getPmcProgress)(state.pmcXP);
    const prestigeTier = (0, utils_1.getPmcPrestigeTier)(state.pmcPrestige);
    const prestigeBonuses = (0, utils_1.getPmcPrestigeBonuses)(state.pmcPrestige);
    const prestigeEligible = progress.level >= utils_1.PMC_PRESTIGE_LEVEL_REQUIREMENT && state.pmcPrestige < utils_1.PMC_PRESTIGE_CAP;
    const nextPrestigeTier = (0, utils_1.getPmcPrestigeTier)(Math.min(utils_1.PMC_PRESTIGE_CAP, state.pmcPrestige + 1));
    const sirGru = state.followers?.sir_gru || null;
    const sirGruProgress = sirGru ? (0, utils_1.getSirGruProgress)(sirGru) : null;
    const sirGruStats = sirGruProgress ? (0, utils_1.getSirGruStats)(sirGruProgress.level) : null;
    const sirGruBonuses = sirGru ? (0, utils_1.getSirGruRaidBonuses)(sirGru) : null;
    const nextSirGruAbility = sirGruProgress
        ? utils_1.SIR_GRU_ABILITIES.find(ability => ability.level > sirGruProgress.level)
        : null;
    const tier = (0, utils_1.getPmcTierForLevel)(progress.level);
    const tierVisual = (0, visuals_1.getPmcTierVisual)(progress.level);
    const bossKills = Math.max(0, state.pmcBossKills || 0);
    const bossHeartNames = view === "collection" ? (0, bossHearts_1.getUnlockedBossHeartNames)(user.id) : [];
    const bossHeartsUnlocked = bossHeartNames.length;
    const mapMastery = (view === "mastery" ? Object.values(RaidDomain.RAID_MAPS) : [])
        .map(map => ({ map, entry: (0, utils_1.getMapReputationEntry)(user.id, map.key) }))
        .map(item => ({ ...item, progress: RaidDomain.getMapReputationProgress(item.entry.points) }))
        .sort((a, b) => b.entry.points - a.entry.points);
    const totalMapReputation = mapMastery.reduce((sum, item) => sum + item.entry.points, 0);
    const masteredMapCount = mapMastery.filter(item => !item.progress.nextTier).length;
    const collectibleEntries = (view === "collection" ? [...catalog_1.COLLECTIBLE_ITEM_IDS] : [])
        .map(id => ({ id, def: catalog_1.ITEM_DEFS[id], qty: (0, utils_1.getInventoryCount)(user.id, id) }))
        .filter(entry => entry.def && entry.qty > 0)
        .sort((a, b) => b.qty - a.qty || a.def.name.localeCompare(b.def.name));
    const ownedCollectibles = collectibleEntries.length;
    const ownedUltraCollectibles = collectibleEntries.filter(entry => catalog_1.ULTRA_RARE_COLLECTIBLE_IDS.includes(entry.id)).length;
    const collectibleValue = collectibleEntries.reduce((sum, entry) => sum + ((0, catalog_1.getVendorSellPrice)(entry.id) * entry.qty), 0);
    const collectibleLine = collectibleEntries.length
        ? collectibleEntries.slice(0, 3).map(entry => `${entry.def.name} x${entry.qty}`).join("\n")
        : "No collectibles found yet. Ultra-rare collectibles can only be found in raids.";
    const bossProgressLines = (view === "collection" ? [...RaidDomain.RAID_BOSS_ROSTER] : [])
        .filter(boss => (state.bossProgress?.[boss.name]?.kills || 0) > 0)
        .sort((first, second) => (state.bossProgress?.[second.name]?.kills || 0) - (state.bossProgress?.[first.name]?.kills || 0))
        .slice(0, 3)
        .map(boss => {
        const entry = (0, utils_1.getBossProgressEntry)(user.id, boss.name);
        return `${boss.name} • ${entry.kills}/${entry.encounters} kills • best streak ${entry.bestStreak}`;
    });
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(tierVisual.color)
        .setTitle(`🪖 ${state.pmcCallsign} • ${ids_1.PMC_PROFILE_VIEWS[view]}`)
        .setDescription(`Level ${progress.level.toLocaleString()} • Prestige ${prestigeTier.numeral} • ${tier?.label || "Recruit"}`)
        .addFields({
        name: `${prestigeTier.badge} Prestige`,
        value: [
            `Rank: Prestige ${prestigeTier.numeral} • ${prestigeTier.label}`,
            state.pmcPrestige >= utils_1.PMC_PRESTIGE_CAP
                ? "Maximum rank achieved"
                : prestigeEligible
                    ? `Ready for Prestige ${nextPrestigeTier.numeral}`
                    : `${Math.max(0, utils_1.PMC_PRESTIGE_LEVEL_REQUIREMENT - progress.level).toLocaleString()} levels to eligibility`,
            `Bonuses: +${(prestigeBonuses.successBonus * 100).toFixed(1)}% success • +${(prestigeBonuses.tokenBonus * 100).toFixed(1)}% tokens • +${(prestigeBonuses.defenseBonus * 100).toFixed(1)}% defense • +${(prestigeBonuses.xpBonus * 100).toFixed(1)}% raid XP`
        ].join("\n"),
        inline: false
    }, {
        name: "Territory Mastery",
        value: [
            `Network REP: ${totalMapReputation.toLocaleString()} • Mastered ${masteredMapCount}/${mapMastery.length}`,
            ...mapMastery.slice(0, 3).map(item => `${RaidDomain.RAID_MAP_SHORT_LABELS[item.map.key]} • ${item.progress.tier.label} • ${item.entry.points} REP`)
        ].join("\n"),
        inline: false
    }, {
        name: "Follower: Sir Gru",
        value: sirGru && sirGruProgress && sirGruStats && sirGruBonuses ? [
            `Level ${sirGruProgress.level}/100 • ${utils_1.FOLLOWER_SUPPORT_ROLES[(0, utils_1.getFollowerSupportRole)(sirGru)].label}`,
            `Progress: ${sirGruProgress.capped ? "MAX" : `${sirGruProgress.needForNext} XP to next level`}`,
            `Next ability: ${nextSirGruAbility ? `Lv ${nextSirGruAbility.level} • ${nextSirGruAbility.name}` : "All unlocked"}`,
            `Raid bonus: +${(sirGruBonuses.successBonus * 100).toFixed(1)}% success • +${(sirGruBonuses.bossKillBonus * 100).toFixed(1)}% boss takedown`
        ].join("\n") : "Unlocks automatically at PMC Prestige I.",
        inline: false
    }, {
        name: "Boss Trophy Case",
        value: [
            `Boss kills: ${bossKills} • Hearts: ${bossHeartsUnlocked}`,
            bossHeartNames.length ? `Recent: ${bossHeartNames.slice(0, 3).join(", ")}${bossHeartNames.length > 3 ? ` • +${bossHeartNames.length - 3} more` : ""}` : "No boss hearts yet."
        ].join("\n"),
        inline: false
    }, {
        name: "Boss Records",
        value: bossProgressLines.join("\n") || "No boss kills recorded yet.",
        inline: false
    }, {
        name: "Collector Vault",
        value: [
            `Owned ${ownedCollectibles}/${catalog_1.COLLECTIBLE_ITEM_IDS.length} • Ultra-rare ${ownedUltraCollectibles}/${catalog_1.ULTRA_RARE_COLLECTIBLE_IDS.length}`,
            `Vendor value ${collectibleValue.toLocaleString()} FN Token$`,
            collectibleLine
        ].join("\n"),
        inline: false
    }, {
        name: "Lifetime Raid Economy",
        value: `Wagered: ${gameStats.raid.wagered} | Payout: ${gameStats.raid.payout} | Net: ${gameStats.raid.net >= 0 ? `+${gameStats.raid.net}` : gameStats.raid.net} FN Token$`,
        inline: false
    });
    const sections = {
        overview: [],
        follower: ["Follower: Sir Gru"],
        prestige: [`${prestigeTier.badge} Prestige`],
        mastery: ["Territory Mastery", "Lifetime Raid Economy"],
        collection: ["Boss Trophy Case", "Boss Records", "Collector Vault"]
    };
    embed.setFields((embed.data.fields || []).filter(field => sections[view].includes(field.name)));
    if (view === "overview") {
        const weapon = (0, autocomplete_1.getBestOwnedGear)(user.id, catalog_1.WEAPON_IDS, "raidAttack");
        const armor = (0, autocomplete_1.getBestOwnedGear)(user.id, catalog_1.ARMOR_IDS, "raidDefense");
        embed.setFields({ name: "Deployment Readiness", value: [
                `Weapon: ${weapon?.name || "None"} • Armor: ${armor?.name || "None"}`,
                `Med patches: ${state.inventory.med_patch || 0} • Repair kits: ${state.inventory.repair_kit || 0}`,
                raids_1.activeRaidEncounters.has(user.id) ? "Raid in progress" : "Ready to deploy"
            ].join("\n"), inline: false });
        embed.setImage("attachment://pmc-profile.png");
        embed.setFooter({ text: "More details: choose a dossier section below." });
    }
    if (view === "follower") {
        if (sirGru && sirGruStats)
            embed.addFields({ name: "Support", value: [
                    utils_1.FOLLOWER_SUPPORT_ROLES[(0, utils_1.getFollowerSupportRole)(sirGru)].description,
                    `Scouting ${sirGruStats.scouting} • Firepower ${sirGruStats.firepower} • Guard ${sirGruStats.guard}`
                ].join("\n"), inline: false });
    }
    if (view === "prestige") {
        const preview = (0, utils_1.getPmcPrestigePreview)(state.pmcXP, state.pmcPrestige);
        embed.addFields({ name: "Next Rank", value: preview.capped ? "Prestige X complete." : [
                `XP to eligibility: ${preview.xpRemaining.toLocaleString()}`,
                `Success: +${(preview.currentBonuses.successBonus * 100).toFixed(1)}% → +${(preview.nextBonuses.successBonus * 100).toFixed(1)}%`,
                `Raid XP: +${(preview.currentBonuses.xpBonus * 100).toFixed(1)}% → +${(preview.nextBonuses.xpBonus * 100).toFixed(1)}%`,
                "Level and raid XP reset; inventory, currency, map REP, trophies, and records remain."
            ].join("\n"), inline: false });
    }
    const navigation = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(`${ids_1.PMC_PROFILE_IDS.view}:${user.id}`)
        .setPlaceholder("PMC profile")
        .addOptions(Object.entries(ids_1.PMC_PROFILE_VIEWS).map(([value, label]) => ({ value, label, default: value === view }))));
    const prestigeRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(ids_1.PMC_PRESTIGE_IDS.identity)
        .setLabel("Edit Callsign")
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId(ids_1.PMC_PRESTIGE_IDS.request)
        .setLabel(state.pmcPrestige >= utils_1.PMC_PRESTIGE_CAP ? "Prestige X Achieved" : `Review Prestige ${nextPrestigeTier.numeral}`)
        .setStyle(discord_js_1.ButtonStyle.Primary)
        .setDisabled(!prestigeEligible || raids_1.activeRaidEncounters.has(user.id)));
    const shortcuts = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(payloads_1.RAID_RESULT_ACTION_IDS.inventory).setLabel("Inventory").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(payloads_1.RAID_RESULT_ACTION_IDS.history).setLabel("Raid History").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(payloads_1.RAID_RESULT_ACTION_IDS.bosses).setLabel("Boss Intel").setStyle(discord_js_1.ButtonStyle.Secondary));
    const components = [navigation.toJSON(), (view === "prestige" || view === "overview" ? prestigeRow : shortcuts).toJSON()];
    if (view === "follower" && sirGru)
        components.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(`${ids_1.PMC_PROFILE_IDS.followerRole}:${user.id}`)
            .setPlaceholder("Sir Gru support role")
            .setDisabled(raids_1.activeRaidEncounters.has(user.id))
            .addOptions(Object.entries(utils_1.FOLLOWER_SUPPORT_ROLES).map(([value, role]) => ({ value, label: role.label, description: role.description, default: value === (0, utils_1.getFollowerSupportRole)(sirGru) })))).toJSON());
    return JSON.stringify((0, inquiryPanel_1.withHubNavigation)({ embed: embed.toJSON(), components, ...(view === "overview" ? { progressionCard: "pmc" } : {}) }, "pmc"));
}
function chunkDetailLines(lines, maxLines = 8) {
    const chunks = [];
    for (let i = 0; i < lines.length; i += maxLines) {
        chunks.push(lines.slice(i, i + maxLines).join("\n"));
    }
    return chunks;
}
function buildConditionsPayload() {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("🌦️ Raid Conditions")
        .setDescription("Condition pressure is now clearer, milder on average, and some armor pieces can fully negate matching raid conditions.");
    for (const condition of RaidDomain.RAID_CONDITIONS) {
        const counters = Object.entries(RaidDomain.ARMOR_TRAITS)
            .filter(([, trait]) => trait?.conditionImmunity?.includes(condition.key))
            .map(([id]) => catalog_1.ITEM_DEFS[id]?.name || id);
        embed.addFields({
            name: condition.label,
            value: [
                condition.description,
                `Success Delta: ${(condition.successDelta * 100).toFixed(1)}%`,
                `Token Delta: ${(condition.tokenMultiplierDelta * 100).toFixed(1)}%`,
                `Raid XP Multiplier: ${condition.xpMultiplier.toFixed(2)}x`,
                `Full Counters: ${counters.length ? counters.join(", ") : "None"}`
            ].join("\n"),
            inline: false
        });
    }
    return JSON.stringify({ embed: embed.toJSON() });
}
function buildGearIntelPayload(kindRaw, conditionRaw) {
    const kind = kindRaw === "weapon" || kindRaw === "armor" ? kindRaw : "all";
    const condition = RaidDomain.RAID_CONDITIONS.find(entry => entry.key === conditionRaw);
    const sections = [];
    if (kind === "all" || kind === "weapon") {
        sections.push({ title: "Weapons", ids: catalog_1.WEAPON_IDS, traitSource: RaidDomain.WEAPON_TRAITS, metric: "raidAttack" });
    }
    if (kind === "all" || kind === "armor") {
        sections.push({ title: "Armors", ids: catalog_1.ARMOR_IDS, traitSource: RaidDomain.ARMOR_TRAITS, metric: "raidDefense" });
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xd97706)
        .setTitle("🧰 Gear Intel")
        .setDescription(condition
        ? `Filtered for ${condition.label}. Matching bonuses and full immunities are highlighted.`
        : "Raid gear stat directory with base bonuses and special trigger traits.");
    for (const section of sections) {
        const lines = section.ids.map(id => {
            const def = catalog_1.ITEM_DEFS[id];
            const trait = section.traitSource[id];
            const basePct = Math.round((def?.[section.metric] || 0) * 100);
            const condBonus = condition ? trait?.conditionSuccess?.[condition.key] || 0 : 0;
            const immunity = condition && trait?.conditionImmunity?.includes(condition.key) ? " | NEGATES" : "";
            const bonusText = condition && condBonus ? ` | ${condition.key} ${condBonus >= 0 ? "+" : ""}${(condBonus * 100).toFixed(1)}%` : "";
            return `[${(0, payloads_1.rarityBadge)(def?.rarity)}] ${def?.name || id} | Base ${section.metric === "raidAttack" ? `ATK +${basePct}%` : `DEF +${basePct}%`}${bonusText}${immunity}${trait?.note ? ` | ${trait.note}` : ""}`;
        });
        const chunks = chunkDetailLines(lines, 7);
        chunks.forEach((chunk, index) => {
            embed.addFields({
                name: index === 0 ? section.title : `${section.title} ${index + 1}`,
                value: chunk,
                inline: false
            });
        });
    }
    return JSON.stringify({ embed: embed.toJSON() });
}
