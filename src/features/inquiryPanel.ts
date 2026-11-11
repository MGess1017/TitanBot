import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder,
    TextInputBuilder, TextInputStyle, type APIActionRowComponent, type APIComponentInMessageActionRow, type APIEmbed
} from "discord.js";
import { buildSlashCommands } from "../commands/slashCatalog";
import { scoreText } from "./staffDesk";
import { type HubPreferences } from "../game/hubPreferences";

export const INQUIRY_TITLE = "FNTCORD | Command Hub";
export const INQUIRY_LEGACY_TITLE = "FNT | Player Inquiry";
export const INQUIRY_PREVIOUS_TITLE = "FNT | Command Hub";
export const INQUIRY_IDS = {
    browse: "inquiry:browse", search: "inquiry:search", rs3: "inquiry:rs3",
    searchModal: "inquiry:search_modal", rs3Modal: "inquiry:rs3_modal", result: "inquiry:result",
    open: "inquiry:open:", back: "inquiry:back:", refresh: "inquiry:refresh:", preference: "inquiry:preference:",
    saveName: "inquiry:save_name", saveNameModal: "inquiry:save_name_modal"
};
export const HUB_SECTIONS = {
    profiles: { title: "Profiles", description: "Your identity, cards and RuneScape", items: ["xp", "pmc", "profile", "arena", "rs3"] },
    operations: { title: "Operations", description: "Raid preparation and field guides", items: ["inventory", "guide:raids", "guide:shop"] },
    economy: { title: "Economy", description: "Wallet, banking and supply directory", items: ["wallet", "guide:bank", "guide:games"] },
    guides: { title: "Guides & Support", description: "Quick answers and private assistance", items: ["guide:general", "guide:xp", "guide:rs3", "support"] }
} as const;
const HUB_DESTINATIONS: Record<string, { label: string; description: string }> = {
    xp: { label: "XP Card", description: "Level, rank and next milestone" },
    pmc: { label: "PMC Dossier", description: "Raid progression and deployment readiness" },
    profile: { label: "Personal Profile", description: "Themes, achievements and preferences" },
    arena: { label: "Arena Player Card", description: "Edit your stats, preview and refresh your rating" },
    rs3: { label: "RuneScape Profile", description: "Open your saved player or search by name" },
    inventory: { label: "Inventory", description: "Your equipment and collected supplies" },
    wallet: { label: "Wallet & Bank", description: "Your current balances" },
    support: { label: "Private Support", description: "Find the designated support panel" }
};
export type InquiryPayload = {
    embed: APIEmbed;
    components?: APIActionRowComponent<APIComponentInMessageActionRow>[];
    progressionCard?: "xp" | "pmc";
};
export const INQUIRY_GUIDES = [
    { id: "general", title: "Mission Brief", tags: ["start", "guide", "help"], body: "Build server XP by chatting and joining voice. Earn raid XP separately with your PMC.\nOpen **My Profile** for achievements and collections. Use the support panel for private assistance." },
    { id: "xp", title: "XP Ops", tags: ["level", "voice", "crate", "rank", "xp"], body: "Chat and voice build server XP. Continuous voice time unlocks the 2x bonus; disconnecting resets it.\nClaim one daily XP crate from the FN Xp Panel. **My XP Card** shows your level, rank and next crate." },
    { id: "raids", title: "Raid Ops", tags: ["pmc", "raid", "boss", "prestige"], body: "Start with a small `/raid` stake and low tension. Extraction earns loot and PMC XP; failed raids can lose the stake.\nBosses telegraph attacks: defend when threatened, heal with med patches, or extract. **My PMC Card** opens the full dossier navigation." },
    { id: "shop", title: "Supply Crates", tags: ["shop", "inventory", "gear", "repair"], body: "Use `/shop` for supplies and `/inventory` for your gear. Repair damaged equipment before raids.\nOpen your profile for cosmetic collections. Cosmetic purchases do not improve combat stats." },
    { id: "games", title: "Training Grounds", tags: ["games", "casino", "bet"], body: "Open `/casino lobby` to browse games. Check the rules and wager before playing.\nCasino wagers spend FN Token$ and can lose. Server XP and PMC progression are separate." },
    { id: "bank", title: "Bank and Trade", tags: ["tokens", "wallet", "bank", "trade", "daily"], body: "Use `/balance` for your wallet, `/bank` for banked tokens, and `/daily` for your streak reward.\nDeposit or withdraw with `/deposit` and `/withdraw`. Review item quantities before confirming a trade." },
    { id: "rs3", title: "RuneScape 3", tags: ["runescape", "jagex", "quest", "rs3", "gzawizz"], body: "Choose **RuneScape Search** and enter a display name to see Jagex's avatar, quest progress and available RuneMetrics stats.\nPrivate profiles and service outages may hide stats. Avatars are Jagex-published images, not live gameplay screenshots." }
] as const;

export type InquiryEntry = { id: string; title: string; body: string; tags: readonly string[]; kind: "guide" | "command" };

export function buildInquiryIndex(): InquiryEntry[] {
    const entries: InquiryEntry[] = INQUIRY_GUIDES.map(guide => ({ ...guide, id: `guide:${guide.id}`, kind: "guide" }));
    for (const command of buildSlashCommands({ raidConditionChoices: [], raidMapChoices: [] })) {
        const data = command.toJSON();
        if (data.default_member_permissions !== undefined && data.default_member_permissions !== null) continue;
        const subcommands = data.options?.filter(option => option.type === 1) || [];
        if (subcommands.length) {
            for (const option of subcommands) {
                entries.push({ id: `command:${data.name} ${option.name}`, title: `/${data.name} ${option.name}`, body: option.description, tags: [data.name, option.name], kind: "command" });
            }
        } else {
            entries.push({ id: `command:${data.name}`, title: `/${data.name}`, body: data.description, tags: [data.name], kind: "command" });
        }
    }
    return entries;
}

export function searchInquiry(query: string, entries: InquiryEntry[] = buildInquiryIndex()): InquiryEntry[] {
    const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error("Enter a guide topic or command name to search.");
    return entries.map(entry => ({ entry, score: scoreText(tokens, entry.title, entry.body, [...entry.tags]) }))
        .filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
        .slice(0, 6).map(hit => hit.entry);
}

export function inquiryControls(): APIActionRowComponent<APIComponentInMessageActionRow>[] {
    const browse = new StringSelectMenuBuilder().setCustomId(INQUIRY_IDS.browse).setPlaceholder("Choose your workspace").addOptions(
        Object.entries(HUB_SECTIONS).map(([key, section]) => ({ label: section.title, value: `section:${key}`, description: section.description }))
    );
    return [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(browse).toJSON(),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(INQUIRY_IDS.search).setLabel("Search Guides & Commands").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}home`).setLabel("My Dashboard").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}settings`).setLabel("Customize").setStyle(ButtonStyle.Secondary)
        ).toJSON()
    ];
}

export function buildInquiryHome(): InquiryPayload {
    return {
        embed: new EmbedBuilder().setColor(0x9b59b6).setTitle(INQUIRY_TITLE)
            .setDescription("**Your server. Your workspace.**\nProfiles, operations, economy and answers in one place.\nChoose a workspace below. Everything opens privately.")
            .setFooter({ text: "FNTCORD / COMMAND HUB / PRIVATE WORKSPACES" })
            .toJSON(),
        components: inquiryControls()
    };
}

export function buildHubDashboard(data: { xpLevel: number; pmcLevel: number; next: string; arenaProgress: string; rs3Name: string | null; shortcut: string }): InquiryPayload {
    const home = buildInquiryHome();
    return {
        embed: new EmbedBuilder().setColor(0x9b59b6).setTitle("FNTCORD | My Dashboard")
            .setDescription("Your private command center. Choose a workspace or jump to your favorite.")
            .addFields(
                { name: "Progression", value: `Server level **${data.xpLevel}** / PMC level **${data.pmcLevel}**\n${data.next}` },
                { name: "Player Card", value: data.arenaProgress, inline: true },
                { name: "Linked Games", value: data.rs3Name ? `RuneScape: **${data.rs3Name}**\nSaved name / ownership not verified` : "No RuneScape player saved.", inline: true }
            ).setFooter({ text: "FNTCORD / PRIVATE / BOT-TRACKED PROGRESS" }).toJSON(),
        components: [
            home.components![0],
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}shortcut`).setLabel(`Open ${HUB_DESTINATIONS[data.shortcut]?.label || "XP Card"}`).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(INQUIRY_IDS.search).setLabel("Search").setStyle(ButtonStyle.Secondary)
            ).toJSON()
        ]
    };
}

export function buildInquiryEntry(entry: InquiryEntry): InquiryPayload {
    return {
        embed: new EmbedBuilder().setColor(0x9b59b6).setTitle(entry.title).setDescription(entry.body).toJSON(),
        components: []
    };
}

export function buildInquirySearch(query: string): InquiryPayload {
    const results = searchInquiry(query);
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("Inquiry Search")
        .setDescription(results.length
            ? results.map((entry, index) => `**${index + 1}. ${entry.title}**\n${entry.body.split("\n")[0].slice(0, 160)}`).join("\n\n")
            : "No matching guides or commands. Try XP, PMC, crates, bank or RuneScape.");
    return {
        embed: embed.toJSON(),
        components: results.length ? [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder().setCustomId(INQUIRY_IDS.result).setPlaceholder("Open a result")
                    .addOptions(results.map(entry => ({ label: entry.title.slice(0, 100), value: entry.id, description: entry.kind === "guide" ? "Read guide" : "Command reference" })))
            ).toJSON(),
        ] : []
    };
}

export function buildInquiryModal(kind: "search" | "rs3" | "saveName", savedName?: string | null): ModalBuilder {
    const input = new TextInputBuilder().setCustomId("query").setStyle(TextInputStyle.Short).setRequired(true)
        .setLabel(kind !== "search" ? "RuneScape display name" : "Search topic or command")
        .setPlaceholder(kind !== "search" ? "GzaWizz" : "XP, boss fights, crates, bank...")
        .setMinLength(1).setMaxLength(kind !== "search" ? 12 : 100);
    if (savedName && kind !== "search") input.setValue(savedName);
    return new ModalBuilder().setCustomId(kind === "saveName" ? INQUIRY_IDS.saveNameModal : kind === "rs3" ? INQUIRY_IDS.rs3Modal : INQUIRY_IDS.searchModal)
        .setTitle(kind === "saveName" ? "Save Preferred RuneScape Player" : kind === "rs3" ? "RuneScape Player Search" : "Search Command Hub")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function hubParent(target: string): string {
    if (target === "home") return "home";
    if (target.startsWith("settings:")) return "settings";
    if (target.startsWith("preview:")) return "settings:appearance";
    if (target === "themes") return "settings:appearance";
    if (target.endsWith(":details")) return target.slice(0, -":details".length);
    if (target.startsWith("rs3player:")) return "section:profiles";
    if (target.startsWith("section:") || target === "settings" || target === "search") return "home";
    for (const [key, section] of Object.entries(HUB_SECTIONS)) {
        if ((section.items as readonly string[]).includes(target)) return `section:${key}`;
    }
    return "section:guides";
}

export function hubNavigation(target: string): APIActionRowComponent<APIComponentInMessageActionRow> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}home`).setLabel("Home").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${INQUIRY_IDS.back}${hubParent(target)}`).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${INQUIRY_IDS.refresh}${target}`).setLabel("Refresh").setStyle(ButtonStyle.Primary)
            .setDisabled(target === "search"),
        new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}settings`).setLabel("Customize").setStyle(ButtonStyle.Secondary)
    ).toJSON();
}

export function withHubNavigation(payload: InquiryPayload, target: string): InquiryPayload {
    const components = (payload.components || []).filter(row => !row.components.some(component =>
        "custom_id" in component && component.custom_id === `${INQUIRY_IDS.open}home`));
    if (components.length >= 5) throw new Error("This view has too many controls.");
    return { ...payload, components: [...components, hubNavigation(target)] };
}

export function buildHubSection(key: string): InquiryPayload {
    if (!Object.prototype.hasOwnProperty.call(HUB_SECTIONS, key)) throw new Error("This workspace is no longer available.");
    const section = HUB_SECTIONS[key as keyof typeof HUB_SECTIONS];
    return {
        embed: new EmbedBuilder().setColor(0x9b59b6).setTitle(`FNTCORD | ${section.title}`)
            .setDescription(section.description).setFooter({ text: "Choose an item / Home returns to your workspace" }).toJSON(),
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(INQUIRY_IDS.browse).setPlaceholder(`Open ${section.title.toLowerCase()}`)
                .addOptions(section.items.map(id => {
                    const guide = INQUIRY_GUIDES.find(entry => `guide:${entry.id}` === id);
                    return { value: id, label: guide?.title || HUB_DESTINATIONS[id].label,
                        description: guide ? "Read a concise field guide" : HUB_DESTINATIONS[id].description };
                }))
        ).toJSON()]
    };
}

export function buildHubSettings(preferences: HubPreferences, category = "", options = { doubleXpDm: true, showCheckpointRating: true }): InquiryPayload {
    const select = (key: string, label: string, options: Array<{ value: string; label: string }>, current: string) =>
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(`${INQUIRY_IDS.preference}${key}`).setPlaceholder(label)
                .addOptions(options.map(option => ({ ...option, default: option.value === current })))
        ).toJSON();
    const categories = { appearance: "Appearance", privacy: "Privacy", notifications: "Notifications", games: "Linked Games" };
    if (category && !Object.prototype.hasOwnProperty.call(categories, category)) throw new Error("Unknown settings category. Reopen Customize.");
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(`FNTCORD | ${categories[category as keyof typeof categories] || "Customize"}`)
        .setDescription("Your account only. Changes persist across restarts and never affect rewards or combat odds.")
        .setFooter({ text: "FNTCORD / PERSONAL SETTINGS" });
    let components: NonNullable<InquiryPayload["components"]>;
    if (category === "appearance") {
        embed.setDescription("Card Studio: choose art, use your owned equipped theme, and select visible highlights. Previews are private.");
        components = [
            select("background", "Card background", [
                { value: "automatic", label: "Automatic / Distinct XP and PMC art" },
                { value: "checkpoint", label: "Extraction Checkpoint" }, { value: "radio", label: "Night Radio Station" }
            ], preferences.background),
            select("accent", "Card accent", [{ value: "tactical", label: "Tactical / XP violet, PMC gold" }, { value: "theme", label: "Use my equipped profile theme" }], preferences.accent),
            select("highlights", "Visible card highlights", [
                { value: "all", label: "All three highlights" }, { value: "primary", label: "Primary highlight only" }, { value: "none", label: "Progress only" }
            ], preferences.highlights),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}preview:xp`).setLabel("Preview XP").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}preview:pmc`).setLabel("Preview PMC").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}themes`).setLabel("Owned Themes").setStyle(ButtonStyle.Secondary)
            ).toJSON()
        ];
    } else if (category === "privacy") {
        embed.setDescription("Private cards: future XP, PMC and profile command replies are private; your public Arena card is removed. Existing command messages and leaderboards are not erased.");
        components = [
            select("cardVisibility", "Card visibility", [{ value: "public", label: "Public / Share cards" }, { value: "private", label: "Private / Only me" }], preferences.cardVisibility),
            select("showCheckpointRating", "Arena rating in profile", [{ value: "true", label: "Show Arena rating" }, { value: "false", label: "Hide Arena rating" }], String(options.showCheckpointRating))
        ];
    } else if (category === "notifications") {
        embed.setDescription("Choose whether the bot sends you a DM when your continuous voice session unlocks double XP.");
        components = [select("doubleXpDm", "Double XP notifications", [{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }], String(options.doubleXpDm))];
    } else if (category === "games") {
        embed.addFields({ name: "RuneScape Player", value: preferences.rs3Name ? `${preferences.rs3Name} (saved, not verified)` : "No preferred player saved." });
        components = [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(INQUIRY_IDS.saveName).setLabel("Save RuneScape Player").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`${INQUIRY_IDS.open}clearName`).setLabel("Clear Saved Player").setStyle(ButtonStyle.Secondary).setDisabled(!preferences.rs3Name)
            ).toJSON()
        ];
    } else {
        components = [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder().setCustomId(INQUIRY_IDS.browse).setPlaceholder("Settings category")
                    .addOptions(Object.entries(categories).map(([key, label]) => ({ value: `settings:${key}`, label })))
            ).toJSON(),
            select("shortcut", "Dashboard favorite", ["xp", "pmc", "profile", "rs3"].map(value => ({ value, label: HUB_DESTINATIONS[value].label })), preferences.shortcut)
        ];
    }
    return { embed: embed.toJSON(), components };
}
