/** Cosmetic-only catalog: nothing here may affect XP, raids, casino odds, or other competitive systems. */
export type CosmeticKind = "theme" | "title" | "badge";

export type CosmeticItem = {
    id: string;
    kind: CosmeticKind;
    name: string;
    price: number;
    description: string;
    color?: number;
    emoji?: string;
    text?: string;
};

export const DEFAULT_THEME_ID = "theme_fnt_purple";
export const MAX_SHOWCASE_BADGES = 3;

export const COSMETICS: CosmeticItem[] = [
    { id: DEFAULT_THEME_ID, kind: "theme", name: "FNT Signature Purple", price: 0, color: 0x9b59b6, description: "The classic FNT purple. Free for every operator." },
    { id: "theme_fnt_midnight", kind: "theme", name: "FNT Midnight", price: 400, color: 0x2b1d52, description: "Deep night-ops violet." },
    { id: "theme_fnt_neon", kind: "theme", name: "FNT Neon Rift", price: 650, color: 0xc026d3, description: "Electric magenta FNT glow." },
    { id: "theme_fnt_arctic", kind: "theme", name: "FNT Arctic Ops", price: 650, color: 0x38bdf8, description: "Cold blue FNT frost." },
    { id: "theme_fnt_toxic", kind: "theme", name: "FNT Toxic Zone", price: 800, color: 0x22c55e, description: "Radiation-green FNT hazard." },
    { id: "theme_fnt_crimson", kind: "theme", name: "FNT Crimson Protocol", price: 900, color: 0xdc2626, description: "Blood-red FNT alert." },
    { id: "theme_fnt_gold", kind: "theme", name: "FNT Gold Reserve", price: 2500, color: 0xf5b82e, description: "Prestige gold FNT finish." },

    { id: "title_night_raider", kind: "title", name: "Night Raider", price: 150, text: "Night Raider", description: "For operators who live after dark." },
    { id: "title_extract_artist", kind: "title", name: "Extraction Artist", price: 250, text: "Extraction Artist", description: "Always finds the way out." },
    { id: "title_loot_goblin", kind: "title", name: "Loot Goblin", price: 300, text: "Loot Goblin", description: "If it's not bolted down..." },
    { id: "title_fnt_vanguard", kind: "title", name: "FNT Vanguard", price: 500, text: "FNT Vanguard", description: "First through the door." },
    { id: "title_boss_hunter", kind: "title", name: "Boss Hunter", price: 750, text: "Boss Hunter", description: "Collector of bad days for bosses." },
    { id: "title_purple_legend", kind: "title", name: "Purple Legend", price: 1200, text: "Purple Legend", description: "A name the FNT channel remembers." },

    { id: "badge_dogtag", kind: "badge", name: "Dog Tag", price: 100, emoji: "🪪", description: "Standard-issue collectible." },
    { id: "badge_ammo", kind: "badge", name: "Golden Round", price: 200, emoji: "🔸", description: "A single polished round." },
    { id: "badge_skull", kind: "badge", name: "Raid Skull", price: 350, emoji: "💀", description: "Survived what others didn't." },
    { id: "badge_radio", kind: "badge", name: "Squad Radio", price: 350, emoji: "📻", description: "Always on comms." },
    { id: "badge_flame", kind: "badge", name: "Ember Mark", price: 500, emoji: "🔥", description: "Burned into memory." },
    { id: "badge_crown", kind: "badge", name: "FNT Crown", price: 1500, emoji: "👑", description: "Royal purple distinction." },
    { id: "badge_gem", kind: "badge", name: "Astral Gem", price: 3000, emoji: "💎", description: "Rare purple-blue gemstone." },
    { id: "badge_eagle", kind: "badge", name: "Eclipse Eagle", price: 5000, emoji: "🦅", description: "The rarest collectible in the FNT vault." }
];

const BY_ID = new Map(COSMETICS.map(item => [item.id, item]));

export function getCosmetic(id: string | null | undefined): CosmeticItem | null {
    return id ? BY_ID.get(id) || null : null;
}

export function getCosmeticPrice(item: CosmeticItem, multiplier: number): number {
    return Math.max(0, Math.round(item.price * multiplier));
}

export type CosmeticState = {
    owned: string[];
    themeId: string;
    titleId: string | null;
    badgeIds: string[];
};

export type ProfilePreferences = {
    doubleXpDm: boolean;
    showCheckpointRating: boolean;
};

export function defaultCosmeticState(): CosmeticState {
    return { owned: [DEFAULT_THEME_ID], themeId: DEFAULT_THEME_ID, titleId: null, badgeIds: [] };
}

export function defaultProfilePreferences(): ProfilePreferences {
    return { doubleXpDm: true, showCheckpointRating: true };
}

export function normalizeCosmeticState(raw: unknown): CosmeticState {
    const source = raw && typeof raw === "object" ? raw as Partial<CosmeticState> : {};
    const owned = new Set([DEFAULT_THEME_ID, ...(Array.isArray(source.owned) ? source.owned.filter(id => BY_ID.has(id)) : [])]);
    const theme = getCosmetic(source.themeId);
    const title = getCosmetic(source.titleId);
    return {
        owned: [...owned],
        themeId: theme?.kind === "theme" && owned.has(theme.id) ? theme.id : DEFAULT_THEME_ID,
        titleId: title?.kind === "title" && owned.has(title.id) ? title.id : null,
        badgeIds: [...new Set(Array.isArray(source.badgeIds) ? source.badgeIds : [])]
            .filter(id => getCosmetic(id)?.kind === "badge" && owned.has(id))
            .slice(0, MAX_SHOWCASE_BADGES)
    };
}

export function normalizeProfilePreferences(raw: unknown): ProfilePreferences {
    const source = raw && typeof raw === "object" ? raw as Partial<ProfilePreferences> : {};
    const defaults = defaultProfilePreferences();
    return {
        doubleXpDm: typeof source.doubleXpDm === "boolean" ? source.doubleXpDm : defaults.doubleXpDm,
        showCheckpointRating: typeof source.showCheckpointRating === "boolean" ? source.showCheckpointRating : defaults.showCheckpointRating
    };
}

export type PurchaseResult =
    | { ok: true; item: CosmeticItem; price: number }
    | { ok: false; reason: "unknown" | "owned" | "funds"; price?: number };

/** Validates and applies a purchase against the provided wallet; caller persists. */
export function purchaseCosmetic(state: CosmeticState, wallet: { fnTokens: number }, itemId: string, multiplier: number): PurchaseResult {
    const item = getCosmetic(itemId);
    if (!item) return { ok: false, reason: "unknown" };
    if (state.owned.includes(item.id)) return { ok: false, reason: "owned" };
    const price = getCosmeticPrice(item, multiplier);
    if (wallet.fnTokens < price) return { ok: false, reason: "funds", price };
    wallet.fnTokens -= price;
    state.owned.push(item.id);
    return { ok: true, item, price };
}

/** Equips an owned cosmetic. Badges toggle in/out of the showcase (max 3). */
export function equipCosmetic(state: CosmeticState, itemId: string): { ok: boolean; message: string } {
    const item = getCosmetic(itemId);
    if (!item || !state.owned.includes(item.id)) return { ok: false, message: "You do not own that cosmetic." };
    if (item.kind === "theme") {
        state.themeId = item.id;
        return { ok: true, message: `Theme set to **${item.name}**.` };
    }
    if (item.kind === "title") {
        state.titleId = state.titleId === item.id ? null : item.id;
        return { ok: true, message: state.titleId ? `Title set to **${item.name}**.` : "Title removed." };
    }
    if (state.badgeIds.includes(item.id)) {
        state.badgeIds = state.badgeIds.filter(id => id !== item.id);
        return { ok: true, message: `${item.emoji} **${item.name}** removed from your showcase.` };
    }
    if (state.badgeIds.length >= MAX_SHOWCASE_BADGES) {
        return { ok: false, message: `Your showcase holds ${MAX_SHOWCASE_BADGES} badges. Remove one first.` };
    }
    state.badgeIds.push(item.id);
    return { ok: true, message: `${item.emoji} **${item.name}** added to your showcase.` };
}
