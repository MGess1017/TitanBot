import assert from "node:assert/strict";
import { buildStartupSummary, buildStatusLines, formatUptime } from "./health";

function runHealthTests(): void {
    assert.equal(formatUptime(3661), "1h 1m 1s");
    assert.equal(buildStartupSummary(2, 10, { rss: 1024 * 1024, heapUsed: 512 * 1024, heapTotal: 1024 * 1024, external: 0, arrayBuffers: 0 } as NodeJS.MemoryUsage).includes('"guilds":2'), true);
    const statusLines = buildStatusLines("Bot", 2, 50, { rss: 1024 * 1024, heapUsed: 512 * 1024, heapTotal: 1024 * 1024, external: 0, arrayBuffers: 0 } as NodeJS.MemoryUsage, 90);
    assert.equal(statusLines[0], "Logged in as Bot");
    assert.equal(statusLines[1], "Uptime: 0h 1m 30s");
}

runHealthTests();
console.log("health helper tests passed");
