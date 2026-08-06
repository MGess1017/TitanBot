function normalizeBossName(raw: string | null | undefined): string {
    return String(raw || "").trim();
}

export function getBossPortraitUrl(bossName: string | null | undefined, bossTitle?: string | null): string | null {
    const name = normalizeBossName(bossName);
    if (!name) return null;

    const seed = `${name}|${String(bossTitle || "")}`;
    const encodedSeed = encodeURIComponent(seed);

    // Robohash set2 yields creature/beast-style generated portraits.
    return `https://robohash.org/${encodedSeed}.png?size=512x512&set=set2&bgset=bg1`;
}
