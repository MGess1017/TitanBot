// Shared filesystem roots for the split bot modules.
import path from "path";

/** The compiled source root (src/ under ts-node, dist/ in production): where bot.ts lives. */
export const BOT_SRC_DIR = path.resolve(__dirname, "..", "..");
