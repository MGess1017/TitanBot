// Casino lobby, action buttons, odds, and result formatting.
import { ActionRowBuilder, APIEmbed, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import {
    canAffordTokens, ensureUser, getGameStatsSummary, getCasinoVipTier, type GameStatKey, getTokens
} from "../../utils";
import {
    CASINO_PROFILES, COINFLIP_PAYOUT, DICE_PAYOUTS, buildCasinoBoardSnapshot, getCasinoProfileLine,
    STANDARD_WIN_BONUS_CHANCE
} from "../../game/casinoBalance";
import { MIN_BET } from "../core/config";
import { CASINO_GAME_ORDER, CASINO_UI_IDS, type CasinoActionKind, type CasinoGameKey } from "../ui/ids";
import { chunkLines } from "../ui/embeds";
import { type MagicSlotSymbol } from "./slots";

export function validateCasinoBet(userId: string, bet: number): string | null {
    if (bet < MIN_BET) return `Minimum bet is ${MIN_BET}.`;
    if (!canAffordTokens(userId, bet)) return `You need at least ${bet} FN Token$.`;
    return null;
}

export type CasinoOutcome = "win" | "loss" | "push";

export function formatTokenAmount(value: number): string {
    return `${value} FN Token$`;
}

function formatNetAmount(value: number): string {
    return `${value >= 0 ? `+${value}` : value} FN Token$`;
}

function getCasinoOddsSnapshot(gameKey: Exclude<GameStatKey, "raid">): string {
    const strategy = gameKey === "dice" ? `Exact: ${DICE_PAYOUTS.exact.toFixed(2)}x | Band/parity: ${DICE_PAYOUTS.band.toFixed(2)}x`
        : gameKey === "roulette" ? `American double-zero (38 pockets) | straight 35:1 profit | outside 1:1 | green 17:1`
            : gameKey === "blackjack" ? "Safe lowers bust risk; aggressive increases volatility."
                : gameKey === "crash" ? "Hit chance is 95% divided by your selected target."
                    : gameKey === "magicslots" ? "Scatter and ultra-bonus events are included in the slot return profile."
                        : gameKey === "coinflip" ? `50% hit chance | ${COINFLIP_PAYOUT.toFixed(2)}x payout`
                            : gameKey === "baccarat" ? "Tie is rare and high variance; player/banker are steadier."
                                : gameKey === "hilo" ? "Larger card distance pays a higher multiplier."
                                    : "More picks increase variance and unlock larger payout ladders.";
    return `${getCasinoProfileLine(gameKey)}\n${strategy}`;
}

function getCasinoRiskBand(bet: number, walletBefore: number): string {
    const base = Math.max(1, walletBefore);
    const ratio = bet / base;
    if (ratio >= 0.4) return "High";
    if (ratio >= 0.2) return "Medium";
    return "Low";
}

function buildCasinoStatLine(userId: string, gameKey: Exclude<GameStatKey, "raid">): string {
    const user = ensureUser(userId);
    const gameStats = user.gameStats[gameKey];
    const wr = gameStats.played > 0 ? ((gameStats.wins / gameStats.played) * 100).toFixed(1) : "0.0";
    return [
        `Mode: ${gameKey.toUpperCase()}`,
        `W/L/P: ${gameStats.wins}/${gameStats.losses}/${gameStats.pushes}`,
        `Win Rate: ${wr}%`,
        `Lifetime Net: ${formatNetAmount(gameStats.net)}`
    ].join(" | ");
}

function buildCasinoSessionLine(userId: string): string {
    const stats = getGameStatsSummary(userId);
    return [
        `Sessions: ${stats.casinoPlayed}`,
        `Total W/L/P: ${stats.wins}/${stats.losses}/${stats.pushes}`,
        `Total Wagered: ${formatTokenAmount(stats.wagered)}`,
        `Total Net: ${formatNetAmount(stats.net)}`
    ].join(" | ");
}

function getCasinoOutcomePayload(outcome: CasinoOutcome): { color: number; label: string } {
    if (outcome === "win") return { color: 0x00ff00, label: "WIN" };
    if (outcome === "push") return { color: 0xffff00, label: "PUSH" };
    return { color: 0xff0000, label: "LOSS" };
}

export function getNextCasinoGame(gameKey: CasinoGameKey): CasinoGameKey {
    const idx = CASINO_GAME_ORDER.indexOf(gameKey);
    if (idx < 0) return "dice";
    return CASINO_GAME_ORDER[(idx + 1) % CASINO_GAME_ORDER.length];
}

export function defaultCasinoArgForGame(gameKey: CasinoGameKey): string {
    if (gameKey === "dice") return "low";
    if (gameKey === "roulette") return "red";
    if (gameKey === "blackjack") return "safe";
    if (gameKey === "crash") return "1.50";
    if (gameKey === "magicslots") return "single";
    if (gameKey === "coinflip") return "heads";
    if (gameKey === "baccarat") return "player";
    if (gameKey === "hilo") return "higher";
    return "3,8,11,24";
}

export function sanitizeCasinoActionArg(value: string): string {
    return String(value || "")
        .replace(/\s+/g, "")
        .replace(/[:]/g, "")
        .slice(0, 36);
}

function buildCasinoActionCustomIdForUser(action: CasinoActionKind, gameKey: CasinoGameKey, bet: number, userId: string, arg: string): string {
    const safeBet = Math.max(1, Math.floor(bet));
    const safeArg = sanitizeCasinoActionArg(arg || defaultCasinoArgForGame(gameKey));
    const safeUserId = String(userId || "0").replace(/\D/g, "").slice(0, 24) || "0";
    return `${CASINO_UI_IDS.prefix}:${action}:${gameKey}:${safeBet}:${safeUserId}:${safeArg}`;
}

export function parseCasinoActionCustomId(customId: string): {
    action: CasinoActionKind;
    gameKey: CasinoGameKey;
    bet: number;
    ownerId: string;
    arg: string;
} | null {
    const parts = customId.split(":");
    if (parts.length < 6) return null;
    if (parts[0] !== CASINO_UI_IDS.prefix) return null;
    const action = parts[1] as CasinoActionKind;
    const gameKey = parts[2] as CasinoGameKey;
    const bet = Math.max(1, Math.floor(Number.parseInt(parts[3], 10) || 1));
    const ownerId = String(parts[4] || "").replace(/\D/g, "");
    const arg = sanitizeCasinoActionArg(parts.slice(5).join(":"));
    if (!["launch", "replay", "double", "half", "switch"].includes(action)) return null;
    if (!CASINO_GAME_ORDER.includes(gameKey)) return null;
    if (!ownerId) return null;
    return { action, gameKey, bet, ownerId, arg };
}

function buildCasinoActionComponents(meta: { userId: string; gameKey: CasinoGameKey; bet: number; arg: string }): Array<ReturnType<ActionRowBuilder<ButtonBuilder>["toJSON"]>> {
    const nextGame = getNextCasinoGame(meta.gameKey);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(buildCasinoActionCustomIdForUser("replay", meta.gameKey, meta.bet, meta.userId, meta.arg))
            .setLabel("Replay")
            .setEmoji("🔁")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(buildCasinoActionCustomIdForUser("double", meta.gameKey, meta.bet, meta.userId, meta.arg))
            .setLabel("Double Bet")
            .setEmoji("⚔️")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(buildCasinoActionCustomIdForUser("half", meta.gameKey, meta.bet, meta.userId, meta.arg))
            .setLabel("Half Bet")
            .setEmoji("🛡️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(buildCasinoActionCustomIdForUser("switch", meta.gameKey, meta.bet, meta.userId, meta.arg))
            .setLabel(`Switch Game -> ${nextGame}`)
            .setEmoji("🧭")
            .setStyle(ButtonStyle.Secondary)
    );
    return [row.toJSON()];
}

export function buildCasinoLobbyPayload(userId: string, bet: number): string {
    const stake = Math.max(MIN_BET, Math.floor(bet));
    const games: Array<{ key: CasinoGameKey; label: string; emoji: string }> = [
        { key: "dice", label: "Dice", emoji: "🎲" },
        { key: "roulette", label: "Roulette", emoji: "🎡" },
        { key: "blackjack", label: "Blackjack", emoji: "🃏" },
        { key: "crash", label: "Crash", emoji: "📈" },
        { key: "magicslots", label: "Magic Slots", emoji: "🎰" },
        { key: "coinflip", label: "Coinflip", emoji: "🪙" },
        { key: "baccarat", label: "Baccarat", emoji: "🂡" },
        { key: "hilo", label: "High-Low", emoji: "🔺" },
        { key: "keno", label: "Keno", emoji: "🎟️" }
    ];
    const rows = [games.slice(0, 5), games.slice(5)].map(group =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(...group.map(game =>
            new ButtonBuilder()
                .setCustomId(buildCasinoActionCustomIdForUser("launch", game.key, stake, userId, defaultCasinoArgForGame(game.key)))
                .setLabel(game.label)
                .setStyle(game.key === "magicslots" ? ButtonStyle.Primary : ButtonStyle.Secondary)
        )).toJSON()
    );
    const profileLines = games.map(game => `${game.emoji} **${game.label}** • ${CASINO_PROFILES[game.key].rtp} • ${CASINO_PROFILES[game.key].volatility}`);
    const vip = getCasinoVipTier(userId);
    const dailyId = `${CASINO_UI_IDS.dailyPrefix}:${String(userId).replace(/\D/g, "")}`;
    const embed = new EmbedBuilder()
        .setColor(0xd4af37)
        .setTitle("🎰 FN Casino Floor")
        .setDescription("Choose a table below. Results include the outcome, payout, net change, wallet balance, odds, and replay controls.")
        .addFields(
            { name: "Your Stake", value: `${formatTokenAmount(stake)}\nWallet: ${formatTokenAmount(getTokens(userId))}`, inline: true },
            { name: "Win Bonus", value: `${(STANDARD_WIN_BONUS_CHANCE * 100).toFixed(0)}% chance on standard-game wins\nBonuses only increase payouts.`, inline: true },
            { name: "VIP Status", value: `VIP ${vip.level} • ${vip.label}\n${vip.xpToNext ? `${vip.xpToNext} Casino XP to next tier` : "Maximum VIP tier"}\nWager freely within your available wallet.`, inline: true },
            { name: "Token Play", value: "Wagers use in-game FN Tokens only. RTP estimates are long-run averages, not a promise for any session.", inline: true },
            { name: "Game Profiles", value: profileLines.join("\n"), inline: false }
        )
        .setFooter({ text: "Long-run return is not a guarantee for any session. Play within your wallet." });

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(dailyId).setLabel("Claim Daily Reward").setEmoji("🎁").setStyle(ButtonStyle.Success)
    ).toJSON());
    return JSON.stringify({ embed: embed.toJSON(), components: rows });
}

export function formatCasinoResult(options: {
    userId: string;
    gameKey: Exclude<GameStatKey, "raid">;
    gameIcon: string;
    gameName: string;
    outcome: CasinoOutcome;
    bet: number;
    payout: number;
    walletBefore: number;
    walletAfter: number;
    luckyLabel?: string;
    details?: Array<{ label: string; value: string }>;
    boardSnapshot?: string;
    notes?: string[];
    sections?: Array<{ title: string; value: string }>;
    actionMeta?: { bet: number; arg: string };
}): string {
    const net = options.payout - options.bet;
    const outcomePayload = getCasinoOutcomePayload(options.outcome);
    const riskBand = getCasinoRiskBand(options.bet, options.walletBefore);
    const oddsSnapshot = getCasinoOddsSnapshot(options.gameKey);
    const detailLines = (options.details || []).map(detail => `• ${detail.label}: ${detail.value}`);
    const notes = options.notes || [];
    const boardSnapshot = options.boardSnapshot || buildCasinoBoardSnapshot(options.gameKey, options.details || []);

    const embed = new EmbedBuilder()
        .setColor(outcomePayload.color)
        .setTitle(`${options.gameIcon} ${options.gameName} • ${outcomePayload.label}`)
        .setDescription(options.outcome === "win" ? "Payout secured." : options.outcome === "push" ? "Stake returned." : "No return this round.")
        .addFields(
            {
                name: "Result",
                value: [
                    `Bet: ${formatTokenAmount(options.bet)}`,
                    `Payout: ${formatTokenAmount(options.payout)}`,
                    `Net: ${formatNetAmount(net)}`,
                    `Wallet: ${formatTokenAmount(options.walletAfter)}`
                ].join("\n"),
                inline: true
            },
            {
                name: "Odds & Bonus",
                value: [
                    `Risk: ${riskBand}`,
                    `Bonus Result: ${options.luckyLabel || "No bonus"}`,
                    oddsSnapshot
                ].join("\n"),
                inline: true
            }
        );

    if (options.boardSnapshot) {
        embed.addFields({
            name: "Table Snapshot",
            value: `\`\`\`text\n${options.boardSnapshot.slice(0, 850)}\n\`\`\``,
            inline: false
        });
    }
    const hasCrashMeter = options.sections?.some(section => section.title === "Crash Meter") || false;
    if (boardSnapshot && !hasCrashMeter) {
        embed.addFields({
            name: "Table Snapshot",
            value: `\`\`\`text\n${boardSnapshot.slice(0, 850)}\n\`\`\``,
            inline: false
        });
    }


    if (detailLines.length) {
        const chunks = chunkLines(detailLines, 950).slice(0, 2);
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? "What Happened" : `What Happened ${i + 1}`,
                value: chunks[i],
                inline: false
            });
        }
    }

    if (notes.length) {
        embed.addFields({ name: "Round Notes", value: notes.map(note => `• ${note}`).join("\n"), inline: false });
    }

    for (const section of options.sections || []) {
        embed.addFields({ name: section.title, value: section.value, inline: false });
    }
    embed.setFooter({ text: `${buildCasinoStatLine(options.userId, options.gameKey)} | ${buildCasinoSessionLine(options.userId)}` });

    const payload: { embed: APIEmbed; components?: Array<ReturnType<ActionRowBuilder<ButtonBuilder>["toJSON"]>> } = {
        embed: embed.toJSON()
    };
    if (options.actionMeta) {
        payload.components = buildCasinoActionComponents({
            userId: options.userId,
            gameKey: options.gameKey,
            bet: Math.max(1, Math.floor(options.actionMeta.bet)),
            arg: sanitizeCasinoActionArg(options.actionMeta.arg || defaultCasinoArgForGame(options.gameKey))
        });
    }
    return JSON.stringify(payload);
}

export function magicSlotSymbolEmoji(symbol: MagicSlotSymbol): string {
    if (symbol === "WAND") return "🪄";
    if (symbol === "POTION") return "🧪";
    if (symbol === "DRAGON") return "🐉";
    if (symbol === "SPELLBOOK") return "📘";
    if (symbol === "CRYSTAL") return "🔮";
    return "✨";
}

export function formatMagicSlotsResult(options: {
    userId: string;
    outcome: CasinoOutcome;
    bet: number;
    payout: number;
    walletBefore: number;
    walletAfter: number;
    luckyLabel: string;
    boardRows: string[];
    winningLines: Array<{ pattern: string; emojiLine: string; multiplier: number; rule: string }>;
    baseMultiplier: number;
    totalBonusHits: number;
    totalHits: number;
    jackpotRows: number;
    scaledMultiplier: number;
    ultraBonusMode: boolean;
    totalBonusSymbols: number;
    scatterMultiplier: number;
}): string {
    const outcomePayload = getCasinoOutcomePayload(options.outcome);
    const net = options.payout - options.bet;
    const resultLabel = options.jackpotRows > 0 && options.outcome === "win"
        ? "JACKPOT"
        : options.outcome.toUpperCase();
    const resultEmoji = options.jackpotRows > 0 && options.outcome === "win"
        ? "💥"
        : options.outcome === "win"
            ? "✅"
            : options.outcome === "push"
                ? "🟨"
                : "❌";
    const heatScore = options.baseMultiplier + (options.totalHits * 0.65) + (options.totalBonusSymbols * 0.35);
    const reelHeat = heatScore >= 7 ? "🔥" : heatScore >= 3.4 ? "⚡" : "🧊";
    const modeTag = options.ultraBonusMode ? "✨ ULTRA BONUS" : "🎰 STANDARD";
    const winSummary = options.winningLines.length
        ? options.winningLines
            .slice(0, 4)
            .map(win => `• ${win.pattern} ${win.emojiLine}  ${win.multiplier.toFixed(2)}x`)
            .join("\n")
        : "• No line hit";

    const embed = new EmbedBuilder()
        .setColor(outcomePayload.color)
        .setTitle(`${resultEmoji} Magic Slots • ${resultLabel}`)
        .setDescription(`${modeTag}  ${reelHeat}  ✨x${options.totalBonusSymbols}`)
        .addFields(
            {
                name: "💰 Spin",
                value: [
                    `Bet: ${formatTokenAmount(options.bet)}`,
                    `Win: ${formatTokenAmount(options.payout)}`,
                    `Net: ${formatNetAmount(net)}`,
                    `Bank: ${formatTokenAmount(options.walletAfter)}`,
                    `Lines: ${options.winningLines.length}/${options.totalHits}`,
                    `Bonus: ${options.totalBonusHits}  |  Jackpot: ${options.jackpotRows}`,
                    `Scatter: ${options.scatterMultiplier > 0 ? `${options.scatterMultiplier.toFixed(2)}x` : "-"}`
                ].join("\n"),
                inline: false
            },
            {
                name: "🎛️ Reels",
                value: `\`\`\`\n${options.boardRows.join("\n")}\n\`\`\``,
                inline: false
            },
            {
                name: "🏆 Winning Lines",
                value: winSummary,
                inline: false
            },
            {
                name: "✨ Bonus Chances",
                value: [
                    "Scatter (3+ BONUS): ~0.47% per spin",
                    "Ultra mode: ~0.16% per spin",
                    "Full BONUS row: exceptionally rare jackpot",
                    `Return profile: ${CASINO_PROFILES.magicslots.rtp}`
                ].join("\n"),
                inline: false
            }
        )
        .setFooter({ text: buildCasinoSessionLine(options.userId) })
        .setTimestamp(new Date());

    return JSON.stringify({
        embed: embed.toJSON(),
        components: buildCasinoActionComponents({
            userId: options.userId,
            gameKey: "magicslots",
            bet: Math.max(1, Math.floor(options.bet)),
            arg: "single"
        })
    });
}
