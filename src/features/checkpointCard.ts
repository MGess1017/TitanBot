import path from "node:path";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, DiscordAPIError, EmbedBuilder, escapeMarkdown, ModalBuilder,
    TextInputBuilder, TextInputStyle, type Message, type MessageCreateOptions, type MessageEditOptions, type TextChannel
} from "discord.js";
import {
    calculateCheckpointRating, CHECKPOINT_SECTION_IDS, CHECKPOINT_SECTIONS, CHECKPOINT_STATS,
    formatCheckpointStat, getCheckpointTier, INGAME_NAME_MAX, INGAME_NAME_MIN, isSectionComplete, type CheckpointProfile, type CheckpointSectionId,
    type CheckpointStatKey, type CheckpointStats, type CheckpointTier
} from "../game/checkpointRating";
import { type InquiryPayload } from "./inquiryPanel";

export const CHECKPOINT_PANEL_TITLE = "FNTCORD | Arena Player Cards";
export const CHECKPOINT_LEGACY_PANEL_TITLE = "Arena Player Rating";
export const CHECKPOINT_WORKSPACE_ID = "checkpoint_card:workspace";
export const CHECKPOINT_REFRESH_ID = "checkpoint_card:refresh";
export const CHECKPOINT_RETRY_ID = "checkpoint_card:retry";
export const CHECKPOINT_EDIT_PREFIX = "checkpoint_card:edit:";
export const CHECKPOINT_MODAL_PREFIX = "checkpoint_card:modal:";
export const CHECKPOINT_VIEW_ID = "checkpoint_card:view";
export const CHECKPOINT_NAME_ID = "checkpoint_card:name";
export const CHECKPOINT_NAME_MODAL_ID = "checkpoint_card:name_modal";
export const CHECKPOINT_NAME_INPUT_ID = "ingameName";
export const CHECKPOINT_CARD_FILE = "pmc-card.png";

const ASSET_ROOT = path.resolve(__dirname, "../../assets");
const CARD_WIDTH = 720;
const CARD_HEIGHT = 1080;
let fontsRegistered = false;
const backgroundCache = new Map<string, Promise<Image>>();

function registerFonts(): void {
    if (fontsRegistered) return;
    GlobalFonts.registerFromPath(path.join(ASSET_ROOT, "fonts/BebasNeue-Regular.ttf"), "FNT Display");
    GlobalFonts.registerFromPath(path.join(ASSET_ROOT, "fonts/Rajdhani-Bold.ttf"), "FNT Bold");
    GlobalFonts.registerFromPath(path.join(ASSET_ROOT, "fonts/Rajdhani-SemiBold.ttf"), "FNT Semi");
    fontsRegistered = true;
}

function loadBackground(tier: CheckpointTier): Promise<Image> {
    let cached = backgroundCache.get(tier.id);
    if (!cached) {
        cached = loadImage(path.join(ASSET_ROOT, `checkpoint-cards/${tier.id}.jpg`));
        cached.catch(() => backgroundCache.delete(tier.id));
        backgroundCache.set(tier.id, cached);
    }
    return cached;
}

function seededHue(seed: string): number {
    let hash = 2166136261;
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return Math.abs(hash) % 360;
}

function fitFont(ctx: SKRSContext2D, text: string, family: string, maxSize: number, maxWidth: number): number {
    let size = maxSize;
    ctx.font = `${size}px "${family}"`;
    while (size > 12 && ctx.measureText(text).width > maxWidth) {
        size -= 2;
        ctx.font = `${size}px "${family}"`;
    }
    return size;
}

export type CheckpointCardInput = {
    userId: string;
    ingameName: string;
    stats: Record<CheckpointStatKey, number>;
    updatedAt: number;
    avatar?: Buffer | null;
};

export async function renderCheckpointCard(input: CheckpointCardInput): Promise<{ buffer: Buffer; rating: number; tier: CheckpointTier }> {
    registerFonts();
    const { rating } = calculateCheckpointRating(input.stats);
    const tier = getCheckpointTier(rating);
    const hue = seededHue(input.userId);
    const signature = `hsl(${hue}, 85%, 62%)`;
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(await loadBackground(tier), 0, 0, CARD_WIDTH, CARD_HEIGHT);
    const shade = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
    shade.addColorStop(0, "rgba(5,5,12,0.35)");
    shade.addColorStop(0.45, "rgba(5,5,12,0.55)");
    shade.addColorStop(1, "rgba(5,5,12,0.85)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Player-unique signature stripes keep two same-tier cards visually distinct.
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = signature;
    ctx.lineWidth = 14;
    for (let i = 0; i < 5; i += 1) {
        const offset = (hue % 90) + i * 46;
        ctx.beginPath();
        ctx.moveTo(-100 + offset, CARD_HEIGHT);
        ctx.lineTo(420 + offset, 0);
        ctx.stroke();
    }
    ctx.restore();

    const name = input.ingameName.toUpperCase();
    ctx.save();
    ctx.translate(CARD_WIDTH / 2, 420);
    ctx.rotate(-0.12);
    fitFont(ctx, name, "FNT Display", 240, 680);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.17;
    ctx.fillStyle = tier.accent;
    ctx.fillText(name, 0, 0);
    ctx.restore();

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = '24px "FNT Bold"';
    ctx.fillText("FNTCORD ARENA  •  CHECKPOINT", 70, 92);

    ctx.textAlign = "right";
    ctx.font = '40px "FNT Display"';
    const tierWidth = ctx.measureText(tier.name).width + 36;
    ctx.fillStyle = tier.accent;
    ctx.fillRect(CARD_WIDTH - 70 - tierWidth, 60, tierWidth, 46);
    ctx.fillStyle = "#0b0b12";
    ctx.fillText(tier.name, CARD_WIDTH - 88, 98);

    if (input.avatar) {
        try {
            const avatar = await loadImage(input.avatar);
            ctx.save();
            ctx.beginPath();
            ctx.arc(110, 180, 44, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, 66, 136, 88, 88);
            ctx.restore();
            ctx.strokeStyle = tier.accent;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(110, 180, 46, 0, Math.PI * 2);
            ctx.stroke();
        } catch {
            // Avatar art is optional; the card still renders without it.
        }
    }

    ctx.textAlign = "center";
    ctx.shadowColor = tier.accent;
    ctx.shadowBlur = 40;
    ctx.fillStyle = "#ffffff";
    ctx.font = '250px "FNT Display"';
    ctx.fillText(String(rating), CARD_WIDTH / 2, 470);
    ctx.shadowBlur = 0;
    ctx.fillStyle = tier.accent;
    ctx.font = '34px "FNT Display"';
    ctx.fillText("PMC RATING  /  100", CARD_WIDTH / 2, 512);

    fitFont(ctx, name, "FNT Display", 78, 580);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 12;
    ctx.fillText(name, CARD_WIDTH / 2, 600);
    ctx.shadowBlur = 0;
    ctx.fillStyle = signature;
    ctx.fillRect(CARD_WIDTH / 2 - 90, 618, 180, 4);

    const panelTop = 648;
    ctx.fillStyle = "rgba(8,8,16,0.78)";
    ctx.fillRect(56, panelTop, CARD_WIDTH - 112, 352);
    ctx.strokeStyle = tier.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(56, panelTop, CARD_WIDTH - 112, 352);

    const columnWidth = (CARD_WIDTH - 112) / 3;
    (["kd", "winRate", "matchesPlayed"] as const).forEach((key, index) => {
        const column = index;
        const x = 56 + columnWidth * column + columnWidth / 2;
        const y = panelTop + 128;
        ctx.fillStyle = "rgba(255,255,255,0.62)";
        ctx.font = '16px "FNT Semi"';
        ctx.fillText(CHECKPOINT_STATS[key].short, x, y);
        const value = formatCheckpointStat(key, input.stats[key]);
        ctx.fillStyle = "#ffffff";
        fitFont(ctx, value, "FNT Bold", 34, columnWidth - 16);
        ctx.fillText(value, x, y + 50);
    });
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = '20px "FNT Semi"';
    ctx.fillText("FULL BREAKDOWN IN YOUR PRIVATE WORKSPACE", CARD_WIDTH / 2, panelTop + 280);

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = '17px "FNT Semi"';
    const updated = new Date(input.updatedAt).toISOString().slice(0, 10);
    ctx.fillText(`PLAYER-REPORTED ARENA STATS  •  UPDATED ${updated}  •  #${input.userId.slice(-4)}`, CARD_WIDTH / 2, 1036);

    return { buffer: canvas.toBuffer("image/png"), rating, tier };
}

export function buildCheckpointPanel() {
    return {
        embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(CHECKPOINT_PANEL_TITLE)
            .setDescription("Create and manage your Arena player card. Setup, editing and detailed stats open privately.")
            .setFooter({ text: "FNTCORD / SELF-REPORTED ARENA STATS" })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(CHECKPOINT_WORKSPACE_ID).setLabel("My Player Card").setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: { parse: [] }
    } satisfies MessageCreateOptions & MessageEditOptions;
}

export function buildCheckpointWorkspace(profile: CheckpointProfile | null | undefined, visibility: "public" | "private"): InquiryPayload {
    const stats = profile?.stats || {};
    const complete = Boolean(profile?.ingameName) && CHECKPOINT_SECTION_IDS.every(id => isSectionComplete(stats, id));
    const sectionButtons = CHECKPOINT_SECTION_IDS.map(id => new ButtonBuilder()
        .setCustomId(`${CHECKPOINT_EDIT_PREFIX}${id}`)
        .setLabel(CHECKPOINT_SECTIONS[id].title)
        .setStyle(ButtonStyle.Secondary));
    const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle("FNTCORD | My Arena Card")
            .setDescription(describeCheckpointProgress(stats, profile?.ingameName || null))
            .addFields({ name: "Visibility", value: visibility === "private" ? "Private / Preview only" : "Public / Updates in the player-card channel" })
            .setFooter({ text: "FNTCORD / SELF-REPORTED / STATS UPDATED AT TIMESTAMP" });
    if (profile?.updatedAt) embed.setTimestamp(profile.updatedAt);
    return {
        embed: embed.toJSON(),
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(sectionButtons).toJSON(),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(CHECKPOINT_NAME_ID).setLabel("Edit Profile").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(CHECKPOINT_REFRESH_ID).setLabel("Refresh Card").setStyle(ButtonStyle.Primary).setDisabled(!complete),
                new ButtonBuilder().setCustomId(CHECKPOINT_RETRY_ID).setLabel("Retry Publish").setStyle(ButtonStyle.Secondary).setDisabled(!complete || visibility === "private"),
                new ButtonBuilder().setCustomId(CHECKPOINT_VIEW_ID).setLabel("Detailed Breakdown").setStyle(ButtonStyle.Secondary).setDisabled(!complete)
            ).toJSON()
        ]
    };
}

export function buildCheckpointNameModal(current: string | null): ModalBuilder {
    const input = new TextInputBuilder()
        .setCustomId(CHECKPOINT_NAME_INPUT_ID)
        .setLabel("Tarkov Arena in-game name")
        .setPlaceholder("Exactly as it appears in Arena")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(INGAME_NAME_MIN)
        .setMaxLength(INGAME_NAME_MAX);
    if (current) input.setValue(current);
    return new ModalBuilder()
        .setCustomId(CHECKPOINT_NAME_MODAL_ID)
        .setTitle("Arena In-Game Name")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function buildCheckpointModal(section: CheckpointSectionId, stats: CheckpointStats): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId(`${CHECKPOINT_MODAL_PREFIX}${section}`)
        .setTitle(`CheckPoint Stats: ${CHECKPOINT_SECTIONS[section].title}`);
    for (const key of CHECKPOINT_SECTIONS[section].keys) {
        const input = new TextInputBuilder()
            .setCustomId(key)
            .setLabel(CHECKPOINT_STATS[key].label)
            .setPlaceholder(CHECKPOINT_STATS[key].placeholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20);
        const current = stats[key];
        if (current !== undefined) input.setValue(String(current));
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    }
    return modal;
}

export function describeCheckpointProgress(stats: CheckpointStats, ingameName: string | null): string {
    return [
        `${ingameName ? "✅" : "⬜"} In-Game Name${ingameName ? `: **${escapeMarkdown(ingameName)}**` : ""}`,
        ...CHECKPOINT_SECTION_IDS.map(id => `${isSectionComplete(stats, id) ? "✅" : "⬜"} ${CHECKPOINT_SECTIONS[id].title}`)
    ].join("\n");
}

export function buildCheckpointBreakdownEmbed(stats: Record<CheckpointStatKey, number>, cardUrl: string | null, updatedAt?: number): EmbedBuilder {
    const result = calculateCheckpointRating(stats);
    const tier = getCheckpointTier(result.rating);
    const lines = result.parts.map(part => `${part.label}: **${part.points}** / ${part.max}`);
    if (result.quitPenalty > 0) lines.push(`Quit penalty: **-${result.quitPenalty}**`);
    if (result.sampleFactor < 1) lines.push(`Small sample (<50 matches): rating blended toward average`);
    const embed = new EmbedBuilder()
        .setColor(tier.color)
        .setTitle(`FNTCORD | PMC Rating ${result.rating} • ${tier.name}`)
        .setDescription(lines.join("\n") + (cardUrl ? `\n\n[View your card](${cardUrl})` : ""))
        .addFields(CHECKPOINT_SECTION_IDS.map(id => ({
            name: CHECKPOINT_SECTIONS[id].title,
            value: CHECKPOINT_SECTIONS[id].keys.map(key => `${CHECKPOINT_STATS[key].label}: **${formatCheckpointStat(key, stats[key])}**`).join("\n")
        })))
        .setFooter({ text: "FNTCORD / SELF-REPORTED / NOT GAME-VERIFIED" });
    if (updatedAt) embed.setTimestamp(updatedAt);
    return embed;
}

export function buildCheckpointCardMessage(userId: string, ingameName: string, rating: number, tier: CheckpointTier, buffer: Buffer, updatedAt = Date.now()) {
    return {
        content: `<@${userId}>`,
        embeds: [new EmbedBuilder()
            .setColor(tier.color)
            .setTitle(`${escapeMarkdown(ingameName)} • PMC Rating ${rating}`)
            .setDescription(`Tier: **${tier.name}** / Self-reported stats`)
            .setFooter({ text: "FNTCORD / SELF-REPORTED / STATS UPDATED AT TIMESTAMP" })
            .setImage(`attachment://${CHECKPOINT_CARD_FILE}`)
            .setTimestamp(updatedAt)],
        files: [new AttachmentBuilder(buffer, { name: CHECKPOINT_CARD_FILE })],
        attachments: [],
        allowedMentions: { parse: [] as [] },
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(CHECKPOINT_WORKSPACE_ID).setLabel("My Card Workspace").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(CHECKPOINT_VIEW_ID).setLabel("My Detailed Breakdown").setStyle(ButtonStyle.Secondary)
        )]
    };
}

function isCheckpointPanel(message: Message, botId: string): boolean {
    return message.author.id === botId && [CHECKPOINT_PANEL_TITLE, CHECKPOINT_LEGACY_PANEL_TITLE].includes(message.embeds[0]?.title || "");
}

export async function upsertCheckpointPanel(channel: TextChannel, botId: string, storedId: string | null): Promise<string> {
    const payload = buildCheckpointPanel();
    if (storedId) {
        try {
            const message = await channel.messages.fetch(storedId);
            if (isCheckpointPanel(message, botId)) {
                await message.edit(payload);
                return message.id;
            }
        } catch (error) {
            if (!(error instanceof DiscordAPIError && error.code === 10008)) throw error;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => isCheckpointPanel(message, botId));
    if (existing) {
        await existing.edit(payload);
        return existing.id;
    }
    return (await channel.send(payload)).id;
}

/** Edits the player's existing card message in place, or posts a new one if it was deleted. */
export async function upsertCheckpointCardMessage(
    channel: TextChannel,
    storedId: string | null,
    payload: ReturnType<typeof buildCheckpointCardMessage>
): Promise<Message> {
    if (storedId) {
        try {
            const message = await channel.messages.fetch(storedId);
            return await message.edit(payload);
        } catch (error) {
            if (!(error instanceof DiscordAPIError && error.code === 10008)) throw error;
        }
    }
    const { attachments: _ignored, ...createPayload } = payload;
    return channel.send(createPayload);
}
