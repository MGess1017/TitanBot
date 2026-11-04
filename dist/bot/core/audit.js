"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendAuditEvent = appendAuditEvent;
// Append-only audit event log.
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const path_1 = __importDefault(require("path"));
require("./env");
const config_1 = require("./config");
const emittedAuditEventIds = new Set();
function appendAuditEvent(eventType, payload) {
    if (process.env.VERIFY_RUNTIME_NO_PERSIST === "1")
        return;
    try {
        fs_extra_1.default.ensureDirSync(path_1.default.dirname(config_1.EVENT_LOG_FILE));
        const eventId = node_crypto_1.default.createHash("sha256").update(JSON.stringify({ eventType, payload })).digest("hex").slice(0, 24);
        if (emittedAuditEventIds.has(eventId))
            return;
        emittedAuditEventIds.add(eventId);
        const line = JSON.stringify({
            eventId,
            ts: new Date().toISOString(),
            eventType,
            ...payload
        });
        fs_extra_1.default.appendFileSync(config_1.EVENT_LOG_FILE, `${line}\n`, "utf8");
    }
    catch (error) {
        console.error("[persistence] Audit log append failed:", error);
    }
}
