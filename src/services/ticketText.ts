const TRANSCRIPT_LINE_MAX_CHARS = 1800;

export function sanitizeTranscriptLine(raw: string): string {
    return raw
        .replace(/\r?\n/g, " ")
        .replace(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, "[email redacted]")
        .replace(/(token|password|passwd|secret|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1: [redacted]")
        .replace(/\b\d{12,19}\b/g, "[number redacted]")
        .trim();
}

export function clampTranscriptLine(raw: string, maxChars = TRANSCRIPT_LINE_MAX_CHARS): string {
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, Math.max(0, maxChars - 1))}...`;
}
