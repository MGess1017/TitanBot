// Command theming and embed builders.
import { APIEmbed, EmbedBuilder, User } from "discord.js";
import { slashCommandUsage } from "../../commands/slashCatalog";
import { ARMY_ICON_URL } from "../core/config";
import { getAvatar } from "./help";

type CommandTheme = {
    color: number;
    icon: string;
    label: string;
};

const RAID_COMMAND_SET = new Set(["raid", "raidintel", "raidhistory", "bosses", "conditions", "gearintel", "loadout", "pmc"]);
const GAME_COMMAND_SET = new Set(["dice", "roulette", "blackjack", "crash", "magicslots", "coinflip", "baccarat", "hilo", "keno"]);

function resolveCommandTheme(commandName: string): CommandTheme {
    const cmd = commandName.toLowerCase();

    const raidCommands = new Set(["raid", "raidintel", "raidhistory", "bosses", "conditions", "gearintel", "loadout", "pmc"]);
    const xpCommands = new Set(["xp", "profile", "xproles", "xprolesync", "leaderboard", "daily", "xpverify"]);
    const economyCommands = new Set(["balance", "token", "bank", "deposit", "withdraw", "transfer", "shop", "inventory", "buy", "sell", "opencrate", "useitem", "tradeoffer", "trades", "tradeaccept", "tradedecline"]);
    const gameCommands = new Set(["dice", "roulette", "blackjack", "crash", "magicslots", "coinflip", "baccarat", "hilo", "keno"]);
    const moderationCommands = new Set(["warn", "warnings", "clearwarnings", "tempban", "purge", "points", "pointsuser", "addpoints", "addtoken", "timeout", "kick", "ban", "setmodlog", "modconfig", "xprolesync", "health", "rolesanity", "ticketsanity", "xpverify", "incident"]);
    const ticketCommands = new Set([
        "ticket",
        "ticketintake",
        "ticketforce",
        "ticketpanel",
        "claimticket",
        "ticketassign",
        "ticketstatus",
        "reopenticket",
        "closeticket",
        "resolveticket",
        "ticketconfig",
        "tickets",
        "ticketanalytics",
        "ticketworkload",
        "ticketnote",
        "tickettimeline",
        "ticketmerge",
        "ticketlink",
        "ticketexport",
        "ticketretention"
    ]);

    if (cmd === "pmc") return { color: 0x0b1f3a, icon: "🪖", label: "PMC Profile" };
    if (raidCommands.has(cmd)) return { color: 0xd97706, icon: "⚔️", label: "Raid Ops" };
    if (xpCommands.has(cmd)) return { color: 0x0ea5e9, icon: "🎖️", label: "Progression" };
    if (economyCommands.has(cmd)) return { color: 0x059669, icon: "💰", label: "Economy" };
    if (gameCommands.has(cmd)) return { color: 0xdc2626, icon: "🎯", label: "Games" };
    if (moderationCommands.has(cmd)) return { color: 0x1f2937, icon: "🛡️", label: "Moderation" };
    if (ticketCommands.has(cmd)) return { color: 0x0f766e, icon: "🎫", label: "Support" };
    if (cmd === "help" || cmd === "quickstart") return { color: 0x06b6d4, icon: "🪖", label: "Command Center" };
    return { color: 0x3b82f6, icon: "🪖", label: "Operations" };
}

function resolveOutcomeSignal(text: string): "success" | "failure" | "push" | "neutral" {
    const upper = text.toUpperCase();
    if (/\b(PUSH|DRAW|TIE)\b/.test(upper)) return "push";
    if (/\b(FAILURE|FAILED|LOSS|LOST|DEFEAT|BUST|ELIMINATED|OPERATION FAILED)\b/.test(upper)) return "failure";
    if (/\b(SUCCESS|WIN|WON|VICTORY|EXTRACTED|DEFEATED|OPERATION EXTRACTED)\b/.test(upper)) return "success";
    return "neutral";
}

function resolveOutcomeColor(commandName: string, text: string): number | null {
    const cmd = commandName.toLowerCase();
    const upper = text.toUpperCase();

    // /pmc includes neutral terms like "Loss Mitigation" that should not drive red/green outcome coloring.
    if (cmd === "pmc") return null;

    // Hard guarantee for /raid responses even if wording/format changes.
    if (cmd === "raid") {
        if (/MISSION\s*COMPLETE\s*:\s*SUCCESS/.test(upper) || /OPERATION\s+EXTRACTED/.test(upper)) return 0x22c55e;
        if (/MISSION\s*COMPLETE\s*:\s*FAILURE/.test(upper) || /OPERATION\s+FAILED/.test(upper)) return 0xef4444;
    }

    if (!RAID_COMMAND_SET.has(cmd) && !GAME_COMMAND_SET.has(cmd)) return null;

    const signal = resolveOutcomeSignal(text);
    if (signal === "success") return 0x22c55e;
    if (signal === "failure") return 0xef4444;
    if (signal === "push") return 0xf59e0b;
    return null;
}

function beautifyCommandText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return "No data available.";

    const lines = trimmed.split("\n").map(line => line.trimEnd());
    const beautified = lines.map(line => {
        if (!line) return line;
        if (line.startsWith("* ")) return `• ${line.slice(2)}`;
        if (line.startsWith("- ")) return `• ${line.slice(2)}`;

        const headingOnly = line.match(/^([A-Za-z0-9\s#()/%+\-]{2,40}):$/);
        if (headingOnly) {
            const heading = headingOnly[1].trim();
            return `__${heading}__`;
        }

        const keyValue = line.match(/^([A-Za-z0-9\s#()/%+\-]{2,40}):\s+(.+)$/);
        if (keyValue) {
            const key = keyValue[1].trim();
            const value = keyValue[2].trim();
            return `**${key}:** ${value}`;
        }

        return line;
    });

    return beautified.join("\n");
}

export function chunkLines(lines: string[], limit = 1000): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > limit && current) {
            chunks.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

export function clampText(text: string, limit: number): string {
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

export function sanitizeEmbedBuilder(embed: EmbedBuilder): EmbedBuilder {
    const raw = embed.toJSON();
    const fields = (raw.fields || []).slice(0, 25).map(field => ({
        name: clampText(field.name || "Field", 256),
        value: clampText(field.value || "-", 1024),
        inline: field.inline
    }));

    const safe = new EmbedBuilder();
    if (raw.title) safe.setTitle(clampText(raw.title, 256));
    if (raw.description) safe.setDescription(clampText(raw.description, 4096));
    if (raw.color !== undefined) safe.setColor(raw.color);
    if (raw.author) safe.setAuthor({
        name: clampText(raw.author.name || "", 256),
        iconURL: raw.author.icon_url,
        url: raw.author.url
    });
    if (raw.thumbnail?.url) safe.setThumbnail(raw.thumbnail.url);
    if (raw.image?.url) safe.setImage(raw.image.url);
    if (raw.footer?.text) safe.setFooter({ text: clampText(raw.footer.text, 2048), iconURL: raw.footer.icon_url });
    if (raw.timestamp) safe.setTimestamp(new Date(raw.timestamp));
    if (fields.length) safe.addFields(fields);
    return safe;
}

function brandEmbedForUser(embed: EmbedBuilder, user: User, commandLabel: string): EmbedBuilder {
    return sanitizeEmbedBuilder(embed
        .setColor(embed.data.color ?? 0x4ca7ff)
    .setAuthor({ name: `${user.username} • ${commandLabel}`, iconURL: getAvatar(user) })
    .setThumbnail(embed.data.thumbnail?.url || ARMY_ICON_URL)
    .setFooter({ text: `Titan Premium Command Suite • Requested by ${user.tag}` })
        .setTimestamp(new Date()));
}

export function brandLiveEmbed(embed: EmbedBuilder, scopeLabel: string, footerLabel?: string): EmbedBuilder {
    const existingFooter = embed.data.footer?.text?.trim() || "";
    const footerText = [footerLabel || "Titan Ops Live Feed", existingFooter]
        .filter(Boolean)
        .join(" • ");

    const branded = embed
        .setColor(embed.data.color ?? 0x14b8a6)
        .setAuthor({
            name: scopeLabel,
            iconURL: ARMY_ICON_URL
        })
        .setFooter({ text: footerText.slice(0, 2048) });

    if (!embed.data.timestamp) {
        branded.setTimestamp(new Date());
    }

    return sanitizeEmbedBuilder(branded);
}

export function embedFromText(commandName: string, text: string, user: User): APIEmbed {
    const theme = resolveCommandTheme(commandName);
    const cmd = commandName.toLowerCase();
    const bodyRaw = text.length > 4000 ? `${text.slice(0, 3997)}...` : text;
    const body = beautifyCommandText(bodyRaw);
    const lines = body.split("\n");
    const compact = lines.filter(line => line.trim().length > 0);

    let color = cmd === "pmc" ? 0x0b1f3a : theme.color;
    const outcomeColor = resolveOutcomeColor(commandName, body);
    if (outcomeColor !== null) color = outcomeColor;
    if (cmd === "pmc") color = 0x0b1f3a;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${theme.icon} /${slashCommandUsage(commandName)} • ${theme.label}`);

    if (compact.length <= 12 && body.length <= 1600) {
        embed.setDescription(body);
    } else {
        const summary = lines.slice(0, 6).join("\n").trim() || "No data available.";
        embed.setDescription(clampText(summary, 1200));

        const details = lines.slice(6).filter(line => line.trim().length > 0);
        const chunks = chunkLines(details, 950).slice(0, 3);
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({ name: i === 0 ? "Details" : `Details ${i + 1}`, value: chunks[i] });
        }
    }

    return brandEmbedForUser(embed, user, `/${slashCommandUsage(commandName)}`).toJSON();
}

export function embedFromPayload(commandName: string, raw: APIEmbed, user: User): APIEmbed {
    const theme = resolveCommandTheme(commandName);
    const cmd = commandName.toLowerCase();
    const embed = EmbedBuilder.from(raw);
    const payloadText = [
        embed.data.title || "",
        embed.data.description || "",
        ...(embed.data.fields || []).map(field => `${field.name || ""}\n${field.value || ""}`)
    ].join("\n");

    const hasExplicitPayloadColor = typeof embed.data.color === "number";
    const shouldPreserveGamePayloadColor = GAME_COMMAND_SET.has(cmd) && hasExplicitPayloadColor;

    const outcomeColor = shouldPreserveGamePayloadColor ? null : resolveOutcomeColor(commandName, payloadText);
    if (outcomeColor !== null) {
        embed.setColor(outcomeColor);
    } else if (!embed.data.color) {
        embed.setColor(theme.color);
    }
    if (cmd === "pmc") {
        embed.setColor(0x0b1f3a);
    }
    if (!embed.data.title) embed.setTitle(`${theme.icon} /${slashCommandUsage(commandName)} • ${theme.label}`);
    return brandEmbedForUser(embed, user, `/${slashCommandUsage(commandName)}`).toJSON();
}
