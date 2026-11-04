// The merged slash command handler map. Add new command groups here.
import { type CommandHandlerMap } from "./registry";
import { generalCommands } from "./general";
import { adminCommands } from "./admin";
import { staffTicketCommands, ticketReportCommands } from "./tickets";
import { giveawayCommands } from "./giveaways";
import { raidEconomyCommands } from "./raids";
import { casinoCommands } from "./casino";
import { moderationSlashCommands } from "./moderation";

export const commandHandlers: CommandHandlerMap = {
    ...generalCommands,
    ...adminCommands,
    ...ticketReportCommands,
    ...giveawayCommands,
    ...staffTicketCommands,
    ...raidEconomyCommands,
    ...casinoCommands,
    ...moderationSlashCommands
};
