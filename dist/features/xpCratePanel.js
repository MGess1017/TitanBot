"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XP_CRATE_PANEL_TITLE = exports.XP_CRATE_BUTTON_ID = void 0;
exports.xpCrateAttachment = xpCrateAttachment;
exports.buildXpCratePanel = buildXpCratePanel;
exports.buildXpCrateRewardEmbed = buildXpCrateRewardEmbed;
exports.addXpCrateProfile = addXpCrateProfile;
exports.upsertXpCratePanel = upsertXpCratePanel;
const node_path_1 = __importDefault(require("node:path"));
const discord_js_1 = require("discord.js");
const xpCrates_1 = require("../game/xpCrates");
exports.XP_CRATE_BUTTON_ID = "fn_xp_crate:claim";
exports.XP_CRATE_PANEL_TITLE = "FN Xp Panel";
function xpCrateAttachment(id) {
    return new discord_js_1.AttachmentBuilder(node_path_1.default.resolve(__dirname, `../../assets/xp-crates/${id}.png`), { name: `${id}.png` });
}
function buildXpCratePanel() {
    return {
        embeds: [new discord_js_1.EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle(exports.XP_CRATE_PANEL_TITLE)
                .setDescription("Claim 1 random XP crate every 24 hours. Opens instantly and appears in `/xp`.\n"
                + "10 colored crates: 0-100,000 XP. Super-rare Astral crate: **1,000,000 XP**.")
                .setFooter({ text: "100K: 0.01% per regular crate | Astral: 0.001% per claim" })],
        components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(exports.XP_CRATE_BUTTON_ID).setLabel("Claim Daily XP Crate").setStyle(discord_js_1.ButtonStyle.Primary))],
        allowedMentions: { parse: [] }
    };
}
function buildXpCrateRewardEmbed(reward) {
    const crate = (0, xpCrates_1.getXpCrateDefinition)(reward.crateId);
    return new discord_js_1.EmbedBuilder()
        .setColor(crate.color)
        .setTitle(crate.name)
        .setDescription(`Opened instantly: **+${reward.xp.toLocaleString("en-US")} XP**\nYour reward is saved in \`/xp\`.`)
        .setImage(`attachment://${crate.id}.png`)
        .addFields({
        name: "Next crate",
        value: `<t:${Math.floor((reward.claimedAt + xpCrates_1.XP_CRATE_COOLDOWN_MS) / 1000)}:R>`
    });
}
function addXpCrateProfile(embed, reward, now = Date.now()) {
    if (!reward) {
        return embed.addFields({ name: "Daily XP Crate", value: "No crate claimed yet. Use the button in the FN Xp Panel.", inline: false });
    }
    const crate = (0, xpCrates_1.getXpCrateDefinition)(reward.crateId);
    const nextClaimAt = reward.claimedAt + xpCrates_1.XP_CRATE_COOLDOWN_MS;
    return embed
        .setImage(`attachment://${crate.id}.png`)
        .addFields({
        name: `Latest XP Crate: ${crate.name}`,
        value: `Reward: **+${reward.xp.toLocaleString("en-US")} XP** (already credited)\n`
            + `Claimed: <t:${Math.floor(reward.claimedAt / 1000)}:f>\n`
            + (now >= nextClaimAt ? "**Your next daily crate is ready!**" : `Next claim: <t:${Math.floor(nextClaimAt / 1000)}:R>`),
        inline: false
    });
}
function isCratePanel(message, botId) {
    return message.author.id === botId && message.embeds[0]?.title === exports.XP_CRATE_PANEL_TITLE;
}
async function upsertXpCratePanel(channel, botId, storedId) {
    const payload = buildXpCratePanel();
    if (storedId) {
        try {
            const message = await channel.messages.fetch(storedId);
            if (isCratePanel(message, botId)) {
                await message.edit(payload);
                return message.id;
            }
        }
        catch (error) {
            if (!(error instanceof discord_js_1.DiscordAPIError && error.code === 10008))
                throw error;
        }
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const existing = recent.find(message => isCratePanel(message, botId));
    if (existing) {
        await existing.edit(payload);
        return existing.id;
    }
    return (await channel.send(payload)).id;
}
