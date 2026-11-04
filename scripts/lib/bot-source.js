"use strict";
// Reads the bot's TypeScript source as one text blob: src/bot.ts plus every module under src/bot/.
// Source-level tests and verifiers use this so they keep working no matter which module a function lives in.
// Top-level `export` keywords are stripped so extracted declarations can be evaluated standalone.
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.resolve(__dirname, "../../src");

function listBotSourceFiles() {
    const files = [path.join(SRC_DIR, "bot.ts")];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
        }
    };
    walk(path.join(SRC_DIR, "bot"));
    return files;
}

function readBotSource() {
    return listBotSourceFiles()
        .map(file => fs.readFileSync(file, "utf8").replace(/^export (?=(?:async\s+)?(?:function|const|let|var|type|interface|class|enum)\b)/gm, ""))
        .join("\n");
}

module.exports = { SRC_DIR, listBotSourceFiles, readBotSource };
