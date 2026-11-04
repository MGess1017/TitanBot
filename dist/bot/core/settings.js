"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsNewStore = exports.antiRaidDetector = exports.antiRaidIncidents = exports.knowledgeBase = exports.botSettingsStore = exports.SAVE_HEALTH = void 0;
exports.recordSaveResult = recordSaveResult;
exports.isFeatureEnabled = isFeatureEnabled;
exports.getXpPanelChannelId = getXpPanelChannelId;
exports.getMessageXpGain = getMessageXpGain;
exports.applyRewardSettings = applyRewardSettings;
// No-code bot settings, save-health tracking, and settings-backed stores.
const xpLeaderboard_1 = require("../../features/xpLeaderboard");
const whatsNew_1 = require("../../features/whatsNew");
const botSettings_1 = require("../../features/botSettings");
const antiRaid_1 = require("../../features/antiRaid");
const staffDesk_1 = require("../../features/staffDesk");
const voiceXp_1 = require("../../runtime/voiceXp");
const config_1 = require("./config");
exports.SAVE_HEALTH = new Map();
function recordSaveResult(store, ok, error) {
    const entry = exports.SAVE_HEALTH.get(store) || { failures: 0, lastFailureAt: 0, lastSuccessAt: 0, lastError: "" };
    if (ok) {
        entry.lastSuccessAt = Date.now();
        entry.lastError = "";
    }
    else {
        entry.failures += 1;
        entry.lastFailureAt = Date.now();
        entry.lastError = error instanceof Error ? error.message : String(error ?? "unknown error");
        console.error(`[persistence] ${store} save failed: ${entry.lastError}`);
    }
    exports.SAVE_HEALTH.set(store, entry);
}
const BOT_SETTINGS_DEFAULTS = (0, botSettings_1.defaultBotSettings)({
    modAlerts: config_1.MOD_LOG_CHANNEL_ID,
    xpPanels: xpLeaderboard_1.XP_LEADERBOARD_CHANNEL_ID,
    checkpointCards: config_1.CHECKPOINT_CARD_CHANNEL_ID
});
BOT_SETTINGS_DEFAULTS.rewards.messageXp = config_1.MESSAGE_XP_GAIN;
exports.botSettingsStore = new botSettings_1.BotSettingsStore(config_1.BOT_SETTINGS_FILE, BOT_SETTINGS_DEFAULTS, (ok, error) => recordSaveResult("settings", ok, error));
exports.knowledgeBase = new staffDesk_1.KnowledgeBaseStore(config_1.KNOWLEDGE_BASE_FILE);
exports.antiRaidIncidents = new antiRaid_1.AntiRaidIncidentStore(config_1.ANTI_RAID_INCIDENT_FILE, true, (ok, error) => recordSaveResult("antiRaid", ok, error));
exports.antiRaidDetector = new antiRaid_1.AntiRaidDetector(() => exports.botSettingsStore.get().antiRaid);
exports.whatsNewStore = new whatsNew_1.WhatsNewStore(config_1.WHATS_NEW_FILE);
function isFeatureEnabled(feature) {
    return exports.botSettingsStore.get().features[feature];
}
function getXpPanelChannelId() {
    return exports.botSettingsStore.get().channels.xpPanels;
}
function getMessageXpGain() {
    return Math.floor(exports.botSettingsStore.get().rewards.messageXp);
}
function applyRewardSettings() {
    const rewards = exports.botSettingsStore.get().rewards;
    (0, voiceXp_1.configureVoiceXp)({ perMinute: rewards.voiceXpPerMinute, doubleAfterMs: rewards.voiceDoubleXpHours * 60 * 60 * 1000 });
}
applyRewardSettings();
