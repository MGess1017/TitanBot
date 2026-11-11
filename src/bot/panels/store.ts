import { randomUUID } from "node:crypto";
import path from "node:path";
import { ChannelType, DiscordAPIError, MessageFlags, type Guild, type Interaction } from "discord.js";
import {
    buildStoreConfirmation, buildStoreEditModal, buildStoreLauncher, buildStoreSimpleModal, buildStoreWorkspace,
    buildItemReviews, buildReviewModal, catalogItemEmbed, STORE_ADMIN_TITLE, STORE_PREFIX, STORE_TITLE, type StoreSession
} from "../../features/storePanel";
import { StoreCatalog, validateCatalogInput, type CatalogItem, type CatalogItemInput } from "../../runtime/storeCatalog";
import { STORE_ADMIN_CHANNEL_ID, STORE_CHANNEL_ID, STORE_MANAGER_USER_ID } from "../core/config";
import { BOT_SRC_DIR } from "../core/paths";
import { appendAuditEvent } from "../core/audit";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { createTicketChannel } from "../tickets/channels";
import { rejectIfRateLimited } from "../../runtime/rateLimit";
import { getStoreReviews } from "../core/storeReviews";

type CatalogChange = { token: string; reason: string } & (
    { kind: "save"; input: CatalogItemInput; existing?: { number: number; revision: number } }
    | { kind: "status"; number: number; revision: number; field: "archived" | "available"; value: boolean }
);
type CatalogSession = StoreSession & { pending?: CatalogChange; statusAction?: "available" | "archived" };
const sessions = new Map<string, CatalogSession>();
const panelUpdates = new Map<string, Promise<void>>();
let catalog: StoreCatalog | undefined;
export function getStoreCatalog(): StoreCatalog {
    return catalog ??= new StoreCatalog(path.resolve(BOT_SRC_DIR, "..", "src", "data", "store-catalog.json"));
}

async function upsertStorePanels(guild: Guild): Promise<void> {
    const items = getStoreCatalog().list(guild.id);
    for (const [channelId, admin, key] of [[STORE_CHANNEL_ID, false, "store"], [STORE_ADMIN_CHANNEL_ID, true, "storeAdmin"]] as const) {
        const channel = await guild.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) throw new Error(`The designated ${admin ? "store admin" : "store"} channel is unavailable.`);
        const title = admin ? STORE_ADMIN_TITLE : STORE_TITLE;
        const payload = buildStoreLauncher(items, admin, getStoreReviews().reviews(guild.id));
        const savedId = getGuildPanelMessageId(guild.id, key);
        const saved = savedId ? await channel.messages.fetch(savedId).catch(error => {
            if (error instanceof DiscordAPIError && error.code === 10008) return null;
            throw error;
        }) : null;
        if (saved?.author.id === guild.client.user.id && saved.embeds[0]?.title === title) {
            await saved.edit(payload);
            continue;
        }
        const recent = await channel.messages.fetch({ limit: 100 });
        const previous = recent.find(message => message.author.id === guild.client.user.id && message.embeds[0]?.title === title);
        const message = previous ? await previous.edit(payload) : await channel.send(payload);
        setGuildPanelMessageId(guild.id, key, message.id);
    }
}

export async function ensureStorePanelsForGuild(guild: Guild): Promise<void> {
    const previous = panelUpdates.get(guild.id);
    const update = (previous ? previous.catch(error => console.error("[store] Previous panel update failed:", error)) : Promise.resolve())
        .then(() => upsertStorePanels(guild));
    panelUpdates.set(guild.id, update);
    try { await update; }
    finally { if (panelUpdates.get(guild.id) === update) panelUpdates.delete(guild.id); }
}

function createSession(userId: string, guildId: string, admin: boolean): CatalogSession {
    for (const [key, session] of sessions) if (session.expiresAt <= Date.now() || (session.userId === userId && session.guildId === guildId && session.admin === admin)) sessions.delete(key);
    if (sessions.size >= 1000) throw new Error("Store workspaces are busy. Please try again shortly.");
    const session: CatalogSession = { id: randomUUID(), userId, guildId, admin, expiresAt: Date.now() + 15 * 60_000, page: 0, search: "", selected: null };
    sessions.set(session.id, session);
    return session;
}

function workspace(session: CatalogSession) {
    const reviews = getStoreReviews();
    return buildStoreWorkspace(session, getStoreCatalog().list(session.guildId, session.admin), reviews.reviews(session.guildId),
        session.selected !== null && !!reviews.eligible(session.guildId, session.userId, session.selected));
}

export async function handleStoreInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
        || !interaction.customId.startsWith(STORE_PREFIX)) return false;
    try {
        if (!interaction.guild || ![STORE_CHANNEL_ID, STORE_ADMIN_CHANNEL_ID].includes(interaction.channelId!)) throw new Error("Use the designated store panels in this server.");
        const [, action, sessionId, itemNumber, revision] = interaction.customId.split(":");
        if (action === "item_reviews" && interaction.isButton()) {
            if (interaction.channelId !== STORE_CHANNEL_ID) throw new Error("Use the public store panel.");
            const item = getStoreCatalog().get(interaction.guild.id, Number(sessionId));
            const reviews = item ? getStoreReviews().reviews(interaction.guild.id, item.number) : [];
            if (!item || item.archived || !reviews.length) throw new Error("This listing has no published reviews or is no longer listed.");
            const reviewSession = createSession(interaction.user.id, interaction.guild.id, false);
            reviewSession.selected = item.number;
            await interaction.reply({ ...buildItemReviews(reviewSession, item, reviews, 0), flags: MessageFlags.Ephemeral });
            return true;
        }
        let session = sessionId ? sessions.get(sessionId) : undefined;
        if (sessionId && (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guild.id || session.expiresAt <= Date.now())) {
            throw new Error("This private store session expired or belongs to someone else. Open a new workspace.");
        }
        const admin = action === "admin" || !!session?.admin;
        if (interaction.channelId !== (admin ? STORE_ADMIN_CHANNEL_ID : STORE_CHANNEL_ID)) throw new Error("This control belongs to the other store panel.");
        if (admin) {
            const guild = await interaction.guild.fetch();
            await guild.members.fetch({ user: interaction.user.id, force: true });
            if (![guild.ownerId, STORE_MANAGER_USER_ID].includes(interaction.user.id)) throw new Error("Only the server owner and the designated store manager may edit the catalog.");
        }
        const throttle = rejectIfRateLimited(`catalog:${interaction.user.id}:${interaction.customId}`, 500);
        if (throttle) throw new Error(throttle);
        if (["admin", "browse", "number"].includes(action)) {
            if (!interaction.isButton() || sessionId) throw new Error("Invalid store launcher.");
            session = createSession(interaction.user.id, interaction.guild.id, admin);
            if (action === "number") await interaction.showModal(buildStoreSimpleModal(session, "request"));
            else await interaction.reply({ ...workspace(session), flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!session) throw new Error("Open a new store workspace.");
        const store = getStoreCatalog();
        const selected = session.selected ? store.get(session.guildId, session.selected) : undefined;
        if (action === "review" && interaction.isButton()) {
            if (session.admin || !selected || selected.archived) throw new Error("Select a live item in the public store first.");
            const eligible = getStoreReviews().eligible(session.guildId, session.userId, selected.number);
            if (!eligible) throw new Error("You need an owner-confirmed fulfilled request that has not already been reviewed.");
            await interaction.showModal(buildReviewModal(session, eligible.id));
            return true;
        }
        const adminActions = ["add", "edit", "save", "availability", "archive", "status_modal", "confirm"];
        if (adminActions.includes(action) && !session.admin) throw new Error("Catalog changes require the private store-admin workspace.");
        if (interaction.isButton() && ["add", "edit", "availability", "archive", "customize", "request"].includes(action)) {
            delete session.pending;
            if (action === "add" || action === "edit") {
                if (action === "edit" && !selected) throw new Error("Select an item first.");
                await interaction.showModal(buildStoreEditModal(session, action === "edit" ? selected : undefined));
            } else if (action === "availability" || action === "archive") {
                if (!selected) throw new Error("Select an item first.");
                session.statusAction = action === "archive" ? "archived" : "available";
                await interaction.showModal(buildStoreSimpleModal(session, "status", selected));
            } else if (action === "request") {
                if (!selected || selected.archived || !selected.available) throw new Error("This item is no longer available. Refresh the catalog.");
                await interaction.showModal(buildStoreSimpleModal(session, "request", selected));
            } else await interaction.showModal(buildStoreSimpleModal(session, "search"));
            return true;
        }
        if ((!interaction.isModalSubmit() || interaction.isFromMessage()) && interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.deferUpdate();
        else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let notice = "";
        if (["reviews", "review_page"].includes(action) && interaction.isButton()) {
            const item = store.get(session.guildId, Number(itemNumber));
            const reviews = item ? getStoreReviews().reviews(session.guildId, item.number) : [];
            if (!item || (!session.admin && item.archived) || !reviews.length) throw new Error("This listing has no published reviews or is no longer listed.");
            session.selected = item.number;
            const page = action === "review_page" ? Number(revision) : 0;
            if (!Number.isSafeInteger(page)) throw new Error("Invalid reviews page.");
            await interaction.editReply(buildItemReviews(session, item, reviews, page));
            return true;
        }
        if (action === "review_submit" && interaction.isModalSubmit()) {
            if (session.admin) throw new Error("Submit reviews through the public store.");
            const eligible = getStoreReviews().fulfillments(session.guildId).find(row => row.id === itemNumber && row.userId === session.userId);
            const item = eligible ? store.get(session.guildId, eligible.itemNumber) : undefined;
            if (!eligible || !item || item.archived) throw new Error("This fulfilled request is not eligible for a review on a live listing.");
            const rating = interaction.fields.getTextInputValue("rating").trim();
            if (!/^[1-5]$/.test(rating)) throw new Error("Enter a star rating from 1 to 5.");
            const review = getStoreReviews().submit(session.guildId, session.userId, eligible.id, Number(rating), interaction.fields.getTextInputValue("comment"));
            appendAuditEvent("store_review_published", { guildId: session.guildId, reviewId: review.id, itemNumber: review.itemNumber, ticketId: eligible.ticketId });
            session.selected = item.number;
            notice = "Your verified review is published and saved in the private owner review log.";
            try { await ensureStorePanelsForGuild(interaction.guild); }
            catch (error) {
                console.error("[store] Review saved but launcher refresh failed:", error);
                notice += " The public launcher could not refresh; reviews are available through Browse Catalog. Do not resubmit.";
            }
            await interaction.editReply({ ...workspace(session), content: notice });
            return true;
        }
        if (interaction.isModalSubmit() && action === "save") {
            const input = validateCatalogInput({
                name: interaction.fields.getTextInputValue("name"), price: interaction.fields.getTextInputValue("price"),
                description: interaction.fields.getTextInputValue("description"), category: interaction.fields.getTextInputValue("category")
            });
            const reason = interaction.fields.getTextInputValue("reason").trim();
            if (!reason || reason.length > 300) throw new Error("A reason of 1-300 characters is required.");
            const number = Number(itemNumber);
            const previous = number ? store.get(session.guildId, number) : undefined;
            if (number && (!previous || previous.revision !== Number(revision))) throw new Error("This item changed while you were editing. Refresh and try again.");
            if (!/^\d+$/.test(itemNumber) || !/^\d+$/.test(revision)) throw new Error("Invalid item form.");
            const token = randomUUID();
            session.pending = { kind: "save", token, input, reason, existing: previous ? { number, revision: previous.revision } : undefined };
            const preview: CatalogItem = { ...input, number: previous?.number || 0, guildId: session.guildId, available: previous?.available ?? true, archived: previous?.archived ?? false,
                revision: (previous?.revision || 0) + 1, createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now(), updatedBy: session.userId };
            await interaction.editReply(buildStoreConfirmation(session, token, catalogItemEmbed(preview), `${previous ? `Update item #${number}` : "Publish a new numbered item"}? Reason: ${reason}`));
            return true;
        }
        if (interaction.isModalSubmit() && action === "status_modal") {
            const item = store.get(session.guildId, Number(itemNumber));
            if (!item || item.revision !== Number(revision) || !session.statusAction) throw new Error("The listing changed or this form expired. Refresh and try again.");
            const reason = interaction.fields.getTextInputValue("reason").trim();
            if (!reason || reason.length > 300) throw new Error("A reason of 1-300 characters is required.");
            const field = session.statusAction;
            delete session.statusAction;
            const value = !item[field];
            const token = randomUUID();
            session.pending = { kind: "status", token, reason, number: item.number, revision: item.revision, field, value };
            await interaction.editReply(buildStoreConfirmation(session, token, catalogItemEmbed({ ...item, [field]: value }), `Change ${field} to ${value}? Reason: ${reason}`));
            return true;
        }
        if (interaction.isModalSubmit() && action === "request_modal") {
            const raw = interaction.fields.getTextInputValue("number").trim();
            if (!/^[1-9]\d{0,11}$/.test(raw)) throw new Error("Enter a valid item number.");
            const item = store.get(session.guildId, Number(raw));
            if (!item || item.archived || !item.available) throw new Error("This item number is not accepting requests.");
            if (itemNumber && (item.number !== Number(itemNumber) || item.revision !== Number(revision))) throw new Error("The listing changed since you opened this form. Refresh before requesting it.");
            const cooldown = rejectIfRateLimited(`catalog-ticket:${session.guildId}:${session.userId}`, 15_000);
            if (cooldown) throw new Error(cooldown);
            const notes = interaction.fields.getTextInputValue("notes").trim().slice(0, 1000);
            const result = await createTicketChannel(interaction.guild, session.userId, `Store item #${item.number}: ${item.name}`, "normal", true, {
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
            if (!pending || pending.token !== itemNumber) throw new Error("This confirmation expired or has already been used.");
            delete session.pending;
            const item = pending.kind === "save" ? store.save(session.guildId, session.userId, pending.input, pending.reason, pending.existing)
                : store.setStatus(session.guildId, session.userId, pending.number, pending.revision, pending.field, pending.value, pending.reason);
            session.selected = item.number;
            notice = `Item #${item.number} saved.`;
            appendAuditEvent("store_catalog_changed", { guildId: session.guildId, actorId: session.userId, itemNumber: item.number, revision: item.revision, reason: pending.reason });
            try { await ensureStorePanelsForGuild(interaction.guild); }
            catch (error) {
                console.error("[store] Catalog saved but public panel refresh failed:", error);
                notice += " The public panel could not refresh; saved listings are available through Browse Catalog. Check bot permissions and logs.";
            }
        } else {
            delete session.pending;
            if (action === "item" && interaction.isStringSelectMenu()) {
                const item = store.get(session.guildId, Number(interaction.values[0]));
                if (!item || (!session.admin && item.archived)) throw new Error("This item is no longer listed.");
                session.selected = item.number;
            } else if (action === "search_modal" && interaction.isModalSubmit()) {
                session.search = interaction.fields.getTextInputValue("search").trim().slice(0, 100);
                session.page = 0; session.selected = null;
            } else if (action === "home") { session.selected = null; session.search = ""; session.page = 0; }
            else if (action === "back") session.selected = null;
            else if (action === "next") { session.page++; session.selected = null; }
            else if (action === "previous") { session.page--; session.selected = null; }
            else if (action !== "refresh") throw new Error("Unknown store action. Open a new workspace.");
        }
        await interaction.editReply({ ...workspace(session), content: notice });
    } catch (error) {
        console.error("[store] Interaction failed:", error);
        const content = `Store: ${error instanceof Error ? error.message : "The action failed. Please contact the owner."}`.slice(0, 1800);
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [], attachments: [], allowedMentions: { parse: [] } });
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
    return true;
}
