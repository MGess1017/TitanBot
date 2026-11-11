"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureOwnerPanelForGuild = ensureOwnerPanelForGuild;
exports.handleOwnerInteraction = handleOwnerInteraction;
const node_crypto_1 = require("node:crypto");
const discord_js_1 = require("discord.js");
const ownerPanel_1 = require("../../features/ownerPanel");
const botSettings_1 = require("../../features/botSettings");
const ownerControls_1 = require("../../game/ownerControls");
const utils_1 = require("../../utils");
const config_1 = require("../core/config");
const audit_1 = require("../core/audit");
const settings_1 = require("../core/settings");
const store_1 = require("../moderation/store");
const quotas_1 = require("../moderation/quotas");
const roles_1 = require("../xp/roles");
const xpPanels_1 = require("./xpPanels");
const raids_1 = require("../raid/raids");
const rateLimit_1 = require("../../runtime/rateLimit");
const visuals_1 = require("../pmc/visuals");
const storeReviews_1 = require("../core/storeReviews");
const store_2 = require("./store");
const store_3 = require("../tickets/store");
const ownerSessions = new Map();
const ownerPanelUpdates = new Map();
const OWNER_SESSION_MS = 15 * 60000;
async function upsertOwnerPanel(guild) {
    const channel = await guild.channels.fetch(config_1.OWNER_PANEL_CHANNEL_ID);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
        throw new Error("The designated Owner Control channel is missing or is not a text channel.");
    const storedId = (0, store_1.getGuildPanelMessageId)(guild.id, "owner");
    const payload = (0, ownerPanel_1.buildOwnerLauncher)();
    if (storedId) {
        const message = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof discord_js_1.DiscordAPIError && error.code === 10008)
                return null;
            throw error;
        });
        if (message?.author.id === guild.client.user.id && message.embeds[0]?.title === ownerPanel_1.OWNER_PANEL_TITLE) {
            await message.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === ownerPanel_1.OWNER_PANEL_TITLE);
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    (0, store_1.setGuildPanelMessageId)(guild.id, "owner", message.id);
}
async function ensureOwnerPanelForGuild(guild) {
    const previous = ownerPanelUpdates.get(guild.id);
    const update = (previous ? previous.catch(error => console.error("[ownerControl] Previous panel update failed:", error)) : Promise.resolve())
        .then(() => upsertOwnerPanel(guild));
    ownerPanelUpdates.set(guild.id, update);
    try {
        await update;
    }
    finally {
        if (ownerPanelUpdates.get(guild.id) === update)
            ownerPanelUpdates.delete(guild.id);
    }
}
function describeOwnerSession(session) {
    const settings = settings_1.botSettingsStore.get();
    if (session.page === "reviews") {
        const store = (0, storeReviews_1.getStoreReviews)();
        const fulfillments = store.fulfillments(session.guildId);
        const reviews = store.reviews(session.guildId);
        const entries = [
            ...fulfillments.map(row => ({ at: row.at, name: `Fulfilled / Item #${row.itemNumber} / Ticket #${row.ticketId}`,
                value: `Member: <@${row.userId}> / Confirmed by: <@${row.actorId}>\n${row.reason}\nReceipt: \`${row.id}\`` })),
            ...reviews.map(row => {
                const fulfillment = fulfillments.find(entry => entry.id === row.fulfillmentId);
                return { at: row.at, name: `Review / Item #${row.itemNumber} / ${row.rating} of 5`,
                    value: `Member: <@${row.userId}> / Ticket #${fulfillment.ticketId}\n${row.comment}\nReceipt: \`${row.id}\`` };
            })
        ].sort((a, b) => b.at - a.at);
        const pages = Math.max(1, Math.ceil(entries.length / 3));
        session.reviewPage = Math.max(0, Math.min(session.reviewPage || 0, pages - 1));
        return (0, ownerPanel_1.buildOwnerWorkspace)(session, `**${reviews.length} reviews / ${fulfillments.length} fulfilled requests**\nPrivate log / Page ${session.reviewPage + 1} of ${pages}\nOnly the actual server owner can confirm fulfillment of a tracked store request. Its recipient may then publish one review immediately. Closing a ticket alone never verifies fulfillment.`, entries.slice(session.reviewPage * 3, session.reviewPage * 3 + 3).map(row => ({
            name: row.name, value: `${row.value}\n<t:${Math.floor(row.at / 1000)}:F>`.slice(0, 1024)
        })));
    }
    if (session.page === "values") {
        if (!session.targetId)
            return (0, ownerPanel_1.buildOwnerWorkspace)(session, "Select a player, value and operation. Every adjustment requires a reason and a final confirmation.");
        const user = (0, utils_1.ensureUser)(session.targetId);
        return (0, ownerPanel_1.buildOwnerWorkspace)(session, `Player: <@${session.targetId}>\nSelected: **${ownerControls_1.OWNER_VALUE_FIELDS[session.field]}** / **${session.operation}**\nExisting achievements and prestige are preserved. Cards refresh when reopened.`, [
            { name: "Current Values", value: Object.entries(ownerControls_1.OWNER_VALUE_FIELDS).map(([field, label]) => `${label}: **${user[field].toLocaleString("en-US")}**`).join("\n") },
            { name: "Access Tier", value: (0, visuals_1.getAccessPointBadge)(user.modPoints).label },
            { name: "Latest Owner Adjustment", value: user.ownerValueChanges?.length
                    ? user.ownerValueChanges.slice(-1).map(change => `${ownerControls_1.OWNER_VALUE_FIELDS[change.field]}: ${change.before.toLocaleString()} -> ${change.after.toLocaleString()}\n<t:${Math.floor(change.at / 1000)}:R> / ${change.reason}`).join("") : "No recorded owner adjustment." }
        ]);
    }
    if (session.page === "quotas") {
        const store = (0, quotas_1.getModerationQuotaStore)();
        const userId = session.quotaScope === "member" ? session.quotaUserId : null;
        const policy = store.getPolicy(session.guildId, session.quotaAction, userId || undefined);
        const usage = userId ? store.inspect(session.guildId, session.quotaAction, userId) : null;
        const history = store.history(session.guildId, { action: session.quotaAction, ...(userId ? { userId } : {}) }).slice(0, 3);
        return (0, ownerPanel_1.buildOwnerWorkspace)(session, "**Bot commands only.** Native Discord actions bypass these limits.\nEach administrator has their own allowance; individual overrides replace the default. Server owner is exempt.\nWeeks start Monday; calendar boundaries use UTC. Tempbans count as bans. These timeframes limit frequency, not ban duration.", [
            { name: "Scope", value: session.quotaScope === "guild" ? "Default per administrator" : userId ? `<@${userId}>` : "Choose an administrator." },
            { name: "Effective Policy", value: `${session.quotaAction}: **${policy.limit === null ? "Unlimited" : policy.limit}** / calendar ${policy.period} (UTC)\nSource: ${policy.source}` },
            { name: "Current Usage", value: usage ? `Used/reserved: **${usage.used}** / Remaining: **${usage.remaining === null ? "Unlimited" : usage.remaining}**\nReset: <t:${Math.floor(usage.window.end / 1000)}:F>\nPending: ${usage.pending} / Uncertain: ${usage.uncertain}` : "Choose an individual to inspect usage. Changing a policy never clears action history." },
            { name: "Recent Actions", value: history.length ? history.map(row => `${row.status} / <@${row.userId}> -> <@${row.targetId}> / <t:${Math.floor(row.createdAt / 1000)}:R>\nReceipt: \`${row.id}\`${row.error ? `\n${row.error.slice(0, 130)}` : ""}`).join("\n\n").slice(0, 1024) : "No recorded actions for this selection." }
        ]);
    }
    if (session.page === "features") {
        return (0, ownerPanel_1.buildOwnerWorkspace)(session, "Use existing feature switches and validated reward rates. No moderation permission or Access Point badge rules are changed here.", [
            { name: "Feature", value: `${botSettings_1.FEATURE_TOGGLES[session.feature]}: **${settings.features[session.feature] ? "Enabled" : "Disabled"}**` },
            { name: "Rate", value: `${botSettings_1.REWARD_SETTINGS[session.reward].label}: **${settings.rewards[session.reward]}**\nAllowed: ${botSettings_1.REWARD_SETTINGS[session.reward].min} - ${botSettings_1.REWARD_SETTINGS[session.reward].max}` }
        ]);
    }
    if (session.page === "guardrails") {
        const history = (0, quotas_1.getModerationQuotaStore)().history(session.guildId).slice(0, 5);
        const health = (0, utils_1.getPointsSaveHealth)();
        return (0, ownerPanel_1.buildOwnerWorkspace)(session, "Moderation remains Administrator-only. Owner-panel access is limited to the two configured IDs in this designated channel; Administrator alone is not enough.", [
            { name: "Access Points", value: "Recruit: 0 / Operator: 250 / Veteran: 500 / Elite: 1,000.\nBadge tiers only; AP never grants moderation permission." },
            { name: "Quota Safeguards", value: "Unlimited until configured. Separate per-admin counters for bans and kicks. Confirmed failures release reservations; uncertain actions remain reserved for inspection. Unbans do not refund usage. Automatic lockdown bans are system actions, not admin quota actions." },
            { name: "Player Data Persistence", value: health.lastError ? "A player-data save error is active. Review server logs before editing." : "No active player-data save error." },
            { name: "Recent Moderation", value: history.length ? history.map(row => `${row.action} / <@${row.userId}> / ${row.status} / <t:${Math.floor(row.createdAt / 1000)}:R>`).join("\n").slice(0, 1024) : "No quota-tracked actions yet." }
        ]);
    }
    return (0, ownerPanel_1.buildOwnerWorkspace)(session, "Manage player values, per-admin ban/kick allowances, feature switches, and XP rates from one private workspace.\nChanges require a preview, reason and explicit confirmation. Channel visibility is managed through Discord permissions.");
}
function fulfillmentSnapshot(ticket) {
    return JSON.stringify([ticket.guildId, ticket.id, ticket.ownerId, ticket.category, ticket.intakeOrderId, ticket.updatedAt, ticket.status]);
}
async function handleOwnerInteraction(interaction) {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit())
        || !interaction.customId.startsWith(ownerPanel_1.OWNER_PREFIX))
        return false;
    if (!interaction.guild || interaction.channelId !== config_1.OWNER_PANEL_CHANNEL_ID || !config_1.OWNER_PANEL_USER_IDS.includes(interaction.user.id)) {
        await interaction.reply({ content: "Owner Control is restricted to its authorized owners in the designated channel.", flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    try {
        await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
        const throttle = (0, rateLimit_1.rejectIfRateLimited)(`owner:${interaction.user.id}:${interaction.customId}`, 500);
        if (throttle) {
            await interaction.reply({ content: throttle, flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const [, action, sessionId, confirmationId] = interaction.customId.split(":");
        const now = Date.now();
        for (const [id, session] of ownerSessions)
            if (session.expiresAt <= now)
                ownerSessions.delete(id);
        if (action === "start") {
            for (const [id, session] of ownerSessions)
                if (session.actorId === interaction.user.id && session.guildId === interaction.guild.id)
                    ownerSessions.delete(id);
            if (ownerSessions.size >= 100)
                throw new Error("Owner sessions are full. Try again after an existing session expires.");
            const session = {
                id: (0, node_crypto_1.randomUUID)(), actorId: interaction.user.id, guildId: interaction.guild.id, expiresAt: now + OWNER_SESSION_MS,
                page: "home", targetId: null, field: "xp", operation: "set", quotaScope: "guild", quotaUserId: null,
                quotaAction: "ban", period: "month", feature: "messageXp", reward: "messageXp"
            };
            ownerSessions.set(session.id, session);
            await interaction.reply({ ...describeOwnerSession(session), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        const session = ownerSessions.get(sessionId);
        if (!session || session.actorId !== interaction.user.id || session.guildId !== interaction.guild.id)
            throw new Error("This owner session expired or belongs to someone else. Open a new workspace.");
        if (action === "fulfill" && interaction.isButton()) {
            const guild = await interaction.guild.fetch();
            if (guild.ownerId !== interaction.user.id)
                throw new Error("Only the actual server owner may verify a fulfilled store request.");
            await interaction.showModal((0, ownerPanel_1.buildFulfillmentModal)(session));
            return true;
        }
        if (interaction.isButton() && ["amount", "quota_edit", "feature_edit", "reward_edit"].includes(action)) {
            if (action === "amount") {
                if (!session.targetId)
                    throw new Error("Choose a player first.");
                await interaction.showModal((0, ownerPanel_1.buildOwnerModal)(session, "amount_modal", `${session.operation} ${ownerControls_1.OWNER_VALUE_FIELDS[session.field]}`, "Whole number / no commas"));
            }
            else if (action === "quota_edit") {
                if (session.quotaScope === "member" && !session.quotaUserId)
                    throw new Error("Choose an administrator first.");
                await interaction.showModal((0, ownerPanel_1.buildOwnerModal)(session, "quota_modal", "Allowance / unlimited / inherit", session.quotaScope === "member" ? "0 blocks; inherit removes override" : "0 blocks; unlimited removes the cap"));
            }
            else if (action === "feature_edit") {
                await interaction.showModal((0, ownerPanel_1.buildOwnerModal)(session, "feature_modal", botSettings_1.FEATURE_TOGGLES[session.feature], "enabled or disabled"));
            }
            else {
                const spec = botSettings_1.REWARD_SETTINGS[session.reward];
                await interaction.showModal((0, ownerPanel_1.buildOwnerModal)(session, "reward_modal", spec.label, `${spec.min} - ${spec.max}`, String(settings_1.botSettingsStore.get().rewards[session.reward])));
            }
            return true;
        }
        if ((!interaction.isModalSubmit() || interaction.isFromMessage()) && interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral))
            await interaction.deferUpdate();
        else
            await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        let notice = "";
        if (interaction.isModalSubmit()) {
            const value = interaction.fields.getTextInputValue(action === "fulfill_modal" ? "ticket" : "value").trim();
            const reason = interaction.fields.getTextInputValue("reason").trim();
            if (!reason || reason.length > 300)
                throw new Error("A reason of 1-300 characters is required.");
            let change;
            let description;
            if (action === "fulfill_modal") {
                const guild = await interaction.guild.fetch();
                if (guild.ownerId !== interaction.user.id)
                    throw new Error("Only the actual server owner may verify fulfillment.");
                if (!/^[1-9]\d{0,11}$/.test(value))
                    throw new Error("Enter a valid tracked store ticket number.");
                const ticket = (0, store_3.findTicketById)(Number(value));
                const reference = ticket?.intakeOrderId?.match(/^CAT-([1-9]\d*)-R([1-9]\d*)$/);
                if (!ticket || ticket.guildId !== session.guildId || ticket.category !== "store" || !reference)
                    throw new Error("Choose a tracked store request with an item receipt. General support tickets cannot grant review eligibility.");
                const item = (0, store_2.getStoreCatalog)().get(session.guildId, Number(reference[1]));
                if (!item)
                    throw new Error("The requested catalog item no longer exists.");
                if ((0, storeReviews_1.getStoreReviews)().fulfillments(session.guildId).some(row => row.ticketId === ticket.id))
                    throw new Error("This request is already marked fulfilled.");
                change = { kind: "fulfillment", before: fulfillmentSnapshot(ticket), fulfillment: {
                        guildId: session.guildId, ticketId: ticket.id, userId: ticket.ownerId, itemNumber: item.number,
                        itemRevision: Number(reference[2]), itemName: item.name, actorId: session.actorId, reason
                    } };
                description = `Confirm **item #${item.number}: ${item.name}** was fulfilled for <@${ticket.ownerId}>?\nTicket #${ticket.id} / ${ticket.intakeOrderId}\nThis enables one public review from that member. It does not charge currency or close the ticket.\nReason: ${reason}`;
            }
            else if (action === "amount_modal") {
                if (!session.targetId)
                    throw new Error("Choose a player first.");
                const member = await interaction.guild.members.fetch({ user: session.targetId, force: true });
                if (member.user.bot)
                    throw new Error("Bot accounts cannot be adjusted.");
                if (raids_1.activeRaidEncounters.has(session.targetId))
                    throw new Error("Wait for this player's active raid to finish before adjusting values.");
                const amount = (0, ownerControls_1.parseOwnerAmount)(value);
                const before = (0, utils_1.ensureUser)(session.targetId)[session.field];
                const after = (0, ownerControls_1.previewOwnerValue)(before, session.operation, amount);
                change = { kind: "value", change: { id: (0, node_crypto_1.randomUUID)(), actorId: session.actorId, guildId: session.guildId, targetId: session.targetId,
                        field: session.field, operation: session.operation, amount, before, after, reason, at: now } };
                description = `<@${session.targetId}> / **${ownerControls_1.OWNER_VALUE_FIELDS[session.field]}**\n**${before.toLocaleString()} -> ${after.toLocaleString()}**\nMode: ${session.operation}\nExisting achievements and prestige will remain. Administrative PMC XP does not award milestone or mastery loot.\nReason: ${reason}`;
            }
            else if (action === "quota_modal") {
                const userId = session.quotaScope === "member" ? session.quotaUserId : null;
                if (session.quotaScope === "member" && !userId)
                    throw new Error("Choose an administrator first.");
                let policy;
                if (value.toLowerCase() === "inherit") {
                    if (!userId)
                        throw new Error("Only individual overrides can inherit defaults.");
                    policy = null;
                }
                else {
                    const limit = value.toLowerCase() === "unlimited" ? null : (0, ownerControls_1.parseOwnerAmount)(value);
                    if (limit !== null && limit > 10000)
                        throw new Error("A moderation allowance must be 0-10,000, unlimited, or inherit.");
                    policy = { limit, period: session.period };
                }
                change = { kind: "quota", userId, action: session.quotaAction, policy,
                    before: JSON.stringify((0, quotas_1.getModerationQuotaStore)().getPolicy(session.guildId, session.quotaAction, userId || undefined)), reason };
                description = `${userId ? `<@${userId}> override` : "Default for each administrator"}\n**${session.quotaAction}: ${policy ? policy.limit === null ? "Unlimited" : policy.limit : "Inherit default"} / calendar ${policy?.period || "default timeframe"} (UTC)**\nServer owner exempt. Prior usage is retained.\nReason: ${reason}`;
            }
            else if (action === "feature_modal") {
                if (!["enabled", "disabled"].includes(value.toLowerCase()))
                    throw new Error("Enter enabled or disabled.");
                const before = settings_1.botSettingsStore.get().features[session.feature];
                const after = value.toLowerCase() === "enabled";
                change = { kind: "feature", key: session.feature, before, after, reason };
                description = `${botSettings_1.FEATURE_TOGGLES[session.feature]}: **${before ? "Enabled" : "Disabled"} -> ${after ? "Enabled" : "Disabled"}**\nReason: ${reason}`;
            }
            else if (action === "reward_modal") {
                if (!/^\d+(\.\d+)?$/.test(value))
                    throw new Error("Enter a number without commas or abbreviations.");
                const after = Number(value);
                const spec = botSettings_1.REWARD_SETTINGS[session.reward];
                if (!Number.isFinite(after) || after < spec.min || after > spec.max
                    || (["messageXp", "voiceXpPerMinute"].includes(session.reward) && !Number.isInteger(after)))
                    throw new Error(`Enter a value between ${spec.min} and ${spec.max}; XP rates must be whole numbers.`);
                const before = settings_1.botSettingsStore.get().rewards[session.reward];
                change = { kind: "reward", key: session.reward, before, after, reason };
                description = `${spec.label}: **${before} -> ${after}**\nReason: ${reason}`;
            }
            else
                throw new Error("Unknown owner form. Reopen the workspace.");
            const id = (0, node_crypto_1.randomUUID)();
            session.pending = { id, change };
            await interaction.editReply((0, ownerPanel_1.buildOwnerConfirmation)(session, id, description));
            return true;
        }
        if (action === "confirm") {
            const pending = session.pending;
            if (!pending || confirmationId !== pending.id)
                throw new Error("This confirmation has expired or was already used.");
            delete session.pending;
            const change = pending.change;
            if (change.kind === "fulfillment") {
                const guild = await interaction.guild.fetch();
                if (guild.ownerId !== interaction.user.id)
                    throw new Error("Only the current actual server owner may confirm fulfillment.");
                const ticket = (0, store_3.findTicketById)(change.fulfillment.ticketId);
                if (!ticket || fulfillmentSnapshot(ticket) !== change.before)
                    throw new Error("This ticket changed since preview. Reopen the fulfillment form.");
                (0, storeReviews_1.getStoreReviews)().confirmFulfillment(change.fulfillment);
            }
            else if (change.kind === "value") {
                const member = await interaction.guild.members.fetch({ user: change.change.targetId, force: true });
                if (member.user.bot || raids_1.activeRaidEncounters.has(member.id))
                    throw new Error("The target is a bot or has an active raid. No change was made.");
                (0, utils_1.applyOwnerValueChange)({ ...change.change, at: Date.now() });
                if (change.change.field === "xp") {
                    (0, roles_1.enqueueXpRoleSync)(interaction.guild, member.id, (0, utils_1.ensureUser)(member.id).xp);
                    (0, xpPanels_1.scheduleXpLeaderboardUpdate)();
                }
            }
            else if (change.kind === "quota") {
                if (change.userId) {
                    const member = await interaction.guild.members.fetch({ user: change.userId, force: true });
                    if (!member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator))
                        throw new Error("The selected user is no longer an administrator.");
                }
                const store = (0, quotas_1.getModerationQuotaStore)();
                if (JSON.stringify(store.getPolicy(session.guildId, change.action, change.userId || undefined)) !== change.before)
                    throw new Error("The policy changed since preview. Reopen the form.");
                store.setPolicy(session.guildId, change.action, change.userId, change.policy, { actorId: session.actorId, reason: change.reason });
            }
            else {
                const settings = settings_1.botSettingsStore.get();
                const before = change.kind === "feature" ? settings.features[change.key] : settings.rewards[change.key];
                if (before !== change.before)
                    throw new Error("This setting changed since preview. Reopen the form.");
                const saved = settings_1.botSettingsStore.update(session.actorId, draft => {
                    if (change.kind === "feature")
                        draft.features[change.key] = change.after;
                    else
                        draft.rewards[change.key] = change.after;
                });
                if (!saved)
                    throw new Error("The setting could not be saved. No configuration change was applied.");
                (0, settings_1.applyRewardSettings)();
            }
            notice = "Owner change saved. Existing open cards are snapshots; reopen or refresh to see current values.";
            if (change.kind === "fulfillment")
                notice = "Fulfillment saved in the owner review log. The member can now open this item in the store and choose Leave Verified Review.";
            try {
                (0, audit_1.appendAuditEvent)("owner_control_change", { guildId: session.guildId, actorId: session.actorId, confirmationId, change });
            }
            catch (error) {
                console.error("[ownerControl] Change saved but secondary audit failed:", error);
                notice += " The secondary audit log failed; check server logs. Do not repeat this change.";
            }
        }
        else {
            delete session.pending;
            if (action === "home" || action === "back" || action === "cancel")
                session.page = "home";
            else if (action === "customize")
                session.page = "features";
            else if (action === "reviews_previous" || action === "reviews_next") {
                session.page = "reviews";
                session.reviewPage = Math.max(0, (session.reviewPage || 0) + (action === "reviews_next" ? 1 : -1));
            }
            else if (interaction.isUserSelectMenu()) {
                const member = await interaction.guild.members.fetch({ user: interaction.values[0], force: true });
                if (member.user.bot)
                    throw new Error("Choose a human server member.");
                if (action === "player")
                    session.targetId = member.id;
                else if (action === "quota_user") {
                    if (!member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator))
                        throw new Error("Choose an administrator. This panel never grants moderation access.");
                    session.quotaUserId = member.id;
                }
                else
                    throw new Error("Unknown member selector.");
            }
            else if (interaction.isStringSelectMenu()) {
                const value = interaction.values[0];
                if (action === "page" && ["home", "values", "quotas", "features", "guardrails", "reviews"].includes(value))
                    session.page = value;
                else if (action === "field" && Object.prototype.hasOwnProperty.call(ownerControls_1.OWNER_VALUE_FIELDS, value))
                    session.field = value;
                else if (action === "operation" && ["set", "add", "remove"].includes(value))
                    session.operation = value;
                else if (action === "scope" && ["guild", "member"].includes(value))
                    session.quotaScope = value;
                else if (action === "quota_kind" && /^(ban|kick)_(day|week|month)$/.test(value)) {
                    const [quotaAction, period] = value.split("_");
                    session.quotaAction = quotaAction;
                    session.period = period;
                }
                else if (action === "feature" && Object.prototype.hasOwnProperty.call(botSettings_1.FEATURE_TOGGLES, value))
                    session.feature = value;
                else if (action === "reward" && Object.prototype.hasOwnProperty.call(botSettings_1.REWARD_SETTINGS, value))
                    session.reward = value;
                else
                    throw new Error("Unknown owner selection.");
            }
            else if (action !== "refresh")
                throw new Error("Unknown owner action.");
        }
        await interaction.editReply({ ...describeOwnerSession(session), content: notice });
    }
    catch (error) {
        console.error("[ownerControl] Interaction failed:", error);
        (0, audit_1.appendAuditEvent)("owner_control_failed", { actorId: interaction.user.id, guildId: interaction.guildId, reason: error instanceof Error ? error.message : String(error) });
        const content = `Owner Control: ${error instanceof Error ? error.message : "The action failed. Check bot logs before retrying."}`.slice(0, 1800);
        if (interaction.deferred || interaction.replied)
            await interaction.editReply({ content, embeds: [], components: [], attachments: [], allowedMentions: { parse: [] } });
        else
            await interaction.reply({ content, flags: discord_js_1.MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
    return true;
}
