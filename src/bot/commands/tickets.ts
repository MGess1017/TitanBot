// Ticket, report, and staff ticket-tool slash commands.
import { ChannelType, EmbedBuilder, GuildMember } from "discord.js";
import { sanitizeTranscriptLine } from "../../services/ticketText";
import { REPORT_LOG_CHANNEL_ID, TICKET_EXPORT_WEBHOOK_URL } from "../core/config";
import { appendAuditEvent } from "../core/audit";
import { getGuildUserReports, resolveFormalUserReport, submitFormalUserReport } from "../moderation/store";
import {
    buildTicketSlaThresholds, ensureTicketConfig, findTicketByChannel, findTicketById, normalizeTicketPriority,
    purgeResolvedTicketsByRetention, saveTicketStore, TICKET_RESPONSE_TEMPLATES, ticketStore
} from "../tickets/store";
import {
    addTicketInternalNote, ensureTrackedTicketByChannelId, getTicketSlaState, postJsonToWebhook
} from "../tickets/records";
import { buildTicketCommandEmbedPayload } from "../tickets/opsPanel";
import { requireAdministrator, requireGuild } from "../core/guards";
import { canManageTicketActions, resolveTicketTargetChannelId } from "../tickets/actions";
import { createTicketChannel } from "../tickets/channels";
import { type CommandHandlerMap, ticketCommandHandlers } from "./registry";
import { buildStaffHomeFor, isStaffMember } from "../staff/staffDesk";
import { buildResolveConfirmation } from "../tickets/experience";

/** Ticket and member report commands. */
export const ticketReportCommands: CommandHandlerMap = {
    ticket: async interaction => {
        return await ticketCommandHandlers.ticket(interaction);
    },
    reportintake: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const target = interaction.options.getUser("user", true);
        const summary = interaction.options.getString("summary", true).trim();
        const details = (interaction.options.getString("details") || "").trim();
        const evidence = (interaction.options.getString("evidence") || "").trim() || null;

        const result = await submitFormalUserReport({
            guild,
            reporterId: interaction.user.id,
            targetUser: target,
            summary,
            details,
            evidence
        });

        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(result.flagged ? 0xdc2626 : 0x0ea5e9)
                .setTitle("🚨 Formal User Report Filed")
                .addFields(
                    { name: "Report ID", value: `#${result.entry.id}`, inline: true },
                    { name: "Target", value: `<@${target.id}>`, inline: true },
                    { name: "Reporter", value: `<@${interaction.user.id}>`, inline: true },
                    { name: "Summary", value: result.entry.summary, inline: false },
                    { name: "Evidence", value: evidence || "Not provided", inline: false },
                    { name: "Total Reports On User", value: `${result.totalReportsForTarget}${result.flagged ? " 🚩" : ""}`, inline: true },
                    { name: "Logged Channel", value: `<#${REPORT_LOG_CHANNEL_ID}>`, inline: true }
                )
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    reportprofile: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const target = interaction.options.getUser("user", true);
        const member = await guild.members.fetch(target.id).catch(() => null);
        const reports = getGuildUserReports(guild.id)
            .filter(report => report.targetUserId === target.id)
            .sort((a, b) => b.createdAt - a.createdAt);

        const flagged = reports.length >= 10;
        const recent = reports.slice(0, 8).map(report => {
            const state = report.status === "resolved" ? "resolved" : "open";
            return `#${report.id} [${state}] by <@${report.reporterId}> | ${report.summary.slice(0, 80)} | <t:${Math.floor(report.createdAt / 1000)}:R>`;
        });

        appendAuditEvent("report_profile_view", {
            guildId: guild.id,
            actorId: interaction.user.id,
            targetUserId: target.id,
            totalReports: reports.length,
            flagged
        });

        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(flagged ? 0xdc2626 : 0x0ea5e9)
                .setTitle(`Report Profile: ${target.username}`)
                .addFields(
                    { name: "Discord User", value: `<@${target.id}>`, inline: true },
                    { name: "User ID", value: target.id, inline: true },
                    { name: "Account Created", value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`, inline: true },
                    { name: "Joined Server", value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Unknown", inline: true },
                    { name: "Reports Filed Against User", value: `${reports.length}`, inline: true },
                    { name: "Risk Flag", value: flagged ? "🚩 Flagged (10+ reports)" : "No flag", inline: true },
                    { name: "Recent Reports", value: recent.length ? recent.join("\n") : "No reports filed against this user.", inline: false }
                )
                .setFooter({ text: `Report logs channel: ${REPORT_LOG_CHANNEL_ID}` })
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    ticketintake: async () => {
        return "Ticket intake modal is ready. Run /ticketintake again if you did not receive the popup.";
    },
    ticketforce: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const reason = (interaction.options.getString("reason", true) || "General support").slice(0, 180);
        const priority = normalizeTicketPriority(interaction.options.getString("priority") || "normal");
        const created = await createTicketChannel(interaction.guild!, interaction.user.id, reason, priority, true);
        if (created.error) return created.error;
        const ticket = created.channelId ? findTicketByChannel(created.channelId) : null;
        return buildTicketCommandEmbedPayload(
            "🎫 Ticket Force-Opened",
            "Duplicate/KB deflection bypassed by manual override.",
            ticket || undefined,
            [
                { name: "📝 Reason", value: reason, inline: false },
                { name: "⚠️ Override", value: "Deflection bypass enabled.", inline: true }
            ]
        );
    },
    ticketpanel: async interaction => {
        return await ticketCommandHandlers.ticketpanel(interaction);
    },
    claimticket: async interaction => {
        return await ticketCommandHandlers.claimticket(interaction);
    },
    ticketassign: async interaction => {
        return await ticketCommandHandlers.ticketassign(interaction);
    },
    ticketstatus: async interaction => {
        return await ticketCommandHandlers.ticketstatus(interaction);
    },
    reopenticket: async interaction => {
        const result = await ticketCommandHandlers.reopenticket(interaction);
        if (interaction.guild && interaction.member && canManageTicketActions(interaction.member as GuildMember)) {
            const target = resolveTicketTargetChannelId(interaction);
            const ticket = target.channelId ? findTicketByChannel(target.channelId) : null;
            if (ticket?.status === "claimed" && result.includes("Ticket Reopened")) {
                const channel = await interaction.guild.channels.fetch(ticket.channelId);
                if (channel?.type === ChannelType.GuildText) {
                    await channel.permissionOverwrites.edit(ticket.ownerId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
                    await channel.setTopic((channel.topic || "").replace(/\s*\[ticket-archived\]/g, ""));
                }
            }
        }
        return result;
    },
    closeticket: async interaction => {
        return await ticketCommandHandlers.closeticket(interaction);
    },
    resolveticket: async interaction => {
        if (!interaction.guild || !interaction.member || !canManageTicketActions(interaction.member as GuildMember)) return "Only support staff can permanently resolve tickets.";
        const target = resolveTicketTargetChannelId(interaction);
        if (!target.channelId || target.error) return target.error || "Choose a ticket channel.";
        const ticket = findTicketByChannel(target.channelId);
        if (!ticket || ticket.guildId !== interaction.guild.id || ticket.status !== "archived") return "Close the ticket before permanently resolving it.";
        const confirmation = buildResolveConfirmation(ticket, interaction.user.id, interaction.options.getString("reason") || undefined);
        return JSON.stringify({
            embed: confirmation.embeds[0].setDescription(confirmation.content).toJSON(),
            components: confirmation.components.map(row => row.toJSON()),
            ephemeral: true
        });
    },
    ticketconfig: async interaction => {
        return await ticketCommandHandlers.ticketconfig(interaction);
    },
    tickets: async interaction => {
        return await ticketCommandHandlers.tickets(interaction);
    },
    ticketanalytics: async interaction => {
        return await ticketCommandHandlers.ticketanalytics(interaction);
    },
    reportqueue: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const openReports = getGuildUserReports(guild.id)
            .filter(report => report.status === "open")
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 25);

        if (!openReports.length) return "No active formal reports right now.";

        const lines = openReports.map(report => `#${report.id} target <@${report.targetUserId}> | reporter <@${report.reporterId}> | ${report.summary.slice(0, 90)} | <t:${Math.floor(report.createdAt / 1000)}:R>`);

        appendAuditEvent("report_queue_view", {
            guildId: guild.id,
            actorId: interaction.user.id,
            total: openReports.length,
            source: "admin_report_ledger"
        });

        return ["🚨 Formal Report Queue", `Showing ${openReports.length} open report(s)`, "", ...lines].join("\n");
    },
    reportresolve: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const target = interaction.options.getUser("user", true);
        const action = interaction.options.getString("action", true);
        const reason = (interaction.options.getString("reason") || "Report review completed").trim();
        const reportId = interaction.options.getInteger("report_id") || undefined;

        const resolved = await resolveFormalUserReport({
            guild,
            actorId: interaction.user.id,
            targetUserId: target.id,
            action,
            reason,
            reportId
        });

        if (!resolved.ok) return resolved.error;

        return JSON.stringify({
            embed: new EmbedBuilder()
                .setColor(0x16a34a)
                .setTitle("✅ Report Closed")
                .addFields(
                    { name: "Report ID", value: `#${resolved.entry.id}`, inline: true },
                    { name: "Target", value: `<@${target.id}>`, inline: true },
                    { name: "Resolved By", value: `<@${interaction.user.id}>`, inline: true },
                    { name: "Disposition", value: action, inline: true },
                    { name: "Reason", value: reason, inline: false },
                    { name: "Remaining Open Reports On User", value: `${resolved.remainingOpenForTarget}`, inline: true },
                    { name: "Logged Channel", value: `<#${REPORT_LOG_CHANNEL_ID}>`, inline: true }
                )
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    reportanalytics: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild;
        if (!guild) return "This command can only be used in a server.";

        const scoped = getGuildUserReports(guild.id);
        const open = scoped.filter(report => report.status === "open").length;
        const resolved = scoped.filter(report => report.status === "resolved").length;
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const createdLast7d = scoped.filter(report => report.createdAt >= sevenDaysAgo).length;
        const resolvedLast7d = scoped.filter(report => report.status === "resolved" && (report.resolvedAt || 0) >= sevenDaysAgo).length;
        const byTarget = new Map<string, number>();
        for (const report of scoped) {
            byTarget.set(report.targetUserId, (byTarget.get(report.targetUserId) || 0) + 1);
        }
        const flaggedUsers = [...byTarget.values()].filter(count => count >= 10).length;

        appendAuditEvent("report_analytics", {
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
            embed: new EmbedBuilder()
                .setColor(0xb91c1c)
                .setTitle("🚨 Report Analytics")
                .setDescription("Admin report ledger throughput and risk snapshot.")
                .addFields(
                    { name: "Case Totals", value: [`Total: ${scoped.length}`, `Open: ${open}`, `Resolved: ${resolved}`].join("\n"), inline: false },
                    { name: "7-Day Flow", value: [`Created: ${createdLast7d}`, `Resolved: ${resolvedLast7d}`].join("\n"), inline: true },
                    { name: "Risk", value: `Flagged users (10+ reports): ${flaggedUsers}`, inline: true },
                    { name: "Log Channel", value: `<#${REPORT_LOG_CHANNEL_ID}>`, inline: false }
                )
                .setTimestamp(new Date())
                .toJSON()
        });
    },
    reportsearch: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;

        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;

        const guild = interaction.guild!;
        const owner = interaction.options.getUser("owner");
        const status = interaction.options.getString("status");
        const query = (interaction.options.getString("query") || "").trim().toLowerCase();
        const page = Math.max(1, interaction.options.getInteger("page") || 1);
        const pageSize = Math.max(5, Math.min(20, interaction.options.getInteger("page_size") || 10));

        let scoped = getGuildUserReports(guild.id);

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

        appendAuditEvent("report_search", {
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
export const staffTicketCommands: CommandHandlerMap = {
    staff: async interaction => {
        if (!interaction.guild || !isStaffMember(interaction.member)) return "Staff only. This desk is for administrators and configured staff roles.";
        return JSON.stringify({ ...buildStaffHomeFor(interaction.guild.id, interaction.channelId), staffPayload: true });
    },
    ticketworkload: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild!;
        const statusFilter = interaction.options.getString("status");
        const priorityFilter = interaction.options.getString("priority");
        const categoryFilter = interaction.options.getString("category");
        const active = ticketStore.tickets.filter(ticket => ticket.guildId === guild.id && ticket.status !== "resolved")
            .filter(ticket => !statusFilter || ticket.workflowStatus === statusFilter)
            .filter(ticket => !priorityFilter || ticket.priority === priorityFilter)
            .filter(ticket => !categoryFilter || ticket.category === categoryFilter);
        const byAssignee = new Map<string, number>();
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
                const sla = getTicketSlaState(ticket, Date.now(), buildTicketSlaThresholds(ticket));
                return sla.firstResponseOverdue || sla.resolveOverdue;
            }).length;

        const embed = new EmbedBuilder()
            .setColor(0x0891b2)
            .setTitle("🧮 Ticket Workload")
            .addFields(
                { name: "Active Tickets", value: String(active.length), inline: true },
                { name: "SLA Risk", value: String(breachRisk), inline: true },
                { name: "Coverage", value: rows.length ? rows.join("\n") : "No active assignments", inline: false }
            )
            .setTimestamp(new Date());

        return JSON.stringify({ embed: embed.toJSON() });
    },
    ticketnote: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) return "Only admins or the handler role can add internal notes.";
        const target = resolveTicketTargetChannelId(interaction);
        if (target.error || !target.channelId) return target.error || "Unable to resolve ticket channel.";
        const ticket = await ensureTrackedTicketByChannelId(interaction.guild!, target.channelId, interaction.user.id);
        if (!ticket) return "Ticket not found for this channel.";
        const note = (interaction.options.getString("note", true) || "").slice(0, 500);
        const saved = addTicketInternalNote(ticket, { byId: interaction.user.id, at: Date.now(), note });
        if (!saved) return "Unable to persist ticket note due to a store conflict. Please retry.";
        return `Saved internal note on ticket #${ticket.id}.`;
    },
    tickettimeline: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) return "Only admins or the handler role can view internal timelines.";
        const target = resolveTicketTargetChannelId(interaction);
        if (target.error || !target.channelId) return target.error || "Unable to resolve ticket channel.";
        const ticket = await ensureTrackedTicketByChannelId(interaction.guild!, target.channelId, interaction.user.id);
        if (!ticket) return "Ticket not found for this channel.";
        const notes = (ticket.internalNotes || []).slice(-10).map(note => `• <t:${Math.floor(note.at / 1000)}:f> <@${note.byId}>: ${note.note}`);
        const events = (ticket.events || []).slice(-10).map(event => `• <t:${Math.floor(event.at / 1000)}:f> ${event.type}: ${event.detail}`);
        const templates = Object.entries(TICKET_RESPONSE_TEMPLATES).map(([key, text]) => `• ${key}: ${text}`);
        const meta = [
            `Ticket #${ticket.id}`,
            `Status: ${ticket.status}/${ticket.workflowStatus}`,
            `Category: ${ticket.category || "general"}`,
            `Parent: ${ticket.parentTicketId ? `#${ticket.parentTicketId}` : "none"}`,
            `Linked: ${ticket.linkedTicketId ? `#${ticket.linkedTicketId}` : "none"}`
        ];
        return `${meta.join("\n")}\n\nTimeline:\n${events.length ? events.join("\n") : "No timeline events yet."}\n\nNotes:\n${notes.length ? notes.join("\n") : "No internal notes yet."}\n\nSaved Responses:\n${templates.join("\n")}`;
    },
    ticketmerge: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) return "Only admins or the handler role can merge tickets.";
        const parentId = interaction.options.getInteger("parent_ticket_id", true);
        const childId = interaction.options.getInteger("child_ticket_id", true);
        if (parentId === childId) return "Parent and child ticket IDs must differ.";
        const parent = findTicketById(parentId);
        const child = findTicketById(childId);
        if (!parent || !child || parent.guildId !== interaction.guildId || child.guildId !== interaction.guildId) {
            return "Parent/child ticket was not found in this guild.";
        }
        child.mergedIntoTicketId = parent.id;
        child.linkedTicketId = parent.id;
        child.updatedAt = Date.now();
        parent.childTicketIds = Array.from(new Set([...(parent.childTicketIds || []), child.id]));
        parent.updatedAt = Date.now();
        if (!saveTicketStore()) return "Unable to persist merge due to a store conflict. Please retry.";
        appendAuditEvent("ticket_merge", { guildId: interaction.guildId, parentId, childId, actorId: interaction.user.id });
        return `Merged child ticket #${child.id} into parent #${parent.id}.`;
    },
    ticketlink: async interaction => {
        const guildError = requireGuild(interaction);
        if (guildError) return guildError;
        const member = interaction.member as GuildMember | null;
        if (!member || !canManageTicketActions(member)) return "Only admins or the handler role can link tickets.";
        const parentId = interaction.options.getInteger("parent_ticket_id", true);
        const target = resolveTicketTargetChannelId(interaction);
        if (target.error || !target.channelId) return target.error || "Unable to resolve ticket channel.";
        const child = findTicketByChannel(target.channelId);
        const parent = findTicketById(parentId);
        if (!child || !parent || parent.guildId !== interaction.guildId || child.guildId !== interaction.guildId) return "Parent/child ticket not found.";
        child.parentTicketId = parent.id;
        child.linkedTicketId = parent.id;
        child.updatedAt = Date.now();
        parent.childTicketIds = Array.from(new Set([...(parent.childTicketIds || []), child.id]));
        parent.updatedAt = Date.now();
        if (!saveTicketStore()) return "Unable to persist link due to a store conflict. Please retry.";
        appendAuditEvent("ticket_link", { guildId: interaction.guildId, parentId: parent.id, childId: child.id, actorId: interaction.user.id });
        return `Linked ticket #${child.id} under parent #${parent.id}.`;
    },
    ticketexport: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild!;
        const cfg = ensureTicketConfig(guild.id);
        const sink = cfg.exportWebhookUrl || TICKET_EXPORT_WEBHOOK_URL;
        if (!sink) return "No export webhook configured. Set one in ticket config env or /ticketconfig updates.";
        const limit = Math.max(1, Math.min(50, interaction.options.getInteger("limit") || 10));
        const resolved = ticketStore.tickets
            .filter(ticket => ticket.guildId === guild.id && ticket.status === "resolved")
            .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
            .slice(0, limit);
        if (!resolved.length) return "No resolved tickets available for export.";
        let sent = 0;
        for (const ticket of resolved) {
            const safeTicket = {
                ...ticket,
                reason: sanitizeTranscriptLine(ticket.reason),
                intakeSummary: ticket.intakeSummary ? sanitizeTranscriptLine(ticket.intakeSummary) : ticket.intakeSummary,
                intakeDetails: ticket.intakeDetails ? sanitizeTranscriptLine(ticket.intakeDetails) : ticket.intakeDetails,
                intakeEvidence: ticket.intakeEvidence ? sanitizeTranscriptLine(ticket.intakeEvidence) : ticket.intakeEvidence,
                internalNotes: (ticket.internalNotes || []).map(note => ({ ...note, note: sanitizeTranscriptLine(note.note) }))
            };
            const ok = await postJsonToWebhook(sink, { type: "ticket_export", guildId: guild.id, ticket: safeTicket });
            if (ok) sent += 1;
        }
        appendAuditEvent("ticket_export_batch", { guildId: guild.id, requested: limit, sent, total: resolved.length });
        return `Exported ${sent}/${resolved.length} resolved tickets.`;
    },
    ticketretention: async interaction => {
        const adminError = requireAdministrator(interaction);
        if (adminError) return adminError;
        const guild = interaction.guild!;
        const cfg = ensureTicketConfig(guild.id);
        const days = interaction.options.getInteger("days");
        if (typeof days === "number") {
            cfg.retentionDays = Math.max(1, Math.min(3650, days));
            saveTicketStore();
        }
        const purgeNow = interaction.options.getBoolean("purge_now") || false;
        const removed = purgeNow ? purgeResolvedTicketsByRetention(guild.id) : 0;
        return [
            `Retention: ${cfg.retentionDays || 45} day(s)`,
            `Reopen window: ${cfg.reopenWindowHours || 72} hour(s)`,
            purgeNow ? `Purged resolved tickets: ${removed}` : "Purge not requested"
        ].join("\n");
    }
};
