"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStoreCatalog = getStoreCatalog;
exports.ensureStorePanelsForGuild = ensureStorePanelsForGuild;
exports.handleStoreInteraction = handleStoreInteraction;
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const discord_js_1 = require("discord.js");
const storePanel_1 = require("../../features/storePanel");
const storeCatalog_1 = require("../../runtime/storeCatalog");
const config_1 = require("../core/config");
const paths_1 = require("../core/paths");
const audit_1 = require("../core/audit");
const store_1 = require("../moderation/store");
const channels_1 = require("../tickets/channels");
const rateLimit_1 = require("../../runtime/rateLimit");
const sessions = new Map();
const panelUpdates = new Map();
let catalog;
function getStoreCatalog() {
    return catalog ?? (catalog = new storeCatalog_1.StoreCatalog(node_path_1.default.resolve(paths_1.BOT_SRC_DIR, "..", "src", "data", "store-catalog.json")));
}
async function upsertStorePanels(guild) {
    const items = getStoreCatalog().list(guild.id);
    for (const [channelId, admin, key] of [[config_1.STORE_CHANNEL_ID, false, "store"], [config_1.STORE_ADMIN_CHANNEL_ID, true, "storeAdmin"]]) {
        const channel = await guild.channels.fetch(channelId);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
            throw new Error(`The designated ${admin ? "store admin" : "store"} channel is unavailable.`);
        const title = admin ? storePanel_1.STORE_ADMIN_TITLE : storePanel_1.STORE_TITLE;
        const payload = (0, storePanel_1.buildStoreLauncher)(items, admin);
        const savedId = (0, store_1.getGuildPanelMessageId)(guild.id, key);
        const saved = savedId ? await channel.messages.fetch(savedId).catch(error => {
            if (error instanceof discord_js_1.DiscordAPIError && error.code === 10008)
                return null;
            throw error;
        }) : null;
        if (saved?.author.id === guild.client.user.id && saved.embeds[0]?.title === title) {
            await saved.edit(payload);
            continue;
        }
        const recent = await channel.messages.fetch({ limit: 100 });
        const previous = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === title);
        const message = previous ? await previous.edit(payload) : await channel.send(payload);
        (0, store_1.setGuildPanelMessageId)(guild.id, key, message.id);
    }
}
async function ensureStorePanelsForGuild(guild) {
    const previous = panelUpdates.get(guild.id);
    const update = (previous ? previous.catch(error => console.error("[store] Previous panel update failed:", error)) : Promise.resolve())
        .then(() => upsertStorePanels(guild));
    panelUpdates.set(guild.id, update);
    try {
        await update;
    }
    finally {
        if (panelUpdates.get(guild.id) === update)
            panelUpdates.delete(guild.id);
    }
}
function createSession(userId, guildId, admin) {
    for (const [key, session] of sessions)
        if (session.expiresAt <= Date.now() || (session.userId === userId && session.guildId === guildId && session.admin === admin))
            sessions.delete(key);
    if (sessions.size >= 1000)
        throw new Error("Store workspaces are busy. Please try again shortly.");
    const session = { id: (0, node_crypto_1.randomUUID)(), userId, guildId, admin, expiresAt: Date.now() + 15 * 60000, page: 0, search: "", selected: null };
    sessions.set(session.id, session);
    return session;
}
async function handleStoreInteraction(interaction) {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
        || !interaction.customId.startsWith(storePanel_1.STORE_PREFIX))
        return false;
    try {
        if (!interaction.guild || ![config_1.STORE_CHANNEL_ID, config_1.STORE_ADMIN_CHANNEL_ID].includes(interaction.channelId))
            throw new Error("Use the designated store panels in this server.");
        const [, action, sessionId, itemNumber, revision] = interaction.customId.split(":");
        let session = sessionId ? sessions.get(sessionId) : undefined;
        if (sessionId && (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guild.id || session.expiresAt <= Date.now())) {
            throw new Error("This private store session expired or belongs to someone else. Open a new workspace.");
        }
        const admin = action === "admin" || !!session?.admin;
        if (interaction.channelId !== (admin ? config_1.STORE_ADMIN_CHANNEL_ID : config_1.STORE_CHANNEL_ID))
            throw new Error("This control belongs to the other store panel.");
        if (admin) {
            const guild = await interaction.guild.fetch();
            await guild.members.fetch({ user: interaction.user.id, force: true });
            if (![guild.ownerId, config_1.STORE_MANAGER_USER_ID].includes(interaction.user.id))
                throw new Error("Only the server owner and the designated store manager may edit the catalog.");
        }
        const throttle = (0, rateLimit_1.rejectIfRateLimited)(`catalog:${interaction.user.id}:${interaction.customId}`, 500);
        if (throttle)
            throw new Error(throttle);
        if (["admin", "browse", "number"].includes(action)) {
            if (!interaction.isButton() || sessionId)
                throw new Error("Invalid store launcher.");
            session = createSession(interaction.user.id, interaction.guild.id, admin);
            if (action === "number")
                await interaction.showModal((0, storePanel_1.buildStoreSimpleModal)(session, "request"));
            else
                await interaction.reply({ ...(0, storePanel_1.buildStoreWorkspace)(session, getStoreCatalog().list(session.guildId, session.admin)), flags: discord_js_1.MessageFlags.Ephemeral });
            return true;
        }
        if (!session)
            throw new Error("Open a new store workspace.");
        const store = getStoreCatalog();
        const selected = session.selected ? store.get(session.guildId, session.selected) : undefined;
        const adminActions = ["add", "edit", "save", "availability", "archive", "status_modal", "confirm"];
        if (adminActions.includes(action) && !session.admin)
            throw new Error("Catalog changes require the private store-admin workspace.");
        if (interaction.isButton() && ["add", "edit", "availability", "archive", "customize", "request"].includes(action)) {
            delete session.pending;
            if (action === "add" || action === "edit") {
                if (action === "edit" && !selected)
                    throw new Error("Select an item first.");
                await interaction.showModal((0, storePanel_1.buildStoreEditModal)(session, action === "edit" ? selected : undefined));
            }
            else if (action === "availability" || action === "archive") {
                if (!selected)
                    throw new Error("Select an item first.");
                session.statusAction = action === "archive" ? "archived" : "available";
                await interaction.showModal((0, storePanel_1.buildStoreSimpleModal)(session, "status", selected));
            }
            else if (action === "request") {
                if (!selected || selected.archived || !selected.available)
                    throw new Error("This item is no longer available. Refresh the catalog.");
                await interaction.showModal((0, storePanel_1.buildStoreSimpleModal)(session, "request", selected));
            }
            else
                await interaction.showModal((0, storePanel_1.buildStoreSimpleModal)(session, "search"));
            return true;
        }
        if ((!interaction.isModalSubmit() || interaction.isFromMessage()) && interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral))
            await interaction.deferUpdate();
        else
            await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        let notice = "";
        if (interaction.isModalSubmit() && action === "save") {
            const input = (0, storeCatalog_1.validateCatalogInput)({
                name: interaction.fields.getTextInputValue("name"), price: interaction.fields.getTextInputValue("price"),
                description: interaction.fields.getTextInputValue("description"), category: interaction.fields.getTextInputValue("category")
            });
            const reason = interaction.fields.getTextInputValue("reason").trim();
            if (!reason || reason.length > 300)
                throw new Error("A reason of 1-300 characters is required.");
            const number = Number(itemNumber);
            const previous = number ? store.get(session.guildId, number) : undefined;
            if (number && (!previous || previous.revision !== Number(revision)))
                throw new Error("This item changed while you were editing. Refresh and try again.");
            if (!/^\d+$/.test(itemNumber) || !/^\d+$/.test(revision))
                throw new Error("Invalid item form.");
            const token = (0, node_crypto_1.randomUUID)();
            session.pending = { kind: "save", token, input, reason, existing: previous ? { number, revision: previous.revision } : undefined };
            const preview = { ...input, number: previous?.number || 0, guildId: session.guildId, available: previous?.available ?? true, archived: previous?.archived ?? false,
                revision: (previous?.revision || 0) + 1, createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now(), updatedBy: session.userId };
            await interaction.editReply((0, storePanel_1.buildStoreConfirmation)(session, token, (0, storePanel_1.catalogItemEmbed)(preview), `${previous ? `Update item #${number}` : "Publish a new numbered item"}? Reason: ${reason}`));
            return true;
        }
        if (interaction.isModalSubmit() && action === "status_modal") {
            const item = store.get(session.guildId, Number(itemNumber));
            if (!item || item.revision !== Number(revision) || !session.statusAction)
                throw new Error("The listing changed or this form expired. Refresh and try again.");
            const reason = interaction.fields.getTextInputValue("reason").trim();
            if (!reason || reason.length > 300)
                throw new Error("A reason of 1-300 characters is required.");
            const field = session.statusAction;
            delete session.statusAction;
            const value = !item[field];
            const token = (0, node_crypto_1.randomUUID)();
            session.pending = { kind: "status", token, reason, number: item.number, revision: item.revision, field, value };
            await interaction.editReply((0, storePanel_1.buildStoreConfirmation)(session, token, (0, storePanel_1.catalogItemEmbed)({ ...item, [field]: value }), `Change ${field} to ${value}? Reason: ${reason}`));
            return true;
        }
        if (interaction.isModalSubmit() && action === "request_modal") {
            const raw = interaction.fields.getTextInputValue("number").trim();
            if (!/^[1-9]\d{0,11}$/.test(raw))
                throw new Error("Enter a valid item number.");
            const item = store.get(session.guildId, Number(raw));
            if (!item || item.archived || !item.available)
                throw new Error("This item number is not accepting requests.");
            if (itemNumber && (item.number !== Number(itemNumber) || item.revision !== Number(revision)))
                throw new Error("The listing changed since you opened this form. Refresh before requesting it.");
            const cooldown = (0, rateLimit_1.rejectIfRateLimited)(`catalog-ticket:${session.guildId}:${session.userId}`, 15000);
            if (cooldown)
                throw new Error(cooldown);
            const notes = interaction.fields.getTextInputValue("notes").trim().slice(0, 1000);
            const result = await (0, channels_1.createTicketChannel)(interaction.guild, session.userId, `Store item #${item.number}: ${item.name}`, "normal", true, {
                category: "store", summary: `Item #${item.number}: ${item.name}`, orderId: `CAT-${item.number}-R${item.revision}`,
                details: `Listed cost: ${item.price}\nCategory: ${item.category}\n${item.description}\n\nRequest notes: ${notes || "None"}\n\nCatalog inquiry only. No payment or purchase has been processed.`
            }, item);
            if (result.error) {
                await interaction.editReply({ content: result.error, embeds: [], components: [], allowedMentions: { parse: [] } });
                return true;
            }
            await interaction.editReply({
                content: `Your request for item #${item.number} is with the server owner: <#${result.channelId}>.\nRequest receipt: Ticket #${result.ticketId} / CAT-${item.number}-R${item.revision}.\nNo payment was taken; the owner will confirm cost and fulfillment in the ticket.`,
                embeds: [], components: [], allowedMentions: { parse: [] }
            });
            return true;
        }
        if (action === "confirm" && interaction.isButton()) {
            const pending = session.pending;
            if (!pending || pending.token !== itemNumber)
                throw new Error("This confirmation expired or has already been used.");
            delete session.pending;
            const item = pending.kind === "save" ? store.save(session.guildId, session.userId, pending.input, pending.reason, pending.existing)
                : store.setStatus(session.guildId, session.userId, pending.number, pending.revision, pending.field, pending.value, pending.reason);
            session.selected = item.number;
            notice = `Item #${item.number} saved.`;
            (0, audit_1.appendAuditEvent)("store_catalog_changed", { guildId: session.guildId, actorId: session.userId, itemNumber: item.number, revision: item.revision, reason: pending.reason });
            try {
                await ensureStorePanelsForGuild(interaction.guild);
            }
            catch (error) {
                console.error("[store] Catalog saved but public panel refresh failed:", error);
                notice += " The public panel could not refresh; saved listings are available through Browse Catalog. Check bot permissions and logs.";
            }
        }
        else {
            delete session.pending;
            if (action === "item" && interaction.isStringSelectMenu()) {
                const item = store.get(session.guildId, Number(interaction.values[0]));
                if (!item || (!session.admin && item.archived))
                    throw new Error("This item is no longer listed.");
                session.selected = item.number;
            }
            else if (action === "search_modal" && interaction.isModalSubmit()) {
                session.search = interaction.fields.getTextInputValue("search").trim().slice(0, 100);
                session.page = 0;
                session.selected = null;
            }
            else if (action === "home") {
                session.selected = null;
                session.search = "";
                session.page = 0;
            }
            else if (action === "back")
                session.selected = null;
            else if (action === "next") {
                session.page++;
                session.selected = null;
            }
            else if (action === "previous") {
                session.page--;
                session.selected = null;
            }
            else if (action !== "refresh")
                throw new Error("Unknown store action. Open a new workspace.");
        }
        await interaction.editReply({ ...(0, storePanel_1.buildStoreWorkspace)(session, store.list(session.guildId, session.admin)), content: notice });
    }
    catch (error) {
        console.error("[store] Interaction failed:", error);
        const content = `Store: ${error instanceof Error ? error.message : "The action failed. Please contact the owner."}`.slice(0, 1800);
        if (interaction.deferred || interaction.replied)
            await interaction.editReply({ content, embeds: [], components: [], attachments: [], allowedMentions: { parse: [] } });
        else
            await interaction.reply({ content, flags: discord_js_1.MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
    return true;
}
