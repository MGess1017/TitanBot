// Ticket channel creation, claiming, closing, and resolution.
import {
    ChannelType, EmbedBuilder, Guild, GuildMember, PermissionFlagsBits
} from "discord.js";
import path from "path";
import { hydrateTicketIntakeFields } from "../../services/ticketEnhancements";
import { buildTicketTranscriptStub, exportTicketTranscript } from "../../services/ticketTranscript";
import {
    TICKET_DEFAULT_CATEGORY_ID, TICKET_EXPORT_WEBHOOK_URL, TICKET_HANDLER_ROLE_ID, TICKET_TRANSCRIPT_DIR
} from "../core/config";
import { client } from "../core/client";
import { recordTicketCreateAttempt, recordTicketCreateFailure } from "../core/metrics";
import { releaseTicketCreateLock, tryAcquireTicketCreateLock } from "../core/ops";
import { appendAuditEvent } from "../core/audit";
import {
    applyTicketMetadata, autoRouteTicket, ensureTicketConfig, evaluateTicketDeflection,
    findOpenTicketByOwnerInBucket, findTicketByChannel, getTicketCaseBucket, normalizeTicketStatus,
    saveTicketStore, type TicketCaseBucket, type TicketPriority, ticketStore
} from "./store";
import {
    archiveTicketByChannel, buildTicketCsatButtons, claimTicketByChannel, createTicketEntry,
    ensureTrackedTicketByChannelId, findChannelOwnerFromTopic, getTicketSlaState, postJsonToWebhook,
    pruneDeletedTicketRecords, pruneInaccessibleOwnerTicketRecords, purgeLegacyImportedTicketRecords,
    resolveTicketByChannel, sendTicketLog, setTicketPanelMessageId
} from "./records";
import { buildTicketOpsComponents, buildTicketOpsEmbed, updateTicketOpsPanelMessage } from "./opsPanel";
import { BOT_SRC_DIR } from "../core/paths";

function isOwnerTopicMatch(topic: string | null | undefined, ownerId: string): boolean {
    return findChannelOwnerFromTopic(topic) === ownerId;
}

async function findOwnerActiveTicketChannels(guild: Guild, owner: GuildMember): Promise<string[]> {
    const fetched = await guild.channels.fetch().catch(() => null);
    const channels = fetched ? Array.from(fetched.values()) : Array.from(guild.channels.cache.values());
    const matches: string[] = [];

    for (const ch of channels) {
        if (!ch || ch.type !== ChannelType.GuildText) continue;
        if (!isOwnerTopicMatch(ch.topic, owner.id)) continue;

        const perms = ch.permissionsFor(owner);
        const canView = Boolean(perms?.has(PermissionFlagsBits.ViewChannel));
        const canSend = Boolean(perms?.has(PermissionFlagsBits.SendMessages));
        if (canView && canSend) {
            matches.push(ch.id);
        }
    }

    matches.sort((a, b) => a.localeCompare(b));
    return matches;
}

async function findOwnerActiveTicketChannelsInBucket(guild: Guild, owner: GuildMember, bucket: TicketCaseBucket): Promise<string[]> {
    const activeChannelIds = await findOwnerActiveTicketChannels(guild, owner);
    const matches: string[] = [];

    for (const channelId of activeChannelIds) {
        const tracked = await ensureTrackedTicketByChannelId(guild, channelId, owner.id).catch(() => null);
        if (!tracked) continue;
        if (getTicketCaseBucket(tracked.category || tracked.reason) === bucket) {
            matches.push(channelId);
        }
    }

    return matches.sort((a, b) => a.localeCompare(b));
}

async function removeTicketStoreEntryByChannelId(channelId: string): Promise<void> {
    const idx = ticketStore.tickets.findIndex(t => t.channelId === channelId);
    if (idx >= 0) {
        ticketStore.tickets.splice(idx, 1);
        saveTicketStore();
    }
}

async function reconcileOwnerTicketDuplicates(guild: Guild, owner: GuildMember, canonicalChannelId: string, bucket: TicketCaseBucket): Promise<void> {
    const active = await findOwnerActiveTicketChannelsInBucket(guild, owner, bucket);
    const duplicates = active.filter(channelId => channelId !== canonicalChannelId);
    if (!duplicates.length) return;

    for (const duplicateChannelId of duplicates) {
        const channel = await guild.channels.fetch(duplicateChannelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) continue;

        const recent = await channel.messages.fetch({ limit: 8 }).catch(() => null);
        const hasUserMessages = Boolean(recent && Array.from(recent.values()).some(message => !message.author?.bot));
        if (hasUserMessages) continue;

        await channel.delete("Duplicate ticket channel auto-cleanup").catch(() => undefined);
        await removeTicketStoreEntryByChannelId(channel.id);
        appendAuditEvent("ticket_duplicate_channel_deleted", {
            guildId: guild.id,
            ownerId: owner.id,
            channelId: channel.id,
            canonicalChannelId
        });
    }
}

export async function createTicketChannel(guild: Guild, ownerId: string, reason: string, priority: TicketPriority = "normal", bypassDeflection = false): Promise<{ error?: string; channelId?: string; ticketId?: number }> {
    recordTicketCreateAttempt();
    const requestedBucket = getTicketCaseBucket(reason);
    if (!tryAcquireTicketCreateLock(guild.id, ownerId)) {
        recordTicketCreateFailure("in_flight_lock");
        return { error: "Ticket creation is already in progress for your account. Please wait a moment and try again." };
    }

    try {
    purgeLegacyImportedTicketRecords(guild.id);
    await pruneDeletedTicketRecords(guild);
    await pruneInaccessibleOwnerTicketRecords(guild);

    if (!bypassDeflection) {
        const deflection = evaluateTicketDeflection(guild.id, ownerId, reason);
        if (deflection.blocked) {
            recordTicketCreateFailure("duplicate_deflection");
            return { error: deflection.message || "Potential duplicate ticket detected." };
        }
    }

    // Self-heal stale owner records caused by manual/deleted/inaccessible channels so /ticket works immediately.
    // Iterate until we either find a valid active ticket or no owner-open tickets remain.
    let existing = findOpenTicketByOwnerInBucket(guild.id, ownerId, requestedBucket);
    let prunedAny = false;
    while (existing) {
        const stale = existing;
        const existingChannel = guild.channels.cache.get(existing.channelId)
            || await guild.channels.fetch(existing.channelId).catch(() => null);
        const ownerMember = await guild.members.fetch(ownerId).catch(() => null);
        const ownerCanViewExisting = existingChannel && existingChannel.type === ChannelType.GuildText && ownerMember
            ? existingChannel.permissionsFor(ownerMember)?.has(PermissionFlagsBits.ViewChannel)
            : false;

        // Keep exactly one valid visible open/claimed ticket for this owner.
        if (existingChannel && ownerCanViewExisting) {
            break;
        }

        const idx = ticketStore.tickets.findIndex(t => t.id === stale.id);
        if (idx < 0) {
            existing = findOpenTicketByOwnerInBucket(guild.id, ownerId, requestedBucket);
            continue;
        }

        ticketStore.tickets.splice(idx, 1);
        prunedAny = true;
        appendAuditEvent("ticket_prune_stale_owner_open", {
            guildId: guild.id,
            ownerId,
            ticketId: stale.id,
            channelId: stale.channelId,
            reason: "Missing/inaccessible channel during create"
        });

        existing = findOpenTicketByOwnerInBucket(guild.id, ownerId, requestedBucket);
    }
    if (prunedAny) {
        saveTicketStore();
    }
    if (existing) {
        recordTicketCreateFailure("existing_open_ticket_record");
        return { error: requestedBucket === "report"
            ? `You already have an open report case: <#${existing.channelId}>`
            : `You already have an open support ticket: <#${existing.channelId}>` };
    }

    const owner = await guild.members.fetch(ownerId).catch(() => null);
    if (!owner) {
        recordTicketCreateFailure("owner_fetch_failed");
        return { error: "Unable to resolve your member record." };
    }

    const ownerActiveChannels = await findOwnerActiveTicketChannelsInBucket(guild, owner, requestedBucket);
    if (ownerActiveChannels.length > 0) {
        const canonical = ownerActiveChannels[0];
        await ensureTrackedTicketByChannelId(guild, canonical, owner.id);
        recordTicketCreateFailure("existing_open_ticket_channel");
        return { error: requestedBucket === "report"
            ? `You already have an open report case: <#${canonical}>`
            : `You already have an open support ticket: <#${canonical}>` };
    }

    const cfg = ensureTicketConfig(guild.id);

    const configuredOrDefaultCategoryId = cfg.categoryId || TICKET_DEFAULT_CATEGORY_ID;
    const configuredOrDefaultCategory = await guild.channels.fetch(configuredOrDefaultCategoryId).catch(() => null);
    const parentCategoryId = configuredOrDefaultCategory && configuredOrDefaultCategory.type === ChannelType.GuildCategory
        ? configuredOrDefaultCategory.id
        : undefined;

    const channelName = `ops-${owner.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 18) || "member"}`;
    const created = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentCategoryId,
        topic: `Support ticket for ${owner.user.tag} (${owner.id})`,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: owner.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: TICKET_HANDLER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
            ...(guild.members.me ? [{ id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }] : [])
        ],
        reason: `Ticket opened by ${owner.user.tag}`
    }).catch(() => null);

    if (!created || created.type !== ChannelType.GuildText) {
        recordTicketCreateFailure("channel_create_failed");
        return { error: "Failed to create ticket channel." };
    }

    // Cross-process safety: if multiple instances raced and created channels, keep only one owner-active channel.
    const ownerChannelsAfterCreate = await findOwnerActiveTicketChannelsInBucket(guild, owner, requestedBucket);
    if (ownerChannelsAfterCreate.length > 1) {
        const canonical = ownerChannelsAfterCreate[0];
        if (canonical !== created.id) {
            await created.delete("Duplicate ticket channel prevented by dedupe guard").catch(() => undefined);
            await removeTicketStoreEntryByChannelId(created.id);
            await ensureTrackedTicketByChannelId(guild, canonical, owner.id);
            recordTicketCreateFailure("dedupe_race_duplicate_channel");
            return { error: requestedBucket === "report"
                ? `You already have an open report case: <#${canonical}>`
                : `You already have an open support ticket: <#${canonical}>` };
        }
    }

    const ticket = createTicketEntry(guild.id, owner.id, created.id, reason, priority);
    if (!ticket) {
        await created.delete("Ticket persistence conflict; safe rollback").catch(() => undefined);
        recordTicketCreateFailure("ticket_store_save_conflict");
        return { error: "Ticket persistence conflict detected. Please retry in a moment." };
    }
    const intake = hydrateTicketIntakeFields(reason, {
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
    applyTicketMetadata(ticket, reason);
    appendAuditEvent("ticket_open", { guildId: guild.id, ticketId: ticket.id, ownerId: owner.id, channelId: created.id, reason, intake });

    const intro = buildTicketOpsEmbed(ticket);
    const panelMessage = await created.send({ content: `<@&${TICKET_HANDLER_ROLE_ID}> <@${owner.id}>`, embeds: [intro], components: buildTicketOpsComponents(ticket), allowedMentions: { parse: ["roles", "users"] } }).catch(error => {
        console.error(`Could not post ticket #${ticket.id} panel:`, error);
        return null;
    });
    if (panelMessage) {
        setTicketPanelMessageId(ticket.channelId, panelMessage.id);
    }

    await sendTicketLog(guild.id, `Ticket #${ticket.id} Opened`, [
        { name: "Owner", value: `<@${owner.id}>`, inline: true },
        { name: "Category", value: String(ticket.category || "general").toUpperCase(), inline: true },
        { name: "Priority", value: priority.toUpperCase(), inline: true },
        { name: "Channel", value: `<#${created.id}>`, inline: true },
        { name: "Reason", value: reason || "No reason provided" }
    ]);

    await autoRouteTicket(guild, ticket);

    await reconcileOwnerTicketDuplicates(guild, owner, created.id, requestedBucket);

    return { channelId: created.id, ticketId: ticket.id };
    } finally {
        releaseTicketCreateLock(guild.id, ownerId);
    }
}

export async function ensureArchiveCategory(guild: Guild): Promise<string | null> {
    const cfg = ensureTicketConfig(guild.id);
    const fetched = await guild.channels.fetch().catch(() => null);
    const channels = fetched ? Array.from(fetched.values()) : Array.from(guild.channels.cache.values());
    const archiveCategories = channels
        .filter(channel => channel?.type === ChannelType.GuildCategory && channel.name === "ticket-archive-hold")
        .sort((a, b) => a!.id.localeCompare(b!.id));
    const configured = archiveCategories.find(channel => channel!.id === cfg.archiveCategoryId);
    const canonical = configured || archiveCategories[0];

    if (canonical) {
        cfg.archiveCategoryId = canonical.id;
        saveTicketStore();

        for (const duplicate of archiveCategories) {
            if (!duplicate || duplicate.id === canonical.id) continue;
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
        type: ChannelType.GuildCategory,
        reason: "Create archive hold category for tickets"
    }).catch(() => null);
    if (!created || created.type !== ChannelType.GuildCategory) return null;

    cfg.archiveCategoryId = created.id;
    saveTicketStore();
    return created.id;
}

export async function closeTicketChannel(guild: Guild, channelId: string, closedById: string, closeReason: string): Promise<string> {
    const ticket = archiveTicketByChannel(channelId, closeReason);
    if (!ticket) return "This channel is not an open ticket.";
    const cfg = ensureTicketConfig(guild.id);
    const reopenHours = Math.max(1, Number(cfg.reopenWindowHours || 72));
    ticket.reopenUntilAt = Date.now() + (reopenHours * 60 * 60 * 1000);
    saveTicketStore();
    const channel = guild.channels.cache.get(channelId);
    const archiveCategoryId = await ensureArchiveCategory(guild);
    if (channel && channel.type === ChannelType.GuildText) {
        await channel.setParent(archiveCategoryId, { lockPermissions: false }).catch(() => undefined);
        await channel.setTopic(`${channel.topic || `Support ticket (${ticket.ownerId})`} [ticket-archived]`).catch(() => undefined);
        await channel.permissionOverwrites.edit(ticket.ownerId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: false
        }).catch(() => undefined);
        await channel.permissionOverwrites.edit(TICKET_HANDLER_ROLE_ID, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: true,
            ManageChannels: true
        }).catch(() => undefined);
        await channel.send({ content: `🔒 Ticket archived to hold queue.\n📝 Reason: ${closeReason}` }).catch(() => undefined);
    }
    await sendTicketLog(guild.id, `Ticket #${ticket.id} Archived`, [
        { name: "Owner", value: `<@${ticket.ownerId}>`, inline: true },
        { name: "Archived By", value: `<@${closedById}>`, inline: true },
        { name: "Channel", value: `<#${ticket.channelId}>`, inline: true },
        { name: "Close Reason", value: closeReason },
        { name: "Reopen Window", value: `Until <t:${Math.floor((ticket.reopenUntilAt || Date.now()) / 1000)}:f>` }
    ]);
    appendAuditEvent("ticket_archive", { guildId: guild.id, ticketId: ticket.id, closedById, channelId: ticket.channelId, closeReason });
    await updateTicketOpsPanelMessage(guild, ticket);

    return `Archived ticket #${ticket.id} in hold queue. Reason: ${closeReason}`;
}

export async function claimTicketChannel(guild: Guild, channelId: string, claimerId: string): Promise<string> {
    const ticket = await ensureTrackedTicketByChannelId(guild, channelId, claimerId);
    if (!ticket) {
        return "This channel is not an active tracked ticket. Open a fresh ticket from the support panel.";
    }
    const status = normalizeTicketStatus(ticket.status);
    if (status === "resolved") return "This ticket is already permanently resolved.";
    if (status === "archived") return "This ticket is archived. Use /reopenticket to continue handling or /resolveticket for permanent closure.";
    if (ticket.claimedById && ticket.claimedById !== claimerId) {
        return `Ticket already claimed by <@${ticket.claimedById}>.`;
    }

    const claimed = claimTicketByChannel(channelId, claimerId);
    if (!claimed) return "Unable to claim this ticket right now.";

    const sla = getTicketSlaState(claimed);
    await updateTicketOpsPanelMessage(guild, claimed);

    await sendTicketLog(guild.id, `Ticket #${claimed.id} Claimed`, [
        { name: "Claimed By", value: `<@${claimerId}>`, inline: true },
        { name: "Owner", value: `<@${claimed.ownerId}>`, inline: true },
        { name: "Channel", value: `<#${claimed.channelId}>`, inline: true },
        { name: "Workflow Status", value: claimed.workflowStatus, inline: true },
        { name: "First Response SLA", value: sla.firstResponseOverdue ? "BREACHED" : "ON TIME", inline: true }
    ]);
    appendAuditEvent("ticket_claim", {
        guildId: guild.id,
        ticketId: claimed.id,
        claimedById: claimerId,
        channelId: claimed.channelId
    });

    return `Ticket #${claimed.id} claimed by <@${claimerId}>.`;
}

export async function resolveTicketChannel(guild: Guild, channelId: string, resolverId: string, resolvedReason: string): Promise<string> {
    const tracked = findTicketByChannel(channelId);
    const exported = tracked
        ? await exportTicketTranscript({
            guild,
            channelId,
            ticketId: tracked.id,
            ownerId: tracked.ownerId,
            resolverId,
            resolvedReason,
            transcriptDir: TICKET_TRANSCRIPT_DIR,
            projectRootDir: path.resolve(BOT_SRC_DIR, "..")
        })
        : { transcriptPath: null, messageCount: 0, truncated: false, fetchErrors: 0 };
    const transcript = await buildTicketTranscriptStub(guild, channelId);
    if (transcript && exported.transcriptPath) {
        transcript.transcriptPath = exported.transcriptPath;
        transcript.transcriptFormat = "txt";
        transcript.messageCountApprox = Math.max(transcript.messageCountApprox, exported.messageCount);
    }
    if (transcript) {
        transcript.truncated = exported.truncated;
        transcript.fetchErrors = exported.fetchErrors;
    }
    const ticket = resolveTicketByChannel(channelId, resolvedReason, transcript);
    if (!ticket) return "This channel is not an archived ticket.";

    const exportWebhook = ensureTicketConfig(guild.id).exportWebhookUrl || TICKET_EXPORT_WEBHOOK_URL;
    if (exportWebhook) {
        const exported = await postJsonToWebhook(exportWebhook, {
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
        appendAuditEvent("ticket_export_webhook", {
            guildId: guild.id,
            ticketId: ticket.id,
            ok: exported,
            sinkConfigured: true
        });
    }

    await sendTicketLog(guild.id, `Ticket #${ticket.id} Resolved`, [
        { name: "Owner", value: `<@${ticket.ownerId}>`, inline: true },
        { name: "Resolved By", value: `<@${resolverId}>`, inline: true },
        { name: "Channel", value: `<#${ticket.channelId}>`, inline: true },
        { name: "Resolved Reason", value: resolvedReason },
        { name: "Transcript Stub", value: transcript ? `captured (${transcript.messageCountApprox} msgs approx)` : "not captured" },
        { name: "Transcript File", value: transcript?.transcriptPath ? transcript.transcriptPath : "not exported" }
    ]);
    appendAuditEvent("ticket_resolve", {
        guildId: guild.id,
        ticketId: ticket.id,
        resolverId,
        channelId: ticket.channelId,
        resolvedReason,
        transcript
    });

    const ownerUser = await client.users.fetch(ticket.ownerId).catch(() => null);
    if (ownerUser) {
        await ownerUser.send({
            embeds: [new EmbedBuilder()
                .setColor(0x22c55e)
                .setTitle(`Ticket #${ticket.id} Resolved`)
                .setDescription("How was your support experience? Please rate 1-5 below.")
                .addFields(
                    { name: "Category", value: String(ticket.category || "general"), inline: true },
                    { name: "Priority", value: String(ticket.priority), inline: true },
                    { name: "Reason", value: String(ticket.resolvedReason || "Resolved"), inline: false }
                )],
            components: [buildTicketCsatButtons(ticket.id)]
        }).catch(() => undefined);
    }

    void guild.channels.delete(ticket.channelId, "Ticket permanently resolved").catch(() => undefined);
    return `Resolved ticket #${ticket.id} permanently. Reason: ${resolvedReason}`;
}
