// Loads .env (overriding inherited values) and parses boolean env flags. Imported before any config is read.
import * as dotenv from "dotenv";
import path from "path";
import { BOT_SRC_DIR } from "./paths";

// Always resolve env vars from this bot project root, even when npm --prefix is used from another cwd.
dotenv.config({ path: path.resolve(BOT_SRC_DIR, "../.env"), override: true });

export function readEnvFlag(name: string, fallback = false): boolean {
    const raw = (process.env[name] || "").trim().toLowerCase();
    if (!raw) return fallback;
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
