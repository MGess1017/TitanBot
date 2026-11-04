"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.moderationCommandHandlers = exports.ticketCommandHandlers = exports.slashCommands = void 0;
const RaidDomain = __importStar(require("../../raid/domain"));
const ticketCommands_1 = require("../../commands/ticketCommands");
const moderationCommands_1 = require("../../commands/moderationCommands");
const slashCatalog_1 = require("../../commands/slashCatalog");
const config_1 = require("../core/config");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const store_2 = require("../tickets/store");
const records_1 = require("../tickets/records");
const opsPanel_1 = require("../tickets/opsPanel");
const guards_1 = require("../core/guards");
const actions_1 = require("../tickets/actions");
const ids_1 = require("../ui/ids");
const help_1 = require("../ui/help");
const ticketPanels_1 = require("../panels/ticketPanels");
const channels_1 = require("../tickets/channels");
exports.slashCommands = (0, slashCatalog_1.buildSlashCommands)({
    raidConditionChoices: ids_1.RAID_CONDITION_CHOICES,
    raidMapChoices: RaidDomain.RAID_MAP_CHOICES,
    raidApproachChoices: RaidDomain.RAID_APPROACH_CHOICES
});
exports.ticketCommandHandlers = (0, ticketCommands_1.buildTicketCommandHandlers)({
    requireGuild: guards_1.requireGuild,
    requireAdministrator: guards_1.requireAdministrator,
    canManageTicketActions: actions_1.canManageTicketActions,
    resolveTicketTargetChannelId: actions_1.resolveTicketTargetChannelId,
    ensureTrackedTicketByChannelId: records_1.ensureTrackedTicketByChannelId,
    createTicketChannel: channels_1.createTicketChannel,
    findTicketByChannel: store_2.findTicketByChannel,
    buildTicketCommandEmbedPayload: opsPanel_1.buildTicketCommandEmbedPayload,
    upsertTicketPanelInChannel: ticketPanels_1.upsertTicketPanelInChannel,
    claimTicketChannel: channels_1.claimTicketChannel,
    handleTicketAssignCommand: actions_1.handleTicketAssignCommand,
    normalizeTicketPriority: store_2.normalizeTicketPriority,
    normalizeTicketStatus: store_2.normalizeTicketStatus,
    normalizeTicketWorkflowStatus: store_2.normalizeTicketWorkflowStatus,
    rejectIfDuplicateCommand: ops_1.rejectIfDuplicateCommand,
    setTicketWorkflowStatus: records_1.setTicketWorkflowStatus,
    updateTicketOpsPanelMessage: opsPanel_1.updateTicketOpsPanelMessage,
    sendTicketLog: records_1.sendTicketLog,
    appendAuditEvent: audit_1.appendAuditEvent,
    getTicketNextActionHint: opsPanel_1.getTicketNextActionHint,
    canTransitionTicketStatus: store_2.canTransitionTicketStatus,
    reopenTicketByChannel: records_1.reopenTicketByChannel,
    findOpenTicketByChannel: store_2.findOpenTicketByChannel,
    closeTicketChannel: channels_1.closeTicketChannel,
    findArchivedTicketByChannel: store_2.findArchivedTicketByChannel,
    resolveTicketChannel: channels_1.resolveTicketChannel,
    ensureTicketConfig: store_2.ensureTicketConfig,
    saveTicketStore: store_2.saveTicketStore,
    pruneDeletedTicketRecords: records_1.pruneDeletedTicketRecords,
    pruneInaccessibleOwnerTicketRecords: records_1.pruneInaccessibleOwnerTicketRecords,
    getTicketSlaState: records_1.getTicketSlaState,
    ticketStore: store_2.ticketStore,
    TICKET_HANDLER_ROLE_ID: config_1.TICKET_HANDLER_ROLE_ID,
    TICKET_DEFAULT_CATEGORY_ID: config_1.TICKET_DEFAULT_CATEGORY_ID
});
exports.moderationCommandHandlers = (0, moderationCommands_1.buildModerationCommandHandlers)({
    requireAdministrator: guards_1.requireAdministrator,
    ensureGuildModeration: store_1.ensureGuildModeration,
    saveModerationStore: store_1.saveModerationStore,
    rejectIfDuplicateCommand: ops_1.rejectIfDuplicateCommand,
    sendModLog: store_1.sendModLog,
    parseDurationMs: store_1.parseDurationMs,
    getAvatar: help_1.getAvatar
});
