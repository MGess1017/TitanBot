// Graceful managed restart (used by /restart and the watchdogs).
import { execFile } from "node:child_process";
import "./env";
import { appendAuditEvent } from "./audit";
import { checkpointState } from "./checkpoint";
import { flushJsonWrites } from "../../runtime/jsonPersistence";

export async function requestManagedRestart(trigger: string, requestedByUserId: string | null = null): Promise<void> {
    if (!checkpointState(`managed_restart:${trigger}`)) {
        throw new Error("Restart cancelled: one or more state stores failed to checkpoint");
    }
    await flushJsonWrites();
    const pm2IdRaw = String(process.env.pm_id || "").trim();
    const pm2Name = String(process.env.name || process.env.PM2_PROCESS_NAME || "").trim();
    const restartTargets: string[] = [];

    if (/^\d+$/.test(pm2IdRaw)) {
        restartTargets.push(pm2IdRaw);
    }
    if (pm2Name) {
        restartTargets.push(pm2Name);
    }

    for (const target of restartTargets) {
        try {
            await new Promise<void>((resolve, reject) => {
                execFile("pm2", ["restart", target], { timeout: 15_000, windowsHide: true }, error => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            appendAuditEvent("process_restart_requested", {
                trigger,
                requestedByUserId,
                strategy: "pm2_restart",
                target
            });
            console.log(`[restart] Requested PM2 restart via target '${target}' from ${trigger}.`);
            return;
        } catch (error) {
            appendAuditEvent("process_restart_attempt_failed", {
                trigger,
                requestedByUserId,
                strategy: "pm2_restart",
                target,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Let the signal handler checkpoint and flush before the supervisor restarts us.
    appendAuditEvent("process_restart_fallback_exit", {
        trigger,
        requestedByUserId,
        strategy: "graceful_sigterm"
    });
    console.warn(`[restart] PM2 restart target unavailable for ${trigger}; requesting graceful shutdown.`);
    process.kill(process.pid, "SIGTERM");
}
