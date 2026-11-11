export const OWNER_VALUE_FIELDS = {
    xp: "Server XP", pmcXP: "PMC XP", fnTokens: "FN Tokenz wallet", bankTokens: "Banked FN Tokenz", modPoints: "Access Points"
} as const;
export type OwnerValueField = keyof typeof OWNER_VALUE_FIELDS;
export type OwnerValueOperation = "set" | "add" | "remove";
export type OwnerValueChange = {
    id: string; actorId: string; guildId: string; targetId: string; field: OwnerValueField;
    operation: OwnerValueOperation; amount: number; before: number; after: number; reason: string; at: number;
};
export const OWNER_VALUE_MAX = 1_000_000_000_000;

export function parseOwnerAmount(input: string): number {
    const text = input.trim();
    if (!/^(0|[1-9]\d*)$/.test(text)) throw new Error("Enter a non-negative whole number without commas or abbreviations.");
    const amount = Number(text);
    if (!Number.isSafeInteger(amount) || amount > OWNER_VALUE_MAX) throw new Error(`Amount must be between 0 and ${OWNER_VALUE_MAX.toLocaleString("en-US")}.`);
    return amount;
}

export function previewOwnerValue(before: number, operation: OwnerValueOperation, amount: number): number {
    if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(amount) || amount < 0 || amount > OWNER_VALUE_MAX) {
        throw new Error("The current value or requested amount is invalid. No changes were made.");
    }
    if (!["set", "add", "remove"].includes(operation)) throw new Error("Unknown balance operation.");
    const after = operation === "set" ? amount : operation === "add" ? before + amount : before - amount;
    if (!Number.isSafeInteger(after) || after < 0 || after > OWNER_VALUE_MAX) {
        throw new Error(`Result must be between 0 and ${OWNER_VALUE_MAX.toLocaleString("en-US")}; values are never silently clamped.`);
    }
    return after;
}
