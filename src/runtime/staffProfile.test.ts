import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    BotSettingsStore, defaultBotSettings, DEFAULT_STAFF_ROLE_IDS, normalizeBotSettings
} from "../features/botSettings";
import { AntiRaidDetector, AntiRaidIncidentStore } from "../features/antiRaid";
import {
    buildCaseHistoryLines, getChecklist, KnowledgeBaseStore, normalizeTicketChecklist, searchKnowledgeBase
} from "../features/staffDesk";
import {
    buildCaseView, buildHealthPayload, buildIncidentAlert, buildSettingsPayload, buildStaffHome, healthSignature,
    parseNumericFields, STAFF_IDS
} from "../features/staffHub";
import { buildProfileComponents, buildProfileEmbed, buildShopPayload, PROFILE_IDS, type ProfileSnapshot } from "../features/profileHub";
import {
    COSMETICS, defaultCosmeticState, DEFAULT_THEME_ID, equipCosmetic, MAX_SHOWCASE_BADGES, normalizeCosmeticState,
    normalizeProfilePreferences, purchaseCosmetic
} from "../game/cosmetics";
import { ANTI_RAID_SETTINGS, REWARD_SETTINGS } from "../features/botSettings";
import { buildWhatsNewEmbed, WHATS_NEW_COLOR, WHATS_NEW_RELEASE, WhatsNewStore } from "../features/whatsNew";
const { readBotSource } = require("../../scripts/lib/bot-source") as { readBotSource: () => string };

const CHANNELS = { modAlerts: "1500000000000000001", xpPanels: "1527571592320651285", checkpointCards: "1567414626273202286" };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "titan-staff-"));

// ---------- Settings ----------
{
    const defaults = defaultBotSettings(CHANNELS);
    assert.deepEqual(defaults.staffRoleIds, DEFAULT_STAFF_ROLE_IDS);
    assert.equal(new Set(DEFAULT_STAFF_ROLE_IDS).size, DEFAULT_STAFF_ROLE_IDS.length, "staff roles must be unique");
    assert.ok(Object.values(defaults.features).every(Boolean), "all features default on");

    const normalized = normalizeBotSettings({
        staffRoleIds: ["bad", "1506135569913085972", "1506135569913085972"],
        channels: { xpPanels: "not-a-snowflake", modAlerts: "1234567890123456789" },
        features: { antiRaid: false, unknown: true },
        rewards: { messageXp: 999_999, voiceDoubleXpHours: "2" },
        antiRaid: { joinThreshold: 1, mentionThreshold: 1, timeoutMinutes: 99_999 }
    }, defaults);
    assert.deepEqual(normalized.staffRoleIds, ["1506135569913085972"]);
    assert.equal(normalized.channels.xpPanels, CHANNELS.xpPanels, "invalid channel ids fall back");
    assert.equal(normalized.channels.modAlerts, "1234567890123456789");
    assert.equal(normalized.features.antiRaid, false);
    assert.equal((normalized.features as Record<string, boolean>).unknown, undefined);
    assert.equal(normalized.rewards.messageXp, REWARD_SETTINGS.messageXp.max, "rewards are clamped");
    assert.equal(normalized.rewards.voiceDoubleXpHours, 2, "non-numeric values fall back");
    assert.equal((normalized.antiRaid as Record<string, number>).joinThreshold, undefined, "saved join settings from older versions are dropped");
    assert.equal(normalized.antiRaid.mentionThreshold, ANTI_RAID_SETTINGS.mentionThreshold.min, "spam thresholds are clamped");
    assert.equal(normalized.antiRaid.timeoutMinutes, 1440);

    const file = path.join(tmp, "settings.json");
    const saves: boolean[] = [];
    const store = new BotSettingsStore(file, defaults, ok => saves.push(ok));
    assert.equal(store.update("1", draft => { draft.features.xpCrates = false; }), true);
    assert.equal(store.get().features.xpCrates, false);
    assert.equal(store.get().updatedBy, "1");
    assert.equal(new BotSettingsStore(file, defaults).get().features.xpCrates, false, "settings persist across restarts");
    assert.deepEqual(saves, [true]);

    const blocked = path.join(tmp, "blocked");
    fs.writeFileSync(blocked, "file, not a directory");
    const failing = new BotSettingsStore(path.join(blocked, "settings.json"), defaults, ok => saves.push(ok));
    assert.equal(failing.update("1", draft => { draft.features.voiceXp = false; }), false);
    assert.equal(failing.get().features.voiceXp, true, "failed saves revert in memory");
    assert.equal(saves[saves.length - 1], false);

    const parsed = parseNumericFields({ messageXp: "150", voiceXpPerMinute: "abc", voiceDoubleXpHours: "2", cosmeticPriceMultiplier: "50" }, REWARD_SETTINGS);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.errors.length, 2);
    const parsedOk = parseNumericFields({ messageXp: "150", voiceXpPerMinute: "100", voiceDoubleXpHours: "1.5", cosmeticPriceMultiplier: "1" }, REWARD_SETTINGS);
    assert.ok(parsedOk.ok && parsedOk.values.voiceDoubleXpHours === 1.5);

    for (const view of ["channels", "roles", "features", "rewards", "antiraid"] as const) {
        const payload = buildSettingsPayload(defaults, view);
        assert.ok(payload.embeds.length === 1 && payload.components.length <= 5, `settings view ${view} renders`);
    }
}

// ---------- Spam alerts (joins are always welcome) ----------
{
    const thresholds = { spamRepeatThreshold: 3, spamWindowSeconds: 20, mentionThreshold: 5 };
    const detector = new AntiRaidDetector(() => thresholds);
    const t0 = 1_000_000;
    assert.equal("recordJoin" in detector, false, "joins are never tracked or flagged");

    const msg = (content: string, at: number, mentionCount = 0) => detector.recordMessage({ guildId: "g", userId: "spammer", channelId: "c", messageId: String(at), content, mentionCount, now: at });
    assert.equal(msg("Buy NOW https://a.b", t0), null);
    assert.equal(msg("buy   now https://c.d", t0 + 1000), null);
    const spam = msg("BUY NOW https://x.y", t0 + 2000);
    assert.equal(spam?.kind, "spam", "normalized repeats are detected");
    assert.equal(msg("BUY NOW https://x.y", t0 + 3000), null, "one alert per cooldown");
    const mentions = detector.recordMessage({ guildId: "g", userId: "pinger", channelId: "c", messageId: "m", content: "hi", mentionCount: 6, now: t0 });
    assert.equal(mentions?.kind, "mention_abuse");
    detector.prune(t0 + 60 * 60_000);

    const incidents = new AntiRaidIncidentStore(path.join(tmp, "incidents.json"), false);
    const incident = incidents.create(spam!, t0);
    assert.deepEqual(incident.userIds, ["spammer"]);
    incidents.update(incident.id, entry => {
        entry.timedOutUserIds = ["spammer"];
        entry.actions.push({ type: "timeout", byId: "staff", at: t0 + 1, count: 1 });
    });
    assert.equal(incidents.forUser("g", "spammer").length, 1);
    assert.equal(incidents.recent("g", 5)[0].id, incident.id);

    const alert = buildIncidentAlert(incidents.get(incident.id)!);
    const buttons = (alert.components[0] as { components: Array<{ custom_id: string; disabled?: boolean }> }).components;
    assert.ok(buttons.some(button => button.custom_id === `${STAFF_IDS.alert}:untimeout:${incident.id}` && !button.disabled), "timeouts can be undone");
    assert.deepEqual(buttons.map(button => button.custom_id.split(":")[1]).sort(), ["dismiss", "timeout", "untimeout"], "alerts only offer reversible actions");
    assert.ok(buttons.every(button => button.custom_id.length <= 100));

    const legacyFile = path.join(tmp, "incidents-legacy.json");
    fs.writeFileSync(legacyFile, JSON.stringify({ incidents: [
        { id: "old", guildId: "g", kind: "join_flood", at: 1, userIds: ["a"], detail: "", timedOutUserIds: [], actions: [] },
        { id: "keep", guildId: "g", kind: "spam", at: 2, userIds: ["b"], detail: "", timedOutUserIds: [], actions: [{ type: "raidmode_on", byId: "s", at: 3 }] }
    ] }));
    const legacy = new AntiRaidIncidentStore(legacyFile);
    assert.equal(legacy.get("old"), null, "saved join-flood incidents are dropped");
    assert.deepEqual(legacy.get("keep")?.actions, []);

    const persisted = new AntiRaidIncidentStore(path.join(tmp, "incidents-persist.json"));
    const stored = persisted.create(mentions!, t0);
    assert.ok(new AntiRaidIncidentStore(path.join(tmp, "incidents-persist.json")).get(stored.id), "incidents persist so alert buttons survive restarts");
}

// ---------- What's New ----------
{
    const embed = buildWhatsNewEmbed().toJSON();
    assert.equal(embed.color, WHATS_NEW_COLOR);
    assert.match(WHATS_NEW_RELEASE.id, /^fnt-patch-\d{3,}$/);
    assert.match(embed.title!, /^FNTCORD — Patch \d{3,}: /);
    WHATS_NEW_RELEASE.sections.forEach((section, index) => {
        assert.ok(section.name.startsWith(`${String(index + 1).padStart(2, "0")} • `), "patch sections are numbered in order");
    });
    assert.ok(embed.fields && embed.fields.length === WHATS_NEW_RELEASE.sections.length && embed.fields.length <= 25);
    for (const section of WHATS_NEW_RELEASE.sections) {
        assert.ok(section.lines.map(line => `• ${line}`).join("\n").length <= 1024, `${section.name} fits in one field`);
    }
    const totalLength = (embed.title?.length || 0) + (embed.description?.length || 0) + (embed.footer?.text.length || 0)
        + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
    assert.ok(totalLength <= 6000, "embed stays under Discord's 6000 character limit");
    assert.doesNotMatch(JSON.stringify(embed), /@everyone|@here|raid mode/i);

    const file = path.join(tmp, "whats-new.json");
    const store = new WhatsNewStore(file);
    assert.equal(store.hasPosted(WHATS_NEW_RELEASE.id, "c1"), false);
    store.markPosted(WHATS_NEW_RELEASE.id, "c1", "m1");
    assert.equal(new WhatsNewStore(file).hasPosted(WHATS_NEW_RELEASE.id, "c1"), true, "each release posts once, even across restarts");
    assert.equal(new WhatsNewStore(file).hasPosted(WHATS_NEW_RELEASE.id, "c2"), false, "moving the channel reposts there");
    assert.equal(new WhatsNewStore(file).hasPosted("next-release", "c1"), false, "new releases post again");
}

// ---------- Staff desk ----------
{
    assert.ok(getChecklist("bug").some(item => item.id === "repro"));
    assert.equal(getChecklist("nonexistent"), getChecklist("general"));
    for (const category of ["general", "bug", "appeal", "billing", "account", "report"]) {
        assert.ok(getChecklist(category).length <= 10, `${category} checklist fits in two button rows`);
    }
    assert.deepEqual(normalizeTicketChecklist({ ok: { byId: "1", at: 5 }, bad: { byId: 2 } }), { ok: { byId: "1", at: 5 } });

    const kb = new KnowledgeBaseStore(path.join(tmp, "kb.json"));
    kb.add({ title: "Lost tokens after restart", body: "Run /xpverify and check backups", tags: ["tokens", " Restart "], authorId: "1" });
    assert.equal(new KnowledgeBaseStore(path.join(tmp, "kb.json")).all().filter(article => !article.builtIn).length, 1);
    const hits = searchKnowledgeBase("double xp voice", kb.all(), []);
    assert.equal(hits[0]?.kind === "article" && hits[0].article.id, "xp-voice", "voice XP article ranks first");
    const ticketHits = searchKnowledgeBase("crate missing", [], [{ id: 7, text: "my crate is missing", resolution: "Re-granted crate" }]);
    assert.equal(ticketHits[0]?.kind === "ticket" && ticketHits[0].ticketId, 7, "resolved tickets are searchable");
    assert.deepEqual(searchKnowledgeBase("", kb.all(), []), []);

    const history = buildCaseHistoryLines({
        userId: "u",
        tickets: [{ id: 1, status: "open", category: "bug", createdAt: 1000, resolvedReason: null, closedReason: null, channelId: "c" },
            { id: 2, status: "resolved", createdAt: 5000, resolvedReason: "Fixed XP", closedReason: null, channelId: "d" }],
        reports: [{ id: 3, status: "open", summary: "spam", createdAt: 2000 }],
        warnings: [{ reason: "caps", at: 3000 }],
        alerts: [{ kind: "mention_abuse", at: 4000, action: "timeout" }]
    });
    assert.match(history.summary, /Tickets: \*\*2\*\* \(1 open\)/);
    assert.match(history.sections[0].value.split("\n")[0], /^#2 /, "newest ticket first");

    const caseView = buildCaseView({ userId: "u", summary: history.summary, sections: history.sections,
        ticket: { id: 1, category: "bug", reason: "broken", checklist: getChecklist("bug"), done: { repro: { byId: "s", at: 1 } } } });
    assert.ok(caseView.components.length <= 5);
    assert.match(JSON.stringify(caseView.embeds[0]), /\(1\/6\)/);

    const home = buildStaffHome({ ticketId: 4, openTickets: 2, recentIncidents: 1, healthIssues: 0 });
    assert.match(home.embeds[0].description || "", /ticket #4/);

    const issues = [{ key: "b", severity: "warning" as const, message: "w" }, { key: "a", severity: "critical" as const, message: "c" }];
    assert.equal(healthSignature(issues), healthSignature([...issues].reverse()));
    assert.match(buildHealthPayload(issues, Date.now()).embeds[0].title || "", /Action needed/);
    assert.match(buildHealthPayload([], Date.now()).embeds[0].title || "", /All clear/);
}

// ---------- Cosmetics + profile ----------
{
    assert.ok(COSMETICS.every(item => !("xp" in item) && !("odds" in item)), "cosmetics carry no gameplay stats");
    assert.equal(COSMETICS.find(item => item.id === DEFAULT_THEME_ID)?.price, 0);
    assert.ok(COSMETICS.filter(item => item.kind === "theme").every(item => item.name.startsWith("FNT")), "every theme keeps the FNT branding");

    const state = defaultCosmeticState();
    const wallet = { fnTokens: 500 };
    assert.deepEqual(purchaseCosmetic(state, wallet, "theme_fnt_gold", 1), { ok: false, reason: "funds", price: 2500 });
    const bought = purchaseCosmetic(state, wallet, "theme_fnt_midnight", 1);
    assert.ok(bought.ok && wallet.fnTokens === 100);
    assert.equal(purchaseCosmetic(state, wallet, "theme_fnt_midnight", 1).ok, false, "no double purchase");
    assert.equal(purchaseCosmetic(state, { fnTokens: 1000 }, "theme_fnt_gold", 0.1).ok, true, "price multiplier applies");
    assert.equal(equipCosmetic(state, "theme_fnt_midnight").ok, true);
    assert.equal(state.themeId, "theme_fnt_midnight");
    assert.equal(equipCosmetic(state, "title_boss_hunter").ok, false, "cannot equip unowned items");

    const rich = { fnTokens: 100_000 };
    const badges = COSMETICS.filter(item => item.kind === "badge").slice(0, MAX_SHOWCASE_BADGES + 1);
    for (const badge of badges) {
        purchaseCosmetic(state, rich, badge.id, 1);
        equipCosmetic(state, badge.id);
    }
    assert.equal(state.badgeIds.length, MAX_SHOWCASE_BADGES, "showcase is capped");
    equipCosmetic(state, badges[0].id);
    assert.equal(state.badgeIds.includes(badges[0].id), false, "equipping a showcased badge removes it");

    const tampered = normalizeCosmeticState({ owned: ["fake"], themeId: "theme_fnt_gold", titleId: "title_boss_hunter", badgeIds: ["badge_eagle"] });
    assert.equal(tampered.themeId, DEFAULT_THEME_ID, "cannot equip unowned theme via data");
    assert.equal(tampered.titleId, null);
    assert.deepEqual(tampered.badgeIds, []);
    assert.deepEqual(normalizeProfilePreferences({ doubleXpDm: false, junk: 1 }), { doubleXpDm: false, showCheckpointRating: true });

    const snapshot: ProfileSnapshot = {
        userId: "111", username: "Operator", avatarUrl: null, cosmetics: state, preferences: { doubleXpDm: true, showCheckpointRating: false },
        xp: 5000, level: 5, xpBar: "▰▰▱", xpRole: "Recruit", prestigeLabel: "None", fnTokens: 10, bankTokens: 0, pmcLevel: 1, pmcXp: 0,
        pmcRaids: 0, pmcRaidWins: 0, pmcBossKills: 0, voiceMultiplier: 2, inVoice: true, voiceTime: "2h", dailyStreak: 1, lastXpAt: 0,
        achievementTitle: null, xpAchievements: { earned: [], total: 5, next: null }, voiceAchievements: { earned: [], total: 5, next: null },
        recentAchievements: [], latestCrate: null, nextCrateAt: null, bossHearts: [],
        checkpoint: { rating: 88, tier: "Elite", url: null }, games: { played: 0, wins: 0, losses: 0, net: 0 },
        cosmeticShopEnabled: true, priceMultiplier: 1
    };
    const overview = buildProfileEmbed(snapshot, "overview");
    assert.equal(overview.color, 0x2b1d52, "profile uses the equipped FNT theme color");
    assert.match(JSON.stringify(overview), /Hidden by player/);
    assert.doesNotMatch(JSON.stringify(buildProfileEmbed(snapshot, "collections")), /88\/100/, "hidden rating stays hidden on collections");
    assert.match(JSON.stringify(overview), /2x XP/);

    const ownerPrefs = JSON.stringify(buildProfileComponents(snapshot, "preferences", "111"));
    assert.match(ownerPrefs, new RegExp(`${PROFILE_IDS.pref}:doubleXpDm:111`), "preference buttons are bound to the owner");
    assert.doesNotMatch(JSON.stringify(buildProfileComponents(snapshot, "preferences", "222")), /profile:pref/, "visitors cannot see preference toggles");
    assert.match(JSON.stringify(buildProfileComponents(snapshot, "overview", "222")), new RegExp(PROFILE_IDS.shop));
    assert.doesNotMatch(JSON.stringify(buildProfileComponents({ ...snapshot, cosmeticShopEnabled: false }, "overview", "111")), new RegExp(PROFILE_IDS.shop));

    for (const kind of ["theme", "title", "badge"] as const) {
        const shop = buildShopPayload(state, 1000, kind, 1);
        assert.ok(shop.components.length <= 5);
        assert.match(JSON.stringify(shop.embeds[0]), /Cosmetic only/);
    }
}

// ---------- bot.ts wiring ----------
{
    const botSource = readBotSource();
    assert.match(botSource, /if \(await handleProfileInteraction\(interaction\)\) return;/);
    assert.match(botSource, /if \(await handleStaffInteraction\(interaction\)\) return;/);
    assert.match(botSource, /staff: async interaction => \{\s+if \(!interaction\.guild \|\| !isStaffMember\(interaction\.member\)\)/, "/staff is staff-gated");
    assert.match(botSource, /if \(!interaction\.guild \|\| !isStaffMember\(interaction\.member\)\) \{\s+await interaction\.reply\(\{ content: "Staff only\."/, "staff buttons are staff-gated");
    assert.match(botSource, /member\.user\.bot \|\| isStaffMember\(member\) \|\| !member\.moderatable/, "spam alerts never time out staff");
    const joinHandler = botSource.slice(botSource.indexOf('client.on("guildMemberAdd"'), botSource.indexOf('client.on("guildMemberAdd"') + 1500);
    assert.doesNotMatch(joinHandler, /antiRaid|\.kick\(|\.ban\(|\.timeout\(/, "new members are never flagged, kicked, banned, or timed out on join");
    const alertCode = botSource.slice(botSource.indexOf("async function raiseAntiRaidAlert"), botSource.indexOf("// ---------- Health checks ----------"));
    assert.doesNotMatch(alertCode, /\.kick\(|\.ban\(|setVerificationLevel/, "spam alerts never kick, ban, or lock the server");
    assert.match(botSource, /runStaffHealthMonitor\("interval_10m"\)/);
    assert.match(botSource, /PRIVATE_SLASH_COMMANDS = new Set\(\[[^\]]*"staff"/, "/staff replies are ephemeral");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("staff + profile runtime tests passed");
