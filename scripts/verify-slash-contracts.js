/* eslint-disable no-console */
require("ts-node/register/transpile-only");

const { buildSlashCommands } = require("../src/commands/slashCatalog");
const { RAID_MAP_CHOICES, RAID_CONDITIONS } = require("../src/raid/domain");

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function run() {
  const commands = buildSlashCommands({
    raidConditionChoices: RAID_CONDITIONS.map(condition => ({ name: condition.label, value: condition.key })),
    raidMapChoices: RAID_MAP_CHOICES
  });

  const names = commands.map(command => command.name).filter(Boolean);
  const uniqueNames = new Set(names);
  const errors = [];

  assert(names.length > 0, "No slash commands were generated.", errors);
  assert(names.length === uniqueNames.size, "Duplicate slash command names detected.", errors);

  for (const command of commands) {
    const json = command.toJSON();
    assert(Boolean(json.name), "Command is missing name.", errors);
    assert(Boolean(json.description), `Command ${json.name || "unknown"} is missing description.`, errors);
    assert((json.description || "").length <= 100, `Command ${json.name} description exceeds Discord limit.`, errors);
  }

  const required = [
    "raid",
    "raidintel",
    "tradeoffer",
    "ticket",
    "ticketassign",
    "ticketstatus",
    "claimticket",
    "resolveticket",
    "health",
    "incident"
  ];

  for (const name of required) {
    assert(uniqueNames.has(name), `Missing required slash command: ${name}`, errors);
  }

  if (errors.length > 0) {
    console.error("Slash contract verification failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Slash contract verification passed.");
  console.log(`- Commands: ${names.length}`);
}

run();
