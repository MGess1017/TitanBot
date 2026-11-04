// Atomic JSON writes and backup-aware JSON reads.
import fs from "fs-extra";
import crypto from "node:crypto";
import path from "path";
import { METRICS_DATA_FILE } from "./config";
import { appendAuditEvent } from "./audit";

export function writeJsonAtomic(filePath: string, data: unknown): void {
    const backupPath = `${filePath}.bak`;
    const backupV1Path = `${filePath}.bak.1`;
    const backupV2Path = `${filePath}.bak.2`;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.ensureDirSync(path.dirname(filePath));

    try {
        if (fs.existsSync(backupV1Path)) fs.copyFileSync(backupV1Path, backupV2Path);
        if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, backupV1Path);
    } catch {
        // Best effort backup chain rotation only.
    }

    if (fs.existsSync(filePath)) {
        try {
            fs.copyFileSync(filePath, backupPath);
        } catch {
            // Best-effort backup pre-write.
        }
    }

    try {
        const checksum = crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
        const output = filePath === METRICS_DATA_FILE && data && typeof data === "object"
            ? { ...(data as Record<string, unknown>), checksum }
            : data;
        fs.writeJsonSync(tempPath, output, { spaces: 2 });
        fs.moveSync(tempPath, filePath, { overwrite: true });
        try {
            fs.copyFileSync(filePath, backupPath);
        } catch {
            // Best-effort backup post-write.
        }
    } finally {
        if (fs.existsSync(tempPath)) {
            fs.removeSync(tempPath);
        }
    }
}

export function readJsonWithBackup<T>(filePath: string, parse: (raw: unknown) => T | null, seed: T): T {
    const backupPath = `${filePath}.bak`;

    if (!fs.existsSync(filePath) && !fs.existsSync(backupPath)) {
        writeJsonAtomic(filePath, seed);
        return seed;
    }

    const readParsed = (candidatePath: string): T | null => {
        if (!fs.existsSync(candidatePath)) return null;
        try {
            const raw = fs.readJsonSync(candidatePath) as unknown;
            return parse(raw);
        } catch {
            return null;
        }
    };

    const primary = readParsed(filePath);
    if (primary) return primary;

    const backup = readParsed(backupPath);
    if (backup) {
        writeJsonAtomic(filePath, backup);
        appendAuditEvent("data_store_recovered_from_backup", { filePath });
        return backup;
    }

    writeJsonAtomic(filePath, seed);
    appendAuditEvent("data_store_reinitialized", { filePath });
    return seed;
}
