import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as Discord from "discord.js";
import * as Utils from "../utils";
import * as Catalog from "../game/catalog";
import * as RaidDomain from "../raid/domain";
import { RAID_RESULT_ACTION_IDS, RAID_ENCOUNTER_IDS, buildRaidBranchDecisionPayload, buildRaidResultPayload } from "../game/payloads";
import { getRaidLoadoutBonus, rollRaidLoot } from "../raid/runtime";
import { CRAFT_RECIPES, getDynamicVendorPrice, getGearDurability, repairGear } from "../game/gearEconomy";

const userId = "__test_pmc_expansion__";
const previous = Utils.points[userId];
const previousNoSave = process.env.RUNTIME_TEST_NO_POINTS_SAVE;
process.env.RUNTIME_TEST_NO_POINTS_SAVE = "1";
try {
    for (const objective of RaidDomain.RAID_TACTICAL_OBJECTIVES) {
        const modifiers = RaidDomain.getRaidBranchModifiers(null, objective.key);
        assert.equal(modifiers.successDelta, objective.successDelta);
        assert.equal(modifiers.tokenMultiplierDelta, objective.tokenMultiplierDelta);
        assert.equal(RaidDomain.getRaidObjectiveRewards(objective.key, false).xpMultiplier, 1);
        assert.equal(RaidDomain.getRaidObjectiveRewards(objective.key, false).reputationBonus, 0);
        assert.equal(RaidDomain.getRaidObjectiveRewards(objective.key, true).reputationBonus, objective.reputationBonus);
        assert.equal(RaidDomain.getRaidObjectiveRewards(objective.key, true).xpMultiplier, objective.xpMultiplier);
    }
    assert.equal(RaidDomain.getRaidObjectiveRewards("stay_course", true).reputationBonus, 0);
    const branch = JSON.parse(buildRaidBranchDecisionPayload({ mapLabel: "Obsidian Spire", tension: "high" }));
    assert.equal(branch.components[0].components.length, 5);
    assert.ok(branch.components[0].components.some((button: { custom_id: string }) => button.custom_id === RAID_ENCOUNTER_IDS.rescuePatrol));
    for (const key of ["obsidian_spire", "nullforge_depths", "bloodmoon_cathedral", "eclipse_bastion", "titanfall_crucible"] as const) {
        assert.ok(RaidDomain.rollRaidMapEvent(key, 5, () => 0));
        assert.equal(RaidDomain.rollRaidMapEvent(key, 5, () => 1), null);
    }
    assert.equal(RaidDomain.rollRaidMapEvent("titanfall_crucible", 0, () => 0), null);
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
        const lootInput = { tension: "high", mapCfg: RaidDomain.RAID_MAPS.obsidian_spire, bossDefeated: false, boss: null, difficultyScalar: 1 };
        const loot = rollRaidLoot({ ...lootInput, success: true });
        assert.ok(loot.some(entry => entry.id === "cinderline_carbine"));
        assert.ok(loot.some(entry => entry.id === "nullweave_repeater"));
        assert.ok(!rollRaidLoot({ ...lootInput, success: false }).some(entry => Catalog.RAID_FIELD_GEAR.some(item => item.id === entry.id)));
    } finally {
        Math.random = originalRandom;
    }
    const report = JSON.parse(buildRaidResultPayload({ result: { success: true, objectiveOutcome: "Rescue Patrol: complete", mapEventDetails: "Relay opened.", loadoutSetLabel: "Cinderline", newGearNames: ["Cinderline Carbine"], loot: [{ id: "collector_titan_vault_core", qty: 1 }] }, mapCfg: RaidDomain.RAID_MAPS.obsidian_spire, fallbackTension: "high", armyIconUrl: "https://example.com/army.png" }));
    assert.ok(report.embed.fields.some((field: { name: string }) => field.name === "Field Report"));
    assert.ok(report.embed.fields.some((field: { name: string }) => field.name === "New Gear Discovered"));
    assert.ok(report.embed.fields.find((field: { name: string }) => field.name === "Rewards").value.includes("55,000,000"));
    assert.equal(Catalog.RAID_FIELD_GEAR.filter(item => item.kind === "weapon").length, 6);
    assert.equal(Catalog.RAID_FIELD_GEAR.filter(item => item.kind === "armor").length, 6);
    for (const item of Catalog.RAID_FIELD_GEAR) {
        const registry = item.kind === "weapon" ? Catalog.WEAPON_IDS : Catalog.ARMOR_IDS;
        const table = item.kind === "weapon" ? RaidDomain.RAID_WEAPON_DISCOVERY_TABLE : RaidDomain.RAID_ARMOR_DISCOVERY_TABLE;
        assert.ok(registry.includes(item.id));
        assert.ok(table.some(entry => entry.id === item.id && entry.weight > 0));
        assert.ok(!Catalog.SHOP_ITEMS.includes(item.id));
        assert.ok(!CRAFT_RECIPES.some(recipe => recipe.outputId === item.id));
    }
    for (const set of Catalog.RAID_FIELD_SETS) {
        const condition = RaidDomain.RAID_CONDITIONS.find(entry => entry.key === set.condition)!;
        const input = { userId, condition, selectedWeaponId: set.weaponId, selectedArmorId: set.armorId, getInventoryCount: () => 1, getBestOwnedGear: () => null };
        const matched = getRaidLoadoutBonus(input);
        const unmatched = getRaidLoadoutBonus({ ...input, condition: RaidDomain.RAID_CONDITIONS.find(entry => entry.key !== set.condition)! });
        assert.equal(matched.setLabel, set.label);
        assert.ok(matched.attackBoost > unmatched.attackBoost);
        assert.ok(matched.tokenBoost > unmatched.tokenBoost);
        assert.ok(matched.xpMultiplier <= 1.65);
        assert.equal(getRaidLoadoutBonus({ ...input, selectedArmorId: "field_vest" }).setLabel, undefined);
    }
    const state = Utils.ensureUser(userId);
    for (let index = 0; index < Utils.PMC_LEVEL_THRESHOLDS.length; index++) {
        const threshold = Utils.PMC_LEVEL_THRESHOLDS[index];
        assert.equal(Utils.getPmcLevel(threshold), index + 1);
        assert.equal(Utils.getPmcLevel(threshold - 1), index);
    }
    state.inventory.field_vest = 1;
    state.inventory.repair_kit = 1;
    state.gearDurability.field_vest = 100;
    const walletBefore = state.fnTokens;
    assert.equal(repairGear(state, "field_vest").cost, 0);
    assert.equal(state.inventory.repair_kit, 1);
    assert.equal(state.fnTokens, walletBefore);
    state.gearDurability.field_vest = 0;
    assert.equal(getGearDurability(state, "field_vest"), 0);
    assert.equal(repairGear(state, "field_vest").changed, 100);
    assert.equal(state.inventory.repair_kit, 0);
    state.pmcPrestige = 1;
    const follower = Utils.ensureSirGruFollower(state)!;
    for (let level = 1; level <= 100; level++) {
        assert.equal(Utils.getSirGruLevelFromXp(Utils.getSirGruLevelXp(level)), level);
        if (level > 1) assert.equal(Utils.getSirGruLevelFromXp(Utils.getSirGruLevelXp(level) - 1), level - 1);
    }
    follower.xp = Utils.getSirGruLevelXp(50);
    delete follower.supportRole;
    const balanced = Utils.getSirGruRaidBonuses(follower);
    assert.equal(Utils.getFollowerSupportRole(follower), "balanced");
    follower.supportRole = "scout";
    assert.ok(Utils.getSirGruRaidBonuses(follower).successBonus > balanced.successBonus);
    assert.ok(Utils.getSirGruRaidBonuses(follower).tokenBonus < balanced.tokenBonus);
    follower.supportRole = "guardian";
    assert.ok(Utils.getSirGruRaidBonuses(follower).defenseBonus > balanced.defenseBonus);
    assert.ok(Utils.getSirGruRaidBonuses(follower).bossKillBonus < balanced.bossKillBonus);
    follower.supportRole = "quartermaster";
    assert.ok(Utils.getSirGruRaidBonuses(follower).tokenBonus > balanced.tokenBonus);
    assert.equal(Utils.ensureSirGruFollower(state)?.supportRole, "quartermaster");
    const requirement = Utils.PMC_LEVEL_THRESHOLDS[Utils.PMC_PRESTIGE_LEVEL_REQUIREMENT - 1];
    assert.equal(Utils.getPmcPrestigePreview(requirement - 1, 1).eligible, false);
    assert.equal(Utils.getPmcPrestigePreview(requirement - 1, 1).xpRemaining, 1);
    assert.equal(Utils.getPmcPrestigePreview(requirement, 1).eligible, true);
    assert.equal(Utils.getPmcPrestigePreview(requirement, 10).eligible, false);
    state.pmcXP = requirement;
    const snapshot = JSON.stringify(state);
    assert.ok(Utils.performPmcPrestige(userId, 0).error);
    assert.equal(JSON.stringify(state), snapshot);
    assert.equal(Utils.performPmcPrestige(userId, 1).prestige, 2);
    assert.equal(state.pmcXP, 0);
    assert.equal(state.followers.sir_gru.xp, Utils.getSirGruLevelXp(50));
    assert.equal(state.followers.sir_gru.supportRole, "quartermaster");
    state.pmcXP = requirement;
    assert.ok(Utils.performPmcPrestige(userId, 1).error);

    const sourceText = fs.readFileSync(path.resolve(__dirname, "../bot.ts"), "utf8");
    const source = ts.createSourceFile("bot.ts", sourceText, ts.ScriptTarget.ES2020, true);
    const buyFunction = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "buyItem");
    assert.ok(buyFunction);
    const purchaseContext = vm.createContext({ ...Utils, ...Catalog, getDynamicVendorPrice });
    vm.runInContext(ts.transpileModule(buyFunction.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, purchaseContext);
    state.fnTokens = 1_000_000_000;
    const beforePurchase = JSON.stringify({ wallet: state.fnTokens, inventory: state.inventory });
    for (const itemId of [...Catalog.ULTRA_RARE_COLLECTIBLE_IDS, ...Catalog.RAID_FIELD_GEAR.map(item => item.id)]) {
        assert.ok(purchaseContext.buyItem(userId, itemId, 1).error);
    }
    assert.equal(JSON.stringify({ wallet: state.fnTokens, inventory: state.inventory }), beforePurchase);
    assert.ok(!purchaseContext.buyItem(userId, "field_ration", 1).error);
    assert.equal(state.inventory.field_ration, 1);
    const profile = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "buildPmcProfilePayload");
    assert.ok(profile);
    const activeRaids = new Set<string>();
    const context = vm.createContext({ ...Discord, ...Utils, ...Catalog, RaidDomain, RAID_RESULT_ACTION_IDS,
        PMC_PROFILE_IDS: { view: "pmc_profile_view", followerRole: "pmc_follower_role" },
        PMC_PROFILE_VIEWS: { overview: "Overview", follower: "Follower", prestige: "Prestige", mastery: "Mastery", collection: "Collection" },
        PMC_PRESTIGE_IDS: { identity: "pmc_identity", request: "pmc_prestige_request" },
        activeRaidEncounters: activeRaids,
        getPmcTierVisual: () => ({ color: 0x008877, label: "Veteran", iconUrl: "https://example.com/pmc.png" }),
        getUnlockedBossHeartNames: () => RaidDomain.RAID_BOSS_ROSTER.map(boss => `${boss.name}'s Heart`),
        getBestOwnedGear: () => null
    });
    vm.runInContext(ts.transpileModule(profile.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
    for (const prestige of [0, 1, 10]) {
        state.pmcPrestige = prestige;
        state.pmcXP = prestige === 10 ? Utils.PMC_LEVEL_THRESHOLDS[49999] : 0;
        if (!prestige) delete state.followers.sir_gru;
        else Utils.ensureSirGruFollower(state);
        for (const view of ["overview", "follower", "prestige", "mastery", "collection"]) {
            const payload = JSON.parse(context.buildPmcProfilePayload({ id: userId, username: "PMC Tester" }, view));
            const fields: Array<{ name: string; value: string }> = payload.embed.fields;
            assert.ok(fields.every(field => field.value.length > 0 && field.value.length <= 1024));
            assert.ok(fields.reduce((total, field) => total + field.name.length + field.value.length, 0) + payload.embed.title.length + payload.embed.description.length < 5700);
            assert.ok(payload.components.length <= 5);
            assert.ok(payload.components[0].components[0].custom_id.endsWith(`:${userId}`));
            assert.equal(payload.components[0].components[0].options.filter((option: { default: boolean }) => option.default).length, 1);
            if (view === "overview") assert.ok(fields.length <= 6);
        }
    }
    console.log("PMC, follower and prestige expansion tests passed");
} finally {
    if (previous) Utils.points[userId] = previous;
    else delete Utils.points[userId];
    if (previousNoSave === undefined) delete process.env.RUNTIME_TEST_NO_POINTS_SAVE;
    else process.env.RUNTIME_TEST_NO_POINTS_SAVE = previousNoSave;
}