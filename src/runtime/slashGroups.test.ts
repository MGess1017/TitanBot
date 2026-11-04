import assert from "node:assert/strict";
import {
    buildSlashCommands, listSlashCommandKeys, resolveSlashCommandKey, slashCommandUsage, SLASH_COMMAND_GROUPS
} from "../commands/slashCatalog";
import { getCommandKey } from "../bot/commands/keys";
import { RAID_CONDITIONS, RAID_MAP_CHOICES } from "../raid/domain";

const CASINO_GAMES = ["casino", "dice", "roulette", "blackjack", "crash", "magicslots", "coinflip", "baccarat", "hilo", "keno"];

function build() {
    return buildSlashCommands({
        raidConditionChoices: RAID_CONDITIONS.map(condition => ({ name: condition.label, value: condition.key })),
        raidMapChoices: RAID_MAP_CHOICES
    });
}

const commands = build();
const json = commands.map(command => command.toJSON());
const names = json.map(command => command.name);

assert.ok(names.length <= 100, `slash command count must stay within Discord's limit (got ${names.length})`);
assert.equal(new Set(names).size, names.length, "slash command names must be unique");
for (const game of CASINO_GAMES.filter(game => game !== "casino")) {
    assert.ok(!names.includes(game), `/${game} must be folded into /casino`);
}

const keys = listSlashCommandKeys(commands);
assert.equal(new Set(keys).size, keys.length, "every internal command key must be reachable exactly once");
for (const game of CASINO_GAMES) assert.ok(keys.includes(game), `${game} must remain reachable`);

const casino = json.find(command => command.name === "casino");
assert.ok(casino, "/casino must exist");
assert.equal(casino.default_member_permissions ?? null, null, "/casino must stay available to every member");
const subcommands = new Map((casino.options || []).map(option => [option.name, option as { type: number; options?: Array<{ name: string; required?: boolean }> }]));
assert.equal(subcommands.size, Object.keys(SLASH_COMMAND_GROUPS.casino.subcommands).length);
assert.ok([...subcommands.values()].every(option => option.type === 1), "casino entries must be subcommands");
assert.deepEqual(subcommands.get("dice")?.options?.map(option => [option.name, option.required]), [["bet", true], ["choice", true]]);
assert.deepEqual(subcommands.get("lobby")?.options?.map(option => [option.name, option.required]), [["bet", false]]);
assert.deepEqual(subcommands.get("slots")?.options?.map(option => option.name), ["bet"]);
assert.deepEqual(subcommands.get("keno")?.options?.map(option => option.name), ["bet", "picks"]);

assert.equal(resolveSlashCommandKey("casino", "dice"), "dice");
assert.equal(resolveSlashCommandKey("casino", "slots"), "magicslots");
assert.equal(resolveSlashCommandKey("casino", "lobby"), "casino");
assert.equal(resolveSlashCommandKey("casino", "unknown"), "casino");
assert.equal(resolveSlashCommandKey("raid", null), "raid");
assert.equal(slashCommandUsage("magicslots"), "casino slots");
assert.equal(slashCommandUsage("casino"), "casino lobby");
assert.equal(slashCommandUsage("raid"), "raid");

const fakeInteraction = (commandName: string, subcommand: string | null) => ({
    commandName,
    options: { getSubcommand: (required?: boolean) => { assert.equal(required, false); return subcommand; } }
}) as unknown as Parameters<typeof getCommandKey>[0];
assert.equal(getCommandKey(fakeInteraction("casino", "hilo")), "hilo");
assert.equal(getCommandKey(fakeInteraction("xp", null)), "xp");

// Groups must never mix member and admin-only commands, or staff tools would become visible to everyone.
SLASH_COMMAND_GROUPS.mixedtest = { description: "test", subcommands: { dice: "dice", points: "addpoints" } };
try {
    assert.throws(() => build(), /mixes permission levels/);
} finally {
    delete SLASH_COMMAND_GROUPS.mixedtest;
}

console.log("slash command group tests passed");
