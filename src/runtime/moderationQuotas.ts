import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ModerationQuotaAction = "ban" | "kick";
export type ModerationQuotaPeriod = "day" | "week" | "month";
export type ModerationQuotaPolicy = { limit: number | null; period: ModerationQuotaPeriod };
export type QuotaPolicy = ModerationQuotaPolicy;
export type ModerationQuotaStatus = "pending" | "succeeded" | "rejected" | "uncertain";
export type ModerationQuotaReservation = {
    id: string; guildId: string; action: ModerationQuotaAction; userId: string; targetId: string;
    requestId: string; createdAt: number; updatedAt: number; status: ModerationQuotaStatus;
    exempt: boolean; policy: ModerationQuotaPolicy; reason: string; error?: string;
};
export type ModerationQuotaPolicyEntry = {
    guildId: string; action: ModerationQuotaAction; userId: string | null; policy: ModerationQuotaPolicy;
};
export type ModerationQuotaAudit = {
    id: string; guildId: string; action: ModerationQuotaAction; userId: string | null;
    actorId: string | null; reason: string; createdAt: number;
    before: ModerationQuotaPolicy | null; after: ModerationQuotaPolicy | null;
};
export type EffectiveModerationQuotaPolicy = ModerationQuotaPolicy & {
    source: "override" | "guild" | "default"; inherited: boolean;
    override: ModerationQuotaPolicy | null; guildPolicy: ModerationQuotaPolicy;
};
export type ModerationQuotaUsage = {
    policy: EffectiveModerationQuotaPolicy; window: { start: number; end: number };
    used: number; remaining: number | null; pending: number; uncertain: number;
};
export type ModerationQuotaRequest = {
    guildId: string; action: ModerationQuotaAction; userId: string; targetId: string;
    requestId: string; ownerId: string; reason?: string;
};
type Snapshot = {
    version: 1; policies: ModerationQuotaPolicyEntry[];
    reservations: ModerationQuotaReservation[]; audit: ModerationQuotaAudit[];
};
const DEFAULT_POLICY: ModerationQuotaPolicy = { limit: null, period: "day" };
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const validAction = (value: unknown): value is ModerationQuotaAction => value === "ban" || value === "kick";
const validPolicy = (value: unknown): value is ModerationQuotaPolicy => {
    const policy = value as ModerationQuotaPolicy | null;
    return !!policy && (policy.limit === null || (Number.isSafeInteger(policy.limit) && policy.limit >= 0))
        && ["day", "week", "month"].includes(policy.period);
};
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const policyKey = (row: ModerationQuotaPolicyEntry) => JSON.stringify([row.guildId, row.action, row.userId]);

function validate(raw: unknown): Snapshot {
    const data = raw as Snapshot;
    if (!data || data.version !== 1 || !Array.isArray(data.policies) || !Array.isArray(data.reservations) || !Array.isArray(data.audit)
        || !data.policies.every(row => row && validId(row.guildId) && validAction(row.action)
            && (row.userId === null || validId(row.userId)) && validPolicy(row.policy))
        || new Set(data.policies.map(policyKey)).size !== data.policies.length
        || !data.reservations.every(row => row && validId(row.id) && validId(row.guildId) && validAction(row.action)
            && validId(row.userId) && validId(row.targetId) && validId(row.requestId) && timestamp(row.createdAt)
            && timestamp(row.updatedAt) && row.updatedAt >= row.createdAt
            && ["pending", "succeeded", "rejected", "uncertain"].includes(row.status)
            && typeof row.exempt === "boolean" && validPolicy(row.policy) && typeof row.reason === "string"
            && (row.error === undefined || typeof row.error === "string"))
        || new Set(data.reservations.map(row => row.id)).size !== data.reservations.length
        || new Set(data.reservations.map(row => JSON.stringify([row.guildId, row.action, row.requestId]))).size !== data.reservations.length
        || !data.audit.every(row => row && validId(row.id) && validId(row.guildId) && validAction(row.action)
            && (row.userId === null || validId(row.userId)) && (row.actorId === null || validId(row.actorId))
            && typeof row.reason === "string" && timestamp(row.createdAt)
            && (row.before === null || validPolicy(row.before)) && (row.after === null || validPolicy(row.after)))) {
        throw new Error("Invalid moderation quota store; refusing to reset history or recover from an older backup.");
    }
    return data;
}

export function moderationQuotaWindow(period: ModerationQuotaPeriod, now = Date.now()): { start: number; end: number } {
    if (!timestamp(now)) throw new Error("Invalid quota timestamp.");
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    if (period === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (period === "month") date.setUTCDate(1);
    const start = date.getTime();
    if (period === "month") date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCDate(date.getUTCDate() + (period === "week" ? 7 : 1));
    return { start, end: date.getTime() };
}

function effective(data: Snapshot, guildId: string, action: ModerationQuotaAction, userId?: string): EffectiveModerationQuotaPolicy {
    const guild = data.policies.find(row => row.guildId === guildId && row.action === action && row.userId === null);
    const override = userId ? data.policies.find(row => row.guildId === guildId && row.action === action && row.userId === userId) : undefined;
    return {
        ...(override?.policy ?? guild?.policy ?? DEFAULT_POLICY),
        source: override ? "override" : guild ? "guild" : "default",
        inherited: !!userId && !override,
        override: override?.policy ?? null,
        guildPolicy: guild?.policy ?? DEFAULT_POLICY
    };
}

function usage(data: Snapshot, guildId: string, action: ModerationQuotaAction, userId: string, now: number): ModerationQuotaUsage {
    const policy = effective(data, guildId, action, userId);
    const window = moderationQuotaWindow(policy.period, now);
    const rows = data.reservations.filter(row => row.guildId === guildId && row.action === action && row.userId === userId
        && !row.exempt && row.status !== "rejected" && row.createdAt >= window.start && row.createdAt < window.end);
    return {
        policy, window, used: rows.length, remaining: policy.limit === null ? null : Math.max(0, policy.limit - rows.length),
        pending: rows.filter(row => row.status === "pending").length,
        uncertain: rows.filter(row => row.status === "uncertain").length
    };
}

/** Every operation reloads the authoritative file. A cross-process lock serializes durable reservations and settings. */
export class ModerationQuotaStore {
    readonly file: string;
    constructor(file: string, private readonly clock: () => number = Date.now) {
        this.file = path.resolve(file);
        this.read();
    }

    private read(): Snapshot {
        try { return validate(JSON.parse(fs.readFileSync(this.file, "utf8"))); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            if ([".bak", ".bak.1", ".bak.2"].some(suffix => fs.existsSync(`${this.file}${suffix}`))) {
                throw new Error("Primary moderation quota store is missing; backup history requires manual inspection.");
            }
            return { version: 1, policies: [], reservations: [], audit: [] };
        }
    }

    private change<T>(mutate: (data: Snapshot) => T): T {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const lock = `${this.file}.lock`;
        // Never steal a lock: a crashed writer must be inspected instead of risking double spending.
        const lockHandle = fs.openSync(lock, "wx");
        const staging = `${this.file}.${process.pid}.${randomUUID()}.writing`;
        try {
            const data = this.read();
            const result = mutate(data);
            validate(data);
            const handle = fs.openSync(staging, "wx", 0o600);
            try { fs.writeFileSync(handle, JSON.stringify(data, null, 2), "utf8"); fs.fsyncSync(handle); }
            finally { fs.closeSync(handle); }
            if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
            fs.renameSync(staging, this.file);
            return copy(result);
        } finally {
            fs.rmSync(staging, { force: true });
            fs.closeSync(lockHandle);
            fs.unlinkSync(lock);
        }
    }

    getPolicy(guildId: string, action: ModerationQuotaAction, userId?: string): EffectiveModerationQuotaPolicy {
        return copy(effective(this.read(), guildId, action, userId));
    }

    setPolicy(guildId: string, action: ModerationQuotaAction, userId: string | null, policy: ModerationQuotaPolicy | null,
        audit: { actorId?: string; reason?: string } = {}): void {
        if (userId === null && policy === null) {
            throw new Error("A guild default requires an explicit policy; use limit: null for unlimited. Only per-user overrides can be removed.");
        }
        if (!validId(guildId) || !validAction(action) || (userId !== null && !validId(userId))
            || (policy !== null && !validPolicy(policy)) || (audit.actorId !== undefined && !validId(audit.actorId))) {
            throw new Error("Invalid moderation quota policy.");
        }
        this.change(data => {
            const index = data.policies.findIndex(row => row.guildId === guildId && row.action === action && row.userId === userId);
            const before = index < 0 ? null : copy(data.policies[index].policy);
            if (index >= 0) data.policies.splice(index, 1);
            if (policy !== null) data.policies.push({ guildId, action, userId, policy: copy(policy) });
            data.audit.push({
                id: randomUUID(), guildId, action, userId, before, after: policy === null ? null : copy(policy),
                actorId: audit.actorId ?? null, reason: (audit.reason ?? "").slice(0, 1000), createdAt: this.clock()
            });
        });
    }

    policies(guildId: string): ModerationQuotaPolicyEntry[] {
        return copy(this.read().policies.filter(row => row.guildId === guildId));
    }

    inspect(guildId: string, action: ModerationQuotaAction, userId: string, now = this.clock()): ModerationQuotaUsage {
        return copy(usage(this.read(), guildId, action, userId, now));
    }

    history(guildId: string, filters: { userId?: string; action?: ModerationQuotaAction; status?: ModerationQuotaStatus } = {}): ModerationQuotaReservation[] {
        return copy(this.read().reservations.filter(row => row.guildId === guildId
            && (!filters.userId || row.userId === filters.userId) && (!filters.action || row.action === filters.action)
            && (!filters.status || row.status === filters.status)).reverse());
    }

    audit(guildId: string): ModerationQuotaAudit[] {
        return copy(this.read().audit.filter(row => row.guildId === guildId).reverse());
    }

    reserve(request: ModerationQuotaRequest): { allowed: true; reservation: ModerationQuotaReservation }
        | { allowed: false; reason: "duplicate" | "exhausted"; usage: ModerationQuotaUsage } {
        if (![request.guildId, request.userId, request.targetId, request.requestId, request.ownerId].every(validId)
            || !validAction(request.action)) throw new Error("Invalid moderation quota reservation.");
        return this.change(data => {
            const now = this.clock();
            const current = usage(data, request.guildId, request.action, request.userId, now);
            if (data.reservations.some(row => row.guildId === request.guildId && row.action === request.action && row.requestId === request.requestId)) {
                return { allowed: false as const, reason: "duplicate" as const, usage: current };
            }
            const exempt = request.userId === request.ownerId;
            if (!exempt && current.remaining === 0) return { allowed: false as const, reason: "exhausted" as const, usage: current };
            const reservation: ModerationQuotaReservation = {
                id: randomUUID(), guildId: request.guildId, action: request.action, userId: request.userId,
                targetId: request.targetId, requestId: request.requestId, reason: (request.reason ?? "").slice(0, 1000),
                exempt, policy: { limit: current.policy.limit, period: current.policy.period },
                createdAt: now, updatedAt: now, status: "pending"
            };
            data.reservations.push(reservation);
            return { allowed: true as const, reservation };
        });
    }

    finish(id: string, status: Exclude<ModerationQuotaStatus, "pending">, error?: string): void {
        if (!["succeeded", "rejected", "uncertain"].includes(status)) throw new Error("Invalid quota outcome.");
        this.change(data => {
            const row = data.reservations.find(item => item.id === id);
            if (!row || row.status !== "pending") throw new Error("Quota reservation is not pending.");
            row.status = status;
            row.updatedAt = this.clock();
            if (error !== undefined) row.error = error.slice(0, 1000);
        });
    }
}
