// Graceful managed restart (used by /restart and the watchdogs).
import { execFile } from "node:child_process";
import "./env";
import { appendAuditEvent } from "./audit";

export async function requestManagedRestart(trigger: string, requestedByUserId: string | null = null): Promise<void> {
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

    // Fallback: crash-exit so supervisors configured to auto-restart on failures still recover.
    appendAuditEvent("process_restart_fallback_exit", {
        trigger,
        requestedByUserId,
        strategy: "exit_code_1"
    });
    console.warn(`[restart] PM2 restart target unavailable for ${trigger}; exiting with code 1.`);
    setTimeout(() => process.exit(1), 100).unref();
}
