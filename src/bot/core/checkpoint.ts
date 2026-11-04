// Periodic state checkpoint that saves every store.
import { savePoints } from "../../utils";
import { saveRuntimeMetrics } from "./metrics";
import { saveTradeStore } from "../economy/trades";
import { saveGiveawayStore } from "../giveaways/giveaways";
import { saveBalanceTelemetry } from "./telemetry";
import { appendAuditEvent } from "./audit";
import { saveModerationStore } from "../moderation/store";
import { saveTicketStore } from "../tickets/store";

export function checkpointState(reason: string): void {
    try {
        savePoints();
        saveTradeStore();
        saveGiveawayStore();
        saveModerationStore();
        saveTicketStore();
        saveBalanceTelemetry();
        saveRuntimeMetrics();
        appendAuditEvent("checkpoint", { reason });
    } catch {
        // Best-effort checkpoint only.
    }
}
