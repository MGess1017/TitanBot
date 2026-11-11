export type HubPreferences = {
    shortcut: "xp" | "pmc" | "profile" | "rs3";
    background: "automatic" | "checkpoint" | "radio";
    accent: "tactical" | "theme";
    highlights: "all" | "primary" | "none";
    cardVisibility: "public" | "private";
    rs3Name: string | null;
};

export function normalizeHubPreferences(raw: unknown): HubPreferences {
    const value = raw && typeof raw === "object" ? raw as Partial<HubPreferences> : {};
    return {
        shortcut: value.shortcut === "pmc" || value.shortcut === "profile" || value.shortcut === "rs3" ? value.shortcut : "xp",
        background: value.background === "checkpoint" || value.background === "radio" ? value.background : "automatic",
        accent: value.accent === "theme" ? "theme" : "tactical",
        highlights: value.highlights === "primary" || value.highlights === "none" ? value.highlights : "all",
        cardVisibility: value.cardVisibility === "private" ? "private" : "public",
        rs3Name: typeof value.rs3Name === "string" && /^[a-zA-Z0-9 _-]{1,12}$/.test(value.rs3Name.trim())
            ? value.rs3Name.trim() : null
    };
}
