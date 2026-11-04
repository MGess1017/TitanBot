import path from "node:path";
import { AttachmentBuilder } from "discord.js";

const BOSS_PORTRAITS: Record<string, string> = {
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

function getBossPortraitFilename(bossName: string | null | undefined): string | null {
    const name = bossName?.trim();
    if (!name) return null;
    const slug = BOSS_PORTRAITS[name];
    if (!slug) throw new Error(`Missing portrait mapping for raid boss: ${name}`);
    return `boss-${slug}.jpg`;
}

export function getBossPortraitUrl(bossName: string | null | undefined): string | null {
    const filename = getBossPortraitFilename(bossName);
    return filename ? `attachment://${filename}` : null;
}

export function getBossPortraitFiles(bossName: string | null | undefined): AttachmentBuilder[] {
    const filename = getBossPortraitFilename(bossName);
    if (!filename) return [];
    const assetName = filename.slice("boss-".length);
    return [new AttachmentBuilder(path.resolve(__dirname, `../../assets/bosses/${assetName}`), { name: filename })];
}
