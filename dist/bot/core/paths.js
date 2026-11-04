"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOT_SRC_DIR = void 0;
// Shared filesystem roots for the split bot modules.
const path_1 = __importDefault(require("path"));
/** The compiled source root (src/ under ts-node, dist/ in production): where bot.ts lives. */
exports.BOT_SRC_DIR = path_1.default.resolve(__dirname, "..", "..");
