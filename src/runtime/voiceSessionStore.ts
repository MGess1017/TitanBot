import { queueJsonWrite, readJsonSnapshot } from "./jsonPersistence";

export type SavedVoiceSession = {
    guildId: string;
    userId: string;
    connected: boolean;
    elapsedMs: number;
    remainderMs: number;
    doubleXpNotified: boolean;
};
type VoiceSessionSnapshot = { version: 1; sessions: SavedVoiceSession[] };

function parseSnapshot(raw: unknown): VoiceSessionSnapshot | null {
    if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1
        || !("sessions" in raw) || !Array.isArray(raw.sessions)) return null;
    const sessions: SavedVoiceSession[] = [];
    for (const value of raw.sessions) {
        if (!value || typeof value !== "object") return null;
        const row = value as Partial<SavedVoiceSession>;
        if (typeof row.guildId !== "string" || typeof row.userId !== "string"
            || typeof row.connected !== "boolean" || typeof row.doubleXpNotified !== "boolean"
            || typeof row.elapsedMs !== "number" || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0
            || typeof row.remainderMs !== "number" || !Number.isFinite(row.remainderMs)
            || row.remainderMs < 0 || row.remainderMs >= 60_000) return null;
        sessions.push({
            guildId: row.guildId, userId: row.userId, connected: row.connected,
            elapsedMs: row.elapsedMs, remainderMs: row.remainderMs, doubleXpNotified: row.doubleXpNotified
        });
    }
    return { version: 1, sessions };
}

export function readVoiceSessions(file: string): SavedVoiceSession[] {
    return readJsonSnapshot<VoiceSessionSnapshot>(file, parseSnapshot, { version: 1, sessions: [] }).sessions;
}

export function saveVoiceSessions(file: string, sessions: SavedVoiceSession[]): void {
    queueJsonWrite(file, { version: 1, sessions } satisfies VoiceSessionSnapshot);
}

export function restoreVoiceSession(saved: SavedVoiceSession, connectedNow: boolean, now: number): {
    connected: boolean; connectedAt: number; lastAccruedAt: number; remainderMs: number; doubleXpNotified: boolean;
} {
    const continuous = saved.connected && connectedNow;
    return {
        connected: connectedNow,
        connectedAt: continuous ? now - saved.elapsedMs : now,
        lastAccruedAt: now,
        remainderMs: saved.remainderMs,
        doubleXpNotified: continuous && saved.doubleXpNotified
    };
}
