import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildSlashCommands } from "../commands/slashCatalog";
import { RAID_CONDITIONS, RAID_MAP_CHOICES } from "../raid/domain";

function runXpRoleRecoveryTests(): void {
    const botSource = fs.readFileSync(path.resolve(__dirname, "../bot.ts"), "utf8");
    const commands = buildSlashCommands({
        raidConditionChoices: RAID_CONDITIONS.map(condition => ({ name: condition.label, value: condition.key })),
        raidMapChoices: RAID_MAP_CHOICES
    }).map(command => command.toJSON());

    const xprolesync = commands.find(command => command.name === "xprolesync");
    assert.ok(xprolesync, "xprolesync command must exist");
    const optionNames = new Set((xprolesync.options || []).map(option => option.name));
    for (const name of ["pause", "retry", "config_xp", "config_role", "config_name"]) {
        assert.ok(optionNames.has(name), `xprolesync must expose ${name}`);
    }

    const rolesanity = commands.find(command => command.name === "rolesanity");
    assert.ok(rolesanity, "rolesanity command must exist");
    assert.ok((rolesanity.options || []).some(option => option.name === "dry_run"), "rolesanity dry_run option must remain available");

    assert.match(botSource, /XP_ROLE_METRICS_FILE/, "XP role metrics must have a persistent file");
    assert.match(botSource, /readJsonWithBackup\(XP_ROLE_METRICS_FILE/, "XP role metrics must load from disk");
    assert.match(botSource, /writeJsonAtomic\(XP_ROLE_METRICS_FILE/, "XP role metrics must save atomically");
    assert.match(botSource, /clearXpRoleDeadLetter\(guild\.id, userId\)/, "successful sync must clear recovered dead letters");
    assert.match(botSource, /await retryXpRoleDeadLetters\(\);/, "startup must replay XP role dead letters");
    assert.match(botSource, /xp_role_post_mutation_verify_failed/, "role mutations must be verified after Discord writes");
    assert.match(botSource, /Dry-Run Member Diff/, "rolesanity must show member-level dry-run diffs");
    assert.match(botSource, /formatXpRoleUnlocks\(interaction\.user\.id, 5\)/, "xpstats must show recent XP role unlocks");
}

runXpRoleRecoveryTests();
console.log("XP role recovery tests passed");
