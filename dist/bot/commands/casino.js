"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.casinoCommands = void 0;
// Casino slash commands.
const config_1 = require("../core/config");
const ui_1 = require("../casino/ui");
const tableGames_1 = require("../casino/tableGames");
const slots_1 = require("../casino/slots");
const quickGames_1 = require("../casino/quickGames");
/** Casino game commands. */
exports.casinoCommands = {
    casino: async (interaction) => {
        const bet = interaction.options.getInteger("bet") || Math.max(config_1.MIN_BET, 10);
        return (0, ui_1.buildCasinoLobbyPayload)(interaction.user.id, bet);
    },
    dice: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        const choice = interaction.options.getString("choice", true);
        return (0, tableGames_1.playDice)(interaction.user.id, bet, choice);
    },
    roulette: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        const choice = interaction.options.getString("choice", true);
        return (0, tableGames_1.playRoulette)(interaction.user.id, bet, choice);
    },
    blackjack: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        const style = interaction.options.getString("style") || "safe";
        return (0, tableGames_1.playBlackjack)(interaction.user.id, bet, style);
    },
    crash: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        const target = interaction.options.getNumber("target", true);
        return await (0, quickGames_1.playCrash)(interaction.user.id, bet, target);
    },
    magicslots: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        return (0, slots_1.playSlots)(interaction.user.id, bet);
    },
    coinflip: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        const side = interaction.options.getString("side", true);
        return (0, quickGames_1.playCoinflip)(interaction.user.id, bet, side);
    },
    baccarat: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        const side = interaction.options.getString("side", true);
        return (0, quickGames_1.playBaccarat)(interaction.user.id, bet, side);
    },
    hilo: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        const call = interaction.options.getString("call", true);
        return (0, quickGames_1.playHiLo)(interaction.user.id, bet, call);
    },
    keno: async (interaction) => {
        const bet = interaction.options.getInteger("bet", true);
        const picks = interaction.options.getString("picks", true);
        return (0, quickGames_1.playKeno)(interaction.user.id, bet, picks);
    }
};
