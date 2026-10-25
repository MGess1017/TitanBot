export type ProgressAchievement = {
    id: string;
    title: string;
    description: string;
    threshold: number;
};

export const XP_ACHIEVEMENTS: ProgressAchievement[] = [
    { id: "xp_100", title: "First Signal", description: "Earn 100 engagement XP.", threshold: 100 },
    { id: "xp_500", title: "Comms Cadet", description: "Earn 500 engagement XP.", threshold: 500 },
    { id: "xp_1000", title: "Regular Transmitter", description: "Earn 1,000 engagement XP.", threshold: 1_000 },
    { id: "xp_5000", title: "Signal Specialist", description: "Earn 5,000 engagement XP.", threshold: 5_000 },
    { id: "xp_10000", title: "Field Voice", description: "Earn 10,000 engagement XP.", threshold: 10_000 },
    { id: "xp_25000", title: "Rising Operator", description: "Earn 25,000 engagement XP.", threshold: 25_000 },
    { id: "xp_50000", title: "Known Operator", description: "Earn 50,000 engagement XP.", threshold: 50_000 },
    { id: "xp_100000", title: "Field Veteran", description: "Earn 100,000 engagement XP.", threshold: 100_000 },
    { id: "xp_150000", title: "Trusted Scout", description: "Earn 150,000 engagement XP.", threshold: 150_000 },
    { id: "xp_250000", title: "Elite Recruit", description: "Earn 250,000 engagement XP.", threshold: 250_000 },
    { id: "xp_360000", title: "Recruit I", description: "Earn 360,000 engagement XP.", threshold: 360_000 },
    { id: "xp_500000", title: "Vanguard", description: "Earn 500,000 engagement XP.", threshold: 500_000 },
    { id: "xp_750000", title: "Ranger", description: "Earn 750,000 engagement XP.", threshold: 750_000 },
    { id: "xp_1000000", title: "One Million", description: "Earn 1,000,000 engagement XP.", threshold: 1_000_000 },
    { id: "xp_1500000", title: "Striker", description: "Earn 1,500,000 engagement XP.", threshold: 1_500_000 },
    { id: "xp_2000000", title: "Sentinel", description: "Earn 2,000,000 engagement XP.", threshold: 2_000_000 },
    { id: "xp_2520000", title: "Titan Commander", description: "Earn 2,520,000 engagement XP.", threshold: 2_520_000 },
    { id: "xp_3000000", title: "First Contact", description: "Earn 3,000,000 engagement XP.", threshold: 3_000_000 },
    { id: "xp_5000000", title: "Apex Operator", description: "Earn 5,000,000 engagement XP.", threshold: 5_000_000 },
    { id: "xp_7000000", title: "Warden", description: "Earn 7,000,000 engagement XP.", threshold: 7_000_000 },
    { id: "xp_11000000", title: "Mythic", description: "Earn 11,000,000 engagement XP.", threshold: 11_000_000 },
    { id: "xp_15000000", title: "Ascendant", description: "Earn 15,000,000 engagement XP.", threshold: 15_000_000 },
    { id: "xp_19000000", title: "Pathfinder", description: "Earn 19,000,000 engagement XP.", threshold: 19_000_000 },
    { id: "xp_23000000", title: "Overlord", description: "Earn 23,000,000 engagement XP.", threshold: 23_000_000 },
    { id: "xp_27000000", title: "Rift Walker", description: "Earn 27,000,000 engagement XP.", threshold: 27_000_000 },
    { id: "xp_31000000", title: "Void Legionnaire", description: "Earn 31,000,000 engagement XP.", threshold: 31_000_000 },
    { id: "xp_35000000", title: "Eclipse Champion", description: "Earn 35,000,000 engagement XP.", threshold: 35_000_000 },
    { id: "xp_39000000", title: "Starbreaker", description: "Earn 39,000,000 engagement XP.", threshold: 39_000_000 },
    { id: "xp_44000000", title: "Legendary Titan", description: "Earn 44,000,000 engagement XP.", threshold: 44_000_000 },
    { id: "xp_50000000", title: "FNT Immortal", description: "Reach the 50,000,000 XP progression cap.", threshold: 50_000_000 }
];

export const VOICE_ACHIEVEMENTS: ProgressAchievement[] = [
    { id: "voice_15m", title: "Mic Check", description: "Spend 15 minutes connected to voice.", threshold: 15 },
    { id: "voice_1h", title: "First Briefing", description: "Spend 1 hour connected to voice.", threshold: 60 },
    { id: "voice_3h", title: "Squadmate", description: "Spend 3 hours connected to voice.", threshold: 180 },
    { id: "voice_6h", title: "Comms Regular", description: "Spend 6 hours connected to voice.", threshold: 360 },
    { id: "voice_12h", title: "Night Watch", description: "Spend 12 hours connected to voice.", threshold: 720 },
    { id: "voice_25h", title: "Radio Operator", description: "Spend 25 hours connected to voice.", threshold: 1_500 },
    { id: "voice_50h", title: "Squad Leader", description: "Spend 50 hours connected to voice.", threshold: 3_000 },
    { id: "voice_100h", title: "Signal Commander", description: "Spend 100 hours connected to voice.", threshold: 6_000 },
    { id: "voice_200h", title: "Voice Veteran", description: "Spend 200 hours connected to voice.", threshold: 12_000 },
    { id: "voice_25000m", title: "Always On Comms", description: "Spend 25,000 minutes connected to voice.", threshold: 25_000 }
];

export function getNewProgressAchievements(xp: number, voiceMinutes: number, earnedIds: string[]): ProgressAchievement[] {
    const earned = new Set(earnedIds);
    return [
        ...XP_ACHIEVEMENTS.filter(achievement => xp >= achievement.threshold && !earned.has(achievement.id)),
        ...VOICE_ACHIEVEMENTS.filter(achievement => voiceMinutes >= achievement.threshold && !earned.has(achievement.id))
    ];
}