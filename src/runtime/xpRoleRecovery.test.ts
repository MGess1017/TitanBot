import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { buildSlashCommands } from "../commands/slashCatalog";
import { getNewProgressAchievements, VOICE_ACHIEVEMENTS, XP_ACHIEVEMENTS } from "../game/achievements";
import { RAID_CONDITIONS, RAID_MAP_CHOICES } from "../raid/domain";
import { accrueVoiceXp } from "./voiceXp";
import { addXP, ensureUser, points, syncProgressAchievements } from "../utils";

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
    const configXpOption = (xprolesync.options || []).find(option => option.name === "config_xp");
    assert.equal(configXpOption?.max_value, 50_000_000, "admin role configuration must be capped at 50M XP");
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
    assert.match(botSource, /Create a private room\. If you are not in voice yet, join any voice channel and click again to move in\./, "the panel must allow room creation before joining voice");
    assert.match(botSource, /const currentSourceChannelId = guild\.voiceStates\.cache\.get\(member\.id\)/, "voice presence must be checked after the room exists");
    assert.match(botSource, /Your room is ready: <#\$\{room\.id\}>\. Join any voice channel, then click Create my VC again to move in\./, "disconnected users must retain their new room and receive next steps");
    assert.match(botSource, /if \(code === "40032"\)/, "disconnect races must be handled without an unhandled move failure");
    assert.match(botSource, /const roomName = `\$\{TEMP_VOICE_CHANNEL_PREFIX\}\$\{safeName\}-\$\{member\.id\}`/, "temporary voice channels must put the username before the unique owner ID");
    assert.match(botSource, /channel\.name\.endsWith\(`-\$\{member\.id\}`\)/, "room reuse must remain tied to its owner if their display name changes");
    assert.match(botSource, /sourceChannel\.permissionsFor\(botMember\).*PermissionFlagsBits\.MoveMembers/, "source-channel move permission must be checked");
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
    assert.equal(tierMatches.length, 43, "expected 31 existing and 12 new XP role tiers");
    const tiers = tierMatches.map(match => ({ xp: Number(match[1]), roleId: match[2], name: match[3] }));
    for (let i = 1; i < tiers.length; i++) {
        assert.ok(tiers[i].xp > tiers[i - 1].xp, `tier thresholds must strictly increase (${tiers[i - 1].name} -> ${tiers[i].name})`);
    }
    const roleDirectoryFunction = ts.createSourceFile("bot.ts", botSource, ts.ScriptTarget.ES2020, true).statements.find(statement =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "buildThemedRoleSections"
    );
    assert.ok(roleDirectoryFunction, "XP role directory grouping helper must exist");
    const roleDirectoryContext = vm.createContext({});
    vm.runInContext(ts.transpileModule(roleDirectoryFunction.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, roleDirectoryContext);
    const roleSections = (roleDirectoryContext as unknown as { buildThemedRoleSections: (lines: string[]) => Array<{ value: string }> })
        .buildThemedRoleSections(tiers.map(tier => `${tier.xp} XP -> ${tier.name}`));
    assert.equal(roleSections.length, 9, "all 43 XP roles must appear in the role directory");
    assert.equal(roleSections.flatMap(section => section.value.split("\n")).length, 43, "role directory must not hide upper tiers");
    const recruitOne = tiers.find(tier => tier.name === "Recruit I");
    const titanCommander = tiers.find(tier => tier.name === "Titan Commander");
    assert.equal(recruitOne?.xp, 360000, "Recruit I must require 360,000 XP (3x the prior threshold)");
    assert.equal(titanCommander?.xp, 2520000, "Titan Commander must require 2,520,000 XP (3x the prior threshold)");
    const roleIds = new Set(tiers.map(tier => tier.roleId));
    assert.equal(roleIds.size, 43, "tier role IDs must remain unique so existing Discord roles are reused, not duplicated");
    const newTierThresholds = tiers.filter(tier => tier.xp > 2520000).map(tier => tier.xp);
    assert.deepEqual(newTierThresholds, [3000000, 7000000, 11000000, 15000000, 19000000, 23000000, 27000000, 31000000, 35000000, 39000000, 44000000, 50000000]);
    const parsedBotSource = ts.createSourceFile("bot.ts", botSource, ts.ScriptTarget.ES2020, true);
    const buildRoleSections = parsedBotSource.statements.find(statement =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "buildThemedRoleSections"
    );
    assert.ok(buildRoleSections, "XP role directory section builder must exist");
    const roleSectionContext = vm.createContext({});
    vm.runInContext(ts.transpileModule(buildRoleSections.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, roleSectionContext);
    const sections = (roleSectionContext as unknown as { buildThemedRoleSections: (lines: string[]) => Array<{ value: string }> })
        .buildThemedRoleSections(tiers.map(tier => `${tier.xp} XP -> ${tier.name}`));
    assert.equal(sections.length, 9, "all 43 XP roles must be displayed in the role directory");
    assert.equal(sections.flatMap(section => section.value.split("\n")).length, tiers.length, "no XP role tiers may be hidden");
    assert.match(botSource, /const MAX_XP_ROLE_THRESHOLD = 50_000_000;/);
    assert.match(botSource, /entry\.xp <= MAX_XP_ROLE_THRESHOLD/);
    assert.equal(XP_ACHIEVEMENTS.length, 30, "exactly 30 engagement XP achievements must be defined");
    assert.equal(VOICE_ACHIEVEMENTS.length, 10, "exactly 10 voice-time achievements must be defined");
    assert.equal(new Set(XP_ACHIEVEMENTS.map(achievement => achievement.id)).size, 30);
    assert.equal(new Set(VOICE_ACHIEVEMENTS.map(achievement => achievement.id)).size, 10);
    for (const achievementSet of [XP_ACHIEVEMENTS, VOICE_ACHIEVEMENTS]) {
        for (let index = 1; index < achievementSet.length; index++) {
            assert.ok(achievementSet[index].threshold > achievementSet[index - 1].threshold, "achievement thresholds must increase strictly");
        }
    }
    assert.equal(XP_ACHIEVEMENTS.at(-1)?.threshold, 50000000, "the final XP achievement must cap progression at 50M");
    assert.equal(getNewProgressAchievements(49999999, 0, []).some(achievement => achievement.id === "xp_50000000"), false);
    assert.equal(getNewProgressAchievements(50000000, 0, []).some(achievement => achievement.id === "xp_50000000"), true);
    assert.equal(getNewProgressAchievements(0, 24999, []).some(achievement => achievement.id === "voice_25000m"), false);
    assert.equal(getNewProgressAchievements(0, 25000, []).some(achievement => achievement.id === "voice_25000m"), true);
    assert.match(botSource, /function mergeXpRoleEntries\(/, "new defaults must merge into already persisted XP role tiers");

    const achievementTestUserId = "__progress_achievement_test__";
    const previousUser = points[achievementTestUserId];
    const previousNoSave = process.env.RUNTIME_TEST_NO_POINTS_SAVE;
    process.env.RUNTIME_TEST_NO_POINTS_SAVE = "1";
    delete points[achievementTestUserId];
    try {
        const user = ensureUser(achievementTestUserId);
        user.xp = 99;
        user.voiceMinutes = 14;
        addXP(achievementTestUserId, 1);
        assert.ok(user.achievementIds.includes("xp_100"), "shared XP awards must unlock XP achievements");
        user.voiceMinutes = 15;
        syncProgressAchievements(achievementTestUserId);
        assert.ok(user.achievementIds.includes("voice_15m"), "voice duration must unlock voice achievements");
        const earnedCount = user.achievementIds.length;
        syncProgressAchievements(achievementTestUserId);
        assert.equal(user.achievementIds.length, earnedCount, "achievement unlocks must be one-time");
        addXP(achievementTestUserId, 50_000_000);
        assert.ok(user.achievementIds.includes("xp_50000000"), "50M XP must award the capstone achievement");
    } finally {
        if (previousUser) points[achievementTestUserId] = previousUser;
        else delete points[achievementTestUserId];
        if (previousNoSave === undefined) delete process.env.RUNTIME_TEST_NO_POINTS_SAVE;
        else process.env.RUNTIME_TEST_NO_POINTS_SAVE = previousNoSave;
    }

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
