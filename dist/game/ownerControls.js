"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_VALUE_MAX = exports.OWNER_VALUE_FIELDS = void 0;
exports.parseOwnerAmount = parseOwnerAmount;
exports.previewOwnerValue = previewOwnerValue;
exports.OWNER_VALUE_FIELDS = {
    xp: "Server XP", pmcXP: "PMC XP", fnTokens: "FN Tokenz wallet", bankTokens: "Banked FN Tokenz", modPoints: "Access Points"
};
exports.OWNER_VALUE_MAX = 1000000000000;
function parseOwnerAmount(input) {
    const text = input.trim();
    if (!/^(0|[1-9]\d*)$/.test(text))
        throw new Error("Enter a non-negative whole number without commas or abbreviations.");
    const amount = Number(text);
    if (!Number.isSafeInteger(amount) || amount > exports.OWNER_VALUE_MAX)
        throw new Error(`Amount must be between 0 and ${exports.OWNER_VALUE_MAX.toLocaleString("en-US")}.`);
    return amount;
}
function previewOwnerValue(before, operation, amount) {
    if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(amount) || amount < 0 || amount > exports.OWNER_VALUE_MAX) {
        throw new Error("The current value or requested amount is invalid. No changes were made.");
    }
    if (!["set", "add", "remove"].includes(operation))
        throw new Error("Unknown balance operation.");
    const after = operation === "set" ? amount : operation === "add" ? before + amount : before - amount;
    if (!Number.isSafeInteger(after) || after < 0 || after > exports.OWNER_VALUE_MAX) {
        throw new Error(`Result must be between 0 and ${exports.OWNER_VALUE_MAX.toLocaleString("en-US")}; values are never silently clamped.`);
    }
    return after;
}
