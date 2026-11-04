"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestManagedRestart = requestManagedRestart;
// Graceful managed restart (used by /restart and the watchdogs).
const node_child_process_1 = require("node:child_process");
require("./env");
const audit_1 = require("./audit");
const checkpoint_1 = require("./checkpoint");
const jsonPersistence_1 = require("../../runtime/jsonPersistence");
async function requestManagedRestart(trigger, requestedByUserId = null) {
    if (!(0, checkpoint_1.checkpointState)(`managed_restart:${trigger}`)) {
        throw new Error("Restart cancelled: one or more state stores failed to checkpoint");
    }
    await (0, jsonPersistence_1.flushJsonWrites)();
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
    // Let the signal handler checkpoint and flush before the supervisor restarts us.
    (0, audit_1.appendAuditEvent)("process_restart_fallback_exit", {
        trigger,
        requestedByUserId,
        strategy: "graceful_sigterm"
    });
    console.warn(`[restart] PM2 restart target unavailable for ${trigger}; requesting graceful shutdown.`);
    process.kill(process.pid, "SIGTERM");
}
