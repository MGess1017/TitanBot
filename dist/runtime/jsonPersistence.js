"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueJsonWrite = queueJsonWrite;
exports.getJsonSaveHealth = getJsonSaveHealth;
exports.getJsonSaveFailures = getJsonSaveFailures;
exports.flushJsonWrites = flushJsonWrites;
exports.readJsonSnapshot = readJsonSnapshot;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const queues = new Map();
function getQueue(file) {
    let queue = queues.get(file);
    if (!queue) {
        queue = { health: { failures: 0, lastFailureAt: 0, lastSuccessAt: 0, lastError: "" } };
        queues.set(file, queue);
    }
    return queue;
}
function recordFailure(file, queue, error) {
    queue.health.failures += 1;
    queue.health.lastFailureAt = Date.now();
    queue.health.lastError = error instanceof Error ? error.message : String(error);
    console.error(`[persistence] Save failed for ${file}:`, error);
}
async function copyIfPresent(source, target) {
    try {
        await node_fs_1.default.promises.copyFile(source, target);
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
            throw error;
    }
}
async function writeSnapshot(file, snapshot) {
    await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        const handle = await node_fs_1.default.promises.open(temporary, "wx");
        try {
            await handle.writeFile(snapshot, "utf8");
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await copyIfPresent(`${file}.bak.1`, `${file}.bak.2`);
        await copyIfPresent(`${file}.bak`, `${file}.bak.1`);
        await copyIfPresent(file, `${file}.bak`);
        await node_fs_1.default.promises.rename(temporary, file);
    }
    finally {
        await node_fs_1.default.promises.rm(temporary, { force: true });
    }
}
function schedule(file, queue, delay) {
    if (queue.timer || queue.running)
        return;
    queue.timer = setTimeout(() => {
        queue.timer = undefined;
        startWriting(file, queue);
    }, delay);
    if (delay > 100)
        queue.timer.unref();
}
function startWriting(file, queue) {
    if (queue.running || queue.pending === undefined)
        return;
    if (queue.timer)
        clearTimeout(queue.timer);
    queue.timer = undefined;
    queue.running = (async () => {
        while (queue.pending !== undefined) {
            const snapshot = queue.pending;
            queue.pending = undefined;
            try {
                await writeSnapshot(file, snapshot);
                queue.health.lastSuccessAt = Date.now();
                queue.health.lastError = "";
            }
            catch (error) {
                // Retain the newest snapshot for retry, never overwrite a newer queued save.
                if (queue.pending === undefined)
                    queue.pending = snapshot;
                recordFailure(file, queue, error);
                break;
            }
        }
    })().finally(() => {
        queue.running = undefined;
        if (queue.pending !== undefined)
            schedule(file, queue, 5000);
    });
}
/** Snapshot immediately; coalesce bursts and serialize asynchronous writes per file. */
function queueJsonWrite(filePath, data) {
    const file = node_path_1.default.resolve(filePath);
    const queue = getQueue(file);
    try {
        const snapshot = JSON.stringify(data, null, 2);
        if (snapshot === undefined)
            throw new Error("Cannot persist an undefined JSON value");
        queue.pending = snapshot;
        schedule(file, queue, 100);
    }
    catch (error) {
        recordFailure(file, queue, error);
        throw error;
    }
}
function getJsonSaveHealth(filePath) {
    return getQueue(node_path_1.default.resolve(filePath)).health;
}
function getJsonSaveFailures() {
    return [...queues].filter(([, queue]) => queue.health.lastError)
        .map(([file, queue]) => ({ file, error: queue.health.lastError }));
}
/** Await durable completion; reject rather than report success when a store is still failing. */
async function flushJsonWrites() {
    await Promise.all([...queues].map(async ([file, queue]) => {
        if (queue.running)
            await queue.running;
        if (queue.pending !== undefined) {
            startWriting(file, queue);
            await queue.running;
        }
    }));
    const failures = getJsonSaveFailures();
    if (failures.length) {
        throw new Error(`Persistence flush failed: ${failures.map(row => `${row.file}: ${row.error}`).join("; ")}`);
    }
}
/** Startup-only reads. Never replace unreadable existing data with an empty store. */
function readJsonSnapshot(file, parse, seed) {
    const candidates = [file, `${file}.bak`, `${file}.bak.1`, `${file}.bak.2`];
    const damaged = [];
    let found = false;
    for (const candidate of candidates) {
        if (!node_fs_1.default.existsSync(candidate))
            continue;
        found = true;
        let parsed;
        try {
            parsed = parse(JSON.parse(node_fs_1.default.readFileSync(candidate, "utf8")));
            if (parsed === null)
                throw new Error("Invalid store structure");
        }
        catch (error) {
            console.error(`[persistence] Cannot read ${candidate}:`, error);
            damaged.push(candidate);
            continue;
        }
        if (candidate !== file) {
            for (const invalid of damaged)
                node_fs_1.default.copyFileSync(invalid, `${invalid}.corrupt.${(0, node_crypto_1.randomUUID)()}`);
            const temporary = `${file}.${(0, node_crypto_1.randomUUID)()}.recovery.tmp`;
            try {
                const handle = node_fs_1.default.openSync(temporary, "wx");
                try {
                    node_fs_1.default.writeFileSync(handle, JSON.stringify(parsed, null, 2), "utf8");
                    node_fs_1.default.fsyncSync(handle);
                }
                finally {
                    node_fs_1.default.closeSync(handle);
                }
                node_fs_1.default.renameSync(temporary, file);
            }
            finally {
                node_fs_1.default.rmSync(temporary, { force: true });
            }
            console.warn(`[persistence] Recovered ${file} from ${candidate}; damaged files preserved as .corrupt copies.`);
        }
        return parsed;
    }
    if (found)
        throw new Error(`No readable snapshot for ${file}; refusing to reset existing data`);
    return seed;
}
