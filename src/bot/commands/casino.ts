// Casino slash commands.
import { MIN_BET } from "../core/config";
import { buildCasinoLobbyPayload } from "../casino/ui";
import { playBlackjack, playDice, playRoulette } from "../casino/tableGames";
import { playSlots } from "../casino/slots";
import { playBaccarat, playCoinflip, playCrash, playHiLo, playKeno } from "../casino/quickGames";
import { type CommandHandlerMap } from "./registry";

/** Casino game commands. */
export const casinoCommands: CommandHandlerMap = {
    casino: async interaction => {
        const bet = interaction.options.getInteger("bet") || Math.max(MIN_BET, 10);
        return buildCasinoLobbyPayload(interaction.user.id, bet);
    },
    dice: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const choice = interaction.options.getString("choice", true);
        return playDice(interaction.user.id, bet, choice);
    },
    roulette: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const choice = interaction.options.getString("choice", true);
        return playRoulette(interaction.user.id, bet, choice);
    },
    blackjack: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const style = interaction.options.getString("style") || "safe";
        return playBlackjack(interaction.user.id, bet, style);
    },
    crash: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const target = interaction.options.getNumber("target", true);
        return await playCrash(interaction.user.id, bet, target);
    },
    magicslots: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        return playSlots(interaction.user.id, bet);
    },
    coinflip: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const side = interaction.options.getString("side", true);
        return playCoinflip(interaction.user.id, bet, side);
    },
    baccarat: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const side = interaction.options.getString("side", true);
        return playBaccarat(interaction.user.id, bet, side);
    },
    hilo: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const call = interaction.options.getString("call", true);
        return playHiLo(interaction.user.id, bet, call);
    },
    keno: async interaction => {
        const bet = interaction.options.getInteger("bet", true);
        const picks = interaction.options.getString("picks", true);
        return playKeno(interaction.user.id, bet, picks);
    }
};
