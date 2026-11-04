// Runtime metrics, audit events, async error boundaries, and state checkpoints.
import "./env";
import { METRICS_DATA_FILE } from "./config";
import { toSafeString } from "./ops";
import { appendAuditEvent } from "./audit";
import { readJsonWithBackup, writeJsonAtomic } from "./storage";
import { clampText } from "../ui/embeds";

export const ASYNC_FAILURES: Array<{ context: string; at: number; reason: string }> = [];
export const PROCESS_STARTED_AT = Date.now();

type RuntimeMetricsStore = {
    createdAt: number;
    updatedAt: number;
    command: {
        total: number;
        success: number;
        failed: number;
        byCommand: Record<string, { total: number; failed: number; totalDurationMs: number; maxDurationMs: number; lastDurationMs: number }>;
    };
    tickets: {
        createAttempts: number;
        createFailures: number;
        lastFailureAt: number | null;
        lastFailureReason: string | null;
    };
    availability: {
        totalRestarts: number;
        lastStartupAt: number | null;
        lastShutdownAt: number | null;
        trackedDowntimeMs: number;
        lastDowntimeMs: number;
        maxDowntimeMs: number;
    };
    deployment: {
        lastAnnouncedCommit: string | null;
        lastAnnouncedAt: number | null;
        lastAnnouncedChannelId: string | null;
    };
};

function defaultRuntimeMetricsStore(): RuntimeMetricsStore {
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

function parseRuntimeMetricsStore(raw: unknown): RuntimeMetricsStore | null {
    if (!raw || typeof raw !== "object") return null;
    const seed = defaultRuntimeMetricsStore();
    const value = raw as Partial<RuntimeMetricsStore>;
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
                ? Object.fromEntries(
                    Object.entries(command.byCommand).map(([key, value]) => {
                        const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
                        return [key, {
                            total: typeof row.total === "number" ? row.total : 0,
                            failed: typeof row.failed === "number" ? row.failed : 0,
                            totalDurationMs: typeof row.totalDurationMs === "number" ? row.totalDurationMs : 0,
                            maxDurationMs: typeof row.maxDurationMs === "number" ? row.maxDurationMs : 0,
                            lastDurationMs: typeof row.lastDurationMs === "number" ? row.lastDurationMs : 0
                        }];
                    })
                )
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

function readRuntimeMetrics(): RuntimeMetricsStore {
    return readJsonWithBackup(METRICS_DATA_FILE, parseRuntimeMetricsStore, defaultRuntimeMetricsStore());
}

export const runtimeMetrics = readRuntimeMetrics();
let shutdownMetricMarked = false;

export function saveRuntimeMetrics(): void {
    if (process.env.VERIFY_RUNTIME_NO_PERSIST === "1") return;
    runtimeMetrics.updatedAt = Date.now();
    writeJsonAtomic(METRICS_DATA_FILE, runtimeMetrics);
}

export function recordCommandOutcome(commandName: string, success: boolean, durationMs = 0): void {
    runtimeMetrics.command.total += 1;
    if (success) runtimeMetrics.command.success += 1;
    else runtimeMetrics.command.failed += 1;

    const key = String(commandName || "unknown").toLowerCase();
    const entry = runtimeMetrics.command.byCommand[key] || {
        total: 0,
        failed: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        lastDurationMs: 0
    };
    entry.total += 1;
    if (!success) entry.failed += 1;
    entry.lastDurationMs = Math.max(0, Math.floor(durationMs));
    entry.totalDurationMs += entry.lastDurationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, entry.lastDurationMs);
    runtimeMetrics.command.byCommand[key] = entry;
    saveRuntimeMetrics();
}

export function recordTicketCreateAttempt(): void {
    runtimeMetrics.tickets.createAttempts += 1;
    saveRuntimeMetrics();
}

export function recordTicketCreateFailure(reason: string): void {
    runtimeMetrics.tickets.createFailures += 1;
    runtimeMetrics.tickets.lastFailureAt = Date.now();
    runtimeMetrics.tickets.lastFailureReason = clampText(String(reason || "unknown failure"), 240);
    saveRuntimeMetrics();
}

export function recordRuntimeStartup(): void {
    const now = Date.now();
    const lastShutdown = runtimeMetrics.availability.lastShutdownAt;
    if (typeof lastShutdown === "number" && lastShutdown > 0 && now > lastShutdown) {
        const downtime = now - lastShutdown;
        runtimeMetrics.availability.lastDowntimeMs = downtime;
        runtimeMetrics.availability.trackedDowntimeMs += downtime;
        runtimeMetrics.availability.maxDowntimeMs = Math.max(runtimeMetrics.availability.maxDowntimeMs, downtime);
    }
    runtimeMetrics.availability.totalRestarts += 1;
    runtimeMetrics.availability.lastStartupAt = now;
    shutdownMetricMarked = false;
    saveRuntimeMetrics();
}

export function recordRuntimeShutdown(reason: string): void {
    if (shutdownMetricMarked) return;
    shutdownMetricMarked = true;
    runtimeMetrics.availability.lastShutdownAt = Date.now();
    saveRuntimeMetrics();
    appendAuditEvent("runtime_shutdown_marked", { reason });
}

export function formatMetricDuration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

export function runAsyncWithBoundary(context: string, task: () => Promise<unknown>): void {
    void Promise.resolve().then(task).catch(error => {
        const reason = clampText(toSafeString(error), 240);
        console.error(`[async:${context}] ${reason}`);
        appendAuditEvent("async_task_failed", { context, reason });
        ASYNC_FAILURES.push({ context, at: Date.now(), reason });
        if (ASYNC_FAILURES.length > 50) ASYNC_FAILURES.splice(0, ASYNC_FAILURES.length - 50);
    });
}
