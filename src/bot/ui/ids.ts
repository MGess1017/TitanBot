// Custom IDs for buttons, menus, and modals, plus shared UI constants.
import { type GameStatKey } from "../../utils";
import * as RaidDomain from "../../raid/domain";

export const HELP_IDS = {
    menu: "help_dropbox",
    general: "general",
    xp: "xp",
    raids: "raids",
    shop: "shop",
    games: "games",
    bank: "bank",
    moderation: "moderation"
} as const;

export const ONBOARDING_IDS = {
    start: "fnt_get_started",
    commands: "fnt_command_guide"
} as const;

export const RAID_CONDITION_CHOICES = RaidDomain.RAID_CONDITIONS.map(condition => ({
    name: condition.label,
    value: condition.key
}));

export const TICKET_IDS = {
    open: "ticket_open",
    claim: "ticket_claim",
    close: "ticket_close",
    resolve: "ticket_resolve",
    watch: "ticket_watch",
    tools: "ticket_staff_tools",
    intakeModal: "ticket_intake_modal",
    intakeCategory: "ticket_intake_category",
    intakeSummary: "ticket_intake_summary",
    intakeDetails: "ticket_intake_details",
    intakePlatform: "ticket_intake_platform",
    intakeEvidence: "ticket_intake_evidence",
    csatPrefix: "ticket_csat"
} as const;

export const REPORT_IDS = {
    open: "report_open",
    adminOpen: "report_admin_open",
    adminModal: "report_admin_modal",
    adminTarget: "report_admin_target",
    adminSummary: "report_admin_summary",
    adminDetails: "report_admin_details",
    adminEvidence: "report_admin_evidence"
} as const;

export const GIVEAWAY_IDS = {
    enterPrefix: "giveaway_enter",
    raidPanelOpen: "giveaway_raid_item_open",
    raidItemModal: "giveaway_raid_item_modal",
    raidItemId: "giveaway_raid_item_id",
    raidItemQty: "giveaway_raid_item_qty",
    raidDuration: "giveaway_raid_duration",
    raidWinners: "giveaway_raid_winners",
    raidDescription: "giveaway_raid_description"
} as const;

export const SELL_UI_IDS = {
    menu: "sell_item_picker",
    qtyPrefix: "sell_qty"
} as const;

export const CASINO_UI_IDS = {
    prefix: "casino_ui",
    dailyPrefix: "casino_daily"
} as const;

export const PMC_PRESTIGE_IDS = {
    request: "pmc_prestige_request",
    confirm: "pmc_prestige_confirm",
    cancel: "pmc_prestige_cancel",
    identity: "pmc_identity"
} as const;

export const PMC_PROFILE_IDS = {
    view: "pmc_profile_view",
    followerRole: "pmc_follower_role"
} as const;
export const PMC_PROFILE_VIEWS = { overview: "Overview", follower: "Follower", prestige: "Prestige", mastery: "Mastery", collection: "Collection" } as const;
export type PmcProfileView = keyof typeof PMC_PROFILE_VIEWS;
export const GEAR_MODAL_PREFIX = "gear_modal:";

export type CasinoGameKey = Exclude<GameStatKey, "raid">;
export type CasinoActionKind = "launch" | "replay" | "double" | "half" | "switch";

export const CASINO_GAME_ORDER: CasinoGameKey[] = [
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
export const PRIVATE_SLASH_COMMANDS = new Set(["reportintake", "reportprofile", "reportresolve", "reportanalytics", "staff"]);
