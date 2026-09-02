export type RaidConditionKey = "storm" | "fog" | "night" | "heatwave" | "urban" | "radiation" | "drizzle" | "crosswind" | "low_power" | "ashfall";

export type RaidCondition = {
    key: RaidConditionKey;
    label: string;
    description: string;
    successDelta: number;
    tokenMultiplierDelta: number;
    xpMultiplier: number;
};

export const RAID_CONDITIONS: RaidCondition[] = [
    { key: "storm", label: "Storm Front", description: "Visibility drops and extraction lanes are unstable.", successDelta: -0.03, tokenMultiplierDelta: 0.08, xpMultiplier: 1.1 },
    { key: "fog", label: "Dense Fog", description: "Long-range pressure is reduced, stealth routing improves.", successDelta: -0.01, tokenMultiplierDelta: 0.05, xpMultiplier: 1.06 },
    { key: "night", label: "Night Operation", description: "High-risk engagement windows with stealth-focused paths.", successDelta: -0.02, tokenMultiplierDelta: 0.1, xpMultiplier: 1.14 },
    { key: "heatwave", label: "Heatwave", description: "Thermal strain lowers heavy gear efficiency.", successDelta: -0.015, tokenMultiplierDelta: 0.06, xpMultiplier: 1.08 },
    { key: "urban", label: "Urban Collapse", description: "Close-quarters terrain rewards mobility and fast weapons.", successDelta: 0.0, tokenMultiplierDelta: 0.04, xpMultiplier: 1.04 },
    { key: "radiation", label: "Radiation Surge", description: "Hazard zones punish weak protection but increase rewards.", successDelta: -0.025, tokenMultiplierDelta: 0.12, xpMultiplier: 1.18 },
    { key: "drizzle", label: "Cold Drizzle", description: "Minor moisture slicks lanes and softens sightlines without heavily disrupting tempo.", successDelta: -0.006, tokenMultiplierDelta: 0.025, xpMultiplier: 1.03 },
    { key: "crosswind", label: "Crosswind Shear", description: "Light lateral wind nudges ranged consistency and extraction timing.", successDelta: -0.009, tokenMultiplierDelta: 0.03, xpMultiplier: 1.04 },
    { key: "low_power", label: "Low Power Grid", description: "Flickering infrastructure causes subtle routing delays and weaker tactical reads.", successDelta: -0.012, tokenMultiplierDelta: 0.035, xpMultiplier: 1.05 },
    { key: "ashfall", label: "Ashfall", description: "Airborne ash creates persistent low-grade interference across the operation.", successDelta: -0.018, tokenMultiplierDelta: 0.055, xpMultiplier: 1.08 }
];

export type RaidDifficulty = "Beginner" | "Mid" | "Hard" | "Elite" | "Brutal" | "Cataclysmic";
export type RaidMapKey = "plagued_cemetary" | "slaughterhouse" | "boogerswoodz" | "megayachtolopolis" | "warlords_warcamp" | "sunken_village";
export type RaidApproachKey = "balanced" | "recon" | "assault" | "scavenge";

export type RaidApproach = {
    key: RaidApproachKey;
    label: string;
    description: string;
    successDelta: number;
    tokenMultiplierDelta: number;
    bossSpawnDelta: number;
    bossKillDelta: number;
    xpMultiplier: number;
    lootBonusRolls: number;
};

export const RAID_APPROACHES: Record<RaidApproachKey, RaidApproach> = {
    balanced: { key: "balanced", label: "Balanced", description: "Standard operation with no tactical tradeoffs.", successDelta: 0, tokenMultiplierDelta: 0, bossSpawnDelta: 0, bossKillDelta: 0, xpMultiplier: 1, lootBonusRolls: 0 },
    recon: { key: "recon", label: "Recon", description: "Safer routing with fewer boss contacts and reduced token returns.", successDelta: 0.045, tokenMultiplierDelta: -0.08, bossSpawnDelta: -0.04, bossKillDelta: 0, xpMultiplier: 0.95, lootBonusRolls: 0 },
    assault: { key: "assault", label: "Assault", description: "Aggressive routing draws bosses and improves takedowns at greater extraction risk.", successDelta: -0.035, tokenMultiplierDelta: 0.08, bossSpawnDelta: 0.08, bossKillDelta: 0.1, xpMultiplier: 1.12, lootBonusRolls: 0 },
    scavenge: { key: "scavenge", label: "Scavenge", description: "Slower cache routing adds a loot roll but weakens extraction and combat returns.", successDelta: -0.025, tokenMultiplierDelta: -0.04, bossSpawnDelta: 0.01, bossKillDelta: -0.03, xpMultiplier: 1.05, lootBonusRolls: 1 }
};

export const RAID_APPROACH_CHOICES = Object.values(RAID_APPROACHES).map(approach => ({ name: approach.label, value: approach.key }));

export function resolveRaidApproach(approachRaw?: string | null): RaidApproach {
    const key = (approachRaw || "balanced") as RaidApproachKey;
    return RAID_APPROACHES[key] || RAID_APPROACHES.balanced;
}

export type MapReputationTier = {
    level: number;
    label: string;
    threshold: number;
    successBonus: number;
    tokenBonus: number;
    bossKillBonus: number;
    description: string;
};

export const MAP_REPUTATION_TIERS: MapReputationTier[] = [
    { level: 0, label: "Unproven", threshold: 0, successBonus: 0, tokenBonus: 0, bossKillBonus: 0, description: "No local network established." },
    { level: 1, label: "Pathfinder", threshold: 100, successBonus: 0.005, tokenBonus: 0.01, bossKillBonus: 0.005, description: "Reliable routes reveal safer entry points." },
    { level: 2, label: "Fixer", threshold: 300, successBonus: 0.01, tokenBonus: 0.02, bossKillBonus: 0.01, description: "Local contacts improve extraction value and boss intelligence." },
    { level: 3, label: "Vanguard", threshold: 700, successBonus: 0.015, tokenBonus: 0.03, bossKillBonus: 0.02, description: "Veteran map knowledge opens priority routes." },
    { level: 4, label: "Map Legend", threshold: 1400, successBonus: 0.02, tokenBonus: 0.04, bossKillBonus: 0.03, description: "Complete territorial mastery grants elite operational intelligence." }
];

export function getMapReputationTier(points: number): MapReputationTier {
    const safePoints = Math.max(0, Math.floor(points || 0));
    return [...MAP_REPUTATION_TIERS].reverse().find(tier => safePoints >= tier.threshold) || MAP_REPUTATION_TIERS[0];
}

export function getMapReputationProgress(points: number): {
    points: number;
    tier: MapReputationTier;
    nextTier: MapReputationTier | null;
    progressPct: number;
    pointsToNext: number;
} {
    const safePoints = Math.max(0, Math.floor(points || 0));
    const tier = getMapReputationTier(safePoints);
    const nextTier = MAP_REPUTATION_TIERS.find(entry => entry.level === tier.level + 1) || null;
    if (!nextTier) return { points: safePoints, tier, nextTier: null, progressPct: 100, pointsToNext: 0 };
    const tierSpan = Math.max(1, nextTier.threshold - tier.threshold);
    const progressPct = Math.max(0, Math.min(100, Math.floor(((safePoints - tier.threshold) / tierSpan) * 100)));
    return { points: safePoints, tier, nextTier, progressPct, pointsToNext: Math.max(0, nextTier.threshold - safePoints) };
}

export function calculateMapReputationGain(input: {
    mapDifficulty: RaidDifficulty;
    tension: string;
    success: boolean;
    bossSpawned: boolean;
    bossDefeated: boolean;
}): number {
    const difficultyBonus = getRaidDifficultyIndex(input.mapDifficulty) * 2;
    const tensionBonus = input.tension === "high" ? 5 : input.tension === "medium" ? 2 : 0;
    const resultBonus = input.success ? 12 : 4;
    return resultBonus + difficultyBonus + tensionBonus + (input.bossSpawned ? 3 : 0) + (input.bossDefeated ? 12 : 0);
}

export type BossTraitKey = "armored" | "relentless" | "elusive" | "berserker" | "tactician" | "hoarder";
export type BossTrait = { key: BossTraitKey; label: string; description: string; killPenalty: number; counterApproach?: RaidApproachKey; counterBonus?: number; rewardMultiplier: number };

export const BOSS_TRAITS: Record<BossTraitKey, BossTrait> = {
    armored: { key: "armored", label: "Reactive Armor", description: "Layered plating resists direct fire; Assault breaches it more efficiently.", killPenalty: 0.035, counterApproach: "assault", counterBonus: 0.025, rewardMultiplier: 1.06 },
    relentless: { key: "relentless", label: "Relentless", description: "Sustained pressure punishes prolonged engagements; Recon exposes safer windows.", killPenalty: 0.025, counterApproach: "recon", counterBonus: 0.02, rewardMultiplier: 1.05 },
    elusive: { key: "elusive", label: "Phase Hunter", description: "Rapid repositioning breaks target locks; Recon predicts the movement pattern.", killPenalty: 0.03, counterApproach: "recon", counterBonus: 0.025, rewardMultiplier: 1.06 },
    berserker: { key: "berserker", label: "Berserker", description: "Damage increases as health falls; Assault can end the final phase quickly.", killPenalty: 0.03, counterApproach: "assault", counterBonus: 0.025, rewardMultiplier: 1.08 },
    tactician: { key: "tactician", label: "Battle Tactician", description: "Adaptive counters punish predictable pushes; Balanced operations limit openings.", killPenalty: 0.025, counterApproach: "balanced", counterBonus: 0.02, rewardMultiplier: 1.05 },
    hoarder: { key: "hoarder", label: "Vault Keeper", description: "Guards reinforced caches; Scavenge teams identify weak points and richer spoils.", killPenalty: 0.02, counterApproach: "scavenge", counterBonus: 0.02, rewardMultiplier: 1.1 }
};

export type BossPhase = { name: string; thresholdPct: number; mechanic: string; killPenalty: number; rewardMultiplier: number };
export type BossCombatProfile = { traits: BossTraitKey[]; phases: BossPhase[] };

const DEFAULT_BOSS_PHASES: BossPhase[] = [
    { name: "Contact", thresholdPct: 100, mechanic: "The boss establishes control of the combat zone.", killPenalty: 0, rewardMultiplier: 1 },
    { name: "Enraged", thresholdPct: 45, mechanic: "The boss commits its signature attack pattern.", killPenalty: 0.025, rewardMultiplier: 1.08 }
];

export const BOSS_COMBAT_PROFILES: Record<string, BossCombatProfile> = {
    "The Grave Warden": { traits: ["armored"], phases: DEFAULT_BOSS_PHASES },
    "Sister Vell": { traits: ["elusive"], phases: DEFAULT_BOSS_PHASES },
    "Morrow Fang": { traits: ["berserker"], phases: DEFAULT_BOSS_PHASES },
    "Butcher Prime": { traits: ["relentless", "berserker"], phases: DEFAULT_BOSS_PHASES },
    Shardjaw: { traits: ["armored", "relentless"], phases: DEFAULT_BOSS_PHASES },
    "Hexline Rook": { traits: ["tactician", "armored"], phases: DEFAULT_BOSS_PHASES },
    "Booger King Omega": { traits: ["hoarder", "berserker"], phases: [...DEFAULT_BOSS_PHASES, { name: "Omega Rupture", thresholdPct: 20, mechanic: "Unstable biomass floods every extraction lane.", killPenalty: 0.025, rewardMultiplier: 1.12 }] },
    "Queen Sumphex": { traits: ["elusive", "hoarder"], phases: [...DEFAULT_BOSS_PHASES, { name: "Sovereign Bloom", thresholdPct: 20, mechanic: "Corrosive growth seals safe firing positions.", killPenalty: 0.025, rewardMultiplier: 1.12 }] },
    "Warlord Nullhide": { traits: ["tactician", "relentless"], phases: [...DEFAULT_BOSS_PHASES, { name: "Null Barrage", thresholdPct: 20, mechanic: "Void artillery saturates the final approach.", killPenalty: 0.03, rewardMultiplier: 1.12 }] },
    "Dreadwake Morvane": { traits: ["armored", "hoarder"], phases: [...DEFAULT_BOSS_PHASES, { name: "Dreadwake Protocol", thresholdPct: 20, mechanic: "The command deck locks down around a lethal hull breach.", killPenalty: 0.03, rewardMultiplier: 1.14 }] },
    "Kraghoss the Ashen Standard": { traits: ["tactician", "berserker"], phases: [...DEFAULT_BOSS_PHASES, { name: "Ashen Last Stand", thresholdPct: 20, mechanic: "Artillery and war banners empower a final countercharge.", killPenalty: 0.035, rewardMultiplier: 1.15 }] },
    "Thalrex Mourntide": { traits: ["relentless", "elusive", "hoarder"], phases: [...DEFAULT_BOSS_PHASES, { name: "Mourntide Ascendant", thresholdPct: 20, mechanic: "The drowned shrine awakens and the battlefield begins to flood.", killPenalty: 0.04, rewardMultiplier: 1.18 }] }
};

export function getBossCombatProfile(name: string): BossCombatProfile {
    return BOSS_COMBAT_PROFILES[name] || { traits: ["relentless"], phases: DEFAULT_BOSS_PHASES };
}

export function getBossCombatModifiers(name: string, approachKey: RaidApproachKey): {
    killPenalty: number;
    counterBonus: number;
    rewardMultiplier: number;
    traits: BossTrait[];
    phases: BossPhase[];
} {
    const profile = getBossCombatProfile(name);
    const traits = profile.traits.map(key => BOSS_TRAITS[key]);
    const killPenalty = traits.reduce((sum, trait) => sum + trait.killPenalty, 0) + profile.phases.reduce((sum, phase) => sum + phase.killPenalty, 0);
    const counterBonus = traits.reduce((sum, trait) => sum + (trait.counterApproach === approachKey ? trait.counterBonus || 0 : 0), 0);
    const traitReward = traits.reduce((multiplier, trait) => multiplier * trait.rewardMultiplier, 1);
    const phaseReward = profile.phases.reduce((multiplier, phase) => multiplier * phase.rewardMultiplier, 1);
    return { killPenalty, counterBonus, rewardMultiplier: Math.min(1.65, traitReward * phaseReward), traits, phases: profile.phases };
}

export type BossVariant = {
    name: string;
    title: string;
    ferocity: number;
    successPenalty: number;
    killPenalty: number;
    raidPressure: number;
    bonusXpRange: [number, number];
    tokenRewardRange: [number, number];
    weaponDrops: string[];
    armorDrops: string[];
    rareDropChance: number;
};

export type BossRosterEntry = BossVariant & {
    homeMapKey: RaidMapKey;
    homeMapLabel: string;
    homeMapDifficulty: RaidDifficulty;
};

export type RolledBoss = {
    name: string;
    title: string;
    ferocity: number;
    successPenalty: number;
    killPenalty: number;
    raidPressure: number;
    bonusXpRange: [number, number];
    tokenRewardRange: [number, number];
    weaponDrop: string;
    armorDrop: string;
    rareDropChance: number;
    homeMapKey: RaidMapKey;
    homeMapLabel: string;
    spawnSharePct: number;
    traits: BossTraitKey[];
    phases: BossPhase[];
};

export type RaidMapConfig = {
    key: RaidMapKey;
    label: string;
    difficulty: RaidDifficulty;
    helpSummary: string;
    description: string;
    lootTier: string;
    recommendedTension: "low" | "medium" | "high";
    successDelta: number;
    tokenMultiplierDelta: number;
    xpMultiplier: number;
    lootGearChanceBonus: number;
    resourceChanceBonus: number;
    legendaryChanceBonus: number;
    fnCoinChanceBonus: number;
    bossName: string;
    bossSpawnChance: number;
    bossSuccessPenalty: number;
    bossKillPenalty: number;
    bossRaidPressure: number;
    bossBonusXpRange: [number, number];
    bossPool: BossVariant[];
    successWeapons: string[];
    failureWeapons: string[];
    successArmor: string[];
    failureArmor: string[];
    bossKit: { weaponId: string; armorId: string };
    scrapBonus: number;
    bonusLootPool: Array<{ id: string; weight: number }>;
    crateDropTable: Array<{ id: string; weight: number }>;
    bossCrateDropTable: Array<{ id: string; weight: number }>;
};

export type RaidLootTuning = {
    successBaseRolls: number;
    successHighTensionBonusRolls: number;
    successHardMapBonusRolls: number;
    failureBaseRolls: number;
    gearSuccessBaseChance: number;
    gearFailureChance: number;
    fnCoinBaseChance: number;
    relicBaseChance: number;
    crateBaseChance: number;
    ultraRareBaseChance: number;
    bossUltraRareBonusChance: number;
};

export const RAID_LOOT_TUNING_BY_DIFFICULTY: Record<RaidDifficulty, RaidLootTuning> = {
    Beginner: { successBaseRolls: 1, successHighTensionBonusRolls: 1, successHardMapBonusRolls: 0, failureBaseRolls: 1, gearSuccessBaseChance: 0.18, gearFailureChance: 0.06, fnCoinBaseChance: 0.006, relicBaseChance: 0.018, crateBaseChance: 0.026, ultraRareBaseChance: 0.0003, bossUltraRareBonusChance: 0.0028 },
    Mid: { successBaseRolls: 1, successHighTensionBonusRolls: 1, successHardMapBonusRolls: 0, failureBaseRolls: 1, gearSuccessBaseChance: 0.22, gearFailureChance: 0.08, fnCoinBaseChance: 0.009, relicBaseChance: 0.024, crateBaseChance: 0.035, ultraRareBaseChance: 0.00075, bossUltraRareBonusChance: 0.0035 },
    Hard: { successBaseRolls: 1, successHighTensionBonusRolls: 1, successHardMapBonusRolls: 1, failureBaseRolls: 1, gearSuccessBaseChance: 0.26, gearFailureChance: 0.1, fnCoinBaseChance: 0.012, relicBaseChance: 0.03, crateBaseChance: 0.042, ultraRareBaseChance: 0.0014, bossUltraRareBonusChance: 0.0042 },
    Elite: { successBaseRolls: 2, successHighTensionBonusRolls: 1, successHardMapBonusRolls: 1, failureBaseRolls: 1, gearSuccessBaseChance: 0.29, gearFailureChance: 0.11, fnCoinBaseChance: 0.014, relicBaseChance: 0.034, crateBaseChance: 0.052, ultraRareBaseChance: 0.0019, bossUltraRareBonusChance: 0.0049 },
    Brutal: { successBaseRolls: 2, successHighTensionBonusRolls: 1, successHardMapBonusRolls: 1, failureBaseRolls: 1, gearSuccessBaseChance: 0.31, gearFailureChance: 0.115, fnCoinBaseChance: 0.016, relicBaseChance: 0.039, crateBaseChance: 0.06, ultraRareBaseChance: 0.0023, bossUltraRareBonusChance: 0.0054 },
    Cataclysmic: { successBaseRolls: 2, successHighTensionBonusRolls: 2, successHardMapBonusRolls: 1, failureBaseRolls: 1, gearSuccessBaseChance: 0.34, gearFailureChance: 0.12, fnCoinBaseChance: 0.018, relicBaseChance: 0.044, crateBaseChance: 0.075, ultraRareBaseChance: 0.003, bossUltraRareBonusChance: 0.0062 }
};

function pickOne<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeightedEntry<T extends { weight: number }>(arr: T[]): T {
    const eligible = arr.filter(entry => entry.weight > 0);
    if (!eligible.length) return arr[0];
    const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of eligible) {
        roll -= entry.weight;
        if (roll <= 0) return entry;
    }
    return eligible[eligible.length - 1];
}

export function isAdvancedRaidDifficulty(difficulty: RaidDifficulty): boolean {
    return difficulty !== "Beginner" && difficulty !== "Mid";
}

export const RAID_MAPS: Record<RaidMapKey, RaidMapConfig> = {
    plagued_cemetary: {
        key: "plagued_cemetary", label: "FN Plagued Cemetery", difficulty: "Beginner", helpSummary: "Beginner map, higher extraction odds, low-mid loot.", description: "Beginner route with calmer extraction lanes and low-mid tier loot opportunities.", lootTier: "Low to Mid", recommendedTension: "low", successDelta: 0.12, tokenMultiplierDelta: -0.12, xpMultiplier: 0.88, lootGearChanceBonus: -0.08, resourceChanceBonus: 0.03, legendaryChanceBonus: -0.025, fnCoinChanceBonus: -0.02, bossName: "The Grave Warden", bossSpawnChance: 0.05, bossSuccessPenalty: 0.05, bossKillPenalty: 0.06, bossRaidPressure: 0.01, bossBonusXpRange: [24, 52],
        bossPool: [
            { name: "The Grave Warden", title: "Crypt Marshal", ferocity: 0.7, successPenalty: 0.03, killPenalty: 0.05, raidPressure: 0.012, bonusXpRange: [28, 58], tokenRewardRange: [18, 42], weaponDrops: ["marksman_dmr", "scav_smg"], armorDrops: ["guardian_plate", "storm_shell"], rareDropChance: 0.08 },
            { name: "Sister Vell", title: "Bone Oracle", ferocity: 0.82, successPenalty: 0.04, killPenalty: 0.06, raidPressure: 0.013, bonusXpRange: [36, 72], tokenRewardRange: [26, 58], weaponDrops: ["thermal_lance", "marksman_dmr"], armorDrops: ["shadow_cloak", "guardian_plate"], rareDropChance: 0.1 },
            { name: "Morrow Fang", title: "Pit Reaper", ferocity: 0.9, successPenalty: 0.05, killPenalty: 0.07, raidPressure: 0.015, bonusXpRange: [48, 86], tokenRewardRange: [30, 66], weaponDrops: ["mythic_hammer", "plasma_carbine"], armorDrops: ["adaptive_mesh", "juggernaut_frame"], rareDropChance: 0.12 }
        ],
        successWeapons: ["rust_blade", "combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr"], failureWeapons: ["rust_blade", "combat_knife", "scav_smg"], successArmor: ["field_vest", "scout_weave", "tactical_armor", "guardian_plate", "storm_shell"], failureArmor: ["field_vest", "scout_weave", "tactical_armor"], bossKit: { weaponId: "marksman_dmr", armorId: "guardian_plate" }, scrapBonus: 2, bonusLootPool: [{ id: "field_ration", weight: 8 }, { id: "common_crate", weight: 3 }, { id: "rare_material_small", weight: 6 }, { id: "tactical_blueprint", weight: 2 }], crateDropTable: [{ id: "tactical_crate", weight: 1 }], bossCrateDropTable: [{ id: "tactical_crate", weight: 1 }]
    },
    slaughterhouse: {
        key: "slaughterhouse", label: "FN Slaughterhouse", difficulty: "Mid", helpSummary: "Mid map, harder extracts, better loot spread, 10% boss spawn.", description: "Mid-tier combat map with harder extractions, stronger loot spread, and a 10% boss spawn chance.", lootTier: "Mid to High", recommendedTension: "medium", successDelta: -0.04, tokenMultiplierDelta: 0.14, xpMultiplier: 1.16, lootGearChanceBonus: 0.07, resourceChanceBonus: 0.08, legendaryChanceBonus: 0.03, fnCoinChanceBonus: 0.012, bossName: "Butcher Prime", bossSpawnChance: 0.12, bossSuccessPenalty: 0.09, bossKillPenalty: 0.1, bossRaidPressure: 0.013, bossBonusXpRange: [60, 120],
        bossPool: [
            { name: "Butcher Prime", title: "Arena Tyrant", ferocity: 1.05, successPenalty: 0.06, killPenalty: 0.08, raidPressure: 0.016, bonusXpRange: [70, 132], tokenRewardRange: [48, 92], weaponDrops: ["mythic_hammer", "thermal_lance"], armorDrops: ["juggernaut_frame", "void_shield"], rareDropChance: 0.16 },
            { name: "Shardjaw", title: "Steel Maw", ferocity: 1.12, successPenalty: 0.07, killPenalty: 0.09, raidPressure: 0.018, bonusXpRange: [84, 156], tokenRewardRange: [56, 108], weaponDrops: ["rail_sniper", "plasma_carbine"], armorDrops: ["adaptive_mesh", "aegis_exosuit"], rareDropChance: 0.2 },
            { name: "Hexline Rook", title: "Execution Marshal", ferocity: 1.2, successPenalty: 0.08, killPenalty: 0.1, raidPressure: 0.02, bonusXpRange: [92, 168], tokenRewardRange: [62, 118], weaponDrops: ["reactor_blade", "rail_sniper"], armorDrops: ["titan_carapace", "aegis_exosuit"], rareDropChance: 0.22 }
        ],
        successWeapons: ["combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer"], failureWeapons: ["rust_blade", "combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr"], successArmor: ["scout_weave", "tactical_armor", "guardian_plate", "storm_shell", "shadow_cloak", "void_shield", "adaptive_mesh", "juggernaut_frame"], failureArmor: ["field_vest", "scout_weave", "tactical_armor", "guardian_plate", "storm_shell"], bossKit: { weaponId: "mythic_hammer", armorId: "juggernaut_frame" }, scrapBonus: 5, bonusLootPool: [{ id: "weapon_bolts", weight: 7 }, { id: "repair_kit", weight: 5 }, { id: "rare_crate", weight: 2 }, { id: "reactor_matrix", weight: 2 }], crateDropTable: [{ id: "tactical_crate", weight: 1 }], bossCrateDropTable: [{ id: "tactical_crate", weight: 1 }]
    },
    boogerswoodz: {
        key: "boogerswoodz", label: "FN BoogersWoodZ", difficulty: "Hard", helpSummary: "Hard map, premium loot tables, harder boss pressure.", description: "Highest-risk territory with elite loot tables, brutal extraction odds, and harder bosses.", lootTier: "High to Legendary", recommendedTension: "high", successDelta: -0.16, tokenMultiplierDelta: 0.28, xpMultiplier: 1.34, lootGearChanceBonus: 0.14, resourceChanceBonus: 0.12, legendaryChanceBonus: 0.07, fnCoinChanceBonus: 0.04, bossName: "Booger King Omega", bossSpawnChance: 0.26, bossSuccessPenalty: 0.16, bossKillPenalty: 0.2, bossRaidPressure: 0.016, bossBonusXpRange: [140, 260],
        bossPool: [
            { name: "Booger King Omega", title: "Apex Monstrosity", ferocity: 1.4, successPenalty: 0.1, killPenalty: 0.12, raidPressure: 0.022, bonusXpRange: [160, 280], tokenRewardRange: [120, 210], weaponDrops: ["reactor_blade", "rail_sniper"], armorDrops: ["titan_carapace", "aegis_exosuit"], rareDropChance: 0.28 },
            { name: "Queen Sumphex", title: "Rot Sovereign", ferocity: 1.55, successPenalty: 0.12, killPenalty: 0.14, raidPressure: 0.024, bonusXpRange: [190, 320], tokenRewardRange: [140, 245], weaponDrops: ["reactor_blade", "mythic_hammer"], armorDrops: ["titan_carapace", "adaptive_mesh"], rareDropChance: 0.34 },
            { name: "Warlord Nullhide", title: "Void Cannoneer", ferocity: 1.68, successPenalty: 0.14, killPenalty: 0.16, raidPressure: 0.026, bonusXpRange: [220, 360], tokenRewardRange: [160, 290], weaponDrops: ["rail_sniper", "plasma_carbine", "enhanced_plasma_carbine"], armorDrops: ["aegis_exosuit", "titan_carapace"], rareDropChance: 0.38 }
        ],
        successWeapons: ["ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade"], failureWeapons: ["combat_knife", "scav_smg", "pulse_rifle", "marksman_dmr", "ion_cannon"], successArmor: ["void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace"], failureArmor: ["tactical_armor", "guardian_plate", "storm_shell", "shadow_cloak", "void_shield"], bossKit: { weaponId: "reactor_blade", armorId: "titan_carapace" }, scrapBonus: 8, bonusLootPool: [{ id: "servo_motor", weight: 6 }, { id: "nanofiber_roll", weight: 4 }, { id: "black_ice_lens", weight: 2 }, { id: "epic_crate", weight: 2 }, { id: "spectral_fiber", weight: 2 }], crateDropTable: [{ id: "tactical_crate", weight: 1 }, { id: "mythic_crate", weight: 3 }], bossCrateDropTable: [{ id: "tactical_crate", weight: 1 }, { id: "mythic_crate", weight: 4 }]
    },
    megayachtolopolis: {
        key: "megayachtolopolis", label: "FN MegaYachtolopolis", difficulty: "Elite", helpSummary: "Elite yacht city, luxury-tech loot, punishing CQB bosses.", description: "Skyline-sized superyacht district packed with luxury-tech vaults, tight interior kill lanes, and brutal command deck extracts.", lootTier: "Luxury Tech / High-End", recommendedTension: "high", successDelta: -0.145, tokenMultiplierDelta: 0.31, xpMultiplier: 1.42, lootGearChanceBonus: 0.17, resourceChanceBonus: 0.15, legendaryChanceBonus: 0.085, fnCoinChanceBonus: 0.045, bossName: "Dreadwake Morvane", bossSpawnChance: 0.29, bossSuccessPenalty: 0.18, bossKillPenalty: 0.22, bossRaidPressure: 0.019, bossBonusXpRange: [210, 360],
        bossPool: [
            { name: "Dreadwake Morvane", title: "Hull Reaper", ferocity: 1.82, successPenalty: 0.15, killPenalty: 0.18, raidPressure: 0.03, bonusXpRange: [250, 390], tokenRewardRange: [180, 320], weaponDrops: ["reactor_blade", "rail_sniper", "enhanced_rail_sniper"], armorDrops: ["titan_carapace", "aegis_exosuit"], rareDropChance: 0.42 }
        ],
        successWeapons: ["ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade"], failureWeapons: ["pulse_rifle", "marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine"], successArmor: ["void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace"], failureArmor: ["guardian_plate", "storm_shell", "shadow_cloak", "void_shield", "adaptive_mesh"], bossKit: { weaponId: "reactor_blade", armorId: "titan_carapace" }, scrapBonus: 9, bonusLootPool: [{ id: "encrypted_chip", weight: 12 }, { id: "nanofiber_roll", weight: 9 }, { id: "black_ice_lens", weight: 4 }, { id: "legendary_token", weight: 3 }, { id: "tactical_crate", weight: 3 }, { id: "quantum_logbook", weight: 3 }], crateDropTable: [{ id: "epic_crate", weight: 1 }, { id: "tactical_crate", weight: 3 }, { id: "mythic_crate", weight: 2 }], bossCrateDropTable: [{ id: "tactical_crate", weight: 2 }, { id: "mythic_crate", weight: 3 }]
    },
    warlords_warcamp: {
        key: "warlords_warcamp", label: "FN Warlords Warcamp", difficulty: "Brutal", helpSummary: "Brutal trench map, war salvage jackpots, relentless field pressure.", description: "Fortified trench sprawl where roaming commanders, artillery scars, and open kill boxes crush sloppy pushes.", lootTier: "War Salvage / High-End", recommendedTension: "high", successDelta: -0.155, tokenMultiplierDelta: 0.34, xpMultiplier: 1.48, lootGearChanceBonus: 0.19, resourceChanceBonus: 0.17, legendaryChanceBonus: 0.09, fnCoinChanceBonus: 0.05, bossName: "Kraghoss the Ashen Standard", bossSpawnChance: 0.31, bossSuccessPenalty: 0.19, bossKillPenalty: 0.23, bossRaidPressure: 0.021, bossBonusXpRange: [240, 390],
        bossPool: [
            { name: "Kraghoss the Ashen Standard", title: "Siegeblood Khan", ferocity: 1.96, successPenalty: 0.17, killPenalty: 0.2, raidPressure: 0.033, bonusXpRange: [290, 430], tokenRewardRange: [220, 360], weaponDrops: ["mythic_hammer", "plasma_carbine", "enhanced_thermal_lance"], armorDrops: ["aegis_exosuit", "juggernaut_frame"], rareDropChance: 0.46 }
        ],
        successWeapons: ["thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade"], failureWeapons: ["marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer"], successArmor: ["adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace"], failureArmor: ["storm_shell", "shadow_cloak", "void_shield", "adaptive_mesh", "juggernaut_frame"], bossKit: { weaponId: "mythic_hammer", armorId: "aegis_exosuit" }, scrapBonus: 10, bonusLootPool: [{ id: "weapon_bolts", weight: 12 }, { id: "servo_motor", weight: 10 }, { id: "combat_stim", weight: 8 }, { id: "relic_fragment", weight: 4 }, { id: "tactical_crate", weight: 4 }, { id: "mythic_crate", weight: 1 }, { id: "warbond_chip", weight: 2 }], crateDropTable: [{ id: "epic_crate", weight: 1 }, { id: "tactical_crate", weight: 3 }, { id: "mythic_crate", weight: 2 }], bossCrateDropTable: [{ id: "tactical_crate", weight: 2 }, { id: "mythic_crate", weight: 4 }]
    },
    sunken_village: {
        key: "sunken_village", label: "FN SUNKEN VILLAGE", difficulty: "Cataclysmic", helpSummary: "Cataclysmic ruins, varied crate economy, drowned apex boss.", description: "Flood-choked ruins with submerged cache routes, ambush angles, and crate-rich shrines that reward disciplined clears.", lootTier: "Crate Dense / Legendary", recommendedTension: "high", successDelta: -0.135, tokenMultiplierDelta: 0.3, xpMultiplier: 1.44, lootGearChanceBonus: 0.16, resourceChanceBonus: 0.14, legendaryChanceBonus: 0.095, fnCoinChanceBonus: 0.055, bossName: "Thalrex Mourntide", bossSpawnChance: 0.33, bossSuccessPenalty: 0.2, bossKillPenalty: 0.24, bossRaidPressure: 0.023, bossBonusXpRange: [270, 430],
        bossPool: [
            { name: "Thalrex Mourntide", title: "Drowned Godspeaker", ferocity: 2.08, successPenalty: 0.19, killPenalty: 0.22, raidPressure: 0.036, bonusXpRange: [340, 520], tokenRewardRange: [260, 420], weaponDrops: ["rail_sniper", "reactor_blade", "enhanced_reactor_blade", "enhanced_starforged_reaper"], armorDrops: ["titan_carapace", "adaptive_mesh"], rareDropChance: 0.5 }
        ],
        successWeapons: ["ion_cannon", "thermal_lance", "plasma_carbine", "mythic_hammer", "rail_sniper", "reactor_blade"], failureWeapons: ["marksman_dmr", "ion_cannon", "thermal_lance", "plasma_carbine", "rail_sniper"], successArmor: ["void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit", "titan_carapace"], failureArmor: ["shadow_cloak", "void_shield", "adaptive_mesh", "juggernaut_frame", "aegis_exosuit"], bossKit: { weaponId: "rail_sniper", armorId: "titan_carapace" }, scrapBonus: 7, bonusLootPool: [{ id: "common_crate", weight: 7 }, { id: "rare_crate", weight: 8 }, { id: "epic_crate", weight: 6 }, { id: "tactical_crate", weight: 4 }, { id: "mythic_crate", weight: 2 }, { id: "scav_beacon", weight: 6 }, { id: "relic_fragment", weight: 4 }, { id: "mythic_circuit", weight: 2 }], crateDropTable: [{ id: "common_crate", weight: 4 }, { id: "rare_crate", weight: 5 }, { id: "epic_crate", weight: 5 }, { id: "tactical_crate", weight: 4 }, { id: "mythic_crate", weight: 3 }], bossCrateDropTable: [{ id: "rare_crate", weight: 2 }, { id: "epic_crate", weight: 3 }, { id: "tactical_crate", weight: 4 }, { id: "mythic_crate", weight: 5 }]
    }
};

export const RAID_MAP_CHOICES = Object.values(RAID_MAPS).map(map => ({ name: map.label, value: map.key }));
export const RAID_DIFFICULTY_ORDER: RaidDifficulty[] = ["Beginner", "Mid", "Hard", "Elite", "Brutal", "Cataclysmic"];
export const RAID_MAP_SHORT_LABELS: Record<RaidMapKey, string> = { plagued_cemetary: "CEM", slaughterhouse: "SLH", boogerswoodz: "BGZ", megayachtolopolis: "MYO", warlords_warcamp: "WWC", sunken_village: "SVL" };
export const RAID_BOSS_ROSTER: BossRosterEntry[] = Object.values(RAID_MAPS).flatMap(mapCfg => mapCfg.bossPool.map(boss => ({ ...boss, homeMapKey: mapCfg.key, homeMapLabel: mapCfg.label, homeMapDifficulty: mapCfg.difficulty })));

export function getRaidDifficultyIndex(difficulty: RaidDifficulty): number {
    const idx = RAID_DIFFICULTY_ORDER.indexOf(difficulty);
    return idx >= 0 ? idx : 0;
}

export function getBossRotationWeight(boss: BossRosterEntry, mapCfg: RaidMapConfig): number {
    const difficultyDistance = Math.abs(getRaidDifficultyIndex(boss.homeMapDifficulty) - getRaidDifficultyIndex(mapCfg.difficulty));
    const sameMapBonus = boss.homeMapKey === mapCfg.key ? 8 : 0;
    const sameDifficultyBonus = boss.homeMapDifficulty === mapCfg.difficulty ? 3 : 0;
    const distanceBonus = Math.max(0, 4 - difficultyDistance);
    const ferocityBias = Math.max(1, Math.round(boss.ferocity * 1.8));
    return Math.max(1, sameMapBonus + sameDifficultyBonus + distanceBonus + ferocityBias);
}

export function getBossRotationTable(mapCfg: RaidMapConfig): Array<{ boss: BossRosterEntry; weight: number; sharePct: number }> {
    const weighted = RAID_BOSS_ROSTER.map(boss => ({ boss, weight: getBossRotationWeight(boss, mapCfg) }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    return weighted.map(entry => ({ ...entry, sharePct: Math.round((entry.weight / total) * 1000) / 10 }));
}

export function formatBossRotationShares(boss: BossRosterEntry): string {
    return Object.values(RAID_MAPS).map(mapCfg => {
        const tableEntry = getBossRotationTable(mapCfg).find(entry => entry.boss.name === boss.name);
        const share = tableEntry?.sharePct ?? 0;
        return `${RAID_MAP_SHORT_LABELS[mapCfg.key]} ${share.toFixed(1)}%`;
    }).join(" | ");
}

export function resolveRaidMap(mapKeyRaw?: string | null): RaidMapConfig {
    const key = (mapKeyRaw || "plagued_cemetary") as RaidMapKey;
    return RAID_MAPS[key] || RAID_MAPS.plagued_cemetary;
}

export function mapProjection(mapCfg: RaidMapConfig, tension: "low" | "medium" | "high"): {
    successPct: number;
    tokenMultiplier: number;
    xpBand: [number, number];
    expectedNetAt100: number;
    expectedBossBonusXp: number;
    bossKitDropChancePct: number;
} {
    const base = {
        low: { successChance: 0.8, tokenMultiplier: 1.15, xp: [14, 30] as [number, number] },
        medium: { successChance: 0.56, tokenMultiplier: 1.6, xp: [22, 54] as [number, number] },
        high: { successChance: 0.33, tokenMultiplier: 2.38, xp: [38, 88] as [number, number] }
    } as const;
    const avgConditionSuccessDelta = -0.0167;
    const avgConditionTokenDelta = 0.075;
    const bossExpectedPenalty = mapCfg.bossSpawnChance * (mapCfg.bossSuccessPenalty + mapCfg.bossRaidPressure);
    const tensionBossDelta = tension === "high" ? 0.08 : tension === "low" ? -0.03 : 0;
    const baselineBossKillChance = Math.max(0.12, Math.min(0.88, 0.4 + tensionBossDelta - mapCfg.bossKillPenalty - mapCfg.bossRaidPressure * 0.5));
    const avgBossBonusXp = Math.round((mapCfg.bossBonusXpRange[0] + mapCfg.bossBonusXpRange[1]) / 2);
    const successPct = Math.round(Math.max(0.06, Math.min(0.93, base[tension].successChance + mapCfg.successDelta + avgConditionSuccessDelta - bossExpectedPenalty)) * 100);
    const tokenMultiplier = Math.max(0.7, base[tension].tokenMultiplier + mapCfg.tokenMultiplierDelta + avgConditionTokenDelta);
    const xpBand: [number, number] = [Math.max(1, Math.floor(base[tension].xp[0] * mapCfg.xpMultiplier)), Math.max(1, Math.floor(base[tension].xp[1] * mapCfg.xpMultiplier))];
    const successProb = successPct / 100;
    const expectedOutcomeTokens = 17;
    const bet = 100;
    const expectedNetAt100 = Math.round((successProb * bet * tokenMultiplier) + expectedOutcomeTokens - bet);
    const expectedBossBonusXp = Math.round(successProb * mapCfg.bossSpawnChance * baselineBossKillChance * avgBossBonusXp);
    const bossKitDropChancePct = Math.round(successProb * mapCfg.bossSpawnChance * baselineBossKillChance * 100);
    return { successPct, tokenMultiplier, xpBand, expectedNetAt100, expectedBossBonusXp, bossKitDropChancePct };
}

export type GearTrait = {
    successBonus?: number;
    tokenBonus?: number;
    xpBonus?: number;
    conditionSuccess?: Partial<Record<RaidConditionKey, number>>;
    conditionImmunity?: RaidConditionKey[];
    note?: string;
};

export function hasConditionImmunity(trait: GearTrait | undefined, conditionKey: RaidConditionKey): boolean {
    return Boolean(trait?.conditionImmunity?.includes(conditionKey));
}

export const WEAPON_TRAITS: Partial<Record<string, GearTrait>> = {
    scav_smg: { successBonus: 0.01, conditionSuccess: { urban: 0.02, night: 0.01 }, note: "CQC burst boost in urban/night raids." },
    marksman_dmr: { successBonus: 0.012, conditionSuccess: { fog: 0.01, night: 0.012 }, note: "Precision optics maintain control in low visibility." },
    thermal_lance: { successBonus: 0.014, conditionSuccess: { storm: 0.02, heatwave: 0.018 }, note: "Thermal feed resists weather penalties." },
    plasma_carbine: { successBonus: 0.013, tokenBonus: 0.03, note: "Stable output improves reward consistency." },
    rail_sniper: { successBonus: 0.017, conditionSuccess: { fog: -0.012, urban: -0.008 }, tokenBonus: 0.04, note: "High value picks, weaker in cluttered zones." },
    reactor_blade: { successBonus: 0.016, conditionSuccess: { urban: 0.02, night: 0.018 }, xpBonus: 0.05, note: "Aggressive melee profile boosts raid XP." },
    scrap_shotgun: { successBonus: 0.006, conditionSuccess: { urban: 0.012 }, note: "Close-range spread helps in collapsed interiors." },
    breach_pistol: { tokenBonus: 0.01, conditionSuccess: { urban: 0.008, night: 0.008 }, note: "Fast clears preserve value on short routes." },
    hush_repeater: { successBonus: 0.007, conditionSuccess: { fog: 0.008, night: 0.008 }, note: "Low signature profile rewards patient scouting." },
    arc_rifle: { successBonus: 0.009, conditionSuccess: { radiation: 0.012 }, note: "Charged rounds hold shape in contaminated sectors." },
    volt_smg: { successBonus: 0.01, conditionSuccess: { urban: 0.014 }, note: "High cycle rate dominates close-quarter lane fights." },
    dune_cutter: { successBonus: 0.008, conditionSuccess: { heatwave: 0.012 }, xpBonus: 0.02, note: "Heat-resistant platform improves desert-route tempo." },
    widowmaker_dmr: { successBonus: 0.011, conditionSuccess: { fog: 0.01 }, note: "Stable optics tighten medium-risk engagements." },
    magma_caster: { tokenBonus: 0.02, conditionSuccess: { storm: 0.01, heatwave: 0.014 }, note: "Thermal cast improves payout consistency in violent weather." },
    echo_lancer: { successBonus: 0.012, conditionSuccess: { night: 0.012, radiation: 0.008 }, note: "Echo tracing sharpens blind pushes through pressure zones." },
    grav_pike: { successBonus: 0.011, conditionSuccess: { urban: 0.014 }, xpBonus: 0.03, note: "Heavy impact tool rewards decisive route finishes." },
    venom_flechette: { successBonus: 0.013, tokenBonus: 0.015, note: "Armor-chewing flechettes raise lootable takedown odds." },
    rift_carbine: { successBonus: 0.012, conditionSuccess: { storm: 0.008, fog: 0.008, radiation: 0.008 }, note: "Distortion rails smooth out unstable combat conditions." },
    obsidian_repeater: { successBonus: 0.014, tokenBonus: 0.02, conditionSuccess: { fog: -0.006 }, note: "Premium action improves returns when sightlines stay open." },
    siege_cannon: { successBonus: 0.013, conditionSuccess: { urban: -0.01, radiation: 0.014 }, note: "High payload punishes crowded kill boxes but thrives in open collapse zones." },
    frostfang_rifle: { successBonus: 0.014, conditionSuccess: { storm: 0.012, night: 0.01 }, note: "Cryo-lined action stays controlled in unstable fronts." },
    stormpiercer: { successBonus: 0.015, tokenBonus: 0.02, conditionSuccess: { storm: 0.016 }, note: "Tempest bore punches through weather penalties for high-value runs." },
    aurora_smg: { successBonus: 0.011, conditionSuccess: { urban: 0.015, low_power: 0.01 }, note: "Reactive burst profile keeps urban clears fast and efficient." },
    basilisk_dmr: { successBonus: 0.013, tokenBonus: 0.015, conditionSuccess: { fog: 0.01, crosswind: 0.01 }, note: "Stabilized heavy DMR converts medium-long fights more reliably." },
    overclock_minigun: { successBonus: 0.014, tokenBonus: 0.02, conditionSuccess: { urban: -0.01, radiation: 0.014 }, note: "Rotary overclock dominates open lanes but struggles in tight choke points." },
    nebula_glaive: { successBonus: 0.017, conditionSuccess: { night: 0.016, ashfall: 0.012 }, xpBonus: 0.035, note: "Mythic grav-edge melee weapon rewards high-skill close finishes." },
    nullburst_launcher: { successBonus: 0.017, tokenBonus: 0.025, conditionSuccess: { radiation: 0.018 }, note: "Anomaly discharge rewards contaminated-zone clears." },
    phantom_scythe: { successBonus: 0.016, conditionSuccess: { urban: 0.018, night: 0.016 }, xpBonus: 0.04, note: "Stealth apex blade rewards clean assassinations and fast extracts." },
    sunflare_accelerator: { successBonus: 0.018, tokenBonus: 0.025, conditionSuccess: { heatwave: 0.02 }, note: "Solar surge weapon turns thermal pressure into higher-value wins." },
    starforged_reaper: { successBonus: 0.019, conditionSuccess: { night: 0.012, radiation: 0.014 }, xpBonus: 0.05, note: "Ultra-rare apex weapon with elite late-raid conversion power." },
    enhanced_pulse_rifle: { successBonus: 0.016, tokenBonus: 0.012, conditionSuccess: { urban: 0.012, low_power: 0.01 }, note: "Enhanced pulse routing improves combat stability in contested lanes." },
    enhanced_marksman_dmr: { successBonus: 0.018, tokenBonus: 0.015, conditionSuccess: { fog: 0.016, night: 0.015 }, note: "Enhanced optic package sharply improves low-visibility takedowns." },
    enhanced_thermal_lance: { successBonus: 0.021, tokenBonus: 0.018, conditionSuccess: { storm: 0.018, heatwave: 0.022 }, note: "Enhanced thermal conduits turn hazard pressure into offensive uptime." },
    enhanced_plasma_carbine: { successBonus: 0.022, tokenBonus: 0.02, xpBonus: 0.02, conditionSuccess: { crosswind: 0.012 }, note: "Enhanced plasma stabilization sustains high-value output through disruption." },
    enhanced_rail_sniper: { successBonus: 0.025, tokenBonus: 0.024, conditionSuccess: { fog: -0.008, urban: -0.006, low_power: 0.014 }, note: "Enhanced long-range rig amplifies precision and extraction economics." },
    enhanced_reactor_blade: { successBonus: 0.026, tokenBonus: 0.019, xpBonus: 0.035, conditionSuccess: { urban: 0.02, night: 0.02 }, note: "Enhanced reactor edge massively rewards close-quarter domination." },
    enhanced_nullburst_launcher: { successBonus: 0.027, tokenBonus: 0.028, conditionSuccess: { radiation: 0.022, ashfall: 0.016 }, note: "Enhanced anomaly launcher excels in severe environment raids." },
    enhanced_starforged_reaper: { successBonus: 0.03, tokenBonus: 0.03, xpBonus: 0.05, conditionSuccess: { storm: 0.016, radiation: 0.02, night: 0.016 }, note: "Apex-enhanced starforged platform defines top-end raid conversion power." }
};

export const ARMOR_TRAITS: Partial<Record<string, GearTrait>> = {
    scout_weave: { successBonus: 0.01, conditionSuccess: { urban: 0.012, heatwave: 0.01 }, note: "Light mobility armor improves route tempo." },
    storm_shell: { successBonus: 0.008, conditionSuccess: { storm: 0.02, radiation: 0.008 }, conditionImmunity: ["drizzle"], note: "Sealed plating mitigates weather hazards." },
    shadow_cloak: { successBonus: 0.011, conditionSuccess: { night: 0.02, fog: 0.014 }, conditionImmunity: ["night"], note: "Stealth weave excels in low visibility." },
    juggernaut_frame: { tokenBonus: 0.04, conditionSuccess: { heatwave: -0.016, urban: -0.01 }, note: "Heavy frame lowers mobility but tanks incoming damage." },
    adaptive_mesh: { successBonus: 0.009, conditionSuccess: { storm: 0.01, fog: 0.01, night: 0.01, heatwave: 0.01, urban: 0.01, radiation: 0.01 }, note: "Adaptive mesh grants all-condition stability." },
    titan_carapace: { tokenBonus: 0.06, conditionSuccess: { heatwave: -0.012 }, xpBonus: 0.04, note: "Max mitigation with slight thermal drag." },
    patchwork_rig: { successBonus: 0.004, conditionSuccess: { urban: 0.008 }, note: "Cheap rig that holds together in close-quarter scraps." },
    breacher_webbing: { successBonus: 0.005, tokenBonus: 0.008, note: "Light webbing keeps room clears efficient." },
    fogrunner_wrap: { successBonus: 0.006, conditionSuccess: { fog: 0.012 }, note: "Low-visibility fabric helps retain initiative in mist." },
    arcskin_vest: { successBonus: 0.006, conditionSuccess: { radiation: 0.012 }, note: "Insulated weave reduces contaminated-zone drag." },
    warden_harness: { successBonus: 0.007, conditionSuccess: { urban: 0.01 }, note: "Balanced harness improves route stability in dense sectors." },
    emberguard_mail: { successBonus: 0.007, conditionSuccess: { heatwave: 0.012 }, note: "Thermal mesh smooths heatwave penalties." },
    coastwatch_shell: { successBonus: 0.008, conditionSuccess: { storm: 0.012 }, conditionImmunity: ["storm"], note: "Sealed shell maintains structure through unstable weather." },
    nomad_carbon: { successBonus: 0.008, conditionSuccess: { urban: 0.01, crosswind: 0.01 }, note: "Lightweight carbon shell supports mobile extractions." },
    nightglass_cloak: { successBonus: 0.009, conditionSuccess: { night: 0.016, fog: 0.012 }, conditionImmunity: ["fog"], note: "High-end stealth cloak sharpens dark-route survivability." },
    bulwark_plating: { tokenBonus: 0.015, conditionSuccess: { urban: -0.008 }, note: "Dense plates improve payout protection at a mobility cost." },
    shockframe_suit: { successBonus: 0.008, tokenBonus: 0.01, conditionSuccess: { radiation: 0.01 }, note: "Powered frame keeps pressure controlled in hazard zones." },
    gravebark_mesh: { successBonus: 0.009, conditionSuccess: { night: 0.01, storm: 0.008 }, note: "Reactive mesh steadies dark-weather pathing." },
    riftguard_coat: { successBonus: 0.008, xpBonus: 0.02, conditionSuccess: { storm: 0.008, fog: 0.008 }, note: "Anomaly-lined coat helps convert difficult clears into experience." },
    bastion_weave: { successBonus: 0.009, tokenBonus: 0.012, conditionSuccess: { radiation: 0.008, low_power: 0.01 }, note: "Fortified weave improves consistency in disrupted sectors." },
    siegebreaker_plate: { tokenBonus: 0.02, conditionSuccess: { urban: -0.006, radiation: 0.012 }, note: "Assault plate improves survival value on punishing pushes." },
    hollowbastion: { successBonus: 0.01, conditionSuccess: { night: 0.008, radiation: 0.008 }, note: "Void-lined shell adds steady resilience across deep zones." },
    stormforged_aegis: { successBonus: 0.01, conditionSuccess: { storm: 0.018 }, conditionImmunity: ["crosswind"], note: "Aegis plating turns violent weather into a manageable tax." },
    cryptsteel_exoshell: { tokenBonus: 0.025, conditionSuccess: { night: 0.012, fog: 0.01 }, note: "Cryptsteel shell supports stealthier high-payout routes." },
    leviathan_shell: { successBonus: 0.01, tokenBonus: 0.022, conditionSuccess: { storm: 0.012, ashfall: 0.01 }, note: "Deep-zone shell absorbs harsh environment penalties." },
    tidelock_panoply: { successBonus: 0.011, conditionSuccess: { radiation: 0.014, storm: 0.012 }, conditionImmunity: ["ashfall"], note: "Flood-sealed mythic armor thrives in hostile environmental pressure." },
    dreadnought_cuirass: { tokenBonus: 0.03, conditionSuccess: { heatwave: -0.008, urban: -0.008 }, note: "Slow but stable cuirass protects net value on expensive raids." },
    voidscale_regalia: { successBonus: 0.011, xpBonus: 0.03, conditionSuccess: { fog: 0.014, night: 0.016 }, conditionImmunity: ["low_power"], note: "Ultra-rare regalia rewards flawless stealth extractions." },
    eclipse_ward: { successBonus: 0.012, tokenBonus: 0.026, conditionSuccess: { radiation: 0.012, night: 0.01 }, conditionImmunity: ["crosswind"], note: "Mythic ward frame protects expensive loadouts in severe operations." },
    sovereign_bastion: { successBonus: 0.012, tokenBonus: 0.03, conditionSuccess: { radiation: 0.016 }, conditionImmunity: ["radiation"], note: "Apex bastion armor offers elite resilience without breaking cap limits." }
};

export const RAID_WEAPON_DISCOVERY_TABLE: Array<{ id: string; weight: number }> = [
    { id: "scrap_shotgun", weight: 18 }, { id: "breach_pistol", weight: 18 }, { id: "hush_repeater", weight: 16 }, { id: "arc_rifle", weight: 14 }, { id: "volt_smg", weight: 14 }, { id: "dune_cutter", weight: 13 }, { id: "widowmaker_dmr", weight: 12 }, { id: "aurora_smg", weight: 11 }, { id: "magma_caster", weight: 10 }, { id: "echo_lancer", weight: 10 }, { id: "grav_pike", weight: 9 }, { id: "venom_flechette", weight: 9 }, { id: "rift_carbine", weight: 8 }, { id: "basilisk_dmr", weight: 7 }, { id: "obsidian_repeater", weight: 6 }, { id: "siege_cannon", weight: 5 }, { id: "frostfang_rifle", weight: 5 }, { id: "stormpiercer", weight: 4 }, { id: "overclock_minigun", weight: 4 }, { id: "nullburst_launcher", weight: 3 }, { id: "phantom_scythe", weight: 3 }, { id: "nebula_glaive", weight: 2 }, { id: "sunflare_accelerator", weight: 2 }, { id: "starforged_reaper", weight: 1 }, { id: "enhanced_pulse_rifle", weight: 4 }, { id: "enhanced_marksman_dmr", weight: 3 }, { id: "enhanced_thermal_lance", weight: 3 }, { id: "enhanced_plasma_carbine", weight: 3 }, { id: "enhanced_rail_sniper", weight: 2 }, { id: "enhanced_reactor_blade", weight: 2 }
];
export const RAID_ARMOR_DISCOVERY_TABLE: Array<{ id: string; weight: number }> = [
    { id: "patchwork_rig", weight: 18 }, { id: "breacher_webbing", weight: 18 }, { id: "fogrunner_wrap", weight: 16 }, { id: "arcskin_vest", weight: 15 }, { id: "warden_harness", weight: 14 }, { id: "emberguard_mail", weight: 13 }, { id: "coastwatch_shell", weight: 13 }, { id: "nomad_carbon", weight: 12 }, { id: "nightglass_cloak", weight: 11 }, { id: "bulwark_plating", weight: 10 }, { id: "shockframe_suit", weight: 10 }, { id: "gravebark_mesh", weight: 9 }, { id: "riftguard_coat", weight: 8 }, { id: "bastion_weave", weight: 7 }, { id: "siegebreaker_plate", weight: 6 }, { id: "hollowbastion", weight: 5 }, { id: "stormforged_aegis", weight: 5 }, { id: "cryptsteel_exoshell", weight: 4 }, { id: "leviathan_shell", weight: 4 }, { id: "tidelock_panoply", weight: 3 }, { id: "dreadnought_cuirass", weight: 3 }, { id: "voidscale_regalia", weight: 2 }, { id: "eclipse_ward", weight: 2 }, { id: "sovereign_bastion", weight: 1 }
];
export const RAID_APEX_WEAPON_DISCOVERY_TABLE: Array<{ id: string; weight: number }> = [
    { id: "nullburst_launcher", weight: 3 }, { id: "phantom_scythe", weight: 3 }, { id: "sunflare_accelerator", weight: 2 }, { id: "starforged_reaper", weight: 1 }, { id: "overclock_minigun", weight: 2 }, { id: "nebula_glaive", weight: 2 }, { id: "enhanced_nullburst_launcher", weight: 2 }, { id: "enhanced_starforged_reaper", weight: 1 }
];
export const RAID_APEX_ARMOR_DISCOVERY_TABLE: Array<{ id: string; weight: number }> = [
    { id: "tidelock_panoply", weight: 3 }, { id: "dreadnought_cuirass", weight: 3 }, { id: "voidscale_regalia", weight: 2 }, { id: "leviathan_shell", weight: 2 }, { id: "eclipse_ward", weight: 2 }, { id: "sovereign_bastion", weight: 1 }
];

export function rollRaidCondition(): RaidCondition {
    return RAID_CONDITIONS[Math.floor(Math.random() * RAID_CONDITIONS.length)];
}

export function rollBossVariant(mapCfg: RaidMapConfig): RolledBoss {
    const variant = pickWeightedEntry(getBossRotationTable(mapCfg));
    const combatProfile = getBossCombatProfile(variant.boss.name);
    return {
        name: variant.boss.name,
        title: variant.boss.title,
        ferocity: variant.boss.ferocity,
        successPenalty: variant.boss.successPenalty,
        killPenalty: variant.boss.killPenalty,
        raidPressure: variant.boss.raidPressure,
        bonusXpRange: variant.boss.bonusXpRange,
        tokenRewardRange: variant.boss.tokenRewardRange,
        weaponDrop: pickOne(variant.boss.weaponDrops),
        armorDrop: pickOne(variant.boss.armorDrops),
        rareDropChance: variant.boss.rareDropChance,
        homeMapKey: variant.boss.homeMapKey,
        homeMapLabel: variant.boss.homeMapLabel,
        spawnSharePct: variant.sharePct,
        traits: combatProfile.traits,
        phases: combatProfile.phases
    };
}

export function rollRaidXpGain(tension: string, success: boolean, bet: number, raidMultiplier: number, mapCfg: RaidMapConfig): number {
    const ranges = {
        low: success ? [10, 22] : [4, 10],
        medium: success ? [16, 42] : [6, 16],
        high: success ? [28, 70] : [10, 28]
    } as const;
    const [min, max] = ranges[(tension as keyof typeof ranges)] || ranges.medium;
    const base = Math.floor(Math.random() * (max - min + 1)) + min;
    const betBonus = Math.max(0, Math.floor(bet * (success ? 0.022 : 0.008)));
    return Math.max(1, Math.floor((base + betBonus) * raidMultiplier * mapCfg.xpMultiplier));
}

export const RAID_PMC_XP_SCALE = 0.42;
export const RAID_BOSS_XP_SCALE = 0.5;

export function getPmcXpGainScale(level: number, mapCfg: RaidMapConfig, tension: string, success: boolean): number {
    let levelDrag = 1;
    if (level >= 18000) levelDrag = 0.08;
    else if (level >= 15000) levelDrag = 0.1;
    else if (level >= 12000) levelDrag = 0.125;
    else if (level >= 10000) levelDrag = 0.155;
    else if (level >= 8000) levelDrag = 0.2;
    else if (level >= 6000) levelDrag = 0.26;
    else if (level >= 4000) levelDrag = 0.34;
    else if (level >= 2500) levelDrag = 0.43;
    else if (level >= 1500) levelDrag = 0.53;
    else if (level >= 900) levelDrag = 0.63;
    else if (level >= 500) levelDrag = 0.74;
    else if (level >= 250) levelDrag = 0.84;
    else if (level >= 100) levelDrag = 0.91;
    const mapBonusByDifficulty: Record<RaidDifficulty, number> = { Beginner: 1, Mid: 1.05, Hard: 1.1, Elite: 1.15, Brutal: 1.2, Cataclysmic: 1.24 };
    const mapBonus = success ? mapBonusByDifficulty[mapCfg.difficulty] || 1 : 1;
    const tensionBonus = success ? (tension === "high" ? 1.06 : tension === "medium" ? 1.01 : 0.94) : 0.74;
    return Math.max(0.08, Math.min(1.35, levelDrag * mapBonus * tensionBonus));
}

export const BOSS_REWARD_BALANCE = {
    mapDifficultyMultiplier: { Beginner: 0.82, Mid: 0.95, Hard: 1.08, Elite: 1.18, Brutal: 1.27, Cataclysmic: 1.36 } as const,
    tensionMultiplier: { low: 0.86, medium: 0.94, high: 1.03 } as const,
    tokenCapFloor: 45,
    tokenCapCeiling: 650,
    xpCapFloor: 35,
    xpCapCeiling: 360
};

export function rollBossSuccessRewards(input: {
    bet: number;
    tension: string;
    mapDifficulty: RaidDifficulty;
    bossFerocity: number;
    bonusXpRange: [number, number];
    tokenRewardRange: [number, number];
    combatRewardMultiplier?: number;
}): { bossBonusXp: number; bossTokenBonus: number } {
    const tensionKey = input.tension === "high" ? "high" : input.tension === "low" ? "low" : "medium";
    const mapMult = BOSS_REWARD_BALANCE.mapDifficultyMultiplier[input.mapDifficulty] || 1;
    const tensionMult = BOSS_REWARD_BALANCE.tensionMultiplier[tensionKey] || 1;
    const ferocityMult = Math.max(0.9, Math.min(1.45, 0.86 + input.bossFerocity * 0.35));
    const rollVariance = 0.92 + Math.random() * 0.2;
    const combatRewardMultiplier = Math.max(1, Math.min(1.65, input.combatRewardMultiplier || 1));
    const finalScale = mapMult * tensionMult * ferocityMult * rollVariance * combatRewardMultiplier;
    const [minBossXp, maxBossXp] = input.bonusXpRange;
    const [minBossToken, maxBossToken] = input.tokenRewardRange;
    const rawXp = Math.floor((Math.floor(Math.random() * (maxBossXp - minBossXp + 1)) + minBossXp) * finalScale);
    const rawTokens = Math.floor((Math.floor(Math.random() * (maxBossToken - minBossToken + 1)) + minBossToken) * finalScale);
    const tokenCap = Math.max(BOSS_REWARD_BALANCE.tokenCapFloor, Math.min(BOSS_REWARD_BALANCE.tokenCapCeiling, Math.floor(input.bet * 0.45 + 100)));
    const xpCap = Math.max(BOSS_REWARD_BALANCE.xpCapFloor, Math.min(BOSS_REWARD_BALANCE.xpCapCeiling, Math.floor(input.bet * 0.22 + 130)));
    return { bossBonusXp: Math.max(1, Math.min(xpCap, rawXp)), bossTokenBonus: Math.max(1, Math.min(tokenCap, rawTokens)) };
}
