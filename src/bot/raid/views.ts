// Raid history, mastery, boss roster, leaderboards, PMC profile, and intel views.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, User } from "discord.js";
import {
    ensureUser, getInventoryCount, getMapReputationEntry, getPmcPrestigeBonuses,
    getPmcPrestigePreview, getPmcPrestigeTier, getPmcProgress, getPmcTierForLevel, getSirGruProgress,
    getSirGruRaidBonuses, getSirGruStats, getFollowerSupportRole, FOLLOWER_SUPPORT_ROLES, SIR_GRU_ABILITIES,
    getBossProgressEntry, getGameStatsSummary, PMC_PRESTIGE_CAP, PMC_PRESTIGE_LEVEL_REQUIREMENT, points
} from "../../utils";
import { getLeaderboard } from "../../game/economy";
import {
    ARMOR_IDS, COLLECTIBLE_ITEM_IDS, getVendorSellPrice, ITEM_DEFS, ULTRA_RARE_COLLECTIBLE_IDS, WEAPON_IDS
} from "../../game/catalog";
import { getUnlockedBossHeartNames } from "../../game/bossHearts";
import {
    buildBossRosterPayload as buildBossRosterEmbedPayload, RAID_RESULT_ACTION_IDS, rarityBadge
} from "../../game/payloads";
import * as RaidDomain from "../../raid/domain";
import { getPmcTierVisual } from "../pmc/visuals";
import { PMC_PRESTIGE_IDS, PMC_PROFILE_IDS, PMC_PROFILE_VIEWS, type PmcProfileView } from "../ui/ids";
import { activeRaidEncounters } from "./raids";
import { getBestOwnedGear } from "../ui/autocomplete";
import { withHubNavigation } from "../../features/inquiryPanel";
import type { APIActionRowComponent, APIComponentInMessageActionRow } from "discord.js";

export function buildRaidHistoryPayload(userId: string): string {
    const state = ensureUser(userId);
    const history = state.raidHistory.slice(0, 8);
    if (!history.length) {
        return JSON.stringify({
            embed: new EmbedBuilder()
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
        .map(map => ({ map, entry: getMapReputationEntry(userId, map.key) }))
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

    const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle("📜 Raid History Console")
        .setDescription("Recent mission log with extraction outcomes, boss encounters, and short-form economy performance.")
        .addFields(
            {
                name: "Recent Combat Snapshot",
                value: [
                    `Entries Loaded: ${history.length}`,
                    `Recent Wins: ${wins}/${history.length}`,
                    `Recent Net: ${net >= 0 ? `+${net}` : net} FN Token$`,
                    `Boss Contacts: ${totalBossSpawns} | Boss Kills: ${totalBossKills}`
                ].join("\n"),
                inline: false
            },
            {
                name: "Territory Network",
                value: reputationLeaders.join("\n") || "No map reputation established.",
                inline: false
            },
            ...chunkDetailLines(recentLines, 2).slice(0, 4).map((chunk, index) => ({
                name: index === 0 ? "Mission Log" : `Mission Log ${index + 1}`,
                value: chunk,
                inline: false
            }))
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

export function formatMapReputationBar(progressPct: number): string {
    const width = 12;
    const filled = Math.max(0, Math.min(width, Math.round((progressPct / 100) * width)));
    return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${progressPct}%`;
}

export function buildMapMasteryPayload(userId: string, focusMapKey?: string): string {
    const maps = Object.values(RaidDomain.RAID_MAPS)
        .map(map => {
            const entry = getMapReputationEntry(userId, map.key);
            return { map, entry, progress: RaidDomain.getMapReputationProgress(entry.points) };
        })
        .sort((a, b) => (a.map.key === focusMapKey ? -1 : b.map.key === focusMapKey ? 1 : b.entry.points - a.entry.points));
    const totalReputation = maps.reduce((sum, item) => sum + item.entry.points, 0);
    const masteredMaps = maps.filter(item => !item.progress.nextTier).length;

    const embed = new EmbedBuilder()
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

export function buildBossRosterPayload(): string {
    const bossLeaderboard = RaidDomain.RAID_BOSS_ROSTER.map(boss => {
        const progress = Object.values(points).map(user => user.bossProgress?.[boss.name]).filter(entry => entry && entry.kills > 0);
        return {
            name: boss.name,
            totalKills: progress.reduce((sum, entry) => sum + (entry?.kills || 0), 0),
            bestStreak: Math.max(0, ...progress.map(entry => entry?.bestStreak || 0))
        };
    }).sort((a, b) => b.totalKills - a.totalKills).slice(0, 5);
    return buildBossRosterEmbedPayload(bossLeaderboard);
}

export function buildLeaderboardPayload(): string {
    const top = getLeaderboard();
    const voiceLeaders = Object.entries(points)
        .map(([id, user]) => ({ id, voiceMinutes: user.voiceMinutes || 0 }))
        .filter(row => row.voiceMinutes > 0)
        .sort((a, b) => b.voiceMinutes - a.voiceMinutes)
        .slice(0, 5);
    const achievementLeaders = Object.entries(points)
        .map(([id, user]) => ({ id, achievements: user.achievementIds?.length || 0 }))
        .filter(row => row.achievements > 0)
        .sort((a, b) => b.achievements - a.achievements)
        .slice(0, 5);
    if (!top.length) {
        return JSON.stringify({
            embed: new EmbedBuilder()
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
    const totalXp = Object.values(points).reduce((sum, user) => sum + (user.xp || 0), 0);
    const formatRankings = (rows: Array<{ id: string; value: number }>, suffix: string): string => rows.length
        ? rows.map((row, index) => `${medals[index] || `#${index + 1}`} <@${row.id}> • ${row.value.toLocaleString()} ${suffix}`).join("\n")
        : "No ranking data yet.";

    const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🏆 XP Command Board")
        .setDescription("Server-wide engagement progression standings with premium podium formatting.")
        .addFields(
            {
                name: "Leaderboard Snapshot",
                value: [
                    `Tracked Players: ${top.length}`,
                    `Total XP Across Board: ${totalXp.toLocaleString()}`,
                                        `Tracked Players: ${Object.keys(points).length.toLocaleString()}`,
                    `Top Rank XP: ${top[0]?.xp?.toLocaleString() || 0}`
                ].join("\n"),
                inline: false
            },
            ...chunkDetailLines(topLines, 3).slice(0, 4).map((chunk, index) => ({
                name: index === 0 ? "Podium and Ranks" : `Podium and Ranks ${index + 1}`,
                value: chunk,
                inline: false
            })),
            {
                name: "Voice Time Leaders",
                value: formatRankings(voiceLeaders.map(row => ({ id: row.id, value: row.voiceMinutes })), "minutes"),
                inline: true
            },
            {
                name: "Achievement Leaders",
                value: formatRankings(achievementLeaders.map(row => ({ id: row.id, value: row.achievements })), "unlocks"),
                inline: true
            }
        );

    return JSON.stringify({ embed: embed.toJSON() });
}

export function buildPmcProfilePayload(user: User, view: PmcProfileView = "overview"): string {
    const state = ensureUser(user.id);
    const gameStats = getGameStatsSummary(user.id);
    const progress = getPmcProgress(state.pmcXP);
    const prestigeTier = getPmcPrestigeTier(state.pmcPrestige);
    const prestigeBonuses = getPmcPrestigeBonuses(state.pmcPrestige);
    const prestigeEligible = progress.level >= PMC_PRESTIGE_LEVEL_REQUIREMENT && state.pmcPrestige < PMC_PRESTIGE_CAP;
    const nextPrestigeTier = getPmcPrestigeTier(Math.min(PMC_PRESTIGE_CAP, state.pmcPrestige + 1));
    const sirGru = state.followers?.sir_gru || null;
    const sirGruProgress = sirGru ? getSirGruProgress(sirGru) : null;
    const sirGruStats = sirGruProgress ? getSirGruStats(sirGruProgress.level) : null;
    const sirGruBonuses = sirGru ? getSirGruRaidBonuses(sirGru) : null;
    const nextSirGruAbility = sirGruProgress
        ? SIR_GRU_ABILITIES.find(ability => ability.level > sirGruProgress.level)
        : null;
    const tier = getPmcTierForLevel(progress.level);
    const tierVisual = getPmcTierVisual(progress.level);
    const bossKills = Math.max(0, state.pmcBossKills || 0);
    const bossHeartNames = view === "collection" ? getUnlockedBossHeartNames(user.id) : [];
    const bossHeartsUnlocked = bossHeartNames.length;
    const mapMastery = (view === "mastery" ? Object.values(RaidDomain.RAID_MAPS) : [])
        .map(map => ({ map, entry: getMapReputationEntry(user.id, map.key) }))
        .map(item => ({ ...item, progress: RaidDomain.getMapReputationProgress(item.entry.points) }))
        .sort((a, b) => b.entry.points - a.entry.points);
    const totalMapReputation = mapMastery.reduce((sum, item) => sum + item.entry.points, 0);
    const masteredMapCount = mapMastery.filter(item => !item.progress.nextTier).length;
    const collectibleEntries = (view === "collection" ? [...COLLECTIBLE_ITEM_IDS] : [])
        .map(id => ({ id, def: ITEM_DEFS[id], qty: getInventoryCount(user.id, id) }))
        .filter(entry => entry.def && entry.qty > 0)
        .sort((a, b) => b.qty - a.qty || a.def.name.localeCompare(b.def.name));
    const ownedCollectibles = collectibleEntries.length;
    const ownedUltraCollectibles = collectibleEntries.filter(entry => ULTRA_RARE_COLLECTIBLE_IDS.includes(entry.id as (typeof ULTRA_RARE_COLLECTIBLE_IDS)[number])).length;
    const collectibleValue = collectibleEntries.reduce((sum, entry) => sum + (getVendorSellPrice(entry.id) * entry.qty), 0);
    const collectibleLine = collectibleEntries.length
        ? collectibleEntries.slice(0, 3).map(entry => `${entry.def.name} x${entry.qty}`).join("\n")
        : "No collectibles found yet. Ultra-rare collectibles can only be found in raids.";
    const bossProgressLines = (view === "collection" ? [...RaidDomain.RAID_BOSS_ROSTER] : [])
        .filter(boss => (state.bossProgress?.[boss.name]?.kills || 0) > 0)
        .sort((first, second) => (state.bossProgress?.[second.name]?.kills || 0) - (state.bossProgress?.[first.name]?.kills || 0))
        .slice(0, 3)
        .map(boss => {
        const entry = getBossProgressEntry(user.id, boss.name);
        return `${boss.name} • ${entry.kills}/${entry.encounters} kills • best streak ${entry.bestStreak}`;
    });
    const embed = new EmbedBuilder()
        .setColor(tierVisual.color)
        .setTitle(`🪖 ${state.pmcCallsign} • ${PMC_PROFILE_VIEWS[view]}`)
        .setDescription(`Level ${progress.level.toLocaleString()} • Prestige ${prestigeTier.numeral} • ${tier?.label || "Recruit"}`)
        .addFields(
            {
                name: `${prestigeTier.badge} Prestige`,
                value: [
                    `Rank: Prestige ${prestigeTier.numeral} • ${prestigeTier.label}`,
                    state.pmcPrestige >= PMC_PRESTIGE_CAP
                        ? "Maximum rank achieved"
                        : prestigeEligible
                            ? `Ready for Prestige ${nextPrestigeTier.numeral}`
                            : `${Math.max(0, PMC_PRESTIGE_LEVEL_REQUIREMENT - progress.level).toLocaleString()} levels to eligibility`,
                    `Bonuses: +${(prestigeBonuses.successBonus * 100).toFixed(1)}% success • +${(prestigeBonuses.tokenBonus * 100).toFixed(1)}% tokens • +${(prestigeBonuses.defenseBonus * 100).toFixed(1)}% defense • +${(prestigeBonuses.xpBonus * 100).toFixed(1)}% raid XP`
                ].join("\n"),
                inline: false
            },
            {
                name: "Territory Mastery",
                value: [
                    `Network REP: ${totalMapReputation.toLocaleString()} • Mastered ${masteredMapCount}/${mapMastery.length}`,
                    ...mapMastery.slice(0, 3).map(item => `${RaidDomain.RAID_MAP_SHORT_LABELS[item.map.key]} • ${item.progress.tier.label} • ${item.entry.points} REP`)
                ].join("\n"),
                inline: false
            },
            {
                name: "Follower: Sir Gru",
                value: sirGru && sirGruProgress && sirGruStats && sirGruBonuses ? [
                    `Level ${sirGruProgress.level}/100 • ${FOLLOWER_SUPPORT_ROLES[getFollowerSupportRole(sirGru)].label}`,
                    `Progress: ${sirGruProgress.capped ? "MAX" : `${sirGruProgress.needForNext} XP to next level`}`,
                    `Next ability: ${nextSirGruAbility ? `Lv ${nextSirGruAbility.level} • ${nextSirGruAbility.name}` : "All unlocked"}`,
                    `Raid bonus: +${(sirGruBonuses.successBonus * 100).toFixed(1)}% success • +${(sirGruBonuses.bossKillBonus * 100).toFixed(1)}% boss takedown`
                ].join("\n") : "Unlocks automatically at PMC Prestige I.",
                inline: false
            },
            {
                name: "Boss Trophy Case",
                value: [
                    `Boss kills: ${bossKills} • Hearts: ${bossHeartsUnlocked}`,
                    bossHeartNames.length ? `Recent: ${bossHeartNames.slice(0, 3).join(", ")}${bossHeartNames.length > 3 ? ` • +${bossHeartNames.length - 3} more` : ""}` : "No boss hearts yet."
                ].join("\n"),
                inline: false
            },
            {
                name: "Boss Records",
                value: bossProgressLines.join("\n") || "No boss kills recorded yet.",
                inline: false
            },
            {
                name: "Collector Vault",
                value: [
                    `Owned ${ownedCollectibles}/${COLLECTIBLE_ITEM_IDS.length} • Ultra-rare ${ownedUltraCollectibles}/${ULTRA_RARE_COLLECTIBLE_IDS.length}`,
                    `Vendor value ${collectibleValue.toLocaleString()} FN Token$`,
                    collectibleLine
                ].join("\n"),
                inline: false
            },
            {
                name: "Lifetime Raid Economy",
                value: `Wagered: ${gameStats.raid.wagered} | Payout: ${gameStats.raid.payout} | Net: ${gameStats.raid.net >= 0 ? `+${gameStats.raid.net}` : gameStats.raid.net} FN Token$`,
                inline: false
            }
        );

    const sections: Record<PmcProfileView, string[]> = {
        overview: [],
        follower: ["Follower: Sir Gru"],
        prestige: [`${prestigeTier.badge} Prestige`],
        mastery: ["Territory Mastery", "Lifetime Raid Economy"],
        collection: ["Boss Trophy Case", "Boss Records", "Collector Vault"]
    };
    embed.setFields((embed.data.fields || []).filter(field => sections[view].includes(field.name)));
    if (view === "overview") {
        const weapon = getBestOwnedGear(user.id, WEAPON_IDS, "raidAttack");
        const armor = getBestOwnedGear(user.id, ARMOR_IDS, "raidDefense");
        embed.setFields({ name: "Deployment Readiness", value: [
            `Weapon: ${weapon?.name || "None"} • Armor: ${armor?.name || "None"}`,
            `Med patches: ${state.inventory.med_patch || 0} • Repair kits: ${state.inventory.repair_kit || 0}`,
            activeRaidEncounters.has(user.id) ? "Raid in progress" : "Ready to deploy"
        ].join("\n"), inline: false });
        embed.setImage("attachment://pmc-profile.png");
        embed.setFooter({ text: "More details: choose a dossier section below." });
    }
    if (view === "follower") {
        if (sirGru && sirGruStats) embed.addFields({ name: "Support", value: [
            FOLLOWER_SUPPORT_ROLES[getFollowerSupportRole(sirGru)].description,
            `Scouting ${sirGruStats.scouting} • Firepower ${sirGruStats.firepower} • Guard ${sirGruStats.guard}`
        ].join("\n"), inline: false });
    }
    if (view === "prestige") {
        const preview = getPmcPrestigePreview(state.pmcXP, state.pmcPrestige);
        embed.addFields({ name: "Next Rank", value: preview.capped ? "Prestige X complete." : [
            `XP to eligibility: ${preview.xpRemaining.toLocaleString()}`,
            `Success: +${(preview.currentBonuses.successBonus * 100).toFixed(1)}% → +${(preview.nextBonuses.successBonus * 100).toFixed(1)}%`,
            `Raid XP: +${(preview.currentBonuses.xpBonus * 100).toFixed(1)}% → +${(preview.nextBonuses.xpBonus * 100).toFixed(1)}%`,
            "Level and raid XP reset; inventory, currency, map REP, trophies, and records remain."
        ].join("\n"), inline: false });
    }
    const navigation = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`${PMC_PROFILE_IDS.view}:${user.id}`)
        .setPlaceholder("PMC profile")
        .addOptions(Object.entries(PMC_PROFILE_VIEWS).map(([value, label]) => ({ value, label, default: value === view }))));
    const prestigeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(PMC_PRESTIGE_IDS.identity)
            .setLabel("Edit Callsign")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(PMC_PRESTIGE_IDS.request)
            .setLabel(state.pmcPrestige >= PMC_PRESTIGE_CAP ? "Prestige X Achieved" : `Review Prestige ${nextPrestigeTier.numeral}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!prestigeEligible || activeRaidEncounters.has(user.id))
    );
    const shortcuts = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(RAID_RESULT_ACTION_IDS.inventory).setLabel("Inventory").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(RAID_RESULT_ACTION_IDS.history).setLabel("Raid History").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(RAID_RESULT_ACTION_IDS.bosses).setLabel("Boss Intel").setStyle(ButtonStyle.Secondary)
    );
    const components: APIActionRowComponent<APIComponentInMessageActionRow>[] = [navigation.toJSON(), (view === "prestige" || view === "overview" ? prestigeRow : shortcuts).toJSON()];
    if (view === "follower" && sirGru) components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`${PMC_PROFILE_IDS.followerRole}:${user.id}`)
        .setPlaceholder("Sir Gru support role")
        .setDisabled(activeRaidEncounters.has(user.id))
        .addOptions(Object.entries(FOLLOWER_SUPPORT_ROLES).map(([value, role]) => ({ value, label: role.label, description: role.description, default: value === getFollowerSupportRole(sirGru) })))).toJSON());
    return JSON.stringify(withHubNavigation({ embed: embed.toJSON(), components, ...(view === "overview" ? { progressionCard: "pmc" as const } : {}) }, "pmc"));
}

function chunkDetailLines(lines: string[], maxLines = 8): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += maxLines) {
        chunks.push(lines.slice(i, i + maxLines).join("\n"));
    }
    return chunks;
}

export function buildConditionsPayload(): string {
    const embed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("🌦️ Raid Conditions")
        .setDescription("Condition pressure is now clearer, milder on average, and some armor pieces can fully negate matching raid conditions.");

    for (const condition of RaidDomain.RAID_CONDITIONS) {
        const counters = Object.entries(RaidDomain.ARMOR_TRAITS)
            .filter(([, trait]) => trait?.conditionImmunity?.includes(condition.key))
            .map(([id]) => ITEM_DEFS[id]?.name || id);
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

export function buildGearIntelPayload(kindRaw?: string | null, conditionRaw?: string | null): string {
    const kind = kindRaw === "weapon" || kindRaw === "armor" ? kindRaw : "all";
    const condition = RaidDomain.RAID_CONDITIONS.find(entry => entry.key === conditionRaw);
    const sections: Array<{ title: string; ids: string[]; traitSource: Partial<Record<string, RaidDomain.GearTrait>>; metric: "raidAttack" | "raidDefense" }> = [];

    if (kind === "all" || kind === "weapon") {
        sections.push({ title: "Weapons", ids: WEAPON_IDS, traitSource: RaidDomain.WEAPON_TRAITS, metric: "raidAttack" });
    }
    if (kind === "all" || kind === "armor") {
        sections.push({ title: "Armors", ids: ARMOR_IDS, traitSource: RaidDomain.ARMOR_TRAITS, metric: "raidDefense" });
    }

    const embed = new EmbedBuilder()
        .setColor(0xd97706)
        .setTitle("🧰 Gear Intel")
        .setDescription(condition
            ? `Filtered for ${condition.label}. Matching bonuses and full immunities are highlighted.`
            : "Raid gear stat directory with base bonuses and special trigger traits.");

    for (const section of sections) {
        const lines = section.ids.map(id => {
            const def = ITEM_DEFS[id];
            const trait = section.traitSource[id];
            const basePct = Math.round(((def?.[section.metric] || 0) as number) * 100);
            const condBonus = condition ? trait?.conditionSuccess?.[condition.key] || 0 : 0;
            const immunity = condition && trait?.conditionImmunity?.includes(condition.key) ? " | NEGATES" : "";
            const bonusText = condition && condBonus ? ` | ${condition.key} ${condBonus >= 0 ? "+" : ""}${(condBonus * 100).toFixed(1)}%` : "";
            return `[${rarityBadge(def?.rarity)}] ${def?.name || id} | Base ${section.metric === "raidAttack" ? `ATK +${basePct}%` : `DEF +${basePct}%`}${bonusText}${immunity}${trait?.note ? ` | ${trait.note}` : ""}`;
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
