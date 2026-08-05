/* eslint-disable no-console */
const assert = require("assert/strict");

require("ts-node/register/transpile-only");

const bossHearts = require("../src/game/bossHearts");
const utils = require("../src/utils");
const payloads = require("../src/game/payloads");

function run() {
  const heart = bossHearts.getBossHeartDefinition("Dreadwake Morvane (Hull Reaper)");
  assert.ok(heart, "Expected heart definition for titled boss variant");
  assert.equal(heart.id, "heart_dreadwake_morvane", "Expected canonical Dreadwake heart id");

  const dynamicHeart = bossHearts.getBossHeartDefinition("Prototype Nemesis IX (Omega Frame)");
  assert.ok(dynamicHeart, "Expected dynamic heart fallback for undefined boss");
  assert.ok(dynamicHeart.id.startsWith("heart_dynamic_"), "Expected dynamic heart id prefix");

  const tier1000 = utils.getPmcTierForLevel(1000);
  const tier4000 = utils.getPmcTierForLevel(4000);
  const tier20000 = utils.getPmcTierForLevel(20000);
  assert.equal(tier1000?.label, "Iron Vanguard", "Expected level 1000 tier");
  assert.equal(tier4000?.label, "Steel Warlord", "Expected level 4000 tier");
  assert.equal(tier20000?.label, "Mythic Overlord", "Expected level 20000 tier");

  const raidPayloadRaw = payloads.buildRaidResultPayload({
    result: {
      success: true,
      net: 420,
      loot: [
        { id: "enhanced_rail_sniper", qty: 1 },
        { id: "starforged_reaper", qty: 1 }
      ],
      rxpGain: 88,
      successChance: 41,
      mapLabel: "FN MegaYachtolopolis",
      tension: "high | Night Operation",
      bossSpawned: true,
      bossDefeated: true,
      bossName: "Dreadwake Morvane",
      bossTitle: "Hull Reaper",
      bossFerocity: 1.82,
      bossBonusXp: 144,
      bossKillChance: 29,
      bossHeartUnlockedName: "Dreadwake Morvane's Heart",
      pmcTierUnlockedLabel: "Steel Warlord",
      pmcTierUnlockedBadge: "⚔️",
      selectedWeaponName: "Enhanced Rail Sniper",
      selectedArmorName: "Titan Carapace"
    },
    mapCfg: { label: "FN MegaYachtolopolis", bossName: "Dreadwake Morvane", lootTier: "Luxury Tech / High-End" },
    fallbackTension: "high",
    armyIconUrl: "https://example.com/icon.png"
  });

  const raidPayload = JSON.parse(raidPayloadRaw);
  assert.ok(Array.isArray(raidPayload.components), "Expected raid payload follow-up components");
  assert.ok((raidPayload.embed.fields || []).some(field => field.name === "Premium Event Flags"), "Expected premium event flags field");
  assert.ok((raidPayload.embed.fields || []).some(field => field.name === "Boss Encounter"), "Expected cinematic boss encounter field");

  console.log("Premium verification passed.");
  console.log("- Boss heart normalization checks: 2");
  console.log("- PMC milestone checks: 3");
  console.log("- Premium raid payload checks: 3");
}

run();
