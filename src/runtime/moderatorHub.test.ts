import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import { STAFF_IDS } from "../features/staffHub";
import { TICKET_IDS } from "../bot/ui/ids";

const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };
const source = ts.createSourceFile("bot.ts", readBotSource(), ts.ScriptTarget.ES2020, true);
function functionCode(name: string): string {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `Missing ${name}`);
    return ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}

async function main(): Promise<void> {
    const confirmations = new Map<string, { actorId: string; guildId: string; expiresAt: number }>();
    const restarts: string[] = [];
    const env: Record<string, string> = { pm_id: "1" };
    const context = vm.createContext({
        ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, STAFF_IDS, TICKET_IDS,
        OWNER_PANEL_CHANNEL_ID: "owner-channel", REPORT_LOG_CHANNEL_ID: "report-channel",
        OWNER_PANEL_USER_IDS: ["owner", "other-owner"],
        isStaffMember: (member: { staff?: boolean }) => Boolean(member?.staff),
        buildStaffHomeFor: () => ({ embeds: [], components: [] }),
        confirmations, CONFIRMATION_MS: 60_000, randomUUID: () => "confirmation-token",
        appendAuditEvent: () => undefined,
        requestManagedRestart: async (_trigger: string, user: string, requirePm2: boolean) => {
            assert.equal(requirePm2, true);
            restarts.push(user);
        },
        process: { env },
        console: { error: () => undefined }
    });
    vm.runInContext(functionCode("buildModeratorHub"), context);
    vm.runInContext(functionCode("handleModeratorHubInteraction"), context);
    type Event = { kind: string; payload: { content?: string; flags?: number; components?: Array<ActionRowBuilder<ButtonBuilder>> } };
    function fake(customId: string, userId: string, staff: boolean, guildId = "guild") {
        const events: Event[] = [];
        const interaction = {
            customId, user: { id: userId }, member: { staff }, guild: { id: guildId, members: { fetch: async () => ({}) } },
            channelId: "channel", replied: false, deferred: false, isButton: () => true,
            reply: async (payload: Event["payload"]) => { events.push({ kind: "reply", payload }); },
            update: async (payload: Event["payload"]) => { events.push({ kind: "update", payload }); },
            followUp: async (payload: Event["payload"]) => { events.push({ kind: "followUp", payload }); }
        };
        return { interaction, events };
    }

    const guest = fake("modhub:open", "guest", false);
    assert.equal(await context.handleModeratorHubInteraction(guest.interaction), true);
    assert.match(guest.events[0].payload.content || "", /authorized staff/);
    const staff = fake("modhub:open", "staff", true);
    await context.handleModeratorHubInteraction(staff.interaction);
    assert.equal(staff.events[0].payload.flags, MessageFlags.Ephemeral);
    assert.equal(staff.events[0].payload.components?.length, 2);
    const denied = fake("modhub:restart", "staff", true);
    await context.handleModeratorHubInteraction(denied.interaction);
    assert.match(denied.events[0].payload.content || "", /Only authorized/);
    const owner = fake("modhub:restart", "owner", false);
    await context.handleModeratorHubInteraction(owner.interaction);
    assert.equal(owner.events[0].payload.flags, MessageFlags.Ephemeral);
    assert.equal(confirmations.size, 1);
    const intruder = fake("modhub:confirm:confirmation-token", "staff", true);
    await context.handleModeratorHubInteraction(intruder.interaction);
    assert.equal(restarts.length, 0);
    const otherOwner = fake("modhub:confirm:confirmation-token", "other-owner", false);
    await context.handleModeratorHubInteraction(otherOwner.interaction);
    assert.match(otherOwner.events[0].payload.content || "", /expired or belongs/);
    assert.equal(restarts.length, 0);
    const confirm = fake("modhub:confirm:confirmation-token", "owner", false);
    await context.handleModeratorHubInteraction(confirm.interaction);
    assert.deepEqual(restarts, ["owner"]);
    assert.equal(confirmations.size, 0);
    const replay = fake("modhub:confirm:confirmation-token", "owner", false);
    await context.handleModeratorHubInteraction(replay.interaction);
    assert.match(replay.events[0].payload.content || "", /expired/);
    assert.equal(restarts.length, 1);
    await context.handleModeratorHubInteraction(fake("modhub:restart", "owner", false).interaction);
    const wrongGuild = fake("modhub:confirm:confirmation-token", "owner", false, "other-guild");
    await context.handleModeratorHubInteraction(wrongGuild.interaction);
    assert.match(wrongGuild.events[0].payload.content || "", /expired or belongs/);
    assert.equal(restarts.length, 1);
    const cancel = fake("modhub:cancel:confirmation-token", "owner", false);
    await context.handleModeratorHubInteraction(cancel.interaction);
    assert.match(cancel.events[0].payload.content || "", /canceled/);
    assert.equal(confirmations.size, 0);
    await context.handleModeratorHubInteraction(fake("modhub:restart", "owner", false).interaction);
    const pending = confirmations.get("confirmation-token");
    assert.ok(pending);
    pending.expiresAt = Date.now() - 1;
    const expired = fake("modhub:confirm:confirmation-token", "owner", false);
    await context.handleModeratorHubInteraction(expired.interaction);
    assert.match(expired.events[0].payload.content || "", /expired/);
    assert.equal(restarts.length, 1);
    await context.handleModeratorHubInteraction(fake("modhub:restart", "owner", false).interaction);
    context.requestManagedRestart = async () => { throw new Error("restart failed"); };
    const failed = fake("modhub:confirm:confirmation-token", "owner", false);
    await context.handleModeratorHubInteraction(failed.interaction);
    assert.equal(failed.events[1].kind, "followUp");
    assert.match(failed.events[1].payload.content || "", /restart failed/);
    assert.equal(confirmations.size, 0);
    delete env.pm_id;
    const unmanaged = fake("modhub:restart", "owner", false);
    await context.handleModeratorHubInteraction(unmanaged.interaction);
    assert.match(unmanaged.events[0].payload.content || "", /not running under PM2/);

    let checkpoints = 0;
    let signals = 0;
    const targets: string[] = [];
    const restartEnv = { pm_id: "7", name: "different-process" };
    const restartContext = vm.createContext({
        process: { env: restartEnv, pid: 123, kill: () => { signals++; } },
        checkpointState: () => { checkpoints++; return true; },
        flushJsonWrites: async () => undefined,
        appendAuditEvent: () => undefined,
        execFile: (_command: string, args: string[], _options: object, callback: (error: Error) => void) => {
            targets.push(args[1]);
            callback(new Error("PM2 unavailable"));
        },
        console: { log: () => undefined, warn: () => undefined }
    });
    vm.runInContext(functionCode("requestManagedRestart"), restartContext);
    await assert.rejects(() => restartContext.requestManagedRestart("test", "owner", true), /PM2 could not restart/);
    assert.deepEqual(targets, ["7"], "owner hub restart must not target another PM2 process by name");
    assert.equal(checkpoints, 1);
    assert.equal(signals, 0, "failed PM2 restarts must not stop an unmanaged bot");
    restartEnv.pm_id = "";
    await assert.rejects(() => restartContext.requestManagedRestart("test", "owner", true), /not running under PM2/);
    assert.equal(checkpoints, 1);
    restartEnv.pm_id = "7";
    restartContext.checkpointState = () => false;
    await assert.rejects(() => restartContext.requestManagedRestart("test", "owner", true), /failed to checkpoint/);
    assert.deepEqual(targets, ["7"]);
    restartContext.checkpointState = () => true;
    restartContext.flushJsonWrites = async () => { throw new Error("flush failed"); };
    await assert.rejects(() => restartContext.requestManagedRestart("test", "owner", true), /flush failed/);
    assert.deepEqual(targets, ["7"]);
    assert.equal(signals, 0);
    console.log("Moderator hub tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
