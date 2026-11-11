// Ticket channel creation, claiming, closing, and resolution.
import {
    AttachmentBuilder, ChannelType, EmbedBuilder, Guild, GuildMember, PermissionFlagsBits
} from "discord.js";
import path from "path";
import { classifyTicketCategory, getTicketSlaPolicy, hydrateTicketIntakeFields, type TicketIntakeSnapshot } from "../../services/ticketEnhancements";
import { exportTicketTranscript } from "../../services/ticketTranscript";
import { ticketActions } from "../../services/ticketExperience";
import type { CatalogItem } from "../../runtime/storeCatalog";
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
import { postStaffAlert } from "../staff/staffDesk";
import { notifyTicketRecipient } from "./experience";

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

export async function createTicketChannel(guild: Guild, ownerId: string, reason: string, priority: TicketPriority = "normal", bypassDeflection = false, submittedIntake?: Partial<TicketIntakeSnapshot>, storeItem?: CatalogItem): Promise<{ error?: string; channelId?: string; ticketId?: number }> {
    recordTicketCreateAttempt();
    const requestedBucket = storeItem ? "store" : getTicketCaseBucket(submittedIntake?.category || reason);
    if (!tryAcquireTicketCreateLock(guild.id, ownerId)) {
        recordTicketCreateFailure("in_flight_lock");
        return { error: "Ticket creation is already in progress for your account. Please wait a moment and try again." };
    }

    try {
    purgeLegacyImportedTicketRecords(guild.id);
    await pruneDeletedTicketRecords(guild);
    await pruneInaccessibleOwnerTicketRecords(guild);

    if (storeItem) {
        await guild.fetch();
        const channels = await guild.channels.fetch();
        for (const channel of channels.values()) {
            if (!channel || channel.type !== ChannelType.GuildText || !/^Store item #\d+ revision \d+ inquiry for /.test(channel.topic || "")
                || findChannelOwnerFromTopic(channel.topic) !== ownerId) continue;
            const tracked = findTicketByChannel(channel.id);
            if (tracked && (tracked.category === "store" || !["open", "claimed"].includes(tracked.status))) continue;
            const recovered = tracked || createTicketEntry(guild.id, ownerId, channel.id, "Recovered store inquiry: review the existing channel before requesting another item.", priority);
            if (!recovered) return { error: `An existing store channel <#${channel.id}> needs owner review; its recovery could not be saved.` };
            if (recovered.guildId !== guild.id || recovered.ownerId !== ownerId) throw new Error("Store ticket channel conflicts with an existing ticket record.");
            recovered.category = "store"; recovered.intakeCategory = "store";
            recovered.assignedToId = guild.ownerId; recovered.status = "claimed";
            if (!saveTicketStore()) return { error: `An existing store channel <#${channel.id}> needs owner review; its routing could not be saved.` };
            appendAuditEvent("store_ticket_recovered", { guildId: guild.id, ownerId, channelId: channel.id, ticketId: recovered.id });
        }
    }

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
            if (storeItem) return { error: `You already have an open store inquiry: <#${existing.channelId}>. Add this item number there; the owner will help you.` };
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
    if (storeItem) await guild.fetch();
    const botMember = storeItem ? await guild.members.fetchMe({ force: true }) : guild.members.me;
    if (storeItem && (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)
        || !botMember.permissions.has(PermissionFlagsBits.ManageRoles))) return { error: "The bot needs Manage Channels and Manage Roles to create a private owner ticket." };
    if (storeItem) await guild.members.fetch({ user: guild.ownerId, force: true });

    const configuredOrDefaultCategoryId = cfg.categoryId || TICKET_DEFAULT_CATEGORY_ID;
    const configuredOrDefaultCategory = await guild.channels.fetch(configuredOrDefaultCategoryId).catch(() => null);
    const parentCategoryId = configuredOrDefaultCategory && configuredOrDefaultCategory.type === ChannelType.GuildCategory
        ? configuredOrDefaultCategory.id
        : undefined;

    const channelName = `${storeItem ? "store" : "ops"}-${owner.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 18) || "member"}`;
    const created = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentCategoryId,
        topic: storeItem ? `Store item #${storeItem.number} revision ${storeItem.revision} inquiry for ${owner.user.tag} (${owner.id})`
            : `Support ticket for ${owner.user.tag} (${owner.id})`,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: owner.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ...(storeItem && guild.ownerId === owner.id ? [] : [{ id: storeItem ? guild.ownerId : TICKET_HANDLER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }]),
            ...(botMember ? [{ id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels,
                ...(storeItem ? [PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] : [])] }] : [])
        ],
        reason: `Ticket opened by ${owner.user.tag}`
    }).catch(error => {
        console.error("[tickets] Channel creation failed:", error);
        return null;
    });

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
        evidence: ticket.intakeEvidence,
        ...submittedIntake
    });
    ticket.intakeSummary = intake.summary;
    ticket.intakeCategory = intake.category;
    ticket.intakeDetails = intake.details;
    ticket.intakePlatform = intake.platform;
    ticket.intakeOrderId = intake.orderId;
    ticket.intakeEvidence = intake.evidence;
    applyTicketMetadata(ticket, reason);
    if (submittedIntake?.category || storeItem) {
        ticket.category = storeItem ? "store" : classifyTicketCategory(submittedIntake!.category!);
        ticket.slaPolicy = getTicketSlaPolicy(ticket.category, priority);
    }
    if (storeItem) {
        ticket.intakeCategory = "store";
        ticket.assignedToId = guild.ownerId;
        ticket.status = "claimed";
        ticket.tags = ["store", `item-${storeItem.number}`, `revision-${storeItem.revision}`];
    }
    if (!saveTicketStore()) {
        console.error(`Ticket #${ticket.id} intake fields could not be saved.`);
        return { error: `Your ticket channel <#${ticket.channelId}> exists, but its details could not be saved. Keep your draft and contact staff in that channel.` };
    }
    appendAuditEvent("ticket_open", { guildId: guild.id, ticketId: ticket.id, ownerId: owner.id, channelId: created.id, reason, intake });

    const intro = buildTicketOpsEmbed(ticket);
    const panelMessage = await created.send({
        content: `<@${owner.id}>`, embeds: [intro], components: buildTicketOpsComponents(ticket), allowedMentions: { parse: [], users: [owner.id] },
        ...(storeItem ? { files: [new AttachmentBuilder(Buffer.from(
            `FNTCORD STORE REQUEST / NOT A PURCHASE\nReference: ${ticket.intakeOrderId}\nItem #${storeItem.number}: ${storeItem.name}\nRevision: ${storeItem.revision}\n\n${ticket.intakeDetails}`, "utf8"
        ), { name: `store-item-${storeItem.number}-request.txt` })] } : {})
    }).catch(error => {
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

    if (!storeItem) await autoRouteTicket(guild, ticket);
    await notifyTicketRecipient(ticket, "member_reply", `created:${ticket.id}`);
    if (storeItem && !panelMessage) return { error: `Your owner ticket <#${created.id}> exists and its request details are saved, but the request card could not be posted. Check bot Send Messages, Embed Links and Attach Files permissions; do not open another ticket.` };

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
    return ticketActions.run(channelId, () => performCloseTicketChannel(guild, channelId, closedById, closeReason));
}

async function performCloseTicketChannel(guild: Guild, channelId: string, closedById: string, closeReason: string): Promise<string> {
    const tracked = findTicketByChannel(channelId);
    if (!tracked || tracked.guildId !== guild.id) return "This is not a ticket in this server.";
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return "The ticket channel is missing.";
    const botMember = guild.members.me || await guild.members.fetchMe();
    if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)
        || !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageRoles)) return "The bot needs Manage Channels and Manage Roles in this ticket before it can close it.";
    const ticket = archiveTicketByChannel(channelId, closeReason);
    if (!ticket) return "This channel is not an open ticket.";
    const cfg = ensureTicketConfig(guild.id);
    const reopenHours = Math.max(1, Number(cfg.reopenWindowHours || 72));
    ticket.reopenUntilAt = Date.now() + (reopenHours * 60 * 60 * 1000);
    if (!saveTicketStore()) return "The ticket was marked closed, but its reopen window could not be saved. Staff should check storage before resolving it.";
    const archiveCategoryId = await ensureArchiveCategory(guild);
    try {
        await channel.setParent(archiveCategoryId, { lockPermissions: false });
        await channel.setTopic(`${channel.topic || `Support ticket (${ticket.ownerId})`} [ticket-archived]`);
        await channel.permissionOverwrites.edit(ticket.ownerId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: false
        });
        await channel.permissionOverwrites.edit(ticket.category === "store" ? guild.ownerId : TICKET_HANDLER_ROLE_ID, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: true,
            ManageChannels: true
        });
        await channel.send({ content: `Ticket closed by staff.\nReason: ${closeReason}`, allowedMentions: { parse: [] } });
    } catch (error) {
        console.error(`Ticket #${ticket.id} closed, but channel updates failed:`, error);
        await updateTicketOpsPanelMessage(guild, ticket);
        return `Ticket #${ticket.id} was marked closed, but channel permissions or archiving failed. Staff must review it before resolving.`;
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
    return ticketActions.run(channelId, () => performClaimTicketChannel(guild, channelId, claimerId));
}

async function performClaimTicketChannel(guild: Guild, channelId: string, claimerId: string): Promise<string> {
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
    return ticketActions.run(channelId, () => performResolveTicketChannel(guild, channelId, resolverId, resolvedReason));
}

async function performResolveTicketChannel(guild: Guild, channelId: string, resolverId: string, resolvedReason: string): Promise<string> {
    const tracked = findTicketByChannel(channelId);
    if (!tracked || tracked.guildId !== guild.id || tracked.status !== "archived") return "Close this ticket before permanently resolving it.";
    let transcript;
    try {
        const exported = await exportTicketTranscript({
            guild,
            channelId,
            ticketId: tracked.id,
            ownerId: tracked.ownerId,
            resolverId,
            resolvedReason,
            transcriptDir: TICKET_TRANSCRIPT_DIR,
            projectRootDir: path.resolve(BOT_SRC_DIR, "..")
        });
        transcript = exported.stub;
    } catch (error) {
        console.error(`Ticket #${tracked.id} transcript failed; channel preserved:`, error);
        await postStaffAlert({
            embeds: [new EmbedBuilder().setColor(0xdc2626).setTitle(`Ticket #${tracked.id} — Transcript Failed`)
                .setDescription(`The ticket in <#${channelId}> has been preserved. Check storage and channel permissions before retrying.`).toJSON()]
        }).catch(alertError => console.error("Could not alert staff about transcript failure:", alertError));
        return "Transcript could not be verified. The ticket has been preserved; staff have been alerted where possible.";
    }
    const ticket = resolveTicketByChannel(channelId, resolvedReason, transcript);
    if (!ticket) {
        console.error(`Ticket #${tracked.id} resolution could not be saved; channel preserved.`);
        await postStaffAlert({
            embeds: [new EmbedBuilder().setColor(0xdc2626).setTitle(`Ticket #${tracked.id} — Resolution Save Failed`)
                .setDescription(`Transcript verified, but the resolution could not be saved. <#${channelId}> remains available; check storage before retrying.`).toJSON()]
        }).catch(error => console.error("Could not alert staff about resolution save failure:", error));
        return "Transcript verified, but the resolution could not be saved. The ticket channel has been preserved.";
    }

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

    try {
        await guild.channels.delete(ticket.channelId, "Ticket permanently resolved; transcript verified");
    } catch (error) {
        console.error(`Ticket #${ticket.id} channel deletion failed:`, error);
        await postStaffAlert({
            embeds: [new EmbedBuilder().setColor(0xdc2626).setTitle(`Ticket #${ticket.id} — Channel Cleanup Required`)
                .setDescription(`Transcript saved, but <#${ticket.channelId}> could not be deleted. Staff can remove it after checking the saved transcript.`).toJSON()]
        }).catch(alertError => console.error("Could not alert staff about channel deletion failure:", alertError));
        return `Ticket #${ticket.id} resolved with a verified transcript, but channel deletion failed. Staff must finish cleanup.`;
    }
    return `Resolved ticket #${ticket.id} permanently. Reason: ${resolvedReason}`;
}
