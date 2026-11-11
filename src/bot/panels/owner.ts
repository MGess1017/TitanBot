import { randomUUID } from "node:crypto";
import { ChannelType, DiscordAPIError, MessageFlags, PermissionFlagsBits, type Guild, type Interaction } from "discord.js";
import {
    buildOwnerConfirmation, buildOwnerLauncher, buildOwnerModal, buildOwnerWorkspace,
    OWNER_PANEL_TITLE, OWNER_PREFIX, type OwnerWorkspace, type OwnerPage
} from "../../features/ownerPanel";
import { FEATURE_TOGGLES, REWARD_SETTINGS, type FeatureToggle, type RewardSetting } from "../../features/botSettings";
import { OWNER_VALUE_FIELDS, parseOwnerAmount, previewOwnerValue, type OwnerValueChange, type OwnerValueField, type OwnerValueOperation } from "../../game/ownerControls";
import { applyOwnerValueChange, ensureUser, getPointsSaveHealth } from "../../utils";
import { OWNER_PANEL_CHANNEL_ID, OWNER_PANEL_USER_IDS } from "../core/config";
import { appendAuditEvent } from "../core/audit";
import { botSettingsStore, applyRewardSettings } from "../core/settings";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { getModerationQuotaStore } from "../moderation/quotas";
import { enqueueXpRoleSync } from "../xp/roles";
import { scheduleXpLeaderboardUpdate } from "./xpPanels";
import { activeRaidEncounters } from "../raid/raids";
import { rejectIfRateLimited } from "../../runtime/rateLimit";
import { getAccessPointBadge } from "../pmc/visuals";
import type { QuotaPolicy } from "../../runtime/moderationQuotas";

type PendingOwnerChange =
    | { kind: "value"; change: OwnerValueChange }
    | { kind: "quota"; userId: string | null; action: "ban" | "kick"; policy: QuotaPolicy | null; before: string; reason: string }
    | { kind: "feature"; key: FeatureToggle; before: boolean; after: boolean; reason: string }
    | { kind: "reward"; key: RewardSetting; before: number; after: number; reason: string };
type OwnerSession = OwnerWorkspace & { pending?: { id: string; change: PendingOwnerChange } };
const ownerSessions = new Map<string, OwnerSession>();
const ownerPanelUpdates = new Map<string, Promise<void>>();
const OWNER_SESSION_MS = 15 * 60_000;

async function upsertOwnerPanel(guild: Guild): Promise<void> {
    const channel = await guild.channels.fetch(OWNER_PANEL_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error("The designated Owner Control channel is missing or is not a text channel.");
    const storedId = getGuildPanelMessageId(guild.id, "owner");
    const payload = buildOwnerLauncher();
    if (storedId) {
        const message = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof DiscordAPIError && error.code === 10008) return null;
            throw error;
        });
        if (message?.author.id === guild.client.user.id && message.embeds[0]?.title === OWNER_PANEL_TITLE) {
            await message.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === OWNER_PANEL_TITLE);
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    setGuildPanelMessageId(guild.id, "owner", message.id);
}

export async function ensureOwnerPanelForGuild(guild: Guild): Promise<void> {
    const previous = ownerPanelUpdates.get(guild.id);
    const update = (previous ? previous.catch(error => console.error("[ownerControl] Previous panel update failed:", error)) : Promise.resolve())
        .then(() => upsertOwnerPanel(guild));
    ownerPanelUpdates.set(guild.id, update);
    try { await update; }
    finally { if (ownerPanelUpdates.get(guild.id) === update) ownerPanelUpdates.delete(guild.id); }
}

function describeOwnerSession(session: OwnerSession) {
    const settings = botSettingsStore.get();
    if (session.page === "values") {
        if (!session.targetId) return buildOwnerWorkspace(session, "Select a player, value and operation. Every adjustment requires a reason and a final confirmation.");
        const user = ensureUser(session.targetId);
        return buildOwnerWorkspace(session, `Player: <@${session.targetId}>\nSelected: **${OWNER_VALUE_FIELDS[session.field]}** / **${session.operation}**\nExisting achievements and prestige are preserved. Cards refresh when reopened.`, [
            { name: "Current Values", value: Object.entries(OWNER_VALUE_FIELDS).map(([field, label]) => `${label}: **${user[field as OwnerValueField].toLocaleString("en-US")}**`).join("\n") },
            { name: "Access Tier", value: getAccessPointBadge(user.modPoints).label },
            { name: "Latest Owner Adjustment", value: user.ownerValueChanges?.length
                ? user.ownerValueChanges.slice(-1).map(change => `${OWNER_VALUE_FIELDS[change.field]}: ${change.before.toLocaleString()} -> ${change.after.toLocaleString()}\n<t:${Math.floor(change.at / 1000)}:R> / ${change.reason}`).join("") : "No recorded owner adjustment." }
        ]);
    }
    if (session.page === "quotas") {
        const store = getModerationQuotaStore();
        const userId = session.quotaScope === "member" ? session.quotaUserId : null;
        const policy = store.getPolicy(session.guildId, session.quotaAction, userId || undefined);
        const usage = userId ? store.inspect(session.guildId, session.quotaAction, userId) : null;
        const history = store.history(session.guildId, { action: session.quotaAction, ...(userId ? { userId } : {}) }).slice(0, 3);
        return buildOwnerWorkspace(session, "**Bot commands only.** Native Discord actions bypass these limits.\nEach administrator has their own allowance; individual overrides replace the default. Server owner is exempt.\nWeeks start Monday; calendar boundaries use UTC. Tempbans count as bans. These timeframes limit frequency, not ban duration.", [
            { name: "Scope", value: session.quotaScope === "guild" ? "Default per administrator" : userId ? `<@${userId}>` : "Choose an administrator." },
            { name: "Effective Policy", value: `${session.quotaAction}: **${policy.limit === null ? "Unlimited" : policy.limit}** / calendar ${policy.period} (UTC)\nSource: ${policy.source}` },
            { name: "Current Usage", value: usage ? `Used/reserved: **${usage.used}** / Remaining: **${usage.remaining === null ? "Unlimited" : usage.remaining}**\nReset: <t:${Math.floor(usage.window.end / 1000)}:F>\nPending: ${usage.pending} / Uncertain: ${usage.uncertain}` : "Choose an individual to inspect usage. Changing a policy never clears action history." },
            { name: "Recent Actions", value: history.length ? history.map(row =>
                `${row.status} / <@${row.userId}> -> <@${row.targetId}> / <t:${Math.floor(row.createdAt / 1000)}:R>\nReceipt: \`${row.id}\`${row.error ? `\n${row.error.slice(0, 130)}` : ""}`).join("\n\n").slice(0, 1024) : "No recorded actions for this selection." }
        ]);
    }
    if (session.page === "features") {
        return buildOwnerWorkspace(session, "Use existing feature switches and validated reward rates. No moderation permission or Access Point badge rules are changed here.", [
            { name: "Feature", value: `${FEATURE_TOGGLES[session.feature]}: **${settings.features[session.feature] ? "Enabled" : "Disabled"}**` },
            { name: "Rate", value: `${REWARD_SETTINGS[session.reward].label}: **${settings.rewards[session.reward]}**\nAllowed: ${REWARD_SETTINGS[session.reward].min} - ${REWARD_SETTINGS[session.reward].max}` }
        ]);
    }
    if (session.page === "guardrails") {
        const history = getModerationQuotaStore().history(session.guildId).slice(0, 5);
        const health = getPointsSaveHealth();
        return buildOwnerWorkspace(session, "Moderation remains Administrator-only. Owner-panel access is limited to the two configured IDs in this designated channel; Administrator alone is not enough.", [
            { name: "Access Points", value: "Recruit: 0 / Operator: 250 / Veteran: 500 / Elite: 1,000.\nBadge tiers only; AP never grants moderation permission." },
            { name: "Quota Safeguards", value: "Unlimited until configured. Separate per-admin counters for bans and kicks. Confirmed failures release reservations; uncertain actions remain reserved for inspection. Unbans do not refund usage. Automatic lockdown bans are system actions, not admin quota actions." },
            { name: "Player Data Persistence", value: health.lastError ? "A player-data save error is active. Review server logs before editing." : "No active player-data save error." },
            { name: "Recent Moderation", value: history.length ? history.map(row =>
                `${row.action} / <@${row.userId}> / ${row.status} / <t:${Math.floor(row.createdAt / 1000)}:R>`).join("\n").slice(0, 1024) : "No quota-tracked actions yet." }
        ]);
    }
    return buildOwnerWorkspace(session, "Manage player values, per-admin ban/kick allowances, feature switches, and XP rates from one private workspace.\nChanges require a preview, reason and explicit confirmation. Channel visibility is managed through Discord permissions.");
}

export async function handleOwnerInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit())
        || !interaction.customId.startsWith(OWNER_PREFIX)) return false;
    if (!interaction.guild || interaction.channelId !== OWNER_PANEL_CHANNEL_ID || !OWNER_PANEL_USER_IDS.includes(interaction.user.id)) {
        await interaction.reply({ content: "Owner Control is restricted to its authorized owners in the designated channel.", flags: MessageFlags.Ephemeral });
        return true;
    }
    try {
        await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
        const throttle = rejectIfRateLimited(`owner:${interaction.user.id}:${interaction.customId}`, 500);
        if (throttle) {
            await interaction.reply({ content: throttle, flags: MessageFlags.Ephemeral });
            return true;
        }
        const [, action, sessionId, confirmationId] = interaction.customId.split(":");
        const now = Date.now();
        for (const [id, session] of ownerSessions) if (session.expiresAt <= now) ownerSessions.delete(id);
        if (action === "start") {
            for (const [id, session] of ownerSessions) if (session.actorId === interaction.user.id && session.guildId === interaction.guild.id) ownerSessions.delete(id);
            if (ownerSessions.size >= 100) throw new Error("Owner sessions are full. Try again after an existing session expires.");
            const session: OwnerSession = {
                id: randomUUID(), actorId: interaction.user.id, guildId: interaction.guild.id, expiresAt: now + OWNER_SESSION_MS,
                page: "home", targetId: null, field: "xp", operation: "set", quotaScope: "guild", quotaUserId: null,
                quotaAction: "ban", period: "month", feature: "messageXp", reward: "messageXp"
            };
            ownerSessions.set(session.id, session);
            await interaction.reply({ ...describeOwnerSession(session), flags: MessageFlags.Ephemeral });
            return true;
        }
        const session = ownerSessions.get(sessionId);
        if (!session || session.actorId !== interaction.user.id || session.guildId !== interaction.guild.id) throw new Error("This owner session expired or belongs to someone else. Open a new workspace.");
        if (interaction.isButton() && ["amount", "quota_edit", "feature_edit", "reward_edit"].includes(action)) {
            if (action === "amount") {
                if (!session.targetId) throw new Error("Choose a player first.");
                await interaction.showModal(buildOwnerModal(session, "amount_modal", `${session.operation} ${OWNER_VALUE_FIELDS[session.field]}`, "Whole number / no commas"));
            } else if (action === "quota_edit") {
                if (session.quotaScope === "member" && !session.quotaUserId) throw new Error("Choose an administrator first.");
                await interaction.showModal(buildOwnerModal(session, "quota_modal", "Allowance / unlimited / inherit", session.quotaScope === "member" ? "0 blocks; inherit removes override" : "0 blocks; unlimited removes the cap"));
            } else if (action === "feature_edit") {
                await interaction.showModal(buildOwnerModal(session, "feature_modal", FEATURE_TOGGLES[session.feature], "enabled or disabled"));
            } else {
                const spec = REWARD_SETTINGS[session.reward];
                await interaction.showModal(buildOwnerModal(session, "reward_modal", spec.label, `${spec.min} - ${spec.max}`, String(botSettingsStore.get().rewards[session.reward])));
            }
            return true;
        }
        if ((!interaction.isModalSubmit() || interaction.isFromMessage()) && interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.deferUpdate();
        else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let notice = "";
        if (interaction.isModalSubmit()) {
            const value = interaction.fields.getTextInputValue("value").trim();
            const reason = interaction.fields.getTextInputValue("reason").trim();
            if (!reason || reason.length > 300) throw new Error("A reason of 1-300 characters is required.");
            let change: PendingOwnerChange;
            let description: string;
            if (action === "amount_modal") {
                if (!session.targetId) throw new Error("Choose a player first.");
                const member = await interaction.guild.members.fetch({ user: session.targetId, force: true });
                if (member.user.bot) throw new Error("Bot accounts cannot be adjusted.");
                if (activeRaidEncounters.has(session.targetId)) throw new Error("Wait for this player's active raid to finish before adjusting values.");
                const amount = parseOwnerAmount(value);
                const before = ensureUser(session.targetId)[session.field];
                const after = previewOwnerValue(before, session.operation, amount);
                change = { kind: "value", change: { id: randomUUID(), actorId: session.actorId, guildId: session.guildId, targetId: session.targetId,
                    field: session.field, operation: session.operation, amount, before, after, reason, at: now } };
                description = `<@${session.targetId}> / **${OWNER_VALUE_FIELDS[session.field]}**\n**${before.toLocaleString()} -> ${after.toLocaleString()}**\nMode: ${session.operation}\nExisting achievements and prestige will remain. Administrative PMC XP does not award milestone or mastery loot.\nReason: ${reason}`;
            } else if (action === "quota_modal") {
                const userId = session.quotaScope === "member" ? session.quotaUserId : null;
                if (session.quotaScope === "member" && !userId) throw new Error("Choose an administrator first.");
                let policy: QuotaPolicy | null;
                if (value.toLowerCase() === "inherit") {
                    if (!userId) throw new Error("Only individual overrides can inherit defaults.");
                    policy = null;
                } else {
                    const limit = value.toLowerCase() === "unlimited" ? null : parseOwnerAmount(value);
                    if (limit !== null && limit > 10000) throw new Error("A moderation allowance must be 0-10,000, unlimited, or inherit.");
                    policy = { limit, period: session.period };
                }
                change = { kind: "quota", userId, action: session.quotaAction, policy,
                    before: JSON.stringify(getModerationQuotaStore().getPolicy(session.guildId, session.quotaAction, userId || undefined)), reason };
                description = `${userId ? `<@${userId}> override` : "Default for each administrator"}\n**${session.quotaAction}: ${policy ? policy.limit === null ? "Unlimited" : policy.limit : "Inherit default"} / calendar ${policy?.period || "default timeframe"} (UTC)**\nServer owner exempt. Prior usage is retained.\nReason: ${reason}`;
            } else if (action === "feature_modal") {
                if (!["enabled", "disabled"].includes(value.toLowerCase())) throw new Error("Enter enabled or disabled.");
                const before = botSettingsStore.get().features[session.feature];
                const after = value.toLowerCase() === "enabled";
                change = { kind: "feature", key: session.feature, before, after, reason };
                description = `${FEATURE_TOGGLES[session.feature]}: **${before ? "Enabled" : "Disabled"} -> ${after ? "Enabled" : "Disabled"}**\nReason: ${reason}`;
            } else if (action === "reward_modal") {
                if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Enter a number without commas or abbreviations.");
                const after = Number(value);
                const spec = REWARD_SETTINGS[session.reward];
                if (!Number.isFinite(after) || after < spec.min || after > spec.max
                    || (["messageXp", "voiceXpPerMinute"].includes(session.reward) && !Number.isInteger(after))) throw new Error(`Enter a value between ${spec.min} and ${spec.max}; XP rates must be whole numbers.`);
                const before = botSettingsStore.get().rewards[session.reward];
                change = { kind: "reward", key: session.reward, before, after, reason };
                description = `${spec.label}: **${before} -> ${after}**\nReason: ${reason}`;
            } else throw new Error("Unknown owner form. Reopen the workspace.");
            const id = randomUUID();
            session.pending = { id, change };
            await interaction.editReply(buildOwnerConfirmation(session, id, description));
            return true;
        }
        if (action === "confirm") {
            const pending = session.pending;
            if (!pending || confirmationId !== pending.id) throw new Error("This confirmation has expired or was already used.");
            delete session.pending;
            const change = pending.change;
            if (change.kind === "value") {
                const member = await interaction.guild.members.fetch({ user: change.change.targetId, force: true });
                if (member.user.bot || activeRaidEncounters.has(member.id)) throw new Error("The target is a bot or has an active raid. No change was made.");
                applyOwnerValueChange({ ...change.change, at: Date.now() });
                if (change.change.field === "xp") {
                    enqueueXpRoleSync(interaction.guild, member.id, ensureUser(member.id).xp);
                    scheduleXpLeaderboardUpdate();
                }
            } else if (change.kind === "quota") {
                if (change.userId) {
                    const member = await interaction.guild.members.fetch({ user: change.userId, force: true });
                    if (!member.permissions.has(PermissionFlagsBits.Administrator)) throw new Error("The selected user is no longer an administrator.");
                }
                const store = getModerationQuotaStore();
                if (JSON.stringify(store.getPolicy(session.guildId, change.action, change.userId || undefined)) !== change.before) throw new Error("The policy changed since preview. Reopen the form.");
                store.setPolicy(session.guildId, change.action, change.userId, change.policy, { actorId: session.actorId, reason: change.reason });
            } else {
                const settings = botSettingsStore.get();
                const before = change.kind === "feature" ? settings.features[change.key] : settings.rewards[change.key];
                if (before !== change.before) throw new Error("This setting changed since preview. Reopen the form.");
                const saved = botSettingsStore.update(session.actorId, draft => {
                    if (change.kind === "feature") draft.features[change.key] = change.after;
                    else draft.rewards[change.key] = change.after;
                });
                if (!saved) throw new Error("The setting could not be saved. No configuration change was applied.");
                applyRewardSettings();
            }
            notice = "Owner change saved. Existing open cards are snapshots; reopen or refresh to see current values.";
            try {
                appendAuditEvent("owner_control_change", { guildId: session.guildId, actorId: session.actorId, confirmationId, change });
            } catch (error) {
                console.error("[ownerControl] Change saved but secondary audit failed:", error);
                notice += " The secondary audit log failed; check server logs. Do not repeat this change.";
            }
        } else {
            delete session.pending;
            if (action === "home" || action === "back" || action === "cancel") session.page = "home";
            else if (action === "customize") session.page = "features";
            else if (interaction.isUserSelectMenu()) {
                const member = await interaction.guild.members.fetch({ user: interaction.values[0], force: true });
                if (member.user.bot) throw new Error("Choose a human server member.");
                if (action === "player") session.targetId = member.id;
                else if (action === "quota_user") {
                    if (!member.permissions.has(PermissionFlagsBits.Administrator)) throw new Error("Choose an administrator. This panel never grants moderation access.");
                    session.quotaUserId = member.id;
                } else throw new Error("Unknown member selector.");
            } else if (interaction.isStringSelectMenu()) {
                const value = interaction.values[0];
                if (action === "page" && ["home", "values", "quotas", "features", "guardrails"].includes(value)) session.page = value as OwnerPage;
                else if (action === "field" && Object.prototype.hasOwnProperty.call(OWNER_VALUE_FIELDS, value)) session.field = value as OwnerValueField;
                else if (action === "operation" && ["set", "add", "remove"].includes(value)) session.operation = value as OwnerValueOperation;
                else if (action === "scope" && ["guild", "member"].includes(value)) session.quotaScope = value as "guild" | "member";
                else if (action === "quota_kind" && /^(ban|kick)_(day|week|month)$/.test(value)) {
                    const [quotaAction, period] = value.split("_");
                    session.quotaAction = quotaAction as "ban" | "kick";
                    session.period = period as "day" | "week" | "month";
                } else if (action === "feature" && Object.prototype.hasOwnProperty.call(FEATURE_TOGGLES, value)) session.feature = value as FeatureToggle;
                else if (action === "reward" && Object.prototype.hasOwnProperty.call(REWARD_SETTINGS, value)) session.reward = value as RewardSetting;
                else throw new Error("Unknown owner selection.");
            } else if (action !== "refresh") throw new Error("Unknown owner action.");
        }
        await interaction.editReply({ ...describeOwnerSession(session), content: notice });
    } catch (error) {
        console.error("[ownerControl] Interaction failed:", error);
        appendAuditEvent("owner_control_failed", { actorId: interaction.user.id, guildId: interaction.guildId, reason: error instanceof Error ? error.message : String(error) });
        const content = `Owner Control: ${error instanceof Error ? error.message : "The action failed. Check bot logs before retrying."}`.slice(0, 1800);
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [], attachments: [], allowedMentions: { parse: [] } });
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
    return true;
}
