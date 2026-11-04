import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { ComponentType, DiscordAPIError, MessageFlags } from "discord.js";
import { buildXpLeaderboardPanel, XP_LEADERBOARD_CHANNEL_ID, type XpLeaderboardEntry } from "../features/xpLeaderboard";

const entries: XpLeaderboardEntry[] = [{
    id: "123456789012345678",
    username: "test_user",
    xp: 12_200,
    prestige: 2,
    voiceMultiplier: 2
}];
assert.equal(XP_LEADERBOARD_CHANNEL_ID, "1527571592320651285");
const payload = buildXpLeaderboardPanel(entries, 60_000);
assert.equal(payload.flags, MessageFlags.IsComponentsV2);
assert.deepEqual(payload.allowedMentions.parse, []);
const panel = payload.components[0].toJSON();
assert.equal(panel.type, ComponentType.Container);
assert.equal(panel.accent_color, 0x9b59b6, "the live panel must use a purple accent");
const text = panel.components.filter(component => component.type === ComponentType.TextDisplay).map(component => component.content).join("\n");
assert.ok(text.includes("test\\_user"), "the actual username must be rendered and Markdown escaped");
assert.ok(text.includes(`### #1  <@${entries[0].id}>`), "each rank must display the user's mention");
assert.ok(text.includes("**XP** `12,200`  |  **Prestige** `2`  |  **Voice XP** `2x`"));
assert.ok(text.includes("Disconnecting from any VC resets it to 1x"));
assert.ok(!text.includes("AFK"), "the panel must not describe an AFK reset or penalty");
assert.ok(text.includes("<t:60:T>"));
const empty = JSON.stringify(buildXpLeaderboardPanel([]).components[0].toJSON());
assert.ok(empty.includes("No XP earned yet"));
const many = Array.from({ length: 20 }, (_, index) => ({ ...entries[0], id: String(BigInt(entries[0].id) + BigInt(index)), username: `player${index}` }));
const limitedPanel = buildXpLeaderboardPanel(many).components[0].toJSON();
const limited = JSON.stringify(limitedPanel);
assert.ok(limited.includes("player9"));
assert.ok(!limited.includes("player10"), "panel must stay within the top-10 limit");
const rankComponents = limitedPanel.components.filter(component =>
    component.type === ComponentType.TextDisplay && component.content.startsWith("### #")
);
assert.equal(rankComponents.length, 10, "each rank must have its own organized text component");
rankComponents.forEach((component, index) => {
    assert.equal(component.type, ComponentType.TextDisplay);
    if (component.type === ComponentType.TextDisplay) {
        assert.ok(component.content.includes(`### #${index + 1}  <@${many[index].id}>`));
    }
});
assert.equal(limitedPanel.components.filter(component => component.type === ComponentType.Separator).length, 11);

type FakeMessage = {
    id: string;
    author: { id: string };
    components: typeof panel[];
    edit: (value: typeof payload) => Promise<void>;
};
type FakeChannel = {
    messages: { fetch: (query: string | { limit: number }) => Promise<unknown> };
    send: (value: typeof payload) => Promise<{ id: string }>;
};
const source = ts.createSourceFile("xpLeaderboard.ts", fs.readFileSync(path.resolve(__dirname, "../features/xpLeaderboard.ts"), "utf8"), ts.ScriptTarget.ES2020, true);
const names = new Set(["isLeaderboardPanel", "isUnknownMessage", "upsertXpLeaderboardPanel"]);
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text || ""));
assert.equal(functions.length, names.size);
const context = vm.createContext({
    exports: {},
    ComponentType,
    DiscordAPIError,
    buildXpLeaderboardPanel,
    PANEL_HEADING: "## Live XP Leaderboard"
});
vm.runInContext(ts.transpileModule(functions.map(node => node.getText(source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText, context);
const upsert = (context as { upsertXpLeaderboardPanel: (channel: FakeChannel, botId: string, stored: string | null, rows: XpLeaderboardEntry[]) => Promise<string> }).upsertXpLeaderboardPanel;
const unknownMessage = new DiscordAPIError({ code: 10008, message: "Unknown Message" }, 10008, 404, "GET", "https://discord.com/api", {});

async function run(): Promise<void> {
    let edits = 0;
    let sends = 0;
    let historyFetches = 0;
    const message: FakeMessage = {
        id: "saved",
        author: { id: "bot" },
        components: [panel],
        edit: async value => {
            assert.equal(value.flags, MessageFlags.IsComponentsV2);
            edits++;
        }
    };
    let storedError: Error | null = null;
    let recentMessages: FakeMessage[] = [message];
    const channel: FakeChannel = {
        messages: {
            fetch: async query => {
                if (typeof query === "string") {
                    if (storedError) throw storedError;
                    return message;
                }
                historyFetches++;
                return { find: (predicate: (item: FakeMessage) => boolean) => recentMessages.find(predicate) };
            }
        },
        send: async () => { sends++; return { id: "new" }; }
    };
    assert.equal(await upsert(channel, "bot", "saved", entries), "saved");
    assert.equal(edits, 1);
    assert.equal(sends, 0, "refresh must edit instead of spamming new panels");
    assert.equal(historyFetches, 0, "saved panel should bypass history scans");
    assert.equal(await upsert(channel, "bot", null, entries), "saved");
    assert.equal(edits, 2, "startup without a saved ID should recover the existing panel");
    storedError = unknownMessage;
    assert.equal(await upsert(channel, "bot", "deleted", entries), "saved");
    recentMessages = [];
    assert.equal(await upsert(channel, "bot", "deleted", entries), "new");
    assert.equal(sends, 1, "deleting the panel should recreate it");
    storedError = new Error("Missing Permissions");
    await assert.rejects(upsert(channel, "bot", "saved", entries), /Missing Permissions/);
    assert.equal(sends, 1, "permission and network failures must not create duplicate panels");
    storedError = null;
    message.author.id = "another-bot";
    recentMessages = [message];
    assert.equal(await upsert(channel, "bot", "saved", entries), "new");
    assert.equal(edits, 3, "another bot's panel must not be edited");
    assert.equal(sends, 2);
    message.author.id = "bot";
    message.edit = async () => { throw new Error("Cannot edit"); };
    await assert.rejects(upsert(channel, "bot", "saved", entries), /Cannot edit/);
    assert.equal(sends, 2);
    console.log("XP leaderboard rendering and panel recovery tests passed");
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
