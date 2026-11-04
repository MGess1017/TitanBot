"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AntiRaidIncidentStore = exports.AntiRaidDetector = exports.ANTI_RAID_ALERT_COOLDOWN_MS = void 0;
exports.fingerprintMessage = fingerprintMessage;
exports.describeDetection = describeDetection;
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_path_1 = __importDefault(require("node:path"));
exports.ANTI_RAID_ALERT_COOLDOWN_MS = 5 * 60000;
function fingerprintMessage(content) {
    return content.toLowerCase().replace(/<a?:\w+:\d+>/g, ":e:").replace(/https?:\/\/\S+/g, "url").replace(/\s+/g, " ").trim().slice(0, 300);
}
/** In-memory sliding-window detector. Alerts are rate limited per subject so a single incident is reported once. */
class AntiRaidDetector {
    constructor(getThresholds) {
        this.getThresholds = getThresholds;
        this.joins = new Map();
        this.messages = new Map();
        this.lastAlertAt = new Map();
    }
    shouldAlert(key, now) {
        const last = this.lastAlertAt.get(key) || 0;
        if (now - last < exports.ANTI_RAID_ALERT_COOLDOWN_MS)
            return false;
        this.lastAlertAt.set(key, now);
        return true;
    }
    recordJoin(guildId, userId, now = Date.now()) {
        const t = this.getThresholds();
        const windowMs = t.joinWindowSeconds * 1000;
        const recent = (this.joins.get(guildId) || []).filter(entry => now - entry.at <= windowMs);
        recent.push({ at: now, userId });
        this.joins.set(guildId, recent);
        if (recent.length < t.joinThreshold || !this.shouldAlert(`join:${guildId}`, now))
            return null;
        return { kind: "join_flood", guildId, userIds: [...new Set(recent.map(entry => entry.userId))], windowSeconds: t.joinWindowSeconds };
    }
    recordMessage(input) {
        const now = input.now ?? Date.now();
        const t = this.getThresholds();
        if (input.mentionCount >= t.mentionThreshold && this.shouldAlert(`mention:${input.guildId}:${input.userId}`, now)) {
            return {
                kind: "mention_abuse", guildId: input.guildId, userId: input.userId,
                channelId: input.channelId, messageId: input.messageId, mentionCount: input.mentionCount
            };
        }
        const fingerprint = fingerprintMessage(input.content);
        if (!fingerprint)
            return null;
        const key = `${input.guildId}:${input.userId}`;
        const windowMs = t.spamWindowSeconds * 1000;
        const recent = (this.messages.get(key) || []).filter(entry => now - entry.at <= windowMs);
        recent.push({ at: now, fingerprint, channelId: input.channelId, messageId: input.messageId });
        this.messages.set(key, recent.slice(-50));
        const repeats = recent.filter(entry => entry.fingerprint === fingerprint);
        if (repeats.length < t.spamRepeatThreshold || !this.shouldAlert(`spam:${key}`, now))
            return null;
        return {
            kind: "spam", guildId: input.guildId, userId: input.userId,
            channelIds: [...new Set(repeats.map(entry => entry.channelId))],
            messageIds: repeats.map(entry => `${entry.channelId}:${entry.messageId}`),
            count: repeats.length, sample: input.content.slice(0, 200)
        };
    }
    /** Drops idle buckets so long-running processes do not accumulate memory. */
    prune(now = Date.now()) {
        const horizon = 10 * 60000;
        for (const [key, entries] of this.joins)
            if (!entries.some(entry => now - entry.at <= horizon))
                this.joins.delete(key);
        for (const [key, entries] of this.messages)
            if (!entries.some(entry => now - entry.at <= horizon))
                this.messages.delete(key);
        for (const [key, at] of this.lastAlertAt)
            if (now - at > exports.ANTI_RAID_ALERT_COOLDOWN_MS)
                this.lastAlertAt.delete(key);
    }
}
exports.AntiRaidDetector = AntiRaidDetector;
function describeDetection(detection) {
    if (detection.kind === "join_flood") {
        return { userIds: detection.userIds, detail: `${detection.userIds.length} joins within ${detection.windowSeconds}s` };
    }
    if (detection.kind === "spam") {
        return { userIds: [detection.userId], detail: `${detection.count} repeated messages in ${detection.channelIds.map(id => `<#${id}>`).join(", ")}\n> ${detection.sample.replace(/\n/g, " ").slice(0, 150)}` };
    }
    return { userIds: [detection.userId], detail: `${detection.mentionCount} mentions in one message in <#${detection.channelId}>` };
}
/** Persists the last 200 incidents so staff alert buttons keep working across restarts. */
class AntiRaidIncidentStore {
    constructor(filePath, persist = true, onSave = () => undefined) {
        this.filePath = filePath;
        this.persist = persist;
        this.onSave = onSave;
        this.incidents = [];
        try {
            if (persist && fs_extra_1.default.existsSync(filePath)) {
                const raw = fs_extra_1.default.readJsonSync(filePath);
                if (Array.isArray(raw?.incidents)) {
                    this.incidents = raw.incidents.filter((entry) => Boolean(entry && typeof entry === "object"
                        && typeof entry.id === "string" && Array.isArray(entry.userIds)));
                }
            }
        }
        catch {
            this.incidents = [];
        }
    }
    create(detection, now = Date.now()) {
        const { userIds, detail } = describeDetection(detection);
        const incident = {
            id: `${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`,
            guildId: detection.guildId, kind: detection.kind, at: now, userIds: userIds.slice(0, 50), detail,
            alertChannelId: null, alertMessageId: null, timedOutUserIds: [], previousVerificationLevel: null, actions: []
        };
        this.incidents.push(incident);
        this.incidents = this.incidents.slice(-200);
        this.save();
        return incident;
    }
    get(id) {
        return this.incidents.find(incident => incident.id === id) || null;
    }
    forUser(guildId, userId) {
        return this.incidents.filter(incident => incident.guildId === guildId && incident.userIds.includes(userId));
    }
    recent(guildId, limit = 10) {
        return this.incidents.filter(incident => incident.guildId === guildId).slice(-limit).reverse();
    }
    update(id, mutate) {
        const incident = this.get(id);
        if (!incident)
            return null;
        mutate(incident);
        this.save();
        return incident;
    }
    save() {
        if (!this.persist)
            return;
        try {
            fs_extra_1.default.ensureDirSync(node_path_1.default.dirname(this.filePath));
            const temp = `${this.filePath}.${process.pid}.tmp`;
            fs_extra_1.default.writeJsonSync(temp, { incidents: this.incidents }, { spaces: 2 });
            fs_extra_1.default.moveSync(temp, this.filePath, { overwrite: true });
            this.onSave(true);
        }
        catch (error) {
            this.onSave(false, error);
        }
    }
}
exports.AntiRaidIncidentStore = AntiRaidIncidentStore;
