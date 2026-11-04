"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommandKey = getCommandKey;
const slashCatalog_1 = require("../../commands/slashCatalog");
function getCommandKey(interaction) {
    return (0, slashCatalog_1.resolveSlashCommandKey)(interaction.commandName, interaction.options.getSubcommand(false));
}
