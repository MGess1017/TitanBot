// Periodic state checkpoint that saves every store.
import { savePoints } from "../../utils";
import { saveRuntimeMetrics } from "./metrics";
import { saveTradeStore } from "../economy/trades";
import { saveGiveawayStore } from "../giveaways/giveaways";
import { saveBalanceTelemetry } from "./telemetry";
import { appendAuditEvent } from "./audit";
import { saveModerationStore } from "../moderation/store";
import { saveTicketStore } from "../tickets/store";
import { saveVoiceXpSessions } from "../xp/engagement";

export function runCheckpointSaves(reason: string, saves: Record<string, () => unknown>): string[] {
    const failures: string[] = [];
    for (const [store, save] of Object.entries(saves)) {
        try {
            if (save() === false) throw new Error("Store rejected checkpoint");
        } catch (error) {
            failures.push(store);
            console.error(`[checkpoint] ${reason}: ${store} save failed:`, error);
        }
    }
    return failures;
}

export function checkpointState(reason: string): boolean {
    const failures = runCheckpointSaves(reason, {
        points: savePoints,
        voiceSessions: saveVoiceXpSessions,
        trades: saveTradeStore,
        giveaways: saveGiveawayStore,
        moderation: saveModerationStore,
        tickets: saveTicketStore,
        balanceTelemetry: saveBalanceTelemetry,
        runtimeMetrics: saveRuntimeMetrics
    });
    appendAuditEvent("checkpoint", { reason, failures });
    return failures.length === 0;
}
