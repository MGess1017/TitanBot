import fs from "fs-extra";
import path from "node:path";

/**
 * Message-abuse detection only. New members are always welcome: joins are never tracked,
 * and nothing here kicks, bans, or blocks accounts from joining.
 */
export type AntiRaidThresholds = {
    spamRepeatThreshold: number;
    spamWindowSeconds: number;
    mentionThreshold: number;
};

export type AntiRaidDetection =
    | { kind: "spam"; guildId: string; userId: string; channelIds: string[]; messageIds: string[]; count: number; sample: string }
    | { kind: "mention_abuse"; guildId: string; userId: string; channelId: string; messageId: string; mentionCount: number };

export const ANTI_RAID_ALERT_COOLDOWN_MS = 5 * 60_000;

type MessageRecord = { at: number; fingerprint: string; channelId: string; messageId: string };

export function fingerprintMessage(content: string): string {
    return content.toLowerCase().replace(/<a?:\w+:\d+>/g, ":e:").replace(/https?:\/\/\S+/g, "url").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** In-memory sliding-window detector. Alerts are rate limited per subject so a single incident is reported once. */
export class AntiRaidDetector {
    private messages = new Map<string, MessageRecord[]>();
    private lastAlertAt = new Map<string, number>();

    constructor(private readonly getThresholds: () => AntiRaidThresholds) {}

    private shouldAlert(key: string, now: number): boolean {
        const last = this.lastAlertAt.get(key) || 0;
        if (now - last < ANTI_RAID_ALERT_COOLDOWN_MS) return false;
        this.lastAlertAt.set(key, now);
        return true;
    }

    recordMessage(input: {
        guildId: string; userId: string; channelId: string; messageId: string; content: string; mentionCount: number; now?: number;
    }): AntiRaidDetection | null {
        const now = input.now ?? Date.now();
        const t = this.getThresholds();
        if (input.mentionCount >= t.mentionThreshold && this.shouldAlert(`mention:${input.guildId}:${input.userId}`, now)) {
            return {
                kind: "mention_abuse", guildId: input.guildId, userId: input.userId,
                channelId: input.channelId, messageId: input.messageId, mentionCount: input.mentionCount
            };
        }
        const fingerprint = fingerprintMessage(input.content);
        if (!fingerprint) return null;
        const key = `${input.guildId}:${input.userId}`;
        const windowMs = t.spamWindowSeconds * 1000;
        const recent = (this.messages.get(key) || []).filter(entry => now - entry.at <= windowMs);
        recent.push({ at: now, fingerprint, channelId: input.channelId, messageId: input.messageId });
        this.messages.set(key, recent.slice(-50));
        const repeats = recent.filter(entry => entry.fingerprint === fingerprint);
        if (repeats.length < t.spamRepeatThreshold || !this.shouldAlert(`spam:${key}`, now)) return null;
        return {
            kind: "spam", guildId: input.guildId, userId: input.userId,
            channelIds: [...new Set(repeats.map(entry => entry.channelId))],
            messageIds: repeats.map(entry => `${entry.channelId}:${entry.messageId}`),
            count: repeats.length, sample: input.content.slice(0, 200)
        };
    }

    /** Drops idle buckets so long-running processes do not accumulate memory. */
    prune(now = Date.now()): void {
        const horizon = 10 * 60_000;
        for (const [key, entries] of this.messages) if (!entries.some(entry => now - entry.at <= horizon)) this.messages.delete(key);
        for (const [key, at] of this.lastAlertAt) if (now - at > ANTI_RAID_ALERT_COOLDOWN_MS) this.lastAlertAt.delete(key);
    }
}

export type AntiRaidActionType = "timeout" | "untimeout" | "dismiss";

export type AntiRaidIncident = {
    id: string;
    guildId: string;
    kind: AntiRaidDetection["kind"];
    at: number;
    userIds: string[];
    detail: string;
    alertChannelId: string | null;
    alertMessageId: string | null;
    timedOutUserIds: string[];
    actions: Array<{ type: AntiRaidActionType; byId: string; at: number; count?: number }>;
};

export function describeDetection(detection: AntiRaidDetection): { userIds: string[]; detail: string } {
    if (detection.kind === "spam") {
        return { userIds: [detection.userId], detail: `${detection.count} repeated messages in ${detection.channelIds.map(id => `<#${id}>`).join(", ")}\n> ${detection.sample.replace(/\n/g, " ").slice(0, 150)}` };
    }
    return { userIds: [detection.userId], detail: `${detection.mentionCount} mentions in one message in <#${detection.channelId}>` };
}

/** Persists the last 200 incidents so staff alert buttons keep working across restarts. */
export class AntiRaidIncidentStore {
    private incidents: AntiRaidIncident[] = [];

    constructor(private readonly filePath: string, private readonly persist = true, private readonly onSave: (ok: boolean, error?: unknown) => void = () => undefined) {
        try {
            if (persist && fs.existsSync(filePath)) {
                const raw = fs.readJsonSync(filePath) as { incidents?: unknown };
                if (Array.isArray(raw?.incidents)) {
                    this.incidents = raw.incidents.filter((entry): entry is AntiRaidIncident => Boolean(entry && typeof entry === "object"
                        && typeof (entry as AntiRaidIncident).id === "string" && Array.isArray((entry as AntiRaidIncident).userIds)
                        && ((entry as AntiRaidIncident).kind === "spam" || (entry as AntiRaidIncident).kind === "mention_abuse")))
                        .map(entry => ({
                            ...entry,
                            timedOutUserIds: Array.isArray(entry.timedOutUserIds) ? entry.timedOutUserIds : [],
                            actions: Array.isArray(entry.actions) ? entry.actions.filter(action => action.type === "timeout" || action.type === "untimeout" || action.type === "dismiss") : []
                        }));
                }
            }
        } catch {
            this.incidents = [];
        }
    }

    create(detection: AntiRaidDetection, now = Date.now()): AntiRaidIncident {
        const { userIds, detail } = describeDetection(detection);
        const incident: AntiRaidIncident = {
            id: `${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`,
            guildId: detection.guildId, kind: detection.kind, at: now, userIds: userIds.slice(0, 50), detail,
            alertChannelId: null, alertMessageId: null, timedOutUserIds: [], actions: []
        };
        this.incidents.push(incident);
        this.incidents = this.incidents.slice(-200);
        this.save();
        return incident;
    }

    get(id: string): AntiRaidIncident | null {
        return this.incidents.find(incident => incident.id === id) || null;
    }

    forUser(guildId: string, userId: string): AntiRaidIncident[] {
        return this.incidents.filter(incident => incident.guildId === guildId && incident.userIds.includes(userId));
    }

    recent(guildId: string, limit = 10): AntiRaidIncident[] {
        return this.incidents.filter(incident => incident.guildId === guildId).slice(-limit).reverse();
    }

    update(id: string, mutate: (incident: AntiRaidIncident) => void): AntiRaidIncident | null {
        const incident = this.get(id);
        if (!incident) return null;
        mutate(incident);
        this.save();
        return incident;
    }

    private save(): void {
        if (!this.persist) return;
        try {
            fs.ensureDirSync(path.dirname(this.filePath));
            const temp = `${this.filePath}.${process.pid}.tmp`;
            fs.writeJsonSync(temp, { incidents: this.incidents }, { spaces: 2 });
            fs.moveSync(temp, this.filePath, { overwrite: true });
            this.onSave(true);
        } catch (error) {
            this.onSave(false, error);
        }
    }
}
