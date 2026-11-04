// Atomic JSON writes and backup-aware JSON reads.
import fs from "fs-extra";
import crypto from "node:crypto";
import path from "path";
import { METRICS_DATA_FILE } from "./config";
import { queueJsonWrite, readJsonSnapshot } from "../../runtime/jsonPersistence";

export function writeJsonAtomic(filePath: string, data: unknown): void {
    const output = filePath === METRICS_DATA_FILE && data && typeof data === "object"
        ? { ...(data as Record<string, unknown>), checksum: crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex") }
        : data;
    queueJsonWrite(filePath, output);
}

// Ticket version checks require a durable write before acknowledging the mutation.
export function writeJsonAtomicSync(filePath: string, data: unknown): void {
    const backupPath = `${filePath}.bak`;
    const backupV1Path = `${filePath}.bak.1`;
    const backupV2Path = `${filePath}.bak.2`;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.ensureDirSync(path.dirname(filePath));

    try {
        const handle = fs.openSync(tempPath, "wx");
        try {
            fs.writeFileSync(handle, JSON.stringify(data, null, 2), "utf8");
            fs.fsyncSync(handle);
        } finally {
            fs.closeSync(handle);
        }
        if (fs.existsSync(backupV1Path)) fs.copyFileSync(backupV1Path, backupV2Path);
        if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, backupV1Path);
        if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath);
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        console.error(`[persistence] Synchronous save failed for ${filePath}:`, error);
        throw error;
    } finally {
        if (fs.existsSync(tempPath)) {
            fs.removeSync(tempPath);
        }
    }
}

export function readJsonWithBackup<T>(filePath: string, parse: (raw: unknown) => T | null, seed: T): T {
    return readJsonSnapshot(filePath, parse, seed);
}
