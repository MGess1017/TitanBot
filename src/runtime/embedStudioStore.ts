import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { readJsonWithBackup, writeJsonAtomicSync } from "../bot/core/storage";
import type { StaffEmbedDraft } from "../features/embedBuilder";

export type StudioPublication = {
    id: string;
    draft: StaffEmbedDraft;
    status: "scheduled" | "publishing" | "published" | "failed" | "canceled";
    createdAt: number;
    runAt: number;
    timezone: string;
    confirmedAt: number;
    url?: string;
    error?: string;
};
type SavedDraft = { id: string; name: string; draft: StaffEmbedDraft };
type StudioSnapshot = { version: 1; drafts: SavedDraft[]; publications: StudioPublication[] };

function parseSnapshot(raw: unknown): StudioSnapshot | null {
    const data = raw as StudioSnapshot;
    const validDraft = (draft: StaffEmbedDraft) => draft && typeof draft.id === "string"
        && typeof draft.ownerId === "string" && typeof draft.guildId === "string"
        && typeof draft.title === "string" && draft.title.length <= 256
        && typeof draft.description === "string" && draft.description.length <= 4000
        && (draft.channelId === null || typeof draft.channelId === "string")
        && ["Purple", "Blue", "Green", "Gold", "Orange", "Red", "Teal", "White", "Midnight"].includes(draft.color)
        && Array.isArray(draft.userIds) && draft.userIds.length <= 5 && draft.userIds.every(id => typeof id === "string")
        && Array.isArray(draft.roleIds) && draft.roleIds.length <= 5 && draft.roleIds.every(id => typeof id === "string")
        && typeof draft.everyone === "boolean";
    if (!data || data.version !== 1 || !Array.isArray(data.drafts) || !Array.isArray(data.publications)
        || !data.drafts.every(row => row && typeof row.id === "string" && typeof row.name === "string" && validDraft(row.draft))
        || !data.publications.every(row => row && typeof row.id === "string" && validDraft(row.draft)
            && ["scheduled", "publishing", "published", "failed", "canceled"].includes(row.status)
            && Number.isFinite(row.createdAt) && Number.isFinite(row.runAt) && Number.isFinite(row.confirmedAt)
            && typeof row.timezone === "string"
            && (row.url === undefined || /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(row.url))
            && (row.error === undefined || typeof row.error === "string"))) return null;
    if (new Set(data.publications.map(row => row.id)).size !== data.publications.length) return null;
    return data;
}

function copy<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }

/** Durable claims precede Discord sends. Interrupted/uncertain sends are never retried automatically. */
export class EmbedStudioStore {
    private data: StudioSnapshot;

    constructor(private readonly file: string) {
        let primaryValid = false;
        try { primaryValid = parseSnapshot(JSON.parse(fs.readFileSync(file, "utf8"))) !== null; }
        catch { /* Backup recovery must not resurrect schedules that may already have sent. */ }
        const recovering = !primaryValid && [".bak", ".bak.1", ".bak.2"].some(suffix => fs.existsSync(`${file}${suffix}`));
        this.data = readJsonWithBackup(file, parseSnapshot, { version: 1, drafts: [], publications: [] });
        if (this.data.publications.some(row => row.status === "publishing" || (recovering && row.status === "scheduled"))) {
            this.change(() => {
                for (const row of this.data.publications) {
                    if (row.status !== "publishing" && !(recovering && row.status === "scheduled")) continue;
                    row.status = "failed";
                    row.error = recovering
                        ? "Store recovered from backup. Schedule disabled to prevent duplicate delivery; check the destination before creating another announcement."
                        : "Publishing was interrupted. Delivery is uncertain; check the destination before creating another announcement.";
                }
            });
        }
    }

    private change<T>(mutate: () => T): T {
        const previous = copy(this.data);
        try {
            const result = mutate();
            writeJsonAtomicSync(this.file, this.data);
            return copy(result);
        } catch (error) {
            this.data = previous;
            throw error;
        }
    }

    saved(guildId: string, ownerId: string): SavedDraft[] {
        return copy(this.data.drafts.filter(row => row.draft.guildId === guildId && row.draft.ownerId === ownerId));
    }

    save(name: string, draft: StaffEmbedDraft): void {
        name = name.trim();
        if (!name || name.length > 80) throw new Error("Name your saved draft (1-80 characters).");
        this.change(() => {
            const owned = this.data.drafts.filter(row => row.draft.guildId === draft.guildId && row.draft.ownerId === draft.ownerId);
            const existing = owned.find(row => row.name.toLowerCase() === name.toLowerCase());
            if (existing) { existing.name = name; existing.draft = copy(draft); }
            else {
                if (owned.length >= 25) throw new Error("You have 25 saved drafts. Reuse an existing name to replace one.");
                this.data.drafts.push({ id: randomUUID(), name, draft: copy(draft) });
            }
        });
    }

    history(guildId: string, ownerId: string): StudioPublication[] {
        return copy(this.data.publications.filter(row => row.draft.guildId === guildId && row.draft.ownerId === ownerId).reverse());
    }

    create(draft: StaffEmbedDraft, schedule?: { runAt: number; timezone: string }): StudioPublication {
        return this.change(() => {
            if (this.data.publications.some(row => row.draft.id === draft.id)) throw new Error("This draft has already been submitted.");
            const row: StudioPublication = {
                id: randomUUID(), draft: copy(draft), status: schedule ? "scheduled" : "publishing",
                createdAt: Date.now(), runAt: schedule?.runAt ?? Date.now(),
                timezone: schedule?.timezone ?? "Immediate", confirmedAt: Date.now()
            };
            this.data.publications.push(row);
            return row;
        });
    }

    due(guildId: string, now = Date.now()): StudioPublication[] {
        return copy(this.data.publications.filter(row => row.draft.guildId === guildId && row.status === "scheduled" && row.runAt <= now));
    }

    claim(id: string): StudioPublication | null {
        const row = this.data.publications.find(item => item.id === id);
        if (!row || row.status !== "scheduled") return null;
        return this.change(() => { row.status = "publishing"; return row; });
    }

    finish(id: string, result: { url: string } | { error: string }): void {
        const row = this.data.publications.find(item => item.id === id);
        if (!row || row.status !== "publishing") throw new Error("Publication is not in progress.");
        this.change(() => {
            if ("url" in result) { row.status = "published"; row.url = result.url; }
            else { row.status = "failed"; row.error = result.error.slice(0, 1000); }
        });
    }

    cancel(id: string, guildId: string, ownerId: string): void {
        const row = this.data.publications.find(item => item.id === id && item.draft.guildId === guildId && item.draft.ownerId === ownerId);
        if (!row || row.status !== "scheduled") throw new Error("That schedule is unavailable or has already started.");
        this.change(() => { row.status = "canceled"; });
    }
}
