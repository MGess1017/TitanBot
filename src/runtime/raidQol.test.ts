import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { getBossBattlePhase, isBossBattleFinished, resolveBossTurn, type BossBattleState } from "../raid/combat";
import { RAID_BOSS_ROSTER, getBossCombatProfile } from "../raid/domain";
import { buildBossBattlePayload, buildBossIntelPayload, buildRaidResultPayload, RAID_ENCOUNTER_IDS, RAID_RESULT_ACTION_IDS } from "../game/payloads";
import { ITEM_DEFS } from "../game/catalog";

const initial: BossBattleState = { turn: 0, bossHp: 800, pmcHp: 600, rage: 0, armorBreak: 0, scanRevealed: false };
const base = { totalTurns: 8, pmcHpMax: 600, medPatchCount: 2, random: () => 0 };
const attack = resolveBossTurn({ ...base, state: initial, action: "attack" });
assert.equal(attack.state.bossHp, 770);
assert.equal(attack.state.armorBreak, 18);
assert.equal(attack.state.turn, 1);
assert.equal(initial.bossHp, 800);
const noSupplies = resolveBossTurn({ ...base, state: { ...initial, pmcHp: 500 }, medPatchCount: 0, action: "heal" });
assert.equal(noSupplies.accepted, false);
assert.equal(noSupplies.state.turn, 0);
assert.equal(noSupplies.medPatchesUsed, 0);
assert.equal(resolveBossTurn({ ...base, state: initial, action: "heal" }).accepted, false);
const heal = resolveBossTurn({ ...base, state: { ...initial, pmcHp: 580 }, action: "heal" });
assert.equal(heal.state.pmcHp, 600);
assert.equal(heal.medPatchesUsed, 1);
assert.match(heal.log[0], /restored 20 HP/);
const lethal = resolveBossTurn({ ...base, state: { ...initial, bossHp: 10, rage: 90 }, action: "attack" });
assert.equal(lethal.state.bossHp, 0);
assert.equal(lethal.state.pmcHp, 600);
assert.equal(isBossBattleFinished(lethal.state, 8), true);
assert.equal(resolveBossTurn({ ...base, state: lethal.state, action: "heal" }).accepted, false);
assert.equal(isBossBattleFinished({ ...initial, pmcHp: 0 }, 8), true);
assert.equal(isBossBattleFinished({ ...initial, turn: 8 }, 8), true);
const defend = resolveBossTurn({ ...base, state: { ...initial, rage: 80 }, action: "defend" });
assert.equal(defend.state.rage, 66);
assert.equal(defend.state.pmcHp, 592);
const scan = resolveBossTurn({ ...base, state: initial, action: "scan" });
assert.equal(scan.state.scanRevealed, true);
assert.equal(scan.state.armorBreak, 8);
for (const boss of RAID_BOSS_ROSTER) {
    const profile = getBossCombatProfile(boss.name);
    assert.equal(getBossBattlePhase(boss.name, 1000, 1000).name, "Contact");
    for (const phase of profile.phases) {
        assert.equal(getBossBattlePhase(boss.name, phase.thresholdPct * 10, 1000).name, phase.name);
    }
}
assert.equal(getBossBattlePhase("Wizard Of Chaos", 550, 1000).name, "Chaos Ascension");
assert.equal(getBossBattlePhase("Wizard Of Chaos", 200, 1000).name, "Apocalypse Cast");

const payloadInput = { bossName: "The Grave Warden", bossHpMax: 800, bossHpFinal: 0, pmcHpMax: 600, pmcHpFinal: 100, turn: 1, totalTurns: 8, bossHpCurrent: 400, pmcHpCurrent: 500 };
const noHeal = JSON.parse(buildBossBattlePayload({ ...payloadInput, medPatchCount: 0, bossCurrentPhase: "Enraged", phaseMechanic: "Signature attack incoming.", decisionDeadline: 20000, counteredTraits: ["Reactive Armor"] }));
assert.equal(noHeal.components[0].components.find((button: { custom_id: string }) => button.custom_id === RAID_ENCOUNTER_IDS.heal).disabled, true);
assert.match(noHeal.embed.fields[0].value, /Phase: Enraged/);
assert.match(noHeal.embed.fields[0].value, /Signature attack incoming/);
assert.match(noHeal.embed.fields[0].value, /Countered: Reactive Armor/);
assert.match(noHeal.embed.fields.at(-1).value, /<t:20:R>/);
const canHeal = JSON.parse(buildBossBattlePayload({ ...payloadInput, medPatchCount: 2 }));
assert.equal(canHeal.components[0].components.find((button: { custom_id: string }) => button.custom_id === RAID_ENCOUNTER_IDS.heal).disabled, false);
const fullHealth = JSON.parse(buildBossBattlePayload({ ...payloadInput, medPatchCount: 2, pmcHpCurrent: 600 }));
assert.equal(fullHealth.components[0].components.find((button: { custom_id: string }) => button.custom_id === RAID_ENCOUNTER_IDS.heal).disabled, true);
for (const ending of [{ bossHpCurrent: 0 }, { pmcHpCurrent: 0 }, { finished: true }, { turn: 8 }]) {
    const payload = JSON.parse(buildBossBattlePayload({ ...payloadInput, ...ending }));
    assert.deepEqual(payload.components, []);
    assert.match(payload.embed.title, /Complete/);
}
function assertDiscordEmbed(embed: { title: string; description?: string; fields: Array<{ name: string; value: string }> }): void {
    assert.ok(embed.title.length <= 256);
    assert.ok(embed.fields.length <= 25);
    assert.ok(embed.fields.every(field => field.name.length <= 256 && field.value.length > 0 && field.value.length <= 1024));
    assert.ok(embed.title.length + (embed.description?.length || 0) + embed.fields.reduce((total, field) => total + field.name.length + field.value.length, 0) <= 6000);
}
for (const boss of RAID_BOSS_ROSTER) {
    const intel = JSON.parse(buildBossIntelPayload({ bossName: boss.name }));
    assertDiscordEmbed(intel.embed);
    assert.ok(intel.embed.fields.find((field: { name: string }) => field.name === "Traits and Counters").value.includes("Counter:"));
}
const progressIntel = JSON.parse(buildBossIntelPayload({ bossName: "The Grave Warden", progress: { encounters: 6, kills: 4, currentStreak: 2, bestStreak: 3, intelLevel: 1, heartUpgradeLevel: 1, alternateFormUnlocked: false } }));
assert.match(progressIntel.embed.fields.at(-1).value, /Next heart upgrade: 2 kills remaining/);
assert.match(progressIntel.embed.fields.at(-1).value, /Alternate form: 1 kills remaining/);
const resultInput = { mapCfg: { key: "plagued_cemetary", label: "Cemetery", bossName: "The Grave Warden", lootTier: "Low" }, fallbackTension: "medium", armyIconUrl: "https://example.com/army.png" };
const result = JSON.parse(buildRaidResultPayload({ ...resultInput, result: { loot: [{ id: "scrap", qty: 2 }, { id: "scrap", qty: 3 }, { id: "chaos_staff", qty: 1 }] } }));
assert.match(result.embed.fields.find((field: { name: string }) => field.name === "Rewards").value, /Net: \+0 FN Token/);
assert.match(result.embed.fields.find((field: { name: string }) => field.name === "Rewards").value, /Loot: 6 items.*2 stacks/);
const lootField = result.embed.fields.find((field: { name: string }) => field.name === "Recovered Loot").value;
assert.ok(lootField.indexOf(ITEM_DEFS.chaos_staff.name) < lootField.indexOf(ITEM_DEFS.scrap.name));
assert.match(lootField, /5x/);
assert.ok(result.components[0].components.some((button: { custom_id: string }) => button.custom_id === `${RAID_RESULT_ACTION_IDS.mastery}:plagued_cemetary`));
assert.ok(result.components[0].components.some((button: { custom_id: string }) => button.custom_id === RAID_RESULT_ACTION_IDS.supplies));
const largeResult = JSON.parse(buildRaidResultPayload({ ...resultInput, result: { loot: Object.keys(ITEM_DEFS).map(id => ({ id, qty: 1 })) } }));
assertDiscordEmbed(largeResult.embed);
assert.match(largeResult.embed.fields.find((field: { name: string }) => field.name === "Recovered Loot").value, /more stacks in inventory/);
async function runInteractionTests(): Promise<void> {
    const sourceText = fs.readFileSync(path.resolve(__dirname, "../bot.ts"), "utf8");
    const source = ts.createSourceFile("bot.ts", sourceText, ts.ScriptTarget.ES2020, true);
    const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && ["awaitRaidDecision", "presentBossBattle"].includes(statement.name?.text || ""));
    assert.equal(functions.length, 2);
    const compiled = ts.transpileModule(functions.map(statement => statement.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    async function simulate(input: { actions?: string[]; medPatches?: number; result?: Record<string, unknown>; failEdit?: number }) {
        const decisions = new Map();
        const actions = [...(input.actions || [])];
        const frames: Array<{ components: unknown[] }> = [];
        let waits = 0;
        let edits = 0;
        let consumed = 0;
        let acknowledged = 0;
        let supplies = input.medPatches || 0;
        const context = vm.createContext({
            activeRaidDecisions: decisions,
            ComponentType: { Button: 2 },
            RAID_ENCOUNTER_IDS,
            getBossBattlePhase,
            isBossBattleFinished,
            resolveBossTurn,
            buildBossBattlePayload,
            embedFromPayload: (_command: string, embed: unknown) => embed,
            getInventoryCount: () => supplies,
            removeInventoryItem: (_userId: string, _item: string, count: number) => { supplies -= count; consumed += count; }
        });
        vm.runInContext(compiled, context);
        const message = {
            id: "raid-message",
            awaitMessageComponent: async (options: { filter: (candidate: unknown) => boolean; time: number }) => {
                waits += 1;
                assert.equal(decisions.size, 1);
                assert.equal(decisions.get(message.id).userId, "owner");
                assert.equal(options.time, 8000);
                assert.equal(options.filter({ user: { id: "other" }, customId: RAID_ENCOUNTER_IDS.attack }), false);
                assert.equal(options.filter({ user: { id: "owner" }, customId: RAID_ENCOUNTER_IDS.routeCache }), false);
                const customId = actions.shift();
                if (!customId) throw new Error("Decision timed out");
                const selected = { customId, user: { id: "owner" }, deferUpdate: async () => { acknowledged += 1; } };
                assert.equal(options.filter(selected), true);
                return selected;
            }
        };
        const interaction = {
            user: { id: "owner" },
            editReply: async (frame: { components: unknown[] }) => {
                edits += 1;
                if (edits === input.failEdit) throw new Error("Discord edit failed");
                frames.push(frame);
                return message;
            }
        };
        const battle = await context.presentBossBattle(interaction, { success: true, bossName: "The Grave Warden", bossHpMax: 10000, bossHpRemaining: 300, pmcHpMax: 600, pmcHpRemaining: 100, bossPhaseNames: ["Contact", "Enraged"], ...input.result });
        assert.equal(decisions.size, 0);
        return { battle, frames, waits, consumed, acknowledged };
    }
    const extracted = await simulate({ actions: [RAID_ENCOUNTER_IDS.extract] });
    assert.equal(extracted.waits, 1);
    assert.equal(extracted.frames.length, 2);
    assert.equal(extracted.acknowledged, 1);
    assert.equal(extracted.consumed, 0);
    assert.equal(extracted.battle.defeated, false);
    assert.equal(extracted.frames.at(-1)?.components.length, 0);
    for (const result of [{ bossDefeated: true, bossHpRemaining: 0 }, { success: false }]) {
        const settled = await simulate({ result });
        assert.equal(settled.waits, 0);
        assert.equal(settled.frames.length, 1);
        assert.equal(settled.consumed, 0);
        assert.equal(settled.battle, null);
    }
    const timeout = await simulate({});
    assert.equal(timeout.waits, 6);
    assert.equal(timeout.frames.length, 7);
    assert.equal(timeout.battle.defeated, false);
    const killed = await simulate({ result: { bossHpMax: 1 }, actions: [RAID_ENCOUNTER_IDS.attack] });
    assert.equal(killed.waits, 1);
    assert.equal(killed.battle.defeated, true);
    assert.equal(killed.battle.bossHp, 0);
    const healed = await simulate({ actions: [RAID_ENCOUNTER_IDS.defend, RAID_ENCOUNTER_IDS.heal, RAID_ENCOUNTER_IDS.extract], medPatches: 1 });
    assert.equal(healed.consumed, 1);
    assert.equal(healed.battle.pmcHp, 600);
    const invalidHeal = await simulate({ actions: [RAID_ENCOUNTER_IDS.heal, RAID_ENCOUNTER_IDS.extract] });
    assert.equal(invalidHeal.consumed, 0);
    assert.equal(invalidHeal.battle.pmcHp, 600);
    const incapacitated = await simulate({ result: { pmcHpMax: 1 }, actions: [RAID_ENCOUNTER_IDS.defend] });
    assert.equal(incapacitated.waits, 1);
    assert.equal(incapacitated.battle.pmcHp, 0);
    const failedFinalEdit = await simulate({ result: { bossHpMax: 1 }, actions: [RAID_ENCOUNTER_IDS.attack], failEdit: 2 });
    assert.equal(failedFinalEdit.battle.defeated, true);
}

runInteractionTests().then(() => console.log("raid quality-of-life and interaction tests passed")).catch(error => {
    console.error(error);
    process.exitCode = 1;
});