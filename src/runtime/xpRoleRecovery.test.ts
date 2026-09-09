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

    assert.match(botSource, /const MESSAGE_XP_GAIN = 3;/, "message XP gain must be increased to 3");

    const tierMatches = Array.from(botSource.matchAll(/\{ xp: (\d+), roleId: "(\d+)", name: "([^"]+)" \}/g));
    assert.equal(tierMatches.length, 31, "expected 31 configured XP role tiers");
    const tiers = tierMatches.map(match => ({ xp: Number(match[1]), roleId: match[2], name: match[3] }));
    for (let i = 1; i < tiers.length; i++) {
        assert.ok(tiers[i].xp > tiers[i - 1].xp, `tier thresholds must strictly increase (${tiers[i - 1].name} -> ${tiers[i].name})`);
    }
    const recruitOne = tiers.find(tier => tier.name === "Recruit I");
    const titanCommander = tiers.find(tier => tier.name === "Titan Commander");
    assert.equal(recruitOne?.xp, 360000, "Recruit I must require 360,000 XP (3x the prior threshold)");
    assert.equal(titanCommander?.xp, 2520000, "Titan Commander must require 2,520,000 XP (3x the prior threshold)");
    const roleIds = new Set(tiers.map(tier => tier.roleId));
    assert.equal(roleIds.size, 31, "tier role IDs must remain unique so existing Discord roles are reused, not duplicated");

    assert.match(botSource, /function formatXpTierDisplayName\(entry: XpRoleEntry\): string \{\s*return `\$\{entry\.name\} \[\$\{entry\.xp\.toLocaleString\(\)\} XP\]`;/, "display name helper must format thresholds with thousands separators");
    assert.match(botSource, /if \(role\.name !== displayName\) \{/, "ensureXpTierRoles must detect a stale Discord role name");
    assert.match(botSource, /role\.setName\(displayName, `XP tier threshold updated to \$\{entry\.xp\}`\)/, "ensureXpTierRoles must rename the live Discord role when the threshold changes");
}

runXpRoleRecoveryTests();
console.log("XP role recovery tests passed");
