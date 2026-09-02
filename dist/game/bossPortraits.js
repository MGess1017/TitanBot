"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBossPortraitUrl = getBossPortraitUrl;
function normalizeBossName(raw) {
    return String(raw || "").trim();
}
function getBossPortraitUrl(bossName, bossTitle) {
    const name = normalizeBossName(bossName);
    if (!name)
        return null;
    const title = String(bossTitle || "").trim();
    const seed = `${name}|${title}`;
    const encodedSeed = encodeURIComponent(seed);
    const prompt = encodeURIComponent([
        `dark fantasy boss portrait of ${name}${title ? `, ${title}` : ""}`,
        "malevolent ghoul beast cryptwalker warlord of death",
        "ominous, terrifying, full of evil presence",
        "shadowy ruins, ash, fog, cursed atmosphere",
        "high contrast, dramatic cinematic lighting",
        "detailed digital art, no text, centered portrait"
    ].join(", "));
    // Pollinations image endpoint creates deterministic portraits by seed while allowing dark style prompts.
    return `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&seed=${encodedSeed}&nologo=true`;
}
