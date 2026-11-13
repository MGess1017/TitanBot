import { randomUUID } from "node:crypto";
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type Interaction
} from "discord.js";
import { STAFF_IDS } from "../../features/staffHub";
import { TICKET_IDS } from "../ui/ids";
import { OWNER_PANEL_CHANNEL_ID, OWNER_PANEL_USER_IDS, REPORT_LOG_CHANNEL_ID } from "../core/config";
import { appendAuditEvent } from "../core/audit";
import { requestManagedRestart } from "../core/restart";
import { buildStaffHomeFor, isStaffMember } from "../staff/staffDesk";

type RestartConfirmation = { actorId: string; guildId: string; expiresAt: number };
const confirmations = new Map<string, RestartConfirmation>();
const CONFIRMATION_MS = 60_000;

export function buildModeratorHub(isOwner: boolean) {
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("FNTCORD | Staff Workspace")
        .setDescription([
            "Private shortcuts to existing staff tools. Every destination retains its own access checks.",
            "**Cases & support:** case history, knowledge base and ticket queue.",
            "**Operations:** health check, spam alerts, bot settings and feature controls.",
            `**Reports:** <#${REPORT_LOG_CHANNEL_ID}>. **Player adjustments and owner controls:** <#${OWNER_PANEL_CHANNEL_ID}>.`,
            "**Moderation:** use the existing `/warn`, `/timeout`, `/kick`, `/ban`, `/purge` and channel-management commands; their existing administrator and quota checks still apply."
        ].join("\n"))
        .setFooter({ text: "PRIVATE / STAFF AUTHORIZATION REQUIRED / OWNER CONTROLS REMAIN RESTRICTED" });
    const buttons = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("modhub:desk").setLabel("Staff Desk").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(STAFF_IDS.caseLookup).setLabel("Case Lookup").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(TICKET_IDS.queue).setLabel("Support Queue").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(STAFF_IDS.kbSearch).setLabel("Help Articles").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(STAFF_IDS.health).setLabel("Health Check").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(STAFF_IDS.incidents).setLabel("Spam Alerts").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`${STAFF_IDS.settings}:channels`).setLabel("Bot Settings").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("modhub:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary)
        )
    ];
    if (isOwner) buttons.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("modhub:restart").setLabel("Restart Bot").setStyle(ButtonStyle.Danger)
    ));
    return { embeds: [embed], components: buttons, allowedMentions: { parse: [] as const } };
}

export async function handleModeratorHubInteraction(interaction: Interaction): Promise<boolean> {
    if (!interaction.isButton() || !interaction.customId.startsWith("modhub:")) return false;
    if (!interaction.guild || (!isStaffMember(interaction.member) && !OWNER_PANEL_USER_IDS.includes(interaction.user.id))) {
        await interaction.reply({ content: "This workspace is for authorized staff only.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const guild = interaction.guild;
    const isOwner = OWNER_PANEL_USER_IDS.includes(interaction.user.id);
    try {
        const [, action, token] = interaction.customId.split(":");
        if (action === "open") {
            await interaction.reply({ ...buildModeratorHub(isOwner), flags: MessageFlags.Ephemeral });
        } else if (action === "refresh") {
            await interaction.update(buildModeratorHub(isOwner));
        } else if (action === "desk") {
            await interaction.update({ ...buildStaffHomeFor(guild.id, interaction.channelId), allowedMentions: { parse: [] } });
        } else if (action === "restart") {
            if (!isOwner) throw new Error("Only authorized Owner Control users can restart the bot.");
            await guild.members.fetch({ user: interaction.user.id, force: true });
            if (!/^\d+$/.test(String(process.env.pm_id || "").trim())) throw new Error("Restart unavailable: this bot is not running under PM2.");
            const now = Date.now();
            for (const [id, pending] of confirmations) if (pending.expiresAt <= now) confirmations.delete(id);
            const id = randomUUID();
            confirmations.set(id, { actorId: interaction.user.id, guildId: guild.id, expiresAt: now + CONFIRMATION_MS });
            await interaction.reply({
                content: "Restart the **bot process only**? Active interactions may be interrupted. Data will be checkpointed first. Confirmation expires in 60 seconds.",
                components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`modhub:confirm:${id}`).setLabel("Confirm Bot Restart").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`modhub:cancel:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
                )], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
            });
        } else if (action === "confirm" || action === "cancel") {
            if (!isOwner) throw new Error("Only authorized Owner Control users can restart the bot.");
            const pending = confirmations.get(token);
            if (!pending || pending.actorId !== interaction.user.id || pending.guildId !== guild.id || pending.expiresAt <= Date.now()) {
                throw new Error("This confirmation expired or belongs to someone else.");
            }
            await guild.members.fetch({ user: interaction.user.id, force: true });
            confirmations.delete(token);
            if (action === "cancel") {
                await interaction.update({ content: "Bot restart canceled.", components: [] });
                return true;
            }
            appendAuditEvent("hub_bot_restart_confirmed", { guildId: guild.id, userId: interaction.user.id });
            await interaction.update({ content: "Checkpointing data and requesting a PM2 bot restart. Check PM2 logs if the bot does not return.", components: [] });
            try {
                await requestManagedRestart("moderator_hub", interaction.user.id, true);
            } catch (error) {
                console.error("[moderatorHub] Restart failed:", error);
                await interaction.followUp({
                    content: `Bot restart failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                    flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
                });
            }
        } else {
            throw new Error("This staff control is invalid. Reopen the workspace.");
        }
    } catch (error) {
        console.error("[moderatorHub]", error);
        const content = error instanceof Error ? error.message : "The staff workspace failed.";
        if (interaction.replied || interaction.deferred) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
    return true;
}
