import fs from "fs-extra";
import path from "node:path";

export const DEFAULT_STAFF_ROLE_IDS = [
    "1506135569913085972",
    "1552751065634439234",
    "1524253962042343434",
    "1552749767824642100",
    "1506185163330031616"
];

export const FEATURE_TOGGLES = {
    antiRaid: "Spam alerts",
    messageXp: "Message XP",
    voiceXp: "Voice XP",
    doubleXpDm: "2x unlock DMs",
    xpCrates: "Daily XP crates",
    checkpointCards: "Player rating cards",
    cosmeticShop: "Cosmetic shop",
    healthAlerts: "Health alerts"
} as const;
export type FeatureToggle = keyof typeof FEATURE_TOGGLES;

export const CHANNEL_SETTINGS = {
    modAlerts: "Staff alerts (spam + health)",
    xpPanels: "Live XP leaderboard + FN Xp Panel",
    checkpointCards: "Arena Player Rating panel + cards"
} as const;
export type ChannelSetting = keyof typeof CHANNEL_SETTINGS;

export const REWARD_SETTINGS = {
    messageXp: { label: "Message XP per message", min: 0, max: 10_000 },
    voiceXpPerMinute: { label: "Voice XP per minute", min: 0, max: 10_000 },
    voiceDoubleXpHours: { label: "Hours in VC before 2x", min: 0.25, max: 24 },
    cosmeticPriceMultiplier: { label: "Cosmetic price multiplier", min: 0.1, max: 10 }
} as const;
export type RewardSetting = keyof typeof REWARD_SETTINGS;

export const ANTI_RAID_SETTINGS = {
    spamRepeatThreshold: { label: "Spam: repeated messages", min: 3, max: 30 },
    spamWindowSeconds: { label: "Spam: window (seconds)", min: 5, max: 600 },
    mentionThreshold: { label: "Mention abuse: mentions", min: 3, max: 50 }
} as const;
export type AntiRaidSetting = keyof typeof ANTI_RAID_SETTINGS;

export type BotSettings = {
    version: 1;
    staffRoleIds: string[];
    channels: Record<ChannelSetting, string>;
    features: Record<FeatureToggle, boolean>;
    rewards: Record<RewardSetting, number>;
    antiRaid: Record<AntiRaidSetting, number> & { timeoutMinutes: number };
    updatedAt: number;
    updatedBy: string | null;
};

export function defaultBotSettings(channelDefaults: Record<ChannelSetting, string>): BotSettings {
    return {
        version: 1,
        staffRoleIds: [...DEFAULT_STAFF_ROLE_IDS],
        channels: { ...channelDefaults },
        features: Object.fromEntries(Object.keys(FEATURE_TOGGLES).map(key => [key, true])) as Record<FeatureToggle, boolean>,
        rewards: { messageXp: 100, voiceXpPerMinute: 100, voiceDoubleXpHours: 2, cosmeticPriceMultiplier: 1 },
        antiRaid: { spamRepeatThreshold: 5, spamWindowSeconds: 20, mentionThreshold: 6, timeoutMinutes: 10 },
        updatedAt: 0,
        updatedBy: null
    };
}

const SNOWFLAKE = /^\d{17,21}$/;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeBotSettings(raw: unknown, defaults: BotSettings): BotSettings {
    const source = raw && typeof raw === "object" ? raw as Partial<BotSettings> : {};
    const settings = structuredClone(defaults);
    if (Array.isArray(source.staffRoleIds)) {
        settings.staffRoleIds = [...new Set(source.staffRoleIds.filter(id => typeof id === "string" && SNOWFLAKE.test(id)))].slice(0, 25);
    }
    for (const key of Object.keys(CHANNEL_SETTINGS) as ChannelSetting[]) {
        const value = source.channels?.[key];
        if (typeof value === "string" && SNOWFLAKE.test(value)) settings.channels[key] = value;
    }
    for (const key of Object.keys(FEATURE_TOGGLES) as FeatureToggle[]) {
        const value = source.features?.[key];
        if (typeof value === "boolean") settings.features[key] = value;
    }
    for (const [key, spec] of Object.entries(REWARD_SETTINGS) as Array<[RewardSetting, { min: number; max: number }]>) {
        settings.rewards[key] = clampNumber(source.rewards?.[key], spec.min, spec.max, defaults.rewards[key]);
    }
    for (const [key, spec] of Object.entries(ANTI_RAID_SETTINGS) as Array<[AntiRaidSetting, { min: number; max: number }]>) {
        settings.antiRaid[key] = Math.round(clampNumber(source.antiRaid?.[key], spec.min, spec.max, defaults.antiRaid[key]));
    }
    settings.antiRaid.timeoutMinutes = Math.round(clampNumber(source.antiRaid?.timeoutMinutes, 1, 1440, defaults.antiRaid.timeoutMinutes));
    settings.updatedAt = typeof source.updatedAt === "number" ? source.updatedAt : 0;
    settings.updatedBy = typeof source.updatedBy === "string" ? source.updatedBy : null;
    return settings;
}

export type SettingsSaveListener = (ok: boolean, error?: unknown) => void;

export class BotSettingsStore {
    private settings: BotSettings;

    constructor(
        private readonly filePath: string,
        private readonly defaults: BotSettings,
        private readonly onSave: SettingsSaveListener = () => undefined,
        private readonly persist = true
    ) {
        let raw: unknown = null;
        try {
            if (fs.existsSync(filePath)) raw = fs.readJsonSync(filePath);
        } catch {
            try {
                if (fs.existsSync(`${filePath}.bak`)) raw = fs.readJsonSync(`${filePath}.bak`);
            } catch {
                raw = null;
            }
        }
        this.settings = normalizeBotSettings(raw, defaults);
    }

    get(): Readonly<BotSettings> {
        return this.settings;
    }

    /** Applies a validated mutation; reverts in memory if the write fails so runtime never diverges from disk. */
    update(actorId: string, mutate: (draft: BotSettings) => void): boolean {
        const previous = this.settings;
        const draft = structuredClone(previous);
        mutate(draft);
        draft.updatedAt = Date.now();
        draft.updatedBy = actorId;
        const next = normalizeBotSettings(draft, this.defaults);
        if (!this.persist) {
            this.settings = next;
            this.onSave(true);
            return true;
        }
        try {
            fs.ensureDirSync(path.dirname(this.filePath));
            if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, `${this.filePath}.bak`);
            const temp = `${this.filePath}.${process.pid}.tmp`;
            fs.writeJsonSync(temp, next, { spaces: 2 });
            fs.moveSync(temp, this.filePath, { overwrite: true });
            this.settings = next;
            this.onSave(true);
            return true;
        } catch (error) {
            this.settings = previous;
            this.onSave(false, error);
            return false;
        }
    }
}
