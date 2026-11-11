import { EmbedBuilder, escapeMarkdown } from "discord.js";

export const DEFAULT_RS3_PLAYER = "GzaWizz";
type Quest = { title: string; status: "COMPLETED" | "STARTED" | "NOT_STARTED" };
export type Rs3Profile = {
    name: string;
    questPoints: number;
    maxQuestPoints: number;
    quests: Quest[];
    stats: { combat: number; totalLevel: number; totalXp: number } | null;
    statsNotice: string | null;
    fetchedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function normalizeRs3Name(value: string): string {
    const name = value.trim();
    if (!/^[a-zA-Z0-9 _-]{1,12}$/.test(name)) {
        throw new Error("Enter a RuneScape display name of 1-12 letters, numbers, spaces, underscores or hyphens.");
    }
    return name;
}

export function parseRs3QuestProfile(value: unknown): Omit<Rs3Profile, "stats" | "statsNotice" | "fetchedAt"> {
    if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()
        || !isCount(value.qp) || !isCount(value.qp_max) || !isRecord(value.quests)) {
        throw new Error("Jagex did not return a readable profile. Check the display name and profile privacy.");
    }
    const quests: Quest[] = [];
    for (const quest of Object.values(value.quests)) {
        if (!isRecord(quest) || typeof quest.title !== "string" || !quest.title.trim()
            || (quest.status !== "COMPLETED" && quest.status !== "STARTED" && quest.status !== "NOT_STARTED")) {
            throw new Error("Jagex returned invalid quest data. Please try again later.");
        }
        quests.push({ title: quest.title, status: quest.status });
    }
    return { name: value.name, questPoints: value.qp, maxQuestPoints: value.qp_max, quests };
}

export async function fetchRs3Profile(name: string, request: typeof fetch = fetch): Promise<Rs3Profile> {
    const player = normalizeRs3Name(name);
    const metrics = (async (): Promise<Pick<Rs3Profile, "stats" | "statsNotice">> => {
        try {
            const response = await request(`https://apps.runescape.com/runemetrics/profile/profile?user=${encodeURIComponent(player)}&activities=0`, {
                signal: AbortSignal.timeout(6000)
            });
            if (!response.ok) throw new Error(`RuneMetrics HTTP ${response.status}`);
            const data: unknown = await response.json();
            if (isRecord(data) && (data.error === "PROFILE_PRIVATE" || data.error === 2)) {
                return { stats: null, statsNotice: "RuneMetrics stats are private." };
            }
            if (!isRecord(data) || !isCount(data.combatlevel) || !isCount(data.totalskill) || !isCount(data.totalxp)) {
                throw new Error("RuneMetrics profile stats are unavailable.");
            }
            return { stats: { combat: data.combatlevel, totalLevel: data.totalskill, totalXp: data.totalxp }, statsNotice: null };
        } catch (error) {
            console.warn("[rs3] Optional RuneMetrics lookup failed:", error);
            return { stats: null, statsNotice: "RuneMetrics stats are currently unavailable." };
        }
    })();
    const response = await request(
        `https://secure.runescape.com/m=adventurers-log/api/v1/playerData/${encodeURIComponent(player)}?includeQuests=true`,
        { signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) {
        throw new Error(response.status === 404
            ? "RuneScape player not found. Check the display name."
            : `Jagex profile lookup failed (HTTP ${response.status}). Please try again later.`);
    }
    const profile = parseRs3QuestProfile(await response.json());
    return { ...profile, ...await metrics, fetchedAt: Date.now() };
}

export function buildRs3ProfileEmbed(profile: Rs3Profile): EmbedBuilder {
    const count = (status: Quest["status"]) => profile.quests.filter(quest => quest.status === status).length;
    const embed = new EmbedBuilder()
        .setColor(0x2e8b57)
        .setTitle(`FNTCORD | RuneScape 3 | ${profile.name}`.slice(0, 256))
        .setThumbnail(`https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(profile.name)}/chat.png`)
        .addFields(
            { name: "Quest Points", value: `${profile.questPoints} / ${profile.maxQuestPoints}`, inline: true },
            { name: "Quests", value: `${count("COMPLETED")} complete\n${count("STARTED")} started / ${count("NOT_STARTED")} remaining`, inline: true }
        )
        .setFooter({ text: "FNTCORD / API-SOURCED / Fetched at timestamp; updates may be delayed. Ownership not verified." })
        .setTimestamp(profile.fetchedAt);
    if (profile.stats) embed.addFields({
        name: "Player Stats",
        value: `Combat **${profile.stats.combat}** | Total level **${profile.stats.totalLevel.toLocaleString("en-US")}**\nTotal XP **${profile.stats.totalXp.toLocaleString("en-US")}**`
    });
    if (profile.statsNotice) embed.setDescription(profile.statsNotice);
    const started = profile.quests.filter(quest => quest.status === "STARTED");
    if (started.length) embed.addFields({
        name: "In Progress",
        value: started.slice(0, 3).map(quest => escapeMarkdown(quest.title)).join("\n").slice(0, 1024)
    });
    return embed;
}
