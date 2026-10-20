import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { buildSlashCommands } from "../commands/slashCatalog";
import { RAID_CONDITIONS, RAID_MAP_CHOICES } from "../raid/domain";
import { accrueVoiceXp } from "./voiceXp";

async function verifyThresholdRoleApplication(botSource: string): Promise<void> {
    const source = ts.createSourceFile("bot.ts", botSource, ts.ScriptTarget.ES2020, true);
    const functionNames = new Set(["awardEngagementXp", "awardConnectedVoiceXp", "syncMemberXpRoles"]);
    const functions = source.statements.filter(statement =>
        ts.isFunctionDeclaration(statement) && functionNames.has(statement.name?.text || "")
    );
    assert.equal(functions.length, functionNames.size, "shared XP and role sync helpers must exist");

    const roleEntries = [
        { xp: 100, roleId: "role-100", name: "Tier 100" },
        { xp: 200, roleId: "role-200", name: "Tier 200" }
    ];
    const roles = new Map(roleEntries.map((entry, index) => [entry.roleId, { id: entry.roleId, position: index + 1 }]));
    const heldRoles = new Set<string>();
    const users = new Map<string, { xp: number }>();
    const queued: Array<{ guild: unknown; userId: string; xp: number }> = [];
    const syncMetrics = { added: 0, removed: 0, failed: 0 };
    let member: any;
    const botMember = { permissions: { has: () => true }, roles: { highest: { position: 10 } } };
    const guild = {
        id: "test-guild",
        roles: { cache: roles, fetch: async () => roles },
        members: {
            me: botMember,
            fetchMe: async () => botMember,
            fetch: async () => member
        }
    };
    member = {
        id: "test-user",
        guild,
        roles: {
            cache: { has: (roleId: string) => heldRoles.has(roleId) },
            add: async (roleId: string) => { heldRoles.add(roleId); },
            remove: async (roleIds: string[]) => { for (const roleId of roleIds) heldRoles.delete(roleId); }
        }
    };

    const context = vm.createContext({
        PermissionFlagsBits: { ManageRoles: "ManageRoles" },
        ensureUser: (userId: string) => {
            if (!users.has(userId)) users.set(userId, { xp: 0 });
            return users.get(userId)!;
        },
        addXP: (userId: string, amount: number) => {
            const user = users.get(userId) || { xp: 0 };
            user.xp += amount;
            users.set(userId, user);
            return user.xp;
        },
        getEffectiveXpRoleEntries: () => roleEntries,
        enqueueXpRoleSync: (targetGuild: unknown, userId: string, xp: number) => queued.push({ guild: targetGuild, userId, xp }),
        notifyXpThresholdUnlock: async () => undefined,
        accrueVoiceXp,
        appendAuditEvent: () => undefined,
        updateXpRoleSyncMetrics: (update: (metrics: typeof syncMetrics) => void) => update(syncMetrics)
    });
    vm.runInContext(ts.transpileModule(functions.map(statement => statement.getText(source)).join("\n"), {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, context);
    const helpers = context as unknown as {
        awardEngagementXp: (guild: unknown, userId: string, amount: number) => { totalXp: number };
        awardConnectedVoiceXp: (session: { guild: unknown; userId: string; connected: boolean; lastAccruedAt: number; remainderMs: number; updatedAt: number }, now: number) => void;
        syncMemberXpRoles: (member: unknown, xp: number, entries: typeof roleEntries) => Promise<void>;
    };

    helpers.awardEngagementXp(guild, "test-user", 99);
    assert.equal(queued.length, 0, "no XP role should sync before its threshold");
    helpers.awardEngagementXp(guild, "test-user", 1);
    assert.equal(queued.at(-1)?.xp, 100, "message XP crossing a tier must enqueue role sync");
    await helpers.syncMemberXpRoles(member, queued.at(-1)!.xp, roleEntries);
    assert.ok(heldRoles.has("role-100"), "crossing the first threshold must apply its configured role");

    helpers.awardEngagementXp(guild, "test-user", 100);
    assert.equal(queued.at(-1)?.xp, 200, "crossing the next threshold must enqueue the higher tier");
    await helpers.syncMemberXpRoles(member, queued.at(-1)!.xp, roleEntries);
    assert.ok(heldRoles.has("role-200"), "crossing the next threshold must apply its configured role");
    assert.ok(!heldRoles.has("role-100"), "rank roles remain mutually exclusive after promotion");

    const voiceSession = { guild, userId: "voice-user", connected: true, lastAccruedAt: 0, remainderMs: 0, updatedAt: 0 };
    helpers.awardConnectedVoiceXp(voiceSession, 60_000);
    assert.equal(users.get("voice-user")?.xp, 100, "one voice minute must contribute 100 total XP");
    assert.equal(queued.at(-1)?.userId, "voice-user", "voice XP crossing a tier must enqueue role sync");
    await helpers.syncMemberXpRoles(member, queued.at(-1)!.xp, roleEntries);
    assert.ok(heldRoles.has("role-100"), "voice XP threshold crossing must apply the configured role");
}

async function runXpRoleRecoveryTests(): Promise<void> {
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

    assert.match(botSource, /const MESSAGE_XP_GAIN = 100;/, "each message must award 100 XP");
    assert.match(botSource, /GatewayIntentBits\.GuildVoiceStates/, "voice XP tracking requires the voice-state gateway intent");
    assert.match(botSource, /const TEMP_VOICE_CATEGORY_ID = "1523417152441421888";/, "temporary voice rooms must use the configured category");
    assert.match(botSource, /setCustomId\(TEMP_VOICE_PANEL_BUTTON_ID\)/, "the VC panel must expose its create button");
    assert.match(botSource, /member\.voice\.setChannel\(room\.id/, "the creator must be moved into their room");
    assert.match(botSource, /channel\.members\.size > 0\) return/, "non-empty temporary rooms must remain open");
    assert.match(botSource, /channel\.delete\("Temporary voice room is empty"\)/, "empty temporary rooms must be deleted");

    const partialVoiceMinute = accrueVoiceXp({ lastAccruedAt: 0, remainderMs: 0 }, 30_000);
    assert.equal(partialVoiceMinute.xp, 0, "partial voice minutes must not award XP early");
    assert.equal(partialVoiceMinute.state.remainderMs, 30_000, "partial voice time must be retained");
    const resumedVoiceMinute = accrueVoiceXp({ lastAccruedAt: 90_000, remainderMs: partialVoiceMinute.state.remainderMs }, 120_000);
    assert.equal(resumedVoiceMinute.xp, 100, "one accumulated connected minute must award 100 XP");
    assert.equal(resumedVoiceMinute.state.remainderMs, 0, "awarded voice minutes must clear their remainder");
    const longVoiceSession = accrueVoiceXp({ lastAccruedAt: 0, remainderMs: 0 }, 180_000);
    assert.equal(longVoiceSession.xp, 300, "voice accrual must award every complete minute");

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

    await verifyThresholdRoleApplication(botSource);

    assert.match(botSource, /function formatXpTierDisplayName\(entry: XpRoleEntry\): string \{\s*return `\$\{entry\.name\} \[\$\{entry\.xp\.toLocaleString\(\)\} XP\]`;/, "display name helper must format thresholds with thousands separators");
    assert.match(botSource, /if \(role\.name !== displayName\) \{/, "ensureXpTierRoles must detect a stale Discord role name");
    assert.match(botSource, /role\.setName\(displayName, `XP tier threshold updated to \$\{entry\.xp\}`\)/, "ensureXpTierRoles must rename the live Discord role when the threshold changes");
}

void runXpRoleRecoveryTests().then(() => {
    console.log("XP role recovery tests passed");
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
