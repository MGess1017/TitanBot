import assert from "node:assert/strict";
import {
    buildTicketIntakeReason,
    classifyTicketCategory,
    findPotentialDuplicateTickets,
    getKbSuggestions,
    getTicketSlaPolicy,
    parseTicketIntakeSnapshot,
    pickLeastLoadedAssignee,
    shouldPurgeResolvedTicket
} from "../services/ticketEnhancements";

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

    const assignee = pickLeastLoadedAssignee(["a", "b", "c"], [
        { id: 10, guildId: "g1", ownerId: "o1", reason: "x", status: "open", priority: "normal", createdAt: 1, resolvedAt: null, assignedToId: "a" },
        { id: 11, guildId: "g1", ownerId: "o1", reason: "x", status: "open", priority: "normal", createdAt: 1, resolvedAt: null, assignedToId: "a" },
        { id: 12, guildId: "g1", ownerId: "o1", reason: "x", status: "open", priority: "normal", createdAt: 1, resolvedAt: null, assignedToId: "b" }
    ]);
    assert.equal(assignee, "c");

    assert.equal(shouldPurgeResolvedTicket({ status: "resolved", resolvedAt: Date.now() - 10 * 24 * 60 * 60 * 1000 }, 7), true);
}

runTicketEnhancementTests();
console.log("ticket enhancement tests passed");
