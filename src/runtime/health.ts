export function formatUptime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${hours}h ${minutes}m ${seconds}s`;
}

export function formatMemoryUsage(memory: NodeJS.MemoryUsage): string {
    const formatMb = (value: number) => `${Math.round(value / 1024 / 1024)}MB`;
    return `RSS ${formatMb(memory.rss)} | Heap ${formatMb(memory.heapUsed)} / ${formatMb(memory.heapTotal)}`;
}

export function buildStartupSummary(guildCount: number, uptimeSeconds: number, memory: NodeJS.MemoryUsage): string {
    return JSON.stringify({
        guilds: guildCount,
        uptimeSeconds,
        memoryMb: Math.round(memory.rss / 1024 / 1024)
    });
}

export function buildStatusLines(userTag: string | undefined, guildCount: number, latency: number, memory: NodeJS.MemoryUsage, uptimeSeconds: number): string[] {
    return [
        `Logged in as ${userTag ?? "unknown-user"}`,
        `Uptime: ${formatUptime(uptimeSeconds)}`,
        `Guilds: ${guildCount}`,
        `Latency: ${latency}ms`,
        `Memory: ${formatMemoryUsage(memory)}`
    ];
}
