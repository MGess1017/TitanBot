"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOICE_ACHIEVEMENTS = exports.XP_ACHIEVEMENTS = void 0;
exports.getNewProgressAchievements = getNewProgressAchievements;
exports.XP_ACHIEVEMENTS = [
    { id: "xp_100", title: "First Signal", description: "Earn 100 engagement XP.", threshold: 100 },
    { id: "xp_500", title: "Comms Cadet", description: "Earn 500 engagement XP.", threshold: 500 },
    { id: "xp_1000", title: "Regular Transmitter", description: "Earn 1,000 engagement XP.", threshold: 1000 },
    { id: "xp_5000", title: "Signal Specialist", description: "Earn 5,000 engagement XP.", threshold: 5000 },
    { id: "xp_10000", title: "Field Voice", description: "Earn 10,000 engagement XP.", threshold: 10000 },
    { id: "xp_25000", title: "Rising Operator", description: "Earn 25,000 engagement XP.", threshold: 25000 },
    { id: "xp_50000", title: "Known Operator", description: "Earn 50,000 engagement XP.", threshold: 50000 },
    { id: "xp_100000", title: "Field Veteran", description: "Earn 100,000 engagement XP.", threshold: 100000 },
    { id: "xp_150000", title: "Trusted Scout", description: "Earn 150,000 engagement XP.", threshold: 150000 },
    { id: "xp_250000", title: "Elite Recruit", description: "Earn 250,000 engagement XP.", threshold: 250000 },
    { id: "xp_360000", title: "Recruit I", description: "Earn 360,000 engagement XP.", threshold: 360000 },
    { id: "xp_500000", title: "Vanguard", description: "Earn 500,000 engagement XP.", threshold: 500000 },
    { id: "xp_750000", title: "Ranger", description: "Earn 750,000 engagement XP.", threshold: 750000 },
    { id: "xp_1000000", title: "One Million", description: "Earn 1,000,000 engagement XP.", threshold: 1000000 },
    { id: "xp_1500000", title: "Striker", description: "Earn 1,500,000 engagement XP.", threshold: 1500000 },
    { id: "xp_2000000", title: "Sentinel", description: "Earn 2,000,000 engagement XP.", threshold: 2000000 },
    { id: "xp_2520000", title: "Titan Commander", description: "Earn 2,520,000 engagement XP.", threshold: 2520000 },
    { id: "xp_3000000", title: "First Contact", description: "Earn 3,000,000 engagement XP.", threshold: 3000000 },
    { id: "xp_5000000", title: "Apex Operator", description: "Earn 5,000,000 engagement XP.", threshold: 5000000 },
    { id: "xp_7000000", title: "Warden", description: "Earn 7,000,000 engagement XP.", threshold: 7000000 },
    { id: "xp_11000000", title: "Mythic", description: "Earn 11,000,000 engagement XP.", threshold: 11000000 },
    { id: "xp_15000000", title: "Ascendant", description: "Earn 15,000,000 engagement XP.", threshold: 15000000 },
    { id: "xp_19000000", title: "Pathfinder", description: "Earn 19,000,000 engagement XP.", threshold: 19000000 },
    { id: "xp_23000000", title: "Overlord", description: "Earn 23,000,000 engagement XP.", threshold: 23000000 },
    { id: "xp_27000000", title: "Rift Walker", description: "Earn 27,000,000 engagement XP.", threshold: 27000000 },
    { id: "xp_31000000", title: "Void Legionnaire", description: "Earn 31,000,000 engagement XP.", threshold: 31000000 },
    { id: "xp_35000000", title: "Eclipse Champion", description: "Earn 35,000,000 engagement XP.", threshold: 35000000 },
    { id: "xp_39000000", title: "Starbreaker", description: "Earn 39,000,000 engagement XP.", threshold: 39000000 },
    { id: "xp_44000000", title: "Legendary Titan", description: "Earn 44,000,000 engagement XP.", threshold: 44000000 },
    { id: "xp_50000000", title: "FNT Immortal", description: "Reach the 50,000,000 XP progression cap.", threshold: 50000000 }
];
exports.VOICE_ACHIEVEMENTS = [
    { id: "voice_15m", title: "Mic Check", description: "Spend 15 minutes connected to voice.", threshold: 15 },
    { id: "voice_1h", title: "First Briefing", description: "Spend 1 hour connected to voice.", threshold: 60 },
    { id: "voice_3h", title: "Squadmate", description: "Spend 3 hours connected to voice.", threshold: 180 },
    { id: "voice_6h", title: "Comms Regular", description: "Spend 6 hours connected to voice.", threshold: 360 },
    { id: "voice_12h", title: "Night Watch", description: "Spend 12 hours connected to voice.", threshold: 720 },
    { id: "voice_25h", title: "Radio Operator", description: "Spend 25 hours connected to voice.", threshold: 1500 },
    { id: "voice_50h", title: "Squad Leader", description: "Spend 50 hours connected to voice.", threshold: 3000 },
    { id: "voice_100h", title: "Signal Commander", description: "Spend 100 hours connected to voice.", threshold: 6000 },
    { id: "voice_200h", title: "Voice Veteran", description: "Spend 200 hours connected to voice.", threshold: 12000 },
    { id: "voice_25000m", title: "Always On Comms", description: "Spend 25,000 minutes connected to voice.", threshold: 25000 }
];
function getNewProgressAchievements(xp, voiceMinutes, earnedIds) {
    const earned = new Set(earnedIds);
    return [
        ...exports.XP_ACHIEVEMENTS.filter(achievement => xp >= achievement.threshold && !earned.has(achievement.id)),
        ...exports.VOICE_ACHIEVEMENTS.filter(achievement => voiceMinutes >= achievement.threshold && !earned.has(achievement.id))
    ];
}
