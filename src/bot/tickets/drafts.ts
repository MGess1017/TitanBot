// Retains failed ticket submissions for 24 hours, including across restarts.
import path from "node:path";
import { isTicketTopic, pruneTicketDrafts, type TicketDraft } from "../../services/ticketExperience";
import { readJsonWithBackup, writeJsonAtomicSync } from "../core/storage";
import { TICKET_DATA_FILE } from "../core/config";
import { recordSaveResult } from "../core/settings";

const file = path.join(path.dirname(TICKET_DATA_FILE), "ticket-drafts.json");
let drafts = readJsonWithBackup(file, raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const result: Record<string, TicketDraft> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object") return null;
        const draft = value as Partial<TicketDraft>;
        if (!isTicketTopic(draft.category || "") || typeof draft.summary !== "string"
            || typeof draft.details !== "string" || typeof draft.evidence !== "string"
            || typeof draft.at !== "number") return null;
        result[key] = value as TicketDraft;
    }
    return pruneTicketDrafts(result, Date.now());
}, {});

export function getTicketDraft(guildId: string, userId: string): TicketDraft | undefined {
    const draft = drafts[`${guildId}:${userId}`];
    return draft && Date.now() - draft.at < 24 * 60 * 60_000 ? draft : undefined;
}

export function saveTicketDraft(guildId: string, userId: string, draft: TicketDraft | null): boolean {
    const next = pruneTicketDrafts({ ...drafts }, Date.now());
    if (draft) next[`${guildId}:${userId}`] = draft;
    else delete next[`${guildId}:${userId}`];
    try {
        writeJsonAtomicSync(file, next);
        drafts = next;
        recordSaveResult("ticketDrafts", true);
        return true;
    } catch (error) {
        recordSaveResult("ticketDrafts", false, error);
        return false;
    }
}
