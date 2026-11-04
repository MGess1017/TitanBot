// Deployment summaries and What's New announcements.
import { EmbedBuilder } from "discord.js";
import { execFile } from "node:child_process";
import path from "path";
import { buildWhatsNewEmbed, WHATS_NEW_RELEASE } from "../../features/whatsNew";
import { DEPLOYMENT_SUMMARY_CHANNEL_ID, WHATS_NEW_CHANNEL_ID } from "./config";
import { client } from "./client";
import { recordSaveResult, whatsNewStore } from "./settings";
import { runtimeMetrics, saveRuntimeMetrics } from "./metrics";
import { appendAuditEvent } from "./audit";
import { clampText } from "../ui/embeds";
import { slashCommands } from "../commands/registry";
import { BOT_SRC_DIR } from "./paths";

export async function postWhatsNewIfNeeded(): Promise<void> {
    if (!WHATS_NEW_CHANNEL_ID || whatsNewStore.hasPosted(WHATS_NEW_RELEASE.id, WHATS_NEW_CHANNEL_ID)) return;
    const channel = await client.channels.fetch(WHATS_NEW_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
        console.warn(`[whatsNew] Channel ${WHATS_NEW_CHANNEL_ID} is missing or not text-based.`);
        return;
    }
    const sent = await channel.send({ embeds: [buildWhatsNewEmbed()], allowedMentions: { parse: [] } }).catch(error => {
        console.warn("[whatsNew] Failed to post update:", error instanceof Error ? error.message : error);
        return null;
    });
    if (!sent) return;
    try {
        whatsNewStore.markPosted(WHATS_NEW_RELEASE.id, WHATS_NEW_CHANNEL_ID, sent.id);
        recordSaveResult("whatsNew", true);
    } catch (error) {
        recordSaveResult("whatsNew", false, error);
    }
}

type GitDeploymentInfo = {
    commit: string | null;
    shortCommit: string | null;
    branch: string | null;
    subject: string | null;
};

function readGitOutput(args: string[]): Promise<string | null> {
    return new Promise(resolve => {
        execFile("git", args, {
            cwd: path.resolve(BOT_SRC_DIR, ".."),
            encoding: "utf8",
            timeout: 5_000,
            windowsHide: true
        }, (error, stdout) => resolve(error ? null : stdout.trim() || null));
    });
}

export async function getGitDeploymentInfo(): Promise<GitDeploymentInfo> {
    const [commit, shortCommit, branch, subject] = await Promise.all([
        readGitOutput(["rev-parse", "HEAD"]),
        readGitOutput(["rev-parse", "--short", "HEAD"]),
        readGitOutput(["rev-parse", "--abbrev-ref", "HEAD"]),
        readGitOutput(["log", "-1", "--pretty=%s"])
    ]);
    return { commit, shortCommit, branch, subject };
}

export async function sendDeploymentSummaryIfNeeded(): Promise<void> {
    if (!DEPLOYMENT_SUMMARY_CHANNEL_ID) return;

    const gitInfo = await getGitDeploymentInfo();
    if (
        gitInfo.commit
        && runtimeMetrics.deployment.lastAnnouncedCommit === gitInfo.commit
        && runtimeMetrics.deployment.lastAnnouncedChannelId === DEPLOYMENT_SUMMARY_CHANNEL_ID
    ) {
        return;
    }

    const channel = await client.channels.fetch(DEPLOYMENT_SUMMARY_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
        appendAuditEvent("deployment_summary_failed", {
            channelId: DEPLOYMENT_SUMMARY_CHANNEL_ID,
            commit: gitInfo.commit,
            error: "Configured deployment summary channel is missing or not text-based."
        });
        return;
    }

    const startupAt = runtimeMetrics.availability.lastStartupAt || Date.now();
    const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🚀 Titan Bot Update Deployed")
        .setDescription("A pulled bot update is now live and the bot finished startup successfully.")
        .addFields(
            {
                name: "🧾 Revision",
                value: [
                    `Commit: **${gitInfo.shortCommit || "unknown"}**`,
                    `Branch: **${gitInfo.branch || "unknown"}**`,
                    `Message: ${clampText(gitInfo.subject || "Unavailable", 140)}`
                ].join("\n"),
                inline: false
            },
            {
                name: "✅ Live Status",
                value: [
                    `Ready at: <t:${Math.floor(startupAt / 1000)}:F>`,
                    `Guilds connected: **${client.guilds.cache.size.toLocaleString()}**`,
                    `Slash commands loaded: **${slashCommands.length.toLocaleString()}**`
                ].join("\n"),
                inline: true
            },
            {
                name: "📡 Runtime",
                value: [
                    `Latency: **${Math.round(client.ws.ping)}ms**`,
                    `Memory: **${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS**`,
                    `Tracked restarts: **${runtimeMetrics.availability.totalRestarts.toLocaleString()}**`
                ].join("\n"),
                inline: true
            }
        )
        .setFooter({ text: client.user?.tag ? `${client.user.tag} is online` : "Titan bot is online" })
        .setTimestamp(new Date(startupAt));

    const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        appendAuditEvent("deployment_summary_failed", {
            channelId: DEPLOYMENT_SUMMARY_CHANNEL_ID,
            commit: gitInfo.commit,
            error: "Failed to send deployment summary message."
        });
        return;
    }

    runtimeMetrics.deployment.lastAnnouncedCommit = gitInfo.commit;
    runtimeMetrics.deployment.lastAnnouncedAt = Date.now();
    runtimeMetrics.deployment.lastAnnouncedChannelId = DEPLOYMENT_SUMMARY_CHANNEL_ID;
    saveRuntimeMetrics();
    appendAuditEvent("deployment_summary_sent", {
        channelId: DEPLOYMENT_SUMMARY_CHANNEL_ID,
        commit: gitInfo.commit,
        messageId: sent.id
    });
}
