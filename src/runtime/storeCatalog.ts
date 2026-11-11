import fs from "node:fs";
import { writeJsonSnapshotSync } from "./jsonPersistence";

export type CatalogItem = {
    number: number; guildId: string; name: string; price: string; description: string; category: string;
    available: boolean; archived: boolean; revision: number; createdAt: number; updatedAt: number; updatedBy: string;
};
export type CatalogItemInput = Pick<CatalogItem, "name" | "price" | "description" | "category">;
type CatalogAudit = { guildId: string; actorId: string; number: number; action: string; reason: string; at: number; revision: number };
type CatalogSnapshot = { version: 1; nextNumbers: Record<string, number>; items: CatalogItem[]; audit: CatalogAudit[] };
const id = (value: string) => /^\d{17,21}$/.test(value);

export function validateCatalogInput(input: CatalogItemInput): CatalogItemInput {
    const clean = { name: input.name.trim(), price: input.price.trim(), description: input.description.trim(), category: input.category.trim() || "General" };
    for (const [key, max] of [["name", 80], ["price", 80], ["description", 1000], ["category", 40]] as const) {
        if (!clean[key] || clean[key].length > max) throw new Error(`${key} must contain 1-${max} characters.`);
    }
    return clean;
}

function validateSnapshot(raw: unknown): CatalogSnapshot {
    const data = raw as CatalogSnapshot;
    if (!data || data.version !== 1 || !data.nextNumbers || typeof data.nextNumbers !== "object"
        || !Array.isArray(data.items) || !Array.isArray(data.audit)) throw new Error("Invalid store catalog. Existing data will not be reset.");
    const seen = new Set<string>();
    for (const item of data.items) {
        validateCatalogInput(item);
        const key = `${item.guildId}:${item.number}`;
        if (!id(item.guildId) || !id(item.updatedBy) || !Number.isSafeInteger(item.number) || item.number < 1
            || !Number.isSafeInteger(item.revision) || item.revision < 1 || typeof item.available !== "boolean" || typeof item.archived !== "boolean"
            || !Number.isSafeInteger(item.createdAt) || item.createdAt <= 0 || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < item.createdAt
            || seen.has(key) || !Number.isSafeInteger(data.nextNumbers[item.guildId]) || data.nextNumbers[item.guildId] <= item.number) {
            throw new Error("Invalid store catalog item or item numbering. Existing data will not be reset.");
        }
        seen.add(key);
    }
    for (const [guildId, next] of Object.entries(data.nextNumbers)) if (!id(guildId) || !Number.isSafeInteger(next) || next < 1) throw new Error("Invalid store catalog sequence.");
    if (!data.audit.every(row => row && id(row.guildId) && id(row.actorId) && Number.isSafeInteger(row.number)
        && row.number > 0 && typeof row.action === "string" && typeof row.reason === "string" && Number.isSafeInteger(row.at) && Number.isSafeInteger(row.revision))) throw new Error("Invalid store audit history.");
    return data;
}

/** One authoritative catalog per bot process. Item numbers are permanent, including archived listings. */
export class StoreCatalog {
    private data: CatalogSnapshot;
    constructor(private readonly file: string) {
        try {
            this.data = validateSnapshot(JSON.parse(fs.readFileSync(file, "utf8")));
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                if ([".bak", ".bak.1", ".bak.2"].some(suffix => fs.existsSync(`${file}${suffix}`))) throw new Error("Store catalog primary is missing while backups exist. Restore it before editing.");
                this.data = { version: 1, nextNumbers: {}, items: [], audit: [] };
            } else throw error;
        }
    }

    list(guildId: string, includeArchived = false): CatalogItem[] {
        return structuredClone(this.data.items.filter(item => item.guildId === guildId && (includeArchived || !item.archived)).sort((a, b) => a.number - b.number));
    }
    get(guildId: string, number: number): CatalogItem | undefined {
        return this.list(guildId, true).find(item => item.number === number);
    }
    history(guildId: string): CatalogAudit[] { return structuredClone(this.data.audit.filter(row => row.guildId === guildId).slice(-10).reverse()); }

    save(guildId: string, actorId: string, input: CatalogItemInput, reason: string, existing?: { number: number; revision: number }): CatalogItem {
        const clean = validateCatalogInput(input);
        return this.commit(guildId, actorId, reason, draft => {
            const previous = existing ? draft.items.find(item => item.guildId === guildId && item.number === existing.number) : undefined;
            if (existing && (!previous || previous.revision !== existing.revision)) throw new Error("This listing changed since preview. Refresh and edit again.");
            const now = Date.now();
            const number = previous?.number ?? draft.nextNumbers[guildId] ?? 1;
            if (!previous) draft.nextNumbers[guildId] = number + 1;
            const item: CatalogItem = { ...clean, guildId, number, available: previous?.available ?? true, archived: previous?.archived ?? false,
                revision: (previous?.revision || 0) + 1, createdAt: previous?.createdAt || now, updatedAt: now, updatedBy: actorId };
            if (previous) draft.items[draft.items.indexOf(previous)] = item;
            else draft.items.push(item);
            return { item, action: previous ? "edit" : "create" };
        });
    }

    setStatus(guildId: string, actorId: string, number: number, revision: number, field: "available" | "archived", value: boolean, reason: string): CatalogItem {
        return this.commit(guildId, actorId, reason, draft => {
            const item = draft.items.find(row => row.guildId === guildId && row.number === number);
            if (!item || item.revision !== revision) throw new Error("This listing changed since preview. Refresh and try again.");
            item[field] = value;
            item.revision++;
            item.updatedAt = Date.now();
            item.updatedBy = actorId;
            return { item, action: `${field}:${value}` };
        });
    }

    private commit(guildId: string, actorId: string, reason: string, mutate: (draft: CatalogSnapshot) => { item: CatalogItem; action: string }): CatalogItem {
        if (!id(guildId) || !id(actorId) || !reason.trim() || reason.length > 300) throw new Error("A valid server, administrator and reason (1-300 characters) are required.");
        const draft = structuredClone(this.data);
        const { item, action } = mutate(draft);
        draft.audit.push({ guildId, actorId, number: item.number, action, reason: reason.trim(), at: Date.now(), revision: item.revision });
        draft.audit = draft.audit.slice(-1000);
        validateSnapshot(draft);
        writeJsonSnapshotSync(this.file, draft);
        this.data = draft;
        return structuredClone(item);
    }
}
