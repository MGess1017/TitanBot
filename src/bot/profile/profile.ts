// /profile pages and the cosmetic shop.
import {
    ActionRowBuilder, APIEmbed, ButtonBuilder, ButtonStyle, Guild, MessageFlags, User, type Interaction
} from "discord.js";
import {
    ensureUser, getPmcLevel, getGameStatsSummary, getXPLevel, savePoints, syncProgressAchievements,
    withDeferredPointsSave, xpBar
} from "../../utils";
import { getUnlockedBossHeartNames } from "../../game/bossHearts";
import { VOICE_ACHIEVEMENTS, XP_ACHIEVEMENTS } from "../../game/achievements";
import { ACHIEVEMENT_TITLE_BUTTON_ID, getEquippedAchievementTitle } from "../../features/achievementTitles";
import { getXpCrateDefinition, XP_CRATE_COOLDOWN_MS } from "../../game/xpCrates";
import { isCheckpointComplete } from "../../game/checkpointRating";
import {
    buildProfileComponents, buildProfileEmbed, buildShopPayload as buildCosmeticShopPayload, PROFILE_IDS,
    PROFILE_PAGES, type ProfilePage, type ProfileSnapshot
} from "../../features/profileHub";
import { equipCosmetic, purchaseCosmetic, type CosmeticKind } from "../../game/cosmetics";
import { calculateCheckpointRating, getCheckpointTier } from "../../game/checkpointRating";
import { getCheckpointCardUrl } from "../panels/playerCards";
import { client } from "../core/client";
import { formatVoiceDuration, getCurrentVoiceXpMultiplier, getLiveVoiceTimeMs } from "../xp/engagement";
import { botSettingsStore, isFeatureEnabled } from "../core/settings";
import { getPrestigeBadge } from "../pmc/visuals";
import { appendAuditEvent } from "../core/audit";
import { buildXpIntelligenceEmbed, getXpRoleProgress } from "../xp/roles";

// ---------- Unified profile ----------

function buildProfileSnapshot(target: User, guild: Guild | null): ProfileSnapshot {
    const user = ensureUser(target.id);
    syncProgressAchievements(target.id);
    const settings = botSettingsStore.get();
    const voiceMs = getLiveVoiceTimeMs(target.id);
    const voiceMinutes = Math.floor(voiceMs / 60_000);
    const games = getGameStatsSummary(target.id);
    const nextXp = XP_ACHIEVEMENTS.find(achievement => user.xp < achievement.threshold);
    const nextVoice = VOICE_ACHIEVEMENTS.find(achievement => voiceMinutes < achievement.threshold);
    const crate = user.latestXpCrate ? getXpCrateDefinition(user.latestXpCrate.crateId) : null;
    const checkpointProfile = user.checkpointProfile;
    const checkpointRating = checkpointProfile && isCheckpointComplete(checkpointProfile.stats)
        ? calculateCheckpointRating(checkpointProfile.stats).rating
        : null;
    return {
        userId: target.id,
        username: target.username,
        avatarUrl: target.displayAvatarURL({ extension: "png", size: 128 }),
        cosmetics: user.cosmetics,
        preferences: user.preferences,
        xp: user.xp,
        level: getXPLevel(user.xp),
        xpBar: xpBar(user.xp),
        xpRole: getXpRoleProgress(user.xp).currentRole?.name || "No role yet",
        prestigeLabel: getPrestigeBadge(user.prestige).label,
        fnTokens: user.fnTokens,
        bankTokens: user.bankTokens,
        pmcLevel: getPmcLevel(user.pmcXP),
        pmcXp: user.pmcXP,
        pmcRaids: user.pmcRaids,
        pmcRaidWins: user.pmcRaidWins,
        pmcBossKills: user.pmcBossKills,
        voiceMultiplier: getCurrentVoiceXpMultiplier(guild, target.id),
        inVoice: Boolean(guild?.voiceStates.cache.get(target.id)?.channelId),
        voiceTime: formatVoiceDuration(voiceMs),
        dailyStreak: user.dailyStreak,
        lastXpAt: user.lastXP,
        achievementTitle: getEquippedAchievementTitle(user.achievementTitleId, user.achievementIds)?.title || null,
        xpAchievements: {
            earned: XP_ACHIEVEMENTS.filter(achievement => user.achievementIds.includes(achievement.id)).map(achievement => achievement.title),
            total: XP_ACHIEVEMENTS.length,
            next: nextXp ? `XP: **${nextXp.title}** at ${nextXp.threshold.toLocaleString()} XP` : null
        },
        voiceAchievements: {
            earned: VOICE_ACHIEVEMENTS.filter(achievement => user.achievementIds.includes(achievement.id)).map(achievement => achievement.title),
            total: VOICE_ACHIEVEMENTS.length,
            next: nextVoice ? `Voice: **${nextVoice.title}** at ${nextVoice.threshold.toLocaleString()} min` : null
        },
        recentAchievements: user.achievements,
        latestCrate: user.latestXpCrate && crate
            ? { name: crate.name, xp: user.latestXpCrate.xp, claimedAt: user.latestXpCrate.claimedAt, color: crate.color }
            : null,
        nextCrateAt: user.latestXpCrate ? user.latestXpCrate.claimedAt + XP_CRATE_COOLDOWN_MS : null,
        bossHearts: getUnlockedBossHeartNames(target.id),
        checkpoint: checkpointProfile && checkpointRating !== null
            ? { rating: checkpointRating, tier: getCheckpointTier(checkpointRating).name, url: getCheckpointCardUrl(checkpointProfile, guild?.id ?? null) }
            : null,
        games: { played: games.casinoPlayed, wins: games.wins, losses: games.losses, net: games.net },
        cosmeticShopEnabled: settings.features.cosmeticShop,
        priceMultiplier: settings.rewards.cosmeticPriceMultiplier
    };
}

export function buildProfilePayload(target: User, page: ProfilePage, viewerId: string, guild: Guild | null): { embed: APIEmbed; components: unknown[] } {
    const snapshot = buildProfileSnapshot(target, guild);
    const embed = buildProfileEmbed(snapshot, page, page === "progression" ? buildXpIntelligenceEmbed({ user: { id: target.id } }).toJSON() : undefined);
    const components: unknown[] = buildProfileComponents(snapshot, page, viewerId);
    if (page === "achievements" && viewerId === target.id) {
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(ACHIEVEMENT_TITLE_BUTTON_ID).setLabel("Equip Achievement Title").setStyle(ButtonStyle.Secondary)).toJSON());
    }
    return { embed, components };
}

function buildShopReply(userId: string, kind: CosmeticKind, notice?: string) {
    const user = ensureUser(userId);
    const payload = buildCosmeticShopPayload(user.cosmetics, user.fnTokens, kind, botSettingsStore.get().rewards.cosmeticPriceMultiplier);
    return { content: notice || "", embeds: payload.embeds, components: payload.components };
}

export async function handleProfileInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isStringSelectMenu()) || !interaction.customId.startsWith("profile:")) return false;

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PROFILE_IDS.page}:`)) {
        const ownerId = interaction.customId.slice(PROFILE_IDS.page.length + 1);
        const page = interaction.values[0] as ProfilePage;
        if (!Object.prototype.hasOwnProperty.call(PROFILE_PAGES, page)) return true;
        const target = await client.users.fetch(ownerId);
        const payload = buildProfilePayload(target, page, interaction.user.id, interaction.guild);
        if (interaction.user.id === ownerId) {
            await interaction.update({ embeds: [payload.embed], components: payload.components as never[] });
        } else {
            await interaction.reply({ embeds: [payload.embed], components: payload.components as never[], flags: MessageFlags.Ephemeral });
        }
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${PROFILE_IDS.pref}:`)) {
        const [, , key, ownerId] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({ content: "Only the profile owner can change these preferences. Open your own with `/profile`.", flags: MessageFlags.Ephemeral });
            return true;
        }
        if (key !== "doubleXpDm" && key !== "showCheckpointRating") return true;
        const user = ensureUser(interaction.user.id);
        user.preferences[key] = !user.preferences[key];
        savePoints();
        appendAuditEvent("profile_preference_changed", { userId: interaction.user.id, key, value: user.preferences[key] });
        const payload = buildProfilePayload(interaction.user, "preferences", interaction.user.id, interaction.guild);
        await interaction.update({ embeds: [payload.embed], components: payload.components as never[] });
        return true;
    }

    if (!isFeatureEnabled("cosmeticShop")) {
        await interaction.reply({ content: "The cosmetic shop is closed by staff right now.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.isButton() && interaction.customId === PROFILE_IDS.shop) {
        await interaction.reply({ ...buildShopReply(interaction.user.id, "theme"), flags: MessageFlags.Ephemeral });
        return true;
    }

    const kindFrom = (customId: string, prefix: string): CosmeticKind | null => {
        const kind = customId.slice(prefix.length + 1);
        return kind === "theme" || kind === "title" || kind === "badge" ? kind : null;
    };

    if (interaction.isButton() && interaction.customId.startsWith(`${PROFILE_IDS.shopKind}:`)) {
        const kind = kindFrom(interaction.customId, PROFILE_IDS.shopKind);
        if (kind) await interaction.update(buildShopReply(interaction.user.id, kind));
        return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PROFILE_IDS.buy}:`)) {
        const kind = kindFrom(interaction.customId, PROFILE_IDS.buy);
        if (!kind) return true;
        const itemId = interaction.values[0];
        const result = withDeferredPointsSave(() => {
            const user = ensureUser(interaction.user.id);
            const purchase = purchaseCosmetic(user.cosmetics, user, itemId, botSettingsStore.get().rewards.cosmeticPriceMultiplier);
            const equipped = purchase.ok ? equipCosmetic(user.cosmetics, purchase.item.id).ok : false;
            if (purchase.ok) savePoints();
            return { purchase, equipped };
        });
        let notice: string;
        const purchase = result.purchase;
        if (purchase.ok) {
            appendAuditEvent("cosmetic_purchased", { userId: interaction.user.id, itemId, price: purchase.price });
            notice = `✅ Purchased ${result.equipped ? "and equipped " : ""}**${purchase.item.name}** for ${purchase.price.toLocaleString()} FN Token$.`
                + (result.equipped ? "" : " Your badge showcase is full — swap one out below.");
        } else if (purchase.reason === "funds") {
            notice = `❌ You need ${purchase.price?.toLocaleString()} FN Token$ for that.`;
        } else if (purchase.reason === "owned") {
            notice = "You already own that cosmetic.";
        } else {
            notice = "That cosmetic is no longer available.";
        }
        await interaction.update(buildShopReply(interaction.user.id, kind, notice));
        return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PROFILE_IDS.equip}:`)) {
        const kind = kindFrom(interaction.customId, PROFILE_IDS.equip);
        if (!kind) return true;
        const user = ensureUser(interaction.user.id);
        const result = equipCosmetic(user.cosmetics, interaction.values[0]);
        if (result.ok) savePoints();
        await interaction.update(buildShopReply(interaction.user.id, kind, result.ok ? `✅ ${result.message}` : `❌ ${result.message}`));
        return true;
    }
    return true;
}
