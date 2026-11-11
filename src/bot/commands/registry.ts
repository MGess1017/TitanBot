// Slash command registry and the merged command handler map.
import { ChatInputCommandInteraction } from "discord.js";
import * as RaidDomain from "../../raid/domain";
import { buildTicketCommandHandlers } from "../../commands/ticketCommands";
import { buildModerationCommandHandlers } from "../../commands/moderationCommands";
import { buildSlashCommands } from "../../commands/slashCatalog";
import { TICKET_DEFAULT_CATEGORY_ID, TICKET_HANDLER_ROLE_ID } from "../core/config";
import { rejectIfDuplicateCommand } from "../core/ops";
import { appendAuditEvent } from "../core/audit";
import { ensureGuildModeration, parseDurationMs, saveModerationStore, sendModLog } from "../moderation/store";
import { authorizeModerationAction, executeModerationQuotaAction } from "../moderation/quotas";
import {
    canTransitionTicketStatus, ensureTicketConfig, findArchivedTicketByChannel, findOpenTicketByChannel,
    findTicketByChannel, normalizeTicketPriority, normalizeTicketStatus, normalizeTicketWorkflowStatus,
    saveTicketStore, ticketStore
} from "../tickets/store";
import {
    ensureTrackedTicketByChannelId, getTicketSlaState, pruneDeletedTicketRecords,
    pruneInaccessibleOwnerTicketRecords, reopenTicketByChannel, sendTicketLog, setTicketWorkflowStatus
} from "../tickets/records";
import {
    buildTicketCommandEmbedPayload, getTicketNextActionHint, updateTicketOpsPanelMessage
} from "../tickets/opsPanel";
import { requireAdministrator, requireGuild } from "../core/guards";
import { canManageTicketActions, handleTicketAssignCommand, resolveTicketTargetChannelId } from "../tickets/actions";
import { RAID_CONDITION_CHOICES } from "../ui/ids";
import { getAvatar } from "../ui/help";
import { upsertTicketPanelInChannel } from "../panels/ticketPanels";
import { claimTicketChannel, closeTicketChannel, createTicketChannel, resolveTicketChannel } from "../tickets/channels";

export const slashCommands = buildSlashCommands({
    raidConditionChoices: RAID_CONDITION_CHOICES,
    raidMapChoices: RaidDomain.RAID_MAP_CHOICES,
    raidApproachChoices: RaidDomain.RAID_APPROACH_CHOICES
});

export const ticketCommandHandlers = buildTicketCommandHandlers({
    requireGuild,
    requireAdministrator,
    canManageTicketActions,
    resolveTicketTargetChannelId,
    ensureTrackedTicketByChannelId,
    createTicketChannel,
    findTicketByChannel,
    buildTicketCommandEmbedPayload,
    upsertTicketPanelInChannel,
    claimTicketChannel,
    handleTicketAssignCommand,
    normalizeTicketPriority,
    normalizeTicketStatus,
    normalizeTicketWorkflowStatus,
    rejectIfDuplicateCommand,
    setTicketWorkflowStatus,
    updateTicketOpsPanelMessage,
    sendTicketLog,
    appendAuditEvent,
    getTicketNextActionHint,
    canTransitionTicketStatus,
    reopenTicketByChannel,
    findOpenTicketByChannel,
    closeTicketChannel,
    findArchivedTicketByChannel,
    resolveTicketChannel,
    ensureTicketConfig,
    saveTicketStore,
    pruneDeletedTicketRecords,
    pruneInaccessibleOwnerTicketRecords,
    getTicketSlaState,
    ticketStore,
    TICKET_HANDLER_ROLE_ID,
    TICKET_DEFAULT_CATEGORY_ID
});

export const moderationCommandHandlers = buildModerationCommandHandlers({
    requireAdministrator,
    ensureGuildModeration,
    saveModerationStore,
    rejectIfDuplicateCommand,
    sendModLog,
    parseDurationMs,
    authorizeModerationAction,
    executeModerationQuotaAction,
    getAvatar
});

export type CommandHandlerMap = Record<string, (interaction: ChatInputCommandInteraction) => Promise<string>>;
