"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotFeatureBriefPayload = buildBotFeatureBriefPayload;
exports.ensureBotFeatureBriefForGuild = ensureBotFeatureBriefForGuild;
// Bot feature brief panel.
const discord_js_1 = require("discord.js");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const ids_1 = require("../ui/ids");
const embeds_1 = require("../ui/embeds");
function buildBotFeatureBriefPayload() {
    const embed = (0, embeds_1.brandLiveEmbed)(new discord_js_1.EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("Welcome to FNT")
        .setDescription([
        "• **Your profile:** `/profile` shows progress, achievements, and cosmetics.",
        "• **Start free:** claim FN Token$ with `/daily`.",
        "• **Go raiding:** `/raid` earns loot and PMC XP. Start with a small bet and low risk.",
        "• **Earn server XP:** chat or join voice, then check `/xp`.",
        `• **Need help?** Open a private ticket in <#${config_1.PERMANENT_TICKET_PANEL_CHANNEL_ID}>.`
    ].join("\n")), "FNT", "FNT • Member Guide");
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(ids_1.ONBOARDING_IDS.start).setLabel("Get Started").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(ids_1.ONBOARDING_IDS.commands).setLabel("Command Guide").setStyle(discord_js_1.ButtonStyle.Secondary));
    return {
        embed: embed.toJSON(),
        components: [row.toJSON()],
        isBotFeatureBrief: true
    };
}
async function upsertBotFeatureBriefInChannel(guild, channelId) {
    const channel = (guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        return { ok: false, error: "Configured bot feature brief channel is missing or not a text channel." };
    }
    const { embed, components } = buildBotFeatureBriefPayload();
    const storedMessageId = (0, store_1.getGuildPanelMessageId)(guild.id, "featureBrief");
    if (storedMessageId) {
        const stored = await channel.messages.fetch(storedMessageId).catch(error => {
            if (error instanceof discord_js_1.DiscordAPIError && error.code === 10008)
                return null;
            throw error;
        });
        if (stored && stored.author.id === client_1.client.user?.id) {
            await stored.edit({ embeds: [embed], components, allowedMentions: { parse: [] } });
            return { ok: true, action: "updated" };
        }
        (0, store_1.setGuildPanelMessageId)(guild.id, "featureBrief", null);
    }
    let candidateId = null;
    const duplicateIds = [];
    let beforeId;
    const expectedPrefix = `🛰️ ${guild.name} • About Titan Bot`;
    for (let i = 0; i < 10; i++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) });
        if (!batch.size)
            break;
        const candidates = batch.filter(message => message.author.id === (client_1.client.user?.id || "")
            && (message.embeds[0]?.title === "Welcome to FNT"
                || message.embeds[0]?.footer?.text?.includes("FNT • Member Guide")
                || message.embeds[0]?.title === expectedPrefix
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
            await duplicate?.delete().catch(error => {
                console.warn(`Could not remove duplicate welcome panel ${duplicateId}:`, error);
            });
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
