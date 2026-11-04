import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type SaveHealth = {
    failures: number;
    lastFailureAt: number;
    lastSuccessAt: number;
    lastError: string;
};
type SaveQueue = {
    pending?: string;
    running?: Promise<void>;
    timer?: NodeJS.Timeout;
    health: SaveHealth;
};
const queues = new Map<string, SaveQueue>();

function getQueue(file: string): SaveQueue {
    let queue = queues.get(file);
    if (!queue) {
        queue = { health: { failures: 0, lastFailureAt: 0, lastSuccessAt: 0, lastError: "" } };
        queues.set(file, queue);
    }
    return queue;
}

function recordFailure(file: string, queue: SaveQueue, error: unknown): void {
    queue.health.failures += 1;
    queue.health.lastFailureAt = Date.now();
    queue.health.lastError = error instanceof Error ? error.message : String(error);
    console.error(`[persistence] Save failed for ${file}:`, error);
}

async function copyIfPresent(source: string, target: string): Promise<void> {
    try {
        await fs.promises.copyFile(source, target);
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
}

async function writeSnapshot(file: string, snapshot: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        const handle = await fs.promises.open(temporary, "wx");
        try {
            await handle.writeFile(snapshot, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await copyIfPresent(`${file}.bak.1`, `${file}.bak.2`);
        await copyIfPresent(`${file}.bak`, `${file}.bak.1`);
        await copyIfPresent(file, `${file}.bak`);
        await fs.promises.rename(temporary, file);
    } finally {
        await fs.promises.rm(temporary, { force: true });
    }
}

function schedule(file: string, queue: SaveQueue, delay: number): void {
    if (queue.timer || queue.running) return;
    queue.timer = setTimeout(() => {
        queue.timer = undefined;
        startWriting(file, queue);
    }, delay);
    if (delay > 100) queue.timer.unref();
}

function startWriting(file: string, queue: SaveQueue): void {
    if (queue.running || queue.pending === undefined) return;
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = undefined;
    queue.running = (async () => {
        while (queue.pending !== undefined) {
            const snapshot = queue.pending;
            queue.pending = undefined;
            try {
                await writeSnapshot(file, snapshot);
                queue.health.lastSuccessAt = Date.now();
                queue.health.lastError = "";
            } catch (error) {
                // Retain the newest snapshot for retry, never overwrite a newer queued save.
                if (queue.pending === undefined) queue.pending = snapshot;
                recordFailure(file, queue, error);
                break;
            }
        }
    })().finally(() => {
        queue.running = undefined;
        if (queue.pending !== undefined) schedule(file, queue, 5_000);
    });
}

/** Snapshot immediately; coalesce bursts and serialize asynchronous writes per file. */
export function queueJsonWrite(filePath: string, data: unknown): void {
    const file = path.resolve(filePath);
    const queue = getQueue(file);
    try {
        const snapshot = JSON.stringify(data, null, 2);
        if (snapshot === undefined) throw new Error("Cannot persist an undefined JSON value");
        queue.pending = snapshot;
        schedule(file, queue, 100);
    } catch (error) {
        recordFailure(file, queue, error);
        throw error;
    }
}

export function getJsonSaveHealth(filePath: string): Readonly<SaveHealth> {
    return getQueue(path.resolve(filePath)).health;
}

export function getJsonSaveFailures(): Array<{ file: string; error: string }> {
    return [...queues].filter(([, queue]) => queue.health.lastError)
        .map(([file, queue]) => ({ file, error: queue.health.lastError }));
}

/** Await durable completion; reject rather than report success when a store is still failing. */
export async function flushJsonWrites(): Promise<void> {
    await Promise.all([...queues].map(async ([file, queue]) => {
        if (queue.running) await queue.running;
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
export function readJsonSnapshot<T>(file: string, parse: (raw: unknown) => T | null, seed: T): T {
    const candidates = [file, `${file}.bak`, `${file}.bak.1`, `${file}.bak.2`];
    const damaged: string[] = [];
    let found = false;
    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        found = true;
        let parsed: T | null;
        try {
            parsed = parse(JSON.parse(fs.readFileSync(candidate, "utf8")));
            if (parsed === null) throw new Error("Invalid store structure");
        } catch (error) {
            console.error(`[persistence] Cannot read ${candidate}:`, error);
            damaged.push(candidate);
            continue;
        }
        if (candidate !== file) {
            for (const invalid of damaged) fs.copyFileSync(invalid, `${invalid}.corrupt.${randomUUID()}`);
            const temporary = `${file}.${randomUUID()}.recovery.tmp`;
            try {
                const handle = fs.openSync(temporary, "wx");
                try {
                    fs.writeFileSync(handle, JSON.stringify(parsed, null, 2), "utf8");
                    fs.fsyncSync(handle);
                } finally {
                    fs.closeSync(handle);
                }
                fs.renameSync(temporary, file);
            } finally {
                fs.rmSync(temporary, { force: true });
            }
            console.warn(`[persistence] Recovered ${file} from ${candidate}; damaged files preserved as .corrupt copies.`);
        }
        return parsed;
    }
    if (found) throw new Error(`No readable snapshot for ${file}; refusing to reset existing data`);
    return seed;
}
