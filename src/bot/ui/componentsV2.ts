import { MessageFlags } from "discord.js";
import type { RequestMethod } from "@discordjs/rest";

type JsonObject = Record<string, unknown>;
type JsonComponent = { type: number } & JsonObject;
type RestOptions = { body?: unknown; [key: string]: unknown };
type RestLike = {
    request: (options: RestOptions & { fullRoute: `/${string}`; method: RequestMethod }) => Promise<unknown>;
};

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const CONTAINER_TYPE = 17;
const TEXT_DISPLAY_TYPE = 10;
const MEDIA_GALLERY_TYPE = 12;
const FILE_TYPE = 13;
const MAX_TEXT_LENGTH = 4_000;
const MAX_CONTAINER_COMPONENTS = 10;

function isRecord(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function toJson(value: unknown): unknown {
    if (isRecord(value) && typeof value.toJSON === "function") {
        return (value.toJSON as () => unknown)();
    }
    return value;
}

function componentFrom(value: unknown): JsonComponent | null {
    const json = toJson(value);
    return isRecord(json) && typeof json.type === "number" ? json as JsonComponent : null;
}

function chunkText(value: string, limit = MAX_TEXT_LENGTH): string[] {
    const chunks: string[] = [];
    let remaining = value.trim();
    while (remaining.length > limit) {
        let splitAt = remaining.lastIndexOf("\n", limit);
        if (splitAt < Math.floor(limit / 2)) splitAt = remaining.lastIndexOf(" ", limit);
        if (splitAt < 1) splitAt = limit;
        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

function embedLines(value: unknown): string[] {
    const embed = toJson(value);
    if (!isRecord(embed)) return [];
    const lines: string[] = [];
    const author = isRecord(embed.author) && typeof embed.author.name === "string" ? embed.author.name : "";
    const title = typeof embed.title === "string" ? embed.title : "";
    const titleUrl = typeof embed.url === "string" ? embed.url : "";
    const description = typeof embed.description === "string" ? embed.description : "";
    const footer = isRecord(embed.footer) && typeof embed.footer.text === "string" ? embed.footer.text : "";

    if (author) lines.push(`-# ${author}`);
    if (title) lines.push(titleUrl ? `## [${title}](${titleUrl})` : `## ${title}`);
    if (description) lines.push(description);
    if (Array.isArray(embed.fields)) {
        for (const valueField of embed.fields) {
            if (!isRecord(valueField)) continue;
            const name = typeof valueField.name === "string" ? valueField.name : "Field";
            const fieldValue = typeof valueField.value === "string" ? valueField.value : "-";
            lines.push(`**${name}**\n${fieldValue}`);
        }
    }
    if (footer) lines.push(`-# ${footer}`);
    if (typeof embed.timestamp === "string" && embed.timestamp) {
        const timestamp = Date.parse(embed.timestamp);
        if (Number.isFinite(timestamp)) lines.push(`-# <t:${Math.floor(timestamp / 1000)}:f>`);
    }
    return lines;
}

function embedMedia(value: unknown): Array<{ media: { url: string }; description?: string }> {
    const embed = toJson(value);
    if (!isRecord(embed)) return [];
    const media: Array<{ media: { url: string }; description?: string }> = [];
    for (const key of ["thumbnail", "image"] as const) {
        const item = embed[key];
        if (isRecord(item) && typeof item.url === "string" && item.url) {
            media.push({ media: { url: item.url } });
        }
    }
    return media.slice(0, 10);
}

function embedAccent(value: unknown): number | undefined {
    const embed = toJson(value);
    return isRecord(embed) && typeof embed.color === "number" ? embed.color : undefined;
}

function containerFor(text: string, accentColor?: number, media: Array<{ media: { url: string } }> = []): JsonComponent[] {
    const containers: JsonComponent[] = [];
    const textChunks = chunkText(text);
    const textComponents: JsonComponent[] = textChunks.map(content => ({ type: TEXT_DISPLAY_TYPE, content }));
    if (media.length) textComponents.push({ type: MEDIA_GALLERY_TYPE, items: media });
    if (!textComponents.length) textComponents.push({ type: TEXT_DISPLAY_TYPE, content: "No message content." });

    for (let offset = 0; offset < textComponents.length; offset += MAX_CONTAINER_COMPONENTS) {
        const batch = textComponents.slice(offset, offset + MAX_CONTAINER_COMPONENTS);
        const container: JsonComponent = { type: CONTAINER_TYPE, components: batch };
        if (accentColor !== undefined) container.accent_color = accentColor;
        containers.push(container);
    }
    return containers;
}

export function componentsV2Payload(payload: unknown): JsonObject {
    const raw = toJson(payload);
    const data: JsonObject = isRecord(raw) ? { ...raw } : { content: String(raw ?? "") };
    const content = typeof data.content === "string" ? data.content.trim() : "";
    const embeds = Array.isArray(data.embeds) ? data.embeds : [];
    const existingComponents = Array.isArray(data.components)
        ? data.components.map(componentFrom).filter((component): component is JsonComponent => Boolean(component))
        : [];
    const generated: JsonComponent[] = [];

    if (content) generated.push(...containerFor(content));
    for (const embed of embeds) {
        const text = embedLines(embed).join("\n\n");
        const converted = containerFor(text, embedAccent(embed), embedMedia(embed));
        generated.push(...converted);
    }

    delete data.content;
    delete data.embeds;
    delete data.poll;
    delete data.stickers;
    const components = [...generated, ...existingComponents];
    data.components = components.length ? components : containerFor("No message content.");
    data.flags = (typeof data.flags === "number" ? data.flags : 0) | COMPONENTS_V2_FLAG;
    return data;
}

function isMessageRoute(route: string): boolean {
    return route.includes("/channels/") && route.includes("/messages")
        || route.includes("/webhooks/")
        || route.endsWith("/callback");
}

function addUnreferencedFileComponents(payload: JsonObject, files: unknown): JsonObject {
    if (!Array.isArray(files) || !files.length) return payload;
    const components = Array.isArray(payload.components) ? [...payload.components] : [];
    const rendered = JSON.stringify(components);
    for (const file of files) {
        if (!isRecord(file) || typeof file.name !== "string" || !file.name) continue;
        const url = `attachment://${file.name}`;
        if (rendered.includes(url)) continue;
        components.push({ type: FILE_TYPE, file: { url } });
    }
    return { ...payload, components };
}

function convertRestOptions(route: `/${string}`, options: RestOptions): RestOptions {
    if (!isRecord(options.body) || !isMessageRoute(route)) return options;
    const body = { ...options.body };

    if (route.endsWith("/callback")) {
        const responseType = body.type;
        if (responseType !== 4 && responseType !== 7) return options;
        const data = isRecord(body.data) ? componentsV2Payload(body.data) : componentsV2Payload({});
        return { ...options, body: { ...body, data: addUnreferencedFileComponents(data, options.files) } };
    }

    return { ...options, body: addUnreferencedFileComponents(componentsV2Payload(body), options.files) };
}

export function installComponentsV2(rest: RestLike): void {
    const state = rest as RestLike & { __componentsV2Installed?: boolean };
    if (state.__componentsV2Installed) return;
    state.__componentsV2Installed = true;

    const request = rest.request.bind(rest);
    rest.request = options => request({
        ...options,
        ...convertRestOptions(options.fullRoute, options)
    });
}

