"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeJsonAtomic = writeJsonAtomic;
exports.writeJsonAtomicSync = writeJsonAtomicSync;
exports.readJsonWithBackup = readJsonWithBackup;
// Atomic JSON writes and backup-aware JSON reads.
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const jsonPersistence_1 = require("../../runtime/jsonPersistence");
function writeJsonAtomic(filePath, data) {
    const output = filePath === config_1.METRICS_DATA_FILE && data && typeof data === "object"
        ? { ...data, checksum: node_crypto_1.default.createHash("sha256").update(JSON.stringify(data)).digest("hex") }
        : data;
    (0, jsonPersistence_1.queueJsonWrite)(filePath, output);
}
// Ticket version checks require a durable write before acknowledging the mutation.
function writeJsonAtomicSync(filePath, data) {
    const backupPath = `${filePath}.bak`;
    const backupV1Path = `${filePath}.bak.1`;
    const backupV2Path = `${filePath}.bak.2`;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs_extra_1.default.ensureDirSync(path_1.default.dirname(filePath));
    try {
        const handle = fs_extra_1.default.openSync(tempPath, "wx");
        try {
            fs_extra_1.default.writeFileSync(handle, JSON.stringify(data, null, 2), "utf8");
            fs_extra_1.default.fsyncSync(handle);
        }
        finally {
            fs_extra_1.default.closeSync(handle);
        }
        if (fs_extra_1.default.existsSync(backupV1Path))
            fs_extra_1.default.copyFileSync(backupV1Path, backupV2Path);
        if (fs_extra_1.default.existsSync(backupPath))
            fs_extra_1.default.copyFileSync(backupPath, backupV1Path);
        if (fs_extra_1.default.existsSync(filePath))
            fs_extra_1.default.copyFileSync(filePath, backupPath);
        fs_extra_1.default.renameSync(tempPath, filePath);
    }
    catch (error) {
        console.error(`[persistence] Synchronous save failed for ${filePath}:`, error);
        throw error;
    }
    finally {
        if (fs_extra_1.default.existsSync(tempPath)) {
            fs_extra_1.default.removeSync(tempPath);
        }
    }
}
function readJsonWithBackup(filePath, parse, seed) {
    return (0, jsonPersistence_1.readJsonSnapshot)(filePath, parse, seed);
}
