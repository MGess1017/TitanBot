"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RS3_PLAYER = void 0;
exports.normalizeRs3Name = normalizeRs3Name;
exports.parseRs3QuestProfile = parseRs3QuestProfile;
exports.fetchRs3Profile = fetchRs3Profile;
exports.buildRs3ProfileEmbed = buildRs3ProfileEmbed;
const discord_js_1 = require("discord.js");
exports.DEFAULT_RS3_PLAYER = "GzaWizz";
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isCount(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function normalizeRs3Name(value) {
    const name = value.trim();
    if (!/^[a-zA-Z0-9 _-]{1,12}$/.test(name)) {
        throw new Error("Enter a RuneScape display name of 1-12 letters, numbers, spaces, underscores or hyphens.");
    }
    return name;
}
function parseRs3QuestProfile(value) {
    if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()
        || !isCount(value.qp) || !isCount(value.qp_max) || !isRecord(value.quests)) {
        throw new Error("Jagex did not return a readable profile. Check the display name and profile privacy.");
    }
    const quests = [];
    for (const quest of Object.values(value.quests)) {
        if (!isRecord(quest) || typeof quest.title !== "string" || !quest.title.trim()
            || (quest.status !== "COMPLETED" && quest.status !== "STARTED" && quest.status !== "NOT_STARTED")) {
            throw new Error("Jagex returned invalid quest data. Please try again later.");
        }
        quests.push({ title: quest.title, status: quest.status });
    }
    return { name: value.name, questPoints: value.qp, maxQuestPoints: value.qp_max, quests };
}
async function fetchRs3Profile(name, request = fetch) {
    const player = normalizeRs3Name(name);
    const metrics = (async () => {
        try {
            const response = await request(`https://apps.runescape.com/runemetrics/profile/profile?user=${encodeURIComponent(player)}&activities=0`, {
                signal: AbortSignal.timeout(6000)
            });
            if (!response.ok)
                throw new Error(`RuneMetrics HTTP ${response.status}`);
            const data = await response.json();
            if (isRecord(data) && (data.error === "PROFILE_PRIVATE" || data.error === 2)) {
                return { stats: null, statsNotice: "RuneMetrics stats are private." };
            }
            if (!isRecord(data) || !isCount(data.combatlevel) || !isCount(data.totalskill) || !isCount(data.totalxp)) {
                throw new Error("RuneMetrics profile stats are unavailable.");
            }
            return { stats: { combat: data.combatlevel, totalLevel: data.totalskill, totalXp: data.totalxp }, statsNotice: null };
        }
        catch (error) {
            console.warn("[rs3] Optional RuneMetrics lookup failed:", error);
            return { stats: null, statsNotice: "RuneMetrics stats are currently unavailable." };
        }
    })();
    const response = await request(`https://secure.runescape.com/m=adventurers-log/api/v1/playerData/${encodeURIComponent(player)}?includeQuests=true`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
        throw new Error(response.status === 404
            ? "RuneScape player not found. Check the display name."
            : `Jagex profile lookup failed (HTTP ${response.status}). Please try again later.`);
    }
    const profile = parseRs3QuestProfile(await response.json());
    return { ...profile, ...await metrics, fetchedAt: Date.now() };
}
function buildRs3ProfileEmbed(profile) {
    const count = (status) => profile.quests.filter(quest => quest.status === status).length;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x2e8b57)
        .setTitle(`FNTCORD | RuneScape 3 | ${profile.name}`.slice(0, 256))
        .setThumbnail(`https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(profile.name)}/chat.png`)
        .addFields({ name: "Quest Points", value: `${profile.questPoints} / ${profile.maxQuestPoints}`, inline: true }, { name: "Quests", value: `${count("COMPLETED")} complete\n${count("STARTED")} started / ${count("NOT_STARTED")} remaining`, inline: true })
        .setFooter({ text: "FNTCORD / API-SOURCED / Fetched at timestamp; updates may be delayed. Ownership not verified." })
        .setTimestamp(profile.fetchedAt);
    if (profile.stats)
        embed.addFields({
            name: "Player Stats",
            value: `Combat **${profile.stats.combat}** | Total level **${profile.stats.totalLevel.toLocaleString("en-US")}**\nTotal XP **${profile.stats.totalXp.toLocaleString("en-US")}**`
        });
    if (profile.statsNotice)
        embed.setDescription(profile.statsNotice);
    const started = profile.quests.filter(quest => quest.status === "STARTED");
    if (started.length)
        embed.addFields({
            name: "In Progress",
            value: started.slice(0, 3).map(quest => (0, discord_js_1.escapeMarkdown)(quest.title)).join("\n").slice(0, 1024)
        });
    return embed;
}
