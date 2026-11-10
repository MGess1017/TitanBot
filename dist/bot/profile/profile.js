"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProfilePayload = buildProfilePayload;
exports.handleProfileInteraction = handleProfileInteraction;
// /profile pages and the cosmetic shop.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const bossHearts_1 = require("../../game/bossHearts");
const achievements_1 = require("../../game/achievements");
const achievementTitles_1 = require("../../features/achievementTitles");
const xpCrates_1 = require("../../game/xpCrates");
const checkpointRating_1 = require("../../game/checkpointRating");
const profileHub_1 = require("../../features/profileHub");
const cosmetics_1 = require("../../game/cosmetics");
const checkpointRating_2 = require("../../game/checkpointRating");
const playerCards_1 = require("../panels/playerCards");
const client_1 = require("../core/client");
const engagement_1 = require("../xp/engagement");
const settings_1 = require("../core/settings");
const visuals_1 = require("../pmc/visuals");
const audit_1 = require("../core/audit");
const roles_1 = require("../xp/roles");
const inquiryPanel_1 = require("../../features/inquiryPanel");
// ---------- Unified profile ----------
function buildProfileSnapshot(target, guild) {
    const user = (0, utils_1.ensureUser)(target.id);
    (0, utils_1.syncProgressAchievements)(target.id);
    const settings = settings_1.botSettingsStore.get();
    const voiceMs = (0, engagement_1.getLiveVoiceTimeMs)(target.id);
    const voiceMinutes = Math.floor(voiceMs / 60000);
    const games = (0, utils_1.getGameStatsSummary)(target.id);
    const nextXp = achievements_1.XP_ACHIEVEMENTS.find(achievement => user.xp < achievement.threshold);
    const nextVoice = achievements_1.VOICE_ACHIEVEMENTS.find(achievement => voiceMinutes < achievement.threshold);
    const crate = user.latestXpCrate ? (0, xpCrates_1.getXpCrateDefinition)(user.latestXpCrate.crateId) : null;
    const checkpointProfile = user.checkpointProfile;
    const checkpointRating = checkpointProfile && (0, checkpointRating_1.isCheckpointComplete)(checkpointProfile.stats)
        ? (0, checkpointRating_2.calculateCheckpointRating)(checkpointProfile.stats).rating
        : null;
    return {
        userId: target.id,
        username: target.username,
        avatarUrl: target.displayAvatarURL({ extension: "png", size: 128 }),
        cosmetics: user.cosmetics,
        preferences: user.preferences,
        xp: user.xp,
        level: (0, utils_1.getXPLevel)(user.xp),
        xpBar: (0, utils_1.xpBar)(user.xp),
        xpRole: (0, roles_1.getXpRoleProgress)(user.xp).currentRole?.name || "No role yet",
        prestigeLabel: (0, visuals_1.getPrestigeBadge)(user.prestige).label,
        fnTokens: user.fnTokens,
        bankTokens: user.bankTokens,
        pmcLevel: (0, utils_1.getPmcLevel)(user.pmcXP),
        pmcXp: user.pmcXP,
        pmcRaids: user.pmcRaids,
        pmcRaidWins: user.pmcRaidWins,
        pmcBossKills: user.pmcBossKills,
        voiceMultiplier: (0, engagement_1.getCurrentVoiceXpMultiplier)(guild, target.id),
        inVoice: Boolean(guild?.voiceStates.cache.get(target.id)?.channelId),
        voiceTime: (0, engagement_1.formatVoiceDuration)(voiceMs),
        dailyStreak: user.dailyStreak,
        lastXpAt: user.lastXP,
        achievementTitle: (0, achievementTitles_1.getEquippedAchievementTitle)(user.achievementTitleId, user.achievementIds)?.title || null,
        xpAchievements: {
            earned: achievements_1.XP_ACHIEVEMENTS.filter(achievement => user.achievementIds.includes(achievement.id)).map(achievement => achievement.title),
            total: achievements_1.XP_ACHIEVEMENTS.length,
            next: nextXp ? `XP: **${nextXp.title}** at ${nextXp.threshold.toLocaleString()} XP` : null
        },
        voiceAchievements: {
            earned: achievements_1.VOICE_ACHIEVEMENTS.filter(achievement => user.achievementIds.includes(achievement.id)).map(achievement => achievement.title),
            total: achievements_1.VOICE_ACHIEVEMENTS.length,
            next: nextVoice ? `Voice: **${nextVoice.title}** at ${nextVoice.threshold.toLocaleString()} min` : null
        },
        recentAchievements: user.achievements,
        latestCrate: user.latestXpCrate && crate
            ? { name: crate.name, xp: user.latestXpCrate.xp, claimedAt: user.latestXpCrate.claimedAt, color: crate.color }
            : null,
        nextCrateAt: user.latestXpCrate ? user.latestXpCrate.claimedAt + xpCrates_1.XP_CRATE_COOLDOWN_MS : null,
        bossHearts: (0, bossHearts_1.getUnlockedBossHeartNames)(target.id),
        checkpoint: checkpointProfile && checkpointRating !== null
            ? { rating: checkpointRating, tier: (0, checkpointRating_2.getCheckpointTier)(checkpointRating).name, url: (0, playerCards_1.getCheckpointCardUrl)(checkpointProfile, guild?.id ?? null) }
            : null,
        games: { played: games.casinoPlayed, wins: games.wins, losses: games.losses, net: games.net },
        cosmeticShopEnabled: settings.features.cosmeticShop,
        priceMultiplier: settings.rewards.cosmeticPriceMultiplier
    };
}
function buildProfilePayload(target, page, viewerId, guild) {
    const snapshot = buildProfileSnapshot(target, guild);
    const embed = (0, profileHub_1.buildProfileEmbed)(snapshot, page, page === "progression" ? (0, roles_1.buildXpIntelligenceEmbed)({ user: { id: target.id } }).toJSON() : undefined);
    const components = (0, profileHub_1.buildProfileComponents)(snapshot, page, viewerId);
    if (page === "achievements" && viewerId === target.id) {
        components.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(achievementTitles_1.ACHIEVEMENT_TITLE_BUTTON_ID).setLabel("Equip Achievement Title").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON());
    }
    const navigable = (0, inquiryPanel_1.withHubNavigation)({ embed, components }, "profile");
    return { embed: navigable.embed, components: navigable.components || [] };
}
function buildShopReply(userId, kind, notice) {
    const user = (0, utils_1.ensureUser)(userId);
    const payload = (0, profileHub_1.buildShopPayload)(user.cosmetics, user.fnTokens, kind, settings_1.botSettingsStore.get().rewards.cosmeticPriceMultiplier);
    return { content: notice || "", embeds: payload.embeds, components: payload.components };
}
async function handleProfileInteraction(interaction) {
    if (!(interaction.isButton() || interaction.isStringSelectMenu()) || !interaction.customId.startsWith("profile:"))
        return false;
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${profileHub_1.PROFILE_IDS.page}:`)) {
        const ownerId = interaction.customId.slice(profileHub_1.PROFILE_IDS.page.length + 1);
        const page = interaction.values[0];
        if (!Object.prototype.hasOwnProperty.call(profileHub_1.PROFILE_PAGES, page))
            return true;
        const target = await client_1.client.users.fetch(ownerId);
        const payload = buildProfilePayload(target, page, interaction.user.id, interaction.guild);
        if (interaction.user.id === ownerId) {
            await interaction.update({ embeds: [payload.embed], components: payload.components });
        }
        else {
            await interaction.reply({ embeds: [payload.embed], components: payload.components, flags: discord_js_1.MessageFlags.Ephemeral });
        }
        return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${profileHub_1.PROFILE_IDS.pref}:`)) {
        const [, , key, ownerId] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({ content: "Only the profile owner can change these preferences. Open your own with `/profile`.", flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        if (key !== "doubleXpDm" && key !== "showCheckpointRating")
            return true;
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        user.preferences[key] = !user.preferences[key];
        (0, utils_1.savePoints)();
        (0, audit_1.appendAuditEvent)("profile_preference_changed", { userId: interaction.user.id, key, value: user.preferences[key] });
        const payload = buildProfilePayload(interaction.user, "preferences", interaction.user.id, interaction.guild);
        await interaction.update({ embeds: [payload.embed], components: payload.components });
        return true;
    }
    if (!(0, settings_1.isFeatureEnabled)("cosmeticShop")) {
        await interaction.reply({ content: "The cosmetic shop is closed by staff right now.", flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.isButton() && interaction.customId === profileHub_1.PROFILE_IDS.shop) {
        await interaction.reply({ ...buildShopReply(interaction.user.id, "theme"), flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    const kindFrom = (customId, prefix) => {
        const kind = customId.slice(prefix.length + 1);
        return kind === "theme" || kind === "title" || kind === "badge" ? kind : null;
    };
    if (interaction.isButton() && interaction.customId.startsWith(`${profileHub_1.PROFILE_IDS.shopKind}:`)) {
        const kind = kindFrom(interaction.customId, profileHub_1.PROFILE_IDS.shopKind);
        if (kind)
            await interaction.update(buildShopReply(interaction.user.id, kind));
        return true;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${profileHub_1.PROFILE_IDS.buy}:`)) {
        const kind = kindFrom(interaction.customId, profileHub_1.PROFILE_IDS.buy);
        if (!kind)
            return true;
        const itemId = interaction.values[0];
        const result = (0, utils_1.withDeferredPointsSave)(() => {
            const user = (0, utils_1.ensureUser)(interaction.user.id);
            const purchase = (0, cosmetics_1.purchaseCosmetic)(user.cosmetics, user, itemId, settings_1.botSettingsStore.get().rewards.cosmeticPriceMultiplier);
            const equipped = purchase.ok ? (0, cosmetics_1.equipCosmetic)(user.cosmetics, purchase.item.id).ok : false;
            if (purchase.ok)
                (0, utils_1.savePoints)();
            return { purchase, equipped };
        });
        let notice;
        const purchase = result.purchase;
        if (purchase.ok) {
            (0, audit_1.appendAuditEvent)("cosmetic_purchased", { userId: interaction.user.id, itemId, price: purchase.price });
            notice = `✅ Purchased ${result.equipped ? "and equipped " : ""}**${purchase.item.name}** for ${purchase.price.toLocaleString()} FN Token$.`
                + (result.equipped ? "" : " Your badge showcase is full — swap one out below.");
        }
        else if (purchase.reason === "funds") {
            notice = `❌ You need ${purchase.price?.toLocaleString()} FN Token$ for that.`;
        }
        else if (purchase.reason === "owned") {
            notice = "You already own that cosmetic.";
        }
        else {
            notice = "That cosmetic is no longer available.";
        }
        await interaction.update(buildShopReply(interaction.user.id, kind, notice));
        return true;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${profileHub_1.PROFILE_IDS.equip}:`)) {
        const kind = kindFrom(interaction.customId, profileHub_1.PROFILE_IDS.equip);
        if (!kind)
            return true;
        const user = (0, utils_1.ensureUser)(interaction.user.id);
        const result = (0, cosmetics_1.equipCosmetic)(user.cosmetics, interaction.values[0]);
        if (result.ok)
            (0, utils_1.savePoints)();
        await interaction.update(buildShopReply(interaction.user.id, kind, result.ok ? `✅ ${result.message}` : `❌ ${result.message}`));
        return true;
    }
    return true;
}
