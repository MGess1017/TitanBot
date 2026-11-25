import assert from "node:assert/strict";
import { RequestMethod } from "@discordjs/rest";
import { MessageFlags } from "discord.js";
import { componentsV2Payload, installComponentsV2 } from "../bot/ui/componentsV2";

const converted = componentsV2Payload({
    content: "Status ready",
    embeds: [{
        color: 0x123456,
        title: "Operations",
        description: "All systems normal.",
        fields: [{ name: "Region", value: "North" }],
        image: { url: "attachment://status.png" }
    }],
    components: [{ type: 1, components: [{ type: 2, custom_id: "continue", label: "Continue", style: 1 }] }],
    files: [{ attachment: Buffer.from("image"), name: "status.png" }],
    allowedMentions: { parse: [] }
});

assert.equal("content" in converted, false);
assert.equal("embeds" in converted, false);
assert.equal(converted.flags, MessageFlags.IsComponentsV2);
assert.ok(Array.isArray(converted.components));
const components = converted.components as Array<Record<string, unknown>>;
assert.equal(components[0].type, 17);
assert.equal(components[components.length - 1].type, 1);
assert.equal(JSON.stringify(components).includes("All systems normal."), true);
assert.equal(JSON.stringify(components).includes("attachment://status.png"), true);
assert.ok(Array.isArray(converted.files));
assert.deepEqual(converted.allowedMentions, { parse: [] });

const calls: Array<{ route: string; body: unknown }> = [];
const rest = {
    request: async (options: { fullRoute: `/${string}`; method: RequestMethod; body?: unknown; files?: unknown }) => {
        calls.push({ route: options.fullRoute, body: options.body });
        return {};
    },
    post(fullRoute: `/${string}`, options: { body?: unknown; files?: unknown } = {}) {
        return this.request({ ...options, fullRoute, method: RequestMethod.Post });
    },
    patch(fullRoute: `/${string}`, options: { body?: unknown; files?: unknown } = {}) {
        return this.request({ ...options, fullRoute, method: RequestMethod.Patch });
    }
};
installComponentsV2(rest);

void (async () => {
    await rest.post("/interactions/1/token/callback", {
        body: { type: 5, data: { flags: MessageFlags.Ephemeral } }
    });
    await rest.post("/channels/1/messages", { body: { embeds: [{ title: "Panel" }] } });
    await rest.patch("/channels/1/messages/2", {
        body: { content: "Updated" },
        files: [{ name: "details.txt", data: Buffer.from("details") }]
    });
    await rest.post("/applications/1/commands", { body: { name: "test" } });

    const deferred = calls[0].body as { type: number; data: Record<string, unknown> };
    assert.equal(deferred.data.flags, MessageFlags.Ephemeral);
    assert.equal("components" in deferred.data, false);
    for (const call of calls.slice(1, 3)) {
        const body = call.body as Record<string, unknown>;
        assert.equal(body.flags, MessageFlags.IsComponentsV2);
        assert.equal("content" in body, false);
        assert.equal("embeds" in body, false);
    }
    const edited = calls[2].body as { components: Array<Record<string, unknown>> };
    assert.equal(edited.components[edited.components.length - 1].type, 13);
    assert.deepEqual(calls[3].body, { name: "test" });
    console.log("components v2 conversion checks passed");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
