import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";
import { EmbedBuilder } from "discord.js";
import { getBossAttackIntent, getBossBattlePhase, isBossBattleFinished, resolveBossTurn, type BossBattleState } from "../raid/combat";
import { getBossPortraitFiles, getBossPortraitUrl } from "../game/bossPortraits";
import { RAID_BOSS_ROSTER, getBossCombatProfile } from "../raid/domain";
import { buildBossBattlePayload, buildBossIntelPayload, buildBossRosterPayload, buildRaidBranchDecisionPayload, buildRareRouteDecisionPayload, buildRaidResultPayload, RAID_ENCOUNTER_IDS, RAID_RESULT_ACTION_IDS } from "../game/payloads";
import { ITEM_DEFS } from "../game/catalog";

const initial: BossBattleState = { turn: 0, bossHp: 800, pmcHp: 600, rage: 0, armorBreak: 0, scanRevealed: false };
const portraitDigests = new Set<string>();
const portraitNames = new Set<string>();
for (const boss of RAID_BOSS_ROSTER) {
    const files = getBossPortraitFiles(boss.name);
    assert.equal(files.length, 1);
    assert.equal(getBossPortraitUrl(boss.name), `attachment://${files[0].name}`);
    assert.equal(typeof files[0].attachment, "string");
    const bytes = fs.readFileSync(String(files[0].attachment));
    assert.equal(bytes.subarray(0, 3).toString("hex"), "ffd8ff", "every boss must have a real bundled JPEG");
    assert.ok(bytes.length > 10_000 && bytes.length < 1_000_000, "portraits must stay comfortably below attachment limits");
    portraitNames.add(files[0].name!);
    portraitDigests.add(crypto.createHash("sha256").update(bytes).digest("hex"));
}
assert.equal(portraitDigests.size, 21, "all 21 bosses must have individually generated, distinct art");
assert.equal(portraitNames.size, RAID_BOSS_ROSTER.length);
assert.equal(getBossPortraitUrl(null), null);
assert.deepEqual(getBossPortraitFiles(undefined), []);
assert.throws(() => getBossPortraitUrl("Unmapped boss"), /Missing portrait mapping/);
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
assert.equal(defend.state.pmcHp, 594);
assert.equal(getBossAttackIntent(initial), null);
assert.equal(getBossAttackIntent({ ...initial, turn: 1 }), null);
assert.deepEqual(getBossAttackIntent({ ...initial, turn: 2 }), { damage: 12, defendedDamage: 3 });
assert.deepEqual(getBossAttackIntent({ ...initial, rage: 60 }), { damage: 21, defendedDamage: 6 });
assert.deepEqual(getBossAttackIntent({ ...initial, rage: 100 }), { damage: 28, defendedDamage: 7 });
assert.equal(getBossAttackIntent({ ...initial, bossHp: 0, turn: 2 }), null);
for (const state of [{ ...initial, turn: 2 }, { ...initial, turn: 5, rage: 50 }, { ...initial, rage: 60 }]) {
    const intent = getBossAttackIntent(state)!;
    for (const action of ["attack", "defend", "scan", "heal"] as const) {
        const before = { ...state, pmcHp: 400 };
        const resolved = resolveBossTurn({ ...base, state: before, action });
        const healed = action === "heal" ? 70 : 0;
        const expectedDamage = action === "defend" ? intent.defendedDamage : intent.damage;
        assert.equal(resolved.state.pmcHp, 400 + healed - expectedDamage, "telegraphed damage must match actual damage, with no duplicate Defend penalty");
        assert.equal(resolved.state.turn, state.turn + 1);
        assert.match(resolved.log.join(" "), /Countercharge/);
    }
}
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

const payloadInput = { bossName: "The Grave Warden", bossHpMax: 800, pmcHpMax: 600, turn: 1, totalTurns: 8, bossHpCurrent: 400, pmcHpCurrent: 500 };
const noHeal = JSON.parse(buildBossBattlePayload({ ...payloadInput, medPatchCount: 0, bossCurrentPhase: "Enraged", phaseMechanic: "Signature attack incoming.", decisionDeadline: 20000, counteredTraits: ["Reactive Armor"] }));
assertDiscordEmbed(noHeal.embed);
assert.equal(noHeal.components[0].components.find((button: { custom_id: string }) => button.custom_id === RAID_ENCOUNTER_IDS.heal).disabled, true);
assert.match(noHeal.embed.description, /Enraged/);
assert.match(noHeal.embed.fields[0].value, /Signature attack incoming/);
assert.match(noHeal.embed.fields[0].value, /Countered: Reactive Armor/);
assert.match(noHeal.embed.fields.at(-1).value, /<t:20:R>/);
assert.equal(noHeal.embed.image.url, getBossPortraitUrl(payloadInput.bossName));
const fullHpLateTurn = JSON.parse(buildBossBattlePayload({ ...payloadInput, turn: 7, bossHpCurrent: 800 }));
assert.match(fullHpLateTurn.embed.description, /Contact/, "phase must follow actual HP, not simulated turn progress");
assert.match(fullHpLateTurn.embed.fields[0].value, /800\/800/, "late turns must not synthesize boss damage");
const canHeal = JSON.parse(buildBossBattlePayload({ ...payloadInput, medPatchCount: 2 }));
assertDiscordEmbed(canHeal.embed);
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
const bossRoster = JSON.parse(buildBossRosterPayload([]));
assertDiscordEmbed(bossRoster.embed);
assert.equal(bossRoster.components[0].components[0].options.length, RAID_BOSS_ROSTER.length);
assert.ok(bossRoster.components[0].components[0].options.length <= 25);
const routeDecision = JSON.parse(buildRareRouteDecisionPayload({ route: {
    key: "test_route",
    label: "Test Exit",
    description: "A concealed extraction route.",
    mapKeys: ["plagued_cemetary"],
    baseDiscoveryChance: 0.045,
    requiredItemId: "boneway_key",
    safeSuccessBonus: 0.12,
    cacheSuccessPenalty: 0.06,
    cacheTokenBonus: 0.1,
    cacheBonusRolls: 1
}, mapLabel: "FN Plagued Cemetery", requiredItemName: "Boneway Key" }));
assertDiscordEmbed(routeDecision.embed);
const branchDecision = JSON.parse(buildRaidBranchDecisionPayload({ mapLabel: "FN Plagued Cemetery", tension: "high" }));
assertDiscordEmbed(branchDecision.embed);
for (const boss of RAID_BOSS_ROSTER) {
    const intel = JSON.parse(buildBossIntelPayload({ bossName: boss.name }));
    assertDiscordEmbed(intel.embed);
    const combat = intel.embed.fields.find((field: { name: string }) => field.name === "Combat");
    assert.ok(combat?.value.includes("Traits:"));
    assert.ok(combat?.value.includes("Phases:"));
    assert.equal(intel.embed.image.url, getBossPortraitUrl(boss.name));
}
const progressIntel = JSON.parse(buildBossIntelPayload({ bossName: "The Grave Warden", progress: { encounters: 6, kills: 4, currentStreak: 2, bestStreak: 3, intelLevel: 1, heartUpgradeLevel: 1, alternateFormUnlocked: false } }));
assert.match(progressIntel.embed.fields.at(-1).value, /4\/6 kills • Best streak 3/);
assert.match(progressIntel.embed.fields.at(-1).value, /Heart 1\/3 • Intel 1\/5/);
const resultInput = { mapCfg: { key: "plagued_cemetary", label: "Cemetery", bossName: "The Grave Warden", lootTier: "Low" }, fallbackTension: "medium", armyIconUrl: "https://example.com/army.png" };
const result = JSON.parse(buildRaidResultPayload({ ...resultInput, result: { loot: [{ id: "scrap", qty: 2 }, { id: "scrap", qty: 3 }, { id: "chaos_staff", qty: 1 }] } }));
assert.match(result.embed.fields.find((field: { name: string }) => field.name === "Rewards").value, /Net: \+0 FN Token/);
assert.match(result.embed.fields.find((field: { name: string }) => field.name === "Rewards").value, /Loot: 6 items/);
const lootField = result.embed.fields.find((field: { name: string }) => field.name === "Recovered Loot").value;
assert.ok(lootField.indexOf(ITEM_DEFS.chaos_staff.name) < lootField.indexOf(ITEM_DEFS.scrap.name));
assert.match(lootField, /5x/);
assert.ok(result.components[0].components.some((button: { custom_id: string }) => button.custom_id === `${RAID_RESULT_ACTION_IDS.mastery}:plagued_cemetary`));
assert.ok(result.components[0].components.some((button: { custom_id: string }) => button.custom_id === RAID_RESULT_ACTION_IDS.supplies));
const largeResult = JSON.parse(buildRaidResultPayload({ ...resultInput, result: { loot: Object.keys(ITEM_DEFS).map(id => ({ id, qty: 1 })) } }));
assertDiscordEmbed(largeResult.embed);
assert.match(largeResult.embed.fields.find((field: { name: string }) => field.name === "Recovered Loot").value, /more stacks in inventory/);
const bossResult = JSON.parse(buildRaidResultPayload({ ...resultInput, result: { bossSpawned: true, bossName: "Sister Vell" } }));
assert.equal(bossResult.bossPortraitName, "Sister Vell");
assert.equal(bossResult.embed.thumbnail.url, getBossPortraitUrl("Sister Vell"));
assert.equal(result.bossPortraitName, undefined, "a raid without a boss must not attach an unrelated portrait");
async function runInteractionTests(): Promise<void> {
    const sourceText = fs.readFileSync(path.resolve(__dirname, "../bot.ts"), "utf8");
    const source = ts.createSourceFile("bot.ts", sourceText, ts.ScriptTarget.ES2020, true);
    const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && ["awaitRaidDecision", "presentBossBattle"].includes(statement.name?.text || ""));
    assert.equal(functions.length, 2);
    const compiled = ts.transpileModule(functions.map(statement => statement.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    async function simulate(input: { actions?: string[]; medPatches?: number; result?: Record<string, unknown>; failEdit?: number }) {
        const decisions = new Map();
        const actions = [...(input.actions || [])];
        const frames: Array<{ components: unknown[]; embeds: Array<{ fields: Array<{ name: string; value: string }> }>; files?: unknown[]; attachments?: unknown[] }> = [];
        const renderFailures: string[] = [];
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
            getBossAttackIntent,
            getBossPortraitFiles,
            isBossBattleFinished,
            resolveBossTurn,
            buildBossBattlePayload,
            embedFromPayload: (_command: string, embed: unknown) => embed,
            getInventoryCount: () => supplies,
            removeInventoryItem: (_userId: string, _item: string, count: number) => { supplies -= count; consumed += count; },
            console: { error: (message: string) => renderFailures.push(message) },
            appendAuditEvent: () => undefined,
            toSafeString: String
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
            editReply: async (frame: typeof frames[number]) => {
                edits += 1;
                if (edits === input.failEdit) throw new Error("Discord edit failed");
                frames.push(frame);
                return message;
            }
        };
        const battle = await context.presentBossBattle(interaction, { success: true, bossName: "The Grave Warden", bossHpMax: 10000, bossHpRemaining: 300, pmcHpMax: 600, pmcHpRemaining: 100, bossPhaseNames: ["Contact", "Enraged"], ...input.result });
        assert.equal(decisions.size, 0);
        return { battle, frames, waits, consumed, acknowledged, renderFailures };
    }
    const extracted = await simulate({ actions: [RAID_ENCOUNTER_IDS.extract] });
    assert.equal(extracted.waits, 1);
    assert.equal(extracted.frames.length, 2);
    assert.equal(extracted.acknowledged, 1);
    assert.equal(extracted.consumed, 0);
    assert.equal(extracted.battle.defeated, false);
    assert.equal(extracted.frames.at(-1)?.components.length, 0);
    assert.equal(extracted.frames[0].files?.length, 1, "first battle frame must upload the bundled portrait");
    assert.equal(extracted.frames[0].attachments?.length, 0, "first battle frame must discard stale attachments");
    assert.equal(extracted.frames[1].files, undefined, "later turns must reuse the uploaded portrait");
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
    assert.ok(timeout.frames.some(frame => frame.embeds[0].fields.some(field =>
        field.value.includes("Countercharge this turn:")
    )), "players must see the attack warning before choosing");
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
    assert.equal(failedFinalEdit.renderFailures.length, 1, "battle rendering failures must be surfaced");
    const broadcastHelpers = source.statements.filter(statement =>
        ts.isFunctionDeclaration(statement) && ["sendOpsBroadcastEmbed", "buildRaidUnlockBroadcastEmbed"].includes(statement.name?.text || "")
    );
    assert.equal(broadcastHelpers.length, 2);
    const sent: Array<{ embeds: EmbedBuilder[]; files: ReturnType<typeof getBossPortraitFiles> }> = [];
    const broadcastContext = vm.createContext({
        EmbedBuilder,
        getBossPortraitUrl,
        getBossPortraitFiles,
        getOpsBroadcastChannelId: () => "broadcast-channel",
        ARMY_ICON_URL: "https://example.com/army.png",
        ITEM_DEFS,
        brandLiveEmbed: (embed: EmbedBuilder) => embed
    });
    vm.runInContext(ts.transpileModule(broadcastHelpers.map(statement => statement.getText(source)).join("\n"), {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, broadcastContext);
    const broadcast = broadcastContext as {
        buildRaidUnlockBroadcastEmbed: (input: { user: { id: string; username: string }; result: { bossName: string; bossHeartUnlockedName: string } }) => EmbedBuilder;
        sendOpsBroadcastEmbed: (guild: unknown, embed: EmbedBuilder, bossName: string) => Promise<void>;
    };
    const bossName = "Asterion the Titanbreaker";
    const embed = broadcast.buildRaidUnlockBroadcastEmbed({
        user: { id: "player", username: "player" }, result: { bossName, bossHeartUnlockedName: "Titan Heart" }
    });
    await broadcast.sendOpsBroadcastEmbed({
        id: "guild", channels: { fetch: async () => ({
            isTextBased: () => true,
            send: async (payload: typeof sent[number]) => { sent.push(payload); }
        }) }
    }, embed, bossName);
    assert.equal(sent[0].embeds[0].toJSON().thumbnail?.url, getBossPortraitUrl(bossName));
    assert.equal(sent[0].files[0].name, getBossPortraitFiles(bossName)[0].name, "broadcast must include the image it references");
}

runInteractionTests().then(() => console.log("raid quality-of-life and interaction tests passed")).catch(error => {
    console.error(error);
    process.exitCode = 1;
});