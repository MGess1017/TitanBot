import { ARMOR_IDS, COLLECTIBLE_ITEM_IDS, ITEM_DEFS, ULTRA_RARE_COLLECTIBLE_IDS, type ItemDef, WEAPON_IDS } from "../game/catalog";
import {
    ARMOR_TRAITS,
    RAID_APEX_ARMOR_DISCOVERY_TABLE,
    RAID_APEX_WEAPON_DISCOVERY_TABLE,
    RAID_ARMOR_DISCOVERY_TABLE,
    RAID_LOOT_TUNING_BY_DIFFICULTY,
    RAID_WEAPON_DISCOVERY_TABLE,
    WEAPON_TRAITS,
    getRouteAccessItemIdForMap,
    hasConditionImmunity,
    isAdvancedRaidDifficulty,
    type RaidCondition,
    type RaidMapConfig,
    type RolledBoss
} from "./domain";

export type RaidLoadoutBonus = {
    error?: string;
    attackBoost: number;
    defenseBoost: number;
    tokenBoost: number;
    xpMultiplier: number;
    negatedCondition: boolean;
    weapon: ItemDef | null;
    armor: ItemDef | null;
    notes: string[];
};

function rarityWeight(rarity: string | undefined): number {
    const key = String(rarity || "common").toLowerCase();
    if (key === "mythic") return 1;
    if (key === "legendary") return 0.86;
    if (key === "epic") return 0.72;
    if (key === "rare") return 0.56;
    if (key === "uncommon") return 0.4;
    return 0.22;
}

export function getRaidLoadoutBonus(input: {
    userId: string;
    condition: RaidCondition;
    selectedWeaponId?: string | null;
    selectedArmorId?: string | null;
    getInventoryCount: (userId: string, itemId: string) => number;
    getBestOwnedGear: (userId: string, ids: string[], metric: "raidAttack" | "raidDefense") => ItemDef | null;
}): RaidLoadoutBonus {
    const { userId, condition, selectedWeaponId, selectedArmorId, getInventoryCount, getBestOwnedGear } = input;
    let weapon: ItemDef | null = null;
    let armor: ItemDef | null = null;

    if (selectedWeaponId) {
        const def = ITEM_DEFS[selectedWeaponId];
        if (!def || def.kind !== "weapon") {
            return { error: `Selected weapon '${selectedWeaponId}' is not valid.`, attackBoost: 0, defenseBoost: 0, tokenBoost: 0, xpMultiplier: 1, negatedCondition: false, weapon: null, armor: null, notes: [] };
        }
        if (getInventoryCount(userId, selectedWeaponId) < 1) {
            return { error: `You do not own the selected weapon '${def.name}'.`, attackBoost: 0, defenseBoost: 0, tokenBoost: 0, xpMultiplier: 1, negatedCondition: false, weapon: null, armor: null, notes: [] };
        }
        weapon = def;
    } else {
        weapon = getBestOwnedGear(userId, WEAPON_IDS, "raidAttack");
    }

    if (selectedArmorId) {
        const def = ITEM_DEFS[selectedArmorId];
        if (!def || def.kind !== "armor") {
            return { error: `Selected armor '${selectedArmorId}' is not valid.`, attackBoost: 0, defenseBoost: 0, tokenBoost: 0, xpMultiplier: 1, negatedCondition: false, weapon, armor: null, notes: [] };
        }
        if (getInventoryCount(userId, selectedArmorId) < 1) {
            return { error: `You do not own the selected armor '${def.name}'.`, attackBoost: 0, defenseBoost: 0, tokenBoost: 0, xpMultiplier: 1, negatedCondition: false, weapon, armor: null, notes: [] };
        }
        armor = def;
    } else {
        armor = getBestOwnedGear(userId, ARMOR_IDS, "raidDefense");
    }

    let attackBoost = weapon?.raidAttack || 0;
    let defenseBoost = armor?.raidDefense || 0;
    let tokenBoost = 0;
    let xpMultiplier = 1;
    let negatedCondition = false;
    const notes: string[] = [];

    if (weapon) {
        const trait = WEAPON_TRAITS[weapon.id];
        if (trait?.successBonus) attackBoost += trait.successBonus;
        if (trait?.tokenBonus) tokenBoost += trait.tokenBonus;
        if (trait?.xpBonus) xpMultiplier += trait.xpBonus;
        const c = trait?.conditionSuccess?.[condition.key];
        if (c) attackBoost += c;
        if (trait?.note) notes.push(`${weapon.name}: ${trait.note}`);
    }

    if (armor) {
        const trait = ARMOR_TRAITS[armor.id];
        if (trait?.successBonus) attackBoost += trait.successBonus;
        if (trait?.tokenBonus) tokenBoost += trait.tokenBonus;
        if (trait?.xpBonus) xpMultiplier += trait.xpBonus;
        if (hasConditionImmunity(trait, condition.key)) {
            negatedCondition = true;
            notes.push(`${armor.name}: negates ${condition.label}.`);
        }
        const c = trait?.conditionSuccess?.[condition.key];
        if (c) {
            attackBoost += c;
            defenseBoost += c * 0.6;
        }
        if (trait?.note) notes.push(`${armor.name}: ${trait.note}`);
    }

    if (weapon && armor) {
        const weaponWeight = rarityWeight(weapon.rarity);
        const armorWeight = rarityWeight(armor.rarity);
        const synergy = (weaponWeight + armorWeight) * 0.5;

        attackBoost += synergy * 0.004;
        defenseBoost += synergy * 0.006;
        tokenBoost += synergy * 0.004;
        xpMultiplier += synergy * 0.02;
        notes.push(`Loadout synergy active (${weapon.rarity}/${armor.rarity}).`);

        if (weapon.id.startsWith("enhanced_")) {
            attackBoost += 0.012;
            tokenBoost += 0.008;
            xpMultiplier += 0.018;
            notes.push("Enhanced weapon bonus applied.");
        }
    }

    if (selectedWeaponId && weapon) notes.push(`Manual weapon selected: ${weapon.name}`);
    if (selectedArmorId && armor) notes.push(`Manual armor selected: ${armor.name}`);

    return {
        attackBoost: Math.max(-0.1, Math.min(0.34, attackBoost)),
        defenseBoost: Math.max(0, Math.min(0.3, defenseBoost)),
        tokenBoost: Math.max(-0.1, Math.min(0.3, tokenBoost)),
        xpMultiplier: Math.max(0.75, Math.min(1.65, xpMultiplier)),
        negatedCondition,
        weapon,
        armor,
        notes
    };
}

export function formatLoadoutSummary(input: {
    userId: string;
    condition: RaidCondition;
    mapCfg?: { label: string; difficulty: string };
    selectedWeaponId?: string | null;
    selectedArmorId?: string | null;
    getInventoryCount: (userId: string, itemId: string) => number;
    getBestOwnedGear: (userId: string, ids: string[], metric: "raidAttack" | "raidDefense") => ItemDef | null;
}): string {
    const bonus = getRaidLoadoutBonus(input);
    if (bonus.error) return bonus.error;
    const weapon = bonus.weapon ? `${bonus.weapon.name} (+${Math.round((bonus.weapon.raidAttack || 0) * 100)}% base)` : "None";
    const armor = bonus.armor ? `${bonus.armor.name} (+${Math.round((bonus.armor.raidDefense || 0) * 100)}% mitigation)` : "None";
    const notes = bonus.notes.length ? bonus.notes.map(n => `- ${n}`).join("\n") : "- No special gear triggers active.";
    return [
        `Map: ${input.mapCfg ? `${input.mapCfg.label} (${input.mapCfg.difficulty})` : "N/A"}`,
        `Condition: ${input.condition.label}`,
        `Weapon: ${weapon}`,
        `Armor: ${armor}`,
        `Success Modifier: ${(bonus.attackBoost * 100).toFixed(1)}%`,
        `Loss Mitigation: ${(bonus.defenseBoost * 100).toFixed(1)}%`,
        `Token Modifier: ${(bonus.tokenBoost * 100).toFixed(1)}%`,
        `Raid XP Multiplier: ${bonus.xpMultiplier.toFixed(2)}x`,
        `Condition Effect: ${bonus.negatedCondition ? `Negated by ${bonus.armor?.name || "armor"}` : "Active"}`,
        "Gear Triggers:",
        notes
    ].join("\n");
}

function weightedPick(table: Array<{ id: string; weight: number }>): string {
    const positive = table.filter(entry => entry.weight > 0);
    if (!positive.length) return table[0]?.id || "scrap";
    const total = positive.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of positive) {
        roll -= entry.weight;
        if (roll <= 0) return entry.id;
    }
    return positive[positive.length - 1].id;
}

function pushLootStack(loot: Array<{ id: string; qty: number }>, id: string, qty: number): void {
    const amount = Math.max(1, Math.floor(qty));
    const existing = loot.find(entry => entry.id === id);
    if (existing) {
        existing.qty += amount;
        return;
    }
    loot.push({ id, qty: amount });
}

export function getRouteAccessItemDropChance(input: {
    ultraRareBaseChance: number;
    legendaryChanceBonus: number;
    bossDefeated: boolean;
    success: boolean;
}): number {
    if (!input.success) return 0;
    return Math.max(0.00015, Math.min(0.0012, input.ultraRareBaseChance * 0.22 + input.legendaryChanceBonus * 0.002 + (input.bossDefeated ? 0.00035 : 0)));
}

export function rollRaidLoot(input: {
    success: boolean;
    tension: string;
    mapCfg: RaidMapConfig;
    bossDefeated: boolean;
    boss: RolledBoss | null;
    difficultyScalar: number;
    bonusRolls?: number;
}): Array<{ id: string; qty: number }> {
    const { success, tension, mapCfg, bossDefeated, boss, difficultyScalar } = input;
    const loot: Array<{ id: string; qty: number }> = [];
    const tensionBoost = tension === "high" ? 0.14 : tension === "medium" ? 0.07 : 0;
    const effectiveScalar = Math.max(0.85, Math.min(1.9, difficultyScalar));
    const tuning = RAID_LOOT_TUNING_BY_DIFFICULTY[mapCfg.difficulty];

    const baseScrap = success ? 5 + Math.floor(Math.random() * 9) : 2 + Math.floor(Math.random() * 5);
    const finalScrap = Math.max(1, Math.floor((baseScrap + mapCfg.scrapBonus) * (0.9 + tensionBoost * 0.6)));
    pushLootStack(loot, "scrap", finalScrap);

    const rollCount = success
        ? tuning.successBaseRolls + (tension === "high" ? tuning.successHighTensionBonusRolls : 0) + (isAdvancedRaidDifficulty(mapCfg.difficulty) ? tuning.successHardMapBonusRolls : 0)
        : tuning.failureBaseRolls;

    const bonusDifficultyRolls = success ? Math.max(0, Math.floor((effectiveScalar - 1) * 1.5)) : 0;
    const failureCompensationRoll = !success && tension === "high" && Math.random() < 0.2 ? 1 : 0;
    const tacticalBonusRolls = Math.max(0, Math.min(2, Math.floor(input.bonusRolls || 0)));
    const totalRollCount = Math.max(1, rollCount + bonusDifficultyRolls + failureCompensationRoll + tacticalBonusRolls + (bossDefeated ? 1 : 0));

    const commonPool: Array<{ id: string; weight: number }> = [
        { id: "rusted_dogtag", weight: 22 },
        { id: "rare_material_small", weight: 28 + mapCfg.resourceChanceBonus * 100 },
        { id: "weapon_bolts", weight: 18 + mapCfg.resourceChanceBonus * 75 },
        { id: "rare_material", weight: 12 + mapCfg.resourceChanceBonus * 85 },
        { id: "servo_motor", weight: 8 + mapCfg.resourceChanceBonus * 60 },
        { id: "encrypted_chip", weight: 8 + mapCfg.legendaryChanceBonus * 120 },
        { id: "nanofiber_roll", weight: 5 + mapCfg.legendaryChanceBonus * 35 },
        { id: "black_ice_lens", weight: 2 + mapCfg.legendaryChanceBonus * 18 },
        { id: "data_shard", weight: 11 + mapCfg.resourceChanceBonus * 55 },
        { id: "intel_cache", weight: 7 + mapCfg.legendaryChanceBonus * 35 },
        { id: "tactical_blueprint", weight: 5 + mapCfg.legendaryChanceBonus * 24 },
        { id: "quantum_logbook", weight: 2 + mapCfg.legendaryChanceBonus * 15 },
        { id: "power_cell", weight: 10 + mapCfg.resourceChanceBonus * 45 },
        { id: "signal_array", weight: 5 + mapCfg.legendaryChanceBonus * 18 },
        { id: "reactor_matrix", weight: 3 + mapCfg.legendaryChanceBonus * 20 },
        { id: "prismalloy_ingot", weight: 2 + mapCfg.legendaryChanceBonus * 16 },
        { id: "hydra_capacitor", weight: 1.2 + mapCfg.legendaryChanceBonus * 10 },
        { id: "oubliette_pearl", weight: 0.55 + mapCfg.legendaryChanceBonus * 4 },
        { id: "mythic_circuit", weight: 0.8 + mapCfg.legendaryChanceBonus * 7 },
        { id: "spectral_fiber", weight: 2 + mapCfg.legendaryChanceBonus * 11 },
        { id: "warbond_chip", weight: 1.2 + mapCfg.legendaryChanceBonus * 8 },
        { id: "vault_keycard", weight: 2 + mapCfg.legendaryChanceBonus * 10 },
        { id: "med_patch", weight: 14 + tensionBoost * 18 },
        { id: "field_ration", weight: 16 },
        { id: "repair_kit", weight: 10 },
        { id: "combat_stim", weight: 7 + tensionBoost * 30 },
        { id: "scav_beacon", weight: 5 + tensionBoost * 20 },
        { id: "cosmetic_token", weight: 6 + tensionBoost * 15 },
        { id: "legendary_token", weight: 1.5 + (mapCfg.legendaryChanceBonus * 40) + (tensionBoost * 8) },
        ...mapCfg.bonusLootPool
    ];

    const collectiblePool: Array<{ id: string; weight: number }> = [
        { id: "collector_obsidian_totem", weight: 1.35 },
        { id: "collector_cracked_orrery", weight: 1.2 },
        { id: "collector_warborn_charm", weight: 1.3 },
        { id: "collector_aether_compass", weight: 1.15 },
        { id: "collector_bloodglass_idol", weight: 1.05 },
        { id: "collector_stormseal_coin", weight: 1.25 },
        { id: "collector_hollow_crown", weight: 1.0 },
        { id: "collector_drowned_signet", weight: 1.1 },
        { id: "collector_marrow_lantern", weight: 1.08 },
        { id: "collector_cipher_tablet", weight: 1.14 },
        { id: "collector_voidcarved_urn", weight: 0.95 },
        { id: "collector_riftbone_fang", weight: 0.9 },
        { id: "collector_ember_contract", weight: 0.78 },
        { id: "collector_sable_vault_coin", weight: 0.62 },
        { id: "collector_nullglass_eye", weight: 0.48 },
        { id: "collector_warlock_seal", weight: 0.36 },
        { id: "collector_bloodmoon_deed", weight: 0.24 }
    ].filter(entry => COLLECTIBLE_ITEM_IDS.includes(entry.id as (typeof COLLECTIBLE_ITEM_IDS)[number]));

    const ultraCollectiblePool: Array<{ id: string; weight: number }> = [
        { id: "collector_eternal_halo", weight: 1 },
        { id: "collector_omega_reliquary", weight: 1 },
        { id: "collector_paradox_shard", weight: 1 },
        { id: "collector_blackstar_diadem", weight: 1 },
        { id: "collector_abyss_ledger", weight: 0.62 },
        { id: "collector_void_saint_relic", weight: 0.38 },
        { id: "collector_starless_codex", weight: 0.2 },
        { id: "collector_titan_vault_core", weight: 0.08 },
        { id: "collector_eclipse_vault_deed", weight: 0.035 },
        { id: "collector_void_emperor_crown", weight: 0.02 },
        { id: "collector_abyssal_world_key", weight: 0.012 },
        { id: "collector_black_sun_heart", weight: 0.007 },
        { id: "collector_eternity_contract", weight: 0.003 }
    ].filter(entry => ULTRA_RARE_COLLECTIBLE_IDS.includes(entry.id as (typeof ULTRA_RARE_COLLECTIBLE_IDS)[number]));

    for (let i = 0; i < totalRollCount; i++) {
        const id = weightedPick(commonPool);
        const qty = id === "scrap" ? 2 : 1;
        pushLootStack(loot, id, qty);
    }

    const weaponPool = success ? mapCfg.successWeapons : mapCfg.failureWeapons;
    const armorPool = success ? mapCfg.successArmor : mapCfg.failureArmor;
    const gearRolls = success
        ? (Math.random() < (tuning.gearSuccessBaseChance + mapCfg.lootGearChanceBonus * 0.35 + tensionBoost * 0.25) ? 1 : 0)
        : (Math.random() < tuning.gearFailureChance ? 1 : 0);

    for (let i = 0; i < gearRolls; i++) {
        const source = Math.random() < 0.5 ? weaponPool : armorPool;
        pushLootStack(loot, source[Math.floor(Math.random() * source.length)], 1);
    }

    const rareDiscoveryChance = success ? Math.max(0.004, Math.min(0.07, 0.006 + mapCfg.lootGearChanceBonus * 0.11 + mapCfg.legendaryChanceBonus * 0.15 + tensionBoost * 0.035 + (bossDefeated ? 0.015 : 0))) : 0;
    if (success && Math.random() < rareDiscoveryChance) {
        const discoveryTable = Math.random() < 0.5 ? RAID_WEAPON_DISCOVERY_TABLE : RAID_ARMOR_DISCOVERY_TABLE;
        pushLootStack(loot, weightedPick(discoveryTable), 1);
    }

    const apexDiscoveryChance = success ? Math.max(0.0008, Math.min(0.014, tuning.ultraRareBaseChance * 3.8 + mapCfg.fnCoinChanceBonus * 0.045 + (bossDefeated ? 0.006 : 0))) : 0;
    if (success && Math.random() < apexDiscoveryChance) {
        const apexTable = Math.random() < 0.5 ? RAID_APEX_WEAPON_DISCOVERY_TABLE : RAID_APEX_ARMOR_DISCOVERY_TABLE;
        pushLootStack(loot, weightedPick(apexTable), 1);
    }

    if (success && Math.random() < (tuning.fnCoinBaseChance + tensionBoost * 0.04 + mapCfg.fnCoinChanceBonus * 0.28) * effectiveScalar) {
        pushLootStack(loot, "fn_coin", 1);
    }
    if (success && Math.random() < (tuning.relicBaseChance + mapCfg.legendaryChanceBonus * 0.24 + tensionBoost * 0.1)) {
        pushLootStack(loot, "relic_fragment", 1);
    }
    if (success && Math.random() < (tuning.crateBaseChance + tensionBoost * 0.045 + mapCfg.lootGearChanceBonus * 0.12)) {
        pushLootStack(loot, weightedPick(mapCfg.crateDropTable), 1);
    }
    if (success && Math.random() < (tuning.ultraRareBaseChance + tensionBoost * 0.00035)) {
        pushLootStack(loot, weightedPick([{ id: "eclipse_core", weight: 1 }, { id: "sovereign_cipher", weight: 1 }, { id: "ghostmatter_relay", weight: 1 }]), 1);
    }

    const routeAccessChance = getRouteAccessItemDropChance({ ultraRareBaseChance: tuning.ultraRareBaseChance, legendaryChanceBonus: mapCfg.legendaryChanceBonus, bossDefeated, success });
    const routeAccessItemId = getRouteAccessItemIdForMap(mapCfg.key);
    if (routeAccessItemId && success && Math.random() < routeAccessChance) {
        pushLootStack(loot, routeAccessItemId, 1);
    }

    const collectibleChance = success
        ? Math.max(0.00035, Math.min(0.0032, 0.00055 + mapCfg.legendaryChanceBonus * 0.011 + mapCfg.fnCoinChanceBonus * 0.004 + tensionBoost * 0.0016 + (bossDefeated ? 0.0007 : 0)))
        : 0;
    if (success && collectiblePool.length && Math.random() < collectibleChance) {
        pushLootStack(loot, weightedPick(collectiblePool), 1);
    }

    const ultraCollectibleChance = success
        ? Math.max(0.000025, Math.min(0.00019, tuning.ultraRareBaseChance * 0.11 + mapCfg.fnCoinChanceBonus * 0.0009 + (bossDefeated ? 0.00006 : 0) + tensionBoost * 0.00005))
        : 0;
    if (success && ultraCollectiblePool.length && Math.random() < ultraCollectibleChance) {
        pushLootStack(loot, weightedPick(ultraCollectiblePool), 1);
    }

    if (bossDefeated && boss) {
        pushLootStack(loot, boss.weaponDrop, 1);
        pushLootStack(loot, boss.armorDrop, 1);
        if (Math.random() < boss.rareDropChance) {
            pushLootStack(loot, weightedPick(mapCfg.bossCrateDropTable), 1);
        }
        if (Math.random() < tuning.bossUltraRareBonusChance) {
            pushLootStack(loot, weightedPick([{ id: "eclipse_core", weight: 1 }, { id: "sovereign_cipher", weight: 1 }, { id: "ghostmatter_relay", weight: 1 }]), 1);
        }
        if (ultraCollectiblePool.length && Math.random() < Math.min(0.00035, tuning.bossUltraRareBonusChance * 0.06)) {
            pushLootStack(loot, weightedPick(ultraCollectiblePool), 1);
        }
    } else if (bossDefeated) {
        pushLootStack(loot, mapCfg.bossKit.weaponId, 1);
        pushLootStack(loot, mapCfg.bossKit.armorId, 1);
    }

    return loot;
}