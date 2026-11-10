import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, DiscordAPIError, EmbedBuilder, MessageFlags, type Guild, type Interaction } from "discord.js";
import {
    buildInquiryEntry, buildInquiryHome, buildInquiryIndex, buildInquiryModal, buildInquirySearch,
    buildHubSection, buildHubSettings, withHubNavigation, INQUIRY_IDS, INQUIRY_TITLE, INQUIRY_LEGACY_TITLE,
    inquiryControls, type InquiryPayload
} from "../../features/inquiryPanel";
import { buildRs3ProfileEmbed, fetchRs3Profile, normalizeRs3Name } from "../../features/runescapeProfile";
import { normalizeHubPreferences } from "../../game/hubPreferences";
import { ensureUser, savePoints } from "../../utils";
import { buildInventoryPayload } from "../../game/payloads";
import { COMMAND_RATE_LIMIT_WINDOW_MS, PERMANENT_TICKET_PANEL_CHANNEL_ID, PLAYER_COUNT_CHANNEL_ID } from "../core/config";
import { rejectIfRateLimited } from "../../runtime/rateLimit";
import { getGuildPanelMessageId, setGuildPanelMessageId } from "../moderation/store";
import { buildXpProfilePayload, progressionCardAttachment } from "../profile/cards";
import { buildProfilePayload } from "../profile/profile";
import { buildPmcProfilePayload } from "../raid/views";

export async function ensureInquiryPanelForGuild(guild: Guild): Promise<void> {
    const channel = guild.channels.cache.get(PLAYER_COUNT_CHANNEL_ID) || await guild.channels.fetch(PLAYER_COUNT_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`[inquiry] Channel ${PLAYER_COUNT_CHANNEL_ID} is missing or is not a text channel in guild ${guild.id}.`);
        return;
    }
    const { embed, components } = buildInquiryHome();
    const payload = { embeds: [embed], components, allowedMentions: { parse: [] as const } };
    const storedId = getGuildPanelMessageId(guild.id, "inquiry");
    if (storedId) {
        const stored = await channel.messages.fetch(storedId).catch(error => {
            if (error instanceof DiscordAPIError && error.code === 10008) return null;
            throw error;
        });
        if (stored && stored.author.id === guild.client.user.id
            && [INQUIRY_TITLE, INQUIRY_LEGACY_TITLE].includes(stored.embeds[0]?.title || "")) {
            await stored.edit(payload);
            return;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => message.author.id === guild.client.user.id
        && [INQUIRY_TITLE, INQUIRY_LEGACY_TITLE].includes(message.embeds[0]?.title || ""));
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    setGuildPanelMessageId(guild.id, "inquiry", message.id);
}

export async function handleInquiryInteraction(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
        || !(Object.values(INQUIRY_IDS).includes(interaction.customId)
            || [INQUIRY_IDS.open, INQUIRY_IDS.refresh, INQUIRY_IDS.preference].some(prefix => interaction.customId.startsWith(prefix)))) return false;
    const throttleError = rejectIfRateLimited(
        `${interaction.guildId || "dm"}:${interaction.user.id}:${interaction.customId}`,
        COMMAND_RATE_LIMIT_WINDOW_MS
    );
    if (throttleError) {
        await interaction.reply({ content: throttleError, flags: MessageFlags.Ephemeral });
        return true;
    }
    try {
        const state = ensureUser(interaction.user.id);
        const preferences = normalizeHubPreferences(state.preferences.hub);
        let target = interaction.isStringSelectMenu() ? interaction.values[0] : "home";
        if (interaction.customId.startsWith(INQUIRY_IDS.open)) target = interaction.customId.slice(INQUIRY_IDS.open.length);
        if (interaction.customId.startsWith(INQUIRY_IDS.refresh)) target = interaction.customId.slice(INQUIRY_IDS.refresh.length);
        target = target.replace(/^command:(xp|pmc|profile|rs3)$/, "$1");
        if (target === "shortcut") target = preferences.shortcut;
        if (!interaction.isModalSubmit() && (
            interaction.customId === INQUIRY_IDS.search || interaction.customId === INQUIRY_IDS.rs3
            || interaction.customId === INQUIRY_IDS.saveName || (target === "rs3" && !preferences.rs3Name))) {
            const kind = interaction.customId === INQUIRY_IDS.search ? "search"
                : interaction.customId === INQUIRY_IDS.saveName ? "saveName" : "rs3";
            await interaction.showModal(buildInquiryModal(kind, preferences.rs3Name));
            return true;
        }
        if (!interaction.isModalSubmit() && interaction.message.flags.has(MessageFlags.Ephemeral)) {
            await interaction.deferUpdate();
        } else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
        let payload: InquiryPayload;
        let notice = "";
        if (interaction.isModalSubmit()) {
            const query = interaction.fields.getTextInputValue("query");
            if (interaction.customId === INQUIRY_IDS.saveNameModal) {
                preferences.rs3Name = normalizeRs3Name(query);
                target = "settings";
            } else {
                target = interaction.customId === INQUIRY_IDS.rs3Modal ? `rs3player:${normalizeRs3Name(query)}` : "search";
            }
        }
        const savingPreference = interaction.customId.startsWith(INQUIRY_IDS.preference)
            || interaction.customId === INQUIRY_IDS.saveNameModal || target === "clearName";
        if (savingPreference) {
            if (interaction.isStringSelectMenu()) {
                const key = interaction.customId.slice(INQUIRY_IDS.preference.length);
                const value = interaction.values[0];
                if (key === "shortcut" && ["xp", "pmc", "profile", "rs3"].includes(value)) {
                    preferences.shortcut = value as typeof preferences.shortcut;
                } else if (key === "background" && ["automatic", "checkpoint", "radio"].includes(value)) {
                    preferences.background = value as typeof preferences.background;
                } else if (key === "accent" && ["tactical", "theme"].includes(value)) {
                    preferences.accent = value as typeof preferences.accent;
                } else throw new Error("This preference is invalid. Reopen Customize.");
            }
            if (target === "clearName") preferences.rs3Name = null;
            const previous = state.preferences.hub;
            state.preferences.hub = preferences;
            try {
                savePoints();
            } catch (error) {
                state.preferences.hub = previous;
                throw error;
            }
            target = "settings";
            notice = "Your preferences have been saved.";
        }
        if (target === "settings") {
            payload = buildHubSettings(preferences);
        } else if (target === "home") {
            payload = buildInquiryHome();
        } else if (target.startsWith("section:")) {
            payload = buildHubSection(target.slice("section:".length));
        } else if (target === "profile") {
            payload = buildProfilePayload(interaction.user, "overview", interaction.user.id, interaction.guild);
        } else if (target === "xp" || target === "pmc") {
            payload = JSON.parse(target === "xp"
                ? buildXpProfilePayload(interaction.user, interaction.guild)
                : buildPmcProfilePayload(interaction.user));
        } else if (target === "rs3" || target.startsWith("rs3player:")) {
            const name = target.startsWith("rs3player:") ? target.slice("rs3player:".length) : preferences.rs3Name;
            if (!name) throw new Error("Save a preferred player in Customize or use RuneScape Search.");
            payload = { embed: buildRs3ProfileEmbed(await fetchRs3Profile(name)).toJSON(), components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(INQUIRY_IDS.rs3).setLabel("Search Another Player").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(INQUIRY_IDS.saveName).setLabel("Save Preferred Player").setStyle(ButtonStyle.Secondary)
                ).toJSON()
            ] };
            target = `rs3player:${normalizeRs3Name(name)}`;
        } else if (target === "search" && interaction.isModalSubmit()) {
            payload = buildInquirySearch(interaction.fields.getTextInputValue("query"));
        } else if (target === "inventory") {
            payload = JSON.parse(buildInventoryPayload({
                inventory: state.inventory, wallet: state.fnTokens, gearDurability: state.gearDurability, insuredGear: state.insuredGear
            }));
        } else if (target === "wallet") {
            payload = { embed: new EmbedBuilder().setColor(0x9b59b6).setTitle("FNT | Wallet & Bank").addFields(
                { name: "Wallet", value: `${state.fnTokens.toLocaleString()} FN Token$`, inline: true },
                { name: "Bank", value: `${state.bankTokens.toLocaleString()} FN Token$`, inline: true }
            ).setFooter({ text: "Use /deposit or /withdraw to move tokens." }).toJSON() };
        } else if (target === "support") {
            payload = { embed: new EmbedBuilder().setColor(0x9b59b6).setTitle("FNT | Private Support")
                .setDescription(`Open a private request using the support panel in <#${PERMANENT_TICKET_PANEL_CHANNEL_ID}>.\nInclude a short summary and any relevant screenshots. Do not share passwords or tokens.`).toJSON() };
        } else {
            const entry = buildInquiryIndex().find(item => item.id === target);
            if (!entry) throw new Error("This result is no longer available. Search again from the inquiry panel.");
            payload = buildInquiryEntry(entry);
        }
        if (target !== "home") payload = withHubNavigation(payload, target);
        await interaction.editReply({
            content: notice,
            embeds: [payload.embed],
            components: payload.components || [],
            attachments: [],
            files: payload.progressionCard ? [await progressionCardAttachment(payload.progressionCard, interaction.user, interaction.guild)] : [],
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[inquiry] Interaction failed:", error);
        const content = `Inquiry failed: ${error instanceof Error ? error.message : "Please try again."}`.slice(0, 1800);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content, embeds: [], components: inquiryControls(), attachments: [], allowedMentions: { parse: [] } });
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
    }
    return true;
}
