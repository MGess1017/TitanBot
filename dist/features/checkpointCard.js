"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKPOINT_CARD_FILE = exports.CHECKPOINT_VIEW_ID = exports.CHECKPOINT_MODAL_PREFIX = exports.CHECKPOINT_EDIT_PREFIX = exports.CHECKPOINT_PANEL_TITLE = void 0;
exports.renderCheckpointCard = renderCheckpointCard;
exports.buildCheckpointPanel = buildCheckpointPanel;
exports.buildCheckpointModal = buildCheckpointModal;
exports.describeCheckpointProgress = describeCheckpointProgress;
exports.buildCheckpointBreakdownEmbed = buildCheckpointBreakdownEmbed;
exports.buildCheckpointCardMessage = buildCheckpointCardMessage;
exports.upsertCheckpointPanel = upsertCheckpointPanel;
exports.upsertCheckpointCardMessage = upsertCheckpointCardMessage;
const node_path_1 = __importDefault(require("node:path"));
const canvas_1 = require("@napi-rs/canvas");
const discord_js_1 = require("discord.js");
const checkpointRating_1 = require("../game/checkpointRating");
exports.CHECKPOINT_PANEL_TITLE = "Arena Player Rating";
exports.CHECKPOINT_EDIT_PREFIX = "checkpoint_card:edit:";
exports.CHECKPOINT_MODAL_PREFIX = "checkpoint_card:modal:";
exports.CHECKPOINT_VIEW_ID = "checkpoint_card:view";
exports.CHECKPOINT_CARD_FILE = "pmc-card.png";
const ASSET_ROOT = node_path_1.default.resolve(__dirname, "../../assets");
const CARD_WIDTH = 720;
const CARD_HEIGHT = 1080;
let fontsRegistered = false;
const backgroundCache = new Map();
function registerFonts() {
    if (fontsRegistered)
        return;
    canvas_1.GlobalFonts.registerFromPath(node_path_1.default.join(ASSET_ROOT, "fonts/BebasNeue-Regular.ttf"), "FNT Display");
    canvas_1.GlobalFonts.registerFromPath(node_path_1.default.join(ASSET_ROOT, "fonts/Rajdhani-Bold.ttf"), "FNT Bold");
    canvas_1.GlobalFonts.registerFromPath(node_path_1.default.join(ASSET_ROOT, "fonts/Rajdhani-SemiBold.ttf"), "FNT Semi");
    fontsRegistered = true;
}
function loadBackground(tier) {
    let cached = backgroundCache.get(tier.id);
    if (!cached) {
        cached = (0, canvas_1.loadImage)(node_path_1.default.join(ASSET_ROOT, `checkpoint-cards/${tier.id}.jpg`));
        cached.catch(() => backgroundCache.delete(tier.id));
        backgroundCache.set(tier.id, cached);
    }
    return cached;
}
function seededHue(seed) {
    let hash = 2166136261;
    for (const char of seed)
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return Math.abs(hash) % 360;
}
function fitFont(ctx, text, family, maxSize, maxWidth) {
    let size = maxSize;
    ctx.font = `${size}px "${family}"`;
    while (size > 12 && ctx.measureText(text).width > maxWidth) {
        size -= 2;
        ctx.font = `${size}px "${family}"`;
    }
    return size;
}
async function renderCheckpointCard(input) {
    registerFonts();
    const { rating } = (0, checkpointRating_1.calculateCheckpointRating)(input.stats);
    const tier = (0, checkpointRating_1.getCheckpointTier)(rating);
    const hue = seededHue(input.userId);
    const signature = `hsl(${hue}, 85%, 62%)`;
    const canvas = (0, canvas_1.createCanvas)(CARD_WIDTH, CARD_HEIGHT);
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
    const name = input.username.toUpperCase();
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
    ctx.fillText("FNT ARENA  •  CHECKPOINT", 70, 92);
    ctx.textAlign = "right";
    ctx.font = '40px "FNT Display"';
    const tierWidth = ctx.measureText(tier.name).width + 36;
    ctx.fillStyle = tier.accent;
    ctx.fillRect(CARD_WIDTH - 70 - tierWidth, 60, tierWidth, 46);
    ctx.fillStyle = "#0b0b12";
    ctx.fillText(tier.name, CARD_WIDTH - 88, 98);
    if (input.avatar) {
        try {
            const avatar = await (0, canvas_1.loadImage)(input.avatar);
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
        }
        catch {
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
    const columnWidth = (CARD_WIDTH - 112) / 4;
    checkpointRating_1.CHECKPOINT_STAT_KEYS.forEach((key, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = 56 + columnWidth * column + columnWidth / 2;
        const y = panelTop + 44 + row * 84;
        ctx.fillStyle = "rgba(255,255,255,0.62)";
        ctx.font = '16px "FNT Semi"';
        ctx.fillText(checkpointRating_1.CHECKPOINT_STATS[key].short, x, y);
        const value = (0, checkpointRating_1.formatCheckpointStat)(key, input.stats[key]);
        ctx.fillStyle = "#ffffff";
        fitFont(ctx, value, "FNT Bold", 34, columnWidth - 16);
        ctx.fillText(value, x, y + 38);
    });
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = '17px "FNT Semi"';
    const updated = new Date(input.updatedAt).toISOString().slice(0, 10);
    ctx.fillText(`PLAYER-REPORTED ARENA STATS  •  UPDATED ${updated}  •  #${input.userId.slice(-4)}`, CARD_WIDTH / 2, 1036);
    return { buffer: canvas.toBuffer("image/png"), rating, tier };
}
function buildCheckpointPanel() {
    const sectionButtons = checkpointRating_1.CHECKPOINT_SECTION_IDS.map(id => new discord_js_1.ButtonBuilder()
        .setCustomId(`${exports.CHECKPOINT_EDIT_PREFIX}${id}`)
        .setLabel(checkpointRating_1.CHECKPOINT_SECTIONS[id].title)
        .setStyle(discord_js_1.ButtonStyle.Secondary));
    return {
        embeds: [new discord_js_1.EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle(exports.CHECKPOINT_PANEL_TITLE)
                .setDescription([
                "Enter your **Arena CheckPoint statistics** to generate your FNT PMC player card and **rating out of 100**.",
                "",
                "1. Fill all four sections below (each opens a short form).",
                "2. Your card posts in this channel automatically once every stat is saved.",
                "3. Edit any section at any time; your card and rating update live."
            ].join("\n"))
                .setFooter({ text: "Stats are player-reported. Rating weighs K/D, win rate, headshot rate, MVPs, and consistency." })],
        components: [
            new discord_js_1.ActionRowBuilder().addComponents(sectionButtons),
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.CHECKPOINT_VIEW_ID).setLabel("My Rating Breakdown").setStyle(discord_js_1.ButtonStyle.Primary))
        ],
        allowedMentions: { parse: [] }
    };
}
function buildCheckpointModal(section, stats) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId(`${exports.CHECKPOINT_MODAL_PREFIX}${section}`)
        .setTitle(`CheckPoint Stats: ${checkpointRating_1.CHECKPOINT_SECTIONS[section].title}`);
    for (const key of checkpointRating_1.CHECKPOINT_SECTIONS[section].keys) {
        const input = new discord_js_1.TextInputBuilder()
            .setCustomId(key)
            .setLabel(checkpointRating_1.CHECKPOINT_STATS[key].label)
            .setPlaceholder(checkpointRating_1.CHECKPOINT_STATS[key].placeholder)
            .setStyle(discord_js_1.TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20);
        const current = stats[key];
        if (current !== undefined)
            input.setValue(String(current));
        modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(input));
    }
    return modal;
}
function describeCheckpointProgress(stats) {
    return checkpointRating_1.CHECKPOINT_SECTION_IDS
        .map(id => `${(0, checkpointRating_1.isSectionComplete)(stats, id) ? "✅" : "⬜"} ${checkpointRating_1.CHECKPOINT_SECTIONS[id].title}`)
        .join("\n");
}
function buildCheckpointBreakdownEmbed(stats, cardUrl) {
    const result = (0, checkpointRating_1.calculateCheckpointRating)(stats);
    const tier = (0, checkpointRating_1.getCheckpointTier)(result.rating);
    const lines = result.parts.map(part => `${part.label}: **${part.points}** / ${part.max}`);
    if (result.quitPenalty > 0)
        lines.push(`Quit penalty: **-${result.quitPenalty}**`);
    if (result.sampleFactor < 1)
        lines.push(`Small sample (<50 matches): rating blended toward average`);
    return new discord_js_1.EmbedBuilder()
        .setColor(tier.color)
        .setTitle(`PMC Rating ${result.rating} • ${tier.name}`)
        .setDescription(lines.join("\n") + (cardUrl ? `\n\n[View your card](${cardUrl})` : ""));
}
function buildCheckpointCardMessage(userId, username, rating, tier, buffer) {
    return {
        content: `<@${userId}>`,
        embeds: [new discord_js_1.EmbedBuilder()
                .setColor(tier.color)
                .setTitle(`${username} • PMC Rating ${rating}`)
                .setDescription(`Tier: **${tier.name}**`)
                .setImage(`attachment://${exports.CHECKPOINT_CARD_FILE}`)
                .setTimestamp(new Date())],
        files: [new discord_js_1.AttachmentBuilder(buffer, { name: exports.CHECKPOINT_CARD_FILE })],
        attachments: [],
        allowedMentions: { parse: [] }
    };
}
function isCheckpointPanel(message, botId) {
    return message.author.id === botId && message.embeds[0]?.title === exports.CHECKPOINT_PANEL_TITLE;
}
async function upsertCheckpointPanel(channel, botId, storedId) {
    const payload = buildCheckpointPanel();
    if (storedId) {
        try {
            const message = await channel.messages.fetch(storedId);
            if (isCheckpointPanel(message, botId)) {
                await message.edit(payload);
                return message.id;
            }
        }
        catch (error) {
            if (!(error instanceof discord_js_1.DiscordAPIError && error.code === 10008))
                throw error;
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
async function upsertCheckpointCardMessage(channel, storedId, payload) {
    if (storedId) {
        try {
            const message = await channel.messages.fetch(storedId);
            return await message.edit(payload);
        }
        catch (error) {
            if (!(error instanceof discord_js_1.DiscordAPIError && error.code === 10008))
                throw error;
        }
    }
    const { attachments: _ignored, ...createPayload } = payload;
    return channel.send(createPayload);
}
