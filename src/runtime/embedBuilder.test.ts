import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import * as discord from "discord.js";
import * as features from "../features/embedBuilder";
import { EmbedStudioStore } from "./embedStudioStore";
import { MessageFlags, PermissionFlagsBits, ChannelType } from "discord.js";
import {
    buildStaffEmbedEditor, buildStaffEmbedMessage, buildStaffEmbedModal, buildStaffEmbedPanel,
    STAFF_EMBED_COLORS, STAFF_EMBED_PREFIX, validateStaffEmbedText, type StaffEmbedDraft
} from "../features/embedBuilder";

function draft(): StaffEmbedDraft {
    return {
        id: "draft", ownerId: "staff", guildId: "guild", expiresAt: Date.now() + 100000,
        channelId: "destination", color: "Gold", userIds: ["user"], roleIds: ["role"],
        everyone: false, title: "A title", description: "Message with @everyone in the embed", status: "editing"
    };
}
const sample = draft();
assert.equal(buildStaffEmbedPanel().components.length, 1);
assert.equal(buildStaffEmbedPanel().embeds[0].toJSON().title, "FNTCORD | Staff Embed Studio");
const navigation = ["Home", "Back", "Refresh", "Customize"];
assert.deepEqual(features.buildStaffEmbedBackRow(sample).toJSON().components.map(component => component.label), navigation);
assert.deepEqual(features.buildStaffEmbedHome(sample).components[0].toJSON().components.map(component => "label" in component ? component.label : ""), navigation);
const editor = buildStaffEmbedEditor(sample);
assert.ok(editor.components.length <= 5);
assert.ok(editor.components.every(row => row.components.length <= 5));
assert.deepEqual(editor.allowedMentions.parse, []);
const colors = editor.components[1].toJSON().components[0];
const studioMenu = editor.components[4].toJSON().components[0];
assert.equal(studioMenu.type, 3);
if (studioMenu.type === 3) for (const label of navigation) assert.ok(studioMenu.options.some(option => option.label === label));
assert.equal(colors.type, 3);
if (colors.type === 3) assert.ok(colors.options.every(option => /^[A-Za-z]+$/.test(option.label)));
const message = buildStaffEmbedMessage(sample);
assert.deepEqual(message.allowedMentions, { users: ["user"], roles: ["role"], parse: [], repliedUser: false });
assert.equal(message.embeds[0].toJSON().color, STAFF_EMBED_COLORS.Gold);
assert.equal(buildStaffEmbedMessage({ ...sample, everyone: true }).content, "<@user> <@&role> @everyone");
assert.throws(() => buildStaffEmbedMessage({ ...sample, channelId: null }), /destination/);
assert.throws(() => validateStaffEmbedText(" ", "valid"), /title/);
assert.throws(() => validateStaffEmbedText("valid", "x".repeat(4001)), /message/);
assert.equal(buildStaffEmbedModal(sample).toJSON().components.length, 2);
assert.equal(features.buildStaffEmbedSaveModal(sample).toJSON().components.length, 1);
assert.equal(features.buildStaffEmbedScheduleModal(sample).toJSON().components.length, 2);
const scheduleNow = Date.UTC(2027, 0, 1);
assert.equal(features.parseStaffEmbedSchedule("2027-01-15T18:00-05:00", "America/New_York", scheduleNow).runAt, Date.UTC(2027, 0, 15, 23));
assert.throws(() => features.parseStaffEmbedSchedule("2027-01-15T18:00", "America/New_York", scheduleNow), /explicit UTC offset/);
assert.throws(() => features.parseStaffEmbedSchedule("2027-01-15T18:00-04:00", "America/New_York", scheduleNow), /do not match/);
assert.throws(() => features.parseStaffEmbedSchedule("2027-03-14T02:30-05:00", "America/New_York", scheduleNow), /do not match/);
assert.equal(features.parseStaffEmbedSchedule("2027-11-07T01:30-04:00", "America/New_York", scheduleNow).runAt, Date.UTC(2027, 10, 7, 5, 30));
assert.equal(features.parseStaffEmbedSchedule("2027-11-07T01:30-05:00", "America/New_York", scheduleNow).runAt, Date.UTC(2027, 10, 7, 6, 30));
assert.throws(() => features.parseStaffEmbedSchedule("2027-02-30T12:00Z", "UTC", scheduleNow), /do not match/);
assert.throws(() => features.parseStaffEmbedSchedule("2027-01-15T18:00Z", "Not/A_Zone", scheduleNow), /valid IANA/);
assert.throws(() => features.parseStaffEmbedSchedule("2027-01-01T00:00Z", "UTC", scheduleNow), /future/);

async function main(): Promise<void> {
    const directory = path.resolve(`.embed-studio-tests-${process.pid}`);
    fs.mkdirSync(directory);
    try {
    const file = path.join(directory, "studio.json");
    const store = new EmbedStudioStore(file);
    const blockedParent = path.join(directory, "blocked");
    const blockedStore = new EmbedStudioStore(path.join(blockedParent, "studio.json"));
    fs.writeFileSync(blockedParent, "not a directory");
    const savedConsoleError = console.error;
    try {
        console.error = () => undefined;
        assert.throws(() => blockedStore.create(draft()), /EEXIST|ENOTDIR/);
        assert.throws(() => blockedStore.save("Cannot save", draft()), /EEXIST|ENOTDIR/);
    } finally { console.error = savedConsoleError; }
    assert.equal(blockedStore.history("guild", "staff").length, 0, "failed durable claims cannot authorize a send");
    assert.equal(blockedStore.saved("guild", "staff").length, 0, "failed saves cannot be acknowledged in memory");
    let staff = true;
    let destinationAllowed = true;
    let botAllowed = true;
    let mentionAllowed = false;
    let sendFails = false;
    let sends = 0;
    let ids = 0;
    const member = { id: "staff", permissions: { has: () => mentionAllowed } };
    const destination = {
        id: "destination", type: ChannelType.GuildText,
        permissionsFor: (who: { id: string }) => ({ has: (permission: unknown) =>
            permission === PermissionFlagsBits.MentionEveryone ? mentionAllowed : destinationAllowed && (who.id !== "bot" || botAllowed) }),
        send: async (payload: { enforceNonce: boolean }) => {
            assert.equal(payload.enforceNonce, true);
            sends++; if (sendFails) throw new Error("Send failed");
            return { id: "posted", url: "https://discord.com/channels/1/2/3" };
        }
    };
    const exports: Record<string, any> = {};
    const panelFile = path.resolve("src", "bot", "panels", "embedBuilder.ts");
    let timers = 0;
    let stoppedTimers = 0;
    let storedPanelId: string | null = "legacy";
    let panelWrites = 0;
    const context = vm.createContext({
        Error, exports, module: { exports }, setInterval: () => { timers++; return { unref: () => undefined }; },
        clearInterval: () => { stoppedTimers++; }, console: { error: () => undefined },
        require: (id: string) => {
            if (id === "node:crypto") return { randomUUID: () => `draft-${++ids}` };
            if (id === "node:path") return path;
            if (id === "discord.js") return discord;
            if (id === "../../features/embedBuilder") return features;
            if (id === "../core/config") return { STAFF_EMBED_CHANNEL_ID: "launcher" };
            if (id === "../core/paths") return { BOT_SRC_DIR: "." };
            if (id === "../moderation/store") return {
                getGuildPanelMessageId: () => storedPanelId,
                setGuildPanelMessageId: (_guildId: string, _key: string, id: string) => { storedPanelId = id; panelWrites++; }
            };
            if (id === "../staff/staffDesk") return { isStaffMember: () => staff };
            if (id === "../core/audit") return { appendAuditEvent: () => undefined };
            if (id === "../../runtime/embedStudioStore") return { EmbedStudioStore: class { constructor() { return store; } } };
            throw new Error(`Unexpected dependency ${id}`);
        }
    });
    vm.runInContext(ts.transpileModule(`${fs.readFileSync(panelFile, "utf8")}\nexports.testDrafts = staffEmbedDrafts;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context);
    const drafts = exports.testDrafts as Map<string, StaffEmbedDraft>;
    type Reply = { content?: string; flags?: number; components?: unknown[]; embeds?: discord.EmbedBuilder[] };
    let fields: Record<string, string> = {};
    const guild = { id: "guild", members: {
        fetch: async (request: { user: string; force: boolean }) => {
            assert.equal(request.force, true, "authorization must bypass stale member cache");
            return { ...member, id: request.user };
        }, fetchMe: async () => ({ id: "bot" }) },
        channels: { fetch: async () => destination }, roles: { fetch: async () => ({ id: "role", mentionable: false }) },
        client: { users: { fetch: async () => ({ send: async () => undefined }) } }
    };
    function fake(kind: string, action: string, values: string[] = [], userId = "staff") {
        const replies: Reply[] = [];
        const interaction = {
            customId: `${STAFF_EMBED_PREFIX}${action}`, user: { id: userId },
            guild,
            values, users: new Map([["user", {}]]), roles: new Map([["role", {}]]),
            fields: { getTextInputValue: (key: string) => fields[key] ?? (key === "title" ? "My title" : "My message") },
            deferred: false, replied: false,
            isButton: () => kind === "button", isAnySelectMenu: () => kind.endsWith("select"),
            isModalSubmit: () => kind === "modal", isMessageComponent: () => kind !== "modal",
            isChannelSelectMenu: () => kind === "channel-select", isStringSelectMenu: () => kind === "color-select",
            isMentionableSelectMenu: () => kind === "mention-select", isFromMessage: () => true,
            reply: async (reply: Reply) => { replies.push(reply); },
            update: async (reply: Reply) => { replies.push(reply); },
            deferUpdate: async () => { interaction.deferred = true; },
            editReply: async (reply: Reply) => { replies.push(reply); },
            showModal: async () => { replies.push({ content: "modal" }); }
        };
        return { interaction, replies };
    }
    async function run(kind: string, action: string, values: string[] = [], userId = "staff") {
        const event = fake(kind, action, values, userId);
        assert.equal(await exports.handleStaffEmbedInteraction(event.interaction), true);
        return event;
    }
    await exports.ensureStaffEmbedSchedulerForGuild(guild);
    await exports.ensureStaffEmbedSchedulerForGuild(guild);
    assert.equal(timers, 1, "scheduler lifecycle is independent from public autopanels and idempotent");
    let panelEdits = 0;
    let panelSends = 0;
    const legacyPanel = {
        id: "legacy", author: { id: "bot" }, embeds: [{ title: features.STAFF_EMBED_LEGACY_PANEL_TITLE }],
        edit: async (payload: ReturnType<typeof buildStaffEmbedPanel>) => {
            panelEdits++;
            assert.equal(payload.embeds[0].toJSON().title, features.STAFF_EMBED_PANEL_TITLE);
            return legacyPanel;
        }
    };
    const launcher = {
        type: ChannelType.GuildText,
        messages: { fetch: async (request: unknown) => typeof request === "string" ? legacyPanel : [legacyPanel] },
        send: async () => { panelSends++; return legacyPanel; }
    };
    const panelGuild = { ...guild, channels: { cache: new Map([["launcher", launcher]]) },
        client: { ...guild.client, user: { id: "bot" } } };
    await exports.ensureStaffEmbedPanelForGuild(panelGuild);
    assert.equal(panelEdits, 1, "stored legacy launcher must migrate in place");
    storedPanelId = null;
    await exports.ensureStaffEmbedPanelForGuild(panelGuild);
    assert.equal(panelEdits, 2, "recent legacy launcher must be recovered and migrated");
    assert.equal(panelWrites, 1);
    assert.equal(panelSends, 0, "title migration must not duplicate launchers");
    exports.stopStaffEmbedScheduler("unrelated");
    assert.equal(stoppedTimers, 0);
    exports.stopStaffEmbedScheduler("guild");
    assert.equal(stoppedTimers, 1);
    await exports.ensureStaffEmbedSchedulerForGuild(guild);
    assert.equal(timers, 2, "stopped guild scheduler may restart");
    exports.stopStaffEmbedScheduler();
    assert.equal(stoppedTimers, 2, "shutdown hook stops all scheduler timers");
    staff = false;
    const denied = await run("button", "start");
    assert.match(denied.replies[0].content || "", /staff only/);
    assert.equal(drafts.size, 0);
    staff = true;
    const opened = await run("button", "start");
    assert.equal(opened.replies[0].flags, MessageFlags.Ephemeral);
    const id = [...drafts.keys()][0];
    await run("channel-select", `channel:${id}`, ["destination"]);
    await run("color-select", `color:${id}`, ["Blue"]);
    await run("modal", `save:${id}`);
    assert.equal(drafts.get(id)?.title, "My title");
    assert.equal(sends, 0, "editing must never post an announcement");
    const stolen = await run("button", `publish:${id}`, [], "other-staff");
    assert.match(stolen.replies[0].content || "", /another staff/);
    assert.equal(sends, 0);
    await Promise.all([run("button", `publish:${id}`), run("button", `publish:${id}`)]);
    assert.equal(sends, 1, "simultaneous publish clicks must post only once");
    await run("button", `publish:${id}`);
    assert.equal(sends, 1);
    const receiptHome = await run("button", `home:${id}`);
    assert.match(JSON.stringify(receiptHome.replies[0].embeds), /Private Staff Studio/);
    assert.notEqual([...drafts.keys()][0], id, "receipt navigation must use a fresh draft, not reuse the submitted publication ID");
    assert.equal(sends, 1, "receipt navigation never publishes");
    await run("button", "start");
    const next = [...drafts.keys()][0];
    Object.assign(drafts.get(next)!, { ...draft(), id: next });
    const roleDenied = await run("button", `publish:${next}`);
    assert.match(roleDenied.replies[0].content || "", /cannot be notified/);
    assert.equal(sends, 1, "unmentionable roles cannot be bypassed");
    await run("button", "start");
    const restricted = [...drafts.keys()][0];
    Object.assign(drafts.get(restricted)!, { ...draft(), id: restricted, roleIds: [], userIds: [] });
    destinationAllowed = false;
    await run("button", `publish:${restricted}`);
    assert.equal(sends, 1, "destination permissions must be checked before posting");
    destinationAllowed = true;
    await run("button", "start");
    const failure = [...drafts.keys()][0];
    Object.assign(drafts.get(failure)!, { ...draft(), id: failure, roleIds: [], userIds: [] });
    sendFails = true;
    await run("button", `publish:${failure}`);
    await run("button", `publish:${failure}`);
    assert.equal(sends, 2, "an uncertain failed send must not be retried from the same draft");
    assert.equal(drafts.get(failure)?.status, "failed");
    sendFails = false;
    await run("button", "start");
    const ping = [...drafts.keys()][0];
    Object.assign(drafts.get(ping)!, { ...draft(), id: ping, everyone: true });
    const everyoneDenied = await run("button", `publish:${ping}`);
    assert.match(everyoneDenied.replies[0].content || "", /Mention Everyone/);
    assert.equal(sends, 2);
    await run("button", "start");
    const permitted = [...drafts.keys()][0];
    Object.assign(drafts.get(permitted)!, { ...draft(), id: permitted, everyone: true });
    mentionAllowed = true;
    await run("button", `publish:${permitted}`);
    assert.equal(sends, 3, "authorized mentions and everyone notification should publish");
    await run("button", "start");
    const expired = [...drafts.keys()][0];
    drafts.get(expired)!.expiresAt = Date.now() - 1;
    const expiry = await run("button", `text:${expired}`);
    assert.match(expiry.replies[0].content || "", /expired/);
    await run("button", "start");
    const cancel = [...drafts.keys()][0];
    await run("button", `cancel:${cancel}`);
    assert.equal(drafts.size, 0);
    await run("button", "start");
    const studioId = [...drafts.keys()][0];
    const home = await run("color-select", `studio:${studioId}`, ["home"]);
    assert.match(JSON.stringify(home.replies[0].embeds), /FNTCORD.*Private Staff Studio/);
    await run("button", `home:${studioId}`);
    await run("button", `refresh_home:${studioId}`);
    await run("button", `customize:${studioId}`);
    await run("button", `refresh:${studioId}`);
    const back = await run("button", `back:${studioId}`);
    assert.equal(back.replies[0].components!.length, 5);
    const refresh = await run("color-select", `studio:${studioId}`, ["refresh"]);
    assert.equal(refresh.replies[0].components!.length, 5);
    await run("color-select", `studio:${studioId}`, ["template_event"]);
    assert.match(drafts.get(studioId)!.title, /FNTCORD.*Event/);
    assert.equal(drafts.get(studioId)!.roleIds.length, 0);
    fields = { name: "Weekly event" };
    await run("modal", `save_draft:${studioId}`);
    const reopened = new EmbedStudioStore(file);
    assert.equal(reopened.saved("guild", "staff")[0].name, "Weekly event");
    assert.equal(reopened.saved("guild", "other-staff").length, 0);
    const savedId = store.saved("guild", "staff")[0].id;
    await run("button", "start");
    const loadedId = [...drafts.keys()][0];
    await run("color-select", `load_draft:${loadedId}`, [savedId]);
    assert.match(drafts.get(loadedId)!.title, /FNTCORD.*Event/);
    const stolenSaved = await run("color-select", `load_draft:${loadedId}`, [savedId], "other-staff");
    assert.match(stolenSaved.replies[0].content || "", /another staff/);
    await run("channel-select", `channel:${loadedId}`, ["destination"]);
    const future = new Date(Date.now() + 3600000).toISOString().slice(0, 19) + "Z";
    fields = { datetime: future, timezone: "UTC" };
    await run("modal", `schedule:${loadedId}`);
    assert.equal(store.history("guild", "staff").filter(row => row.status === "scheduled").length, 0, "time entry alone must not schedule");
    const oldToken = drafts.get(loadedId)!.pendingSchedule!.confirmationId;
    await run("color-select", `color:${loadedId}`, ["Green"]);
    assert.equal(drafts.get(loadedId)!.pendingSchedule, undefined, "editing invalidates an unconfirmed schedule");
    await run("modal", `schedule:${loadedId}`);
    const currentToken = drafts.get(loadedId)!.pendingSchedule!.confirmationId;
    await run("button", `confirm_schedule:${loadedId}:${oldToken}`);
    assert.equal(store.history("guild", "staff").filter(row => row.status === "scheduled").length, 0, "stale timezone confirmations cannot confirm a different proposal");
    const confirmation = await run("button", `confirm_schedule:${loadedId}:${currentToken}`);
    assert.match(confirmation.replies[0].content || "", /Scheduled for.*UTC/);
    await run("button", `confirm_schedule:${loadedId}:${currentToken}`);
    assert.equal(store.history("guild", "staff").filter(row => row.status === "scheduled").length, 1, "duplicate confirmations must not enqueue twice");
    const scheduled = store.history("guild", "staff").find(row => row.status === "scheduled")!;
    const restart = new EmbedStudioStore(file);
    assert.equal(restart.history("guild", "staff").find(row => row.id === scheduled.id)!.status, "scheduled");
    assert.equal(restart.due("guild", scheduled.runAt + 1).filter(row => row.id === scheduled.id).length, 1, "pending schedules survive restart and become eligible exactly once");
    assert.throws(() => store.cancel(scheduled.id, "guild", "other-staff"), /unavailable/);
    await run("button", "start");
    const historyId = [...drafts.keys()][0];
    const historyView = await run("color-select", `studio:${historyId}`, ["history"]);
    const historyPayload = JSON.stringify(historyView.replies[0].embeds);
    assert.match(historyPayload, /SCHEDULED/);
    assert.match(historyPayload, /https:\/\/discord.com\/channels\/1\/2\/3/);
    await run("color-select", `cancel_schedule:${historyId}`, [scheduled.id]);
    assert.equal(store.history("guild", "staff").find(row => row.id === scheduled.id)!.status, "canceled");

    const dueDraft = { ...draft(), id: "due", userIds: [], roleIds: [] };
    store.create(dueDraft, { runAt: Date.now() - 1, timezone: "UTC" });
    const before = sends;
    await Promise.all([exports.runStaffEmbedSchedules(guild), exports.runStaffEmbedSchedules(guild)]);
    await exports.runStaffEmbedSchedules(guild);
    assert.equal(sends, before + 1, "overlapping scheduler ticks send once");
    assert.equal(store.history("guild", "staff")[0].url, "https://discord.com/channels/1/2/3");
    staff = false;
    store.create({ ...dueDraft, id: "revoked" }, { runAt: Date.now() - 1, timezone: "UTC" });
    await exports.runStaffEmbedSchedules(guild);
    assert.equal(sends, before + 1, "revoked staff cannot publish a scheduled announcement");
    assert.match(store.history("guild", "staff")[0].error!, /no longer authorized/);
    staff = true;
    destinationAllowed = false;
    store.create({ ...dueDraft, id: "destination-revoked" }, { runAt: Date.now() - 1, timezone: "UTC" });
    await exports.runStaffEmbedSchedules(guild);
    assert.equal(sends, before + 1, "revoked destination permissions block scheduled delivery");
    assert.match(store.history("guild", "staff")[0].error!, /View Channel/);
    destinationAllowed = true;
    botAllowed = false;
    store.create({ ...dueDraft, id: "scheduled-bot-revoked" }, { runAt: Date.now() - 1, timezone: "UTC" });
    await exports.runStaffEmbedSchedules(guild);
    assert.equal(sends, before + 1, "scheduled publication rechecks bot permissions");
    assert.match(store.history("guild", "staff")[0].error!, /bot needs/);
    botAllowed = true;
    mentionAllowed = false;
    store.create({ ...dueDraft, id: "scheduled-role-revoked", roleIds: ["role"] }, { runAt: Date.now() - 1, timezone: "UTC" });
    await exports.runStaffEmbedSchedules(guild);
    assert.equal(sends, before + 1, "role mention permission must be rechecked during scheduled sends");
    assert.match(store.history("guild", "staff")[0].error!, /cannot be notified/);
    store.create({ ...dueDraft, id: "uncertain" }, { runAt: Date.now() - 1, timezone: "UTC" });
    sendFails = true;
    await exports.runStaffEmbedSchedules(guild);
    await exports.runStaffEmbedSchedules(guild);
    assert.equal(sends, before + 2, "failed scheduled sends never retry automatically");
    assert.equal(store.history("guild", "staff")[0].status, "failed");
    assert.match(store.history("guild", "staff")[0].error!, /Send failed/);
    const interrupted = store.create({ ...dueDraft, id: "interrupted" }, { runAt: Date.now() - 1, timezone: "UTC" });
    store.claim(interrupted.id);
    const recovered = new EmbedStudioStore(file);
    assert.match(recovered.history("guild", "staff").find(row => row.id === interrupted.id)!.error!, /interrupted/);
    assert.equal(recovered.due("guild").length, 0);
    recovered.create({ ...dueDraft, id: "backup-recovery" }, { runAt: Date.now() - 1, timezone: "UTC" });
    const backupRecord = recovered.history("guild", "staff")[0];
    recovered.claim(backupRecord.id);
    fs.writeFileSync(file, "{damaged");
    const originalError = console.error;
    const originalWarn = console.warn;
    let restored: EmbedStudioStore;
    try {
        console.error = () => undefined;
        console.warn = () => undefined;
        restored = new EmbedStudioStore(file);
    } finally { console.error = originalError; console.warn = originalWarn; }
    assert.equal(restored!.due("guild").length, 0, "backup recovery must not resurrect schedules");
    assert.match(restored!.history("guild", "staff").find(row => row.id === backupRecord.id)!.error!, /backup/);
    for (let count = 1; count <= 25; count++) restored!.save(`Saved ${count}`, { ...draft(), ownerId: "limited" });
    assert.throws(() => restored!.save("One too many", { ...draft(), ownerId: "limited" }), /25 saved drafts/);
    restored!.save("SAVED 1", { ...draft(), ownerId: "limited", title: "Replacement" });
    assert.equal(restored!.saved("guild", "limited").length, 25);
    assert.equal(restored!.saved("guild", "limited").find(row => row.name === "SAVED 1")!.draft.title, "Replacement");
    console.log("Staff embed builder tests passed: guards, templates, durable private drafts, timezone confirmation, cancellation, history, scheduler permissions and restart/duplicate safety.");
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
