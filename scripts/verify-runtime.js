/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const dotenv = require("dotenv");

const ROOT = path.resolve(__dirname, "..");
const START_TIMEOUT_MS = 12000;
const ENV_PATH = path.join(ROOT, ".env");

const requiredMarkers = [
  "Logged in as",
  "Registered slash commands"
];

const healthyEarlyExitMarkers = [
  "Another bot instance appears active"
];

const requiredFiles = [
  "package.json",
  "tsconfig.json",
  "src/bot.ts",
  "src/utils.ts"
];

const strictRequiredEnv = [
  "DISCORD_TOKEN",
  "DISCORD_GUILD_ID",
  "TICKET_HANDLER_ROLE_ID",
  "TICKET_DEFAULT_CATEGORY_ID",
  "PERMANENT_TICKET_PANEL_CHANNEL_ID",
  "BOT_FEATURE_BRIEF_CHANNEL_ID"
];

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readJson(relPath) {
  const fullPath = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function hasConflictMarkers(text) {
  return text.includes("<<<<<<<") || text.includes(">>>>>>>") || text.includes("=======");
}

function pass(message) {
  console.log(`- PASS: ${message}`);
}

function fail(message) {
  console.error(`- FAIL: ${message}`);
}

function warn(message) {
  console.warn(`- WARN: ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForExit(proc, timeoutMs = 2500) {
  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    proc.once("exit", done);
    setTimeout(done, timeoutMs);
  });
}

async function killProcessTree(proc) {
  if (!proc || !proc.pid) return;

  proc.kill();
  await waitForExit(proc, 1500);

  if (process.platform === "win32") {
    await new Promise(resolve => {
      const killer = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
  }
}

async function run() {
  dotenv.config({ path: ENV_PATH });

  console.log("Runtime verification started (preflight mode).");

  const failures = [];
  const strictMode = process.argv.includes("--strict") || process.env.VERIFY_RUNTIME_STRICT === "1";

  for (const relPath of requiredFiles) {
    if (!exists(relPath)) failures.push(`Missing required file: ${relPath}`);
    else pass(`Required file present: ${relPath}`);
  }

  let pkg = null;
  try {
    pkg = readJson("package.json");
    pass("package.json parsed successfully");
  } catch (error) {
    failures.push(`Invalid package.json: ${error.message || String(error)}`);
  }

  if (pkg && pkg.scripts) {
    const requiredScripts = [
      "start",
      "build",
      "verify:integrity",
      "verify:contracts",
      "verify:slash-contracts",
      "verify:data",
      "verify:regression",
      "verify:runtime",
      "verify:all",
      "test:runtime"
    ];
    for (const scriptName of requiredScripts) {
      if (!pkg.scripts[scriptName]) failures.push(`Missing npm script: ${scriptName}`);
      else pass(`npm script present: ${scriptName}`);
    }
  }

  try {
    const botSource = fs.readFileSync(path.join(ROOT, "src/bot.ts"), "utf8");
    if (hasConflictMarkers(botSource)) failures.push("Merge conflict markers found in src/bot.ts");
    else pass("No conflict markers in src/bot.ts");
  } catch (error) {
    failures.push(`Unable to read src/bot.ts: ${error.message || String(error)}`);
  }

  const nodeMajor = Number.parseInt((process.versions.node || "0").split(".")[0], 10) || 0;
  if (nodeMajor < 18) failures.push(`Node.js ${process.versions.node} is too old; require >= 18`);
  else pass(`Node.js version OK: ${process.versions.node}`);

  const envSource = fs.existsSync(ENV_PATH) ? ".env" : "process environment";
  if (!process.env.DISCORD_TOKEN) {
    const tokenMessage = `DISCORD_TOKEN is not resolved from ${envSource}; bot startup will fail.`;
    if (strictMode) failures.push(tokenMessage);
    else warn(tokenMessage);
  } else {
    pass(`DISCORD_TOKEN resolved from ${envSource}`);
  }

  if (strictMode) {
    for (const envName of strictRequiredEnv) {
      if (!process.env[envName]) failures.push(`Missing required env var: ${envName}`);
      else pass(`Required env var present: ${envName}`);
    }
  }

  const shouldBootSmoke = process.argv.includes("--boot-smoke") || process.env.VERIFY_RUNTIME_BOOT === "1";
  if (!shouldBootSmoke) {
    if (failures.length > 0) {
      console.error("Runtime verification failed (preflight).");
      for (const item of failures) fail(item);
      process.exit(1);
      return;
    }

    console.log("Runtime verification passed (preflight).");
    return;
  }

  console.log("Boot smoke mode enabled.");

  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm run start"]
    : ["run", "start"];

  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: false
  });

  let output = "";
  let exited = false;
  let exitCode = null;
  child.stdout.on("data", d => {
    const text = d.toString();
    output += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", d => {
    const text = d.toString();
    output += text;
    process.stderr.write(text);
  });
  child.on("exit", code => {
    exited = true;
    exitCode = code;
  });

  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    const hasAllMarkers = requiredMarkers.every(marker => output.includes(marker));
    const hasHealthyEarlyExit = healthyEarlyExitMarkers.some(marker => output.includes(marker));
    if (hasAllMarkers || hasHealthyEarlyExit) break;
    if (exited) {
      const exitedHealthy = healthyEarlyExitMarkers.some(marker => output.includes(marker));
      if (!exitedHealthy) {
        console.error("Runtime verification failed: process exited before all startup markers appeared.");
        process.exit(1);
        return;
      }
      break;
    }
    await sleep(250);
  }

  const hasAllMarkers = requiredMarkers.every(marker => output.includes(marker));
  const hasHealthyEarlyExit = healthyEarlyExitMarkers.some(marker => output.includes(marker));
  if (!hasAllMarkers && !hasHealthyEarlyExit) {
    console.error("Runtime verification failed: startup timeout before all markers appeared.");
    for (const marker of requiredMarkers) {
      console.error(`- ${marker}: ${output.includes(marker) ? "OK" : "MISSING"}`);
    }
    await killProcessTree(child);
    process.exit(1);
    return;
  }

  console.log("Runtime verification passed.");
  if (hasHealthyEarlyExit) {
    console.log("- Healthy startup state confirmed via active-instance preflight guard.");
  } else {
    console.log(`- Startup markers: ${requiredMarkers.length}/${requiredMarkers.length}`);
  }

  await killProcessTree(child);

  if (exitCode !== null && exitCode !== 0 && exitCode !== 1) {
    console.error(`Runtime verifier cleanup noticed child exit code: ${exitCode}`);
  }
}

run().catch(error => {
  console.error("Runtime verification crashed.");
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
