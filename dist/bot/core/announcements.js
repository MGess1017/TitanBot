"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postWhatsNewIfNeeded = postWhatsNewIfNeeded;
exports.getGitDeploymentInfo = getGitDeploymentInfo;
exports.sendDeploymentSummaryIfNeeded = sendDeploymentSummaryIfNeeded;
// Deployment summaries and What's New announcements.
const discord_js_1 = require("discord.js");
const node_child_process_1 = require("node:child_process");
const path_1 = __importDefault(require("path"));
const whatsNew_1 = require("../../features/whatsNew");
const config_1 = require("./config");
const client_1 = require("./client");
const settings_1 = require("./settings");
const metrics_1 = require("./metrics");
const audit_1 = require("./audit");
const embeds_1 = require("../ui/embeds");
const registry_1 = require("../commands/registry");
const paths_1 = require("./paths");
async function postWhatsNewIfNeeded() {
    if (!config_1.WHATS_NEW_CHANNEL_ID || settings_1.whatsNewStore.hasPosted(whatsNew_1.WHATS_NEW_RELEASE.id, config_1.WHATS_NEW_CHANNEL_ID))
        return;
    const channel = await client_1.client.channels.fetch(config_1.WHATS_NEW_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
        console.warn(`[whatsNew] Channel ${config_1.WHATS_NEW_CHANNEL_ID} is missing or not text-based.`);
        return;
    }
    const sent = await channel.send({ embeds: [(0, whatsNew_1.buildWhatsNewEmbed)()], allowedMentions: { parse: [] } }).catch(error => {
        console.warn("[whatsNew] Failed to post update:", error instanceof Error ? error.message : error);
        return null;
    });
    if (!sent)
        return;
    try {
        settings_1.whatsNewStore.markPosted(whatsNew_1.WHATS_NEW_RELEASE.id, config_1.WHATS_NEW_CHANNEL_ID, sent.id);
        (0, settings_1.recordSaveResult)("whatsNew", true);
    }
    catch (error) {
        (0, settings_1.recordSaveResult)("whatsNew", false, error);
    }
}
function readGitOutput(args) {
    return new Promise(resolve => {
        (0, node_child_process_1.execFile)("git", args, {
            cwd: path_1.default.resolve(paths_1.BOT_SRC_DIR, ".."),
            encoding: "utf8",
            timeout: 5000,
            windowsHide: true
        }, (error, stdout) => resolve(error ? null : stdout.trim() || null));
    });
}
async function getGitDeploymentInfo() {
    const [commit, shortCommit, branch, subject] = await Promise.all([
        readGitOutput(["rev-parse", "HEAD"]),
        readGitOutput(["rev-parse", "--short", "HEAD"]),
        readGitOutput(["rev-parse", "--abbrev-ref", "HEAD"]),
        readGitOutput(["log", "-1", "--pretty=%s"])
    ]);
    return { commit, shortCommit, branch, subject };
}
async function sendDeploymentSummaryIfNeeded() {
    if (!config_1.DEPLOYMENT_SUMMARY_CHANNEL_ID)
        return;
    const gitInfo = await getGitDeploymentInfo();
    if (gitInfo.commit
        && metrics_1.runtimeMetrics.deployment.lastAnnouncedCommit === gitInfo.commit
        && metrics_1.runtimeMetrics.deployment.lastAnnouncedChannelId === config_1.DEPLOYMENT_SUMMARY_CHANNEL_ID) {
        return;
    }
    const channel = await client_1.client.channels.fetch(config_1.DEPLOYMENT_SUMMARY_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
        (0, audit_1.appendAuditEvent)("deployment_summary_failed", {
            channelId: config_1.DEPLOYMENT_SUMMARY_CHANNEL_ID,
            commit: gitInfo.commit,
            error: "Configured deployment summary channel is missing or not text-based."
        });
        return;
    }
    const startupAt = metrics_1.runtimeMetrics.availability.lastStartupAt || Date.now();
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🚀 Titan Bot Update Deployed")
        .setDescription("A pulled bot update is now live and the bot finished startup successfully.")
        .addFields({
        name: "🧾 Revision",
        value: [
            `Commit: **${gitInfo.shortCommit || "unknown"}**`,
            `Branch: **${gitInfo.branch || "unknown"}**`,
            `Message: ${(0, embeds_1.clampText)(gitInfo.subject || "Unavailable", 140)}`
        ].join("\n"),
        inline: false
    }, {
        name: "✅ Live Status",
        value: [
            `Ready at: <t:${Math.floor(startupAt / 1000)}:F>`,
            `Guilds connected: **${client_1.client.guilds.cache.size.toLocaleString()}**`,
            `Slash commands loaded: **${registry_1.slashCommands.length.toLocaleString()}**`
        ].join("\n"),
        inline: true
    }, {
        name: "📡 Runtime",
        value: [
            `Latency: **${Math.round(client_1.client.ws.ping)}ms**`,
            `Memory: **${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS**`,
            `Tracked restarts: **${metrics_1.runtimeMetrics.availability.totalRestarts.toLocaleString()}**`
        ].join("\n"),
        inline: true
    })
        .setFooter({ text: client_1.client.user?.tag ? `${client_1.client.user.tag} is online` : "Titan bot is online" })
        .setTimestamp(new Date(startupAt));
    const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        (0, audit_1.appendAuditEvent)("deployment_summary_failed", {
            channelId: config_1.DEPLOYMENT_SUMMARY_CHANNEL_ID,
            commit: gitInfo.commit,
            error: "Failed to send deployment summary message."
        });
        return;
    }
    metrics_1.runtimeMetrics.deployment.lastAnnouncedCommit = gitInfo.commit;
    metrics_1.runtimeMetrics.deployment.lastAnnouncedAt = Date.now();
    metrics_1.runtimeMetrics.deployment.lastAnnouncedChannelId = config_1.DEPLOYMENT_SUMMARY_CHANNEL_ID;
    (0, metrics_1.saveRuntimeMetrics)();
    (0, audit_1.appendAuditEvent)("deployment_summary_sent", {
        channelId: config_1.DEPLOYMENT_SUMMARY_CHANNEL_ID,
        commit: gitInfo.commit,
        messageId: sent.id
    });
}
