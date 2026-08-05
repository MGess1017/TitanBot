"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketCommandHandlers = buildTicketCommandHandlers;
const discord_js_1 = require("discord.js");
const ticketAnalytics_1 = require("../services/ticketAnalytics");
function buildTicketCommandHandlers(deps) {
    return {
        ticket: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            const reason = (interaction.options.getString("reason") || "General support").slice(0, 180);
            const priority = deps.normalizeTicketPriority(interaction.options.getString("priority") || "normal");
            const created = await deps.createTicketChannel(interaction.guild, interaction.user.id, reason, priority);
            if (created.error)
                return created.error;
            const ticket = created.channelId ? deps.findTicketByChannel(created.channelId) : null;
            return deps.buildTicketCommandEmbedPayload("🎫 Ticket Opened", "Your support ticket is live and queued for FN Support handling.", ticket || undefined, [
                { name: "📝 Reason Submitted", value: reason || "General support" },
                { name: "🧭 What Happens Next", value: "A handler/admin will claim the case, then assignment + workflow updates will appear in the live ops panel." },
                { name: "🧰 Quick Commands", value: "`/claimticket` ` /ticketassign` ` /ticketstatus` ` /reopenticket` ` /closeticket` ` /resolveticket`" }
            ]);
        },
        ticketpanel: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
                return "You need Manage Channels to post the ticket panel.";
            }
            if (!interaction.channel || !interaction.channel.isTextBased()) {
                return "This command requires a text channel.";
            }
            const result = await deps.upsertTicketPanelInChannel(interaction.guild, interaction.channel.id);
            if (!result.ok)
                return result.error || "Unable to upsert ticket panel.";
            return result.action === "updated" ? "✅ Ticket panel refreshed in this channel." : "✅ Ticket panel posted in this channel.";
        },
        claimticket: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            const member = interaction.member;
            if (!member || !deps.canManageTicketActions(member)) {
                return "Only admins or the handler role can claim tickets.";
            }
            const target = deps.resolveTicketTargetChannelId(interaction);
            if (target.error || !target.channelId)
                return target.error || "Unable to resolve the target ticket channel.";
            const tracked = await deps.ensureTrackedTicketByChannelId(interaction.guild, target.channelId, interaction.user.id);
            if (!tracked)
                return "This channel is not a tracked ticket and could not be imported. Check the channel ID or run /tickets.";
            const msg = await deps.claimTicketChannel(interaction.guild, target.channelId, interaction.user.id);
            if (!msg.toLowerCase().includes("claimed"))
                return msg;
            const claimed = deps.findTicketByChannel(target.channelId);
            return deps.buildTicketCommandEmbedPayload("🛠️ Ticket Claimed", "Claim succeeded. Live ticket panel status was updated.", claimed || tracked, [
                { name: "👤 Claimed By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "📣 Result", value: msg, inline: false },
                { name: "➡️ Next Step", value: "Assign a handler (`/ticketassign`) or update workflow (`/ticketstatus`)." }
            ]);
        },
        ticketassign: async (interaction) => {
            return await deps.handleTicketAssignCommand(interaction, false);
        },
        ticketassgin: async (interaction) => {
            return await deps.handleTicketAssignCommand(interaction, true);
        },
        ticketstatus: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            const member = interaction.member;
            if (!member || !deps.canManageTicketActions(member)) {
                return "Only admins or the handler role can update ticket workflow status.";
            }
            const target = deps.resolveTicketTargetChannelId(interaction);
            if (target.error || !target.channelId)
                return target.error || "Unable to resolve the target ticket channel.";
            const ticket = await deps.ensureTrackedTicketByChannelId(interaction.guild, target.channelId, interaction.user.id);
            if (!ticket)
                return "This channel is not a tracked ticket and could not be imported. Use ticket_channel_id or run /tickets.";
            if (deps.normalizeTicketStatus(ticket.status) === "archived") {
                return "Archived tickets cannot use /ticketstatus. Use /reopenticket first or /resolveticket for final closure.";
            }
            if (deps.normalizeTicketStatus(ticket.status) === "resolved") {
                return "Resolved tickets are immutable. Use a new ticket for further support.";
            }
            const status = deps.normalizeTicketWorkflowStatus(interaction.options.getString("status", true));
            const statusDedupeError = deps.rejectIfDuplicateCommand(interaction, `ticketstatus:${target.channelId}:status:${status}`);
            if (statusDedupeError)
                return statusDedupeError;
            if (status === "resolved" || status === "new") {
                return "Use /resolveticket for final resolution. Allowed values here: responded, waiting_user, escalated.";
            }
            const updated = deps.setTicketWorkflowStatus(target.channelId, status);
            if (!updated)
                return "Unable to update status for this ticket.";
            await deps.updateTicketOpsPanelMessage(interaction.guild, updated);
            await deps.sendTicketLog(interaction.guildId, `Ticket #${updated.id} Status Updated`, [
                { name: "Updated By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Workflow Status", value: updated.workflowStatus, inline: true },
                { name: "Channel", value: `<#${updated.channelId}>`, inline: true }
            ]);
            deps.appendAuditEvent("ticket_status", {
                guildId: interaction.guildId,
                ticketId: updated.id,
                status: updated.workflowStatus,
                updatedById: interaction.user.id,
                channelId: updated.channelId
            });
            return deps.buildTicketCommandEmbedPayload("📌 Ticket Workflow Updated", "Workflow status changed successfully.", updated, [
                { name: "👤 Updated By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "🧭 New Workflow", value: updated.workflowStatus, inline: true },
                { name: "➡️ Next Step", value: deps.getTicketNextActionHint(updated), inline: false }
            ]);
        },
        reopenticket: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            const member = interaction.member;
            if (!member || !deps.canManageTicketActions(member)) {
                return "Only admins or the handler role can reopen archived tickets.";
            }
            const target = deps.resolveTicketTargetChannelId(interaction);
            if (target.error || !target.channelId)
                return target.error || "Unable to resolve the target ticket channel.";
            const tracked = await deps.ensureTrackedTicketByChannelId(interaction.guild, target.channelId, interaction.user.id);
            if (!tracked)
                return "This channel is not a tracked ticket and could not be imported. Use ticket_channel_id or run /tickets.";
            const ticket = deps.findTicketByChannel(target.channelId);
            if (!ticket)
                return "Unable to locate ticket record for this channel.";
            const currentStatus = deps.normalizeTicketStatus(ticket.status);
            if (ticket.reopenUntilAt && Date.now() > ticket.reopenUntilAt) {
                return "Reopen window expired for this ticket. Open a new ticket for continued support.";
            }
            if (!deps.canTransitionTicketStatus(currentStatus, "claimed")) {
                return currentStatus === "resolved"
                    ? "Resolved tickets cannot be reopened. Open a new ticket if support is needed again."
                    : "Only archived tickets can be reopened.";
            }
            const reason = (interaction.options.getString("reason") || "Reopened for additional follow-up").slice(0, 220);
            const dedupeError = deps.rejectIfDuplicateCommand(interaction, `reopenticket:${target.channelId}:reason:${reason}`);
            if (dedupeError)
                return dedupeError;
            const reopened = deps.reopenTicketByChannel(target.channelId, interaction.user.id, reason);
            if (!reopened)
                return "Unable to reopen this ticket right now.";
            await deps.updateTicketOpsPanelMessage(interaction.guild, reopened);
            await deps.sendTicketLog(interaction.guildId, `Ticket #${reopened.id} Reopened`, [
                { name: "Reopened By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Owner", value: `<@${reopened.ownerId}>`, inline: true },
                { name: "Channel", value: `<#${reopened.channelId}>`, inline: true },
                { name: "Reason", value: reason, inline: false }
            ]);
            deps.appendAuditEvent("ticket_reopen", {
                guildId: interaction.guildId,
                ticketId: reopened.id,
                reopenedById: interaction.user.id,
                channelId: reopened.channelId,
                reason
            });
            return deps.buildTicketCommandEmbedPayload("🔁 Ticket Reopened", "Archived ticket returned to active workflow and support queue.", reopened, [
                { name: "👤 Reopened By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "📝 Reason", value: reason, inline: false },
                { name: "➡️ Next Step", value: "Assign handler (`/ticketassign`) and continue workflow (`/ticketstatus`).", inline: false }
            ]);
        },
        closeticket: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            const member = interaction.member;
            if (!member || !deps.canManageTicketActions(member)) {
                return "Only admins or the handler role can archive tickets.";
            }
            const target = deps.resolveTicketTargetChannelId(interaction);
            if (target.error || !target.channelId)
                return target.error || "Unable to resolve the target ticket channel.";
            const tracked = await deps.ensureTrackedTicketByChannelId(interaction.guild, target.channelId, interaction.user.id);
            if (!tracked)
                return "This channel is not a tracked ticket and could not be imported. Use ticket_channel_id or run /tickets.";
            const ticket = deps.findOpenTicketByChannel(target.channelId);
            if (!ticket)
                return "This is not an open ticket channel.";
            const reason = (interaction.options.getString("reason") || "Awaiting user confirmation / follow-up").slice(0, 220);
            const closeDedupeError = deps.rejectIfDuplicateCommand(interaction, `closeticket:${target.channelId}:reason:${reason}`);
            if (closeDedupeError)
                return closeDedupeError;
            const msg = await deps.closeTicketChannel(interaction.guild, target.channelId, interaction.user.id, reason);
            const archived = deps.findArchivedTicketByChannel(target.channelId);
            if (!archived)
                return msg;
            return deps.buildTicketCommandEmbedPayload("🔒 Ticket Archived", "Ticket moved to archive hold queue and set read-only for the owner.", archived, [
                { name: "👤 Archived By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "📝 Archive Reason", value: reason, inline: false },
                { name: "➡️ Next Step", value: "Use `/resolveticket` when this case is fully complete." }
            ]);
        },
        resolveticket: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            const member = interaction.member;
            if (!member || !deps.canManageTicketActions(member)) {
                return "Only admins or the handler role can permanently resolve archived tickets.";
            }
            const target = deps.resolveTicketTargetChannelId(interaction);
            if (target.error || !target.channelId)
                return target.error || "Unable to resolve the target ticket channel.";
            const tracked = await deps.ensureTrackedTicketByChannelId(interaction.guild, target.channelId, interaction.user.id);
            if (!tracked)
                return "This channel is not a tracked ticket and could not be imported. Use ticket_channel_id or run /tickets.";
            const ticket = deps.findArchivedTicketByChannel(target.channelId);
            if (!ticket)
                return "This is not an archived ticket channel.";
            const reason = (interaction.options.getString("reason") || "Issue resolved and archived workflow complete").slice(0, 220);
            const resolveDedupeError = deps.rejectIfDuplicateCommand(interaction, `resolveticket:${target.channelId}:reason:${reason}`);
            if (resolveDedupeError)
                return resolveDedupeError;
            const msg = await deps.resolveTicketChannel(interaction.guild, target.channelId, interaction.user.id, reason);
            const resolved = deps.findTicketByChannel(target.channelId);
            if (!resolved)
                return msg;
            return deps.buildTicketCommandEmbedPayload("✅ Ticket Resolved Permanently", "Ticket was resolved and permanently closed.", resolved, [
                { name: "👤 Resolved By", value: `<@${interaction.user.id}>`, inline: true },
                { name: "📝 Resolution Reason", value: reason, inline: false },
                { name: "📄 Transcript", value: resolved.transcript ? "Captured in ticket metadata/logs." : "No transcript snapshot available." }
            ]);
        },
        ticketconfig: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.Administrator)) {
                return "Only administrators can update ticket settings.";
            }
            const ticketConfigDedupeError = deps.rejectIfDuplicateCommand(interaction, "ticketconfig");
            if (ticketConfigDedupeError)
                return ticketConfigDedupeError;
            const cfg = deps.ensureTicketConfig(interaction.guildId);
            const category = interaction.options.getChannel("category");
            const archiveCategory = interaction.options.getChannel("archive_category");
            const logChannel = interaction.options.getChannel("log_channel");
            const reopenWindowHours = interaction.options.getInteger("reopen_window_hours");
            const exportWebhook = interaction.options.getString("export_webhook");
            let updated = false;
            if (category && category.type === discord_js_1.ChannelType.GuildCategory) {
                cfg.categoryId = category.id;
                updated = true;
            }
            if (archiveCategory && archiveCategory.type === discord_js_1.ChannelType.GuildCategory) {
                cfg.archiveCategoryId = archiveCategory.id;
                updated = true;
            }
            if (logChannel && logChannel.type === discord_js_1.ChannelType.GuildText) {
                cfg.logChannelId = logChannel.id;
                updated = true;
            }
            if (typeof reopenWindowHours === "number") {
                cfg.reopenWindowHours = Math.max(1, Math.min(720, reopenWindowHours));
                updated = true;
            }
            if (typeof exportWebhook === "string") {
                cfg.exportWebhookUrl = exportWebhook.trim() || null;
                updated = true;
            }
            if (updated) {
                deps.saveTicketStore();
                deps.appendAuditEvent("ticket_config_update", {
                    guildId: interaction.guildId,
                    categoryId: cfg.categoryId,
                    archiveCategoryId: cfg.archiveCategoryId,
                    logChannelId: cfg.logChannelId,
                    userId: interaction.user.id
                });
            }
            return [
                `🎛️ Ticket config for ${interaction.guild.name}:`,
                `🧰 Handler role: <@&${deps.TICKET_HANDLER_ROLE_ID}> (fixed)`,
                `📂 Category: ${cfg.categoryId ? `<#${cfg.categoryId}>` : `<#${deps.TICKET_DEFAULT_CATEGORY_ID}> (default)`}`,
                `🗃️ Archive category: ${cfg.archiveCategoryId ? `<#${cfg.archiveCategoryId}>` : "auto-create on first archive"}`,
                `🧾 Log channel: ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : "not set"}`,
                `🕒 Reopen window: ${cfg.reopenWindowHours || 72}h`,
                `📤 Export webhook: ${cfg.exportWebhookUrl ? "configured" : "not set"}`
            ].join("\n");
        },
        tickets: async (interaction) => {
            const guildError = deps.requireGuild(interaction);
            if (guildError)
                return guildError;
            if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageChannels)) {
                return "You need Manage Channels to view open tickets.";
            }
            await deps.pruneDeletedTicketRecords(interaction.guild);
            await deps.pruneInaccessibleOwnerTicketRecords(interaction.guild);
            const visible = deps.ticketStore.tickets
                .filter(t => t.guildId === interaction.guildId && t.status !== "resolved")
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 20);
            if (!visible.length)
                return "No active or archived tickets right now.";
            const lines = visible.map(t => {
                const sla = deps.getTicketSlaState(t);
                const slaText = `${sla.firstResponseOverdue ? "FR-BREACH" : "FR-OK"}/${sla.resolveOverdue ? "RES-BREACH" : "RES-OK"}`;
                return `#${t.id} [${t.status}|${t.workflowStatus}|${t.priority}] <#${t.channelId}> | Owner <@${t.ownerId}>${t.claimedById ? ` | Claimed <@${t.claimedById}>` : ""}${t.assignedToId ? ` | Assigned <@${t.assignedToId}>` : ""} | SLA ${slaText} | ${new Date(t.createdAt).toLocaleString()}`;
            });
            return `🎫 Ticket states:\n${lines.join("\n")}`;
        },
        ticketanalytics: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const guild = interaction.guild;
            if (!guild)
                return "This command can only be used in a server.";
            const summary = (0, ticketAnalytics_1.summarizeTicketAnalytics)(deps.ticketStore.tickets, guild.id, Date.now());
            const fmt = (value, unit) => value === null ? "n/a" : `${value}${unit}`;
            const categories = summary.categories.length
                ? summary.categories.map(c => `• ${c.category}: ${c.count} ticket(s) | median resolve ${fmt(c.medianResolutionMinutes, "m")}`).join("\n")
                : "No category data yet.";
            const embed = new discord_js_1.EmbedBuilder()
                .setColor(0x22c55e)
                .setTitle("📈 Ticket Analytics")
                .setDescription("Response/resolution performance snapshot with category-level insights.")
                .addFields({
                name: "State Totals",
                value: [
                    `Total: ${summary.total}`,
                    `Active: ${summary.active}`,
                    `Open: ${summary.open}`,
                    `Claimed: ${summary.claimed}`,
                    `Archived: ${summary.archived}`,
                    `Resolved: ${summary.resolved}`
                ].join("\n"),
                inline: false
            }, {
                name: "Median Performance",
                value: [
                    `First response median: ${fmt(summary.medianFirstResponseMinutes, "m")}`,
                    `Resolution median: ${fmt(summary.medianResolutionMinutes, "m")}`,
                    `First response median (7d): ${fmt(summary.medianFirstResponseLast7dMinutes, "m")}`,
                    `Resolution median (7d): ${fmt(summary.medianResolutionLast7dMinutes, "m")}`
                ].join("\n"),
                inline: false
            }, {
                name: "7-Day Trend",
                value: [
                    `Created: ${summary.createdLast7d}`,
                    `Resolved: ${summary.resolvedLast7d}`
                ].join("\n"),
                inline: false
            }, {
                name: "Satisfaction",
                value: [
                    `CSAT average: ${summary.csatAverage === null ? "n/a" : `${summary.csatAverage}/5`}`,
                    `Responses: ${summary.csatCount}`
                ].join("\n"),
                inline: false
            }, {
                name: "Top Categories",
                value: categories,
                inline: false
            })
                .setFooter({ text: `Triggered by ${interaction.user.username}` })
                .setTimestamp(new Date());
            deps.appendAuditEvent("ticket_analytics", {
                guildId: guild.id,
                userId: interaction.user.id,
                total: summary.total,
                active: summary.active,
                resolved: summary.resolved,
                medianFirstResponseMinutes: summary.medianFirstResponseMinutes,
                medianResolutionMinutes: summary.medianResolutionMinutes,
                createdLast7d: summary.createdLast7d,
                resolvedLast7d: summary.resolvedLast7d,
                csatAverage: summary.csatAverage,
                csatCount: summary.csatCount
            });
            return JSON.stringify({ embed: embed.toJSON() });
        }
    };
}
