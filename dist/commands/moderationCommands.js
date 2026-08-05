"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildModerationCommandHandlers = buildModerationCommandHandlers;
const discord_js_1 = require("discord.js");
function buildModerationCommandHandlers(deps) {
    return {
        setmodlog: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const channel = interaction.options.getChannel("channel", true);
            if (channel.type !== 0) {
                return "Channel must be a text channel.";
            }
            const state = deps.ensureGuildModeration(interaction.guildId);
            state.modLogChannelId = channel.id;
            deps.saveModerationStore();
            return `✅ Moderation log channel set to <#${channel.id}>.`;
        },
        setlockdown: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const channel = interaction.options.getChannel("channel", true);
            if (channel.type !== 0) {
                return "Channel must be a text channel.";
            }
            const state = deps.ensureGuildModeration(interaction.guildId);
            state.lockdownChannelId = channel.id;
            deps.saveModerationStore();
            return `✅ Lockdown channel set to <#${channel.id}>. Non-admin messages there will trigger an instant ban.`;
        },
        lockdownnotice: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const state = deps.ensureGuildModeration(interaction.guildId);
            if (!state.lockdownChannelId) {
                return "No lockdown channel is configured yet. Run /setlockdown first.";
            }
            const guild = interaction.guild;
            if (!guild)
                return "This command can only be used in a server.";
            const channel = guild.channels.cache.get(state.lockdownChannelId) || await guild.channels.fetch(state.lockdownChannelId).catch(() => null);
            if (!channel || channel.type !== 0 || !("send" in channel)) {
                return "The configured lockdown channel could not be found or is not a text channel.";
            }
            const embed = new discord_js_1.EmbedBuilder()
                .setColor(0xb91c1c)
                .setTitle("⛔ LOCKDOWN CHANNEL - READ BEFORE TYPING")
                .setDescription([
                "**THIS CHANNEL IS A PROTECTED ANTI-SPAM LOCKDOWN CHANNEL.**",
                "It exists **purely** to stop bot spam, invite spam, mass spam, and raid flooding.",
                "**IF YOU TYPE ANYTHING HERE AND YOU ARE NOT AN ADMIN, THE BOT WILL DELETE THE MESSAGE AND INSTANTLY BAN YOU.**",
                "Do not test it. Do not post a single character. Do not send a link, emoji, letter, number, or reply.",
                "Administrators are the only exempt users. Everyone else stays out."
            ].join("\n\n"))
                .addFields({ name: "🚫 WHAT HAPPENS IF YOU TYPE HERE", value: "Your message is deleted and your account is banned immediately.", inline: false }, { name: "🛡️ WHY THIS EXISTS", value: "To stop bot spam, invite spam, and mass-raiding activity before it spreads.", inline: false }, { name: "👮 WHO MAY SPEAK", value: "Administrators only.", inline: false })
                .setFooter({ text: "Protected anti-spam channel • Admins only • Zero tolerance for non-admin messages" })
                .setTimestamp(new Date());
            await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
            return `🚨 Lockdown warning posted in <#${channel.id}>.`;
        },
        modconfig: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const state = deps.ensureGuildModeration(interaction.guildId);
            const totalWarnings = Object.values(state.warnings).reduce((sum, list) => sum + list.length, 0);
            return [
                "🛡️ Moderation Config",
                `📍 Mod log: ${state.modLogChannelId ? `<#${state.modLogChannelId}>` : "not set"}`,
                `🚫 Lockdown channel: ${state.lockdownChannelId ? `<#${state.lockdownChannelId}>` : "not set"}`,
                `📚 Active warning records: ${totalWarnings}`
            ].join("\n");
        },
        warn: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const guild = interaction.guild;
            if (!guild)
                return "This command can only be used in a server.";
            const target = interaction.options.getUser("user", true);
            const reason = interaction.options.getString("reason", true);
            const warnDedupeError = deps.rejectIfDuplicateCommand(interaction, `warn:user:${target.id}:reason:${reason}`);
            if (warnDedupeError)
                return warnDedupeError;
            const state = deps.ensureGuildModeration(guild.id);
            const caseId = state.nextCaseId++;
            const warning = {
                caseId,
                moderatorId: interaction.user.id,
                reason: reason || "No reason provided",
                timestamp: Date.now()
            };
            if (!state.warnings[target.id])
                state.warnings[target.id] = [];
            state.warnings[target.id].push(warning);
            const warningCount = state.warnings[target.id].length;
            deps.saveModerationStore();
            let escalation = "None";
            const member = await guild.members.fetch(target.id).catch(() => null);
            if (member && warningCount >= 5) {
                await member.timeout(24 * 60 * 60 * 1000, "Auto escalation: 5 warnings").catch(() => undefined);
                escalation = "24h timeout";
            }
            else if (member && warningCount >= 3) {
                await member.timeout(60 * 60 * 1000, "Auto escalation: 3 warnings").catch(() => undefined);
                escalation = "1h timeout";
            }
            await deps.sendModLog(guild.id, `Warning Case #${caseId}`, [
                { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Target", value: `<@${target.id}>`, inline: true },
                { name: "Warning Count", value: `${warningCount}`, inline: true },
                { name: "Escalation", value: escalation, inline: true },
                { name: "Reason", value: warning.reason }
            ]);
            return `⚠️ Warned ${target.username}. Case #${caseId}. Total warnings: ${warningCount}. Escalation: ${escalation}.`;
        },
        warnings: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const target = interaction.options.getUser("user", true);
            const state = deps.ensureGuildModeration(interaction.guildId);
            const list = (state.warnings[target.id] || []).slice(-10).reverse();
            if (!list.length)
                return `✅ ${target.username} has no warnings.`;
            const lines = list.map(w => `Case #${w.caseId} | ${new Date(w.timestamp).toLocaleString()} | Mod <@${w.moderatorId}> | ${w.reason}`);
            return `📋 ${target.username} warnings:\n${lines.join("\n")}`;
        },
        clearwarnings: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const target = interaction.options.getUser("user", true);
            const clearWarnDedupeError = deps.rejectIfDuplicateCommand(interaction, `clearwarnings:user:${target.id}`);
            if (clearWarnDedupeError)
                return clearWarnDedupeError;
            const state = deps.ensureGuildModeration(interaction.guildId);
            const removed = (state.warnings[target.id] || []).length;
            delete state.warnings[target.id];
            deps.saveModerationStore();
            await deps.sendModLog(interaction.guildId, "Warnings Cleared", [
                { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Target", value: `<@${target.id}>`, inline: true },
                { name: "Removed", value: `${removed}`, inline: true }
            ]);
            return `🧹 Cleared ${removed} warning(s) for ${target.username}.`;
        },
        tempban: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const guild = interaction.guild;
            if (!guild)
                return "This command can only be used in a server.";
            const target = interaction.options.getUser("user", true);
            const durationRaw = interaction.options.getString("duration", true);
            const reason = interaction.options.getString("reason") || "No reason provided";
            const tempbanDedupeError = deps.rejectIfDuplicateCommand(interaction, `tempban:user:${target.id}:duration:${durationRaw}:reason:${reason}`);
            if (tempbanDedupeError)
                return tempbanDedupeError;
            const durationMs = deps.parseDurationMs(durationRaw);
            if (!durationMs)
                return "Invalid duration. Use values like 30m, 6h, or 2d.";
            const member = await guild.members.fetch(target.id).catch(() => null);
            if (!member)
                return "Unable to find that member in this server.";
            await member.ban({ reason: `Tempban: ${reason}` });
            setTimeout(() => {
                void guild.members.unban(target.id, "Tempban expired").catch(() => undefined);
            }, durationMs);
            await deps.sendModLog(guild.id, "Tempban", [
                { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Target", value: `<@${target.id}>`, inline: true },
                { name: "Duration", value: durationRaw, inline: true },
                { name: "Reason", value: reason }
            ]);
            return `⛔ ${target.username} has been temp-banned for ${durationRaw}.`;
        },
        purge: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const amount = interaction.options.getInteger("amount", true);
            const targetUser = interaction.options.getUser("user");
            const purgeDedupeError = deps.rejectIfDuplicateCommand(interaction, `purge:channel:${interaction.channelId}:amount:${amount}:target:${targetUser?.id || "all"}`);
            if (purgeDedupeError)
                return purgeDedupeError;
            if (amount < 2 || amount > 100)
                return "Amount must be between 2 and 100.";
            if (!interaction.channel || !interaction.channel.isTextBased())
                return "This command requires a text channel.";
            if (!("bulkDelete" in interaction.channel))
                return "This channel does not support bulk delete.";
            const fetched = await interaction.channel.messages.fetch({ limit: 100 });
            const candidates = targetUser
                ? Array.from(fetched.values()).filter(m => m.author.id === targetUser.id).slice(0, amount)
                : Array.from(fetched.values()).slice(0, amount);
            if (!candidates.length)
                return "No matching messages found.";
            const deleted = await interaction.channel.bulkDelete(candidates, true).catch(() => null);
            const deletedCount = deleted ? deleted.size : 0;
            await deps.sendModLog(interaction.guildId, "Purge", [
                { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Deleted", value: `${deletedCount}`, inline: true },
                { name: "Filter", value: targetUser ? `Only <@${targetUser.id}>` : "No filter", inline: true }
            ]);
            return `🧽 Deleted ${deletedCount} message(s).`;
        },
        announce: async (interaction) => {
            const adminError = deps.requireAdministrator(interaction);
            if (adminError)
                return adminError;
            const title = interaction.options.getString("title", true).slice(0, 256);
            const description = interaction.options.getString("description", true).slice(0, 4096);
            const colorRaw = (interaction.options.getString("color") || "").trim();
            const footer = (interaction.options.getString("footer") || "").trim();
            const imageUrl = (interaction.options.getString("image_url") || "").trim();
            const selectedChannel = interaction.options.getChannel("channel");
            const dedupeError = deps.rejectIfDuplicateCommand(interaction, `announce:${selectedChannel?.id || interaction.channelId}:title:${title}:desc:${description}:color:${colorRaw}:footer:${footer}:image:${imageUrl}`);
            if (dedupeError)
                return dedupeError;
            const normalizedColor = colorRaw.replace(/^#/, "");
            if (normalizedColor && !/^[0-9a-fA-F]{6}$/.test(normalizedColor)) {
                return "Invalid color. Use a 6-digit hex value like #22c55e.";
            }
            if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
                return "Invalid image URL. Use an http or https URL.";
            }
            const targetChannel = selectedChannel || interaction.channel;
            if (!targetChannel || !("send" in targetChannel)) {
                return "Target channel must be a text channel where the bot can send messages.";
            }
            const embed = new discord_js_1.EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(normalizedColor ? Number.parseInt(normalizedColor, 16) : 0x22c55e)
                .setTimestamp(new Date())
                .setAuthor({ name: interaction.user.username, iconURL: deps.getAvatar(interaction.user) });
            if (footer) {
                embed.setFooter({ text: footer.slice(0, 2048) });
            }
            else {
                embed.setFooter({ text: "Titan Ops Announcement • Live broadcast" });
            }
            if (imageUrl)
                embed.setImage(imageUrl);
            await targetChannel.send({ embeds: [embed] }).catch(() => undefined);
            return `📣 Announcement sent to <#${targetChannel.id}>.`;
        }
    };
}
