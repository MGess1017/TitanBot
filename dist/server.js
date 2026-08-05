"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const raid_1 = require("./game/raid");
const utils_1 = require("./utils");
const app = (0, express_1.default)();
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
const __dirname = path_1.default.dirname(__filename);
const PORT = 3000; // You can change this to your desired port
app.use(express_1.default.static(path_1.default.join(__dirname, "../public")));
app.use(express_1.default.json());
app.get("/api/user/:id", (req, res) => {
    const userId = req.params.id;
    (0, utils_1.ensureUser)(userId);
    const userData = points[userId];
    res.json({
        id: userId,
        modPoints: userData.modPoints,
        xp: userData.xp,
        level: getXPLevel(userData.xp),
        prestige: userData.prestige,
        dailyStreak: userData.dailyStreak,
        achievements: userData.achievements,
        fnTokens: userData.fnTokens
    });
});
app.get("/api/leaderboard", (req, res) => {
    res.json((0, raid_1.getLeaderboard)());
});
app.get("/api/server", (req, res) => {
    const totalXP = Object.values(points).reduce((sum, user) => sum + (user.xp || 0), 0);
    const totalPrestige = Object.values(points).reduce((sum, user) => sum + (user.prestige || 0), 0);
    res.json({ users: Object.keys(points).length, totalXP, totalPrestige });
});
app.get("/", (req, res) => {
    res.sendFile(path_1.default.join(__dirname, "../public/dashboard.html"));
});
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
