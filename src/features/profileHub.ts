import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
    type APIActionRowComponent, type APIComponentInMessageActionRow, type APIEmbed
} from "discord.js";
import {
    COSMETICS, getCosmetic, getCosmeticPrice, MAX_SHOWCASE_BADGES,
    type CosmeticKind, type CosmeticState, type ProfilePreferences
} from "../game/cosmetics";

export const PROFILE_PAGES = {
    overview: { label: "Overview", emoji: "🪪", description: "Identity, theme, title, and showcase" },
    progression: { label: "Progression", emoji: "📊", description: "XP, levels, roles, and PMC progress" },
    achievements: { label: "Achievements", emoji: "🏆", description: "Earned awards and next targets" },
    collections: { label: "Collections", emoji: "🎒", description: "Cosmetics, crates, boss hearts, player card" },
    activity: { label: "Activity", emoji: "⏱️", description: "Voice, streaks, raids, and games" },
    preferences: { label: "Preferences", emoji: "⚙️", description: "Notifications and profile visibility" }
} as const;
export type ProfilePage = keyof typeof PROFILE_PAGES;

export const PROFILE_IDS = {
    page: "profile:page",
    shop: "profile:shop",
    shopKind: "profile:shopkind",
    buy: "profile:buy",
    equip: "profile:equip",
    pref: "profile:pref"
} as const;

export type ProfileSnapshot = {
    userId: string;
    username: string;
    avatarUrl: string | null;
    cosmetics: CosmeticState;
    preferences: ProfilePreferences;
    xp: number;
    level: number;
    xpBar: string;
    xpRole: string;
    prestigeLabel: string;
    fnTokens: number;
    bankTokens: number;
    pmcLevel: number;
    pmcXp: number;
    pmcRaids: number;
    pmcRaidWins: number;
    pmcBossKills: number;
    voiceMultiplier: 1 | 2;
    inVoice: boolean;
    voiceTime: string;
    dailyStreak: number;
    lastXpAt: number;
    achievementTitle: string | null;
    xpAchievements: { earned: string[]; total: number; next: string | null };
    voiceAchievements: { earned: string[]; total: number; next: string | null };
    recentAchievements: string[];
    latestCrate: { name: string; xp: number; claimedAt: number; color: number } | null;
    nextCrateAt: number | null;
    bossHearts: string[];
    checkpoint: { rating: number; tier: string; url: string | null } | null;
    games: { played: number; wins: number; losses: number; net: number };
    cosmeticShopEnabled: boolean;
    priceMultiplier: number;
};

const rel = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;

export function getThemeColor(state: CosmeticState): number {
    return getCosmetic(state.themeId)?.color ?? 0x9b59b6;
}

export function formatShowcase(state: CosmeticState): string {
    const badges = state.badgeIds.map(id => getCosmetic(id)).filter(Boolean).map(item => `${item!.emoji} ${item!.name}`);
    return badges.length ? badges.join("  •  ") : "No badges showcased";
}

function header(snapshot: ProfileSnapshot, page: ProfilePage): EmbedBuilder {
    const title = getCosmetic(snapshot.cosmetics.titleId);
    const embed = new EmbedBuilder()
        .setColor(getThemeColor(snapshot.cosmetics))
        .setAuthor({ name: `${snapshot.username}${title ? ` • ${title.text}` : ""}`, ...(snapshot.avatarUrl ? { iconURL: snapshot.avatarUrl } : {}) })
        .setTitle(`${PROFILE_PAGES[page].emoji} FNTCORD Profile • ${PROFILE_PAGES[page].label}`)
        .setFooter({ text: `FNTCORD • ${getCosmetic(snapshot.cosmetics.themeId)?.name || "FNT Signature Purple"} • Bot-tracked / Arena self-reported` })
        .setTimestamp();
    if (snapshot.avatarUrl) embed.setThumbnail(snapshot.avatarUrl);
    return embed;
}

export function buildProfileEmbed(snapshot: ProfileSnapshot, page: ProfilePage, progressionEmbed?: APIEmbed): APIEmbed {
    if (page === "progression" && progressionEmbed) {
        const base = header(snapshot, page).toJSON();
        return { ...progressionEmbed, color: base.color, author: base.author, title: base.title, footer: base.footer };
    }
    const embed = header(snapshot, page);
    switch (page) {
        case "overview":
            embed.setDescription([
                `<@${snapshot.userId}>`,
                `**Showcase:** ${formatShowcase(snapshot.cosmetics)}`
            ].join("\n")).addFields(
                { name: "Engagement", value: `Level **${snapshot.level}** • **${snapshot.xp.toLocaleString()} XP**\n${snapshot.xpBar}\nRole: **${snapshot.xpRole}**`, inline: false },
                { name: "Voice", value: snapshot.inVoice ? `In VC • **${snapshot.voiceMultiplier}x XP**` : "Not in VC • 1x", inline: true },
                { name: "FN Token$", value: `Wallet **${snapshot.fnTokens.toLocaleString()}**\nBank **${snapshot.bankTokens.toLocaleString()}**`, inline: true },
                { name: "PMC", value: `Level **${snapshot.pmcLevel}** • ${snapshot.pmcRaids} raids`, inline: true },
                {
                    name: "Arena Rating",
                    value: snapshot.checkpoint && snapshot.preferences.showCheckpointRating
                        ? `**${snapshot.checkpoint.rating}/100** • ${snapshot.checkpoint.tier} • Self-reported${snapshot.checkpoint.url ? ` • [Card](${snapshot.checkpoint.url})` : ""}`
                        : snapshot.checkpoint ? "Hidden by player" : "No card yet",
                    inline: true
                },
                { name: "Prestige", value: snapshot.prestigeLabel, inline: true },
                { name: "Achievement Title", value: snapshot.achievementTitle || "None equipped", inline: true }
            );
            break;
        case "achievements":
            embed.addFields(
                { name: `XP Awards (${snapshot.xpAchievements.earned.length}/${snapshot.xpAchievements.total})`, value: snapshot.xpAchievements.earned.slice(-8).join("\n") || "None yet", inline: true },
                { name: `Voice Awards (${snapshot.voiceAchievements.earned.length}/${snapshot.voiceAchievements.total})`, value: snapshot.voiceAchievements.earned.slice(-8).join("\n") || "None yet", inline: true },
                { name: "Next Targets", value: [snapshot.xpAchievements.next, snapshot.voiceAchievements.next].filter(Boolean).join("\n") || "Every tracked award earned", inline: false },
                { name: "Recent", value: snapshot.recentAchievements.slice(-5).reverse().join("\n") || "No achievements yet", inline: false }
            );
            break;
        case "collections": {
            const owned = (kind: CosmeticKind) => COSMETICS.filter(item => item.kind === kind && snapshot.cosmetics.owned.includes(item.id));
            const total = (kind: CosmeticKind) => COSMETICS.filter(item => item.kind === kind).length;
            embed.addFields(
                { name: `Themes (${owned("theme").length}/${total("theme")})`, value: owned("theme").map(item => `${item.id === snapshot.cosmetics.themeId ? "▶ " : ""}${item.name}`).join("\n"), inline: true },
                { name: `Titles (${owned("title").length}/${total("title")})`, value: owned("title").map(item => `${item.id === snapshot.cosmetics.titleId ? "▶ " : ""}${item.name}`).join("\n") || "None", inline: true },
                { name: `Badges (${owned("badge").length}/${total("badge")})`, value: owned("badge").map(item => `${item.emoji} ${item.name}${snapshot.cosmetics.badgeIds.includes(item.id) ? " ★" : ""}`).join("\n") || "None", inline: true },
                {
                    name: "Latest XP Crate",
                    value: snapshot.latestCrate
                        ? `**${snapshot.latestCrate.name}** • +${snapshot.latestCrate.xp.toLocaleString()} XP • ${rel(snapshot.latestCrate.claimedAt)}`
                        : "No crate opened yet",
                    inline: false
                },
                { name: "Next Crate", value: snapshot.nextCrateAt && snapshot.nextCrateAt > Date.now() ? rel(snapshot.nextCrateAt) : "Ready now", inline: true },
                { name: `Boss Hearts (${snapshot.bossHearts.length})`, value: snapshot.bossHearts.slice(0, 10).join(", ") || "None", inline: true },
                {
                    name: "Arena Player Card",
                    value: snapshot.checkpoint && snapshot.preferences.showCheckpointRating
                        ? `**${snapshot.checkpoint.rating}/100** ${snapshot.checkpoint.tier} / Self-reported${snapshot.checkpoint.url ? `\n[Open card](${snapshot.checkpoint.url})` : ""}`
                        : snapshot.checkpoint ? "Hidden by player" : "Not created",
                    inline: true
                }
            );
            break;
        }
        case "activity":
            embed.addFields(
                { name: "Voice", value: `Tracked: **${snapshot.voiceTime}**\nNow: ${snapshot.inVoice ? `**${snapshot.voiceMultiplier}x** live` : "Offline"}`, inline: true },
                { name: "Streaks", value: `Daily: **${snapshot.dailyStreak}**\nLast XP: ${snapshot.lastXpAt ? rel(snapshot.lastXpAt) : "Never"}`, inline: true },
                { name: "Raids", value: `Raids **${snapshot.pmcRaids}** • Wins **${snapshot.pmcRaidWins}**\nBoss kills **${snapshot.pmcBossKills}** • PMC XP **${snapshot.pmcXp.toLocaleString()}**`, inline: false },
                { name: "Games", value: `Sessions **${snapshot.games.played}** • W/L **${snapshot.games.wins}/${snapshot.games.losses}**\nNet **${snapshot.games.net >= 0 ? "+" : ""}${snapshot.games.net.toLocaleString()}** FN Token$`, inline: false }
            );
            break;
        case "preferences":
            embed.setDescription("Only you can change these. Changes apply instantly.").addFields(
                { name: "2x Voice XP DM", value: snapshot.preferences.doubleXpDm ? "✅ On" : "❌ Off", inline: true },
                { name: "Show Arena Rating", value: snapshot.preferences.showCheckpointRating ? "✅ On" : "❌ Off", inline: true }
            );
            break;
        default:
            break;
    }
    return embed.toJSON();
}

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

export function buildProfileComponents(snapshot: ProfileSnapshot, page: ProfilePage, viewerId: string): Row[] {
    const rows: Row[] = [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`${PROFILE_IDS.page}:${snapshot.userId}`)
            .setPlaceholder("Profile section")
            .addOptions(Object.entries(PROFILE_PAGES).map(([key, value]) => ({
                label: value.label, value: key, emoji: value.emoji, description: value.description, default: key === page
            })))).toJSON()
    ];
    if (page === "preferences" && viewerId === snapshot.userId) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${PROFILE_IDS.pref}:doubleXpDm:${snapshot.userId}`).setLabel(`2x DM: ${snapshot.preferences.doubleXpDm ? "On" : "Off"}`)
                .setStyle(snapshot.preferences.doubleXpDm ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`${PROFILE_IDS.pref}:showCheckpointRating:${snapshot.userId}`).setLabel(`Arena rating: ${snapshot.preferences.showCheckpointRating ? "Shown" : "Hidden"}`)
                .setStyle(snapshot.preferences.showCheckpointRating ? ButtonStyle.Success : ButtonStyle.Secondary)
        ).toJSON());
    }
    if ((page === "overview" || page === "collections") && snapshot.cosmeticShopEnabled) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(PROFILE_IDS.shop).setLabel("Cosmetic Shop").setEmoji("🛍️").setStyle(ButtonStyle.Primary)
        ).toJSON());
    }
    return rows;
}

const KIND_LABEL: Record<CosmeticKind, string> = { theme: "Themes", title: "Titles", badge: "Badges" };

/** Ephemeral shop view for the clicking member; purchases are cosmetic only. */
export function buildShopPayload(state: CosmeticState, fnTokens: number, kind: CosmeticKind, multiplier: number): { embeds: APIEmbed[]; components: Row[] } {
    const items = COSMETICS.filter(item => item.kind === kind);
    const embed = new EmbedBuilder()
        .setColor(getThemeColor(state))
        .setTitle(`🛍️ FNTCORD Cosmetic Shop • ${KIND_LABEL[kind]}`)
        .setDescription([
            "Cosmetic only — no XP, raid, or game advantage.",
            `Wallet: **${fnTokens.toLocaleString()} FN Token$**`,
            kind === "badge" ? `Showcase up to **${MAX_SHOWCASE_BADGES}** badges on your profile.` : ""
        ].filter(Boolean).join("\n"))
        .addFields({
            name: KIND_LABEL[kind],
            value: items.map(item => {
                const owned = state.owned.includes(item.id);
                const equipped = item.id === state.themeId || item.id === state.titleId || state.badgeIds.includes(item.id);
                const price = getCosmeticPrice(item, multiplier);
                return `${item.emoji ? `${item.emoji} ` : ""}**${item.name}** — ${owned ? (equipped ? "✅ Equipped" : "Owned") : `${price.toLocaleString()} FN Token$`}\n-# ${item.description}`;
            }).join("\n").slice(0, 1024)
        });
    const buyable = items.filter(item => !state.owned.includes(item.id));
    const owned = items.filter(item => state.owned.includes(item.id));
    const rows: Row[] = [
        new ActionRowBuilder<ButtonBuilder>().addComponents((Object.keys(KIND_LABEL) as CosmeticKind[]).map(key =>
            new ButtonBuilder().setCustomId(`${PROFILE_IDS.shopKind}:${key}`).setLabel(KIND_LABEL[key])
                .setStyle(key === kind ? ButtonStyle.Primary : ButtonStyle.Secondary))).toJSON()
    ];
    if (buyable.length) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`${PROFILE_IDS.buy}:${kind}`).setPlaceholder("Buy a cosmetic")
            .addOptions(buyable.map(item => ({
                label: `${item.name} — ${getCosmeticPrice(item, multiplier).toLocaleString()}`.slice(0, 100),
                value: item.id, description: item.description.slice(0, 100), ...(item.emoji ? { emoji: item.emoji } : {})
            })))).toJSON());
    }
    if (owned.length) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`${PROFILE_IDS.equip}:${kind}`)
            .setPlaceholder(kind === "badge" ? "Add/remove a showcased badge" : kind === "title" ? "Equip or remove a title" : "Equip a theme")
            .addOptions(owned.map(item => ({ label: item.name, value: item.id, ...(item.emoji ? { emoji: item.emoji } : {}) })))).toJSON());
    }
    return { embeds: [embed.toJSON()], components: rows };
}
