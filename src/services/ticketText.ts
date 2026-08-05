const TRANSCRIPT_LINE_MAX_CHARS = 1800;

export function sanitizeTranscriptLine(raw: string): string {
    return raw.replace(/\r?\n/g, " ").trim();
}

export function clampTranscriptLine(raw: string, maxChars = TRANSCRIPT_LINE_MAX_CHARS): string {
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, Math.max(0, maxChars - 1))}...`;
}
