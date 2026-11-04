"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeMetrics = exports.PROCESS_STARTED_AT = exports.ASYNC_FAILURES = void 0;
exports.saveRuntimeMetrics = saveRuntimeMetrics;
exports.recordCommandOutcome = recordCommandOutcome;
exports.recordTicketCreateAttempt = recordTicketCreateAttempt;
exports.recordTicketCreateFailure = recordTicketCreateFailure;
exports.recordRuntimeStartup = recordRuntimeStartup;
exports.recordRuntimeShutdown = recordRuntimeShutdown;
exports.formatMetricDuration = formatMetricDuration;
exports.runAsyncWithBoundary = runAsyncWithBoundary;
// Runtime metrics, audit events, async error boundaries, and state checkpoints.
require("./env");
const config_1 = require("./config");
const ops_1 = require("./ops");
const audit_1 = require("./audit");
const storage_1 = require("./storage");
const embeds_1 = require("../ui/embeds");
exports.ASYNC_FAILURES = [];
exports.PROCESS_STARTED_AT = Date.now();
function defaultRuntimeMetricsStore() {
    const now = Date.now();
    return {
        createdAt: now,
        updatedAt: now,
        command: {
            total: 0,
            success: 0,
            failed: 0,
            byCommand: {}
        },
        tickets: {
            createAttempts: 0,
            createFailures: 0,
            lastFailureAt: null,
            lastFailureReason: null
        },
        availability: {
            totalRestarts: 0,
            lastStartupAt: null,
            lastShutdownAt: null,
            trackedDowntimeMs: 0,
            lastDowntimeMs: 0,
            maxDowntimeMs: 0
        },
        deployment: {
            lastAnnouncedCommit: null,
            lastAnnouncedAt: null,
            lastAnnouncedChannelId: null
        }
    };
}
function parseRuntimeMetricsStore(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const seed = defaultRuntimeMetricsStore();
    const value = raw;
    const command = value.command || seed.command;
    const tickets = value.tickets || seed.tickets;
    const availability = value.availability || seed.availability;
    const deployment = value.deployment || seed.deployment;
    return {
        createdAt: typeof value.createdAt === "number" ? value.createdAt : seed.createdAt,
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : seed.updatedAt,
        command: {
            total: typeof command.total === "number" ? command.total : 0,
            success: typeof command.success === "number" ? command.success : 0,
            failed: typeof command.failed === "number" ? command.failed : 0,
            byCommand: command.byCommand && typeof command.byCommand === "object"
                ? Object.fromEntries(Object.entries(command.byCommand).map(([key, value]) => {
                    const row = (value && typeof value === "object" ? value : {});
                    return [key, {
                            total: typeof row.total === "number" ? row.total : 0,
                            failed: typeof row.failed === "number" ? row.failed : 0,
                            totalDurationMs: typeof row.totalDurationMs === "number" ? row.totalDurationMs : 0,
                            maxDurationMs: typeof row.maxDurationMs === "number" ? row.maxDurationMs : 0,
                            lastDurationMs: typeof row.lastDurationMs === "number" ? row.lastDurationMs : 0
                        }];
                }))
                : {}
        },
        tickets: {
            createAttempts: typeof tickets.createAttempts === "number" ? tickets.createAttempts : 0,
            createFailures: typeof tickets.createFailures === "number" ? tickets.createFailures : 0,
            lastFailureAt: typeof tickets.lastFailureAt === "number" ? tickets.lastFailureAt : null,
            lastFailureReason: typeof tickets.lastFailureReason === "string" ? tickets.lastFailureReason : null
        },
        availability: {
            totalRestarts: typeof availability.totalRestarts === "number" ? availability.totalRestarts : 0,
            lastStartupAt: typeof availability.lastStartupAt === "number" ? availability.lastStartupAt : null,
            lastShutdownAt: typeof availability.lastShutdownAt === "number" ? availability.lastShutdownAt : null,
            trackedDowntimeMs: typeof availability.trackedDowntimeMs === "number" ? availability.trackedDowntimeMs : 0,
            lastDowntimeMs: typeof availability.lastDowntimeMs === "number" ? availability.lastDowntimeMs : 0,
            maxDowntimeMs: typeof availability.maxDowntimeMs === "number" ? availability.maxDowntimeMs : 0
        },
        deployment: {
            lastAnnouncedCommit: typeof deployment.lastAnnouncedCommit === "string" ? deployment.lastAnnouncedCommit : null,
            lastAnnouncedAt: typeof deployment.lastAnnouncedAt === "number" ? deployment.lastAnnouncedAt : null,
            lastAnnouncedChannelId: typeof deployment.lastAnnouncedChannelId === "string" ? deployment.lastAnnouncedChannelId : null
        }
    };
}
function readRuntimeMetrics() {
    return (0, storage_1.readJsonWithBackup)(config_1.METRICS_DATA_FILE, parseRuntimeMetricsStore, defaultRuntimeMetricsStore());
}
exports.runtimeMetrics = readRuntimeMetrics();
let shutdownMetricMarked = false;
function saveRuntimeMetrics() {
    if (process.env.VERIFY_RUNTIME_NO_PERSIST === "1")
        return;
    exports.runtimeMetrics.updatedAt = Date.now();
    (0, storage_1.writeJsonAtomic)(config_1.METRICS_DATA_FILE, exports.runtimeMetrics);
}
function recordCommandOutcome(commandName, success, durationMs = 0) {
    exports.runtimeMetrics.command.total += 1;
    if (success)
        exports.runtimeMetrics.command.success += 1;
    else
        exports.runtimeMetrics.command.failed += 1;
    const key = String(commandName || "unknown").toLowerCase();
    const entry = exports.runtimeMetrics.command.byCommand[key] || {
        total: 0,
        failed: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        lastDurationMs: 0
    };
    entry.total += 1;
    if (!success)
        entry.failed += 1;
    entry.lastDurationMs = Math.max(0, Math.floor(durationMs));
    entry.totalDurationMs += entry.lastDurationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, entry.lastDurationMs);
    exports.runtimeMetrics.command.byCommand[key] = entry;
    saveRuntimeMetrics();
}
function recordTicketCreateAttempt() {
    exports.runtimeMetrics.tickets.createAttempts += 1;
    saveRuntimeMetrics();
}
function recordTicketCreateFailure(reason) {
    exports.runtimeMetrics.tickets.createFailures += 1;
    exports.runtimeMetrics.tickets.lastFailureAt = Date.now();
    exports.runtimeMetrics.tickets.lastFailureReason = (0, embeds_1.clampText)(String(reason || "unknown failure"), 240);
    saveRuntimeMetrics();
}
function recordRuntimeStartup() {
    const now = Date.now();
    const lastShutdown = exports.runtimeMetrics.availability.lastShutdownAt;
    if (typeof lastShutdown === "number" && lastShutdown > 0 && now > lastShutdown) {
        const downtime = now - lastShutdown;
        exports.runtimeMetrics.availability.lastDowntimeMs = downtime;
        exports.runtimeMetrics.availability.trackedDowntimeMs += downtime;
        exports.runtimeMetrics.availability.maxDowntimeMs = Math.max(exports.runtimeMetrics.availability.maxDowntimeMs, downtime);
    }
    exports.runtimeMetrics.availability.totalRestarts += 1;
    exports.runtimeMetrics.availability.lastStartupAt = now;
    shutdownMetricMarked = false;
    saveRuntimeMetrics();
}
function recordRuntimeShutdown(reason) {
    if (shutdownMetricMarked)
        return;
    shutdownMetricMarked = true;
    exports.runtimeMetrics.availability.lastShutdownAt = Date.now();
    saveRuntimeMetrics();
    (0, audit_1.appendAuditEvent)("runtime_shutdown_marked", { reason });
}
function formatMetricDuration(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}
function runAsyncWithBoundary(context, task) {
    void Promise.resolve().then(task).catch(error => {
        const reason = (0, embeds_1.clampText)((0, ops_1.toSafeString)(error), 240);
        console.error(`[async:${context}] ${reason}`);
        (0, audit_1.appendAuditEvent)("async_task_failed", { context, reason });
        exports.ASYNC_FAILURES.push({ context, at: Date.now(), reason });
        if (exports.ASYNC_FAILURES.length > 50)
            exports.ASYNC_FAILURES.splice(0, exports.ASYNC_FAILURES.length - 50);
    });
}
