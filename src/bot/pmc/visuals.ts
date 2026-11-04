// PMC badges, prestige badges, and tier visuals.
import { ARMY_ICON_URL } from "../core/config";

type AccessPointBadge = {
    threshold: number;
    label: string;
    iconUrl: string;
};

type PrestigeBadge = {
    threshold: number;
    label: string;
    iconUrl: string;
    color: number;
};

type PmcTierVisual = {
    level: number;
    label: string;
    iconUrl: string;
    color: number;
};

const ACCESS_POINT_BADGES: AccessPointBadge[] = [
    {
        threshold: 1000,
        label: "Elite Access Tier (1000+ AP)",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f451.png"
    },
    {
        threshold: 500,
        label: "Veteran Access Tier (500+ AP)",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2694.png"
    },
    {
        threshold: 250,
        label: "Operator Access Tier (250+ AP)",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f6e1.png"
    },
    {
        threshold: 0,
        label: "Recruit Access Tier",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f539.png"
    }
];

const PRESTIGE_BADGES: PrestigeBadge[] = [
    {
        threshold: 10,
        label: "Celestial Prestige X",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f30c.png",
        color: 0x8b5cf6
    },
    {
        threshold: 5,
        label: "Mythic Prestige V",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f680.png",
        color: 0xf97316
    },
    {
        threshold: 3,
        label: "Diamond Prestige III",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f48e.png",
        color: 0x0ea5e9
    },
    {
        threshold: 1,
        label: "Veteran Prestige I",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3c5.png",
        color: 0xf59e0b
    },
    {
        threshold: 0,
        label: "Unranked Prestige",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f539.png",
        color: 0x4ca7ff
    }
];

const PMC_TIER_VISUALS: PmcTierVisual[] = [
    {
        level: 50000,
        label: "Ascendant Legend",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2728.png",
        color: 0xf59e0b
    },
    {
        level: 45000,
        label: "Paragon Prime",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f531.png",
        color: 0x0891b2
    },
    {
        level: 40000,
        label: "Astral Conqueror",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2604.png",
        color: 0xdc2626
    },
    {
        level: 35000,
        label: "Eternal Warden",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f5ff.png",
        color: 0x475569
    },
    {
        level: 30000,
        label: "Rift General",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4a0.png",
        color: 0x2563eb
    },
    {
        level: 25000,
        label: "Void Commander",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f300.png",
        color: 0x6d28d9
    },
    {
        level: 20000,
        label: "Mythic Overlord",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f30c.png",
        color: 0x7c3aed
    },
    {
        level: 12000,
        label: "Cataclysm Marshal",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f525.png",
        color: 0xdc2626
    },
    {
        level: 8000,
        label: "Apex Sovereign",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f451.png",
        color: 0xd97706
    },
    {
        level: 4000,
        label: "Steel Warlord",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2694.png",
        color: 0x334155
    },
    {
        level: 1000,
        label: "Iron Vanguard",
        iconUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f6e1.png",
        color: 0x0f766e
    },
    {
        level: 0,
        label: "Field Recruit",
        iconUrl: ARMY_ICON_URL,
        color: 0x0b1f3a
    }
];

export function getAccessPointBadge(accessPoints: number): AccessPointBadge {
    for (const badge of ACCESS_POINT_BADGES) {
        if (accessPoints >= badge.threshold) return badge;
    }
    return ACCESS_POINT_BADGES[ACCESS_POINT_BADGES.length - 1];
}

export function getPrestigeBadge(prestige: number): PrestigeBadge {
    const p = Math.max(0, Math.floor(prestige));
    for (const badge of PRESTIGE_BADGES) {
        if (p >= badge.threshold) return badge;
    }
    return PRESTIGE_BADGES[PRESTIGE_BADGES.length - 1];
}

export function getPmcTierVisual(level: number): PmcTierVisual {
    const lv = Math.max(0, Math.floor(level));
    for (const visual of PMC_TIER_VISUALS) {
        if (lv >= visual.level) return visual;
    }
    return PMC_TIER_VISUALS[PMC_TIER_VISUALS.length - 1];
}
