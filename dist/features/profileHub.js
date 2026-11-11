"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROFILE_IDS = exports.PROFILE_PAGES = void 0;
exports.getThemeColor = getThemeColor;
exports.formatShowcase = formatShowcase;
exports.buildProfileEmbed = buildProfileEmbed;
exports.buildProfileComponents = buildProfileComponents;
exports.buildShopPayload = buildShopPayload;
const discord_js_1 = require("discord.js");
const cosmetics_1 = require("../game/cosmetics");
exports.PROFILE_PAGES = {
    overview: { label: "Overview", emoji: "🪪", description: "Identity, theme, title, and showcase" },
    progression: { label: "Progression", emoji: "📊", description: "XP, levels, roles, and PMC progress" },
    achievements: { label: "Achievements", emoji: "🏆", description: "Earned awards and next targets" },
    collections: { label: "Collections", emoji: "🎒", description: "Cosmetics, crates, boss hearts, player card" },
    activity: { label: "Activity", emoji: "⏱️", description: "Voice, streaks, raids, and games" },
    preferences: { label: "Preferences", emoji: "⚙️", description: "Notifications and profile visibility" }
};
exports.PROFILE_IDS = {
    page: "profile:page",
    shop: "profile:shop",
    shopKind: "profile:shopkind",
    buy: "profile:buy",
    equip: "profile:equip",
    pref: "profile:pref"
};
const rel = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
function getThemeColor(state) {
    return (0, cosmetics_1.getCosmetic)(state.themeId)?.color ?? 0x9b59b6;
}
function formatShowcase(state) {
    const badges = state.badgeIds.map(id => (0, cosmetics_1.getCosmetic)(id)).filter(Boolean).map(item => `${item.emoji} ${item.name}`);
    return badges.length ? badges.join("  •  ") : "No badges showcased";
}
function header(snapshot, page) {
    const title = (0, cosmetics_1.getCosmetic)(snapshot.cosmetics.titleId);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(getThemeColor(snapshot.cosmetics))
        .setAuthor({ name: `${snapshot.username}${title ? ` • ${title.text}` : ""}`, ...(snapshot.avatarUrl ? { iconURL: snapshot.avatarUrl } : {}) })
        .setTitle(`${exports.PROFILE_PAGES[page].emoji} FNTCORD Profile • ${exports.PROFILE_PAGES[page].label}`)
        .setFooter({ text: `FNTCORD • ${(0, cosmetics_1.getCosmetic)(snapshot.cosmetics.themeId)?.name || "FNT Signature Purple"} • Bot-tracked / Arena self-reported` })
        .setTimestamp();
    if (snapshot.avatarUrl)
        embed.setThumbnail(snapshot.avatarUrl);
    return embed;
}
function buildProfileEmbed(snapshot, page, progressionEmbed) {
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
            ].join("\n")).addFields({ name: "Engagement", value: `Level **${snapshot.level}** • **${snapshot.xp.toLocaleString()} XP**\n${snapshot.xpBar}\nRole: **${snapshot.xpRole}**`, inline: false }, { name: "Voice", value: snapshot.inVoice ? `In VC • **${snapshot.voiceMultiplier}x XP**` : "Not in VC • 1x", inline: true }, { name: "FN Token$", value: `Wallet **${snapshot.fnTokens.toLocaleString()}**\nBank **${snapshot.bankTokens.toLocaleString()}**`, inline: true }, { name: "PMC", value: `Level **${snapshot.pmcLevel}** • ${snapshot.pmcRaids} raids`, inline: true }, {
                name: "Arena Rating",
                value: snapshot.checkpoint && snapshot.preferences.showCheckpointRating
                    ? `**${snapshot.checkpoint.rating}/100** • ${snapshot.checkpoint.tier} • Self-reported${snapshot.checkpoint.url ? ` • [Card](${snapshot.checkpoint.url})` : ""}`
                    : snapshot.checkpoint ? "Hidden by player" : "No card yet",
                inline: true
            }, { name: "Prestige", value: snapshot.prestigeLabel, inline: true }, { name: "Achievement Title", value: snapshot.achievementTitle || "None equipped", inline: true });
            break;
        case "achievements":
            embed.addFields({ name: `XP Awards (${snapshot.xpAchievements.earned.length}/${snapshot.xpAchievements.total})`, value: snapshot.xpAchievements.earned.slice(-8).join("\n") || "None yet", inline: true }, { name: `Voice Awards (${snapshot.voiceAchievements.earned.length}/${snapshot.voiceAchievements.total})`, value: snapshot.voiceAchievements.earned.slice(-8).join("\n") || "None yet", inline: true }, { name: "Next Targets", value: [snapshot.xpAchievements.next, snapshot.voiceAchievements.next].filter(Boolean).join("\n") || "Every tracked award earned", inline: false }, { name: "Recent", value: snapshot.recentAchievements.slice(-5).reverse().join("\n") || "No achievements yet", inline: false });
            break;
        case "collections": {
            const owned = (kind) => cosmetics_1.COSMETICS.filter(item => item.kind === kind && snapshot.cosmetics.owned.includes(item.id));
            const total = (kind) => cosmetics_1.COSMETICS.filter(item => item.kind === kind).length;
            embed.addFields({ name: `Themes (${owned("theme").length}/${total("theme")})`, value: owned("theme").map(item => `${item.id === snapshot.cosmetics.themeId ? "▶ " : ""}${item.name}`).join("\n"), inline: true }, { name: `Titles (${owned("title").length}/${total("title")})`, value: owned("title").map(item => `${item.id === snapshot.cosmetics.titleId ? "▶ " : ""}${item.name}`).join("\n") || "None", inline: true }, { name: `Badges (${owned("badge").length}/${total("badge")})`, value: owned("badge").map(item => `${item.emoji} ${item.name}${snapshot.cosmetics.badgeIds.includes(item.id) ? " ★" : ""}`).join("\n") || "None", inline: true }, {
                name: "Latest XP Crate",
                value: snapshot.latestCrate
                    ? `**${snapshot.latestCrate.name}** • +${snapshot.latestCrate.xp.toLocaleString()} XP • ${rel(snapshot.latestCrate.claimedAt)}`
                    : "No crate opened yet",
                inline: false
            }, { name: "Next Crate", value: snapshot.nextCrateAt && snapshot.nextCrateAt > Date.now() ? rel(snapshot.nextCrateAt) : "Ready now", inline: true }, { name: `Boss Hearts (${snapshot.bossHearts.length})`, value: snapshot.bossHearts.slice(0, 10).join(", ") || "None", inline: true }, {
                name: "Arena Player Card",
                value: snapshot.checkpoint && snapshot.preferences.showCheckpointRating
                    ? `**${snapshot.checkpoint.rating}/100** ${snapshot.checkpoint.tier} / Self-reported${snapshot.checkpoint.url ? `\n[Open card](${snapshot.checkpoint.url})` : ""}`
                    : snapshot.checkpoint ? "Hidden by player" : "Not created",
                inline: true
            });
            break;
        }
        case "activity":
            embed.addFields({ name: "Voice", value: `Tracked: **${snapshot.voiceTime}**\nNow: ${snapshot.inVoice ? `**${snapshot.voiceMultiplier}x** live` : "Offline"}`, inline: true }, { name: "Streaks", value: `Daily: **${snapshot.dailyStreak}**\nLast XP: ${snapshot.lastXpAt ? rel(snapshot.lastXpAt) : "Never"}`, inline: true }, { name: "Raids", value: `Raids **${snapshot.pmcRaids}** • Wins **${snapshot.pmcRaidWins}**\nBoss kills **${snapshot.pmcBossKills}** • PMC XP **${snapshot.pmcXp.toLocaleString()}**`, inline: false }, { name: "Games", value: `Sessions **${snapshot.games.played}** • W/L **${snapshot.games.wins}/${snapshot.games.losses}**\nNet **${snapshot.games.net >= 0 ? "+" : ""}${snapshot.games.net.toLocaleString()}** FN Token$`, inline: false });
            break;
        case "preferences":
            embed.setDescription("Only you can change these. Changes apply instantly.").addFields({ name: "2x Voice XP DM", value: snapshot.preferences.doubleXpDm ? "✅ On" : "❌ Off", inline: true }, { name: "Show Arena Rating", value: snapshot.preferences.showCheckpointRating ? "✅ On" : "❌ Off", inline: true });
            break;
        default:
            break;
    }
    return embed.toJSON();
}
function buildProfileComponents(snapshot, page, viewerId) {
    const rows = [
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(`${exports.PROFILE_IDS.page}:${snapshot.userId}`)
            .setPlaceholder("Profile section")
            .addOptions(Object.entries(exports.PROFILE_PAGES).map(([key, value]) => ({
            label: value.label, value: key, emoji: value.emoji, description: value.description, default: key === page
        })))).toJSON()
    ];
    if (page === "preferences" && viewerId === snapshot.userId) {
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.PROFILE_IDS.pref}:doubleXpDm:${snapshot.userId}`).setLabel(`2x DM: ${snapshot.preferences.doubleXpDm ? "On" : "Off"}`)
            .setStyle(snapshot.preferences.doubleXpDm ? discord_js_1.ButtonStyle.Success : discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.PROFILE_IDS.pref}:showCheckpointRating:${snapshot.userId}`).setLabel(`Arena rating: ${snapshot.preferences.showCheckpointRating ? "Shown" : "Hidden"}`)
            .setStyle(snapshot.preferences.showCheckpointRating ? discord_js_1.ButtonStyle.Success : discord_js_1.ButtonStyle.Secondary)).toJSON());
    }
    if ((page === "overview" || page === "collections") && snapshot.cosmeticShopEnabled) {
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.PROFILE_IDS.shop).setLabel("Cosmetic Shop").setEmoji("🛍️").setStyle(discord_js_1.ButtonStyle.Primary)).toJSON());
    }
    return rows;
}
const KIND_LABEL = { theme: "Themes", title: "Titles", badge: "Badges" };
/** Ephemeral shop view for the clicking member; purchases are cosmetic only. */
function buildShopPayload(state, fnTokens, kind, multiplier) {
    const items = cosmetics_1.COSMETICS.filter(item => item.kind === kind);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(getThemeColor(state))
        .setTitle(`🛍️ FNTCORD Cosmetic Shop • ${KIND_LABEL[kind]}`)
        .setDescription([
        "Cosmetic only — no XP, raid, or game advantage.",
        `Wallet: **${fnTokens.toLocaleString()} FN Token$**`,
        kind === "badge" ? `Showcase up to **${cosmetics_1.MAX_SHOWCASE_BADGES}** badges on your profile.` : ""
    ].filter(Boolean).join("\n"))
        .addFields({
        name: KIND_LABEL[kind],
        value: items.map(item => {
            const owned = state.owned.includes(item.id);
            const equipped = item.id === state.themeId || item.id === state.titleId || state.badgeIds.includes(item.id);
            const price = (0, cosmetics_1.getCosmeticPrice)(item, multiplier);
            return `${item.emoji ? `${item.emoji} ` : ""}**${item.name}** — ${owned ? (equipped ? "✅ Equipped" : "Owned") : `${price.toLocaleString()} FN Token$`}\n-# ${item.description}`;
        }).join("\n").slice(0, 1024)
    });
    const buyable = items.filter(item => !state.owned.includes(item.id));
    const owned = items.filter(item => state.owned.includes(item.id));
    const rows = [
        new discord_js_1.ActionRowBuilder().addComponents(Object.keys(KIND_LABEL).map(key => new discord_js_1.ButtonBuilder().setCustomId(`${exports.PROFILE_IDS.shopKind}:${key}`).setLabel(KIND_LABEL[key])
            .setStyle(key === kind ? discord_js_1.ButtonStyle.Primary : discord_js_1.ButtonStyle.Secondary))).toJSON()
    ];
    if (buyable.length) {
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(`${exports.PROFILE_IDS.buy}:${kind}`).setPlaceholder("Buy a cosmetic")
            .addOptions(buyable.map(item => ({
            label: `${item.name} — ${(0, cosmetics_1.getCosmeticPrice)(item, multiplier).toLocaleString()}`.slice(0, 100),
            value: item.id, description: item.description.slice(0, 100), ...(item.emoji ? { emoji: item.emoji } : {})
        })))).toJSON());
    }
    if (owned.length) {
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(`${exports.PROFILE_IDS.equip}:${kind}`)
            .setPlaceholder(kind === "badge" ? "Add/remove a showcased badge" : kind === "title" ? "Equip or remove a title" : "Equip a theme")
            .addOptions(owned.map(item => ({ label: item.name, value: item.id, ...(item.emoji ? { emoji: item.emoji } : {}) })))).toJSON());
    }
    return { embeds: [embed.toJSON()], components: rows };
}
