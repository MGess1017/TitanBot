"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INQUIRY_GUIDES = exports.HUB_SECTIONS = exports.INQUIRY_IDS = exports.INQUIRY_LEGACY_TITLE = exports.INQUIRY_TITLE = void 0;
exports.buildInquiryIndex = buildInquiryIndex;
exports.searchInquiry = searchInquiry;
exports.inquiryControls = inquiryControls;
exports.buildInquiryHome = buildInquiryHome;
exports.buildInquiryEntry = buildInquiryEntry;
exports.buildInquirySearch = buildInquirySearch;
exports.buildInquiryModal = buildInquiryModal;
exports.hubParent = hubParent;
exports.hubNavigation = hubNavigation;
exports.withHubNavigation = withHubNavigation;
exports.buildHubSection = buildHubSection;
exports.buildHubSettings = buildHubSettings;
const discord_js_1 = require("discord.js");
const slashCatalog_1 = require("../commands/slashCatalog");
const staffDesk_1 = require("./staffDesk");
exports.INQUIRY_TITLE = "FNT | Command Hub";
exports.INQUIRY_LEGACY_TITLE = "FNT | Player Inquiry";
exports.INQUIRY_IDS = {
    browse: "inquiry:browse", search: "inquiry:search", rs3: "inquiry:rs3",
    searchModal: "inquiry:search_modal", rs3Modal: "inquiry:rs3_modal", result: "inquiry:result",
    open: "inquiry:open:", refresh: "inquiry:refresh:", preference: "inquiry:preference:",
    saveName: "inquiry:save_name", saveNameModal: "inquiry:save_name_modal"
};
exports.HUB_SECTIONS = {
    profiles: { title: "Profiles", description: "Your identity, cards and RuneScape", items: ["xp", "pmc", "profile", "rs3"] },
    operations: { title: "Operations", description: "Raid preparation and field guides", items: ["inventory", "guide:raids", "guide:shop"] },
    economy: { title: "Economy", description: "Wallet, banking and supply directory", items: ["wallet", "guide:bank", "guide:games"] },
    guides: { title: "Guides & Support", description: "Quick answers and private assistance", items: ["guide:general", "guide:xp", "guide:rs3", "support"] }
};
const HUB_DESTINATIONS = {
    xp: { label: "XP Card", description: "Level, rank and next milestone" },
    pmc: { label: "PMC Dossier", description: "Raid progression and deployment readiness" },
    profile: { label: "Personal Profile", description: "Themes, achievements and preferences" },
    rs3: { label: "RuneScape Profile", description: "Open your saved player or search by name" },
    inventory: { label: "Inventory", description: "Your equipment and collected supplies" },
    wallet: { label: "Wallet & Bank", description: "Your current balances" },
    support: { label: "Private Support", description: "Find the designated support panel" }
};
exports.INQUIRY_GUIDES = [
    { id: "general", title: "Mission Brief", tags: ["start", "guide", "help"], body: "Build server XP by chatting and joining voice. Earn raid XP separately with your PMC.\nOpen **My Profile** for achievements and collections. Use the support panel for private assistance." },
    { id: "xp", title: "XP Ops", tags: ["level", "voice", "crate", "rank", "xp"], body: "Chat and voice build server XP. Continuous voice time unlocks the 2x bonus; disconnecting resets it.\nClaim one daily XP crate from the FN Xp Panel. **My XP Card** shows your level, rank and next crate." },
    { id: "raids", title: "Raid Ops", tags: ["pmc", "raid", "boss", "prestige"], body: "Start with a small `/raid` stake and low tension. Extraction earns loot and PMC XP; failed raids can lose the stake.\nBosses telegraph attacks: defend when threatened, heal with med patches, or extract. **My PMC Card** opens the full dossier navigation." },
    { id: "shop", title: "Supply Crates", tags: ["shop", "inventory", "gear", "repair"], body: "Use `/shop` for supplies and `/inventory` for your gear. Repair damaged equipment before raids.\nOpen your profile for cosmetic collections. Cosmetic purchases do not improve combat stats." },
    { id: "games", title: "Training Grounds", tags: ["games", "casino", "bet"], body: "Open `/casino lobby` to browse games. Check the rules and wager before playing.\nCasino wagers spend FN Token$ and can lose. Server XP and PMC progression are separate." },
    { id: "bank", title: "Bank and Trade", tags: ["tokens", "wallet", "bank", "trade", "daily"], body: "Use `/balance` for your wallet, `/bank` for banked tokens, and `/daily` for your streak reward.\nDeposit or withdraw with `/deposit` and `/withdraw`. Review item quantities before confirming a trade." },
    { id: "rs3", title: "RuneScape 3", tags: ["runescape", "jagex", "quest", "rs3", "gzawizz"], body: "Choose **RuneScape Search** and enter a display name to see Jagex's avatar, quest progress and available RuneMetrics stats.\nPrivate profiles and service outages may hide stats. Avatars are Jagex-published images, not live gameplay screenshots." }
];
function buildInquiryIndex() {
    const entries = exports.INQUIRY_GUIDES.map(guide => ({ ...guide, id: `guide:${guide.id}`, kind: "guide" }));
    for (const command of (0, slashCatalog_1.buildSlashCommands)({ raidConditionChoices: [], raidMapChoices: [] })) {
        const data = command.toJSON();
        if (data.default_member_permissions !== undefined && data.default_member_permissions !== null)
            continue;
        const subcommands = data.options?.filter(option => option.type === 1) || [];
        if (subcommands.length) {
            for (const option of subcommands) {
                entries.push({ id: `command:${data.name} ${option.name}`, title: `/${data.name} ${option.name}`, body: option.description, tags: [data.name, option.name], kind: "command" });
            }
        }
        else {
            entries.push({ id: `command:${data.name}`, title: `/${data.name}`, body: data.description, tags: [data.name], kind: "command" });
        }
    }
    return entries;
}
function searchInquiry(query, entries = buildInquiryIndex()) {
    const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    if (!tokens.length)
        throw new Error("Enter a guide topic or command name to search.");
    return entries.map(entry => ({ entry, score: (0, staffDesk_1.scoreText)(tokens, entry.title, entry.body, [...entry.tags]) }))
        .filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
        .slice(0, 6).map(hit => hit.entry);
}
function inquiryControls() {
    const browse = new discord_js_1.StringSelectMenuBuilder().setCustomId(exports.INQUIRY_IDS.browse).setPlaceholder("Choose your workspace").addOptions(Object.entries(exports.HUB_SECTIONS).map(([key, section]) => ({ label: section.title, value: `section:${key}`, description: section.description })));
    return [
        new discord_js_1.ActionRowBuilder().addComponents(browse).toJSON(),
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.INQUIRY_IDS.search).setLabel("Search Guides & Commands").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.INQUIRY_IDS.open}shortcut`).setLabel("My Quick Access").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.INQUIRY_IDS.open}settings`).setLabel("Customize").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON()
    ];
}
function buildInquiryHome() {
    return {
        embed: new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle(exports.INQUIRY_TITLE)
            .setDescription("**Your server. Your workspace.**\nProfiles, operations, economy and answers in one place.\nChoose a workspace below. Everything opens privately.")
            .setFooter({ text: "FNT / COMMAND HUB / PERSONAL WORKSPACE" })
            .toJSON(),
        components: inquiryControls()
    };
}
function buildInquiryEntry(entry) {
    return {
        embed: new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle(entry.title).setDescription(entry.body).toJSON(),
        components: []
    };
}
function buildInquirySearch(query) {
    const results = searchInquiry(query);
    const embed = new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle("Inquiry Search")
        .setDescription(results.length
        ? results.map((entry, index) => `**${index + 1}. ${entry.title}**\n${entry.body.split("\n")[0].slice(0, 160)}`).join("\n\n")
        : "No matching guides or commands. Try XP, PMC, crates, bank or RuneScape.");
    return {
        embed: embed.toJSON(),
        components: results.length ? [
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId(exports.INQUIRY_IDS.result).setPlaceholder("Open a result")
                .addOptions(results.map(entry => ({ label: entry.title.slice(0, 100), value: entry.id, description: entry.kind === "guide" ? "Read guide" : "Command reference" })))).toJSON(),
        ] : []
    };
}
function buildInquiryModal(kind, savedName) {
    const input = new discord_js_1.TextInputBuilder().setCustomId("query").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true)
        .setLabel(kind !== "search" ? "RuneScape display name" : "Search topic or command")
        .setPlaceholder(kind !== "search" ? "GzaWizz" : "XP, boss fights, crates, bank...")
        .setMinLength(1).setMaxLength(kind !== "search" ? 12 : 100);
    if (savedName && kind !== "search")
        input.setValue(savedName);
    return new discord_js_1.ModalBuilder().setCustomId(kind === "saveName" ? exports.INQUIRY_IDS.saveNameModal : kind === "rs3" ? exports.INQUIRY_IDS.rs3Modal : exports.INQUIRY_IDS.searchModal)
        .setTitle(kind === "saveName" ? "Save Preferred RuneScape Player" : kind === "rs3" ? "RuneScape Player Search" : "Search Command Hub")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(input));
}
function hubParent(target) {
    if (target.startsWith("rs3player:"))
        return "section:profiles";
    if (target.startsWith("section:") || target === "settings" || target === "search")
        return "home";
    for (const [key, section] of Object.entries(exports.HUB_SECTIONS)) {
        if (section.items.includes(target))
            return `section:${key}`;
    }
    return "section:guides";
}
function hubNavigation(target) {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.INQUIRY_IDS.open}home`).setLabel("Home").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.INQUIRY_IDS.open}${hubParent(target)}`).setLabel("Back").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.INQUIRY_IDS.refresh}${target}`).setLabel("Refresh").setStyle(discord_js_1.ButtonStyle.Primary)
        .setDisabled(target === "search"), new discord_js_1.ButtonBuilder().setCustomId(`${exports.INQUIRY_IDS.open}settings`).setLabel("Customize").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON();
}
function withHubNavigation(payload, target) {
    const components = (payload.components || []).filter(row => !row.components.some(component => "custom_id" in component && component.custom_id === `${exports.INQUIRY_IDS.open}home`));
    if (components.length >= 5)
        throw new Error("This view has too many controls.");
    return { ...payload, components: [...components, hubNavigation(target)] };
}
function buildHubSection(key) {
    if (!Object.prototype.hasOwnProperty.call(exports.HUB_SECTIONS, key))
        throw new Error("This workspace is no longer available.");
    const section = exports.HUB_SECTIONS[key];
    return {
        embed: new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle(`FNT | ${section.title}`)
            .setDescription(section.description).setFooter({ text: "Choose an item / Home returns to your workspace" }).toJSON(),
        components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId(exports.INQUIRY_IDS.browse).setPlaceholder(`Open ${section.title.toLowerCase()}`)
                .addOptions(section.items.map(id => {
                const guide = exports.INQUIRY_GUIDES.find(entry => `guide:${entry.id}` === id);
                return { value: id, label: guide?.title || HUB_DESTINATIONS[id].label,
                    description: guide ? "Read a concise field guide" : HUB_DESTINATIONS[id].description };
            }))).toJSON()]
    };
}
function buildHubSettings(preferences) {
    const select = (key, label, options, current) => new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId(`${exports.INQUIRY_IDS.preference}${key}`).setPlaceholder(label)
        .addOptions(options.map(option => ({ ...option, default: option.value === current })))).toJSON();
    return {
        embed: new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle("FNT | Your Workspace")
            .setDescription("Personalize quick access and both tactical cards. These settings never change rewards or combat odds.")
            .addFields({ name: "RuneScape Player", value: preferences.rs3Name ? `${preferences.rs3Name} (saved, not verified)` : "No preferred player saved." })
            .setFooter({ text: "Changes apply to your account only and persist across restarts." }).toJSON(),
        components: [
            select("shortcut", "Quick access destination", ["xp", "pmc", "profile", "rs3"].map(value => ({ value, label: HUB_DESTINATIONS[value].label })), preferences.shortcut),
            select("background", "Card background", [
                { value: "automatic", label: "Automatic / Distinct XP and PMC art" },
                { value: "checkpoint", label: "Extraction Checkpoint" }, { value: "radio", label: "Night Radio Station" }
            ], preferences.background),
            select("accent", "Card accent", [{ value: "tactical", label: "Tactical / XP violet, PMC gold" }, { value: "theme", label: "Use my equipped profile theme" }], preferences.accent),
            new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.INQUIRY_IDS.saveName).setLabel("Save RuneScape Player").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.INQUIRY_IDS.open}clearName`).setLabel("Clear Saved Player").setStyle(discord_js_1.ButtonStyle.Secondary).setDisabled(!preferences.rs3Name), new discord_js_1.ButtonBuilder().setCustomId(`${exports.INQUIRY_IDS.open}profile`).setLabel("Themes & Profile").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON()
        ]
    };
}
