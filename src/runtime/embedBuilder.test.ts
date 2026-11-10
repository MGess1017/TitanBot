import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { MessageFlags, PermissionFlagsBits, ChannelType } from "discord.js";
import {
    buildStaffEmbedEditor, buildStaffEmbedMessage, buildStaffEmbedModal, buildStaffEmbedPanel,
    STAFF_EMBED_COLORS, STAFF_EMBED_PREFIX, validateStaffEmbedText, type StaffEmbedDraft
} from "../features/embedBuilder";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };

function draft(): StaffEmbedDraft {
    return {
        id: "draft", ownerId: "staff", guildId: "guild", expiresAt: Date.now() + 100000,
        channelId: "destination", color: "Gold", userIds: ["user"], roleIds: ["role"],
        everyone: false, title: "A title", description: "Message with @everyone in the embed", status: "editing"
    };
}
const sample = draft();
assert.equal(buildStaffEmbedPanel().components.length, 1);
const editor = buildStaffEmbedEditor(sample);
assert.ok(editor.components.length <= 5);
assert.ok(editor.components.every(row => row.components.length <= 5));
assert.deepEqual(editor.allowedMentions.parse, []);
const colors = editor.components[1].toJSON().components[0];
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

async function main(): Promise<void> {
    const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
    const handler = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleStaffEmbedInteraction");
    assert.ok(handler);
    const drafts = new Map<string, StaffEmbedDraft>();
    let staff = true;
    let destinationAllowed = true;
    let mentionAllowed = false;
    let sendFails = false;
    let sends = 0;
    let ids = 0;
    const member = { id: "staff", permissions: { has: () => mentionAllowed } };
    const destination = {
        id: "destination", type: ChannelType.GuildText,
        permissionsFor: () => ({ has: (permission: unknown) =>
            permission === PermissionFlagsBits.MentionEveryone ? mentionAllowed : destinationAllowed }),
        send: async () => { sends++; if (sendFails) throw new Error("Send failed"); return { id: "posted", url: "https://discord.com/channels/guild/destination/posted" }; }
    };
    const context = vm.createContext({
        Error, STAFF_EMBED_PREFIX, STAFF_EMBED_COLORS, buildStaffEmbedEditor, buildStaffEmbedMessage,
        buildStaffEmbedModal, validateStaffEmbedText, staffEmbedDrafts: drafts,
        DRAFT_TTL_MS: 1800000, randomUUID: () => `draft-${++ids}`,
        MessageFlags, PermissionFlagsBits, ChannelType,
        isStaffMember: () => staff, appendAuditEvent: () => undefined,
        console: { error: () => undefined }
    });
    vm.runInContext(ts.transpileModule(handler.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
    type Reply = { content?: string; flags?: number; components?: unknown[] };
    function fake(kind: string, action: string, values: string[] = [], userId = "staff") {
        const replies: Reply[] = [];
        const interaction = {
            customId: `${STAFF_EMBED_PREFIX}${action}`, user: { id: userId },
            guild: { id: "guild", members: { fetch: async (id: string) => ({ ...member, id }), fetchMe: async () => ({ id: "bot" }) },
                channels: { fetch: async () => destination }, roles: { fetch: async () => ({ id: "role", mentionable: false }) } },
            values, users: new Map([["user", {}]]), roles: new Map([["role", {}]]),
            fields: { getTextInputValue: (key: string) => key === "title" ? "My title" : "My message" },
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
        assert.equal(await context.handleStaffEmbedInteraction(event.interaction), true);
        return event;
    }
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
    console.log("Staff embed builder tests passed: access, editing, permissions, mentions, publication, duplicate protection and expiry.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
