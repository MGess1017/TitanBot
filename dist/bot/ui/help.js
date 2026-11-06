"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveXpRoleLines = resolveXpRoleLines;
exports.buildThemedRoleSections = buildThemedRoleSections;
exports.helpDropdown = helpDropdown;
exports.buildGettingStartedEmbed = buildGettingStartedEmbed;
exports.buildHelpPayload = buildHelpPayload;
exports.getAvatar = getAvatar;
// The /help pages and XP role listings.
const discord_js_1 = require("discord.js");
const utils_1 = require("../../utils");
const config_1 = require("../core/config");
const settings_1 = require("../core/settings");
const roles_1 = require("../xp/roles");
const ids_1 = require("./ids");
async function resolveXpRoleLines(guild) {
    if (!guild) {
        return roles_1.XP_ROLE_TIERS.map(entry => `${entry.xp.toLocaleString()} XP -> ${entry.name}`);
    }
    await guild.roles.fetch().catch(() => undefined);
    const persisted = (0, roles_1.getPersistedXpRoleMap)();
    const lines = [];
    for (const entry of roles_1.XP_ROLE_TIERS) {
        const persistedEntry = persisted.get(entry.xp);
        const roleById = persistedEntry
            ? await guild.roles.fetch(persistedEntry.roleId).catch(() => null)
            : await guild.roles.fetch(entry.roleId).catch(() => null);
        const roleName = (0, roles_1.formatXpTierDisplayName)({ xp: entry.xp, roleId: entry.roleId, name: entry.name });
        const roleByName = guild.roles.cache.find(r => r.name === roleName) || null;
        const role = roleById || roleByName;
        if (role) {
            lines.push(`${entry.xp.toLocaleString()} XP -> <@&${role.id}>`);
        }
        else {
            lines.push(`${entry.xp.toLocaleString()} XP -> ${entry.name} (not created yet)`);
        }
    }
    return lines;
}
function chunkRoleLines(lines, maxLen = 1000) {
    const chunks = [];
    let current = "";
    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > maxLen && current) {
            chunks.push(current);
            current = line;
        }
        else {
            current = next;
        }
    }
    if (current)
        chunks.push(current);
    return chunks;
}
function buildThemedRoleSections(lines) {
    const sectionNames = [
        "Comms Cadet (Role Tiers 1-5)",
        "Pathfinder Wing (Role Tiers 6-10)",
        "Strike Division (Role Tiers 11-15)",
        "Warden Command (Role Tiers 16-20)",
        "Elite Vanguard (Role Tiers 21-25)"
    ];
    const sections = [];
    for (let i = 0; i * 5 < lines.length; i++) {
        const start = i * 5;
        const group = lines.slice(start, start + 5);
        if (!group.length)
            continue;
        const name = sectionNames[i] || `Ascendant Command (Role Tiers ${start + 1}-${start + group.length})`;
        sections.push({ name, value: group.join("\n") });
    }
    return sections;
}
function helpDropdown(selected = "general") {
    return [
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(ids_1.HELP_IDS.menu)
            .setPlaceholder("Select a tactical drop box")
            .addOptions({ label: "Mission Brief", value: ids_1.HELP_IDS.general, description: "Main command overview", emoji: "🪖", default: selected === "general" }, { label: "XP Ops", value: ids_1.HELP_IDS.xp, description: "XP, levels, and progression", emoji: "🎖️", default: selected === "xp" }, { label: "Raid Ops", value: ids_1.HELP_IDS.raids, description: "Raids and risk settings", emoji: "⚔️", default: selected === "raids" }, { label: "Supply Crates", value: ids_1.HELP_IDS.shop, description: "Shop, items, and inventory", emoji: "📦", default: selected === "shop" }, { label: "Training Grounds", value: ids_1.HELP_IDS.games, description: "Games and betting", emoji: "🎯", default: selected === "games" }, { label: "Bank and Trade", value: ids_1.HELP_IDS.bank, description: "Token banking and item exchange", emoji: "🏦", default: selected === "bank" }, { label: "Moderation Desk", value: ids_1.HELP_IDS.moderation, description: "Moderation and admin safeguards", emoji: "🛡️", default: selected === "moderation" }))
    ];
}
function buildGettingStartedEmbed() {
    return new discord_js_1.EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("Your First 10 Minutes")
        .setDescription([
        "• **Meet your character:** `/profile` shows your progress; `/pmc` shows your raid character.",
        "• **Start free:** `/daily` claims FN Token$ without placing a bet.",
        `• **Try a small raid:** use \`/raid bet:${config_1.MIN_RAID_BET} tension:low\` and choose **FN Plagued Cemetery** in the map option. Extraction earns loot, tokens, and PMC XP. Failed raids can lose your stake.`,
        "• **Check your loot:** `/inventory` shows what you collected.",
        "• **Build server XP:** chat or join voice, then check `/xp`. Server XP and PMC raid XP are separate.",
        "• **Need a hand?** `/help` lists commands; `/ticket` opens private support."
    ].join("\n"));
}
function helpPageGeneral() {
    return new discord_js_1.EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🪖 Titan Tactical Help")
        .setDescription("Use the tactical drop box below to jump into command categories, quick workflows, and support tools.")
        .addFields({
        name: "🧭 Core Utility",
        value: "• `/help` — open command directory\n\n• **Get Started** on the Welcome to FNT panel — first steps\n\n• `/ping` — bot latency check\n\n• `/status` — runtime identity\n\n• `/findbots` — list bot accounts in this server\n\n• `/balance` — your wallet tokens\n\n• `/token` — token balance for selected user\n\n• `/ticket` — open support ticket"
    }, {
        name: "📈 Progress and Economy",
        value: "• `/xp` — engagement XP panel\n\n• `/profile` — progression, achievements, collections, activity, cosmetics\n\n• `/xproles` — themed rank role directory\n\n• `/xprolesync` — admin force-sync all XP roles\n\n• `/pmc` — persistent raid profile\n\n• `/leaderboard` — top XP players\n\n• `/daily` — streak reward claim"
    }, {
        name: "🗂️ Directory Topics",
        value: "⚔️ Raid Ops\n📦 Supply Crates\n🎯 Training Grounds\n🏦 Bank and Trade\n🛡️ Moderation Desk"
    })
        .setFooter({ text: "Use Get Started on the Welcome to FNT panel for first steps, or /ticket for private support." });
}
async function helpPageXP(guild) {
    const rankLines = await resolveXpRoleLines(guild);
    const rankChunks = chunkRoleLines(rankLines, 900);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🎖️ XP Operations")
        .setDescription("Chat XP is earned by eligible messages and drives rank progression.")
        .addFields({
        name: "Command Summary",
        value: "• `/xp` — compact level and progress bar\n\n• `/profile` — unified profile with progression, collections, and the FNT cosmetic shop\n\n• `/xproles` — view 5 themed role sections\n\n• `/xprolesync` — admin force-sync rank roles now\n\n• `/leaderboard` — server-wide engagement XP ranking\n\n• `/daily` — claim streak bonus"
    }, {
        name: "🪖 Progression Rules",
        value: `• Each eligible non-bot message grants ${(0, settings_1.getMessageXpGain)().toLocaleString()} engagement XP.\n\n• XP role progression ends at 50,000,000 XP.\n\n• Voice time and achievements are tracked in /profile.\n\n• Raid XP is tracked separately in your PMC profile.`
    });
    if (!rankChunks.length) {
        embed.addFields({ name: "🎖️ Rank Unlock Directory", value: "No rank directory entries available." });
        return embed;
    }
    embed.addFields({ name: "🎖️ Rank Unlock Directory", value: rankChunks[0] });
    for (let i = 1; i < rankChunks.length; i++) {
        embed.addFields({ name: `🎖️ Rank Unlock Directory (${i + 1})`, value: rankChunks[i] });
    }
    return embed;
}
function helpPageRaids() {
    return new discord_js_1.EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("⚔️ Raid Operations")
        .setDescription("Raids award persistent PMC Raid XP, tokens, and map-based loot with condition triggers plus boss encounters.")
        .addFields({ name: "📦 Risk Drop Box", value: "• **Low** — safer extract profile\n\n• **Medium** — balanced risk/reward\n\n• **High** — volatile, higher payout potential" }, {
        name: "🗺️ Raid Maps",
        value: "• **FN Plagued Cemetery**\n  Beginner map, higher extraction odds, low-mid loot.\n\n• **FN Slaughterhouse**\n  Mid map, harder extracts, better loot spread, 10% boss spawn.\n\n• **FN BoogersWoodZ**\n  Hard map, premium loot tables, harder boss pressure.\n\n• **FN MegaYachtolopolis**\n  Elite map with luxury-tech loot, claustrophobic kill lanes, and vicious apex pressure.\n\n• **FN Warlords Warcamp**\n  Brutal trench map with war salvage jackpots and relentless open-field punishment.\n\n• **FN SUNKEN VILLAGE**\n  Cataclysmic flooded map loaded with varied crate drops and drowned-boss ambushes."
    }, {
        name: "🪖 Mission Commands",
        value: `• \`/raid bet:<amount> tension:<low|medium|high> map:<map_name> weapon:<optional> armor:<optional>\`\n\n• \`/raidhistory\` — recent results (map + boss outcomes)\n\n• \`/bosses\` — full boss roster, stats, and rotation weights\n\n• \`/conditions\` — every raid condition, deltas, and armor counters\n\n• \`/gearintel\` — raid gear stat and trait directory\n\n• \`/pmc\` — milestone PMC progression (up to Level ${utils_1.PMC_LEVEL_CAP})\n\n• \`/loadout\` — best auto-applied weapon/armor bonuses\n\n• \`/raidintel map:<map_name> weapon:<optional> armor:<optional>\``
    }, { name: "🛡️ Trigger Buffs and Debuffs", value: "• Conditions: `storm`, `fog`, `night`, `heatwave`, `urban`, `radiation`, `drizzle`, `crosswind`, `low_power`, `ashfall`\n\n• Best owned weapon/armor auto-apply with condition-specific modifiers and loss mitigation.\n\n• Some armor pieces now fully negate their matching raid condition." }, { name: "👑 Boss Mechanics", value: "• Maps pull from boss variants or apex signatures with unique names and ferocity.\n\n• Boss pressure scales with map, tension, and PMC progression.\n\n• Defeating bosses grants map-tuned gear drops, bonus Raid XP, extra token rewards, and permanent heart trophies." }, { name: "📈 PMC Progression", value: `• PMC XP is separate from chat XP.\n\n• Legacy tiers unlock through Level 20,000, followed by mastery tiers every 5,000 levels up to ${utils_1.PMC_LEVEL_CAP.toLocaleString()}.\n\n• At Level 20,000, choose optional Prestige I-X for permanent raid bonuses or continue overleveling.` }, { name: "🧭 Mid-Raid Decisions", value: "• Tactical forks can alter extraction odds, token multipliers, and loot rolls.\n\n• Mythic route artifacts reveal rare map-specific exits. They only drop from successful raids, cannot be purchased, and are retained after use.\n\n• Boss contacts play through a live dual-health combat display before final results." }, { name: "⏱️ Operation Rules", value: `Cooldown: 5s | Minimum bet: ${config_1.MIN_RAID_BET} FN Token$ | Raid XP saved to persistent PMC profile` });
}
function helpPageShop() {
    return new discord_js_1.EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("📦 Supply and Inventory")
        .setDescription("Buy, sell, store, and open loot crates.")
        .addFields({ name: "Command Summary", value: "• `/shop` — list purchasable items\n\n• `/inventory` — show owned items and quantities\n\n• `/buy` — purchase item by id and quantity\n\n• `/sell` — sell owned items for tokens\n\n• `/opencrate` — consume crate and roll loot\n\n• `/useitem` — use consumables for instant effects" }, { name: "Loot Notes", value: "• Raid loot now includes broader resources, consumables, elite crates, and boss-specific drops.\n\n• Best owned loadout auto-applies in raids.\n\n• Inventory and token changes are persisted." });
}
function helpPageGames() {
    return new discord_js_1.EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🪖 War Games Command")
        .setDescription("High-risk tactical casino simulations powered by FN Token$ from raids and live operations rewards.")
        .addFields({ name: "Battle Deck", value: "• `/casino dice` — precision or parity strike\n\n• `/casino roulette` — sector and color control\n\n• `/casino blackjack` — safe or aggressive command style\n\n• `/casino crash` — multiplier extraction window\n\n• `/casino slots` — Magic Slots: enchanted reels, jackpot arcs, and bonus magic rounds\n\n• `/casino coinflip` — rapid binary call\n\n• `/casino baccarat` — player / banker / tie wagers\n\n• `/casino hilo` — threat escalation call\n\n• `/casino keno` — tactical number board" }, { name: "Interactive Casino", value: "• `/casino lobby bet:<amount>` opens the full game floor.\n\n• Choose a game with one click, then replay, double, halve, or switch from every result." }, { name: "Fair Return Profile", value: "• Standard games target roughly 95% long-run return.\n\n• Standard-game wins have a disclosed 6% boost chance that never reduces payouts.\n\n• Magic Slots is calibrated near 94% with measured scatter and ultra-mode chances." }, { name: "Round Results", value: "• Every result shows bet, payout, net change, wallet, round details, risk, odds, bonus result, and player record.\n\n• WIN=green, LOSS=red, PUSH=yellow." });
}
function helpPageBank() {
    return new discord_js_1.EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🏦 Banking and Trading Directory")
        .setDescription("Organized FN Token$ banking and direct player-to-player trading.")
        .addFields({ name: "📦 Banking Commands", value: "• `/bank` — wallet + bank overview\n\n• `/deposit` — move wallet tokens into bank\n\n• `/withdraw` — move bank tokens to wallet\n\n• `/transfer` — wallet-to-wallet token send" }, { name: "🧾 Trade Commands", value: "• `/tradeoffer` — create item-for-item offer\n\n• `/trades` — list incoming/outgoing open trades\n\n• `/tradeaccept` — complete an incoming offer\n\n• `/tradedecline` — reject/cancel a trade" }, { name: "🛡️ Trade Rules", value: "• Only inventory items can be traded.\n\n• Both inventories are revalidated at accept time." }, { name: "📈 Banking Notes", value: "• Bank stores FN Token$ separately from wallet.\n\n• Raid and casino bets consume wallet tokens." });
}
function helpPageModeration() {
    return new discord_js_1.EmbedBuilder()
        .setColor(0x00ffea)
        .setTitle("🛡️ Moderation and Admin Directory")
        .setDescription("Community safety overview. Sensitive admin command details are intentionally hidden from public help.")
        .addFields({
        name: "Community Safety Flow",
        value: "• Staff can issue warnings and escalations for abuse/spam.\n\n• Repeated violations may trigger timeout, removal, or bans.\n\n• Enforcement actions are logged for audit and accountability."
    }, {
        name: "Support Workflow",
        value: "• Tickets are handled through claim, assignment, workflow updates, archive, reopen, and permanent resolution stages.\n\n• SLA monitoring and audit logs are active for support operations quality.\n\n• Staff use `/staff` for case history, resolution checklists, the knowledge base, settings, and health checks."
    }, {
        name: "Automatic Protection",
        value: "• Repeated spam and mention abuse alert staff instantly. New members are always welcome — joins are never flagged.\n\n• Any timeout applied from an alert can be undone from the same alert."
    }, {
        name: "Admin Command Visibility",
        value: "Sensitive admin and diagnostics commands are intentionally not listed in public help."
    });
}
async function buildHelpPayload(page = "general", guild) {
    const embed = page === "xp" ? await helpPageXP(guild) :
        page === "raids" ? helpPageRaids() :
            page === "shop" ? helpPageShop() :
                page === "bank" ? helpPageBank() :
                    page === "moderation" ? helpPageModeration() :
                        page === "games" ? helpPageGames() :
                            helpPageGeneral();
    return { embed: embed.toJSON(), withHelpNav: true, helpPage: page };
}
function getAvatar(user) {
    return user.displayAvatarURL({ extension: "png", size: 256 });
}
