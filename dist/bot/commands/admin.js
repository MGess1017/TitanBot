"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminCommands = void 0;
// Admin health, incident, XP verification, and sanity slash commands.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const jsonPersistence_1 = require("../../runtime/jsonPersistence");
const achievements_1 = require("../../game/achievements");
const config_1 = require("../core/config");
const engagement_1 = require("../xp/engagement");
const metrics_1 = require("../core/metrics");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const store_1 = require("../tickets/store");
const roles_1 = require("../xp/roles");
const guards_1 = require("../core/guards");
const reports_1 = require("../core/reports");
const sanity_1 = require("../core/sanity");
const restart_1 = require("../core/restart");
/** Admin health, incident, XP verification, and sanity commands. */
exports.adminCommands = {
    health: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const embed = (0, reports_1.buildHealthEmbed)();
        return JSON.stringify({ embed: embed.toJSON() });
    },
    balancereport: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const embed = (0, reports_1.buildBalanceReportEmbed)("manual_command");
        return JSON.stringify({ embed: embed.toJSON() });
    },
    incident: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const fix = interaction.options.getBoolean("fix") || false;
        const restartAfter = interaction.options.getBoolean("restart") || false;
        const roleReport = await (0, sanity_1.collectRoleSanityReport)(guild);
        const ticketReport = await (0, sanity_1.collectTicketSanityReport)(guild);
        const issueCount = roleReport.missing.length
            + roleReport.hierarchyBlocked.length
            + roleReport.multiTierMembers
            + ticketReport.missingChannels
            + ticketReport.duplicateOpenOwners
            + ticketReport.panelMissing
            + ticketReport.slaBreaches;
        let remediationLines = ["No remediation requested."];
        if (fix) {
            const roleFix = await (0, sanity_1.runRoleSanityFix)(guild, interaction.user.id, interaction.channelId || null);
            const ticketFix = await (0, sanity_1.runTicketSanityFix)(guild);
            remediationLines = [
                `Role remediation: ${roleFix.started ? "started" : `skipped (${roleFix.reason || "unknown"})`}`,
                `Ticket remediation: removed missing ${ticketFix.removedDeleted}, removed inaccessible ${ticketFix.removedInaccessible}, deduped ${ticketFix.deduped}, panel backfill ${ticketFix.panelBackfilled}`
            ];
        }
        if (restartAfter) {
            remediationLines.push("Restart: scheduled after incident response is sent.");
        }
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(issueCount > 0 ? 0xf59e0b : 0x22c55e)
            .setTitle("🚨 Incident Triage")
            .setDescription(issueCount > 0 ? "Issues detected. Review sections below." : "No major issues detected.")
            .addFields({
            name: "Role Integrity",
            value: [
                `Missing role entries: ${roleReport.missing.length}`,
                `Hierarchy-blocked roles: ${roleReport.hierarchyBlocked.length}`,
                `Members with multiple tier roles: ${roleReport.multiTierMembers}`,
                `Manage Roles available: ${roleReport.canManageRoles ? "yes" : "no"}`
            ].join("\n"),
            inline: false
        }, {
            name: "Ticket Integrity",
            value: [
                `Missing channels: ${ticketReport.missingChannels}`,
                `Duplicate active owners: ${ticketReport.duplicateOpenOwners}`,
                `Active tickets missing panel IDs: ${ticketReport.panelMissing}`,
                `Active SLA breaches: ${ticketReport.slaBreaches}`
            ].join("\n"),
            inline: false
        }, {
            name: "Remediation",
            value: remediationLines.join("\n"),
            inline: false
        }, {
            name: "Quick Follow-Up",
            value: "Run `/rolesanity` and `/ticketsanity` for detailed views. Run with `fix:true` for guided remediation.",
            inline: false
        })
            .setFooter({ text: `Issue score: ${issueCount} | Triggered by ${interaction.user.username}` })
            .setTimestamp(new Date());
        (0, audit_1.appendAuditEvent)("incident_run", {
            guildId: guild.id,
            userId: interaction.user.id,
            issueCount,
            fixRequested: fix,
            restartRequested: restartAfter,
            roleMissing: roleReport.missing.length,
            roleHierarchyBlocked: roleReport.hierarchyBlocked.length,
            roleMultiTierMembers: roleReport.multiTierMembers,
            ticketMissingChannels: ticketReport.missingChannels,
            ticketDuplicateOwners: ticketReport.duplicateOpenOwners,
            ticketPanelMissing: ticketReport.panelMissing,
            ticketSlaBreaches: ticketReport.slaBreaches
        });
        if (restartAfter) {
            setTimeout(() => {
                (0, metrics_1.runAsyncWithBoundary)("incidentRestart", () => (0, restart_1.requestManagedRestart)("incident_command", interaction.user.id));
            }, 2500).unref();
        }
        return JSON.stringify({ embed: embed.toJSON() });
    },
    xpverify: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const target = interaction.options.getUser("user", true);
        const targetState = (0, utils_1.ensureUser)(target.id);
        (0, utils_1.syncProgressAchievements)(target.id);
        await (0, jsonPersistence_1.flushJsonWrites)();
        const snapshot = (0, utils_1.getXpPersistenceSnapshot)(target.id);
        const effectiveXp = snapshot.memoryXp;
        const level = (0, utils_1.getXPLevel)(effectiveXp);
        const unlocked = (0, roles_1.getEffectiveXpRoleEntries)().filter(entry => effectiveXp >= entry.xp).pop();
        let roleStatus = "No XP tier unlocked yet (below first threshold).";
        if (interaction.guild && unlocked) {
            await interaction.guild.roles.fetch().catch(() => undefined);
            const role = interaction.guild.roles.cache.get(unlocked.roleId) || null;
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            const hasRole = Boolean(role && member?.roles.cache.has(role.id));
            const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
            const hierarchyBlocked = Boolean(role && me && role.position >= me.roles.highest.position);
            roleStatus = [
                `Expected tier: ${unlocked.name} (${unlocked.xp.toLocaleString()} XP)`,
                `Role exists: ${role ? "yes" : "no"}`,
                `Member has role: ${hasRole ? "yes" : "no"}`,
                `Hierarchy blocked: ${hierarchyBlocked ? "yes" : "no"}`
            ].join("\n");
        }
        const mismatch = snapshot.primaryXp !== snapshot.memoryXp;
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(mismatch ? 0xf59e0b : 0x22c55e)
            .setTitle("🔎 XP Persistence Verify")
            .setDescription(`Diagnostics for <@${target.id}>`)
            .addFields({
            name: "XP State",
            value: [
                `Effective XP: ${effectiveXp.toLocaleString()}`,
                `Level: ${level}`,
                `Memory XP: ${snapshot.memoryXp.toLocaleString()}`,
                `Primary XP: ${snapshot.primaryXp === null ? "missing" : snapshot.primaryXp.toLocaleString()}`,
                `Previous snapshot XP: ${snapshot.backupXp === null ? "missing" : snapshot.backupXp.toLocaleString()}`
            ].join("\n"),
            inline: false
        }, {
            name: "Write Metadata",
            value: [
                `Memory lastXP: ${(0, ops_1.toIsoOrNever)(snapshot.memoryLastXp)}`,
                `Primary lastXP: ${(0, ops_1.toIsoOrNever)(snapshot.primaryLastXp)}`,
                `Backup lastXP: ${(0, ops_1.toIsoOrNever)(snapshot.backupLastXp)}`,
                `points.json size: ${Math.max(0, snapshot.pointsFileSize)} bytes`,
                `points.json.bak size: ${Math.max(0, snapshot.pointsBackupSize)} bytes`
            ].join("\n"),
            inline: false
        }, {
            name: "Role Assignment Check",
            value: roleStatus,
            inline: false
        }, {
            name: "Achievements and Voice",
            value: [
                `Voice connected: ${(0, engagement_1.formatVoiceDuration)(targetState.voiceMinutes * 60000)}`,
                `XP achievements: ${achievements_1.XP_ACHIEVEMENTS.filter(achievement => targetState.achievementIds.includes(achievement.id)).length}/${achievements_1.XP_ACHIEVEMENTS.length}`,
                `Voice achievements: ${achievements_1.VOICE_ACHIEVEMENTS.filter(achievement => targetState.achievementIds.includes(achievement.id)).length}/${achievements_1.VOICE_ACHIEVEMENTS.length}`,
                `Recent unlocks: ${targetState.achievements.slice(-4).reverse().join(", ") || "none"}`
            ].join("\n"),
            inline: false
        }, {
            name: "Auto-Sync Health",
            value: [
                `Processed: ${roles_1.XP_ROLE_SYNC_METRICS.processed}`,
                `Failures: ${roles_1.XP_ROLE_SYNC_METRICS.failed}`,
                `Retries: ${roles_1.XP_ROLE_SYNC_METRICS.retries}`,
                `Pending dead letters: ${(0, roles_1.readXpRoleDeadLetters)().filter(entry => entry.userId === target.id).length}`
            ].join("\n"),
            inline: false
        })
            .setFooter({ text: mismatch ? "XP mismatch detected: run /xprolesync after confirming bot instance consistency." : "XP persistence healthy." });
        return JSON.stringify({ embed: embed.toJSON() });
    },
    rolesanity: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const fix = interaction.options.getBoolean("fix") || false;
        const dryRun = interaction.options.getBoolean("dry_run") || false;
        const report = await (0, sanity_1.collectRoleSanityReport)(guild);
        let fixNote = "No remediation requested.";
        if (fix && !dryRun) {
            const fixResult = await (0, sanity_1.runRoleSanityFix)(guild, interaction.user.id, interaction.channelId || null);
            fixNote = fixResult.started
                ? "Remediation started: background XP role sync launched."
                : `Remediation skipped: ${fixResult.reason || "unknown reason"}`;
        }
        const embed = new discord_js_1.EmbedBuilder()
            .setColor((report.missing.length || report.hierarchyBlocked.length || report.multiTierMembers > 0) ? 0xf59e0b : 0x22c55e)
            .setTitle("🧪 Role Sanity Audit")
            .setDescription("XP role readiness and assignment integrity checks.")
            .addFields({
            name: "Coverage",
            value: [
                `Configured tiers: ${report.configuredTierCount}`,
                `Existing tier roles: ${report.existingTierCount}`,
                `Missing tier roles: ${report.missing.length}`,
                `Members with multiple tier roles: ${report.multiTierMembers}`
            ].join("\n"),
            inline: false
        }, {
            name: "Bot Permissions and Hierarchy",
            value: [
                `Manage Roles: ${report.canManageRoles ? "yes" : "no"}`,
                `Bot highest role position: ${report.botHighestRolePosition}`,
                `Blocked tier roles by hierarchy: ${report.hierarchyBlocked.length}`
            ].join("\n"),
            inline: false
        }, {
            name: "Fix Mode",
            value: dryRun ? "Dry run: no roles or members will be changed." : fixNote,
            inline: false
        }, {
            name: "Sync Metrics",
            value: [
                `Queue: ${roles_1.XP_ROLE_SYNC_QUEUE.length}`,
                `Retries: ${roles_1.XP_ROLE_SYNC_METRICS.retries}`,
                `Dead letters: ${(0, roles_1.readXpRoleDeadLetters)().length}`,
                `Processed: ${roles_1.XP_ROLE_SYNC_METRICS.processed}`,
                `Mutations: +${roles_1.XP_ROLE_SYNC_METRICS.added} / -${roles_1.XP_ROLE_SYNC_METRICS.removed}`,
                `Failures: ${roles_1.XP_ROLE_SYNC_METRICS.failed}`,
                `Last sync: ${roles_1.XP_ROLE_SYNC_METRICS.lastSyncAt ? new Date(roles_1.XP_ROLE_SYNC_METRICS.lastSyncAt).toISOString() : "never"}`,
                `Last success: ${roles_1.XP_ROLE_SYNC_METRICS.lastSuccessAt ? new Date(roles_1.XP_ROLE_SYNC_METRICS.lastSuccessAt).toISOString() : "never"}`,
                `Last dead-letter replay: ${roles_1.XP_ROLE_SYNC_METRICS.lastDeadLetterReplayAt ? new Date(roles_1.XP_ROLE_SYNC_METRICS.lastDeadLetterReplayAt).toISOString() : "never"}`
            ].join("\n"),
            inline: false
        }, {
            name: "Dry-Run Member Diff",
            value: dryRun
                ? (report.dryRunDiffs.length ? report.dryRunDiffs.join("\n").slice(0, 1024) : "No sampled member changes detected.")
                : "Use dry_run:true to preview sampled add/remove changes before fixing.",
            inline: false
        });
        if (report.configurationErrors.length) {
            embed.addFields({ name: "Configuration Errors", value: report.configurationErrors.slice(0, 10).join("\n"), inline: false });
        }
        if (report.missing.length) {
            embed.addFields({
                name: "Missing Roles",
                value: report.missing.slice(0, 12).map(tier => `${tier.name} (${tier.xp.toLocaleString()} XP)`).join("\n"),
                inline: false
            });
        }
        if (report.hierarchyBlocked.length) {
            embed.addFields({
                name: "Hierarchy Blocked Roles",
                value: report.hierarchyBlocked.slice(0, 12).map(item => `${item.tier.name} (${item.tier.xp.toLocaleString()} XP)`).join("\n"),
                inline: false
            });
        }
        (0, audit_1.appendAuditEvent)("rolesanity_run", {
            guildId: guild.id,
            userId: interaction.user.id,
            missingRoles: report.missing.length,
            hierarchyBlockedRoles: report.hierarchyBlocked.length,
            multiTierMembers: report.multiTierMembers,
            fixRequested: fix
        });
        return JSON.stringify({ embed: embed.toJSON() });
    },
    ticketsanity: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const guild = interaction.guild;
        if (!guild)
            return "This command can only be used in a server.";
        const fix = interaction.options.getBoolean("fix") || false;
        let fixSummary = "No remediation requested.";
        if (fix) {
            const fixResult = await (0, sanity_1.runTicketSanityFix)(guild);
            fixSummary = [
                `Removed missing-channel tickets: ${fixResult.removedDeleted}`,
                `Removed inaccessible-owner tickets: ${fixResult.removedInaccessible}`,
                `Deduped active tickets: ${fixResult.deduped}`,
                `Panel IDs backfilled: ${fixResult.panelBackfilled}`
            ].join("\n");
        }
        const report = await (0, sanity_1.collectTicketSanityReport)(guild);
        const embed = new discord_js_1.EmbedBuilder()
            .setColor((report.missingChannels || report.duplicateOpenOwners || report.slaBreaches) ? 0xf59e0b : 0x22c55e)
            .setTitle("🧪 Ticket Sanity Audit")
            .setDescription("Ticket store integrity and live channel consistency checks.")
            .addFields({
            name: "Ticket State Totals",
            value: [
                `Total: ${report.total}`,
                `Open: ${report.open}`,
                `Claimed: ${report.claimed}`,
                `Archived: ${report.archived}`,
                `Resolved: ${report.resolved}`
            ].join("\n"),
            inline: false
        }, {
            name: "Integrity",
            value: [
                `Missing channels: ${report.missingChannels}`,
                `Owners with duplicate active tickets: ${report.duplicateOpenOwners}`,
                `Active tickets missing panelMessageId: ${report.panelMissing}`,
                `SLA breaches (active): ${report.slaBreaches}`
            ].join("\n"),
            inline: false
        }, {
            name: "Fix Mode",
            value: fixSummary,
            inline: false
        });
        (0, audit_1.appendAuditEvent)("ticketsanity_run", {
            guildId: guild.id,
            userId: interaction.user.id,
            total: report.total,
            missingChannels: report.missingChannels,
            duplicateOpenOwners: report.duplicateOpenOwners,
            panelMissing: report.panelMissing,
            slaBreaches: report.slaBreaches,
            fixRequested: fix
        });
        return JSON.stringify({ embed: embed.toJSON() });
    },
    ticketops: async (interaction) => {
        const adminError = (0, guards_1.requireAdministrator)(interaction);
        if (adminError)
            return adminError;
        const lock = (0, ops_1.readInstanceLockState)();
        const recent = (0, ops_1.readRecentTicketOpsEvents)(8);
        const guild = interaction.guild;
        const ticketTotals = guild
            ? store_1.ticketStore.tickets.filter(t => t.guildId === guild.id)
            : [];
        const activeCount = ticketTotals.filter(t => (0, store_1.normalizeTicketStatus)(t.status) === "open" || (0, store_1.normalizeTicketStatus)(t.status) === "claimed").length;
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(0x0ea5e9)
            .setTitle("🧭 Ticket Runtime Ops")
            .setDescription("Live diagnostics for singleton process lock, ticket-create lock state, and recent dedupe telemetry.")
            .addFields({
            name: "Process Lock",
            value: [
                `Current PID: ${process.pid}`,
                `Holding lock in-memory: ${ops_1.hasInstanceLock ? "yes" : "no"}`,
                `Lock file exists: ${lock.exists ? "yes" : "no"}`,
                `Lock owner PID: ${lock.ownerPid || "none"}`,
                `Lock owner alive: ${lock.ownerAlive ? "yes" : "no"}`,
                `Owner started: ${(0, ops_1.toIsoOrNever)(lock.ownerStartedAt)}`,
                `Lock path: ${ops_1.INSTANCE_LOCK_PATH}`
            ].join("\n"),
            inline: false
        }, {
            name: "Ticket Create Locks",
            value: [
                `In-flight owner locks: ${ops_1.inFlightTicketCreates.size}`,
                `Entries:`,
                (0, ops_1.describeInFlightTicketCreateLocks)(5)
            ].join("\n"),
            inline: false
        }, {
            name: "Ticket Store Snapshot",
            value: [
                `Guild tickets tracked: ${ticketTotals.length}`,
                `Guild active tickets: ${activeCount}`,
                `Data file: ${(0, ops_1.statLabel)(config_1.TICKET_DATA_FILE)}`,
                `Data backup: ${(0, ops_1.statLabel)(`${config_1.TICKET_DATA_FILE}.bak`)}`,
                `Bot uptime: ${(0, ops_1.formatDuration)(process.uptime())}`
            ].join("\n"),
            inline: false
        }, {
            name: "Recent Ticket Ops Events",
            value: recent.length ? recent.join("\n") : "No recent ticket ops events found.",
            inline: false
        })
            .setFooter({ text: `Triggered by ${interaction.user.username}` })
            .setTimestamp(new Date());
        (0, audit_1.appendAuditEvent)("ticketops_run", {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            currentPid: process.pid,
            hasInstanceLock: ops_1.hasInstanceLock,
            lockOwnerPid: lock.ownerPid,
            lockOwnerAlive: lock.ownerAlive,
            inFlightLocks: ops_1.inFlightTicketCreates.size,
            activeTickets: activeCount
        });
        return JSON.stringify({ embed: embed.toJSON() });
    }
};
