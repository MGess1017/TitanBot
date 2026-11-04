"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffTicketCommands = exports.ticketReportCommands = void 0;
// Ticket, report, and staff ticket-tool slash commands.
const discord_js_1 = require("discord.js");
const ticketText_1 = require("../../services/ticketText");
const config_1 = require("../core/config");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const store_2 = require("../tickets/store");
const records_1 = require("../tickets/records");
const opsPanel_1 = require("../tickets/opsPanel");
const guards_1 = require("../core/guards");
const actions_1 = require("../tickets/actions");
const channels_1 = require("../tickets/channels");
const registry_1 = require("./registry");
const staffDesk_1 = require("../staff/staffDesk");
/** Ticket and member report commands. */
exports.ticketReportCommands = {
    ticket: async (interaction) => {
        return await registry_1.ticketCommandHandlers.ticket(interaction);
    },
    reportintake: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const target = interaction.options.getUser("user", true);
        const summary = interaction.options.getString("summary", true).trim();
        const details = (interaction.options.getString("details") || "").trim();
        const evidence = (interaction.options.getString("evidence") || "").trim() || null;
        const result = await (0, store_1.submitFormalUserReport)({
            guild,
            reporterId: interaction.user.id,
            targetUser: target,
            summary,
            details,
            evidence
        });
        return JSON.stringify({
            embed: new discord_js_1.EmbedBuilder()
                .setColor(result.flagged ? 0xdc2626 : 0x0ea5e9)
                .setTitle("🚨 Formal User Report Filed")
                .addFields({ name: "Report ID", value: `#${result.entry.id}`, inline: true }, { name: "Target", value: `<@${target.id}>`, inline: true }, { name: "Reporter", value: `<@${interaction.user.id}>`, inline: true }, { name: "Summary", value: result.entry.summary, inline: false }, { name: "Evidence", value: evidence || "Not provided", inline: false }, { name: "Total Reports On User", value: `${result.totalReportsForTarget}${result.flagged ? " 🚩" : ""}`, inline: true }, { name: "Logged Channel", value: `<#${config_1.REPORT_LOG_CHANNEL_ID}>`, inline: true })
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    reportprofile: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const target = interaction.options.getUser("user", true);
        const member = await guild.members.fetch(target.id).catch(() => null);
        const reports = (0, store_1.getGuildUserReports)(guild.id)
            .filter(report => report.targetUserId === target.id)
            .sort((a, b) => b.createdAt - a.createdAt);
        const flagged = reports.length >= 10;
        const recent = reports.slice(0, 8).map(report => {
            const state = report.status === "resolved" ? "resolved" : "open";
            return `#${report.id} [${state}] by <@${report.reporterId}> | ${report.summary.slice(0, 80)} | <t:${Math.floor(report.createdAt / 1000)}:R>`;
        });
        (0, audit_1.appendAuditEvent)("report_profile_view", {
            guildId: guild.id,
            actorId: interaction.user.id,
            targetUserId: target.id,
            totalReports: reports.length,
            flagged
        });
        return JSON.stringify({
            embed: new discord_js_1.EmbedBuilder()
                .setColor(flagged ? 0xdc2626 : 0x0ea5e9)
                .setTitle(`Report Profile: ${target.username}`)
                .addFields({ name: "Discord User", value: `<@${target.id}>`, inline: true }, { name: "User ID", value: target.id, inline: true }, { name: "Account Created", value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`, inline: true }, { name: "Joined Server", value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Unknown", inline: true }, { name: "Reports Filed Against User", value: `${reports.length}`, inline: true }, { name: "Risk Flag", value: flagged ? "🚩 Flagged (10+ reports)" : "No flag", inline: true }, { name: "Recent Reports", value: recent.length ? recent.join("\n") : "No reports filed against this user.", inline: false })
                .setFooter({ text: `Report logs channel: ${config_1.REPORT_LOG_CHANNEL_ID}` })
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    ticketintake: async () => {
        return "Ticket intake modal is ready. Run /ticketintake again if you did not receive the popup.";
    },
    ticketforce: async (interaction) => {
        const guildError = (0, guards_1.requireGuild)(interaction);
        if (guildError)
            return guildError;
        const reason = (interaction.options.getString("reason", true) || "General support").slice(0, 180);
        const priority = (0, store_2.normalizeTicketPriority)(interaction.options.getString("priority") || "normal");
        const created = await (0, channels_1.createTicketChannel)(interaction.guild, interaction.user.id, reason, priority, true);
        if (created.error)
            return created.error;
        const ticket = created.channelId ? (0, store_2.findTicketByChannel)(created.channelId) : null;
        return (0, opsPanel_1.buildTicketCommandEmbedPayload)("🎫 Ticket Force-Opened", "Duplicate/KB deflection bypassed by manual override.", ticket || undefined, [
            { name: "📝 Reason", value: reason, inline: false },
            { name: "⚠️ Override", value: "Deflection bypass enabled.", inline: true }
        ]);
    },
    ticketpanel: async (interaction) => {
        return await registry_1.ticketCommandHandlers.ticketpanel(interaction);
    },
    claimticket: async (interaction) => {
        return await registry_1.ticketCommandHandlers.claimticket(interaction);
    },
    ticketassign: async (interaction) => {
        return await registry_1.ticketCommandHandlers.ticketassign(interaction);
    },
    ticketstatus: async (interaction) => {
        return await registry_1.ticketCommandHandlers.ticketstatus(interaction);
    },
    reopenticket: async (interaction) => {
        return await registry_1.ticketCommandHandlers.reopenticket(interaction);
    },
    closeticket: async (interaction) => {
        return await registry_1.ticketCommandHandlers.closeticket(interaction);
    },
    resolveticket: async (interaction) => {
        return await registry_1.ticketCommandHandlers.resolveticket(interaction);
    },
    ticketconfig: async (interaction) => {
        return await registry_1.ticketCommandHandlers.ticketconfig(interaction);
    },
    tickets: async (interaction) => {
        return await registry_1.ticketCommandHandlers.tickets(interaction);
    },
    ticketanalytics: async (interaction) => {
        return await registry_1.ticketCommandHandlers.ticketanalytics(interaction);
    },
    reportqueue: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const openReports = (0, store_1.getGuildUserReports)(guild.id)
            .filter(report => report.status === "open")
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 25);
        if (!openReports.length)
            return "No active formal reports right now.";
        const lines = openReports.map(report => `#${report.id} target <@${report.targetUserId}> | reporter <@${report.reporterId}> | ${report.summary.slice(0, 90)} | <t:${Math.floor(report.createdAt / 1000)}:R>`);
        (0, audit_1.appendAuditEvent)("report_queue_view", {
            guildId: guild.id,
            actorId: interaction.user.id,
            total: openReports.length,
            source: "admin_report_ledger"
        });
        return ["🚨 Formal Report Queue", `Showing ${openReports.length} open report(s)`, "", ...lines].join("\n");
    },
    reportresolve: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const target = interaction.options.getUser("user", true);
        const action = interaction.options.getString("action", true);
        const reason = (interaction.options.getString("reason") || "Report review completed").trim();
        const reportId = interaction.options.getInteger("report_id") || undefined;
        const resolved = await (0, store_1.resolveFormalUserReport)({
            guild,
            actorId: interaction.user.id,
            targetUserId: target.id,
            action,
            reason,
            reportId
        });
        if (!resolved.ok)
            return resolved.error;
        return JSON.stringify({
            embed: new discord_js_1.EmbedBuilder()
                .setColor(0x16a34a)
                .setTitle("✅ Report Closed")
                .addFields({ name: "Report ID", value: `#${resolved.entry.id}`, inline: true }, { name: "Target", value: `<@${target.id}>`, inline: true }, { name: "Resolved By", value: `<@${interaction.user.id}>`, inline: true }, { name: "Disposition", value: action, inline: true }, { name: "Reason", value: reason, inline: false }, { name: "Remaining Open Reports On User", value: `${resolved.remainingOpenForTarget}`, inline: true }, { name: "Logged Channel", value: `<#${config_1.REPORT_LOG_CHANNEL_ID}>`, inline: true })
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    reportanalytics: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const scoped = (0, store_1.getGuildUserReports)(guild.id);
        const open = scoped.filter(report => report.status === "open").length;
        const resolved = scoped.filter(report => report.status === "resolved").length;
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const createdLast7d = scoped.filter(report => report.createdAt >= sevenDaysAgo).length;
        const resolvedLast7d = scoped.filter(report => report.status === "resolved" && (report.resolvedAt || 0) >= sevenDaysAgo).length;
        const byTarget = new Map();
        for (const report of scoped) {
            byTarget.set(report.targetUserId, (byTarget.get(report.targetUserId) || 0) + 1);
        }
        const flaggedUsers = [...byTarget.values()].filter(count => count >= 10).length;
        (0, audit_1.appendAuditEvent)("report_analytics", {
            guildId: guild.id,
            userId: interaction.user.id,
            total: scoped.length,
            open,
            resolved,
            createdLast7d,
            resolvedLast7d,
            flaggedUsers
        });
        return JSON.stringify({
            embed: new discord_js_1.EmbedBuilder()
                .setColor(0xb91c1c)
                .setTitle("🚨 Report Analytics")
                .setDescription("Admin report ledger throughput and risk snapshot.")
                .addFields({ name: "Case Totals", value: [`Total: ${scoped.length}`, `Open: ${open}`, `Resolved: ${resolved}`].join("\n"), inline: false }, { name: "7-Day Flow", value: [`Created: ${createdLast7d}`, `Resolved: ${resolvedLast7d}`].join("\n"), inline: true }, { name: "Risk", value: `Flagged users (10+ reports): ${flaggedUsers}`, inline: true }, { name: "Log Channel", value: `<#${config_1.REPORT_LOG_CHANNEL_ID}>`, inline: false })
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    reportsearch: async (interaction) => {
        const guildError = (0, guards_1.requireGuild)(interaction);
        if (guildError)
            return guildError;
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        const owner = interaction.options.getUser("owner");
        const status = interaction.options.getString("status");
        const query = (interaction.options.getString("query") || "").trim().toLowerCase();
        const page = Math.max(1, interaction.options.getInteger("page") || 1);
        const pageSize = Math.max(5, Math.min(20, interaction.options.getInteger("page_size") || 10));
        let scoped = (0, store_1.getGuildUserReports)(guild.id);
        if (owner) {
            scoped = scoped.filter(report => report.reporterId === owner.id);
        }
        if (status && (status === "open" || status === "resolved")) {
            scoped = scoped.filter(report => report.status === status);
        }
        if (query) {
            scoped = scoped.filter(report => {
                const haystack = [
                    report.summary,
                    report.details,
                    report.evidence || "",
                    report.targetTag,
                    report.targetUserId,
                    report.reporterId
                ].join(" ").toLowerCase();
                return haystack.includes(query);
            });
        }
        scoped = scoped.sort((a, b) => b.createdAt - a.createdAt);
        const total = scoped.length;
        if (!total) {
            return "No formal reports matched your filters.";
        }
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * pageSize;
        const visible = scoped.slice(start, start + pageSize);
        const lines = visible.map(report => {
            const state = report.status === "resolved" ? "resolved" : "open";
            return `#${report.id} [${state}] target <@${report.targetUserId}> | reporter <@${report.reporterId}> | ${report.summary.slice(0, 90)} | <t:${Math.floor(report.createdAt / 1000)}:R>`;
        });
        (0, audit_1.appendAuditEvent)("report_search", {
            guildId: guild.id,
            actorId: interaction.user.id,
            filters: {
                ownerId: owner?.id || null,
                status: status || null,
                query: query || null,
                page: safePage,
                pageSize
            },
            total
        });
        const filterSummary = [
            owner ? `owner=<@${owner.id}>` : null,
            status ? `status=${status}` : null,
            query ? `query=${query}` : null
        ].filter(Boolean).join(", ") || "none";
        return [
            "🚨 Formal Report Search Results",
            `Filters: ${filterSummary}`,
            `Page ${safePage}/${totalPages} | Showing ${visible.length}/${total}`,
            "",
            ...lines
        ].join("\n");
    }
};
/** Staff desk and advanced ticket tools. */
exports.staffTicketCommands = {
    staff: async (interaction) => {
        if (!interaction.guild || !(0, staffDesk_1.isStaffMember)(interaction.member))
            return "Staff only. This desk is for administrators and configured staff roles.";
        return JSON.stringify({ ...(0, staffDesk_1.buildStaffHomeFor)(interaction.guild.id, interaction.channelId), staffPayload: true });
    },
    ticketworkload: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        const statusFilter = interaction.options.getString("status");
        const priorityFilter = interaction.options.getString("priority");
        const categoryFilter = interaction.options.getString("category");
        const active = store_2.ticketStore.tickets.filter(ticket => ticket.guildId === guild.id && ticket.status !== "resolved")
            .filter(ticket => !statusFilter || ticket.workflowStatus === statusFilter)
            .filter(ticket => !priorityFilter || ticket.priority === priorityFilter)
            .filter(ticket => !categoryFilter || ticket.category === categoryFilter);
        const byAssignee = new Map();
        for (const ticket of active) {
            const assignee = ticket.assignedToId || ticket.claimedById || "unassigned";
            byAssignee.set(assignee, (byAssignee.get(assignee) || 0) + 1);
        }
        const rows = Array.from(byAssignee.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([id, count]) => `${id === "unassigned" ? "Unassigned" : `<@${id}>`}: ${count}`);
        const breachRisk = active
            .filter(ticket => {
            const sla = (0, records_1.getTicketSlaState)(ticket, Date.now(), (0, store_2.buildTicketSlaThresholds)(ticket));
            return sla.firstResponseOverdue || sla.resolveOverdue;
        }).length;
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(0x0891b2)
            .setTitle("🧮 Ticket Workload")
            .addFields({ name: "Active Tickets", value: String(active.length), inline: true }, { name: "SLA Risk", value: String(breachRisk), inline: true }, { name: "Coverage", value: rows.length ? rows.join("\n") : "No active assignments", inline: false })
            .setTimestamp(new Date());
        return JSON.stringify({ embed: embed.toJSON() });
    },
    ticketnote: async (interaction) => {
        const guildError = (0, guards_1.requireGuild)(interaction);
        if (guildError)
            return guildError;
        const member = interaction.member;
        if (!member || !(0, actions_1.canManageTicketActions)(member))
            return "Only admins or the handler role can add internal notes.";
        const target = (0, actions_1.resolveTicketTargetChannelId)(interaction);
        if (target.error || !target.channelId)
            return target.error || "Unable to resolve ticket channel.";
        const ticket = await (0, records_1.ensureTrackedTicketByChannelId)(interaction.guild, target.channelId, interaction.user.id);
        if (!ticket)
            return "Ticket not found for this channel.";
        const note = (interaction.options.getString("note", true) || "").slice(0, 500);
        const saved = (0, records_1.addTicketInternalNote)(ticket, { byId: interaction.user.id, at: Date.now(), note });
        if (!saved)
            return "Unable to persist ticket note due to a store conflict. Please retry.";
        return `Saved internal note on ticket #${ticket.id}.`;
    },
    tickettimeline: async (interaction) => {
        const guildError = (0, guards_1.requireGuild)(interaction);
        if (guildError)
            return guildError;
        const member = interaction.member;
        if (!member || !(0, actions_1.canManageTicketActions)(member))
            return "Only admins or the handler role can view internal timelines.";
        const target = (0, actions_1.resolveTicketTargetChannelId)(interaction);
        if (target.error || !target.channelId)
            return target.error || "Unable to resolve ticket channel.";
        const ticket = await (0, records_1.ensureTrackedTicketByChannelId)(interaction.guild, target.channelId, interaction.user.id);
        if (!ticket)
            return "Ticket not found for this channel.";
        const notes = (ticket.internalNotes || []).slice(-10).map(note => `• <t:${Math.floor(note.at / 1000)}:f> <@${note.byId}>: ${note.note}`);
        const events = (ticket.events || []).slice(-10).map(event => `• <t:${Math.floor(event.at / 1000)}:f> ${event.type}: ${event.detail}`);
        const templates = Object.entries(store_2.TICKET_RESPONSE_TEMPLATES).map(([key, text]) => `• ${key}: ${text}`);
        const meta = [
            `Ticket #${ticket.id}`,
            `Status: ${ticket.status}/${ticket.workflowStatus}`,
            `Category: ${ticket.category || "general"}`,
            `Parent: ${ticket.parentTicketId ? `#${ticket.parentTicketId}` : "none"}`,
            `Linked: ${ticket.linkedTicketId ? `#${ticket.linkedTicketId}` : "none"}`
        ];
        return `${meta.join("\n")}\n\nTimeline:\n${events.length ? events.join("\n") : "No timeline events yet."}\n\nNotes:\n${notes.length ? notes.join("\n") : "No internal notes yet."}\n\nSaved Responses:\n${templates.join("\n")}`;
    },
    ticketmerge: async (interaction) => {
        const guildError = (0, guards_1.requireGuild)(interaction);
        if (guildError)
            return guildError;
        const member = interaction.member;
        if (!member || !(0, actions_1.canManageTicketActions)(member))
            return "Only admins or the handler role can merge tickets.";
        const parentId = interaction.options.getInteger("parent_ticket_id", true);
        const childId = interaction.options.getInteger("child_ticket_id", true);
        if (parentId === childId)
            return "Parent and child ticket IDs must differ.";
        const parent = (0, store_2.findTicketById)(parentId);
        const child = (0, store_2.findTicketById)(childId);
        if (!parent || !child || parent.guildId !== interaction.guildId || child.guildId !== interaction.guildId) {
            return "Parent/child ticket was not found in this guild.";
        }
        child.mergedIntoTicketId = parent.id;
        child.linkedTicketId = parent.id;
        child.updatedAt = Date.now();
        parent.childTicketIds = Array.from(new Set([...(parent.childTicketIds || []), child.id]));
        parent.updatedAt = Date.now();
        if (!(0, store_2.saveTicketStore)())
            return "Unable to persist merge due to a store conflict. Please retry.";
        (0, audit_1.appendAuditEvent)("ticket_merge", { guildId: interaction.guildId, parentId, childId, actorId: interaction.user.id });
        return `Merged child ticket #${child.id} into parent #${parent.id}.`;
    },
    ticketlink: async (interaction) => {
        const guildError = (0, guards_1.requireGuild)(interaction);
        if (guildError)
            return guildError;
        const member = interaction.member;
        if (!member || !(0, actions_1.canManageTicketActions)(member))
            return "Only admins or the handler role can link tickets.";
        const parentId = interaction.options.getInteger("parent_ticket_id", true);
        const target = (0, actions_1.resolveTicketTargetChannelId)(interaction);
        if (target.error || !target.channelId)
            return target.error || "Unable to resolve ticket channel.";
        const child = (0, store_2.findTicketByChannel)(target.channelId);
        const parent = (0, store_2.findTicketById)(parentId);
        if (!child || !parent || parent.guildId !== interaction.guildId || child.guildId !== interaction.guildId)
            return "Parent/child ticket not found.";
        child.parentTicketId = parent.id;
        child.linkedTicketId = parent.id;
        child.updatedAt = Date.now();
        parent.childTicketIds = Array.from(new Set([...(parent.childTicketIds || []), child.id]));
        parent.updatedAt = Date.now();
        if (!(0, store_2.saveTicketStore)())
            return "Unable to persist link due to a store conflict. Please retry.";
        (0, audit_1.appendAuditEvent)("ticket_link", { guildId: interaction.guildId, parentId: parent.id, childId: child.id, actorId: interaction.user.id });
        return `Linked ticket #${child.id} under parent #${parent.id}.`;
    },
    ticketexport: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        const cfg = (0, store_2.ensureTicketConfig)(guild.id);
        const sink = cfg.exportWebhookUrl || config_1.TICKET_EXPORT_WEBHOOK_URL;
        if (!sink)
            return "No export webhook configured. Set one in ticket config env or /ticketconfig updates.";
        const limit = Math.max(1, Math.min(50, interaction.options.getInteger("limit") || 10));
        const resolved = store_2.ticketStore.tickets
            .filter(ticket => ticket.guildId === guild.id && ticket.status === "resolved")
            .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
            .slice(0, limit);
        if (!resolved.length)
            return "No resolved tickets available for export.";
        let sent = 0;
        for (const ticket of resolved) {
            const safeTicket = {
                ...ticket,
                reason: (0, ticketText_1.sanitizeTranscriptLine)(ticket.reason),
                intakeSummary: ticket.intakeSummary ? (0, ticketText_1.sanitizeTranscriptLine)(ticket.intakeSummary) : ticket.intakeSummary,
                intakeDetails: ticket.intakeDetails ? (0, ticketText_1.sanitizeTranscriptLine)(ticket.intakeDetails) : ticket.intakeDetails,
                intakeEvidence: ticket.intakeEvidence ? (0, ticketText_1.sanitizeTranscriptLine)(ticket.intakeEvidence) : ticket.intakeEvidence,
                internalNotes: (ticket.internalNotes || []).map(note => ({ ...note, note: (0, ticketText_1.sanitizeTranscriptLine)(note.note) }))
            };
            const ok = await (0, records_1.postJsonToWebhook)(sink, { type: "ticket_export", guildId: guild.id, ticket: safeTicket });
            if (ok)
                sent += 1;
        }
        (0, audit_1.appendAuditEvent)("ticket_export_batch", { guildId: guild.id, requested: limit, sent, total: resolved.length });
        return `Exported ${sent}/${resolved.length} resolved tickets.`;
    },
    ticketretention: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        const cfg = (0, store_2.ensureTicketConfig)(guild.id);
        const days = interaction.options.getInteger("days");
        if (typeof days === "number") {
            cfg.retentionDays = Math.max(1, Math.min(3650, days));
            (0, store_2.saveTicketStore)();
        }
        const purgeNow = interaction.options.getBoolean("purge_now") || false;
        const removed = purgeNow ? (0, store_2.purgeResolvedTicketsByRetention)(guild.id) : 0;
        return [
            `Retention: ${cfg.retentionDays || 45} day(s)`,
            `Reopen window: ${cfg.reopenWindowHours || 72} hour(s)`,
            purgeNow ? `Purged resolved tickets: ${removed}` : "Purge not requested"
        ].join("\n");
    }
};
