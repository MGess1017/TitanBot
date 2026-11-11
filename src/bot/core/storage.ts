// Atomic JSON writes and backup-aware JSON reads.
import crypto from "node:crypto";
import { METRICS_DATA_FILE } from "./config";
import { queueJsonWrite, readJsonSnapshot, writeJsonSnapshotSync } from "../../runtime/jsonPersistence";

export function writeJsonAtomic(filePath: string, data: unknown): void {
    const output = filePath === METRICS_DATA_FILE && data && typeof data === "object"
        ? { ...(data as Record<string, unknown>), checksum: crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex") }
        : data;
    queueJsonWrite(filePath, output);
}

// Ticket version checks require a durable write before acknowledging the mutation.
export function writeJsonAtomicSync(filePath: string, data: unknown): void {
    writeJsonSnapshotSync(filePath, data);
}

export function readJsonWithBackup<T>(filePath: string, parse: (raw: unknown) => T | null, seed: T): T {
    return readJsonSnapshot(filePath, parse, seed);
}
