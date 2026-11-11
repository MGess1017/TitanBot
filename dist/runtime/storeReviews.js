"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreReviews = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
const jsonPersistence_1 = require("./jsonPersistence");
const snowflake = (value) => typeof value === "string" && /^\d{17,21}$/.test(value);
const positive = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value, max) => typeof value === "string" && !!value.trim() && value.length <= max;
function validate(raw) {
    const data = raw;
    if (!data || data.version !== 1 || !Array.isArray(data.fulfillments) || !Array.isArray(data.reviews)
        || !data.fulfillments.every(row => row && text(row.id, 100) && snowflake(row.guildId) && snowflake(row.userId)
            && snowflake(row.actorId) && positive(row.ticketId) && positive(row.itemNumber) && positive(row.itemRevision)
            && text(row.itemName, 80) && text(row.reason, 300) && positive(row.at))
        || new Set(data.fulfillments.map(row => row.id)).size !== data.fulfillments.length
        || new Set(data.fulfillments.map(row => `${row.guildId}:${row.ticketId}`)).size !== data.fulfillments.length
        || !data.reviews.every(row => {
            const fulfillment = data.fulfillments.find(entry => entry.id === row?.fulfillmentId);
            return row && text(row.id, 100) && fulfillment && row.guildId === fulfillment.guildId
                && row.userId === fulfillment.userId && row.itemNumber === fulfillment.itemNumber
                && Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5 && text(row.comment, 500)
                && positive(row.at) && row.at >= fulfillment.at;
        })
        || new Set(data.reviews.map(row => row.id)).size !== data.reviews.length
        || new Set(data.reviews.map(row => row.fulfillmentId)).size !== data.reviews.length) {
        throw new Error("Invalid store review history. Refusing to reset verified reviews.");
    }
    return data;
}
class StoreReviews {
    constructor(file) {
        this.file = file;
        try {
            this.data = validate(JSON.parse(node_fs_1.default.readFileSync(file, "utf8")));
        }
        catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                if ([".bak", ".bak.1", ".bak.2"].some(suffix => node_fs_1.default.existsSync(`${file}${suffix}`)))
                    throw new Error("Review primary is missing. Restore authoritative history before accepting reviews.");
                this.data = { version: 1, fulfillments: [], reviews: [] };
            }
            else
                throw error;
        }
    }
    reviews(guildId, itemNumber) {
        return structuredClone(this.data.reviews.filter(row => row.guildId === guildId && (itemNumber === undefined || row.itemNumber === itemNumber)).slice().reverse());
    }
    fulfillments(guildId) {
        return structuredClone(this.data.fulfillments.filter(row => row.guildId === guildId).slice().reverse());
    }
    eligible(guildId, userId, itemNumber) {
        return this.fulfillments(guildId).find(row => row.userId === userId && row.itemNumber === itemNumber
            && !this.data.reviews.some(review => review.fulfillmentId === row.id));
    }
    confirmFulfillment(input) {
        if (this.data.fulfillments.some(row => row.guildId === input.guildId && row.ticketId === input.ticketId))
            throw new Error("This store request was already marked fulfilled.");
        const row = { ...input, reason: input.reason.trim(), id: (0, node_crypto_1.randomUUID)(), at: Date.now() };
        this.save({ ...this.data, fulfillments: [...this.data.fulfillments, row] });
        return structuredClone(row);
    }
    submit(guildId, userId, fulfillmentId, rating, comment) {
        const fulfillment = this.data.fulfillments.find(row => row.id === fulfillmentId && row.guildId === guildId && row.userId === userId);
        if (!fulfillment)
            throw new Error("Only the recipient of an owner-confirmed fulfilled request may review it.");
        if (this.data.reviews.some(row => row.fulfillmentId === fulfillmentId))
            throw new Error("This fulfilled request already has a review.");
        if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !text(comment.trim(), 500))
            throw new Error("Choose a rating from 1 to 5 and a comment of 1-500 characters.");
        const row = { id: (0, node_crypto_1.randomUUID)(), fulfillmentId, guildId, userId, itemNumber: fulfillment.itemNumber, rating, comment: comment.trim(), at: Date.now() };
        this.save({ ...this.data, reviews: [...this.data.reviews, row] });
        return structuredClone(row);
    }
    save(data) {
        validate(data);
        (0, jsonPersistence_1.writeJsonSnapshotSync)(this.file, data);
        this.data = data;
    }
}
exports.StoreReviews = StoreReviews;
