"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROGRESSION_CARD_HEIGHT = exports.PROGRESSION_CARD_WIDTH = void 0;
exports.renderProgressionCard = renderProgressionCard;
const node_path_1 = __importDefault(require("node:path"));
const canvas_1 = require("@napi-rs/canvas");
const ASSETS = node_path_1.default.resolve(__dirname, "..", "..", "assets");
exports.PROGRESSION_CARD_WIDTH = 1100;
exports.PROGRESSION_CARD_HEIGHT = 580;
const backgrounds = new Map();
let fontsReady = false;
async function renderProgressionCard(snapshot) {
    if (!fontsReady) {
        if (!canvas_1.GlobalFonts.registerFromPath(node_path_1.default.join(ASSETS, "fonts", "Rajdhani-Bold.ttf"), "Card Bold")
            || !canvas_1.GlobalFonts.registerFromPath(node_path_1.default.join(ASSETS, "fonts", "Rajdhani-SemiBold.ttf"), "Card Semi")) {
            throw new Error("Profile card fonts could not be loaded.");
        }
        fontsReady = true;
    }
    let background = backgrounds.get(snapshot.kind);
    if (!background) {
        background = (0, canvas_1.loadImage)(node_path_1.default.join(ASSETS, "profile-cards", snapshot.kind === "xp" ? "radio-background.png" : "extraction-background.png"));
        backgrounds.set(snapshot.kind, background);
        background.catch(() => { backgrounds.delete(snapshot.kind); });
    }
    const canvas = (0, canvas_1.createCanvas)(exports.PROGRESSION_CARD_WIDTH, exports.PROGRESSION_CARD_HEIGHT);
    const ctx = canvas.getContext("2d");
    const image = await background;
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    ctx.drawImage(image, (canvas.width - image.width * scale) / 2, (canvas.height - image.height * scale) / 2, image.width * scale, image.height * scale);
    const shade = ctx.createLinearGradient(0, 0, canvas.width, 0);
    shade.addColorStop(0, "rgba(5,10,14,0.65)");
    shade.addColorStop(0.65, "rgba(5,10,14,0.35)");
    shade.addColorStop(1, "rgba(5,10,14,0.05)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const accent = snapshot.kind === "xp" ? "#bda0ff" : "#dfba77";
    const text = (value, x, y, size, color = "#f4f4ef", width = 670) => {
        let fontSize = size;
        ctx.font = `${fontSize}px "Card Bold"`;
        while (ctx.measureText(value).width > width && fontSize > 14) {
            ctx.font = `${--fontSize}px "Card Bold"`;
        }
        ctx.fillStyle = color;
        ctx.fillText(value, x, y, width);
    };
    ctx.fillStyle = accent;
    ctx.fillRect(38, 42, 5, 490);
    text(snapshot.kind === "xp" ? "FNT / ENGAGEMENT" : "FNT / PMC DOSSIER", 65, 75, 24, accent);
    text(snapshot.name, 65, 139, 48);
    text(`LEVEL ${snapshot.level.toLocaleString("en-US")}`, 65, 216, 64);
    text(`PRESTIGE ${snapshot.prestige}`, 65, 253, 24, "#d0d5d4");
    text(`${snapshot.xp.toLocaleString("en-US")} ${snapshot.kind === "xp" ? "SERVER XP" : "RAID XP"}`, 65, 310, 32, accent);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(65, 333, 630, 12);
    ctx.fillStyle = accent;
    ctx.fillRect(65, 333, 630 * Math.max(0, Math.min(1, snapshot.progress)), 12);
    text(snapshot.next, 65, 377, 23, "#d0d5d4", 630);
    for (const [index, stat] of snapshot.stats.slice(0, 3).entries()) {
        const x = 65 + index * 215;
        text(stat.label.toUpperCase(), x, 448, 20, "#b8c0bf", 200);
        text(stat.value, x, 488, 32, "#f4f4ef", 200);
    }
    text("LIVE BOT PROGRESS / REFRESH TO UPDATE", 65, 543, 16, "#9fa8a7");
    return canvas.toBuffer("image/png");
}
