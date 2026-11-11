import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StoreReviews } from "./storeReviews";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fnt-reviews-"));
const guildId = "1560000000000000001", userId = "1560000000000000002", actorId = "1560000000000000003";
const input = { guildId, userId, actorId, ticketId: 7, itemNumber: 1, itemRevision: 2, itemName: "Supply Pack", reason: "Delivered and confirmed" };
try {
    const file = path.join(directory, "reviews.json");
    const store = new StoreReviews(file);
    assert.equal(store.eligible(guildId, userId, 1), undefined);
    assert.throws(() => store.submit(guildId, userId, "fake", 5, "Forged"), /Only the recipient/);
    const fulfillment = store.confirmFulfillment(input);
    assert.equal(store.eligible(guildId, userId, 1)?.id, fulfillment.id);
    assert.equal(store.eligible(guildId, actorId, 1), undefined);
    assert.equal(store.eligible(actorId, userId, 1), undefined);
    assert.throws(() => store.confirmFulfillment(input), /already marked/);
    for (const rating of [0, 6, 1.5, NaN]) assert.throws(() => store.submit(guildId, userId, fulfillment.id, rating, "Test"), /rating/);
    for (const comment of ["", " ", "x".repeat(501)]) assert.throws(() => store.submit(guildId, userId, fulfillment.id, 5, comment));
    assert.throws(() => store.submit(guildId, actorId, fulfillment.id, 5, "Wrong user"), /Only the recipient/);
    assert.throws(() => store.submit(actorId, userId, fulfillment.id, 5, "Wrong guild"), /Only the recipient/);
    const review = store.submit(guildId, userId, fulfillment.id, 1, "Honest negative feedback");
    assert.equal(review.rating, 1, "negative reviews publish just like positive ones");
    assert.equal(store.reviews(guildId, 1).length, 1);
    assert.equal(store.reviews(guildId, 2).length, 0);
    assert.equal(store.reviews(actorId).length, 0);
    assert.equal(store.eligible(guildId, userId, 1), undefined);
    assert.throws(() => store.submit(guildId, userId, fulfillment.id, 5, "Duplicate"), /already has a review/);
    const restarted = new StoreReviews(file);
    assert.equal(restarted.reviews(guildId)[0].id, review.id);
    assert.equal(restarted.fulfillments(guildId)[0].reason, input.reason);
    const returned = restarted.reviews(guildId);
    returned[0].rating = 5;
    assert.equal(restarted.reviews(guildId)[0].rating, 1, "query results must not mutate persisted reviews");
    const second = restarted.confirmFulfillment({ ...input, ticketId: 8 });
    restarted.submit(guildId, userId, second.id, 5, "Second fulfilled request");
    assert.equal(restarted.reviews(guildId).length, 2);

    const blockedParent = path.join(directory, "blocked");
    const blocked = new StoreReviews(path.join(blockedParent, "reviews.json"));
    fs.writeFileSync(blockedParent, "not a directory");
    const error = console.error;
    try {
        console.error = () => undefined;
        assert.throws(() => blocked.confirmFulfillment(input));
        assert.equal(blocked.fulfillments(guildId).length, 0, "failed writes must not grant review eligibility");
    } finally { console.error = error; }
    fs.unlinkSync(blockedParent);
    const eligible = blocked.confirmFulfillment(input);
    const directoryFile = path.join(blockedParent, "reviews.json");
    fs.renameSync(directoryFile, `${directoryFile}.saved`);
    fs.mkdirSync(directoryFile);
    try {
        console.error = () => undefined;
        assert.throws(() => blocked.submit(guildId, userId, eligible.id, 5, "Must fail"));
        assert.equal(blocked.reviews(guildId).length, 0, "failed review writes cannot publish in memory");
        assert.ok(blocked.eligible(guildId, userId, 1), "failed submissions remain eligible for retry");
    } finally { console.error = error; }
    fs.rmdirSync(directoryFile);
    fs.renameSync(`${directoryFile}.saved`, directoryFile);
    blocked.submit(guildId, userId, eligible.id, 5, "Retry succeeds");
    const corrupt = path.join(directory, "corrupt.json");
    fs.writeFileSync(corrupt, "{bad");
    assert.throws(() => new StoreReviews(corrupt));
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.reviews[0].userId = actorId;
    fs.writeFileSync(corrupt, JSON.stringify(data));
    assert.throws(() => new StoreReviews(corrupt), /Invalid store review/);
    fs.unlinkSync(corrupt);
    fs.copyFileSync(file, `${corrupt}.bak`);
    assert.throws(() => new StoreReviews(corrupt), /primary is missing/);
    console.log("Store reviews: eligibility, ratings, immutable receipts, duplicate protection, persistence, rollback and corruption checks passed.");
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
