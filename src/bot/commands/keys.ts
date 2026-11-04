// Resolves which internal command an interaction targets (grouped commands like /casino dice → "dice").
import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import { resolveSlashCommandKey } from "../../commands/slashCatalog";

export function getCommandKey(interaction: ChatInputCommandInteraction | AutocompleteInteraction): string {
    return resolveSlashCommandKey(interaction.commandName, interaction.options.getSubcommand(false));
}
