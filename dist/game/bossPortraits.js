"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBossPortraitUrl = getBossPortraitUrl;
function normalizeBossName(raw) {
    return String(raw || "").trim();
}
const BOSS_VISUAL_PROFILES = {
    "The Grave Warden": "skeletal crypt marshal in black iron plate, pale corpse fire in the eye sockets, cemetery chains and cracked tombstone armor",
    "Sister Vell": "tall bone oracle demoness with antlered skull crown, torn funeral veil, bone runes, and cold blue witchfire",
    "Morrow Fang": "massive horned pit reaper with obsidian fangs, scarred charcoal hide, hooked cleaver, and red furnace eyes",
    "Butcher Prime": "towering butcher demon in blood-stained industrial armor, iron mask, chained cleaver, and furnace smoke",
    Shardjaw: "crystalline jawed war beast with steel-plated hide, jagged quartz teeth, and electric blue fissures",
    "Hexline Rook": "chess-themed execution demon in angular black armor, glowing hex sigils, crown-like helm, and surgical blade",
    "Booger King Omega": "enormous grotesque swamp demon king with mossy armor, asymmetrical horns, toxic green vapor, and royal ruin ornaments",
    "Queen Sumphex": "ancient toxic swamp queen demon with crown of hooked limbs, lacquered chitin armor, emerald venom glow, and ceremonial staff",
    "Warlord Nullhide": "void-armored demon warlord with featureless obsidian hide, purple-black cannon, torn banners, and a collapsing halo",
    "Dreadwake Morvane": "drowned leviathan demon admiral with barnacle armor, kelp mantle, naval iron mask, and seawater pouring from its mouth",
    "Kraghoss the Ashen Standard": "colossal ash demon khan in scorched siege armor, ember horns, war standard, molten eyes, and battlefield smoke",
    "Thalrex Mourntide": "ancient drowned god demon with coral crown, deep-sea plate armor, enormous tentacle mantle, and abyssal blue eyes",
    "Acid Wraith": "translucent spectral demon wrapped in dripping acid mist, exposed rib-like armor, elongated claws, and neon chartreuse eyes",
    DogMeat: "feral three-headed hellhound demon fused with a scarred armored war beast, ember saliva, iron muzzle plates, and predatory eyes",
    "Queen Of Doom": "regal female demon queen in black cathedral armor, four swept horns, doom sigils, veil of ravens, and crimson crown fire",
    "Wizard Of Chaos": "towering reality-warping archdemon wizard with multiple horns, fractured porcelain face, floating spell shards, six burning eyes, and a storm of impossible colors"
};
function getBossPortraitUrl(bossName, bossTitle) {
    const name = normalizeBossName(bossName);
    if (!name)
        return null;
    const title = String(bossTitle || "").trim();
    const seed = `${name}|${title}`;
    const encodedSeed = encodeURIComponent(seed);
    const visualProfile = BOSS_VISUAL_PROFILES[name] || "terrifying horned demon warlord with distinctive armor and supernatural eyes";
    const prompt = encodeURIComponent([
        `photorealistic dark fantasy demon boss portrait of ${name}${title ? `, ${title}` : ""}`,
        visualProfile,
        "realistic anatomy, detailed skin, practical armor materials, cinematic creature concept photography",
        "ominous battlefield ruins, ash, smoke, faint firelight, cursed atmosphere",
        "dramatic rim lighting, high contrast, centered bust portrait, sharp facial detail",
        "no text, no logo, no watermark, no extra characters"
    ].join(", "));
    // Pollinations image endpoint creates deterministic portraits by seed while allowing dark style prompts.
    return `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&seed=${encodedSeed}&nologo=true`;
}
