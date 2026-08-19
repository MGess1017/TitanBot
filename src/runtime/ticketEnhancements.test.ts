import assert from "node:assert/strict";
import {
    buildTicketIntakeReason,
    classifyTicketCategory,
    findPotentialDuplicateTickets,
    getKbSuggestions,
    getTicketSlaPolicy,
    hydrateTicketIntakeFields,
    parseTicketIntakeSnapshot,
    pickLeastLoadedAssignee,
    shouldPurgeResolvedTicket
} from "../services/ticketEnhancements";
import { buildRaidResultPayload } from "../game/payloads";

function runTicketEnhancementTests(): void {
    assert.equal(classifyTicketCategory("billing refund missing"), "billing");
    assert.equal(classifyTicketCategory("bug crash in raid"), "bug");

    const reason = buildTicketIntakeReason({
        category: "bug",
        summary: "Crash when opening inventory",
        details: "Steps: open inventory after raid",
        platform: "PC",
        evidence: "https://img.example/1"
    });
    assert.equal(reason.includes("[bug]"), true);

    const parsed = parseTicketIntakeSnapshot(reason);
    assert.equal(parsed.summary, "Crash when opening inventory");
    assert.equal(parsed.category, "bug");
    assert.equal(parsed.platform, "PC");
    assert.equal(parsed.evidence, "https://img.example/1");

    const hydrated = hydrateTicketIntakeFields(reason, { summary: "", details: "", platform: "", evidence: "" });
    assert.equal(hydrated.summary, "Crash when opening inventory");
    assert.equal(hydrated.details, "Steps: open inventory after raid");
    assert.equal(hydrated.platform, "PC");
    assert.equal(hydrated.evidence, "https://img.example/1");

    const kb = getKbSuggestions("account locked out");
    assert.equal(kb.length >= 2, true);

    const policy = getTicketSlaPolicy("billing", "high");
    assert.equal(policy.firstResponseMs <= 8 * 60 * 1000, true);
    assert.equal(policy.resolveMs <= 8 * 60 * 60 * 1000, true);

    const duplicates = findPotentialDuplicateTickets({
        guildId: "g1",
        ownerId: "u1",
        reason: "inventory crash after raid extract",
        tickets: [
            { id: 1, guildId: "g1", ownerId: "u1", reason: "game crash after raid", status: "open", priority: "normal", createdAt: Date.now() - 1000, resolvedAt: null, assignedToId: null },
            { id: 2, guildId: "g1", ownerId: "u2", reason: "payment issue", status: "open", priority: "high", createdAt: Date.now() - 1000, resolvedAt: null, assignedToId: null }
        ]
    });
    assert.equal(duplicates.length >= 1, true);

    const closedTicketDoesNotBlockNewCase = findPotentialDuplicateTickets({
        guildId: "g1",
        ownerId: "u3",
        reason: "same issue after closure",
        tickets: [
            { id: 99, guildId: "g1", ownerId: "u3", reason: "same issue after closure", status: "archived", priority: "normal", createdAt: Date.now() - 60_000, resolvedAt: null, assignedToId: null },
            { id: 100, guildId: "g1", ownerId: "u3", reason: "same issue after closure", status: "resolved", priority: "normal", createdAt: Date.now() - 30_000, resolvedAt: Date.now() - 30_000, assignedToId: null }
        ]
    });
    assert.equal(closedTicketDoesNotBlockNewCase.length, 0);

    const assignee = pickLeastLoadedAssignee(["a", "b", "c"], [
        { id: 10, guildId: "g1", ownerId: "o1", reason: "x", status: "open", priority: "normal", createdAt: 1, resolvedAt: null, assignedToId: "a" },
        { id: 11, guildId: "g1", ownerId: "o1", reason: "x", status: "open", priority: "normal", createdAt: 1, resolvedAt: null, assignedToId: "a" },
        { id: 12, guildId: "g1", ownerId: "o1", reason: "x", status: "open", priority: "normal", createdAt: 1, resolvedAt: null, assignedToId: "b" }
    ]);
    assert.equal(assignee, "c");

    assert.equal(shouldPurgeResolvedTicket({ status: "resolved", resolvedAt: Date.now() - 10 * 24 * 60 * 60 * 1000 }, 7), true);

    const raidPayload = JSON.parse(buildRaidResultPayload({
        result: {
            success: true,
            net: 2400,
            loot: [{ id: "scrap", qty: 7 }],
            rxpGain: 1800,
            successChance: 79,
            mapLabel: "FN Plagued Cemetery",
            tension: "medium | Cold Drizzle",
            bossSpawned: false,
            selectedWeaponName: "Reactor Blade",
            selectedArmorName: "Voidscale Regalia"
        },
        mapCfg: { label: "FN Plagued Cemetery", bossName: "The Hollow King", lootTier: "Low to Mid" },
        fallbackTension: "medium",
        armyIconUrl: "https://example.com/army.png"
    }));

    assert.equal(raidPayload.embed.title, "✅ Raid Extraction Complete");
    assert.match(raidPayload.embed.description, /FN Plagued Cemetery/);
    assert.match(raidPayload.embed.fields[0].value, /Status: Extracted/);
    assert.match(raidPayload.embed.fields[2].value, /Boss: No boss detected/);
}

runTicketEnhancementTests();
console.log("ticket enhancement tests passed");
