import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import * as discord from "discord.js";
import * as features from "../features/ownerPanel";
import * as settings from "../features/botSettings";
import * as controls from "../game/ownerControls";
import * as persistence from "./jsonPersistence";
import { ModerationQuotaStore } from "./moderationQuotas";
import { getAccessPointBadge } from "../bot/pmc/visuals";
import type { UserState } from "../utils";

type TestUtils = {
    points: Record<string, UserState>; ensureUser(id: string): UserState;
    applyOwnerValueChange(change: controls.OwnerValueChange): void; addXP(id: string, amount: number): number;
    savePoints(): void; applyPmcMilestoneRewards(id: string): { claimed: number[] };
};
async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fnt-owner-"));
    const actor = "807001514287169587", otherOwner = "402639384756879360", guildId = "1560000000000000001", target = "1560000000000000002";
    const channelId = "1569954324136722562";
    const errors: unknown[] = [];
    try {
        let failSave = false;
        const utilsFile = path.resolve(__dirname, "..", "utils.ts");
        const nativeRequire = createRequire(utilsFile);
        const exports: Record<string, unknown> = {};
        const utilsContext = vm.createContext({ exports, module: { exports }, __dirname: path.join(directory, "src"), process: { env: { ...process.env, RUNTIME_TEST_NO_POINTS_SAVE: "0" } },
            console, structuredClone, Buffer, Error, require: (id: string) => id === "./runtime/jsonPersistence" ? {
                ...persistence, writeJsonSnapshotSync: (file: string, data: unknown) => {
                    if (failSave) throw new Error("Injected save failure");
                    persistence.writeJsonSnapshotSync(file, data);
                }
            } : nativeRequire(id) });
        vm.runInContext(ts.transpileModule(fs.readFileSync(utilsFile, "utf8"), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
        }).outputText, utilsContext);
        const utils = exports as unknown as TestUtils;
        const user = utils.ensureUser(target);
        const receipt = (field: controls.OwnerValueField, operation: controls.OwnerValueOperation, amount: number): controls.OwnerValueChange => ({
            id: randomUUID(), actorId: actor, guildId, targetId: target, field, operation, amount,
            before: user[field], after: controls.previewOwnerValue(user[field], operation, amount), reason: "Owner regression test", at: Date.now()
        });
        for (const invalid of ["", "-1", "1.5", "1e3", "1,000", "NaN", "01", String(controls.OWNER_VALUE_MAX + 1)]) assert.throws(() => controls.parseOwnerAmount(invalid));
        assert.equal(controls.parseOwnerAmount("0"), 0);
        assert.equal(controls.parseOwnerAmount("1000000000000"), controls.OWNER_VALUE_MAX);
        assert.throws(() => controls.previewOwnerValue(0, "remove", 1));
        assert.throws(() => controls.previewOwnerValue(controls.OWNER_VALUE_MAX, "add", 1));
        for (const field of Object.keys(controls.OWNER_VALUE_FIELDS) as controls.OwnerValueField[]) {
            utils.applyOwnerValueChange(receipt(field, "set", 2000));
            utils.applyOwnerValueChange(receipt(field, "remove", 500));
            utils.applyOwnerValueChange(receipt(field, "add", 250));
            assert.equal(user[field], 1750, field);
        }
        assert.equal(user.rxp, user.pmcXP);
        const duplicate = receipt("xp", "set", 100);
        utils.applyOwnerValueChange(duplicate);
        assert.throws(() => utils.applyOwnerValueChange(duplicate), /already been applied/);
        assert.equal(utils.addXP(target, 1), 101, "normal XP gains must not resurrect the old disk balance after an owner reduction");
        await persistence.flushJsonWrites();
        const stale = receipt("modPoints", "add", 1);
        user.modPoints++;
        assert.throws(() => utils.applyOwnerValueChange(stale), /changed after the preview/);
        assert.throws(() => utils.applyOwnerValueChange({ ...receipt("xp", "set", 1), actorId: "invalid" }), /receipt/);
        const snapshot = JSON.stringify(user);
        failSave = true;
        assert.throws(() => utils.applyOwnerValueChange(receipt("xp", "set", 1_000_000_000)), /Injected/);
        assert.equal(JSON.stringify(user), snapshot, "failed writes must roll back achievements and balances with the receipt");
        failSave = false;
        utils.applyOwnerValueChange(receipt("pmcXP", "set", 1_000_000_000_000));
        const inventory = JSON.stringify(user.inventory);
        assert.equal(utils.applyPmcMilestoneRewards(target).claimed.length, 0, "admin XP must not create deferred milestone rewards");
        assert.equal(JSON.stringify(user.inventory), inventory);
        const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource(): string };
        const botSource = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
        const roleFunctions = botSource.statements.filter(node => ts.isFunctionDeclaration(node)
            && ["enqueueXpRoleSync", "drainXpRoleSyncQueue"].includes(node.name?.text || ""));
        assert.equal(roleFunctions.length, 2);
        const appliedXp: number[] = [];
        const queueContext = vm.createContext({ XP_ROLE_SYNC_PAUSED: false, XP_ROLE_SYNC_QUEUE_RUNNING: false, XP_ROLE_SYNC_QUEUE: [],
            ensureUser: () => ({ xp: 25 }), appendAuditEvent: () => undefined, runAsyncWithBoundary: () => undefined,
            syncXpRolesForUserInGuild: async (_guild: unknown, _id: string, xp: number) => { appliedXp.push(xp); return true; },
            updateXpRoleSyncMetrics: () => undefined, addXpRoleDeadLetter: () => { throw new Error("Unexpected dead letter"); } });
        vm.runInContext(ts.transpileModule(roleFunctions.map(fn => fn.getText(botSource)).join("\n"), {
            compilerOptions: { target: ts.ScriptTarget.ES2020 }
        }).outputText, queueContext);
        queueContext.enqueueXpRoleSync({ id: guildId }, target, 900000);
        await queueContext.drainXpRoleSyncQueue();
        assert.deepEqual(appliedXp, [25], "role sync must use authoritative lowered XP, never a stale job/dead-letter value");
        for (let i = 0; i < 55; i++) utils.applyOwnerValueChange(receipt("modPoints", "add", 1));
        assert.equal(user.ownerValueChanges?.length, 50);
        for (const [ap, word] of [[0, "Recruit"], [249, "Recruit"], [250, "Operator"], [499, "Operator"], [500, "Veteran"], [999, "Veteran"], [1000, "Elite"]] as const) {
            assert.ok(getAccessPointBadge(ap).label.startsWith(word), `AP ${ap} badge must remain ${word}`);
        }
        const base: features.OwnerWorkspace = { id: randomUUID(), actorId: actor, guildId, expiresAt: Date.now() + 100_000,
            page: "home", targetId: target, field: "xp", operation: "set", quotaScope: "member", quotaUserId: target, quotaAction: "ban", period: "month", feature: "messageXp", reward: "messageXp" };
        function validatePayload(payload: { components: Array<{ toJSON(): { components: Array<{ custom_id?: string }> } }> }) {
            assert.ok(payload.components.length <= 5);
            const ids = payload.components.flatMap(row => {
                const components = row.toJSON().components;
                assert.ok(components.length <= 5);
                return components.map(component => component.custom_id).filter(Boolean);
            });
            assert.equal(new Set(ids).size, ids.length, "message custom IDs must be unique");
            for (const id of ids) assert.ok(id!.length <= 100);
        }
        validatePayload(features.buildOwnerLauncher());
        for (const page of ["home", "values", "quotas", "features", "guardrails"] as const) validatePayload(features.buildOwnerWorkspace({ ...base, page }, "Test"));
        validatePayload(features.buildOwnerConfirmation(base, randomUUID(), "Confirm"));
        assert.equal(features.buildOwnerModal(base, "amount_modal", "Amount", "Integer").toJSON().components.length, 2);

        const botSettingsStore = new settings.BotSettingsStore(path.join(directory, "settings.json"), settings.defaultBotSettings({ modAlerts: "1", xpPanels: "2", checkpointCards: "3" }));
        const quotaStore = new ModerationQuotaStore(path.join(directory, "quota.json"));
        const panelExports: Record<string, any> = {};
        const roleJobs: unknown[] = [];
        let leaderboardUpdates = 0, panelSends = 0, panelEdits = 0;
        let storedPanelId: string | null = null;
        const panelMessages = new discord.Collection<string, { id: string; author: { id: string }; embeds: Array<{ title: string }>; edit(payload: unknown): Promise<unknown> }>();
        const panelChannel = {
            type: discord.ChannelType.GuildText,
            messages: { fetch: async (request: string | { limit: number }) => typeof request === "string" ? panelMessages.get(request) : panelMessages },
            send: async (payload: ReturnType<typeof features.buildOwnerLauncher>) => {
                panelSends++;
                const message = { id: "owner-launcher", author: { id: "bot" }, embeds: [{ title: payload.embeds[0].toJSON().title! }],
                    edit: async () => { panelEdits++; return message; } };
                panelMessages.set(message.id, message);
                return message;
            }
        };
        let isBot = false, admin = true, raid = false;
        const panelContext = vm.createContext({ Error, exports: panelExports, module: { exports: panelExports }, console: { error: (...args: unknown[]) => errors.push(args) },
            require: (id: string) => {
                if (id === "node:crypto") return { randomUUID };
                if (id === "discord.js") return discord;
                if (id === "../../features/ownerPanel") return features;
                if (id === "../../features/botSettings") return settings;
                if (id === "../../game/ownerControls") return controls;
                if (id === "../../utils") return { ...utils, getPointsSaveHealth: () => ({ lastError: "" }) };
                if (id === "../core/config") return { OWNER_PANEL_CHANNEL_ID: channelId, OWNER_PANEL_USER_IDS: [actor, otherOwner] };
                if (id === "../core/audit") return { appendAuditEvent: () => undefined };
                if (id === "../core/settings") return { botSettingsStore, applyRewardSettings: () => undefined };
                if (id === "../moderation/store") return {
                    getGuildPanelMessageId: () => storedPanelId,
                    setGuildPanelMessageId: (_guildId: string, key: string, messageId: string) => {
                        assert.equal(key, "owner"); storedPanelId = messageId;
                    }
                };
                if (id === "../moderation/quotas") return { getModerationQuotaStore: () => quotaStore };
                if (id === "../xp/roles") return { enqueueXpRoleSync: (...args: unknown[]) => roleJobs.push(args) };
                if (id === "./xpPanels") return { scheduleXpLeaderboardUpdate: () => { leaderboardUpdates++; } };
                if (id === "../raid/raids") return { activeRaidEncounters: { has: () => raid } };
                if (id === "../../runtime/rateLimit") return { rejectIfRateLimited: () => null };
                if (id === "../pmc/visuals") return { getAccessPointBadge };
                throw new Error(`Unexpected dependency ${id}`);
            } });
        vm.runInContext(ts.transpileModule(`${fs.readFileSync(path.resolve(__dirname, "..", "bot", "panels", "owner.ts"), "utf8")}\nexports.sessions = ownerSessions;`, {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
        }).outputText, panelContext);
        const sessions = panelExports.sessions as Map<string, features.OwnerWorkspace & { pending?: { id: string } }>;
        const guild = { id: guildId, client: { user: { id: "bot" } },
            channels: { fetch: async (requestedId: string) => {
                assert.equal(requestedId, channelId, "Owner launcher must only be posted in its designated channel");
                return panelChannel;
            } },
            members: { fetch: async ({ user, force }: { user: string; force: boolean }) => {
            assert.equal(force, true); return { id: user, user: { bot: isBot }, permissions: { has: () => admin } };
        } } };
        await Promise.all([panelExports.ensureOwnerPanelForGuild(guild), panelExports.ensureOwnerPanelForGuild(guild)]);
        assert.equal(panelSends, 1, "concurrent startup/health checks must not duplicate the owner launcher");
        assert.equal(panelEdits, 1);
        assert.equal(storedPanelId, "owner-launcher");
        storedPanelId = null;
        await panelExports.ensureOwnerPanelForGuild(guild);
        assert.equal(panelSends, 1, "missing saved IDs must reuse the existing owner launcher");
        async function run(kind: "button" | "select" | "user" | "modal", action: string, options: { user?: string; channel?: string; dm?: boolean; values?: string[]; fields?: Record<string, string> } = {}) {
            const replies: any[] = [];
            const interaction = { customId: `owner:${action}`, user: { id: options.user || actor }, guild: options.dm ? null : guild,
                guildId, channelId: options.channel || channelId, values: options.values || [],
                message: { flags: { has: () => true } }, isButton: () => kind === "button", isStringSelectMenu: () => kind === "select",
                isUserSelectMenu: () => kind === "user", isModalSubmit: () => kind === "modal", isFromMessage: () => true,
                fields: { getTextInputValue: (key: string) => options.fields?.[key] || "" }, deferred: false, replied: false,
                deferUpdate: async () => { interaction.deferred = true; }, deferReply: async () => { interaction.deferred = true; },
                reply: async (payload: unknown) => { interaction.replied = true; replies.push(payload); }, editReply: async (payload: unknown) => replies.push(payload),
                showModal: async (modal: unknown) => replies.push(modal) };
            assert.equal(await panelExports.handleOwnerInteraction(interaction), true);
            return replies.at(-1);
        }
        for (const action of ["start", "confirm:fake:fake", "amount_modal:fake"]) {
            const payload = await run(action.includes("modal") ? "modal" : "button", action, { user: target });
            assert.match(payload.content, /restricted/);
            assert.equal(payload.flags, discord.MessageFlags.Ephemeral);
        }
        assert.match((await run("button", "start", { channel: "wrong" })).content, /restricted/);
        assert.match((await run("button", "start", { dm: true })).content, /restricted/);
        assert.equal((await run("button", "start")).flags, discord.MessageFlags.Ephemeral);
        const session = [...sessions.values()][0];
        assert.match((await run("button", `home:${session.id}`, { user: otherOwner })).content, /belongs to someone else/);
        await run("select", `page:${session.id}`, { values: ["values"] });
        await run("user", `player:${session.id}`, { values: [target] });
        isBot = true;
        assert.match((await run("modal", `amount_modal:${session.id}`, { fields: { value: "25", reason: "Test" } })).content, /Bot accounts/);
        isBot = false;
        await run("modal", `amount_modal:${session.id}`, { fields: { value: "25", reason: "Test" } });
        let token = session.pending!.id;
        const successful = await run("button", `confirm:${session.id}:${token}`);
        assert.match(successful.content, /change saved/);
        assert.equal(user.xp, 25);
        assert.equal(roleJobs.length, 1);
        assert.equal(leaderboardUpdates, 1, "confirmed Server XP changes must refresh the live leaderboard");
        assert.match((await run("button", `confirm:${session.id}:${token}`)).content, /already used/);
        await run("modal", `amount_modal:${session.id}`, { fields: { value: "1", reason: "Test" } });
        token = session.pending!.id;
        user.xp++;
        assert.match((await run("button", `confirm:${session.id}:${token}`)).content, /changed after the preview/);
        assert.equal(leaderboardUpdates, 1, "replayed and stale confirmations must not trigger leaderboard updates");
        raid = true;
        assert.match((await run("modal", `amount_modal:${session.id}`, { fields: { value: "1", reason: "Test" } })).content, /active raid/);
        raid = false;
        await run("select", `page:${session.id}`, { values: ["quotas"] });
        await run("select", `quota_kind:${session.id}`, { values: ["ban_month"] });
        await run("modal", `quota_modal:${session.id}`, { fields: { value: "1", reason: "One monthly ban" } });
        token = session.pending!.id;
        await run("button", `confirm:${session.id}:${token}`);
        assert.equal(quotaStore.getPolicy(guildId, "ban").limit, 1);
        assert.equal(quotaStore.getPolicy(guildId, "ban").period, "month");
        for (const action of ["ban", "kick"] as const) {
            for (const period of ["day", "week", "month"] as const) {
                await run("select", `quota_kind:${session.id}`, { values: [`${action}_${period}`] });
                await run("modal", `quota_modal:${session.id}`, { fields: { value: "2", reason: "Test each quota timeframe" } });
                await run("button", `confirm:${session.id}:${session.pending!.id}`);
                const policy = quotaStore.getPolicy(guildId, action);
                assert.equal(policy.limit, 2);
                assert.equal(policy.period, period);
            }
        }
        await run("select", `scope:${session.id}`, { values: ["member"] });
        admin = false;
        assert.match((await run("user", `quota_user:${session.id}`, { values: [target] })).content, /Choose an administrator/);
        admin = true;
        await run("user", `quota_user:${session.id}`, { values: [target] });
        await run("modal", `quota_modal:${session.id}`, { fields: { value: "0", reason: "Block" } });
        token = session.pending!.id;
        admin = false;
        assert.match((await run("button", `confirm:${session.id}:${token}`)).content, /no longer an administrator/);
        admin = true;
        await run("select", `page:${session.id}`, { values: ["features"] });
        await run("modal", `feature_modal:${session.id}`, { fields: { value: "disabled", reason: "Pause message XP" } });
        await run("button", `confirm:${session.id}:${session.pending!.id}`);
        assert.equal(botSettingsStore.get().features.messageXp, false);
        await run("modal", `reward_modal:${session.id}`, { fields: { value: "999999", reason: "Invalid" } });
        assert.equal(botSettingsStore.get().rewards.messageXp, 100);
        session.expiresAt = Date.now() - 1;
        assert.match((await run("button", `refresh:${session.id}`)).content, /expired/);
        console.log("Owner Control: arithmetic, durable corrections, rollback, AP tiers, UI, authorization, replay, quota and settings checks passed.");
    } finally {
        await persistence.flushJsonWrites();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
