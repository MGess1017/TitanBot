"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatUptime = formatUptime;
exports.formatMemoryUsage = formatMemoryUsage;
exports.buildStartupSummary = buildStartupSummary;
exports.buildStatusLines = buildStatusLines;
function formatUptime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${hours}h ${minutes}m ${seconds}s`;
}
function formatMemoryUsage(memory) {
    const formatMb = (value) => `${Math.round(value / 1024 / 1024)}MB`;
    return `RSS ${formatMb(memory.rss)} | Heap ${formatMb(memory.heapUsed)} / ${formatMb(memory.heapTotal)}`;
}
function buildStartupSummary(guildCount, uptimeSeconds, memory) {
    return JSON.stringify({
        guilds: guildCount,
        uptimeSeconds,
        memoryMb: Math.round(memory.rss / 1024 / 1024)
    });
}
function buildStatusLines(userTag, guildCount, latency, memory, uptimeSeconds) {
    return [
        `Logged in as ${userTag ?? "unknown-user"}`,
        `Uptime: ${formatUptime(uptimeSeconds)}`,
        `Guilds: ${guildCount}`,
        `Latency: ${latency}ms`,
        `Memory: ${formatMemoryUsage(memory)}`
    ];
}
