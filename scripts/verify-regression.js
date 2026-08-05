/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
require("ts-node/register/transpile-only");

const { buildSlashCommands } = require("../src/commands/slashCatalog");
const { RAID_MAP_CHOICES, RAID_CONDITIONS } = require("../src/raid/domain");

const BOT_FILE = path.resolve(__dirname, "../src/bot.ts");
const source = fs.readFileSync(BOT_FILE, "utf8");

const adminCommands = [
  "addpoints",
  "pointsuser",
  "timeout",
  "kick",
  "ban",
  "setmodlog",
  "modconfig",
  "warn",
  "warnings",
  "clearwarnings",
  "tempban",
  "purge",
  "health",
  "incident",
  "xpverify",
  "rolesanity",
  "ticketsanity"
  ,"announce"
];

const failures = [];

const slashCommands = buildSlashCommands({
  raidConditionChoices: RAID_CONDITIONS.map(condition => ({ name: condition.label, value: condition.key })),
  raidMapChoices: RAID_MAP_CHOICES
});
const slashByName = new Map(slashCommands.map(command => [command.name, command.toJSON()]));

for (const name of adminCommands) {
  const slash = slashByName.get(name);
  if (!slash || !slash.default_member_permissions) {
    failures.push(`Slash command '${name}' is missing Administrator default permission.`);
  }

  const runtimeGate = new RegExp(`${name}\\s*:\\s*async\\s+interaction\\s*=>\\s*\\{[\\s\\S]{0,240}?requireAdministrator\\(interaction\\)`);
  if (!runtimeGate.test(source)) {
    failures.push(`Handler '${name}' is missing runtime requireAdministrator(interaction) guard.`);
  }
}

const legacyPatterns = [
  { re: /setName\("setmodrole"\)/, label: "legacy setmodrole slash command" },
  { re: /\bsetmodrole\s*:\s*async\s+interaction\s*=>/, label: "legacy setmodrole handler" },
  { re: /\bmodRoleId\b/, label: "legacy modRoleId state" },
  { re: /Access Points threshold/, label: "legacy threshold moderation reason text" }
];

for (const pattern of legacyPatterns) {
  if (pattern.re.test(source)) {
    failures.push(`Found ${pattern.label}.`);
  }
}

if (failures.length > 0) {
  console.error("Regression verification failed.");
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}

console.log("Regression verification passed.");
console.log(`- Admin command guards checked: ${adminCommands.length}`);
console.log(`- Legacy overlap checks: ${legacyPatterns.length}`);
