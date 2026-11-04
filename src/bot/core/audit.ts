// Append-only audit event log.
import fs from "fs-extra";
import crypto from "node:crypto";
import path from "path";
import "./env";
import { EVENT_LOG_FILE } from "./config";

const emittedAuditEventIds = new Set<string>();

export function appendAuditEvent(eventType: string, payload: Record<string, unknown>): void {
    if (process.env.VERIFY_RUNTIME_NO_PERSIST === "1") return;
    try {
        fs.ensureDirSync(path.dirname(EVENT_LOG_FILE));
        const eventId = crypto.createHash("sha256").update(JSON.stringify({ eventType, payload })).digest("hex").slice(0, 24);
        if (emittedAuditEventIds.has(eventId)) return;
        emittedAuditEventIds.add(eventId);
        const line = JSON.stringify({
            eventId,
            ts: new Date().toISOString(),
            eventType,
            ...payload
        });
        fs.appendFileSync(EVENT_LOG_FILE, `${line}\n`, "utf8");
    } catch {
        // Never crash runtime due to audit logging.
    }
}
