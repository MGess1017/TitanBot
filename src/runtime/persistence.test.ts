import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { spawn } from "node:child_process";
import { EmbedBuilder } from "discord.js";
import {
    flushJsonWrites, getJsonSaveFailures, getJsonSaveHealth, queueJsonWrite, readJsonSnapshot
} from "./jsonPersistence";
import { readVoiceSessions, restoreVoiceSession, saveVoiceSessions, type SavedVoiceSession } from "./voiceSessionStore";
import { accrueVoiceXp, getVoiceXpMultiplier, VOICE_XP_DOUBLE_AFTER_MS } from "./voiceXp";

async function run(): Promise<void> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "titan-persistence-"));
    const errors: unknown[][] = [];
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = (...args: unknown[]) => { errors.push(args); };
    console.warn = (...args: unknown[]) => { errors.push(args); };
    try {
        const file = path.join(directory, "store.json");
        const data = { value: 1 };
        queueJsonWrite(file, data);
        assert.equal(fs.existsSync(file), false, "routine saves must not perform synchronous disk writes");
        data.value = 2;
        await flushJsonWrites();
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { value: 1 }, "save must snapshot, not retain mutable data");
        for (let value = 2; value <= 100; value++) queueJsonWrite(file, { value });
        await flushJsonWrites();
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { value: 100 }, "coalesced writes must keep the latest snapshot");
        assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")), { value: 1 }, "backup must retain the previous snapshot");
        assert.equal(getJsonSaveHealth(file).lastError, "");
        queueJsonWrite(file, { value: 101 });
        const inFlight = flushJsonWrites();
        queueJsonWrite(file, { value: 102 });
        await inFlight;
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { value: 102 },
            "a newer save queued during an in-flight write must finish last");
        const adminSource = fs.readFileSync(path.resolve(__dirname, "../bot/commands/admin.ts"), "utf8");
        const adminAst = ts.createSourceFile("admin.ts", adminSource, ts.ScriptTarget.ES2020, true);
        let verifier: ts.ArrowFunction | undefined;
        function findVerifier(node: ts.Node): void {
            if (ts.isPropertyAssignment(node) && node.name.getText(adminAst) === "xpverify" && ts.isArrowFunction(node.initializer)) {
                verifier = node.initializer;
            }
            ts.forEachChild(node, findVerifier);
        }
        findVerifier(adminAst);
        assert.ok(verifier);
        let flushed = false;
        const verifierContext = vm.createContext({
            EmbedBuilder, requireAdministrator: () => null,
            ensureUser: () => ({ voiceMinutes: 0, achievementIds: [], achievements: [] }),
            syncProgressAchievements: () => undefined,
            flushJsonWrites: async () => { flushed = true; },
            getXpPersistenceSnapshot: () => {
                assert.equal(flushed, true, "XP verification must await queued writes before reading disk");
                return { memoryXp: 5, primaryXp: 5, backupXp: 100, pointsFileSize: 1, pointsBackupSize: 1 };
            },
            getXPLevel: (xp: number) => xp, getEffectiveXpRoleEntries: () => [],
            toIsoOrNever: () => "never", formatVoiceDuration: () => "0m",
            XP_ACHIEVEMENTS: [], VOICE_ACHIEVEMENTS: [], XP_ROLE_SYNC_METRICS: {},
            readXpRoleDeadLetters: () => []
        });
        vm.runInContext(ts.transpileModule(`this.verify = ${verifier.getText(adminAst)};`, {
            compilerOptions: { target: ts.ScriptTarget.ES2020 }
        }).outputText, verifierContext);
        const verified = JSON.parse(await verifierContext.verify({ options: { getUser: () => ({ id: "test" }) }, guild: null }));
        assert.equal(verified.embed.color, 0x22c55e, "an older backup must not be reported as a persistence mismatch");
        assert.ok(verified.embed.fields[0].value.includes("Effective XP: 5"), "backups must not override a legitimate XP reset");

        const blockedParent = path.join(directory, "blocked");
        fs.writeFileSync(blockedParent, "not a directory");
        const blockedFile = path.join(blockedParent, "save.json");
        queueJsonWrite(blockedFile, { value: "retry me" });
        await assert.rejects(flushJsonWrites(), /Persistence flush failed/);
        assert.ok(getJsonSaveFailures().some(row => row.file === blockedFile));
        assert.ok(getJsonSaveHealth(blockedFile).failures > 0);
        assert.ok(errors.length > 0, "failed writes must be logged");
        const healthSource = fs.readFileSync(path.resolve(__dirname, "../bot/staff/safety.ts"), "utf8");
        const healthAst = ts.createSourceFile("safety.ts", healthSource, ts.ScriptTarget.ES2020, true);
        const healthFunction = healthAst.statements.find(node =>
            ts.isFunctionDeclaration(node) && node.name?.text === "runStaffHealthCheck");
        assert.ok(healthFunction);
        const saveHealth = new Map<string, { lastError: string }>();
        const healthContext = vm.createContext({
            botSettingsStore: { get: () => ({}) }, getPrimaryGuild: () => null,
            client: { isReady: () => true }, getPointsSaveHealth: () => ({ lastError: "" }),
            SAVE_HEALTH: saveHealth, getJsonSaveFailures, clampText: (value: string) => value,
            ASYNC_FAILURES: [], PROCESS_STARTED_AT: Date.now(), lastHealthIssues: []
        });
        vm.runInContext(ts.transpileModule(healthFunction.getText(healthAst).replace(/^export /, ""), {
            compilerOptions: { target: ts.ScriptTarget.ES2020 }
        }).outputText, healthContext);
        for (const legacyEntries of [0, 2]) {
            for (let index = 0; index < legacyEntries; index++) saveHealth.set(`legacy-${index}`, { lastError: "" });
            const health = await healthContext.runStaffHealthCheck("test");
            assert.equal(health.issues.filter((issue: { key: string }) => issue.key === `save:${blockedFile}`).length, 1,
                "every failing async store must appear once in staff health, independently of other save registries");
        }
        fs.unlinkSync(blockedParent);
        fs.mkdirSync(blockedParent);
        await flushJsonWrites();
        assert.deepEqual(JSON.parse(fs.readFileSync(blockedFile, "utf8")), { value: "retry me" }, "failed snapshots must survive for retry");
        assert.equal(getJsonSaveHealth(blockedFile).lastError, "", "successful retry must clear active health failure");

        const corrupt = path.join(directory, "corrupt.json");
        fs.writeFileSync(corrupt, "{bad");
        fs.writeFileSync(`${corrupt}.bak`, "{also bad");
        fs.writeFileSync(`${corrupt}.bak.2`, '{"value":42}');
        const parse = (raw: unknown): { value: number } | null => raw && typeof raw === "object"
            && "value" in raw && typeof raw.value === "number" ? { value: raw.value } : null;
        assert.deepEqual(readJsonSnapshot(corrupt, parse, { value: 0 }), { value: 42 });
        assert.deepEqual(JSON.parse(fs.readFileSync(corrupt, "utf8")), { value: 42 }, "recovery must repair the primary before rotating backups again");
        const preserved = fs.readdirSync(directory).find(name => name.startsWith("corrupt.json.corrupt."));
        assert.ok(preserved, "recovery must preserve corrupt files for investigation");
        assert.equal(fs.readFileSync(path.join(directory, preserved), "utf8"), "{bad");
        fs.writeFileSync(corrupt, "{bad");
        fs.unlinkSync(`${corrupt}.bak.2`);
        assert.throws(() => readJsonSnapshot(corrupt, parse, { value: 0 }), /refusing to reset/);
        assert.deepEqual(readJsonSnapshot(path.join(directory, "new.json"), parse, { value: 0 }), { value: 0 });

        const voiceFile = path.join(directory, "voice.json");
        const saved: SavedVoiceSession = {
            guildId: "guild", userId: "user", connected: true,
            elapsedMs: VOICE_XP_DOUBLE_AFTER_MS + 60_000, remainderMs: 15_000, doubleXpNotified: true
        };
        saveVoiceSessions(voiceFile, [saved]);
        await flushJsonWrites();
        const reloaded = readVoiceSessions(voiceFile)[0];
        const now = 100_000_000;
        const restored = restoreVoiceSession(reloaded, true, now);
        assert.equal(getVoiceXpMultiplier(restored.connectedAt, now), 2, "restart must preserve an unlocked bonus");
        assert.equal(restored.doubleXpNotified, true, "restart must not repeat a sent unlock DM");
        assert.equal(accrueVoiceXp(restored, now).xp, 0, "offline time must never award catch-up XP");
        assert.equal(accrueVoiceXp(restored, now + 60_000).xp, 200);
        const beforeThreshold = restoreVoiceSession({ ...saved, elapsedMs: VOICE_XP_DOUBLE_AFTER_MS - 60_000 }, true, now);
        assert.equal(getVoiceXpMultiplier(beforeThreshold.connectedAt, now), 1, "offline time must not advance the unlock timer");
        assert.equal(getVoiceXpMultiplier(beforeThreshold.connectedAt, now + 60_001), 2);
        const disconnected = restoreVoiceSession(saved, false, now);
        assert.equal(disconnected.connected, false);
        assert.equal(getVoiceXpMultiplier(disconnected.connectedAt, now), 1);
        const rejoined = restoreVoiceSession({ ...saved, connected: false }, true, now);
        assert.equal(getVoiceXpMultiplier(rejoined.connectedAt, now), 1, "an observed disconnect must survive a restart");
        assert.equal(rejoined.doubleXpNotified, false);
        assert.equal(rejoined.remainderMs, 15_000, "earned partial minutes must be retained");
        fs.writeFileSync(path.join(directory, "invalid-voice.json"), '{"version":1,"sessions":[{"elapsedMs":-1}]}');
        assert.throws(() => readVoiceSessions(path.join(directory, "invalid-voice.json")), /refusing to reset/);

        const checkpointSource = fs.readFileSync(path.resolve(__dirname, "../bot/core/checkpoint.ts"), "utf8");
        const ast = ts.createSourceFile("checkpoint.ts", checkpointSource, ts.ScriptTarget.ES2020, true);
        const helper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "runCheckpointSaves");
        assert.ok(helper);
        const context = vm.createContext({ console: { error: (...args: unknown[]) => errors.push(args) } });
        vm.runInContext(ts.transpileModule(helper.getText(ast).replace(/^export /, ""), {
            compilerOptions: { target: ts.ScriptTarget.ES2020 }
        }).outputText, context);
        const calls: string[] = [];
        const failed = context.runCheckpointSaves("test", {
            first: () => { calls.push("first"); throw new Error("disk full"); },
            second: () => { calls.push("second"); return false; },
            third: () => { calls.push("third"); }
        });
        assert.deepEqual(calls, ["first", "second", "third"], "one failed store must not skip the remaining stores");
        assert.deepEqual(Array.from(failed), ["first", "second"]);

        // A separate process must persist its latest snapshot before a signal-driven exit.
        const childFile = path.join(directory, "shutdown.json");
        const moduleFile = path.resolve(__dirname, "jsonPersistence.ts");
        const script = `
            const { queueJsonWrite, flushJsonWrites } = require(${JSON.stringify(moduleFile)});
            queueJsonWrite(${JSON.stringify(childFile)}, { value: "flushed" });
            process.on("SIGTERM", async () => {
                await flushJsonWrites();
                process.exit(0);
            });
            process.emit("SIGTERM");
        `;
        await new Promise<void>((resolve, reject) => {
            const child = spawn(process.execPath, ["-r", "ts-node/register/transpile-only", "-e", script], {
                cwd: path.resolve(__dirname, "..", ".."), stdio: ["ignore", "pipe", "pipe"]
            });
            let output = "";
            child.stdout.on("data", chunk => { output += chunk; });
            child.stderr.on("data", chunk => { output += chunk; });
            child.once("error", reject);
            child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Shutdown test exited ${code}: ${output}`)));
        });
        assert.deepEqual(JSON.parse(fs.readFileSync(childFile, "utf8")), { value: "flushed" });
        assert.equal(fs.readdirSync(directory).some(name => name.endsWith(".tmp")), false);
    } finally {
        console.error = originalError;
        console.warn = originalWarn;
        await flushJsonWrites();
        fs.rmSync(directory, { recursive: true, force: true });
    }
    console.log("asynchronous persistence, recovery, voice restart and shutdown tests passed");
}

void run().catch(error => { console.error(error); process.exitCode = 1; });
