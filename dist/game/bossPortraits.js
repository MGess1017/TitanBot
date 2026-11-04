"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBossPortraitUrl = getBossPortraitUrl;
exports.getBossPortraitFiles = getBossPortraitFiles;
const node_path_1 = __importDefault(require("node:path"));
const discord_js_1 = require("discord.js");
const BOSS_PORTRAITS = {
    "The Grave Warden": "grave-warden",
    "Sister Vell": "sister-vell",
    "Morrow Fang": "morrow-fang",
    DogMeat: "dogmeat",
    "Butcher Prime": "butcher-prime",
    Shardjaw: "shardjaw",
    "Hexline Rook": "hexline-rook",
    "Acid Wraith": "acid-wraith",
    "Queen Of Doom": "queen-of-doom",
    "Booger King Omega": "booger-king-omega",
    "Queen Sumphex": "queen-sumphex",
    "Warlord Nullhide": "warlord-nullhide",
    "Wizard Of Chaos": "wizard-of-chaos",
    "Dreadwake Morvane": "dreadwake-morvane",
    "Kraghoss the Ashen Standard": "kraghoss",
    "Thalrex Mourntide": "thalrex-mourntide",
    "Veyra the Blackglass Matriarch": "veyra",
    "Nullforge Archon": "nullforge-archon",
    "Cardinal Voss Bloodwake": "cardinal-voss",
    "Eclipse Praetor Nyx": "eclipse-praetor-nyx",
    "Asterion the Titanbreaker": "asterion"
};
function getBossPortraitFilename(bossName) {
    const name = bossName?.trim();
    if (!name)
        return null;
    const slug = BOSS_PORTRAITS[name];
    if (!slug)
        throw new Error(`Missing portrait mapping for raid boss: ${name}`);
    return `boss-${slug}.jpg`;
}
function getBossPortraitUrl(bossName) {
    const filename = getBossPortraitFilename(bossName);
    return filename ? `attachment://${filename}` : null;
}
function getBossPortraitFiles(bossName) {
    const filename = getBossPortraitFilename(bossName);
    if (!filename)
        return [];
    const assetName = filename.slice("boss-".length);
    return [new discord_js_1.AttachmentBuilder(node_path_1.default.resolve(__dirname, `../../assets/bosses/${assetName}`), { name: filename })];
}
