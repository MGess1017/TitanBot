import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import * as discord from "discord.js";
import * as catalogModule from "./storeCatalog";
import * as features from "../features/storePanel";
import { createTicketEntry as createStateTicket, type TicketRecord } from "../services/ticketState";
import { classifyTicketCategory, getTicketSlaPolicy, hydrateTicketIntakeFields } from "../services/ticketEnhancements";
import { flushJsonWrites } from "./jsonPersistence";

async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fnt-store-"));
    const guildId = "1560000000000000001", ownerId = "1560000000000000002", managerId = "807001514287169587", buyerId = "1560000000000000003";
    const adminChannel = "1569956286181937274", publicChannel = "1569955515205685329";
    try {
        const file = path.join(directory, "catalog.json");
        const catalog = new catalogModule.StoreCatalog(file);
        const sample = { name: "Field Supply Pack", price: "500 FN Tokenz (owner confirms)", description: "A manually fulfilled supply request.", category: "Supplies" };
        assert.throws(() => catalogModule.validateCatalogInput({ ...sample, description: " " }));
        assert.throws(() => catalogModule.validateCatalogInput({ ...sample, name: "x".repeat(81) }));
        const first = catalog.save(guildId, managerId, sample, "Publish first item");
        assert.equal(first.number, 1);
        assert.equal(first.revision, 1);
        assert.equal(new catalogModule.StoreCatalog(file).get(guildId, 1)?.description, sample.description);
        const edited = catalog.save(guildId, ownerId, { ...sample, price: "600 FN Tokenz" }, "Update listed cost", { number: 1, revision: 1 });
        assert.equal(edited.revision, 2);
        assert.throws(() => catalog.save(guildId, ownerId, sample, "Stale edit", { number: 1, revision: 1 }), /changed since preview/);
        catalog.setStatus(guildId, ownerId, 1, 2, "archived", true, "Archive");
        assert.equal(catalog.list(guildId).length, 0);
        const second = catalog.save(guildId, ownerId, sample, "New item");
        assert.equal(second.number, 2, "archived item numbers are never reused");
        assert.equal(catalog.history(guildId).length, 4);
        assert.equal(catalog.list("1560000000000000099").length, 0, "catalogs are server-scoped");
        catalog.setStatus(guildId, ownerId, 1, 3, "archived", false, "Restore");
        const blocker = path.join(directory, "blocker");
        const blocked = new catalogModule.StoreCatalog(path.join(blocker, "catalog.json"));
        fs.writeFileSync(blocker, "not a directory");
        const originalError = console.error;
        try {
            console.error = () => undefined;
            assert.throws(() => blocked.save(guildId, managerId, sample, "Save failure"));
        } finally { console.error = originalError; }
        assert.equal(blocked.list(guildId).length, 0, "failed persistence cannot publish an in-memory item");
        fs.unlinkSync(blocker);
        assert.equal(blocked.save(guildId, managerId, sample, "Retry").number, 1, "failed writes must not consume item numbers");
        fs.writeFileSync(path.join(directory, "corrupt.json"), "{bad");
        assert.throws(() => new catalogModule.StoreCatalog(path.join(directory, "corrupt.json")));
        fs.copyFileSync(file, path.join(directory, "missing.json.bak"));
        assert.throws(() => new catalogModule.StoreCatalog(path.join(directory, "missing.json.bak").replace(/\.bak$/, "")), /backups exist/);
        for (let i = 0; i < 10; i++) catalog.save(guildId, managerId, { ...sample, name: `Pack ${i}` }, "Populate pages");
        const session: features.StoreSession = { id: randomUUID(), userId: buyerId, guildId, admin: false, expiresAt: Date.now() + 10_000, page: 0, search: "", selected: null };
        function validatePayload(payload: { components: Array<{ toJSON(): { components: Array<{ custom_id?: string; options?: unknown[] }> } }> }) {
            assert.ok(payload.components.length <= 5);
            const ids = payload.components.flatMap(row => {
                const components = row.toJSON().components;
                assert.ok(components.length <= 5);
                for (const component of components) if (component.options) assert.ok(component.options.length <= 25);
                return components.map(component => component.custom_id).filter(Boolean);
            });
            assert.equal(ids.length, new Set(ids).size);
            for (const id of ids) assert.ok(id!.length <= 100);
        }
        validatePayload(features.buildStoreLauncher(catalog.list(guildId)));
        validatePayload(features.buildStoreLauncher([], true));
        for (const admin of [false, true]) for (const selected of [null, 1]) validatePayload(features.buildStoreWorkspace({ ...session, admin, selected }, catalog.list(guildId, admin)));
        const publicPayload = features.buildStoreLauncher(catalog.list(guildId));
        assert.equal(publicPayload.embeds[0].toJSON().fields?.length, 5, "public panel stays compact");
        assert.match(publicPayload.embeds[0].toJSON().description!, /no currency is deducted/);
        assert.equal(features.buildStoreEditModal(session).toJSON().components.length, 5);
        assert.equal(features.buildStoreSimpleModal(session, "request", first).toJSON().components.length, 2);
        validatePayload(features.buildStoreConfirmation(session, randomUUID(), features.catalogItemEmbed(first), "Confirm"));
        const searchSession = { ...session, search: "Pack 9" };
        const searched = features.buildStoreWorkspace(searchSession, catalog.list(guildId));
        assert.equal(searched.embeds[0].toJSON().fields?.length, 1);
        const pageSession = { ...session, page: 999 };
        features.buildStoreWorkspace(pageSession, catalog.list(guildId));
        assert.equal(pageSession.page, 2);
        assert.equal(classifyTicketCategory("store"), "store");
        assert.equal(getTicketSlaPolicy("store", "normal").name, "Store Inquiry");

        const exports: Record<string, any> = {};
        let currentOwner = ownerId, guildFetches = 0, ticketsCreated = 0, panelEdits = 0, panelSends = 0;
        let requestResult: { error?: string; channelId?: string; ticketId?: number } = { channelId: "ticket-channel", ticketId: 7 };
        let savedArguments: unknown[] = [];
        const messages = new Map<string, { id: string; author: { id: string }; embeds: Array<{ title: string }>; edit(payload: unknown): Promise<unknown> }>();
        const guild = { id: guildId, ownerId: currentOwner, fetch: async () => { guildFetches++; guild.ownerId = currentOwner; return guild; },
            members: { fetch: async (request: { user: string; force: boolean }) => { assert.equal(request.force, true); return { id: request.user }; } },
            client: { user: { id: "bot" } },
            channels: { fetch: async (channelId: string) => ({ id: channelId, type: discord.ChannelType.GuildText,
                messages: { fetch: async (arg: string | { limit: number }) => typeof arg === "string" ? messages.get(channelId) : new discord.Collection(messages.has(channelId) ? [[channelId, messages.get(channelId)!]] : []) },
                send: async (payload: { embeds: discord.EmbedBuilder[] }) => {
                    panelSends++;
                    const message = { id: `message-${channelId}`, author: { id: "bot" }, embeds: [{ title: payload.embeds[0].toJSON().title! }],
                        edit: async () => { panelEdits++; return message; } };
                    messages.set(channelId, message); return message;
                }
            }) }
        };
        const handlerErrors: unknown[][] = [];
        const context = vm.createContext({ Error, exports, module: { exports }, console: { error: (...args: unknown[]) => handlerErrors.push(args) },
            require: (id: string) => {
                if (id === "node:crypto") return { randomUUID };
                if (id === "node:path") return path;
                if (id === "discord.js") return discord;
                if (id === "../../features/storePanel") return features;
                if (id === "../../runtime/storeCatalog") return { ...catalogModule, StoreCatalog: class { constructor() { return catalog; } } };
                if (id === "../core/config") return { STORE_ADMIN_CHANNEL_ID: adminChannel, STORE_CHANNEL_ID: publicChannel, STORE_MANAGER_USER_ID: managerId };
                if (id === "../core/paths") return { BOT_SRC_DIR: directory };
                if (id === "../core/audit") return { appendAuditEvent: () => undefined };
                if (id === "../moderation/store") return { getGuildPanelMessageId: () => null, setGuildPanelMessageId: () => undefined };
                if (id === "../tickets/channels") return { createTicketChannel: async (...args: unknown[]) => { ticketsCreated++; savedArguments = args; return requestResult; } };
                if (id === "../../runtime/rateLimit") return { rejectIfRateLimited: () => null };
                throw new Error(`Unexpected dependency ${id}`);
            } });
        vm.runInContext(ts.transpileModule(`${fs.readFileSync(path.resolve(__dirname, "..", "bot", "panels", "store.ts"), "utf8")}\nexports.sessions = sessions;`, {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
        }).outputText, context);
        const sessions = exports.sessions as Map<string, features.StoreSession & { pending?: { token: string } }>;
        async function run(kind: "button" | "select" | "modal", action: string, userId = buyerId, channelId = publicChannel, fields: Record<string, string> = {}, values: string[] = []) {
            const replies: any[] = [];
            const interaction = { customId: `catalog:${action}`, user: { id: userId }, guild, guildId, channelId, values,
                message: { flags: { has: () => action !== "number" } }, isButton: () => kind === "button",
                isStringSelectMenu: () => kind === "select", isModalSubmit: () => kind === "modal", isFromMessage: () => true,
                fields: { getTextInputValue: (key: string) => fields[key] || "" }, deferred: false, replied: false,
                deferUpdate: async () => { interaction.deferred = true; }, deferReply: async () => { interaction.deferred = true; },
                reply: async (payload: unknown) => { interaction.replied = true; replies.push(payload); }, editReply: async (payload: unknown) => replies.push(payload),
                showModal: async (modal: unknown) => replies.push(modal) };
            assert.equal(await exports.handleStoreInteraction(interaction), true);
            if (replies.at(-1)?.content === "Store: The action failed. Please contact the owner.") throw handlerErrors.at(-1)?.[1];
            return replies.at(-1);
        }
        assert.match((await run("button", "admin", buyerId, adminChannel)).content, /Only the server owner/);
        assert.match((await run("button", "admin", "402639384756879360", adminChannel)).content, /Only the server owner/, "other Owner Panel users do not automatically manage the store");
        assert.match((await run("button", "browse", buyerId, adminChannel)).content, /other store panel/);
        assert.match((await run("button", "browse", buyerId, "wrong")).content, /designated store panels/);
        assert.equal((await run("button", "browse")).flags, discord.MessageFlags.Ephemeral);
        const buyerSession = [...sessions.values()].find(session => !session.admin)!;
        assert.match((await run("button", `refresh:${buyerSession.id}`, ownerId)).content, /belongs to someone else/);
        assert.match((await run("button", `add:${buyerSession.id}`)).content, /store-admin workspace/);
        await run("select", `item:${buyerSession.id}`, buyerId, publicChannel, {}, ["1"]);
        await run("modal", `request_modal:${buyerSession.id}:1:4`, buyerId, publicChannel, { number: "1", notes: "Please confirm availability" });
        assert.equal(ticketsCreated, 1);
        assert.equal((savedArguments[6] as catalogModule.CatalogItem).number, 1);
        assert.equal((savedArguments[5] as { orderId: string }).orderId, "CAT-1-R4");
        assert.match((savedArguments[5] as { details: string }).details, /600 FN Tokenz/);
        assert.equal(savedArguments[1], buyerId);
        assert.match((await run("modal", `request_modal:${buyerSession.id}`, buyerId, publicChannel, { number: "999" })).content, /not accepting requests/);
        catalog.setStatus(guildId, managerId, 1, 4, "available", false, "Unavailable now");
        assert.match((await run("modal", `request_modal:${buyerSession.id}`, buyerId, publicChannel, { number: "1" })).content, /not accepting requests/);
        assert.equal(ticketsCreated, 1);
        requestResult = { error: "You already have an open store inquiry: <#existing>" };
        assert.match((await run("modal", `request_modal:${buyerSession.id}`, buyerId, publicChannel, { number: "2" })).content, /already have an open store/);
        await run("button", "admin", managerId, adminChannel);
        const adminSession = [...sessions.values()].find(session => session.admin)!;
        const editForm = { ...sample, reason: "New listing via panel" };
        await run("modal", `save:${adminSession.id}:0:0`, managerId, adminChannel, editForm);
        const token = adminSession.pending!.token;
        const count = catalog.list(guildId).length;
        assert.match((await run("button", `confirm:${adminSession.id}:${token}`, managerId, adminChannel)).content, /saved/);
        assert.equal(catalog.list(guildId).length, count + 1);
        assert.match((await run("button", `confirm:${adminSession.id}:${token}`, managerId, adminChannel)).content, /already been used/);
        assert.equal(catalog.list(guildId).length, count + 1);
        await run("button", "admin", ownerId, adminChannel);
        const oldOwnerSession = [...sessions.values()].find(session => session.userId === ownerId)!;
        currentOwner = "1560000000000000099";
        assert.match((await run("button", `refresh:${oldOwnerSession.id}`, ownerId, adminChannel)).content, /Only the server owner/, "ownership transfer must take effect on every interaction");
        assert.ok(guildFetches >= 5);
        await exports.ensureStorePanelsForGuild(guild);
        await Promise.all([exports.ensureStorePanelsForGuild(guild), exports.ensureStorePanelsForGuild(guild)]);
        assert.equal(panelSends, 2, "upsert must create one launcher per designated channel");
        assert.ok(panelEdits >= 2, "repeat upsert must edit existing launchers, not spam channels");
        buyerSession.expiresAt = Date.now() - 1;
        assert.match((await run("button", `refresh:${buyerSession.id}`)).content, /expired/);

        await verifyOwnerTicketRouting(guildId, buyerId, ownerId, catalog.get(guildId, 2)!);
        console.log("Store: durable catalog, permanent numbers, validation, private UI, admin authorization, receipts and owner-only ticket routing checks passed.");
    } finally {
        await flushJsonWrites();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

async function verifyOwnerTicketRouting(guildId: string, buyerId: string, ownerId: string, item: catalogModule.CatalogItem) {
    const sourcePath = path.resolve(__dirname, "..", "bot", "tickets", "channels.ts");
    const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, "utf8"), ts.ScriptTarget.ES2020, true);
    const fn = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "createTicketChannel");
    assert.ok(fn);
    const state = { nextId: 1, version: 1, tickets: [] as TicketRecord[] };
    const channels = new Map<string, any>();
    let activeLock = false, autoRoutes = 0, botPermissions = true, saveOkay = true, deleted = 0, posted = 0;
    let overwrites: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }> = [];
    const botMember = { id: "bot", permissions: { has: () => botPermissions } };
    const buyer = { id: buyerId, user: { tag: "Buyer", username: "Buyer" } };
    const guild: any = { id: guildId, ownerId, roles: { everyone: { id: "everyone" } },
        members: { me: botMember, fetchMe: async () => botMember, fetch: async (arg: string | { user: string }) => {
            const id = typeof arg === "string" ? arg : arg.user;
            return id === buyerId ? buyer : { id: ownerId };
        } },
        fetch: async () => guild,
        channels: { cache: channels, fetch: async (id?: string) => id ? channels.get(id) || null : channels,
            create: async (payload: any) => {
                overwrites = payload.permissionOverwrites;
                const channel = { id: "new-store-channel", type: discord.ChannelType.GuildText, topic: payload.topic,
                    permissionsFor: () => ({ has: () => true }), delete: async () => { deleted++; channels.delete(channel.id); },
                    send: async (message: { files: discord.AttachmentBuilder[] }) => {
                        assert.ok(message.files[0].name?.startsWith("store-item-"));
                        const attachment = message.files[0].attachment;
                        assert.ok(Buffer.isBuffer(attachment));
                        assert.match(attachment.toString("utf8"), /NOT A PURCHASE/);
                        assert.ok(attachment.toString("utf8").includes(item.description));
                        posted++; return { id: "intro" };
                    } };
                channels.set(channel.id, channel); return channel;
            } }
    };
    const context = vm.createContext({ Error, console, Buffer, AttachmentBuilder: discord.AttachmentBuilder, ChannelType: discord.ChannelType, PermissionFlagsBits: discord.PermissionFlagsBits,
        recordTicketCreateAttempt: () => undefined, recordTicketCreateFailure: () => undefined,
        getTicketCaseBucket: (category: string) => category === "store" ? "store" : "support",
        tryAcquireTicketCreateLock: () => { if (activeLock) return false; activeLock = true; return true; }, releaseTicketCreateLock: () => { activeLock = false; },
        purgeLegacyImportedTicketRecords: () => undefined, pruneDeletedTicketRecords: async () => undefined, pruneInaccessibleOwnerTicketRecords: async () => undefined,
        evaluateTicketDeflection: () => { throw new Error("Store requests must bypass generic ticket deflection"); },
        findOpenTicketByOwnerInBucket: (_guild: string, owner: string, bucket: string) => state.tickets.find(ticket => ticket.ownerId === owner
            && ["open", "claimed"].includes(ticket.status) && (ticket.category === "store" ? "store" : "support") === bucket),
        findOwnerActiveTicketChannelsInBucket: async () => [],
        ensureTrackedTicketByChannelId: async () => null, findChannelOwnerFromTopic: (topic: string) => topic.match(/\((\d+)\)$/)?.[1],
        findTicketByChannel: (id: string) => state.tickets.find(ticket => ticket.channelId === id),
        saveTicketStore: () => saveOkay, ticketStore: state, appendAuditEvent: () => undefined,
        ensureTicketConfig: () => ({ categoryId: null }), TICKET_DEFAULT_CATEGORY_ID: "category", TICKET_HANDLER_ROLE_ID: "handlers",
        createTicketEntry: (...args: [string, string, string, string, "normal"]) => createStateTicket(state, ...args, () => saveOkay),
        hydrateTicketIntakeFields, classifyTicketCategory, getTicketSlaPolicy,
        applyTicketMetadata: (ticket: TicketRecord) => { ticket.category = "general"; },
        buildTicketOpsEmbed: (ticket: TicketRecord) => { assert.equal(ticket.assignedToId, ownerId); return {}; }, buildTicketOpsComponents: () => [],
        setTicketPanelMessageId: () => undefined, sendTicketLog: async () => undefined,
        autoRouteTicket: async () => { autoRoutes++; }, notifyTicketRecipient: async (ticket: TicketRecord) => { assert.equal(ticket.assignedToId, ownerId); },
        reconcileOwnerTicketDuplicates: async () => undefined, removeTicketStoreEntryByChannelId: async () => undefined
    });
    vm.runInContext(ts.transpileModule(fn.getText(source).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
    const intake = { category: "store", summary: `Item #${item.number}`, orderId: `CAT-${item.number}-R${item.revision}`, details: item.description };
    const result = await context.createTicketChannel(guild, buyerId, "Store inquiry", "normal", true, intake, item);
    assert.equal(result.channelId, "new-store-channel");
    assert.equal(state.tickets[0].assignedToId, ownerId);
    assert.equal(state.tickets[0].status, "claimed", "owner-routed tickets must not be auto-closed as unclaimed");
    assert.equal(state.tickets[0].category, "store");
    assert.equal(state.tickets[0].intakeDetails, item.description);
    assert.equal(state.tickets[0].intakeOrderId, `CAT-${item.number}-R${item.revision}`);
    assert.equal(autoRoutes, 0);
    assert.ok(overwrites.some(overwrite => overwrite.id === ownerId));
    assert.ok(overwrites.some(overwrite => overwrite.id === buyerId));
    assert.ok(overwrites.some(overwrite => overwrite.id === "bot"));
    assert.ok(overwrites.find(overwrite => overwrite.id === "everyone")?.deny?.includes(discord.PermissionFlagsBits.ViewChannel));
    assert.ok(!overwrites.some(overwrite => overwrite.id === "handlers"), "normal handler role must not get store ticket access");
    assert.equal(posted, 1);
    const duplicate = await context.createTicketChannel(guild, buyerId, "Store inquiry", "normal", true, intake, item);
    assert.match(duplicate.error, /already have an open store/);
    assert.equal(posted, 1, "duplicate clicks must not create another ticket");
    state.tickets[0].category = "general";
    const interruptedRouting = await context.createTicketChannel(guild, buyerId, "Store inquiry", "normal", true, intake, item);
    assert.match(interruptedRouting.error, /already have an open store/);
    assert.equal(state.tickets[0].category, "store", "interrupted initial record creation must not lose the dedicated store bucket");
    assert.equal(posted, 1);
    state.tickets.length = 0;
    const recovered = await context.createTicketChannel(guild, buyerId, "Store inquiry", "normal", true, intake, item);
    assert.match(recovered.error, /already have an open store/, "restart after Discord creation but before persistence must recover the existing owner channel");
    assert.equal(state.tickets.length, 1);
    assert.equal(state.tickets[0].assignedToId, ownerId);
    state.tickets.length = 0; channels.clear();
    botPermissions = false;
    assert.match((await context.createTicketChannel(guild, buyerId, "Store inquiry", "normal", true, intake, item)).error, /Manage Channels and Manage Roles/);
    botPermissions = true; saveOkay = false;
    assert.match((await context.createTicketChannel(guild, buyerId, "Store inquiry", "normal", true, intake, item)).error, /persistence conflict/);
    assert.equal(deleted, 1, "failed record creation must roll back only the channel created for the request");
    assert.equal(activeLock, false, "all failure paths must release the per-user creation lock");
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
