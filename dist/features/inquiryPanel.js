"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INQUIRY_GUIDES = exports.INQUIRY_IDS = exports.INQUIRY_TITLE = void 0;
exports.buildInquiryIndex = buildInquiryIndex;
exports.searchInquiry = searchInquiry;
exports.inquiryControls = inquiryControls;
exports.buildInquiryHome = buildInquiryHome;
exports.buildInquiryEntry = buildInquiryEntry;
exports.buildInquirySearch = buildInquirySearch;
exports.buildInquiryModal = buildInquiryModal;
const discord_js_1 = require("discord.js");
const slashCatalog_1 = require("../commands/slashCatalog");
const staffDesk_1 = require("./staffDesk");
exports.INQUIRY_TITLE = "FNT | Player Inquiry";
exports.INQUIRY_IDS = {
    browse: "inquiry:browse", search: "inquiry:search", rs3: "inquiry:rs3",
    searchModal: "inquiry:search_modal", rs3Modal: "inquiry:rs3_modal", result: "inquiry:result"
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
    const browse = new discord_js_1.StringSelectMenuBuilder().setCustomId(exports.INQUIRY_IDS.browse).setPlaceholder("Choose a guide or personal card").addOptions({ label: "My XP Card", value: "xp", description: "Level, rank and voice bonus" }, { label: "My PMC Card", value: "pmc", description: "Raid character and dossier" }, { label: "My Profile", value: "profile", description: "Achievements, collections and preferences" }, ...exports.INQUIRY_GUIDES.map(guide => ({ label: guide.title, value: `guide:${guide.id}`, description: guide.body.split(".")[0].slice(0, 100) })));
    return [
        new discord_js_1.ActionRowBuilder().addComponents(browse).toJSON(),
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.INQUIRY_IDS.search).setLabel("Search Guides & Commands").setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(exports.INQUIRY_IDS.rs3).setLabel("RuneScape Search").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON()
    ];
}
function buildInquiryHome() {
    return {
        embed: new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle(exports.INQUIRY_TITLE)
            .setDescription("Search guides and commands, view your progress, or look up a RuneScape player.\nChoose a topic below. Your results open privately.")
            .toJSON(),
        components: inquiryControls()
    };
}
function buildInquiryEntry(entry) {
    return {
        embed: new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle(entry.title).setDescription(entry.body).toJSON(),
        components: inquiryControls()
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
            ...inquiryControls()
        ] : inquiryControls()
    };
}
function buildInquiryModal(kind) {
    const input = new discord_js_1.TextInputBuilder().setCustomId("query").setStyle(discord_js_1.TextInputStyle.Short).setRequired(true)
        .setLabel(kind === "rs3" ? "RuneScape display name" : "Search topic or command")
        .setPlaceholder(kind === "rs3" ? "GzaWizz" : "XP, boss fights, crates, bank...")
        .setMinLength(1).setMaxLength(kind === "rs3" ? 12 : 100);
    return new discord_js_1.ModalBuilder().setCustomId(kind === "rs3" ? exports.INQUIRY_IDS.rs3Modal : exports.INQUIRY_IDS.searchModal)
        .setTitle(kind === "rs3" ? "RuneScape Player Search" : "Search Player Inquiry")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(input));
}
