"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureBotFeatureBriefForGuild = ensureBotFeatureBriefForGuild;
// Bot feature brief panel.
const discord_js_1 = require("discord.js");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const help_1 = require("../ui/help");
const embeds_1 = require("../ui/embeds");
function buildBotFeatureBriefPayload(guildName) {
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x0891b2)
        .setTitle(`🛰️ ${guildName} • About Titan Bot`)
        .setDescription([
        `Titan Bot is the primary operations and progression system for **${guildName}**.`,
        "",
        "Use the command menu below to flip through live command pages and read what each bot area does.",
        "",
        "This post is the public command reference for new members, returning players, and staff."
    ].join("\n"))
        .addFields({
        name: "🧭 What This Bot Covers",
        value: [
            "• Raid progression and PMC profiles",
            "• Economy, inventory, crates, and trading",
            "• Giveaways, moderation, support, and report tooling"
        ].join("\n")
    }, {
        name: "📚 Browse Command Pages",
        value: [
            "• Mission Brief",
            "• XP Ops",
            "• Raid Ops",
            "• Supply Crates",
            "• Training Grounds",
            "• Bank and Trade",
            "• Moderation Desk"
        ].join("\n")
    }, {
        name: "🚀 Fast Start",
        value: [
            "• `/quickstart` — guided onboarding",
            "• `/help` — direct personal help menu",
            "• `/ticket` — support request",
            "• `/reportintake` — submit a report"
        ].join("\n")
    }, {
        name: "🔔 Public Guide Rules",
        value: [
            "• Click the menu to change pages",
            "• Keep this channel readable; don’t reply with support requests here",
            "• Use tickets, reports, or commands for action paths"
        ].join("\n")
    }), `${guildName} About Titan Bot`, "About Titan Bot • Official Reference Panel");
    return {
        embed: embed.toJSON(),
        components: (0, help_1.helpDropdown)("general").map(row => row.toJSON()),
        isBotFeatureBrief: true,
        withHelpNav: true,
        helpPage: "general"
    };
}
async function upsertBotFeatureBriefInChannel(guild, channelId) {
    const channel = (guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        return { ok: false, error: "Configured bot feature brief channel is missing or not a text channel." };
    }
    const payload = buildBotFeatureBriefPayload(guild.name);
    const embed = payload.embed;
    const components = Array.isArray(payload.components) ? payload.components : [];
    const storedMessageId = (0, store_1.getGuildPanelMessageId)(guild.id, "featureBrief");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(() => null);
        const edited = await stored?.edit({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) {
            return { ok: true, action: "updated" };
        }
        (0, store_1.setGuildPanelMessageId)(guild.id, "featureBrief", null);
    }
    let candidateId = null;
    const duplicateIds = [];
    let beforeId;
    const expectedPrefix = `🛰️ ${guild.name} • About Titan Bot`;
    for (let i = 0; i < 10; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
        if (!batch || !batch.size)
            break;
        const candidates = batch.filter(message => message.author.id === (client_1.client.user?.id || "")
            && (message.embeds[0]?.title === expectedPrefix
                || message.embeds[0]?.footer?.text?.includes("About Titan Bot")));
        const candidate = candidates.first();
        if (candidate) {
            candidateId = candidate.id;
            for (const duplicate of candidates.values()) {
                if (duplicate.id !== candidate.id)
                    duplicateIds.push(duplicate.id);
            }
            break;
        }
        const last = batch.last();
        beforeId = last?.id;
        if (!beforeId)
            break;
    }
    if (candidateId) {
        const candidate = await channel.messages.fetch(candidateId).catch(() => null);
        const edited = await candidate?.edit({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
        if (!edited) {
            return { ok: false, error: "Failed to refresh bot feature brief message. Check bot permissions for this channel." };
        }
        (0, store_1.setGuildPanelMessageId)(guild.id, "featureBrief", candidateId);
        for (const duplicateId of duplicateIds) {
            if (duplicateId === candidateId)
                continue;
            const duplicate = await channel.messages.fetch(duplicateId).catch(() => null);
            await duplicate?.delete().catch(() => undefined);
        }
        return { ok: true, action: "updated" };
    }
    const sent = await channel.send({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
        return { ok: false, error: "Failed to post bot feature brief message. Check bot permissions for this channel." };
    }
    (0, store_1.setGuildPanelMessageId)(guild.id, "featureBrief", sent.id);
    return { ok: true, action: "posted" };
}
async function ensureBotFeatureBriefForGuild(guild) {
    if (!config_1.BOT_FEATURE_BRIEF_CHANNEL_ID)
        return;
    const result = await upsertBotFeatureBriefInChannel(guild, config_1.BOT_FEATURE_BRIEF_CHANNEL_ID);
    if (result.ok) {
        (0, audit_1.appendAuditEvent)("bot_feature_brief_upsert", {
            guildId: guild.id,
            channelId: config_1.BOT_FEATURE_BRIEF_CHANNEL_ID,
            action: result.action
        });
    }
    else {
        (0, audit_1.appendAuditEvent)("bot_feature_brief_upsert_failed", {
            guildId: guild.id,
            channelId: config_1.BOT_FEATURE_BRIEF_CHANNEL_ID,
            error: result.error
        });
        console.warn(`Bot feature brief upsert skipped for guild ${guild.id}: ${result.error}`);
    }
}
