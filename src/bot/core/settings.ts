// No-code bot settings, save-health tracking, and settings-backed stores.
import { XP_LEADERBOARD_CHANNEL_ID } from "../../features/xpLeaderboard";
import { WhatsNewStore } from "../../features/whatsNew";
import { BotSettingsStore, defaultBotSettings, type FeatureToggle } from "../../features/botSettings";
import { AntiRaidDetector, AntiRaidIncidentStore } from "../../features/antiRaid";
import { KnowledgeBaseStore } from "../../features/staffDesk";
import { configureVoiceXp } from "../../runtime/voiceXp";
import {
    ANTI_RAID_INCIDENT_FILE, BOT_SETTINGS_FILE, CHECKPOINT_CARD_CHANNEL_ID, KNOWLEDGE_BASE_FILE, MESSAGE_XP_GAIN,
    MOD_LOG_CHANNEL_ID, WHATS_NEW_FILE
} from "./config";

type SaveHealthEntry = { failures: number; lastFailureAt: number; lastSuccessAt: number; lastError: string };
export const SAVE_HEALTH = new Map<string, SaveHealthEntry>();

export function recordSaveResult(store: string, ok: boolean, error?: unknown): void {
    const entry = SAVE_HEALTH.get(store) || { failures: 0, lastFailureAt: 0, lastSuccessAt: 0, lastError: "" };
    if (ok) entry.lastSuccessAt = Date.now();
    else {
        entry.failures += 1;
        entry.lastFailureAt = Date.now();
        entry.lastError = error instanceof Error ? error.message : String(error ?? "unknown error");
    }
    SAVE_HEALTH.set(store, entry);
}

const BOT_SETTINGS_DEFAULTS = defaultBotSettings({
    modAlerts: MOD_LOG_CHANNEL_ID,
    xpPanels: XP_LEADERBOARD_CHANNEL_ID,
    checkpointCards: CHECKPOINT_CARD_CHANNEL_ID
});
BOT_SETTINGS_DEFAULTS.rewards.messageXp = MESSAGE_XP_GAIN;
export const botSettingsStore = new BotSettingsStore(BOT_SETTINGS_FILE, BOT_SETTINGS_DEFAULTS, (ok, error) => recordSaveResult("settings", ok, error));
export const knowledgeBase = new KnowledgeBaseStore(KNOWLEDGE_BASE_FILE);
export const antiRaidIncidents = new AntiRaidIncidentStore(ANTI_RAID_INCIDENT_FILE, true, (ok, error) => recordSaveResult("antiRaid", ok, error));
export const antiRaidDetector = new AntiRaidDetector(() => botSettingsStore.get().antiRaid);
export const whatsNewStore = new WhatsNewStore(WHATS_NEW_FILE);

export function isFeatureEnabled(feature: FeatureToggle): boolean {
    return botSettingsStore.get().features[feature];
}

export function getXpPanelChannelId(): string {
    return botSettingsStore.get().channels.xpPanels;
}

export function getMessageXpGain(): number {
    return Math.floor(botSettingsStore.get().rewards.messageXp);
}

export function applyRewardSettings(): void {
    const rewards = botSettingsStore.get().rewards;
    configureVoiceXp({ perMinute: rewards.voiceXpPerMinute, doubleAfterMs: rewards.voiceDoubleXpHours * 60 * 60 * 1000 });
}
applyRewardSettings();
