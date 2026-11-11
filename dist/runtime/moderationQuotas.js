"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModerationQuotaStore = void 0;
exports.moderationQuotaWindow = moderationQuotaWindow;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const DEFAULT_POLICY = { limit: null, period: "day" };
const copy = (value) => value === undefined ? value : JSON.parse(JSON.stringify(value));
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 200;
const validAction = (value) => value === "ban" || value === "kick";
const validPolicy = (value) => {
    const policy = value;
    return !!policy && (policy.limit === null || (Number.isSafeInteger(policy.limit) && policy.limit >= 0))
        && ["day", "week", "month"].includes(policy.period);
};
const timestamp = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const policyKey = (row) => JSON.stringify([row.guildId, row.action, row.userId]);
function validate(raw) {
    const data = raw;
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
function moderationQuotaWindow(period, now = Date.now()) {
    if (!timestamp(now))
        throw new Error("Invalid quota timestamp.");
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    if (period === "week")
        date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (period === "month")
        date.setUTCDate(1);
    const start = date.getTime();
    if (period === "month")
        date.setUTCMonth(date.getUTCMonth() + 1);
    else
        date.setUTCDate(date.getUTCDate() + (period === "week" ? 7 : 1));
    return { start, end: date.getTime() };
}
function effective(data, guildId, action, userId) {
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
function usage(data, guildId, action, userId, now) {
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
class ModerationQuotaStore {
    constructor(file, clock = Date.now) {
        this.clock = clock;
        this.file = node_path_1.default.resolve(file);
        this.read();
    }
    read() {
        try {
            return validate(JSON.parse(node_fs_1.default.readFileSync(this.file, "utf8")));
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            if ([".bak", ".bak.1", ".bak.2"].some(suffix => node_fs_1.default.existsSync(`${this.file}${suffix}`))) {
                throw new Error("Primary moderation quota store is missing; backup history requires manual inspection.");
            }
            return { version: 1, policies: [], reservations: [], audit: [] };
        }
    }
    change(mutate) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.file), { recursive: true });
        const lock = `${this.file}.lock`;
        // Never steal a lock: a crashed writer must be inspected instead of risking double spending.
        const lockHandle = node_fs_1.default.openSync(lock, "wx");
        const staging = `${this.file}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.writing`;
        try {
            const data = this.read();
            const result = mutate(data);
            validate(data);
            const handle = node_fs_1.default.openSync(staging, "wx", 0o600);
            try {
                node_fs_1.default.writeFileSync(handle, JSON.stringify(data, null, 2), "utf8");
                node_fs_1.default.fsyncSync(handle);
            }
            finally {
                node_fs_1.default.closeSync(handle);
            }
            if (node_fs_1.default.existsSync(this.file))
                node_fs_1.default.copyFileSync(this.file, `${this.file}.bak`);
            node_fs_1.default.renameSync(staging, this.file);
            return copy(result);
        }
        finally {
            node_fs_1.default.rmSync(staging, { force: true });
            node_fs_1.default.closeSync(lockHandle);
            node_fs_1.default.unlinkSync(lock);
        }
    }
    getPolicy(guildId, action, userId) {
        return copy(effective(this.read(), guildId, action, userId));
    }
    setPolicy(guildId, action, userId, policy, audit = {}) {
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
            if (index >= 0)
                data.policies.splice(index, 1);
            if (policy !== null)
                data.policies.push({ guildId, action, userId, policy: copy(policy) });
            data.audit.push({
                id: (0, node_crypto_1.randomUUID)(), guildId, action, userId, before, after: policy === null ? null : copy(policy),
                actorId: audit.actorId ?? null, reason: (audit.reason ?? "").slice(0, 1000), createdAt: this.clock()
            });
        });
    }
    policies(guildId) {
        return copy(this.read().policies.filter(row => row.guildId === guildId));
    }
    inspect(guildId, action, userId, now = this.clock()) {
        return copy(usage(this.read(), guildId, action, userId, now));
    }
    history(guildId, filters = {}) {
        return copy(this.read().reservations.filter(row => row.guildId === guildId
            && (!filters.userId || row.userId === filters.userId) && (!filters.action || row.action === filters.action)
            && (!filters.status || row.status === filters.status)).reverse());
    }
    audit(guildId) {
        return copy(this.read().audit.filter(row => row.guildId === guildId).reverse());
    }
    reserve(request) {
        if (![request.guildId, request.userId, request.targetId, request.requestId, request.ownerId].every(validId)
            || !validAction(request.action))
            throw new Error("Invalid moderation quota reservation.");
        return this.change(data => {
            const now = this.clock();
            const current = usage(data, request.guildId, request.action, request.userId, now);
            if (data.reservations.some(row => row.guildId === request.guildId && row.action === request.action && row.requestId === request.requestId)) {
                return { allowed: false, reason: "duplicate", usage: current };
            }
            const exempt = request.userId === request.ownerId;
            if (!exempt && current.remaining === 0)
                return { allowed: false, reason: "exhausted", usage: current };
            const reservation = {
                id: (0, node_crypto_1.randomUUID)(), guildId: request.guildId, action: request.action, userId: request.userId,
                targetId: request.targetId, requestId: request.requestId, reason: (request.reason ?? "").slice(0, 1000),
                exempt, policy: { limit: current.policy.limit, period: current.policy.period },
                createdAt: now, updatedAt: now, status: "pending"
            };
            data.reservations.push(reservation);
            return { allowed: true, reservation };
        });
    }
    finish(id, status, error) {
        if (!["succeeded", "rejected", "uncertain"].includes(status))
            throw new Error("Invalid quota outcome.");
        this.change(data => {
            const row = data.reservations.find(item => item.id === id);
            if (!row || row.status !== "pending")
                throw new Error("Quota reservation is not pending.");
            row.status = status;
            row.updatedAt = this.clock();
            if (error !== undefined)
                row.error = error.slice(0, 1000);
        });
    }
}
exports.ModerationQuotaStore = ModerationQuotaStore;
