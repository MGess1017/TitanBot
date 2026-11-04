"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readVoiceSessions = readVoiceSessions;
exports.saveVoiceSessions = saveVoiceSessions;
exports.restoreVoiceSession = restoreVoiceSession;
const jsonPersistence_1 = require("./jsonPersistence");
function parseSnapshot(raw) {
    if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1
        || !("sessions" in raw) || !Array.isArray(raw.sessions))
        return null;
    const sessions = [];
    for (const value of raw.sessions) {
        if (!value || typeof value !== "object")
            return null;
        const row = value;
        if (typeof row.guildId !== "string" || typeof row.userId !== "string"
            || typeof row.connected !== "boolean" || typeof row.doubleXpNotified !== "boolean"
            || typeof row.elapsedMs !== "number" || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0
            || typeof row.remainderMs !== "number" || !Number.isFinite(row.remainderMs)
            || row.remainderMs < 0 || row.remainderMs >= 60000)
            return null;
        sessions.push({
            guildId: row.guildId, userId: row.userId, connected: row.connected,
            elapsedMs: row.elapsedMs, remainderMs: row.remainderMs, doubleXpNotified: row.doubleXpNotified
        });
    }
    return { version: 1, sessions };
}
function readVoiceSessions(file) {
    return (0, jsonPersistence_1.readJsonSnapshot)(file, parseSnapshot, { version: 1, sessions: [] }).sessions;
}
function saveVoiceSessions(file, sessions) {
    (0, jsonPersistence_1.queueJsonWrite)(file, { version: 1, sessions });
}
function restoreVoiceSession(saved, connectedNow, now) {
    const continuous = saved.connected && connectedNow;
    return {
        connected: connectedNow,
        connectedAt: continuous ? now - saved.elapsedMs : now,
        lastAccruedAt: now,
        remainderMs: saved.remainderMs,
        doubleXpNotified: continuous && saved.doubleXpNotified
    };
}
