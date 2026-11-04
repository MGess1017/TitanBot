import assert from "node:assert/strict";
import {
    calculateCheckpointRating, CHECKPOINT_SECTION_IDS, CHECKPOINT_SECTIONS, CHECKPOINT_STAT_KEYS, getCheckpointTier,
    isCheckpointComplete, normalizeCheckpointProfile, parseCheckpointStat, parseIngameName, validateCheckpointStats,
    type CheckpointStatKey
} from "../game/checkpointRating";
import {
    buildCheckpointCardMessage, buildCheckpointModal, buildCheckpointNameModal, buildCheckpointPanel, CHECKPOINT_EDIT_PREFIX,
    CHECKPOINT_NAME_ID, CHECKPOINT_NAME_INPUT_ID, CHECKPOINT_NAME_MODAL_ID, describeCheckpointProgress, renderCheckpointCard
} from "../features/checkpointCard";

const strong: Record<CheckpointStatKey, number> = {
    kd: 2.14, playerKills: 4210, deaths: 1967, doubleKills: 610, matchesPlayed: 980, victories: 590, winRate: 60.2,
    matchesQuit: 6, headshotKills: 1450, headshotRate: 34.4, overkills: 44, meleeKills: 37, highestWinStreak: 11,
    highestMatchXp: 5120, moneyEarned: 48_200_000, mvps: 210
};

async function main(): Promise<void> {
    const sectionKeys = CHECKPOINT_SECTION_IDS.flatMap(id => CHECKPOINT_SECTIONS[id].keys);
    assert.deepEqual([...sectionKeys].sort(), [...CHECKPOINT_STAT_KEYS].sort(), "every stat must appear in exactly one section");
    for (const id of CHECKPOINT_SECTION_IDS) {
        assert.ok(CHECKPOINT_SECTIONS[id].keys.length <= 5, "Discord modals allow at most 5 inputs");
        const modal = buildCheckpointModal(id, { kd: 1.5 }).toJSON();
        assert.equal(modal.components.length, CHECKPOINT_SECTIONS[id].keys.length);
    }
    const panelButtons = buildCheckpointPanel().components.flatMap(row => row.toJSON().components) as Array<{ custom_id: string }>;
    assert.equal(panelButtons.filter(button => button.custom_id.startsWith(CHECKPOINT_EDIT_PREFIX)).length, 4);
    assert.ok(panelButtons.some(button => button.custom_id === CHECKPOINT_NAME_ID), "panel has an In-Game Name button");
    const nameModal = buildCheckpointNameModal("FNT_Ghost").toJSON();
    assert.equal(nameModal.custom_id, CHECKPOINT_NAME_MODAL_ID);
    const nameInput = (nameModal.components[0] as { components: Array<{ custom_id: string; value?: string; max_length?: number }> }).components[0];
    assert.equal(nameInput.custom_id, CHECKPOINT_NAME_INPUT_ID);
    assert.equal(nameInput.value, "FNT_Ghost", "existing name is prefilled for editing");
    assert.equal(nameInput.max_length, 15);

    assert.deepEqual(parseIngameName("  FNT_Ghost-7 "), { ok: true, value: "FNT_Ghost-7" });
    assert.equal(parseIngameName("ab").ok, false, "too short");
    assert.equal(parseIngameName("a".repeat(16)).ok, false, "too long");
    assert.equal(parseIngameName("bad name").ok, false, "no spaces");
    assert.equal(parseIngameName("@everyone").ok, false, "no mentions or symbols");
    assert.equal(parseIngameName("**bold**").ok, false, "no markdown");
    assert.match(describeCheckpointProgress({}, null), /⬜ In-Game Name/);
    assert.match(describeCheckpointProgress({}, "FNT_Ghost"), /✅ In-Game Name: \*\*FNT\\_Ghost\*\*/);
    const cardMessage = buildCheckpointCardMessage("1", "FNT_Ghost", 80, getCheckpointTier(80), Buffer.from([0]));
    assert.equal(cardMessage.embeds[0].toJSON().title, "FNT\\_Ghost • PMC Rating 80", "card title uses the in-game name");

    assert.deepEqual(parseCheckpointStat("playerKills", "1,240"), { ok: true, value: 1240 });
    assert.deepEqual(parseCheckpointStat("winRate", "56.1%"), { ok: true, value: 56.1 });
    assert.deepEqual(parseCheckpointStat("moneyEarned", "15.4m"), { ok: true, value: 15_400_000 });
    assert.deepEqual(parseCheckpointStat("moneyEarned", "₽ 2,500,000"), { ok: true, value: 2_500_000 });
    assert.equal(parseCheckpointStat("playerKills", "12.5").ok, false);
    assert.equal(parseCheckpointStat("playerKills", "5k").ok, false);
    assert.equal(parseCheckpointStat("winRate", "101").ok, false);
    assert.equal(parseCheckpointStat("deaths", "-4").ok, false);
    assert.equal(parseCheckpointStat("deaths", "abc").ok, false);

    assert.deepEqual(validateCheckpointStats(strong), []);
    assert.ok(validateCheckpointStats({ victories: 10, matchesPlayed: 5 }).length === 1);
    assert.ok(validateCheckpointStats({ headshotKills: 50, playerKills: 10 }).length === 1);
    assert.deepEqual(validateCheckpointStats({ victories: 10 }), [], "partial stats validate only known pairs");

    const strongRating = calculateCheckpointRating(strong);
    assert.ok(strongRating.rating >= 1 && strongRating.rating <= 99);
    const zero = Object.fromEntries(CHECKPOINT_STAT_KEYS.map(key => [key, 0])) as Record<CheckpointStatKey, number>;
    assert.ok(calculateCheckpointRating(zero).rating < 30, "an empty record must rate low");
    const maxed = { ...strong, kd: 5, winRate: 90, headshotRate: 70, mvps: 600, playerKills: 15000, highestWinStreak: 30, matchesPlayed: 2000, victories: 1800, moneyEarned: 900_000_000, highestMatchXp: 12000, doubleKills: 2000, overkills: 400, meleeKills: 900, matchesQuit: 0 };
    assert.equal(calculateCheckpointRating(maxed).rating, 99, "ratings cap at 99");
    assert.ok(calculateCheckpointRating({ ...strong, kd: 3 }).rating > strongRating.rating, "better K/D raises rating");
    assert.ok(calculateCheckpointRating({ ...strong, matchesQuit: 150 }).rating < strongRating.rating, "quitting lowers rating");
    const tiny = { ...strong, matchesPlayed: 5, victories: 5, mvps: 5, highestWinStreak: 5 };
    assert.ok(calculateCheckpointRating(tiny).sampleFactor < 1, "small samples are blended");
    assert.equal(getCheckpointTier(95).id, "legend");
    assert.equal(getCheckpointTier(79).id, "veteran");
    assert.equal(getCheckpointTier(10).id, "recruit");

    assert.equal(normalizeCheckpointProfile(null), null);
    const normalized = normalizeCheckpointProfile({ stats: { kd: 1.2, deaths: -1, bogus: 5, playerKills: "9" }, cardMessageId: 5 });
    assert.deepEqual(normalized?.stats, { kd: 1.2 });
    assert.equal(normalized?.cardMessageId, null);
    assert.equal(normalized?.ingameName, null, "older saved profiles start without a name");
    assert.equal(normalizeCheckpointProfile({ ingameName: "FNT_Ghost", stats: {} })?.ingameName, "FNT_Ghost");
    assert.equal(normalizeCheckpointProfile({ ingameName: "bad name!", stats: {} })?.ingameName, null, "invalid saved names are dropped");
    assert.equal(isCheckpointComplete(strong), true);
    assert.equal(isCheckpointComplete({ kd: 1 }), false);

    const card = await renderCheckpointCard({ userId: "123456789012345678", ingameName: "FNT_Ghost", stats: strong, updatedAt: Date.now() });
    assert.equal(card.rating, strongRating.rating);
    assert.deepEqual([...card.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "card must be a PNG");
    console.log(`checkpointCard tests passed (sample rating ${card.rating}, ${card.tier.name})`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
