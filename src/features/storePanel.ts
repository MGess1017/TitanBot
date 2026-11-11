import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { CatalogItem } from "../runtime/storeCatalog";

export const STORE_PREFIX = "catalog:";
export const STORE_TITLE = "FNTCORD | Store";
export const STORE_ADMIN_TITLE = "FNTCORD | Store Management";
export type StoreSession = {
    id: string; userId: string; guildId: string; admin: boolean; expiresAt: number;
    page: number; search: string; selected: number | null;
};
const purple = 0x9b59b6;
const safe = (text: string) => text.replace(/([\\`*_~|>])/g, "\\$1");

export function catalogItemEmbed(item: CatalogItem) {
    return new EmbedBuilder().setColor(purple).setTitle(`FNTCORD | Item #${item.number} - ${item.name}`)
        .setDescription(item.description).addFields(
            { name: "Listed Cost", value: safe(item.price), inline: true },
            { name: "Category", value: safe(item.category), inline: true },
            { name: "Availability", value: item.archived ? "Archived / hidden" : item.available ? "Accepting requests" : "Unavailable", inline: true }
        ).setFooter({ text: `CATALOG ONLY / NO AUTOMATIC CHARGE / ITEM #${item.number} / REVISION ${item.revision}` });
}

export function buildStoreLauncher(items: CatalogItem[], admin = false) {
    const visible = items.filter(item => !item.archived);
    const embed = new EmbedBuilder().setColor(purple).setTitle(admin ? STORE_ADMIN_TITLE : STORE_TITLE)
        .setDescription(admin
            ? "Owner-only catalog management. Add numbered items, descriptions and listed costs; edit or archive listings privately."
            : "Browse the catalog privately or request an item by number to open a ticket directly with the server owner.\nCatalog only: requests are not purchases; no currency is deducted.");
    if (!admin) {
        if (!visible.length) embed.addFields({ name: "Catalog", value: "The owner has not published any items yet." });
        for (const item of visible.slice(0, 5)) embed.addFields({
            name: `#${item.number} - ${item.name} | ${item.available ? item.price : "Unavailable"}`.slice(0, 256),
            value: `${safe(item.description.slice(0, 140))}${item.description.length > 140 ? "..." : ""}`
        });
        embed.setFooter({ text: `${visible.length} LISTINGS / FULL DESCRIPTIONS INSIDE / FNTCORD` });
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
        .setCustomId(`${STORE_PREFIX}${admin ? "admin" : "browse"}`).setLabel(admin ? "Manage Store" : "Browse Catalog").setStyle(ButtonStyle.Primary));
    if (!admin) row.addComponents(new ButtonBuilder().setCustomId(`${STORE_PREFIX}number`).setLabel("Request by Item #").setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] as const } };
}

export function storeNavigation(session: StoreSession) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...[["home", "Home"], ["back", "Back"], ["refresh", "Refresh"], ["customize", session.admin ? "Customize" : "Search"]].map(([action, label]) =>
            new ButtonBuilder().setCustomId(`${STORE_PREFIX}${action}:${session.id}`).setLabel(label).setStyle(ButtonStyle.Secondary))
    );
}

export function buildStoreWorkspace(session: StoreSession, allItems: CatalogItem[]) {
    const id = (action: string) => `${STORE_PREFIX}${action}:${session.id}`;
    const selected = allItems.find(item => item.number === session.selected);
    const filtered = allItems.filter(item => (session.admin || !item.archived) && (!session.search
        || `${item.number} ${item.name} ${item.category} ${item.description}`.toLowerCase().includes(session.search.toLowerCase())));
    const pages = Math.max(1, Math.ceil(filtered.length / 5));
    session.page = Math.min(Math.max(0, session.page), pages - 1);
    const page = filtered.slice(session.page * 5, session.page * 5 + 5);
    const embed = selected ? catalogItemEmbed(selected) : new EmbedBuilder().setColor(purple)
        .setTitle(session.admin ? STORE_ADMIN_TITLE : STORE_TITLE)
        .setDescription(`${session.search ? `Search: ${safe(session.search)}\n` : ""}${filtered.length} listings / Page ${session.page + 1} of ${pages}\n${session.admin ? "Choose an item to edit its details, availability or publication status." : "Select an item for full details, then request it in a private owner ticket. No payment is taken."}`);
    if (!selected) {
        if (!page.length) embed.addFields({ name: "No items", value: session.admin ? "Add your first listing to publish the catalog." : "No matching items are published." });
        for (const item of page) embed.addFields({ name: `#${item.number} - ${item.name}`.slice(0, 256),
            value: `${safe(item.price)} / ${safe(item.category)} / ${item.archived ? "Archived" : item.available ? "Available" : "Unavailable"}\n${safe(item.description.slice(0, 150))}${item.description.length > 150 ? "..." : ""}` });
    }
    const components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
    if (page.length) components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(id("item")).setPlaceholder(session.admin ? "Manage item number" : "View item number")
            .addOptions(page.map(item => ({ label: `#${item.number} - ${item.name}`.slice(0, 100), value: String(item.number), description: item.price.slice(0, 100) })))
    ));
    const actions = new ActionRowBuilder<ButtonBuilder>();
    if (session.admin) {
        actions.addComponents(new ButtonBuilder().setCustomId(id("add")).setLabel("Add Item").setStyle(ButtonStyle.Primary));
        if (selected) actions.addComponents(
            new ButtonBuilder().setCustomId(id("edit")).setLabel("Edit Item").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(id("availability")).setLabel(selected.available ? "Mark Unavailable" : "Mark Available").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(id("archive")).setLabel(selected.archived ? "Restore Listing" : "Archive Listing").setStyle(ButtonStyle.Danger)
        );
    } else if (selected && !selected.archived) actions.addComponents(
        new ButtonBuilder().setCustomId(id("request")).setLabel(`Request Item #${selected.number}`).setStyle(ButtonStyle.Primary).setDisabled(!selected.available)
    );
    if (actions.components.length) components.push(actions);
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(id("previous")).setLabel("Previous Page").setStyle(ButtonStyle.Secondary).setDisabled(session.page === 0),
        new ButtonBuilder().setCustomId(id("next")).setLabel("Next Page").setStyle(ButtonStyle.Secondary).setDisabled(session.page >= pages - 1)
    ), storeNavigation(session));
    return { content: "", embeds: [embed], components, attachments: [], allowedMentions: { parse: [] as const } };
}

function input(id: string, label: string, max: number, value?: string, paragraph = false, required = true) {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setRequired(required)
        .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (value) field.setValue(value);
    return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}
export function buildStoreEditModal(session: StoreSession, item?: CatalogItem) {
    return new ModalBuilder().setCustomId(`${STORE_PREFIX}save:${session.id}:${item?.number || 0}:${item?.revision || 0}`)
        .setTitle(item ? `FNTCORD | Edit Item #${item.number}` : "FNTCORD | New Store Item")
        .addComponents(input("name", "Item name", 80, item?.name), input("price", "Listed cost (include currency / units)", 80, item?.price),
            input("description", "Item description", 1000, item?.description, true),
            input("category", "Category", 40, item?.category || "General"),
            input("reason", "Reason for this catalog change", 300));
}
export function buildStoreSimpleModal(session: StoreSession, action: "search" | "request" | "status", item?: CatalogItem) {
    const modal = new ModalBuilder().setCustomId(`${STORE_PREFIX}${action}_modal:${session.id}${item ? `:${item.number}:${item.revision}` : ""}`)
        .setTitle(action === "search" ? "FNTCORD | Search Store" : action === "request" ? "FNTCORD | Request Store Item" : "FNTCORD | Update Listing");
    if (action === "search") modal.addComponents(input("search", "Name, category or item number (blank = all)", 100, session.search, false, false));
    else if (action === "request") modal.addComponents(input("number", "Item number", 12, item ? String(item.number) : undefined),
        input("notes", "Optional request details (no payment info)", 1000, undefined, true, false));
    else modal.addComponents(input("reason", "Reason for this catalog change", 300));
    return modal;
}

export function buildStoreConfirmation(session: StoreSession, token: string, embed: EmbedBuilder, summary: string) {
    return { content: summary, embeds: [embed], components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${STORE_PREFIX}confirm:${session.id}:${token}`).setLabel("Confirm Catalog Change").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`${STORE_PREFIX}back:${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        )
    ], allowedMentions: { parse: [] as const } };
}
