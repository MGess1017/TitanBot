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
exports.PRIVATE_SLASH_COMMANDS = exports.CASINO_GAME_ORDER = exports.GEAR_MODAL_PREFIX = exports.PMC_PROFILE_VIEWS = exports.PMC_PROFILE_IDS = exports.PMC_PRESTIGE_IDS = exports.CASINO_UI_IDS = exports.SELL_UI_IDS = exports.GIVEAWAY_IDS = exports.REPORT_IDS = exports.TICKET_IDS = exports.RAID_CONDITION_CHOICES = exports.HELP_IDS = void 0;
const RaidDomain = __importStar(require("../../raid/domain"));
exports.HELP_IDS = {
    menu: "help_dropbox",
    general: "general",
    xp: "xp",
    raids: "raids",
    shop: "shop",
    games: "games",
    bank: "bank",
    moderation: "moderation"
};
exports.RAID_CONDITION_CHOICES = RaidDomain.RAID_CONDITIONS.map(condition => ({
    name: condition.label,
    value: condition.key
}));
exports.TICKET_IDS = {
    open: "ticket_open",
    claim: "ticket_claim",
    close: "ticket_close",
    resolve: "ticket_resolve",
    watch: "ticket_watch",
    intakeModal: "ticket_intake_modal",
    intakeCategory: "ticket_intake_category",
    intakeSummary: "ticket_intake_summary",
    intakeDetails: "ticket_intake_details",
    intakePlatform: "ticket_intake_platform",
    intakeEvidence: "ticket_intake_evidence",
    csatPrefix: "ticket_csat"
};
exports.REPORT_IDS = {
    open: "report_open",
    adminOpen: "report_admin_open",
    adminModal: "report_admin_modal",
    adminTarget: "report_admin_target",
    adminSummary: "report_admin_summary",
    adminDetails: "report_admin_details",
    adminEvidence: "report_admin_evidence"
};
exports.GIVEAWAY_IDS = {
    enterPrefix: "giveaway_enter",
    raidPanelOpen: "giveaway_raid_item_open",
    raidItemModal: "giveaway_raid_item_modal",
    raidItemId: "giveaway_raid_item_id",
    raidItemQty: "giveaway_raid_item_qty",
    raidDuration: "giveaway_raid_duration",
    raidWinners: "giveaway_raid_winners",
    raidDescription: "giveaway_raid_description"
};
exports.SELL_UI_IDS = {
    menu: "sell_item_picker",
    qtyPrefix: "sell_qty"
};
exports.CASINO_UI_IDS = {
    prefix: "casino_ui",
    dailyPrefix: "casino_daily"
};
exports.PMC_PRESTIGE_IDS = {
    request: "pmc_prestige_request",
    confirm: "pmc_prestige_confirm",
    cancel: "pmc_prestige_cancel",
    identity: "pmc_identity"
};
exports.PMC_PROFILE_IDS = {
    view: "pmc_profile_view",
    followerRole: "pmc_follower_role"
};
exports.PMC_PROFILE_VIEWS = { overview: "Overview", follower: "Follower", prestige: "Prestige", mastery: "Mastery", collection: "Collection" };
exports.GEAR_MODAL_PREFIX = "gear_modal:";
exports.CASINO_GAME_ORDER = [
    "dice",
    "roulette",
    "blackjack",
    "crash",
    "magicslots",
    "coinflip",
    "baccarat",
    "hilo",
    "keno"
];
exports.PRIVATE_SLASH_COMMANDS = new Set(["reportintake", "reportprofile", "reportresolve", "reportanalytics", "staff"]);
