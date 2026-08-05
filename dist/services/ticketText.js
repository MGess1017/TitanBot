"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeTranscriptLine = sanitizeTranscriptLine;
exports.clampTranscriptLine = clampTranscriptLine;
const TRANSCRIPT_LINE_MAX_CHARS = 1800;
function sanitizeTranscriptLine(raw) {
    return raw.replace(/\r?\n/g, " ").trim();
}
function clampTranscriptLine(raw, maxChars = TRANSCRIPT_LINE_MAX_CHARS) {
    if (raw.length <= maxChars)
        return raw;
    return `${raw.slice(0, Math.max(0, maxChars - 1))}...`;
}
