"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTicketChannel = createTicketChannel;
exports.ensureArchiveCategory = ensureArchiveCategory;
exports.closeTicketChannel = closeTicketChannel;
exports.claimTicketChannel = claimTicketChannel;
exports.resolveTicketChannel = resolveTicketChannel;
// Ticket channel creation, claiming, closing, and resolution.
const discord_js_1 = require("discord.js");
const path_1 = __importDefault(require("path"));
const ticketEnhancements_1 = require("../../services/ticketEnhancements");
const ticketTranscript_1 = require("../../services/ticketTranscript");
const config_1 = require("../core/config");
const client_1 = require("../core/client");
const metrics_1 = require("../core/metrics");
const ops_1 = require("../core/ops");
const audit_1 = require("../core/audit");
const store_1 = require("./store");
const records_1 = require("./records");
const opsPanel_1 = require("./opsPanel");
const ids_1 = require("../ui/ids");
const paths_1 = require("../core/paths");
function isOwnerTopicMatch(topic, ownerId) {
    return (0, records_1.findChannelOwnerFromTopic)(topic) === ownerId;
}
async function findOwnerActiveTicketChannels(guild, owner) {
    const fetched = await guild.channels.fetch().catch(() => null);
    const channels = fetched ? Array.from(fetched.values()) : Array.from(guild.channels.cache.values());
    const matches = [];
    for (const ch of channels) {
        if (!ch || ch.type !== discord_js_1.ChannelType.GuildText)
            continue;
        if (!isOwnerTopicMatch(ch.topic, owner.id))
            continue;
        const perms = ch.permissionsFor(owner);
        const canView = Boolean(perms?.has(discord_js_1.PermissionFlagsBits.ViewChannel));
        const canSend = Boolean(perms?.has(discord_js_1.PermissionFlagsBits.SendMessages));
        if (canView && canSend) {
            matches.push(ch.id);
        }
    }
    matches.sort((a, b) => a.localeCompare(b));
    return matches;
}
async function findOwnerActiveTicketChannelsInBucket(guild, owner, bucket) {
    const activeChannelIds = await findOwnerActiveTicketChannels(guild, owner);
    const matches = [];
    for (const channelId of activeChannelIds) {
        const tracked = await (0, records_1.ensureTrackedTicketByChannelId)(guild, channelId, owner.id).catch(() => null);
        if (!tracked)
            continue;
        if ((0, store_1.getTicketCaseBucket)(tracked.category || tracked.reason) === bucket) {
            matches.push(channelId);
        }
    }
    return matches.sort((a, b) => a.localeCompare(b));
}
async function removeTicketStoreEntryByChannelId(channelId) {
    const idx = store_1.ticketStore.tickets.findIndex(t => t.channelId === channelId);
    if (idx >= 0) {
        store_1.ticketStore.tickets.splice(idx, 1);
        (0, store_1.saveTicketStore)();
    }
}
async function reconcileOwnerTicketDuplicates(guild, owner, canonicalChannelId, bucket) {
    const active = await findOwnerActiveTicketChannelsInBucket(guild, owner, bucket);
    const duplicates = active.filter(channelId => channelId !== canonicalChannelId);
    if (!duplicates.length)
        return;
    for (const duplicateChannelId of duplicates) {
        const channel = await guild.channels.fetch(duplicateChannelId).catch(() => null);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
            continue;
        const recent = await channel.messages.fetch({ limit: 8 }).catch(() => null);
        const hasUserMessages = Boolean(recent && Array.from(recent.values()).some(message => !message.author?.bot));
        if (hasUserMessages)
            continue;
        await channel.delete("Duplicate ticket channel auto-cleanup").catch(() => undefined);
        await removeTicketStoreEntryByChannelId(channel.id);
        (0, audit_1.appendAuditEvent)("ticket_duplicate_channel_deleted", {
            guildId: guild.id,
            ownerId: owner.id,
            channelId: channel.id,
            canonicalChannelId
        });
    }
}
async function createTicketChannel(guild, ownerId, reason, priority = "normal", bypassDeflection = false) {
    (0, metrics_1.recordTicketCreateAttempt)();
    const requestedBucket = (0, store_1.getTicketCaseBucket)(reason);
    if (!(0, ops_1.tryAcquireTicketCreateLock)(guild.id, ownerId)) {
        (0, metrics_1.recordTicketCreateFailure)("in_flight_lock");
        return { error: "Ticket creation is already in progress for your account. Please wait a moment and try again." };
    }
    try {
        (0, records_1.purgeLegacyImportedTicketRecords)(guild.id);
        await (0, records_1.pruneDeletedTicketRecords)(guild);
        await (0, records_1.pruneInaccessibleOwnerTicketRecords)(guild);
        if (!bypassDeflection) {
            const deflection = (0, store_1.evaluateTicketDeflection)(guild.id, ownerId, reason);
            if (deflection.blocked) {
                (0, metrics_1.recordTicketCreateFailure)("duplicate_deflection");
                return { error: deflection.message || "Potential duplicate ticket detected." };
            }
        }
        // Self-heal stale owner records caused by manual/deleted/inaccessible channels so /ticket works immediately.
        // Iterate until we either find a valid active ticket or no owner-open tickets remain.
        let existing = (0, store_1.findOpenTicketByOwnerInBucket)(guild.id, ownerId, requestedBucket);
        let prunedAny = false;
        while (existing) {
            const stale = existing;
            const existingChannel = guild.channels.cache.get(existing.channelId)
                || await guild.channels.fetch(existing.channelId).catch(() => null);
            const ownerMember = await guild.members.fetch(ownerId).catch(() => null);
            const ownerCanViewExisting = existingChannel && existingChannel.type === discord_js_1.ChannelType.GuildText && ownerMember
                ? existingChannel.permissionsFor(ownerMember)?.has(discord_js_1.PermissionFlagsBits.ViewChannel)
                : false;
            // Keep exactly one valid visible open/claimed ticket for this owner.
            if (existingChannel && ownerCanViewExisting) {
                break;
            }
            const idx = store_1.ticketStore.tickets.findIndex(t => t.id === stale.id);
            if (idx < 0) {
                existing = (0, store_1.findOpenTicketByOwnerInBucket)(guild.id, ownerId, requestedBucket);
                continue;
            }
            store_1.ticketStore.tickets.splice(idx, 1);
            prunedAny = true;
            (0, audit_1.appendAuditEvent)("ticket_prune_stale_owner_open", {
                guildId: guild.id,
                ownerId,
                ticketId: stale.id,
                channelId: stale.channelId,
                reason: "Missing/inaccessible channel during create"
            });
            existing = (0, store_1.findOpenTicketByOwnerInBucket)(guild.id, ownerId, requestedBucket);
        }
        if (prunedAny) {
            (0, store_1.saveTicketStore)();
        }
        if (existing) {
            (0, metrics_1.recordTicketCreateFailure)("existing_open_ticket_record");
            return { error: requestedBucket === "report"
                    ? `You already have an open report case: <#${existing.channelId}>`
                    : `You already have an open support ticket: <#${existing.channelId}>` };
        }
        const owner = await guild.members.fetch(ownerId).catch(() => null);
        if (!owner) {
            (0, metrics_1.recordTicketCreateFailure)("owner_fetch_failed");
            return { error: "Unable to resolve your member record." };
        }
        const ownerActiveChannels = await findOwnerActiveTicketChannelsInBucket(guild, owner, requestedBucket);
        if (ownerActiveChannels.length > 0) {
            const canonical = ownerActiveChannels[0];
            await (0, records_1.ensureTrackedTicketByChannelId)(guild, canonical, owner.id);
            (0, metrics_1.recordTicketCreateFailure)("existing_open_ticket_channel");
            return { error: requestedBucket === "report"
                    ? `You already have an open report case: <#${canonical}>`
                    : `You already have an open support ticket: <#${canonical}>` };
        }
        const cfg = (0, store_1.ensureTicketConfig)(guild.id);
        const configuredOrDefaultCategoryId = cfg.categoryId || config_1.TICKET_DEFAULT_CATEGORY_ID;
        const configuredOrDefaultCategory = await guild.channels.fetch(configuredOrDefaultCategoryId).catch(() => null);
        const parentCategoryId = configuredOrDefaultCategory && configuredOrDefaultCategory.type === discord_js_1.ChannelType.GuildCategory
            ? configuredOrDefaultCategory.id
            : undefined;
        const channelName = `ops-${owner.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 18) || "member"}`;
        const created = await guild.channels.create({
            name: channelName,
            type: discord_js_1.ChannelType.GuildText,
            parent: parentCategoryId,
            topic: `Support ticket for ${owner.user.tag} (${owner.id})`,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
                { id: owner.id, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory] },
                { id: config_1.TICKET_HANDLER_ROLE_ID, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.ManageChannels] },
                ...(guild.members.me ? [{ id: guild.members.me.id, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.ManageChannels] }] : [])
            ],
            reason: `Ticket opened by ${owner.user.tag}`
        }).catch(() => null);
        if (!created || created.type !== discord_js_1.ChannelType.GuildText) {
            (0, metrics_1.recordTicketCreateFailure)("channel_create_failed");
            return { error: "Failed to create ticket channel." };
        }
        // Cross-process safety: if multiple instances raced and created channels, keep only one owner-active channel.
        const ownerChannelsAfterCreate = await findOwnerActiveTicketChannelsInBucket(guild, owner, requestedBucket);
        if (ownerChannelsAfterCreate.length > 1) {
            const canonical = ownerChannelsAfterCreate[0];
            if (canonical !== created.id) {
                await created.delete("Duplicate ticket channel prevented by dedupe guard").catch(() => undefined);
                await removeTicketStoreEntryByChannelId(created.id);
                await (0, records_1.ensureTrackedTicketByChannelId)(guild, canonical, owner.id);
                (0, metrics_1.recordTicketCreateFailure)("dedupe_race_duplicate_channel");
                return { error: requestedBucket === "report"
                        ? `You already have an open report case: <#${canonical}>`
                        : `You already have an open support ticket: <#${canonical}>` };
            }
        }
        const ticket = (0, records_1.createTicketEntry)(guild.id, owner.id, created.id, reason, priority);
        if (!ticket) {
            await created.delete("Ticket persistence conflict; safe rollback").catch(() => undefined);
            (0, metrics_1.recordTicketCreateFailure)("ticket_store_save_conflict");
            return { error: "Ticket persistence conflict detected. Please retry in a moment." };
        }
        const intake = (0, ticketEnhancements_1.hydrateTicketIntakeFields)(reason, {
            category: ticket.intakeCategory,
            summary: ticket.intakeSummary,
            details: ticket.intakeDetails,
            platform: ticket.intakePlatform,
            orderId: ticket.intakeOrderId,
            evidence: ticket.intakeEvidence
        });
        ticket.intakeSummary = intake.summary;
        ticket.intakeCategory = intake.category;
        ticket.intakeDetails = intake.details;
        ticket.intakePlatform = intake.platform;
        ticket.intakeOrderId = intake.orderId;
        ticket.intakeEvidence = intake.evidence;
        (0, store_1.applyTicketMetadata)(ticket, reason);
        (0, audit_1.appendAuditEvent)("ticket_open", { guildId: guild.id, ticketId: ticket.id, ownerId: owner.id, channelId: created.id, reason, intake });
        const intro = (0, opsPanel_1.buildTicketOpsEmbed)(ticket);
        const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId(ids_1.TICKET_IDS.claim)
            .setLabel("Claim Ticket")
            .setEmoji("🛠️")
            .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
            .setCustomId(ids_1.TICKET_IDS.close)
            .setLabel("Archive Ticket")
            .setEmoji("🔒")
            .setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder()
            .setCustomId(ids_1.TICKET_IDS.resolve)
            .setLabel("Resolve Permanently")
            .setEmoji("✅")
            .setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder()
            .setCustomId(ids_1.TICKET_IDS.watch)
            .setLabel("Watch")
            .setEmoji("👁️")
            .setStyle(discord_js_1.ButtonStyle.Primary));
        const templateRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(store_1.TICKET_TEMPLATE_IDS.ack).setLabel("Ack Template").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(store_1.TICKET_TEMPLATE_IDS.evidence).setLabel("Evidence Template").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(store_1.TICKET_TEMPLATE_IDS.resolved).setLabel("Resolved Template").setStyle(discord_js_1.ButtonStyle.Success));
        const panelMessage = await created.send({ content: `<@&${config_1.TICKET_HANDLER_ROLE_ID}> <@${owner.id}>`, embeds: [intro], components: [row, templateRow], allowedMentions: { parse: ["roles", "users"] } }).catch(() => null);
        if (panelMessage) {
            (0, records_1.setTicketPanelMessageId)(ticket.channelId, panelMessage.id);
        }
        await (0, records_1.sendTicketLog)(guild.id, `Ticket #${ticket.id} Opened`, [
            { name: "Owner", value: `<@${owner.id}>`, inline: true },
            { name: "Category", value: String(ticket.category || "general").toUpperCase(), inline: true },
            { name: "Priority", value: priority.toUpperCase(), inline: true },
            { name: "Channel", value: `<#${created.id}>`, inline: true },
            { name: "Reason", value: reason || "No reason provided" }
        ]);
        await (0, store_1.autoRouteTicket)(guild, ticket);
        await reconcileOwnerTicketDuplicates(guild, owner, created.id, requestedBucket);
        return { channelId: created.id, ticketId: ticket.id };
    }
    finally {
        (0, ops_1.releaseTicketCreateLock)(guild.id, ownerId);
    }
}
async function ensureArchiveCategory(guild) {
    const cfg = (0, store_1.ensureTicketConfig)(guild.id);
    const fetched = await guild.channels.fetch().catch(() => null);
    const channels = fetched ? Array.from(fetched.values()) : Array.from(guild.channels.cache.values());
    const archiveCategories = channels
        .filter(channel => channel?.type === discord_js_1.ChannelType.GuildCategory && channel.name === "ticket-archive-hold")
        .sort((a, b) => a.id.localeCompare(b.id));
    const configured = archiveCategories.find(channel => channel.id === cfg.archiveCategoryId);
    const canonical = configured || archiveCategories[0];
    if (canonical) {
        cfg.archiveCategoryId = canonical.id;
        (0, store_1.saveTicketStore)();
        for (const duplicate of archiveCategories) {
            if (!duplicate || duplicate.id === canonical.id)
                continue;
            const children = channels.filter(channel => channel?.parentId === duplicate.id);
            for (const child of children) {
                if (child && "setParent" in child) {
                    await child.setParent(canonical.id, { lockPermissions: false }).catch(() => undefined);
                }
            }
            const remainingChildren = await guild.channels.fetch().catch(() => null);
            const stillHasChildren = remainingChildren
                ? Array.from(remainingChildren.values()).some(channel => channel?.parentId === duplicate.id)
                : children.length > 0;
            if (!stillHasChildren) {
                await duplicate.delete("Remove empty duplicate ticket archive category").catch(() => undefined);
            }
        }
        return canonical.id;
    }
    const created = await guild.channels.create({
        name: "ticket-archive-hold",
        type: discord_js_1.ChannelType.GuildCategory,
        reason: "Create archive hold category for tickets"
    }).catch(() => null);
    if (!created || created.type !== discord_js_1.ChannelType.GuildCategory)
        return null;
    cfg.archiveCategoryId = created.id;
    (0, store_1.saveTicketStore)();
    return created.id;
}
async function closeTicketChannel(guild, channelId, closedById, closeReason) {
    const ticket = (0, records_1.archiveTicketByChannel)(channelId, closeReason);
    if (!ticket)
        return "This channel is not an open ticket.";
    const cfg = (0, store_1.ensureTicketConfig)(guild.id);
    const reopenHours = Math.max(1, Number(cfg.reopenWindowHours || 72));
    ticket.reopenUntilAt = Date.now() + (reopenHours * 60 * 60 * 1000);
    (0, store_1.saveTicketStore)();
    const channel = guild.channels.cache.get(channelId);
    const archiveCategoryId = await ensureArchiveCategory(guild);
    if (channel && channel.type === discord_js_1.ChannelType.GuildText) {
        await channel.setParent(archiveCategoryId, { lockPermissions: false }).catch(() => undefined);
        await channel.setTopic(`${channel.topic || `Support ticket (${ticket.ownerId})`} [ticket-archived]`).catch(() => undefined);
        await channel.permissionOverwrites.edit(ticket.ownerId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: false
        }).catch(() => undefined);
        await channel.permissionOverwrites.edit(config_1.TICKET_HANDLER_ROLE_ID, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: true,
            ManageChannels: true
        }).catch(() => undefined);
        await channel.send({ content: `🔒 Ticket archived to hold queue.\n📝 Reason: ${closeReason}` }).catch(() => undefined);
    }
    await (0, records_1.sendTicketLog)(guild.id, `Ticket #${ticket.id} Archived`, [
        { name: "Owner", value: `<@${ticket.ownerId}>`, inline: true },
        { name: "Archived By", value: `<@${closedById}>`, inline: true },
        { name: "Channel", value: `<#${ticket.channelId}>`, inline: true },
        { name: "Close Reason", value: closeReason },
        { name: "Reopen Window", value: `Until <t:${Math.floor((ticket.reopenUntilAt || Date.now()) / 1000)}:f>` }
    ]);
    (0, audit_1.appendAuditEvent)("ticket_archive", { guildId: guild.id, ticketId: ticket.id, closedById, channelId: ticket.channelId, closeReason });
    return `Archived ticket #${ticket.id} in hold queue. Reason: ${closeReason}`;
}
async function claimTicketChannel(guild, channelId, claimerId) {
    const ticket = await (0, records_1.ensureTrackedTicketByChannelId)(guild, channelId, claimerId);
    if (!ticket) {
        return "This channel is not an active tracked ticket. Open a fresh ticket from the support panel.";
    }
    const status = (0, store_1.normalizeTicketStatus)(ticket.status);
    if (status === "resolved")
        return "This ticket is already permanently resolved.";
    if (status === "archived")
        return "This ticket is archived. Use /reopenticket to continue handling or /resolveticket for permanent closure.";
    if (ticket.claimedById && ticket.claimedById !== claimerId) {
        return `Ticket already claimed by <@${ticket.claimedById}>.`;
    }
    const claimed = (0, records_1.claimTicketByChannel)(channelId, claimerId);
    if (!claimed)
        return "Unable to claim this ticket right now.";
    const sla = (0, records_1.getTicketSlaState)(claimed);
    await (0, opsPanel_1.updateTicketOpsPanelMessage)(guild, claimed);
    await (0, records_1.sendTicketLog)(guild.id, `Ticket #${claimed.id} Claimed`, [
        { name: "Claimed By", value: `<@${claimerId}>`, inline: true },
        { name: "Owner", value: `<@${claimed.ownerId}>`, inline: true },
        { name: "Channel", value: `<#${claimed.channelId}>`, inline: true },
        { name: "Workflow Status", value: claimed.workflowStatus, inline: true },
        { name: "First Response SLA", value: sla.firstResponseOverdue ? "BREACHED" : "ON TIME", inline: true }
    ]);
    (0, audit_1.appendAuditEvent)("ticket_claim", {
        guildId: guild.id,
        ticketId: claimed.id,
        claimedById: claimerId,
        channelId: claimed.channelId
    });
    return `Ticket #${claimed.id} claimed by <@${claimerId}>.`;
}
async function resolveTicketChannel(guild, channelId, resolverId, resolvedReason) {
    const tracked = (0, store_1.findTicketByChannel)(channelId);
    const exported = tracked
        ? await (0, ticketTranscript_1.exportTicketTranscript)({
            guild,
            channelId,
            ticketId: tracked.id,
            ownerId: tracked.ownerId,
            resolverId,
            resolvedReason,
            transcriptDir: config_1.TICKET_TRANSCRIPT_DIR,
            projectRootDir: path_1.default.resolve(paths_1.BOT_SRC_DIR, "..")
        })
        : { transcriptPath: null, messageCount: 0, truncated: false, fetchErrors: 0 };
    const transcript = await (0, ticketTranscript_1.buildTicketTranscriptStub)(guild, channelId);
    if (transcript && exported.transcriptPath) {
        transcript.transcriptPath = exported.transcriptPath;
        transcript.transcriptFormat = "txt";
        transcript.messageCountApprox = Math.max(transcript.messageCountApprox, exported.messageCount);
    }
    if (transcript) {
        transcript.truncated = exported.truncated;
        transcript.fetchErrors = exported.fetchErrors;
    }
    const ticket = (0, records_1.resolveTicketByChannel)(channelId, resolvedReason, transcript);
    if (!ticket)
        return "This channel is not an archived ticket.";
    const exportWebhook = (0, store_1.ensureTicketConfig)(guild.id).exportWebhookUrl || config_1.TICKET_EXPORT_WEBHOOK_URL;
    if (exportWebhook) {
        const exported = await (0, records_1.postJsonToWebhook)(exportWebhook, {
            type: "ticket_resolved",
            guildId: guild.id,
            ticket: {
                id: ticket.id,
                ownerId: ticket.ownerId,
                channelId: ticket.channelId,
                category: ticket.category || "general",
                priority: ticket.priority,
                status: ticket.status,
                workflowStatus: ticket.workflowStatus,
                createdAt: ticket.createdAt,
                resolvedAt: ticket.resolvedAt,
                resolvedReason: ticket.resolvedReason,
                transcript: ticket.transcript,
                internalNoteCount: ticket.internalNotes?.length || 0
            }
        });
        (0, audit_1.appendAuditEvent)("ticket_export_webhook", {
            guildId: guild.id,
            ticketId: ticket.id,
            ok: exported,
            sinkConfigured: true
        });
    }
    await (0, records_1.sendTicketLog)(guild.id, `Ticket #${ticket.id} Resolved`, [
        { name: "Owner", value: `<@${ticket.ownerId}>`, inline: true },
        { name: "Resolved By", value: `<@${resolverId}>`, inline: true },
        { name: "Channel", value: `<#${ticket.channelId}>`, inline: true },
        { name: "Resolved Reason", value: resolvedReason },
        { name: "Transcript Stub", value: transcript ? `captured (${transcript.messageCountApprox} msgs approx)` : "not captured" },
        { name: "Transcript File", value: transcript?.transcriptPath ? transcript.transcriptPath : "not exported" }
    ]);
    (0, audit_1.appendAuditEvent)("ticket_resolve", {
        guildId: guild.id,
        ticketId: ticket.id,
        resolverId,
        channelId: ticket.channelId,
        resolvedReason,
        transcript
    });
    const ownerUser = await client_1.client.users.fetch(ticket.ownerId).catch(() => null);
    if (ownerUser) {
        await ownerUser.send({
            embeds: [new discord_js_1.EmbedBuilder()
                    .setColor(0x22c55e)
                    .setTitle(`Ticket #${ticket.id} Resolved`)
                    .setDescription("How was your support experience? Please rate 1-5 below.")
                    .addFields({ name: "Category", value: String(ticket.category || "general"), inline: true }, { name: "Priority", value: String(ticket.priority), inline: true }, { name: "Reason", value: String(ticket.resolvedReason || "Resolved"), inline: false })],
            components: [(0, records_1.buildTicketCsatButtons)(ticket.id)]
        }).catch(() => undefined);
    }
    void guild.channels.delete(ticket.channelId, "Ticket permanently resolved").catch(() => undefined);
    return `Resolved ticket #${ticket.id} permanently. Reason: ${resolvedReason}`;
}
