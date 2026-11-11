"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureInquiryPanelForGuild = ensureInquiryPanelForGuild;
exports.handleInquiryInteraction = handleInquiryInteraction;
const discord_js_1 = require("discord.js");
const inquiryPanel_1 = require("../../features/inquiryPanel");
const runescapeProfile_1 = require("../../features/runescapeProfile");
const hubPreferences_1 = require("../../game/hubPreferences");
const utils_1 = require("../../utils");
const payloads_1 = require("../../game/payloads");
const config_1 = require("../core/config");
const rateLimit_1 = require("../../runtime/rateLimit");
const store_1 = require("../moderation/store");
const cards_1 = require("../profile/cards");
const profile_1 = require("../profile/profile");
const views_1 = require("../raid/views");
const checkpointCard_1 = require("../../features/checkpointCard");
const playerCards_1 = require("./playerCards");
const checkpointRating_1 = require("../../game/checkpointRating");
const settings_1 = require("../core/settings");
const hubPreferenceSaves = new Set();
async function ensureInquiryPanelForGuild(guild) {
    const channel = guild.channels.cache.get(config_1.PLAYER_COUNT_CHANNEL_ID) || await guild.channels.fetch(config_1.PLAYER_COUNT_CHANNEL_ID);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        console.warn(`[inquiry] Channel ${config_1.PLAYER_COUNT_CHANNEL_ID} is missing or is not a text channel in guild ${guild.id}.`);
        return;
    }
    const { embed, components } = (0, inquiryPanel_1.buildInquiryHome)();
    const payload = { embeds: [embed], components, allowedMentions: { parse: [] } };
    const storedId = (0, store_1.getGuildPanelMessageId)(guild.id, "inquiry");
    if (storedId) {
        const stored = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof discord_js_1.DiscordAPIError && error.code === 10008)
                return null;
            throw error;
        });
        if (stored && stored.author.id === guild.client.user.id
            && [inquiryPanel_1.INQUIRY_TITLE, inquiryPanel_1.INQUIRY_LEGACY_TITLE, inquiryPanel_1.INQUIRY_PREVIOUS_TITLE].includes(stored.embeds[0]?.title || "")) {
            await stored.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id
        && [inquiryPanel_1.INQUIRY_TITLE, inquiryPanel_1.INQUIRY_LEGACY_TITLE, inquiryPanel_1.INQUIRY_PREVIOUS_TITLE].includes(message.embeds[0]?.title || ""));
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    (0, store_1.setGuildPanelMessageId)(guild.id, "inquiry", message.id);
}
async function handleInquiryInteraction(interaction) {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
        || !(Object.values(inquiryPanel_1.INQUIRY_IDS).includes(interaction.customId)
            || [inquiryPanel_1.INQUIRY_IDS.open, inquiryPanel_1.INQUIRY_IDS.back, inquiryPanel_1.INQUIRY_IDS.refresh, inquiryPanel_1.INQUIRY_IDS.preference].some(prefix => interaction.customId.startsWith(prefix))))
        return false;
    const throttleError = (0, rateLimit_1.rejectIfRateLimited)(`${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.customId}`, config_1.COMMAND_RATE_LIMIT_WINDOW_MS);
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    try {
        const state = (0, utils_1.ensureUser)(interaction.user.id);
        let preferences = (0, hubPreferences_1.normalizeHubPreferences)(state.preferences.hub);
        let target = interaction.isStringSelectMenu() ? interaction.values[0] : "home";
        if (interaction.customId.startsWith(inquiryPanel_1.INQUIRY_IDS.open))
            target = interaction.customId.slice(inquiryPanel_1.INQUIRY_IDS.open.length);
        if (interaction.customId.startsWith(inquiryPanel_1.INQUIRY_IDS.back))
            target = interaction.customId.slice(inquiryPanel_1.INQUIRY_IDS.back.length);
        if (interaction.customId.startsWith(inquiryPanel_1.INQUIRY_IDS.refresh))
            target = interaction.customId.slice(inquiryPanel_1.INQUIRY_IDS.refresh.length);
        target = target.replace(/^command:(xp|pmc|profile|rs3)$/, "$1");
        if (target === "shortcut")
            target = preferences.shortcut;
        if (!interaction.isModalSubmit() && (interaction.customId === inquiryPanel_1.INQUIRY_IDS.search || interaction.customId === inquiryPanel_1.INQUIRY_IDS.rs3
            || interaction.customId === inquiryPanel_1.INQUIRY_IDS.saveName || (target === "rs3" && !preferences.rs3Name))) {
            const kind = interaction.customId === inquiryPanel_1.INQUIRY_IDS.search ? "search"
                : interaction.customId === inquiryPanel_1.INQUIRY_IDS.saveName ? "saveName" : "rs3";
            await interaction.showModal((0, inquiryPanel_1.buildInquiryModal)(kind, preferences.rs3Name));
            return true;
        }
        if ((!interaction.isModalSubmit() || interaction.isFromMessage()) && interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral)) {
            await interaction.deferUpdate();
        }
        else {
            await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        }
        let payload;
        let notice = "";
        let settingsCategory = "";
        if (interaction.isModalSubmit()) {
            const query = interaction.fields.getTextInputValue("query");
            if (interaction.customId === inquiryPanel_1.INQUIRY_IDS.saveNameModal) {
                target = "settings:games";
            }
            else {
                target = interaction.customId === inquiryPanel_1.INQUIRY_IDS.rs3Modal ? `rs3player:${(0, runescapeProfile_1.normalizeRs3Name)(query)}` : "search";
            }
        }
        const savingPreference = interaction.customId.startsWith(inquiryPanel_1.INQUIRY_IDS.preference)
            || interaction.customId === inquiryPanel_1.INQUIRY_IDS.saveNameModal || target === "clearName";
        if (savingPreference) {
            if (hubPreferenceSaves.has(interaction.user.id))
                throw new Error("Your settings are still being saved. Please try again shortly.");
            hubPreferenceSaves.add(interaction.user.id);
            try {
                preferences = (0, hubPreferences_1.normalizeHubPreferences)(state.preferences.hub);
                const previousPreferences = { ...state.preferences };
                if (interaction.isStringSelectMenu()) {
                    const key = interaction.customId.slice(inquiryPanel_1.INQUIRY_IDS.preference.length);
                    const value = interaction.values[0];
                    if (key === "shortcut" && ["xp", "pmc", "profile", "rs3"].includes(value)) {
                        preferences.shortcut = value;
                    }
                    else if (key === "background" && ["automatic", "checkpoint", "radio"].includes(value)) {
                        preferences.background = value;
                    }
                    else if (key === "accent" && ["tactical", "theme"].includes(value)) {
                        preferences.accent = value;
                    }
                    else if (key === "highlights" && ["all", "primary", "none"].includes(value)) {
                        preferences.highlights = value;
                    }
                    else if (key === "cardVisibility" && ["public", "private"].includes(value)) {
                        preferences.cardVisibility = value;
                    }
                    else if ((key === "doubleXpDm" || key === "showCheckpointRating") && ["true", "false"].includes(value)) {
                        state.preferences[key] = value === "true";
                    }
                    else
                        throw new Error("This preference is invalid. Reopen Customize.");
                    settingsCategory = ["background", "accent", "highlights"].includes(key) ? "appearance"
                        : ["cardVisibility", "showCheckpointRating"].includes(key) ? "privacy"
                            : key === "doubleXpDm" ? "notifications" : "";
                }
                if (target === "clearName")
                    preferences.rs3Name = null;
                if (interaction.isModalSubmit() && interaction.customId === inquiryPanel_1.INQUIRY_IDS.saveNameModal) {
                    preferences.rs3Name = (0, runescapeProfile_1.normalizeRs3Name)(interaction.fields.getTextInputValue("query"));
                }
                if (interaction.customId === inquiryPanel_1.INQUIRY_IDS.saveNameModal || target === "clearName")
                    settingsCategory = "games";
                state.preferences.hub = preferences;
                try {
                    if (preferences.cardVisibility === "private")
                        await (0, playerCards_1.removeCheckpointPublicCard)(interaction.user.id);
                    (0, utils_1.savePoints)();
                }
                catch (error) {
                    state.preferences = previousPreferences;
                    throw error;
                }
                target = settingsCategory ? `settings:${settingsCategory}` : "settings";
                notice = "Your preferences have been saved.";
            }
            finally {
                hubPreferenceSaves.delete(interaction.user.id);
            }
        }
        if (target === "settings" || target.startsWith("settings:")) {
            payload = (0, inquiryPanel_1.buildHubSettings)(preferences, target.slice("settings:".length), state.preferences);
        }
        else if (target === "home") {
            payload = (0, cards_1.buildDashboardPayload)(interaction.user, interaction.guild);
        }
        else if (target === "arena" || target === "arena:details") {
            if (!(0, settings_1.isFeatureEnabled)("checkpointCards"))
                throw new Error("Player rating cards are paused by staff right now.");
            payload = (0, checkpointCard_1.buildCheckpointWorkspace)(state.checkpointProfile, preferences.cardVisibility);
            if (target === "arena:details" && state.checkpointProfile && (0, checkpointRating_1.isCheckpointComplete)(state.checkpointProfile.stats)) {
                payload.embed = (0, checkpointCard_1.buildCheckpointBreakdownEmbed)(state.checkpointProfile.stats, (0, playerCards_1.getCheckpointCardUrl)(state.checkpointProfile, interaction.guildId), state.checkpointProfile.updatedAt).toJSON();
            }
        }
        else if (target.startsWith("section:")) {
            payload = (0, inquiryPanel_1.buildHubSection)(target.slice("section:".length));
        }
        else if (target === "xp:details") {
            payload = (0, profile_1.buildProfilePayload)(interaction.user, "progression", interaction.user.id, interaction.guild);
        }
        else if (target === "pmc:details") {
            payload = JSON.parse((0, views_1.buildPmcProfilePayload)(interaction.user, "details"));
        }
        else if (target === "profile") {
            payload = (0, profile_1.buildProfilePayload)(interaction.user, "overview", interaction.user.id, interaction.guild);
        }
        else if (target === "themes") {
            payload = (0, profile_1.buildThemeStudioPayload)(interaction.user.id);
        }
        else if (target === "xp" || target === "pmc" || target === "preview:xp" || target === "preview:pmc") {
            const kind = target.endsWith("xp") ? "xp" : "pmc";
            payload = JSON.parse(kind === "xp"
                ? (0, cards_1.buildXpProfilePayload)(interaction.user, interaction.guild)
                : (0, views_1.buildPmcProfilePayload)(interaction.user));
            if (target.startsWith("preview:"))
                notice = "Private preview using your saved appearance. Select Owned Themes to equip a different owned accent.";
        }
        else if (target === "rs3" || target.startsWith("rs3player:")) {
            const name = target.startsWith("rs3player:") ? target.slice("rs3player:".length) : preferences.rs3Name;
            if (!name)
                throw new Error("Save a preferred player in Customize or use RuneScape Search.");
            payload = { embed: (0, runescapeProfile_1.buildRs3ProfileEmbed)(await (0, runescapeProfile_1.fetchRs3Profile)(name)).toJSON(), components: [
                    new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(inquiryPanel_1.INQUIRY_IDS.rs3).setLabel("Search Another Player").setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId(inquiryPanel_1.INQUIRY_IDS.saveName).setLabel("Save Preferred Player").setStyle(discord_js_1.ButtonStyle.Secondary)).toJSON()
                ] };
            target = `rs3player:${(0, runescapeProfile_1.normalizeRs3Name)(name)}`;
        }
        else if (target === "search" && interaction.isModalSubmit()) {
            payload = (0, inquiryPanel_1.buildInquirySearch)(interaction.fields.getTextInputValue("query"));
        }
        else if (target === "inventory") {
            payload = JSON.parse((0, payloads_1.buildInventoryPayload)({
                inventory: state.inventory, wallet: state.fnTokens, gearDurability: state.gearDurability, insuredGear: state.insuredGear
            }));
        }
        else if (target === "wallet") {
            payload = { embed: new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle("FNTCORD | Wallet & Bank").addFields({ name: "Wallet", value: `${state.fnTokens.toLocaleString()} FN Token$`, inline: true }, { name: "Bank", value: `${state.bankTokens.toLocaleString()} FN Token$`, inline: true }).setFooter({ text: "Use /deposit or /withdraw to move tokens." }).toJSON() };
        }
        else if (target === "support") {
            payload = { embed: new discord_js_1.EmbedBuilder().setColor(0x9b59b6).setTitle("FNTCORD | Private Support")
                    .setDescription(`Open a private request using the support panel in <#${config_1.PERMANENT_TICKET_PANEL_CHANNEL_ID}>.\nInclude a short summary and any relevant screenshots. Do not share passwords or tokens.`).toJSON() };
        }
        else {
            const entry = (0, inquiryPanel_1.buildInquiryIndex)().find(item => item.id === target);
            if (!entry)
                throw new Error("This result is no longer available. Search again from the inquiry panel.");
            payload = (0, inquiryPanel_1.buildInquiryEntry)(entry);
        }
        payload = (0, inquiryPanel_1.withHubNavigation)(payload, target);
        await interaction.editReply({
            content: notice,
            embeds: [payload.embed],
            components: payload.components || [],
            attachments: [],
            files: payload.progressionCard ? [await (0, cards_1.progressionCardAttachment)(payload.progressionCard, interaction.user, interaction.guild)] : [],
            allowedMentions: { parse: [] }
        });
    }
    catch (error) {
        console.error("[inquiry] Interaction failed:", error);
        const content = `Inquiry failed: ${error instanceof Error ? error.message : "Please try again."}`.slice(0, 1800);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content, embeds: [], components: (0, inquiryPanel_1.inquiryControls)(), attachments: [], allowedMentions: { parse: [] } });
        }
        else {
            await interaction.reply({ content, flags: discord_js_1.MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
    }
    return true;
}
