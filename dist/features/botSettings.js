"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotSettingsStore = exports.ANTI_RAID_SETTINGS = exports.REWARD_SETTINGS = exports.CHANNEL_SETTINGS = exports.FEATURE_TOGGLES = exports.DEFAULT_STAFF_ROLE_IDS = void 0;
exports.defaultBotSettings = defaultBotSettings;
exports.normalizeBotSettings = normalizeBotSettings;
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_path_1 = __importDefault(require("node:path"));
exports.DEFAULT_STAFF_ROLE_IDS = [
    "1506135569913085972",
    "1552751065634439234",
    "1524253962042343434",
    "1552749767824642100",
    "1506185163330031616"
];
exports.FEATURE_TOGGLES = {
    antiRaid: "Spam alerts",
    messageXp: "Message XP",
    voiceXp: "Voice XP",
    doubleXpDm: "2x unlock DMs",
    xpCrates: "Daily XP crates",
    checkpointCards: "Player rating cards",
    cosmeticShop: "Cosmetic shop",
    healthAlerts: "Health alerts"
};
exports.CHANNEL_SETTINGS = {
    modAlerts: "Staff alerts (spam + health)",
    xpPanels: "Live XP leaderboard + FN Xp Panel",
    checkpointCards: "Arena Player Rating panel + cards"
};
exports.REWARD_SETTINGS = {
    messageXp: { label: "Message XP per message", min: 0, max: 10000 },
    voiceXpPerMinute: { label: "Voice XP per minute", min: 0, max: 10000 },
    voiceDoubleXpHours: { label: "Hours in VC before 2x", min: 0.25, max: 24 },
    cosmeticPriceMultiplier: { label: "Cosmetic price multiplier", min: 0.1, max: 10 }
};
exports.ANTI_RAID_SETTINGS = {
    spamRepeatThreshold: { label: "Spam: repeated messages", min: 3, max: 30 },
    spamWindowSeconds: { label: "Spam: window (seconds)", min: 5, max: 600 },
    mentionThreshold: { label: "Mention abuse: mentions", min: 3, max: 50 }
};
function defaultBotSettings(channelDefaults) {
    return {
        version: 1,
        staffRoleIds: [...exports.DEFAULT_STAFF_ROLE_IDS],
        channels: { ...channelDefaults },
        features: Object.fromEntries(Object.keys(exports.FEATURE_TOGGLES).map(key => [key, true])),
        rewards: { messageXp: 100, voiceXpPerMinute: 100, voiceDoubleXpHours: 2, cosmeticPriceMultiplier: 1 },
        antiRaid: { spamRepeatThreshold: 5, spamWindowSeconds: 20, mentionThreshold: 6, timeoutMinutes: 10 },
        updatedAt: 0,
        updatedBy: null
    };
}
const SNOWFLAKE = /^\d{17,21}$/;
function clampNumber(value, min, max, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function normalizeBotSettings(raw, defaults) {
    const source = raw && typeof raw === "object" ? raw : {};
    const settings = structuredClone(defaults);
    if (Array.isArray(source.staffRoleIds)) {
        settings.staffRoleIds = [...new Set(source.staffRoleIds.filter(id => typeof id === "string" && SNOWFLAKE.test(id)))].slice(0, 25);
    }
    for (const key of Object.keys(exports.CHANNEL_SETTINGS)) {
        const value = source.channels?.[key];
        if (typeof value === "string" && SNOWFLAKE.test(value))
            settings.channels[key] = value;
    }
    for (const key of Object.keys(exports.FEATURE_TOGGLES)) {
        const value = source.features?.[key];
        if (typeof value === "boolean")
            settings.features[key] = value;
    }
    for (const [key, spec] of Object.entries(exports.REWARD_SETTINGS)) {
        settings.rewards[key] = clampNumber(source.rewards?.[key], spec.min, spec.max, defaults.rewards[key]);
    }
    for (const [key, spec] of Object.entries(exports.ANTI_RAID_SETTINGS)) {
        settings.antiRaid[key] = Math.round(clampNumber(source.antiRaid?.[key], spec.min, spec.max, defaults.antiRaid[key]));
    }
    settings.antiRaid.timeoutMinutes = Math.round(clampNumber(source.antiRaid?.timeoutMinutes, 1, 1440, defaults.antiRaid.timeoutMinutes));
    settings.updatedAt = typeof source.updatedAt === "number" ? source.updatedAt : 0;
    settings.updatedBy = typeof source.updatedBy === "string" ? source.updatedBy : null;
    return settings;
}
class BotSettingsStore {
    constructor(filePath, defaults, onSave = () => undefined, persist = true) {
        this.filePath = filePath;
        this.defaults = defaults;
        this.onSave = onSave;
        this.persist = persist;
        let raw = null;
        try {
            if (fs_extra_1.default.existsSync(filePath))
                raw = fs_extra_1.default.readJsonSync(filePath);
        }
        catch {
            try {
                if (fs_extra_1.default.existsSync(`${filePath}.bak`))
                    raw = fs_extra_1.default.readJsonSync(`${filePath}.bak`);
            }
            catch {
                raw = null;
            }
        }
        this.settings = normalizeBotSettings(raw, defaults);
    }
    get() {
        return this.settings;
    }
    /** Applies a validated mutation; reverts in memory if the write fails so runtime never diverges from disk. */
    update(actorId, mutate) {
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
            fs_extra_1.default.ensureDirSync(node_path_1.default.dirname(this.filePath));
            if (fs_extra_1.default.existsSync(this.filePath))
                fs_extra_1.default.copyFileSync(this.filePath, `${this.filePath}.bak`);
            const temp = `${this.filePath}.${process.pid}.tmp`;
            fs_extra_1.default.writeJsonSync(temp, next, { spaces: 2 });
            fs_extra_1.default.moveSync(temp, this.filePath, { overwrite: true });
            this.settings = next;
            this.onSave(true);
            return true;
        }
        catch (error) {
            this.settings = previous;
            this.onSave(false, error);
            return false;
        }
    }
}
exports.BotSettingsStore = BotSettingsStore;
