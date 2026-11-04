"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestManagedRestart = requestManagedRestart;
// Graceful managed restart (used by /restart and the watchdogs).
const node_child_process_1 = require("node:child_process");
require("./env");
const audit_1 = require("./audit");
async function requestManagedRestart(trigger, requestedByUserId = null) {
    const pm2IdRaw = String(process.env.pm_id || "").trim();
    const pm2Name = String(process.env.name || process.env.PM2_PROCESS_NAME || "").trim();
    const restartTargets = [];
    if (/^\d+$/.test(pm2IdRaw)) {
        restartTargets.push(pm2IdRaw);
    }
    if (pm2Name) {
        restartTargets.push(pm2Name);
    }
    for (const target of restartTargets) {
        try {
            await new Promise((resolve, reject) => {
                (0, node_child_process_1.execFile)("pm2", ["restart", target], { timeout: 15000, windowsHide: true }, error => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
            (0, audit_1.appendAuditEvent)("process_restart_requested", {
                trigger,
                requestedByUserId,
                strategy: "pm2_restart",
                target
            });
            console.log(`[restart] Requested PM2 restart via target '${target}' from ${trigger}.`);
            return;
        }
        catch (error) {
            (0, audit_1.appendAuditEvent)("process_restart_attempt_failed", {
                trigger,
                requestedByUserId,
                strategy: "pm2_restart",
                target,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    // Fallback: crash-exit so supervisors configured to auto-restart on failures still recover.
    (0, audit_1.appendAuditEvent)("process_restart_fallback_exit", {
        trigger,
        requestedByUserId,
        strategy: "exit_code_1"
    });
    console.warn(`[restart] PM2 restart target unavailable for ${trigger}; exiting with code 1.`);
    setTimeout(() => process.exit(1), 100).unref();
}
