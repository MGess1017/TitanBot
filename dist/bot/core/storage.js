"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeJsonAtomic = writeJsonAtomic;
exports.writeJsonAtomicSync = writeJsonAtomicSync;
exports.readJsonWithBackup = readJsonWithBackup;
// Atomic JSON writes and backup-aware JSON reads.
const node_crypto_1 = __importDefault(require("node:crypto"));
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
    (0, jsonPersistence_1.writeJsonSnapshotSync)(filePath, data);
}
function readJsonWithBackup(filePath, parse, seed) {
    return (0, jsonPersistence_1.readJsonSnapshot)(filePath, parse, seed);
}
