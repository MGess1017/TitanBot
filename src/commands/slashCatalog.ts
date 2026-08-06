import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export type CommandChoice = { name: string; value: string };

export function buildSlashCommands(input: {
    raidConditionChoices: CommandChoice[];
    raidMapChoices: CommandChoice[];
}) {
    const { raidConditionChoices, raidMapChoices } = input;

    return [
        new SlashCommandBuilder()
            .setName("ping")
            .setDescription("Check if the bot is online."),
        new SlashCommandBuilder()
            .setName("help")
            .setDescription("Show available bot commands."),
        new SlashCommandBuilder()
            .setName("quickstart")
            .setDescription("Guided first-run command flow for raids and economy."),
        new SlashCommandBuilder()
            .setName("testupdate")
            .setDescription("Test command that replies with Updated."),
        new SlashCommandBuilder()
            .setName("xproles")
            .setDescription("View XP rank roles in a randomized color embed."),
        new SlashCommandBuilder()
            .setName("xprolesync")
            .setDescription("Admin: force-sync XP rank roles for all members now.")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName("status")
            .setDescription("Show bot runtime status."),
        new SlashCommandBuilder()
            .setName("findbots")
            .setDescription("List bot accounts in this server and highlight this bot."),
        new SlashCommandBuilder()
            .setName("balance")
            .setDescription("Show your FN Token$ balance."),
        new SlashCommandBuilder()
            .setName("token")
            .setDescription("Show FN Token$ balance")
            .addUserOption(o => o.setName("user").setDescription("Optional user").setRequired(false)),
        new SlashCommandBuilder()
            .setName("bank")
            .setDescription("Show wallet and bank balances")
            .addUserOption(o => o.setName("user").setDescription("Optional user").setRequired(false)),
        new SlashCommandBuilder()
            .setName("deposit")
            .setDescription("Deposit FN Token$ into your bank")
            .addIntegerOption(o => o.setName("amount").setDescription("Amount to deposit").setRequired(true)),
        new SlashCommandBuilder()
            .setName("withdraw")
            .setDescription("Withdraw FN Token$ from your bank")
            .addIntegerOption(o => o.setName("amount").setDescription("Amount to withdraw").setRequired(true)),
        new SlashCommandBuilder()
            .setName("transfer")
            .setDescription("Transfer FN Token$ to another user")
            .addUserOption(o => o.setName("user").setDescription("Recipient").setRequired(true))
            .addIntegerOption(o => o.setName("amount").setDescription("Amount to transfer").setRequired(true)),
        new SlashCommandBuilder()
            .setName("addtoken")
            .setDescription("Discord owner: grant FN Token$ (ultra-rare coins found only in raids)")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addIntegerOption(o => o.setName("amount").setDescription("Amount to add").setRequired(true)),
        new SlashCommandBuilder()
            .setName("tradeoffer")
            .setDescription("Offer an item trade to another user")
            .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
            .addStringOption(o => o.setName("offer_item").setDescription("Item you give").setRequired(true).setAutocomplete(true))
            .addIntegerOption(o => o.setName("offer_qty").setDescription("Quantity you give").setRequired(true))
            .addStringOption(o => o.setName("request_item").setDescription("Item you want").setRequired(true).setAutocomplete(true))
            .addIntegerOption(o => o.setName("request_qty").setDescription("Quantity you want").setRequired(true)),
        new SlashCommandBuilder()
            .setName("trades")
            .setDescription("View your open trades"),
        new SlashCommandBuilder()
            .setName("tradeaccept")
            .setDescription("Accept an open trade offer")
            .addStringOption(o => o.setName("offer_id").setDescription("Select an incoming offer").setRequired(true).setAutocomplete(true)),
        new SlashCommandBuilder()
            .setName("tradedecline")
            .setDescription("Decline an open trade offer")
            .addStringOption(o => o.setName("offer_id").setDescription("Select one of your open offers").setRequired(true).setAutocomplete(true)),
        new SlashCommandBuilder()
            .setName("points")
            .setDescription("Check Access Points")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(false)),
        new SlashCommandBuilder()
            .setName("xp")
            .setDescription("Show your XP and level."),
        new SlashCommandBuilder()
            .setName("pmc")
            .setDescription("Show your persistent PMC raid profile."),
        new SlashCommandBuilder()
            .setName("daily")
            .setDescription("Claim daily rewards."),
        new SlashCommandBuilder()
            .setName("leaderboard")
            .setDescription("Show top users by XP."),
        new SlashCommandBuilder()
            .setName("loadout")
            .setDescription("Show your best auto-applied raid weapon and armor bonuses."),
        new SlashCommandBuilder()
            .setName("bosses")
            .setDescription("Show all raid bosses, their stats, and map rotation weights."),
        new SlashCommandBuilder()
            .setName("conditions")
            .setDescription("Show raid conditions, severity, and armor counters."),
        new SlashCommandBuilder()
            .setName("gearintel")
            .setDescription("Show raid weapon and armor stats plus special traits.")
            .addStringOption(o => o.setName("kind").setDescription("Filter gear type").setRequired(false)
                .addChoices(
                    { name: "all", value: "all" },
                    { name: "weapon", value: "weapon" },
                    { name: "armor", value: "armor" }
                ))
            .addStringOption(o => o.setName("condition").setDescription("Optional condition filter").setRequired(false)
                .addChoices(...raidConditionChoices)),
        new SlashCommandBuilder()
            .setName("raidintel")
            .setDescription("Preview a raid condition trigger and your active gear/map modifiers.")
            .addStringOption(o => o.setName("map").setDescription("Select raid map for intel").setRequired(false)
                .addChoices(...raidMapChoices))
            .addStringOption(o => o.setName("weapon").setDescription("Optional weapon (OWNED shown first)").setRequired(false).setAutocomplete(true))
            .addStringOption(o => o.setName("armor").setDescription("Optional armor (OWNED shown first)").setRequired(false).setAutocomplete(true)),
        new SlashCommandBuilder()
            .setName("raid")
            .setDescription("Launch a raid")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount to risk").setRequired(true))
            .addStringOption(o => o.setName("tension").setDescription("low|medium|high").setRequired(false)
                .addChoices(
                    { name: "low", value: "low" },
                    { name: "medium", value: "medium" },
                    { name: "high", value: "high" }
                ))
            .addStringOption(o => o.setName("map").setDescription("Select raid map").setRequired(false)
                .addChoices(...raidMapChoices))
            .addStringOption(o => o.setName("weapon").setDescription("Optional weapon (OWNED shown first)").setRequired(false).setAutocomplete(true))
            .addStringOption(o => o.setName("armor").setDescription("Optional armor (OWNED shown first)").setRequired(false).setAutocomplete(true)),
        new SlashCommandBuilder().setName("raidhistory").setDescription("View recent raid history"),
        new SlashCommandBuilder().setName("shop").setDescription("Browse the shop"),
        new SlashCommandBuilder().setName("inventory").setDescription("View your inventory"),
        new SlashCommandBuilder().setName("buy").setDescription("Buy an item")
            .addStringOption(o => o.setName("item").setDescription("Item id").setRequired(true).setAutocomplete(true))
            .addIntegerOption(o => o.setName("quantity").setDescription("Amount").setRequired(true)),
        new SlashCommandBuilder().setName("sell").setDescription("Sell an item")
            .addStringOption(o => o.setName("item").setDescription("Item id (optional if using picker)").setRequired(false).setAutocomplete(true))
            .addIntegerOption(o => o.setName("quantity").setDescription("Amount (default 1)").setRequired(false)),
        new SlashCommandBuilder().setName("opencrate").setDescription("Open a crate")
            .addStringOption(o => o.setName("crate").setDescription("common_crate|rare_crate|epic_crate|tactical_crate|mythic_crate").setRequired(false).setAutocomplete(true)),
        new SlashCommandBuilder().setName("useitem").setDescription("Use a consumable inventory item")
            .addStringOption(o => o.setName("item").setDescription("Consumable item id").setRequired(false).setAutocomplete(true))
            .addIntegerOption(o => o.setName("quantity").setDescription("Quantity to use (default 1)").setRequired(false)),
        new SlashCommandBuilder().setName("dice").setDescription("Bet on a dice roll")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount").setRequired(true))
            .addStringOption(o => o.setName("choice").setDescription("1-6, high, low, odd, even").setRequired(true)),
        new SlashCommandBuilder().setName("roulette").setDescription("Play roulette")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount").setRequired(true))
            .addStringOption(o => o.setName("choice").setDescription("red, black, green, odd, even, 0-36").setRequired(true)),
        new SlashCommandBuilder().setName("blackjack").setDescription("Play blackjack")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount").setRequired(true))
            .addStringOption(o => o.setName("style").setDescription("safe|aggressive").setRequired(false)
                .addChoices(
                    { name: "safe", value: "safe" },
                    { name: "aggressive", value: "aggressive" }
                )),
        new SlashCommandBuilder().setName("crash").setDescription("Play crash")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount").setRequired(true))
            .addNumberOption(o => o.setName("target").setDescription("Multiplier (1.05-10.0)").setRequired(true)),
        new SlashCommandBuilder().setName("slots").setDescription("Play multi-line slots with lucky multipliers")
            .addIntegerOption(o => o.setName("bet").setDescription("Bet per line").setRequired(true))
            .addIntegerOption(o => o.setName("lines").setDescription("Number of active lines (1-8)").setRequired(true)
                .addChoices(
                    { name: "1 line", value: 1 },
                    { name: "2 lines", value: 2 },
                    { name: "3 lines", value: 3 },
                    { name: "4 lines", value: 4 },
                    { name: "5 lines", value: 5 },
                    { name: "6 lines", value: 6 },
                    { name: "7 lines", value: 7 },
                    { name: "8 lines", value: 8 }
                )),
        new SlashCommandBuilder().setName("coinflip").setDescription("Classic coin flip with lucky multipliers")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount").setRequired(true))
            .addStringOption(o => o.setName("side").setDescription("heads|tails").setRequired(true)
                .addChoices(
                    { name: "heads", value: "heads" },
                    { name: "tails", value: "tails" }
                )),
        new SlashCommandBuilder().setName("baccarat").setDescription("Play baccarat on player, banker, or tie")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount").setRequired(true))
            .addStringOption(o => o.setName("side").setDescription("player|banker|tie").setRequired(true)
                .addChoices(
                    { name: "player", value: "player" },
                    { name: "banker", value: "banker" },
                    { name: "tie", value: "tie" }
                )),
        new SlashCommandBuilder().setName("hilo").setDescription("Predict whether the next card is higher or lower")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount").setRequired(true))
            .addStringOption(o => o.setName("call").setDescription("higher|lower").setRequired(true)
                .addChoices(
                    { name: "higher", value: "higher" },
                    { name: "lower", value: "lower" }
                )),
        new SlashCommandBuilder().setName("keno").setDescription("Pick 2-10 numbers from 1-40 and match the 10-number draw")
            .addIntegerOption(o => o.setName("bet").setDescription("Amount").setRequired(true))
            .addStringOption(o => o.setName("picks").setDescription("Picks like 3,8,11,24 or 3 8 11 24").setRequired(true)),
        new SlashCommandBuilder().setName("addpoints").setDescription("Admin: give Access Points")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),
        new SlashCommandBuilder().setName("pointsuser").setDescription("Check user Access Points")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
        new SlashCommandBuilder().setName("timeout").setDescription("Timeout user")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
        new SlashCommandBuilder().setName("kick").setDescription("Kick user")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
        new SlashCommandBuilder().setName("ban").setDescription("Ban user")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
        new SlashCommandBuilder().setName("unban").setDescription("Unban user by ID")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(o => o.setName("user_id").setDescription("User ID to unban").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Optional unban reason").setRequired(false)),
        new SlashCommandBuilder().setName("xpstats").setDescription("Show your XP stats"),
        new SlashCommandBuilder().setName("health").setDescription("Admin: runtime and persistence diagnostics")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName("balancereport").setDescription("Admin: weekly raid economy telemetry snapshot")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName("incident").setDescription("Admin: run consolidated health and sanity triage")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addBooleanOption(o => o.setName("fix").setDescription("Attempt remediation actions where possible").setRequired(false)),
        new SlashCommandBuilder().setName("xpverify").setDescription("Admin: verify persisted XP state for a user")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User to verify").setRequired(true)),
        new SlashCommandBuilder().setName("rolesanity").setDescription("Admin: audit XP role configuration and assignment readiness")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addBooleanOption(o => o.setName("fix").setDescription("Attempt auto-remediation where possible").setRequired(false)),
        new SlashCommandBuilder().setName("ticketsanity").setDescription("Admin: audit ticket store integrity and channel consistency")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addBooleanOption(o => o.setName("fix").setDescription("Attempt auto-remediation where possible").setRequired(false)),
        new SlashCommandBuilder().setName("ticketops").setDescription("Admin: inspect ticket runtime lock and dedupe telemetry")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName("ticket").setDescription("Open a private support ticket")
            .addStringOption(o => o.setName("reason").setDescription("Short reason for your ticket").setRequired(false))
            .addStringOption(o => o.setName("priority").setDescription("Ticket priority").setRequired(false)
                .addChoices(
                    { name: "Low", value: "low" },
                    { name: "Normal", value: "normal" },
                    { name: "High", value: "high" }
                )),
        new SlashCommandBuilder().setName("ticketintake").setDescription("Open a smart intake modal for structured support requests"),
        new SlashCommandBuilder().setName("ticketforce").setDescription("Open a ticket and bypass duplicate/KB deflection checks")
            .addStringOption(o => o.setName("reason").setDescription("Short reason for your ticket").setRequired(true))
            .addStringOption(o => o.setName("priority").setDescription("Ticket priority").setRequired(false)
                .addChoices(
                    { name: "Low", value: "low" },
                    { name: "Normal", value: "normal" },
                    { name: "High", value: "high" }
                )),
        new SlashCommandBuilder().setName("ticketpanel").setDescription("Post the support ticket panel in this channel")
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder().setName("claimticket").setDescription("Claim a tracked ticket (handler/admin only)")
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel (use when running outside ticket)").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional ticket channel ID when channel picker does not show it").setRequired(false)),
        new SlashCommandBuilder().setName("ticketassign").setDescription("Assign a tracked ticket to a handler/admin")
            .addUserOption(o => o.setName("user").setDescription("Assignee").setRequired(true))
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel (use when running outside ticket)").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional ticket channel ID when channel picker does not show it").setRequired(false)),
        new SlashCommandBuilder().setName("ticketassgin").setDescription("Alias for ticketassign (legacy typo support)")
            .addUserOption(o => o.setName("user").setDescription("Assignee").setRequired(true))
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel (use when running outside ticket)").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional ticket channel ID when channel picker does not show it").setRequired(false)),
        new SlashCommandBuilder().setName("ticketstatus").setDescription("Set ticket workflow status")
            .addStringOption(o => o.setName("status").setDescription("Workflow status").setRequired(true)
                .addChoices(
                    { name: "responded", value: "responded" },
                    { name: "waiting_user", value: "waiting_user" },
                    { name: "escalated", value: "escalated" }
                ))
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel (use when running outside ticket)").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional ticket channel ID when channel picker does not show it").setRequired(false)),
        new SlashCommandBuilder().setName("reopenticket").setDescription("Reopen an archived ticket back into active workflow (handler/admin only)")
            .addStringOption(o => o.setName("reason").setDescription("Reason for reopening").setRequired(false))
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel (use when running outside ticket)").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional ticket channel ID when channel picker does not show it").setRequired(false)),
        new SlashCommandBuilder().setName("closeticket").setDescription("Archive the current ticket to hold queue (handler/admin only)")
            .addStringOption(o => o.setName("reason").setDescription("Archive reason").setRequired(false))
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel (use when running outside ticket)").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional ticket channel ID when channel picker does not show it").setRequired(false)),
        new SlashCommandBuilder().setName("resolveticket").setDescription("Permanently resolve an archived ticket (handler/admin only)")
            .addStringOption(o => o.setName("reason").setDescription("Final resolution reason").setRequired(false))
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel (use when running outside ticket)").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional ticket channel ID when channel picker does not show it").setRequired(false)),
        new SlashCommandBuilder().setName("ticketconfig").setDescription("Configure ticket categories/log channel")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addChannelOption(o => o.setName("category").setDescription("Ticket category").addChannelTypes(ChannelType.GuildCategory).setRequired(false))
            .addChannelOption(o => o.setName("archive_category").setDescription("Archive hold category").addChannelTypes(ChannelType.GuildCategory).setRequired(false))
            .addChannelOption(o => o.setName("log_channel").setDescription("Ticket log channel").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addIntegerOption(o => o.setName("reopen_window_hours").setDescription("Reopen window after archive (hours)").setRequired(false))
            .addStringOption(o => o.setName("export_webhook").setDescription("Optional webhook URL for resolved ticket exports").setRequired(false)),
        new SlashCommandBuilder().setName("tickets").setDescription("List currently open tickets")
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder().setName("ticketanalytics").setDescription("Admin: ticket response/resolution medians and category insights")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName("ticketsearch").setDescription("Staff: search tickets by owner, status, category, and text")
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
            .addStringOption(o => o.setName("query").setDescription("Search text in reason/category/internal notes").setRequired(false))
            .addUserOption(o => o.setName("owner").setDescription("Filter by ticket owner").setRequired(false))
            .addStringOption(o => o.setName("status").setDescription("Filter by lifecycle status").setRequired(false)
                .addChoices(
                    { name: "open", value: "open" },
                    { name: "claimed", value: "claimed" },
                    { name: "archived", value: "archived" },
                    { name: "resolved", value: "resolved" }
                ))
            .addStringOption(o => o.setName("category").setDescription("Filter by ticket category").setRequired(false)
                .addChoices(
                    { name: "general", value: "general" },
                    { name: "bug", value: "bug" },
                    { name: "appeal", value: "appeal" },
                    { name: "billing", value: "billing" },
                    { name: "account", value: "account" },
                    { name: "report", value: "report" }
                ))
            .addIntegerOption(o => o.setName("page").setDescription("Result page number").setRequired(false))
            .addIntegerOption(o => o.setName("page_size").setDescription("Results per page (5-20)").setRequired(false)),
        new SlashCommandBuilder().setName("ticketworkload").setDescription("Admin: handler workload and SLA risk distribution")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName("ticketnote").setDescription("Add a private handler note to a ticket")
            .addStringOption(o => o.setName("note").setDescription("Private internal note").setRequired(true))
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional channel ID").setRequired(false)),
        new SlashCommandBuilder().setName("tickettimeline").setDescription("View private timeline and notes for a ticket")
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional channel ID").setRequired(false)),
        new SlashCommandBuilder().setName("ticketmerge").setDescription("Merge a child ticket into a parent ticket")
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
            .addIntegerOption(o => o.setName("parent_ticket_id").setDescription("Parent ticket id").setRequired(true))
            .addIntegerOption(o => o.setName("child_ticket_id").setDescription("Child ticket id").setRequired(true)),
        new SlashCommandBuilder().setName("ticketlink").setDescription("Link the current ticket as a child of another ticket")
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
            .addIntegerOption(o => o.setName("parent_ticket_id").setDescription("Parent ticket id").setRequired(true))
            .addChannelOption(o => o.setName("ticket_channel").setDescription("Optional ticket channel").addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addStringOption(o => o.setName("ticket_channel_id").setDescription("Optional channel ID").setRequired(false)),
        new SlashCommandBuilder().setName("ticketexport").setDescription("Admin: export resolved ticket data to configured webhook")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addIntegerOption(o => o.setName("limit").setDescription("Number of tickets to export (1-50)").setRequired(false)),
        new SlashCommandBuilder().setName("ticketretention").setDescription("Admin: configure retention and purge resolved ticket history")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addIntegerOption(o => o.setName("days").setDescription("Retention days for resolved tickets").setRequired(false))
            .addBooleanOption(o => o.setName("purge_now").setDescription("Run purge immediately").setRequired(false)),
        new SlashCommandBuilder().setName("setmodlog").setDescription("Set the moderation log channel")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addChannelOption(o => o.setName("channel").setDescription("Log channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),
        new SlashCommandBuilder().setName("setlockdown").setDescription("Set the protected lockdown channel")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addChannelOption(o => o.setName("channel").setDescription("Lockdown channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),
        new SlashCommandBuilder().setName("lockdownnotice").setDescription("Post a loud caution notice in the lockdown channel")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName("modconfig").setDescription("Show moderation configuration")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName("warn").setDescription("Warn a member and record a case")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("Member to warn").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason for warning").setRequired(true)),
        new SlashCommandBuilder().setName("warnings").setDescription("View warnings for a user")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
        new SlashCommandBuilder().setName("clearwarnings").setDescription("Clear all warnings for a user")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
        new SlashCommandBuilder().setName("tempban").setDescription("Ban a user temporarily")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(o => o.setName("user").setDescription("User to ban").setRequired(true))
            .addStringOption(o => o.setName("duration").setDescription("e.g. 30m, 6h, 2d").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("purge").setDescription("Bulk delete recent messages")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addIntegerOption(o => o.setName("amount").setDescription("2-100 messages").setRequired(true))
            .addUserOption(o => o.setName("user").setDescription("Only delete messages from this user").setRequired(false)),
        new SlashCommandBuilder().setName("announce").setDescription("Admin: post a custom embed announcement")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(o => o.setName("title").setDescription("Embed title").setRequired(true))
            .addStringOption(o => o.setName("description").setDescription("Embed description").setRequired(true))
            .addStringOption(o => o.setName("color").setDescription("Hex color like #22c55e or 22c55e").setRequired(false))
            .addStringOption(o => o.setName("footer").setDescription("Optional footer text").setRequired(false))
            .addStringOption(o => o.setName("image_url").setDescription("Optional image URL").setRequired(false))
            .addChannelOption(o => o.setName("channel").setDescription("Target channel (defaults to current channel)").addChannelTypes(ChannelType.GuildText).setRequired(false))
    ];
}
