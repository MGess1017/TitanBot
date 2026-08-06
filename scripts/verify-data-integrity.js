/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const stores = [
  {
    rel: "src/data/points.json",
    validate: (json) => Boolean(json && typeof json === "object" && json.users && typeof json.users === "object")
  },
  {
    rel: "src/data/trades.json",
    validate: (json) => Boolean(json && typeof json.nextId === "number" && Array.isArray(json.offers))
  },
  {
    rel: "src/data/giveaways.json",
    validate: (json) => Boolean(json && typeof json.nextId === "number" && Array.isArray(json.giveaways))
  },
  {
    rel: "src/data/tickets.json",
    validate: (json) => Boolean(json && typeof json.nextId === "number" && json.guildConfigs && typeof json.guildConfigs === "object" && Array.isArray(json.tickets))
  },
  {
    rel: "src/data/moderation.json",
    validate: (json) => Boolean(json && json.guilds && typeof json.guilds === "object")
  },
  {
    rel: "src/data/runtime-metrics.json",
    validate: (json) => Boolean(json && json.command && json.tickets && json.availability)
  },
  {
    rel: "src/data/balance-telemetry.json",
    validate: (json) => Boolean(json && json.raid && json.commands)
  }
];

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function run() {
  const failures = [];

  for (const store of stores) {
    const abs = path.join(ROOT, store.rel);
    const bak = `${abs}.bak`;

    if (!fs.existsSync(abs)) {
      failures.push(`Missing data store: ${store.rel}`);
      continue;
    }

    const parsed = readJsonSafe(abs);
    if (!parsed || !store.validate(parsed)) {
      failures.push(`Invalid schema: ${store.rel}`);
    }

    if (!fs.existsSync(bak)) {
      failures.push(`Missing backup: ${store.rel}.bak`);
      continue;
    }

    const parsedBak = readJsonSafe(bak);
    if (!parsedBak || !store.validate(parsedBak)) {
      failures.push(`Invalid backup schema: ${store.rel}.bak`);
    }
  }

  if (failures.length > 0) {
    console.error("Data integrity verification failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Data integrity verification passed.");
  console.log(`- Stores checked: ${stores.length}`);
}

run();
