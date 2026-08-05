import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import { getLeaderboard } from "./game/raid";
import { ensureUser } from "./utils";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000; // You can change this to your desired port

app.use(express.static(path.join(__dirname, "../public")));
app.use(express.json());

app.get("/api/user/:id", (req, res) => {
    const userId = req.params.id;
    ensureUser(userId);
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
    res.json(getLeaderboard());
});

app.get("/api/server", (req, res) => {
    const totalXP = Object.values(points).reduce((sum, user) => sum + (user.xp || 0), 0);
    const totalPrestige = Object.values(points).reduce((sum, user) => sum + (user.prestige || 0), 0);
    res.json({ users: Object.keys(points).length, totalXP, totalPrestige });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});