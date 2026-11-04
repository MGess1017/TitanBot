"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandHandlers = void 0;
const general_1 = require("./general");
const admin_1 = require("./admin");
const tickets_1 = require("./tickets");
const giveaways_1 = require("./giveaways");
const raids_1 = require("./raids");
const casino_1 = require("./casino");
const moderation_1 = require("./moderation");
exports.commandHandlers = {
    ...general_1.generalCommands,
    ...admin_1.adminCommands,
    ...tickets_1.ticketReportCommands,
    ...giveaways_1.giveawayCommands,
    ...tickets_1.staffTicketCommands,
    ...raids_1.raidEconomyCommands,
    ...casino_1.casinoCommands,
    ...moderation_1.moderationSlashCommands
};
