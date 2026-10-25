import assert from "node:assert/strict";
import { adjustPlayerCounts, buildPlayerCountEmbed, countPlayers } from "./playerCounts";

let counts = countPlayers([false, false, true]);
assert.deepEqual(counts, { players: 2, members: 3 });
counts = adjustPlayerCounts(counts, false, 1);
assert.deepEqual(counts, { players: 3, members: 4 });
counts = adjustPlayerCounts(counts, true, 1);
assert.deepEqual(counts, { players: 3, members: 5 });
counts = adjustPlayerCounts(counts, false, -1);
assert.deepEqual(counts, { players: 2, members: 4 });
assert.equal(counts.players + (counts.members - counts.players), counts.members);

const embed = buildPlayerCountEmbed(counts).toJSON();
assert.equal(embed.title, "FNT • Live Player Count");
assert.equal(embed.fields?.find(field => field.name === "Players")?.value, "2");
assert.equal(embed.fields?.find(field => field.name === "Bots")?.value, "2");
console.log("member tracking tests passed");