import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DiscordAPIError, PermissionFlagsBits } from "discord.js";
import { ModerationQuotaStore, moderationQuotaWindow, type ModerationQuotaRequest } from "./moderationQuotas";
import { authorizeModerationAction, executeModerationQuotaAction, getModerationQuotaStore, isDefiniteModerationRejection } from "../bot/moderation/quotas";

async function run(): Promise<void> {
    const directory = path.resolve(`.moderation-quota-tests-${randomUUID()}`);
    fs.mkdirSync(directory);
    const originalSrcDir = process.env.BOT_SRC_DIR;
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = () => undefined;
    console.warn = () => undefined;
    let assertions = 0;
    function check(test: () => void): void { test(); assertions++; }
    try {
        let now = Date.parse("2026-11-11T23:59:59.000Z");
        const file = path.join(directory, "quotas.json");
        const store = new ModerationQuotaStore(file, () => now);
        const request = (id: string, userId = "admin", action: "ban" | "kick" = "ban"): ModerationQuotaRequest => ({
            guildId: "guild", userId, ownerId: "server-owner", targetId: "target", action, requestId: id
        });
        check(() => assert.equal(store.getPolicy("guild", "ban", "admin").limit, null));
        check(() => assert.equal(store.getPolicy("guild", "ban", "admin").source, "default"));
        store.setPolicy("guild", "ban", null, { limit: 1, period: "day" }, { actorId: "owner-panel", reason: "Test policy" });
        check(() => assert.equal(store.getPolicy("guild", "ban", "admin").inherited, true));
        check(() => assert.equal(store.audit("guild")[0].actorId, "owner-panel"));
        check(() => assert.equal(store.audit("guild")[0].reason, "Test policy"));
        const first = store.reserve(request("one"));
        assert.ok(first.allowed);
        check(() => assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).reservations[0].status, "pending"));
        const secondStore = new ModerationQuotaStore(file, () => now);
        check(() => assert.equal(secondStore.reserve(request("two")).allowed, false));
        store.finish(first.reservation.id, "succeeded");
        check(() => assert.equal(store.reserve(request("one")).allowed, false));
        check(() => assert.equal(store.inspect("guild", "ban", "admin").remaining, 0));
        check(() => assert.equal(store.reserve(request("different-admin", "other-admin")).allowed, true));
        check(() => assert.equal(store.reserve(request("other-action", "admin", "kick")).allowed, true));
        check(() => assert.equal(store.reserve({ ...request("other-guild"), guildId: "other-guild" }).allowed, true));
        store.setPolicy("guild", "ban", "admin", { limit: null, period: "week" });
        check(() => assert.equal(store.getPolicy("guild", "ban", "admin").source, "override"));
        check(() => assert.equal(store.getPolicy("guild", "ban", "admin").limit, null));
        check(() => assert.equal(store.reserve(request("unlimited-override")).allowed, true));
        store.setPolicy("guild", "ban", "admin", null);
        check(() => assert.equal(store.getPolicy("guild", "ban", "admin").source, "guild"));
        store.setPolicy("guild", "ban", null, { limit: 0, period: "day" });
        check(() => assert.equal(store.reserve(request("zero", "new-admin")).allowed, false));
        check(() => assert.equal(store.reserve(request("panel-owner", "owner-panel")).allowed, false));
        const owner = store.reserve(request("real-owner", "server-owner"));
        assert.ok(owner.allowed);
        check(() => assert.equal(owner.reservation.exempt, true));
        check(() => assert.equal(store.inspect("guild", "ban", "server-owner").used, 0));
        store.setPolicy("guild", "ban", null, { limit: 1, period: "day" });
        now = Date.parse("2026-11-12T00:00:00Z");
        check(() => assert.equal(store.inspect("guild", "ban", "admin").used, 0));
        const nextDay = store.reserve(request("next-day"));
        assert.ok(nextDay.allowed);
        store.finish(nextDay.reservation.id, "rejected", "Missing permissions");
        check(() => assert.equal(store.inspect("guild", "ban", "admin").remaining, 1));
        const uncertain = store.reserve(request("uncertain"));
        assert.ok(uncertain.allowed);
        store.finish(uncertain.reservation.id, "uncertain", "Network reset");
        check(() => assert.equal(new ModerationQuotaStore(file, () => now).inspect("guild", "ban", "admin").uncertain, 1));
        check(() => assert.equal(store.reserve(request("uncertain-again")).allowed, false));
        check(() => assert.throws(() => store.finish(uncertain.reservation.id, "rejected")));
        check(() => assert.deepEqual(moderationQuotaWindow("week", Date.parse("2026-11-15T23:59:59Z")), {
            start: Date.parse("2026-11-09T00:00:00Z"), end: Date.parse("2026-11-16T00:00:00Z")
        }));
        check(() => assert.equal(moderationQuotaWindow("week", Date.parse("2026-11-16T00:00:00Z")).start, Date.parse("2026-11-16T00:00:00Z")));
        check(() => assert.deepEqual(moderationQuotaWindow("month", Date.parse("2026-12-31T23:59:59Z")), {
            start: Date.parse("2026-12-01T00:00:00Z"), end: Date.parse("2027-01-01T00:00:00Z")
        }));
        check(() => assert.deepEqual(moderationQuotaWindow("month", Date.parse("2028-02-29T12:00:00Z")), {
            start: Date.parse("2028-02-01T00:00:00Z"), end: Date.parse("2028-03-01T00:00:00Z")
        }));
        check(() => assert.throws(() => store.setPolicy("guild", "ban", "admin", { limit: -1, period: "day" })));
        check(() => assert.throws(() => store.setPolicy("guild", "ban", "admin", { limit: 0.1, period: "day" })));
        check(() => assert.throws(() => store.setPolicy("guild", "ban", null, null), /explicit policy/));
        check(() => assert.equal(store.getPolicy("guild", "ban").limit, 1));
        const detached = store.history("guild");
        detached[0].status = "rejected";
        check(() => assert.equal(store.history("guild", { userId: "admin", status: "uncertain" }).length, 1));
        store.setPolicy("guild", "ban", null, { limit: 1, period: "month" });
        check(() => assert.ok(store.inspect("guild", "ban", "admin").used >= 3, "policy changes must re-count persisted history, not reset it"));

        const wrapperFile = path.join(directory, "wrapper.json");
        const wrapperStore = new ModerationQuotaStore(wrapperFile, () => now);
        wrapperStore.setPolicy("guild", "ban", null, { limit: 1, period: "day" });
        let finishDiscord!: () => void;
        let calls = 0;
        const inFlight = executeModerationQuotaAction(request("concurrent-1"), async () => {
            calls++;
            assert.equal(new ModerationQuotaStore(wrapperFile).history("guild")[0].status, "pending", "reservation must be on disk before Discord");
            await new Promise<void>(resolve => { finishDiscord = resolve; });
        }, wrapperStore);
        const blocked = await executeModerationQuotaAction(request("concurrent-2"), async () => { calls++; }, wrapperStore);
        check(() => assert.equal(blocked.ok, false));
        check(() => assert.equal(calls, 1));
        finishDiscord();
        const completed = await inFlight;
        check(() => assert.equal(completed.ok, true));
        const discordError = new DiscordAPIError({ message: "Missing Permissions", code: 50013 }, 50013, 403, "POST", "/test", {});
        check(() => assert.equal(isDefiniteModerationRejection(discordError), true));
        check(() => assert.equal(isDefiniteModerationRejection(new Error("ECONNRESET")), false));
        const rejected = await executeModerationQuotaAction(request("rejection", "rejected-admin"), async () => { throw discordError; }, wrapperStore);
        check(() => assert.equal(rejected.ok, false));
        check(() => assert.equal(wrapperStore.inspect("guild", "ban", "rejected-admin").used, 0));
        const network = await executeModerationQuotaAction(request("network", "network-admin"), async () => { throw new Error("ECONNRESET"); }, wrapperStore);
        check(() => assert.equal(network.ok, false));
        check(() => assert.equal(wrapperStore.inspect("guild", "ban", "network-admin").uncertain, 1));
        check(() => assert.equal(new ModerationQuotaStore(wrapperFile, () => now).inspect("guild", "ban", "network-admin").used, 1));
        const pending = wrapperStore.reserve(request("interrupted", "crash-admin"));
        assert.ok(pending.allowed);
        check(() => assert.equal(new ModerationQuotaStore(wrapperFile, () => now).inspect("guild", "ban", "crash-admin").pending, 1));
        const finalizeFile = path.join(directory, "finalize.json");
        const finalizeStore = new ModerationQuotaStore(finalizeFile, () => now);
        const finalizeFailure = await executeModerationQuotaAction(request("finalize"), async () => {
            fs.writeFileSync(`${finalizeFile}.lock`, "occupied");
        }, finalizeStore);
        check(() => assert.equal(finalizeFailure.ok, false));
        check(() => assert.equal(finalizeFailure.discordSucceeded, true));
        check(() => assert.equal(finalizeStore.history("guild")[0].status, "pending"));
        check(() => assert.match(finalizeFailure.message!, /owner inspection/i));
        fs.unlinkSync(`${finalizeFile}.lock`);
        fs.writeFileSync(`${wrapperFile}.lock`, "occupied");
        const locked = await executeModerationQuotaAction(request("lock"), async () => { calls++; }, wrapperStore);
        check(() => assert.equal(locked.ok, false));
        fs.unlinkSync(`${wrapperFile}.lock`);
        const failedWrite = new ModerationQuotaStore(path.join(directory, "unwritable", "quota.json"), () => now);
        fs.writeFileSync(path.join(directory, "unwritable"), "not a directory");
        const failedReservation = await executeModerationQuotaAction(request("persist-failure"), async () => { calls++; }, failedWrite);
        check(() => assert.equal(failedReservation.ok, false));
        check(() => assert.equal(calls, 1));

        const corrupt = path.join(directory, "corrupt.json");
        fs.copyFileSync(wrapperFile, `${corrupt}.bak`);
        fs.writeFileSync(corrupt, "{broken");
        check(() => assert.throws(() => new ModerationQuotaStore(corrupt)));
        check(() => assert.equal(fs.readFileSync(corrupt, "utf8"), "{broken"));
        fs.unlinkSync(corrupt);
        check(() => assert.throws(() => new ModerationQuotaStore(corrupt)));
        fs.writeFileSync(corrupt, JSON.stringify({ version: 1, policies: [], reservations: [{}], audit: [] }));
        check(() => assert.throws(() => new ModerationQuotaStore(corrupt)));
        const snapshot = JSON.parse(fs.readFileSync(wrapperFile, "utf8"));
        snapshot.reservations.push(snapshot.reservations[0]);
        fs.writeFileSync(corrupt, JSON.stringify(snapshot));
        check(() => assert.throws(() => new ModerationQuotaStore(corrupt)));
        fs.writeFileSync(wrapperFile, "corrupt-after-startup");
        const corruption = await executeModerationQuotaAction(request("runtime-corruption"), async () => { calls++; }, wrapperStore);
        check(() => assert.equal(corruption.ok, false));
        check(() => assert.equal(calls, 1));

        process.env.BOT_SRC_DIR = path.join(directory, "source-root");
        check(() => assert.equal(getModerationQuotaStore().file, path.join(directory, "src", "data", "moderation-quotas.json")));
        check(() => assert.equal(getModerationQuotaStore(), getModerationQuotaStore()));
        await testAuthorization();
        await testTempbanIntegration(directory);
        console.log(`Moderation quotas: ${assertions} checks plus authorization checks passed.`);
    } finally {
        if (originalSrcDir === undefined) delete process.env.BOT_SRC_DIR;
        else process.env.BOT_SRC_DIR = originalSrcDir;
        console.error = originalError;
        console.warn = originalWarn;
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

async function testAuthorization(): Promise<void> {
    let actorAdmin = true;
    let actorPosition = 3;
    let botPosition = 5;
    let botPermission = true;
    let freshActor = false;
    const target = { id: "target", roles: { highest: {} }, bannable: true, kickable: true };
    const actor = {
        id: "actor", permissions: { has: (permission: bigint) => actorAdmin && permission === PermissionFlagsBits.Administrator },
        roles: { highest: { comparePositionTo: () => actorPosition } }
    };
    const guild = {
        id: "guild", ownerId: "owner",
        fetch: async () => guild,
        members: {
            fetch: async (options: { user: string; force: boolean }) => {
                assert.equal(options.force, true);
                if (options.user === "actor") { freshActor = true; return actor; }
                return target;
            },
            fetchMe: async (options: { force: boolean }) => {
                assert.equal(options.force, true);
                return { id: "bot", permissions: { has: () => botPermission }, roles: { highest: { comparePositionTo: () => botPosition } } };
            }

        }
    };
    const interaction = { guild, user: { id: "actor" } } as unknown as Parameters<typeof authorizeModerationAction>[0];
    assert.ok("member" in await authorizeModerationAction(interaction, "target", "ban"));
    assert.equal(freshActor, true);
    actorAdmin = false;
    assert.ok("error" in await authorizeModerationAction(interaction, "target", "ban"));
    actorAdmin = true;
    assert.ok("error" in await authorizeModerationAction(interaction, "actor", "ban"));
    assert.ok("error" in await authorizeModerationAction(interaction, "owner", "ban"));
    actorPosition = 0;
    assert.ok("error" in await authorizeModerationAction(interaction, "target", "kick"));
    actorPosition = 3;
    botPosition = 0;
    assert.ok("error" in await authorizeModerationAction(interaction, "target", "ban"));
    botPosition = 5;
    botPermission = false;
    assert.ok("error" in await authorizeModerationAction(interaction, "target", "kick"));
}

async function testTempbanIntegration(directory: string): Promise<void> {
    const ts = await import("typescript");
    const vm = await import("node:vm");
    const sourcePath = path.resolve(__dirname, "..", "commands", "moderationCommands.ts");
    const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, "utf8"), ts.ScriptTarget.ES2020, true);
    let tempban: import("typescript").ArrowFunction | undefined;
    function find(node: import("typescript").Node): void {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === "tempban" && ts.isArrowFunction(node.initializer)) tempban = node.initializer;
        ts.forEachChild(node, find);
    }
    find(source);
    assert.ok(tempban);
    const store = new ModerationQuotaStore(path.join(directory, "tempban.json"));
    store.setPolicy("guild", "ban", null, { limit: 1, period: "month" });
    let bans = 0, schedules = 0, logs = 0;
    const context = vm.createContext({
        deps: {
            requireAdministrator: () => null, rejectIfDuplicateCommand: () => null, parseDurationMs: () => 60000,
            authorizeModerationAction: async () => ({ guild: { id: "guild", ownerId: "owner" }, member: { ban: async () => { bans++; } } }),
            executeModerationQuotaAction: (request: Parameters<typeof executeModerationQuotaAction>[0], perform: () => Promise<unknown>) => executeModerationQuotaAction(request, perform, store),
            sendModLog: async () => { logs++; }
        },
        setTimeout: () => { schedules++; },
        interaction: { id: "tempban-1", user: { id: "admin" }, guild: { id: "guild", members: {} }, guildId: "guild",
            options: { getUser: () => ({ id: "target", username: "Target" }), getString: (name: string) => name === "duration" ? "1m" : "Test" } }
    });
    vm.runInContext(ts.transpileModule(`this.tempban = ${tempban.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
    assert.match(await context.tempban(context.interaction), /temp-banned/);
    context.interaction.id = "tempban-2";
    assert.match(await context.tempban(context.interaction), /quota is exhausted/);
    assert.equal(bans, 1, "tempban must not bypass ban quotas");
    assert.equal(schedules, 1, "a quota-rejected ban must never schedule an unban");
    assert.equal(logs, 1, "a quota-rejected ban must not log a successful tempban");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
