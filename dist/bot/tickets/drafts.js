"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTicketDraft = getTicketDraft;
exports.saveTicketDraft = saveTicketDraft;
// Retains failed ticket submissions for 24 hours, including across restarts.
const node_path_1 = __importDefault(require("node:path"));
const ticketExperience_1 = require("../../services/ticketExperience");
const storage_1 = require("../core/storage");
const config_1 = require("../core/config");
const settings_1 = require("../core/settings");
const file = node_path_1.default.join(node_path_1.default.dirname(config_1.TICKET_DATA_FILE), "ticket-drafts.json");
let drafts = (0, storage_1.readJsonWithBackup)(file, raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object")
            return null;
        const draft = value;
        if (!(0, ticketExperience_1.isTicketTopic)(draft.category || "") || typeof draft.summary !== "string"
            || typeof draft.details !== "string" || typeof draft.evidence !== "string"
            || typeof draft.at !== "number")
            return null;
        result[key] = value;
    }
    return (0, ticketExperience_1.pruneTicketDrafts)(result, Date.now());
}, {});
function getTicketDraft(guildId, userId) {
    const draft = drafts[`${guildId}:${userId}`];
    return draft && Date.now() - draft.at < 24 * 60 * 60000 ? draft : undefined;
}
function saveTicketDraft(guildId, userId, draft) {
    const next = (0, ticketExperience_1.pruneTicketDrafts)({ ...drafts }, Date.now());
    if (draft)
        next[`${guildId}:${userId}`] = draft;
    else
        delete next[`${guildId}:${userId}`];
    try {
        (0, storage_1.writeJsonAtomicSync)(file, next);
        drafts = next;
        (0, settings_1.recordSaveResult)("ticketDrafts", true);
        return true;
    }
    catch (error) {
        (0, settings_1.recordSaveResult)("ticketDrafts", false, error);
        return false;
    }
}
