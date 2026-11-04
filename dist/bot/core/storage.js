"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeJsonAtomic = writeJsonAtomic;
exports.readJsonWithBackup = readJsonWithBackup;
// Atomic JSON writes and backup-aware JSON reads.
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const audit_1 = require("./audit");
function writeJsonAtomic(filePath, data) {
    const backupPath = `${filePath}.bak`;
    const backupV1Path = `${filePath}.bak.1`;
    const backupV2Path = `${filePath}.bak.2`;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs_extra_1.default.ensureDirSync(path_1.default.dirname(filePath));
    try {
        if (fs_extra_1.default.existsSync(backupV1Path))
            fs_extra_1.default.copyFileSync(backupV1Path, backupV2Path);
        if (fs_extra_1.default.existsSync(backupPath))
            fs_extra_1.default.copyFileSync(backupPath, backupV1Path);
    }
    catch {
        // Best effort backup chain rotation only.
    }
    if (fs_extra_1.default.existsSync(filePath)) {
        try {
            fs_extra_1.default.copyFileSync(filePath, backupPath);
        }
        catch {
            // Best-effort backup pre-write.
        }
    }
    try {
        const checksum = node_crypto_1.default.createHash("sha256").update(JSON.stringify(data)).digest("hex");
        const output = filePath === config_1.METRICS_DATA_FILE && data && typeof data === "object"
            ? { ...data, checksum }
            : data;
        fs_extra_1.default.writeJsonSync(tempPath, output, { spaces: 2 });
        fs_extra_1.default.moveSync(tempPath, filePath, { overwrite: true });
        try {
            fs_extra_1.default.copyFileSync(filePath, backupPath);
        }
        catch {
            // Best-effort backup post-write.
        }
    }
    finally {
        if (fs_extra_1.default.existsSync(tempPath)) {
            fs_extra_1.default.removeSync(tempPath);
        }
    }
}
function readJsonWithBackup(filePath, parse, seed) {
    const backupPath = `${filePath}.bak`;
    if (!fs_extra_1.default.existsSync(filePath) && !fs_extra_1.default.existsSync(backupPath)) {
        writeJsonAtomic(filePath, seed);
        return seed;
    }
    const readParsed = (candidatePath) => {
        if (!fs_extra_1.default.existsSync(candidatePath))
            return null;
        try {
            const raw = fs_extra_1.default.readJsonSync(candidatePath);
            return parse(raw);
        }
        catch {
            return null;
        }
    };
    const primary = readParsed(filePath);
    if (primary)
        return primary;
    const backup = readParsed(backupPath);
    if (backup) {
        writeJsonAtomic(filePath, backup);
        (0, audit_1.appendAuditEvent)("data_store_recovered_from_backup", { filePath });
        return backup;
    }
    writeJsonAtomic(filePath, seed);
    (0, audit_1.appendAuditEvent)("data_store_reinitialized", { filePath });
    return seed;
}
