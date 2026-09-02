/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
require("ts-node/register/transpile-only");

const { buildSlashCommands } = require("../src/commands/slashCatalog");
const { BOSS_HEART_DEFS, ITEM_DEFS } = require("../src/game/catalog");
const { RAID_RESULT_ACTION_IDS } = require("../src/game/payloads");
const { RAID_APPROACHES, RAID_BOSS_ROSTER, RAID_MAPS, RAID_MAP_CHOICES, RAID_CONDITIONS } = require("../src/raid/domain");

const BOT_FILE = path.resolve(__dirname, "../src/bot.ts");

function readBotSource() {
  return fs.readFileSync(BOT_FILE, "utf8");
}

function uniq(list) {
  return Array.from(new Set(list));
}

function parseSlashCommands() {
  const slashCommands = buildSlashCommands({
    raidConditionChoices: RAID_CONDITIONS.map(condition => ({ name: condition.label, value: condition.key })),
    raidMapChoices: RAID_MAP_CHOICES
  });
  return uniq(slashCommands.map(command => command.name).filter(Boolean));
}

function parseCommandHandlers(handlerBlock) {
  const regex = /^\s{4}([a-z0-9_]+):\s+async\s*(?:\(\)|interaction)\s*=>/gm;
  return uniq(Array.from(handlerBlock.matchAll(regex)).map(m => m[1]));
}

function parseCommandSet(source, setName) {
  const setRegex = new RegExp(`const\\s+${setName}\\s*=\\s*new\\s+Set\\(\\[([^\\]]*)\\]\\)`);
  const match = source.match(setRegex);
  if (!match) return [];
  const items = [];
  const itemRegex = /"([a-z0-9_]+)"/g;
  for (const entry of match[1].matchAll(itemRegex)) {
    items.push(entry[1]);
  }
  return uniq(items);
}

function parseHelpGameCommands(source) {
  const fnRegex = /function\s+helpPageGames\(\)\s*\{[\s\S]*?\}/;
  const fnMatch = source.match(fnRegex);
  if (!fnMatch) return [];
  const cmdRegex = /\/(\w+)/g;
  return uniq(Array.from(fnMatch[0].matchAll(cmdRegex)).map(m => m[1].toLowerCase()));
}

function parseIdObjects(source) {
  const entries = [];
  const objectRegex = /const\s+([A-Z][A-Z0-9_]*_IDS)\s*=\s*\{([\s\S]*?)\}\s*as const;/g;
  const valueRegex = /([a-zA-Z][a-zA-Z0-9]*):\s*"([^"]+)"/g;
  for (const objectMatch of source.matchAll(objectRegex)) {
    for (const valueMatch of objectMatch[2].matchAll(valueRegex)) {
      entries.push({ owner: `${objectMatch[1]}.${valueMatch[1]}`, value: valueMatch[2] });
    }
  }
  return entries;
}

function parseGamesFromSlashBlock(slashBlock) {
  const gameSet = new Set([
    "dice",
    "roulette",
    "blackjack",
    "crash",
    "magicslots",
    "coinflip",
    "baccarat",
    "hilo",
    "keno"
  ]);
  const all = parseSlashCommands(slashBlock);
  return all.filter(cmd => gameSet.has(cmd));
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function assertUniqueRegistry(label, values, errors) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  assert(duplicates.length === 0, `${label} contains duplicate values: ${uniq(duplicates).join(", ")}`, errors);
}

function run() {
  const source = readBotSource();
  const handlerBlock = source.slice(source.indexOf("const commandHandlers"), source.indexOf("client.once("));

  const commands = parseSlashCommands();
  const handlers = parseCommandHandlers(handlerBlock);

  const missingHandlers = commands.filter(cmd => !handlers.includes(cmd));
  const orphanHandlers = handlers.filter(h => !commands.includes(h));

  const gameThemeCommands = parseCommandSet(source, "gameCommands");
  const gamesInSlash = commands.filter(cmd => [
    "dice",
    "roulette",
    "blackjack",
    "crash",
    "magicslots",
    "coinflip",
    "baccarat",
    "hilo",
    "keno"
  ].includes(cmd));
  const helpGameCommands = parseHelpGameCommands(source);

  const requiredGames = [
    "dice",
    "roulette",
    "blackjack",
    "crash",
    "magicslots",
    "coinflip",
    "baccarat",
    "hilo",
    "keno"
  ];

  const errors = [];
  const interactionIds = [
    ...parseIdObjects(source),
    ...Object.entries(RAID_RESULT_ACTION_IDS).map(([key, value]) => ({ owner: `RAID_RESULT_ACTION_IDS.${key}`, value }))
  ];
  const interactionIdOwners = new Map();

  for (const entry of interactionIds) {
    const existingOwner = interactionIdOwners.get(entry.value);
    assert(!existingOwner, `Interaction ID collision '${entry.value}': ${existingOwner} and ${entry.owner}`, errors);
    assert(entry.value.length <= 100, `Interaction ID exceeds Discord's 100-character limit: ${entry.owner}`, errors);
    interactionIdOwners.set(entry.value, entry.owner);
  }

  const registries = [
    ["Item IDs", Object.keys(ITEM_DEFS)],
    ["Boss heart IDs", Object.values(BOSS_HEART_DEFS).map(definition => definition.id)],
    ["Raid map keys", Object.keys(RAID_MAPS)],
    ["Raid approach keys", Object.keys(RAID_APPROACHES)],
    ["Raid condition keys", RAID_CONDITIONS.map(condition => condition.key)],
    ["Raid boss names", RAID_BOSS_ROSTER.map(boss => boss.name)]
  ];

  for (const [label, values] of registries) {
    assertUniqueRegistry(label, values, errors);
  }

  assert(commands.length > 0, "No slash commands were detected.", errors);
  assert(handlers.length > 0, "No command handlers were detected.", errors);
  assert(missingHandlers.length === 0, `Missing handlers for commands: ${missingHandlers.join(", ")}`, errors);
  assert(orphanHandlers.length === 0, `Handlers without slash commands: ${orphanHandlers.join(", ")}`, errors);

  for (const game of requiredGames) {
    assert(gamesInSlash.includes(game), `Game slash command not registered: ${game}`, errors);
    assert(gameThemeCommands.includes(game), `Game command not included in themed game command set: ${game}`, errors);
    assert(helpGameCommands.includes(game), `Game command missing from helpPageGames summary: ${game}`, errors);
  }

  // Sanity-check that embed safety clamps are present.
  assert(source.includes("clampText(field.value || \"-\", 1024)"), "Embed field clamp (1024) is missing from sanitizeEmbedBuilder.", errors);
  assert(source.includes("(raw.fields || []).slice(0, 25)"), "Embed field count clamp (25) is missing from sanitizeEmbedBuilder.", errors);

  if (errors.length > 0) {
    console.error("Contract verification failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Contract verification passed.");
  console.log(`- Slash commands: ${commands.length}`);
  console.log(`- Handlers: ${handlers.length}`);
  console.log(`- Game commands checked: ${requiredGames.length}`);
  console.log(`- Interaction IDs checked: ${interactionIds.length}`);
  console.log(`- Unique registries checked: ${registries.length}`);
}

run();
