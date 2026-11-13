# Titan Raid Bot

## Overview
Titan Raid Bot is a Discord bot designed to provide an engaging gaming experience inspired by Escape from Tarkov. Users build persistent PMC progression through raids, earning rewards and map reputation based on performance. The bot also features an economy, daily rewards, moderation, tickets, giveaways, and casino games.

## Features
- **FNTCORD Owner Control**: Restricted launcher in `1569954324136722562`, durable player adjustments, feature switches, XP rates, and per-admin ban/kick quotas. See [Owner Control & Store](#owner-control--store).
- **FNTCORD Store**: Owner-managed catalog in `1569955515205685329`, private admin workspace in `1569956286181937274`, numbered items, descriptions, listed costs, availability, search, and direct owner-ticket requests. Catalog only: no automatic currency deductions or inventory delivery.
- **FNTCORD Staff Studio**: Channel `1569627148736659466` remains a clean staff-only launcher. Its private editor supports destination channels, named colors, explicit user/role mentions, previews, immediate publishing, Announcement/Event/Maintenance templates, and up to 25 named saved drafts per staff member/guild. Editing sessions expire after 30 minutes or restart; explicitly saved drafts and confirmed schedules persist in `src/data/embed-studio.json` with atomic writes/backups. Save with the same name to replace a draft. Scheduling requires an ISO date/time with an explicit UTC offset and an IANA timezone (for example `2027-01-15T18:00-05:00` plus `America/New_York`), verifies daylight-saving alignment, and shows a separate confirmation before queueing. Dates must be one minute to one year ahead. Publication history shows links, status/errors and schedule cancellation. A 15-second scheduler starts independently of public autopanel provisioning; overdue pending schedules run after restart. Each send rechecks current staff membership, destination access/send/embed permissions, and mention permissions. Durable claims and Discord nonces prevent duplicate submission; interrupted, recovered-from-backup, or uncertain sends never auto-retry. Scheduled outcomes are DMed to the author; notification failures are logged and history remains available. Mentions use explicit allowlists; `@everyone` and non-mentionable roles require both author and bot Mention Everyone permission. Configure Discord channel visibility for staff only; the bot does not change overwrites. `npm run test:runtime:embed-builder` covers guards, templates, persistence, scheduling, reauthorization, failures and restart/duplicate safety.
- **FNTCORD Command Hub**: The clean public launcher in channel `1527571592320651285` opens **My Dashboard** privately: current server/PMC levels, next XP milestone, Arena setup progress, saved RuneScape player, and a favorite shortcut. **Profiles**, **Operations**, **Economy**, and **Guides & Support** remain grouped workspaces. All private hub views use **Home / Back / Refresh / Customize** and clear obsolete card attachments when switching views. Searches include only public command references and curated guides, never private tickets or staff articles. Both previous inquiry titles migrate in place; startup reuses the saved ID (`ENABLE_STARTUP_AUTOPANELS`), and health checks can repair a missing panel. Existing count, leaderboard and crate panels are preserved.
- **Looking for Group**: A separate managed launcher in `1527571592320651285` privately builds requests with game, total players (2-20, including the host), comments, embed color, platform/crossplay, region, voice preference, and an optional ISO start time with UTC offset (up to 14 days ahead; Discord displays it in each member's local timezone). Requests post to `1570579425832214568`; members can join or leave, capacity is enforced, and hosts can edit, complete, or cancel. Unscheduled requests expire after four hours; scheduled requests expire two hours after their start. Hosts receive best-effort DMs when members join or leave. Members can report inappropriate/spam requests to the configured report log; delivery is durably queued and retried. Listing state persists in `src/data/lfg-listings.json` with atomic writes and backups; a one-minute maintenance task expires listings and reconciles failed post edits. No slash command or new role is required. `npm run test:runtime:lfg` covers validation, scheduling, capacity, membership, edit/host controls, expiration, report delivery state, embeds, and restart persistence.
- **FNTCORD Settings & Card Studio**: **Customize** groups settings into **Appearance**, **Privacy**, **Notifications**, and **Linked Games**, with the dashboard favorite on the settings home. Appearance offers automatic/checkpoint/radio art, tactical or owned equipped-theme accents, three/one/no extra highlights, private XP/PMC previews, and access to the existing cosmetic shop. Privacy controls future `/xp`, `/pmc`, and own `/profile` reply visibility; private profiles cannot be browsed by other members. Switching to private removes the stored public Arena card before confirming, and subsequent Arena refreshes render only private previews. The bot needs access to its old card to delete it; failures are explicit and do not claim the privacy change succeeded. Old slash messages, screenshots, and leaderboards are not erased. Arena rating visibility in the unified profile remains a separate setting. Notifications reuse the existing double-voice-XP DM preference. Linked Games saves/clears an optional RuneScape name; this is not verified account ownership. Preferences persist across restarts, failed saves roll back in-memory preferences, and cosmetic choices never alter progression or odds.
- **Hub Verification**: `npm run test:runtime:inquiry-panel` checks every workspace dropdown destination, Home/Back/Refresh routing, grouped settings, nested views, legacy panel migration, saved/invalid preferences, per-user isolation, save-failure rollback, themed card attachments, and RuneScape failures. Final response payloads are checked for Discord component limits and message-wide unique custom IDs; Home and Back retain distinct IDs even when they share a destination.
- **Tactical XP & PMC Cards**: `/xp`, `/pmc`, and their hub entries render bot-tracked progress over the existing original AI-generated military backgrounds with FNTCORD branding. Cards show level, XP, prestige and the selected number of highlights; supporting XP rank/crate and PMC readiness stay compact. **Detailed Breakdown** opens XP intelligence or the PMC raid record; existing dossier sections and prestige controls remain available. Cards are timestamped snapshots, not continuously edited messages: use Refresh to regenerate. Deploy `assets/profile-cards` and `assets/fonts`; Attach Files permission is required.
- **RuneScape Profiles**: `/rs3 player:<name>` and **RuneScape Search** share the same Jagex integration. The command defaults to `GzaWizz`; the panel accepts any valid display name. Profiles show quest progress, Jagex's published avatar, and available RuneMetrics combat/total-level/XP stats. Private or unavailable RuneMetrics data is explicitly labeled. Jagex data may be delayed; the avatar is not a real-time gameplay screenshot. The `Rs3` self-role is provisioned/reused on startup in channel `1554389202085482566`, requiring Manage Roles and the bot's role above it.
- **Welcome to FNT**: The newcomer panel in channel `1528998695624773714` (`BOT_FEATURE_BRIEF_CHANNEL_ID` override) replaces the old About Titan Bot reference message in place. Five short bullets introduce profiles, free daily rewards, raids, server XP, and support. **Get Started** opens a private first-ten-minutes guide with a minimum-stake, low-risk raid example; **Command Guide** opens privately without changing the public panel. Support is referenced only by mentioning the actual ticket panel channel, `1506119505720377434` (`PERMANENT_TICKET_PANEL_CHANNEL_ID` override); there is no ticket-opening button on the welcome panel. No new slash command is needed.
- **Support Intake & Retry Drafts**: The support panel, `/ticket` without a reason, and `/ticketintake` open a private category selector, then a three-field form (summary, details, screenshot/message links). Reports, appeals, and billing require evidence links. Include platform/order information in the details; legacy in-flight forms still work. Failed submissions retain a per-guild, per-member draft for 24 hours in `src/data/ticket-drafts.json`, including across restarts. **Edit / Retry Request** reopens it prefilled. Successful submissions clear the draft; save failures are logged and shown to the member. Drafts are capped at 1,000 active entries.
- **Compact Ticket Cards**: Each case shows its summary, member, readable status, handler, and request. References and evidence appear only when supplied. Members can **Request Closure**; this leaves the case open for staff review. Staff can Claim Ticket, Close Ticket, or open private Staff Tools. Member replies automatically show **Waiting for staff**; **Request Information** sends the staff question and shows **Waiting for you**. Normal staff replies mark the case in progress. Closing archives the case; reopening restores member send permissions. Permanent resolution requires a separate staff-bound confirmation, rejected if the case changes. Existing cards are migrated at startup.
- **Private Support Queue**: `/staff` → Support Queue offers paginated Unclaimed, Waiting for Staff, Waiting for Member, and Overdue Replies views with direct channel links. Staff Tools includes Assign Handler, Request Information, case history/checklists, templates, and watch. Knowledge-base controls use the label **Help Articles**. Queue navigation and notifications settings are staff-only and never replace the public case card.
- **Ticket Notifications**: Creation and member replies notify the assigned handler (claim lead as fallback), or send an unpinged staff alert for unassigned cases. Staff replies can notify the member. From Support Queue → Notification Settings, staff can turn these notifications on/off and set a 5–1440 minute minimum interval (default 30). Notification keys and last-send times persist to suppress duplicate/burst alerts across restarts. Failed deliveries are logged and not marked delivered. Overdue staff replies receive periodic targeted reminders; waiting-member and closed cases do not. The previous automatic closure of unclaimed tickets is removed: delays by staff must not close a member's request.
- **Ticket Reliability**: Panel IDs are reused; history is scanned only when recovering a missing card. Unchanged cards skip edits and concurrent updates are serialized. Per-channel action guards prevent overlapping claim/close/resolve/assignment and block conflicting state mutations. Member replies wait for pending case actions rather than being discarded. Transcript export includes full sanitized message text, embed content, and attachment links, paginates up to 10,000 messages, flushes and atomically saves the file, then verifies its SHA-256 readback before resolution/deletion. Fetch, export-limit, disk, or verification failures preserve the channel and alert staff. Channel-deletion failures are surfaced for manual cleanup. Larger tickets need a manual export; attachment links are not copies of the underlying files.
- **Ticket Verification**: `npm run test:runtime:onboarding`, `npm run test:runtime:ticket-system`, `npm run test:runtime:ticket-enhancements`, and `npm run test:runtime:staff-profile` cover cards, private views, state transitions, drafts/restarts, notification suppression, locks, and transcript failures.
- **PMC Progression**: Users advance through 50,000 levels and optional Prestige I-X with permanent raid bonuses.
- **Raid System**: Initiate raids with random outcomes, where users can earn XP and FN Token$ based on their performance.
- **Economy Management**: Users can manage their FN Token$ balance, earn daily rewards, and participate in games like crash.
- **Leaderboard**: Track user progress and achievements through an XP leaderboard.
- **Live XP Panel**: A purple modular top-10 engagement XP leaderboard in channel `1527571592320651285` displays separated ranking entries with user mentions, usernames, XP, prestige, and current voice multipliers. Mentions do not send notification pings. It posts automatically at startup, reuses its saved message, and refreshes within 15 seconds (including XP earned outside voice).
- **Continuous Voice Bonus**: All voice channels earn 100 XP per completed minute, increasing to 200 XP/minute after two continuous hours. Switching voice channels preserves the timer; disconnecting from any VC resets the bonus to 1x without removing earned XP. There is no AFK penalty. `/xp` shows the user's current 1x or 2x voice XP status when requested. Message XP is unchanged. VC sessions are saved and restored across bot restarts for users still connected. Offline time earns no XP and does not advance the bonus timer. Discord cannot reveal disconnect/rejoin events that happened while the bot was offline, so recovery assumes continuity for saved connected users who are connected when it returns. On the first deployment of session persistence, existing unsaved session time cannot be recovered.
- **Double-XP Unlock DM**: Users receive one DM when a continuous voice session passes two hours. Reconnecting starts a fresh notification cycle. Delivery failures (including disabled DMs) are logged; the XP bonus is unaffected.
- **Daily XP Crates**: The purple **FN Xp Panel** in channel `1527571592320651285` offers one immediate-open random crate per user per rolling 24 hours, independent of `/daily`. Early repeat clicks receive `Daily limit exceeded`. Ten regular crates (Slate, Emerald, Teal, Sapphire, Violet, Rose, Crimson, Amber, Gold, Diamond) have matching chest art and distinct colors. Their selection weights are 30%, 22%, 16%, 11%, 8%, 5%, 3.5%, 2%, 1.5%, and 1% conditional on a regular crate. All regular crates allow zero XP and are weighted toward smaller rewards, with exactly a 0.01% chance per regular crate of reaching 100,000 XP. The separate purple/blue Astral crate has a 0.001% chance per daily claim and always awards 1,000,000 XP. Voice multipliers do not multiply crate rewards. The latest crate, reward, and next eligibility are saved in `/xp` and shown fresh whenever the command is opened; old profile messages are not continuously edited. Chest art remains on crate reward messages; `/xp` uses its tactical progression card. Crate images ship in `assets/xp-crates` and must be included in deployments.
- **Moderation Points**: Users can earn and manage mod points, which can be used for moderation actions like timeout, kick, and ban.
- **FNTCORD Arena Player Cards**: The clean launcher in channel `1567414626273202286` (override with `CHECKPOINT_CARD_CHANNEL_ID`) opens a private setup checklist, **Edit Profile**, four stat forms, **Refresh Card**, **Retry Publish**, and **Detailed Breakdown**. The old panel migrates in place and old component IDs still work. Name rules remain 3-15 letters, numbers, `_` or `-`; all 16 stats are still validated and used in the unchanged rating calculation. Cards now show only rating/tier, name, K/D, win rate and matches; all raw stats and weighted points are behind Detailed Breakdown. Both card art and embeds explicitly label stats **Self-reported**; the timestamp represents the saved stats, not the latest render. Public mode updates the existing message without pinging and recreates deleted cards. Private mode never publishes, and Refresh renders an ephemeral preview. Publication/deletion tasks are serialized per user; failed saves restore the old profile, and failed publishes offer retry without reentering stats. Ratings stay 1-99 with the existing small-sample adjustment and tier boundaries. Assets/fonts remain in `assets/checkpoint-cards` and `assets/fonts`; rendering uses `@napi-rs/canvas`.
- **Unified Profile (`/profile [user]`)**: One themed profile with Overview, Progression, Achievements, Collections, Activity, and Preferences pages, built live from saved data each time it opens or changes page. Only the owner can toggle preferences (2x unlock DMs, Arena rating visibility); visitors browse pages privately.
- **FNT Cosmetic Shop**: Spend FN Token$ from `/profile` on FNT-branded profile themes, titles, and collectible badges (up to 3 showcased). Items are purely cosmetic and never affect XP, raids, casino odds, or other competition. The FNT Signature Purple theme is free for everyone.
- **Staff Desk (`/staff`)**: Private desk for administrators and the configured staff roles. Inside a ticket it shows the member's case history (tickets, reports, warnings, spam alerts) and a per-category resolution checklist that saves who ticked each step. Staff can search a knowledge base of built-in guides, staff-written articles (`src/data/knowledge-base.json`), and resolved tickets.
- **No-Code Settings**: `/staff` → Settings changes staff roles, panel and alert channels (panels move automatically), feature toggles, message/voice XP rates, the 2x threshold, cosmetic prices, and spam alert thresholds. Values are validated, saved atomically to `src/data/bot-settings.json` with a backup, take effect live, and are logged to the staff alert channel. Defaults match the original behaviour (100 message XP, 100 voice XP/min, 2x after 2 hours).
- **Spam Alerts**: Every account is welcome. Joins are never tracked, and the bot never kicks, bans, or removes anyone for joining, however many join at once. Repeated spam and mention abuse post an alert to the staff alert channel (the mod-log channel by default). Nothing happens automatically: staff choose Timeout, Undo Timeout, or False Alarm from the alert. Staff are never timed out. Incidents persist in `src/data/anti-raid-incidents.json` so alert buttons survive restarts.
- **What's New**: Every bot update must include concise, professionally labeled patch notes in `src/features/whatsNew.ts`. Increment the patch number (starting at 001), use a unique `fnt-patch-NNN` release ID, title `FNT Bot — Patch NNN: <update name>`, and sequential `01 • <section>` headings with bullet-pointed changes. On startup the bot posts the current patch once to channel `1554331042293485649` (`WHATS_NEW_CHANNEL_ID` override), without notification pings. Posted releases are tracked in `src/data/whats-new.json`; ordinary restarts do not repeat an announced patch.
- **Health Checks**: Every 10 minutes and after startup, the bot checks its permissions in configured channels, re-posts missing XP/crate/rating panels, and reports failed saves and failed startup tasks. Staff alerts post only when the issue set changes; staff can run a check any time from `/staff`.

## Installation
1. Clone the repository:
   ```
   git clone https://github.com/MGess1017/TitanBot.git
   ```
2. Navigate to the project directory:
   ```
   cd titan-raid-bot
   ```
3. Install the dependencies:
   ```
   npm install
   ```
4. Copy `.env.example` to `.env`, then set `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, and the required deployment IDs.
5. Build the production output:
   ```
   npm run build
   ```

## Usage
1. Start the bot:
   ```
   npm start
   ```
2. Use the following commands in your Discord server:
   - `/pmc`: View PMC levels, milestones, map mastery, and prestige.
   - `/profile`: Open your unified profile and the FNT cosmetic shop.
   - `/staff`: Staff desk for cases, checklists, knowledge base, settings, and health.
   - `/raid`: Initiate a raid with your selected character.
   - `/daily`: Claim your daily rewards.
   - `/balance`: Check your FN Token$ balance.
   - `/leaderboard`: View the XP leaderboard.
   - `/casino <game>`: Play `dice`, `roulette`, `blackjack`, `crash`, `slots`, `coinflip`, `baccarat`, `hilo`, or `keno`; `/casino lobby` opens the button-based game floor.
   - `/addpoints @user amount`: Add mod points to a specified user.

## Owner Control & Store

### Owner Control
- Channel `1569954324136722562` permits panel interactions only from `807001514287169587` and `402639384756879360`. Administrator permission alone is insufficient. Every control rechecks actor/channel/session ownership. Sessions expire after 15 minutes or restart; confirmations are one-use.
- Player controls set/add/remove Server XP, PMC XP, wallet FN Tokenz, banked FN Tokenz, or Access Points. Whole numbers only, range 0-1,000,000,000,000, no silent underflow/clamping. A reason and before/after confirmation are required. Stale values, bot targets and active raids are rejected. Corrections and the latest 50 per-player receipts persist together in `points.json`; an older queued save cannot undo a reduction. Busy/failed saves reject the correction. Server XP changes also schedule a live leaderboard refresh. XP roles reconcile asynchronously against current XP; open cards remain snapshots. Existing achievements/prestige are preserved. Administrative PMC XP marks reached milestone/mastery levels without awarding loot, preventing deferred or repeated payouts.
- Feature switches and XP/cosmetic rates reuse existing bot settings and validation. Changing those switches does not change Discord permissions.
- Ban and kick limits are **per administrator**, with guild defaults and individual overrides. Calendar day/week/month windows use UTC; weeks start Monday. `unlimited` has no cap, `0` blocks actions, and `inherit` removes an individual override. Defaults are unlimited, and the actual Discord guild owner is exempt. `/tempban` consumes the ban allowance; unbans do not refund it. These are action-frequency limits, not ban durations. Existing tempban expiry scheduling is unchanged.
- Moderation still requires Administrator, current role hierarchy and bot permissions. Access Points remain badge-only: Recruit 0, Operator 250, Veteran 500, Elite 1,000. Native Discord Administrator/Ban Members/Kick Members actions bypass bot quotas; remove those native permissions if native moderation must be restricted.
- Quota policies/history persist in `src/data/moderation-quotas.json`. Durable reservations occur before Discord actions, serialize concurrent requests, and survive restarts. Confirmed Discord rejections release reservations; network uncertainty or interrupted actions remain consumed/pending for owner inspection. Missing/corrupt quota data with backups and stale locks fail closed rather than resetting allowances; inspect/restore authoritative data before retrying. Do not clear history to reset an allowance. Automatic lockdown bans remain system actions outside per-admin quotas.

### Catalog & Owner Tickets
- Public catalog: `1569955515205685329`. Store administration: `1569956286181937274`, restricted to the **actual current Discord guild owner** plus `807001514287169587`; other staff/Owner Panel users do not automatically gain store access.
- The public panel previews up to five listings. Browse privately for paginated listings, category/text/item-number search, full descriptions, availability and listed cost. Request an item by number to open an owner ticket. All interaction responses are ephemeral; only the permanent launchers and the resulting private ticket are channel messages.
- Store administrators add/edit a name, listed cost including currency/units, description and category. Reasons, previews and one-use confirmations protect changes. Archive/restore listings or mark them unavailable. Item numbers are permanent and never reused; revisions reject stale edits. Confirmed changes refresh the public panel without posting another launcher.
- The catalog is **not a checkout**: no currency is deducted, no purchase is confirmed, and no inventory is delivered. Cost is a display label; the owner confirms terms and manually fulfills requests. Never submit payment credentials through the bot.
- Each request captures the item number/revision, name, description, listed cost and customer notes in existing ticket intake fields, with a full text snapshot attached to the opening card. Tickets are assigned to the actual guild owner, not auto-routed to the general handler role. Explicit channel overwrites permit the requester, guild owner and bot; native Discord Administrators can still see them. One active store inquiry per requester prevents spam, independently of support/report tickets. Existing owner channels can be recovered after an interrupted creation; add additional item numbers to the open inquiry.
- Catalog items and the last 1,000 edit-audit entries persist in `src/data/store-catalog.json` using atomic writes/backups. Sessions/drafts expire after 15 minutes or restart; only confirmed edits are saved. Unreadable primary data fails closed instead of silently restoring older item numbers. Back up this file alongside player, quota and ticket data. Run a single bot instance (the existing instance lock remains required).
- Configure **Discord channel visibility** for Owner Control and store administration yourself; the bot does not silently rewrite existing channel permissions. The bot needs View Channel, Send Messages, Embed Links and Read Message History for launchers, plus Manage Channels, Manage Roles and Attach Files for private store tickets. Startup upserts the panels when `ENABLE_STARTUP_AUTOPANELS` is enabled; staff health checks can repair missing launchers.
- Verification: `npm run test:runtime:owner-panel`, `npm run test:runtime:moderation-quotas`, and `npm run test:runtime:store`.

### Verified Store Reviews
- In Owner Control (`1569954324136722562`), open **Store Fulfillment & Review Log**, then **Confirm Store Fulfillment**. Enter the tracked store ticket number and a fulfillment reason, review the recipient/item receipt, and confirm. Only the actual current guild owner can verify fulfillment; other authorized panel users can read the log but cannot grant review eligibility. General tickets, missing item receipts, changed previews and already-fulfilled requests are rejected. Closing/archiving a ticket never automatically marks an item fulfilled.
- The recipient opens the item through the public store's private workspace and chooses **Leave Verified Review**. One review per owner-confirmed fulfilled request, with a whole 1-5 rating and a required 1-500-character comment. Reviews publish immediately, including negative ratings, without owner approval. Do not include private/payment information; the form clearly labels comments as public. No payment is processed and no new ticket is created by reviewing.
- **Reviews** buttons appear below live listings only when those items have reviews (on the compact launcher's first five listings and all private paginated listings). Reading feedback is ephemeral and includes average rating, review count, dates and three comments per page. Public review views omit reviewer IDs, ticket numbers and internal fulfillment reasons. Archived items are not publicly browsable; existing reviews remain in the owner log.
- The private Owner Control log includes every submitted review and fulfillment confirmation, customer/actor IDs, ticket references, timestamps and receipt IDs, with three entries per page. It does not send review spam to a log channel or require a new channel. Existing Owner Control access restrictions remain unchanged.
- `src/data/store-reviews.json` atomically persists fulfillment eligibility and reviews with backups. Save failures do not publish feedback or consume eligibility; duplicate/replayed submissions cannot create multiple reviews. Corrupt/missing primaries with backups fail closed rather than restoring old eligibility. Include this file in backups and keep the existing single-instance deployment lock. No review-edit/delete or rating-manipulation controls are provided.
- `npm run test:runtime:store` covers review persistence, rollback, corruption, eligibility, duplicate protection, public button visibility, private publication and existing catalog/ticket flows. `npm run test:runtime:owner-panel` covers actual-owner authorization, ownership changes, stale fulfillment previews and private log access.

## Project layout
`src/bot.ts` is now only the entry point: it wires Discord events, timers, and startup. Feature code lives in small modules under `src/bot/`, each starting with a one-line comment describing what it owns.

| Folder | What to edit there |
| --- | --- |
| `src/bot/core/` | Env loading (`env.ts`), channel/role IDs and data paths (`config.ts`), settings, storage, metrics, audit log, ops alerts, health reports, restart |
| `src/bot/commands/` | Slash command handlers, grouped by area (`general`, `admin`, `tickets`, `giveaways`, `raids`, `casino`, `moderation`). `handlers.ts` merges the groups; `registry.ts` holds the slash command list |
| `src/bot/interactions/` | Button, menu, and modal handlers, grouped by area. `bot.ts` tries each group in order |
| `src/bot/panels/` | Auto-posted panels (XP leaderboard and crates, player cards, tickets, welcome, member counts, self roles, feature brief) |
| `src/bot/xp/`, `raid/`, `casino/`, `economy/`, `tickets/`, `giveaways/`, `moderation/` | Feature logic for each system |
| `src/bot/staff/`, `profile/`, `ui/` | Staff desk and spam alerts, `/profile`, shared embeds, help pages, custom IDs, modals |

Editing tips:
- To add a slash command, add it to `src/commands/slashCatalog.ts` and add its handler to the matching group in `src/bot/commands/`. `npm run verify:contracts` fails if either side is missing.
- Discord allows at most 100 slash commands (91 are used). To fold related commands into one, list them in `SLASH_COMMAND_GROUPS` in `slashCatalog.ts` (as the casino games are). Their handlers stay keyed by the original names, and the build refuses groups that mix member and admin-only commands.
- Modules import what they use directly; never import `src/bot.ts` from a module.
- Avoid using another module's `const`/`let` values at load time (top-level code). Use them inside functions, which run after every module has loaded.
- To change a value owned by another module, call a setter exported by that module (for example `setXpRoleSyncPaused`).
- Run `npx tsc --noEmit -p .` after edits; it catches broken imports and missing exports immediately.

## Raid Quality of Life
- All 21 bosses have individually designed horror portraits tied to their names and home maps. Images ship in `assets/bosses` and are attached directly to battle cards, boss intel, extraction results, and rare-unlock broadcasts; no external image-generation endpoint is required. Deploy the assets directory alongside the compiled bot.
- Boss countercharges are telegraphed before every third turn or when starting rage is at least 60%. The warning shows exact damage (12-28 HP); Defend reduces it by 75% (rounded up) and replaces that turn's normal Defend chip damage. A killing blow prevents retaliation. Rewards, progression, the eight-second timer, and timeout auto-attacks are unchanged.
- Battle cards use actual combat HP and HP-based phases, not legacy simulated animation toward a precomputed outcome. Portraits upload once per battle and are reused across turns.
- Boss encounters show current HP, health-based phases, phase mechanics, matched trait counters, rage warnings, med patch stock, and an action deadline.
- Combat uses one Discord update per turn. Attack remains the eight-second timeout default. Combat ends at zero HP or the turn limit.
- Heal is disabled at full HP or with no med patches; stale heal requests consume neither items nor turns. Valid heals restore up to 70 HP and consume one med patch.
- **Extract Now** ends the optional boss fight and keeps already-settled extraction rewards. It does not reroll the raid or award a boss kill. Raids with an already-resolved boss kill or a failed extraction skip optional combat.
- Raid result cards group duplicate loot stacks, prioritize rare drops, show item totals and final HP, and provide Inventory, History, Boss Roster, map-specific Mastery, and Supplies shortcuts.
- `/bosses` includes a selector for every existing boss's traits, counter approaches, HP phases, possible gear drops, and your kill, streak, intel, heart-upgrade, and alternate-form progress.
- Invalid loadouts are rejected before route decisions. Decision buttons are restricted to the deployed player; expired controls receive a private response.
- `npm run test:runtime:raid-qol` checks combat, every boss's phase thresholds and intel card limits, loot summaries, and mocked Discord battle interactions without logging in or writing player data.

## PMC and Raid Expansion
- `/pmc` now has owner-controlled Overview, Follower, Prestige, Mastery, and Collection views. Overview includes equipment condition and field supplies; collection and mastery details are loaded only when selected.
- Sir Gru has persistent Balanced, Scout, Guardian, and Quartermaster support roles. Scout trades follower token yield for extraction support; Guardian trades follower boss support for mitigation; Quartermaster trades follower extraction support for token yield. Roles affect passive follower bonuses, not ability unlocks, and cannot change during an active raid.
- The follower view includes all six ability milestones, XP remaining to the next unlock, and current role bonuses. Existing followers default to Balanced, and their XP and role survive prestige.
- Prestige still requires PMC level 20,000 and caps at X. The preview shows XP to eligibility and permanent bonus growth separately from post-reset total bonuses. Confirmation is tied to the reviewed rank, old confirmations are rejected, and active raids block prestige. Currency, gear, follower progress, mastery records, and trophies remain intact.
- PMC level lookup now uses binary search instead of scanning all 50,000 thresholds. Follower level lookup uses the inverse XP curve.
- Twelve new raid-only equipment pieces form six sets: Cinderline, Tideglass, Nullweave, Stormvault, Reliquary, and Chronicle. Each matched pair grants +2.5% raid XP multiplier; its preferred condition also adds +0.8 percentage points extraction chance and +1% token multiplier. Existing loadout caps still apply. Pieces drop through successful-raid discovery tables and are not sold or crafted.
- Tactical forks now include **Survey Site** (-3% token multiplier, +4 REP on extraction) and **Rescue Patrol** (-2 percentage points extraction chance, +10% base raid XP and +8 REP on extraction). Failed extraction awards no objective bonus. Timeout still stays on the original course.
- Five new field events cover Obsidian Spire, Nullforge Depths, Bloodmoon Cathedral, Eclipse Bastion, and Titanfall Crucible. The last two require territory reputation. Results show event effects, completed objectives, equipped sets, new gear discoveries, and unsold loot vendor value.
- All 13 ultra-rare collectibles sell for at least **55,000,000 FN Token$** each. Existing 75-million and 100-million payouts are preserved. Drop probabilities are unchanged. This deliberately raises the expected token value of affected discoveries, including previously owned items.
- Vendor purchases now enforce the shop allowlist, preventing direct-ID purchases of raid-only gear or collectible resale exploits. Fully repaired gear costs nothing to repair, and zero durability is no longer mistaken for full durability.
- `npm run test:runtime:pmc-expansion` covers all 50,000 PMC threshold boundaries, follower role tradeoffs, prestige preservation and stale confirmations, profile payload limits, new gear drops, set bonuses, objective rewards, map events, repairs, and purchase restrictions.

### VPS Update
Run from the existing bot repository on the VPS. Keep the current `.env` and `src/data` files. A fast-forward pull stops on conflicting local changes; resolve those without discarding live player data.

```bash
git pull --ff-only origin main &&
npm run build &&
npx pm2 startOrReload ecosystem.config.cjs --only titan-raid-bot --update-env &&
npx pm2 save &&
npx pm2 logs titan-raid-bot --lines 50 --nostream
```

This builds `dist` before PM2 restarts `titan-raid-bot`. Failed steps stop the command chain without exiting your SSH shell. Check the logs for successful login and command registration.

## Operations and Reliability
- Persistent VC sessions:
   - `src/data/voice-sessions.json` stores connected-session progress, partial minutes, and unlock-notification state. Saves run on connection changes, every 15-second XP tick, and shutdown.
   - An observed disconnect resets the bonus, including after a subsequent restart. Users absent at startup are marked disconnected. Offline time is never awarded as catch-up XP.
- Queued JSON persistence:
   - Player data and shared routine stores (metrics, moderation, trades, giveaways, telemetry, XP role metrics, VC sessions) snapshot in memory, coalesce save bursts for up to 100 ms, and write asynchronously in order per file. Temporary files are flushed before atomic replacement; backups retain prior snapshots.
   - Failed writes are logged, exposed by staff health checks, and retried after five seconds with the latest snapshot retained. Checkpoints attempt every store independently.
   - `/xpverify` waits for queued writes before checking the primary against memory. Backups are previous snapshots, not a second copy of the current balance.
   - Startup readers try the primary and three backup generations. Recovery repairs the primary and preserves damaged files as `.corrupt` copies. If all generations are unreadable, startup fails instead of silently replacing existing data with empty data.
   - Settings, ticket version checks, and other immediate-confirmation stores retain synchronous writes so existing success/rollback semantics are unchanged. JSON serialization itself still runs on the main thread; this is not a database migration.
- Graceful restarts:
   - SIGINT/SIGTERM settle voice XP, checkpoint state, and await queued saves before exit (10-second deadline; failures exit nonzero). Forced termination can still lose unflushed work; keep external backups.
   - The PM2 configuration runs Node directly and allows 15 seconds to stop. Apply it with `npx pm2 startOrReload ecosystem.config.cjs --only titan-raid-bot --update-env`, then `npx pm2 save`.
   - `npm run test:runtime:health` includes disk-failure/retry, corruption recovery, VC restart, and shutdown-flush tests.
- Optional webhook alerts:
   - Set `OPS_ALERT_WEBHOOK_URL` in `.env` to receive critical runtime alerts (login failure, uncaught exception, unhandled rejection).
- Guild portability:
   - You can override guild-specific constants via `.env`: `TICKET_HANDLER_ROLE_ID`, `TICKET_DEFAULT_CATEGORY_ID`, `PERMANENT_TICKET_PANEL_CHANNEL_ID`, and `BOT_FEATURE_BRIEF_CHANNEL_ID`.
   - Startup preflight warns when these values are not explicitly configured.
- Startup preflight checks:
   - On boot, the bot now verifies `DISCORD_TOKEN` and writable data paths before starting services.
   - If preflight fails, startup exits with a clear error list and emits an ops alert (when webhook is configured).
   - Strict env mode: set `STRICT_ENV_REQUIRED=1` (or run with `NODE_ENV=production`) to require ticket/guild IDs from env and fail fast when missing.
- Idempotency guard:
   - Mutating admin/ticket commands are deduped for a short time window to prevent accidental double execution.
   - Configure `COMMAND_IDEMPOTENCY_WINDOW_MS` (default: `15000`, set `0` to disable).
- Supervised production runtime with PM2:
   - `npm run start:pm2`
   - `npm run logs:pm2`
   - `npm run restart:pm2`
   - `npm run stop:pm2`
- Verification pipeline:
   - `npm run verify:integrity` for build + contract checks.
   - `npm run verify:data` for data schema + backup integrity checks.
   - `npm run verify:regression` for admin-guard and legacy-overlap checks.
   - `npm run verify:runtime` for bounded bot startup checks.
   - `npm run test:runtime` for health helpers and economy/raid behavior tests.
   - `npm run verify:all` for full release gate coverage.
   - `npm run health:strict` for the release gate plus a live Discord boot smoke test; valid production credentials are required.

## Security and Abuse Monitoring
- Economy/XP anomaly telemetry:
   - Suspicious spikes are logged to `src/data/anomalies.jsonl`.
   - Tune with env vars:
     - `TOKEN_SPIKE_THRESHOLD` (default `25000`)
     - `XP_SPIKE_THRESHOLD` (default `5000`)
     - `ANOMALY_COOLDOWN_MS` (default `60000`)

## Contributing
Contributions are welcome! If you have suggestions or improvements, feel free to open an issue or submit a pull request.

## License
This project is licensed under the MIT License. See the LICENSE file for details.