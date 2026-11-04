# Titan Raid Bot

## Overview
Titan Raid Bot is a Discord bot designed to provide an engaging gaming experience inspired by Escape from Tarkov. Users build persistent PMC progression through raids, earning rewards and map reputation based on performance. The bot also features an economy, daily rewards, moderation, tickets, giveaways, and casino games.

## Features
- **PMC Progression**: Users advance through 50,000 levels and optional Prestige I-X with permanent raid bonuses.
- **Raid System**: Initiate raids with random outcomes, where users can earn XP and FN Token$ based on their performance.
- **Economy Management**: Users can manage their FN Token$ balance, earn daily rewards, and participate in games like crash.
- **Leaderboard**: Track user progress and achievements through an XP leaderboard.
- **Live XP Panel**: A purple modular top-10 engagement XP leaderboard in channel `1527571592320651285` displays separated ranking entries with user mentions, usernames, XP, prestige, and current voice multipliers. Mentions do not send notification pings. It posts automatically at startup, reuses its saved message, and refreshes within 15 seconds (including XP earned outside voice).
- **Continuous Voice Bonus**: All voice channels earn 100 XP per completed minute, increasing to 200 XP/minute after two continuous hours. Switching voice channels preserves the timer; disconnecting from any VC resets the bonus to 1x without removing earned XP. There is no AFK penalty. `/xp` shows the user's current 1x or 2x voice XP status when requested. Message XP is unchanged. Session timers begin when the bot observes the connection (or starts while users are already connected).
- **Double-XP Unlock DM**: Users receive one DM when a continuous voice session passes two hours. Reconnecting starts a fresh notification cycle. Delivery failures (including disabled DMs) are logged; the XP bonus is unaffected.
- **Daily XP Crates**: The purple **FN Xp Panel** in channel `1527571592320651285` offers one immediate-open random crate per user per rolling 24 hours, independent of `/daily`. Early repeat clicks receive `Daily limit exceeded`. Ten regular crates (Slate, Emerald, Teal, Sapphire, Violet, Rose, Crimson, Amber, Gold, Diamond) have matching chest art and distinct colors. Their selection weights are 30%, 22%, 16%, 11%, 8%, 5%, 3.5%, 2%, 1.5%, and 1% conditional on a regular crate. All regular crates allow zero XP and are weighted toward smaller rewards, with exactly a 0.01% chance per regular crate of reaching 100,000 XP. The separate purple/blue Astral crate has a 0.001% chance per daily claim and always awards 1,000,000 XP. Voice multipliers do not multiply crate rewards. The latest crate, chest image, reward, and next eligibility are saved in `/xp` and shown fresh whenever the command is opened; old profile messages are not continuously edited. Crate images ship in `assets/xp-crates` and must be included in deployments.
- **Moderation Points**: Users can earn and manage mod points, which can be used for moderation actions like timeout, kick, and ban.
- **Arena Player Rating Cards**: The purple **Arena Player Rating** panel in channel `1567414626273202286` (override with `CHECKPOINT_CARD_CHANNEL_ID`) has an **In-Game Name** form plus four stat forms (Combat, Matches, Precision, Records & Economy) covering all 16 Arena CheckPoint statistics. The in-game name (3-15 letters, numbers, `_` or `-`) is what the card shows instead of the Discord username. Values are player-reported and entered manually; inputs accept commas, `%`, and `k`/`m` shorthand for money and match XP. Impossible combinations (for example victories above matches played) are rejected. Once the name and all four sections are saved, the bot renders a sports-style card (tier artwork, player-specific accents, avatar, in-game name behind and below the rating, all 16 stats) and posts it publicly in the panel channel without pinging. Each later edit re-renders and edits the same card message; a deleted card is reposted. **My Rating Breakdown** shows private per-category points. Ratings are 1-99: K/D 20, win rate 18, headshot rate 12, MVP rate 10, experience 10, kills per match 8, multi-kills 6, best streak 6, best match XP 4, money 4, melee 2, minus up to 10 for quit rate. Under 50 matches, ratings blend toward 45. Tiers: Legend 90+, Elite 80+, Veteran 70+, Operator 60+, Contender 45+, Recruit. Card backgrounds and OFL fonts ship in `assets/checkpoint-cards` and `assets/fonts`; rendering uses `@napi-rs/canvas`.
- **Unified Profile (`/profile [user]`)**: One themed profile with Overview, Progression, Achievements, Collections, Activity, and Preferences pages, built live from saved data each time it opens or changes page. Only the owner can toggle preferences (2x unlock DMs, Arena rating visibility); visitors browse pages privately.
- **FNT Cosmetic Shop**: Spend FN Token$ from `/profile` on FNT-branded profile themes, titles, and collectible badges (up to 3 showcased). Items are purely cosmetic and never affect XP, raids, casino odds, or other competition. The FNT Signature Purple theme is free for everyone.
- **Staff Desk (`/staff`)**: Private desk for administrators and the configured staff roles. Inside a ticket it shows the member's case history (tickets, reports, warnings, spam alerts) and a per-category resolution checklist that saves who ticked each step. Staff can search a knowledge base of built-in guides, staff-written articles (`src/data/knowledge-base.json`), and resolved tickets.
- **No-Code Settings**: `/staff` → Settings changes staff roles, panel and alert channels (panels move automatically), feature toggles, message/voice XP rates, the 2x threshold, cosmetic prices, and spam alert thresholds. Values are validated, saved atomically to `src/data/bot-settings.json` with a backup, take effect live, and are logged to the staff alert channel. Defaults match the original behaviour (100 message XP, 100 voice XP/min, 2x after 2 hours).
- **Spam Alerts**: Every account is welcome. Joins are never tracked, and the bot never kicks, bans, or removes anyone for joining, however many join at once. Repeated spam and mention abuse post an alert to the staff alert channel (the mod-log channel by default). Nothing happens automatically: staff choose Timeout, Undo Timeout, or False Alarm from the alert. Staff are never timed out. Incidents persist in `src/data/anti-raid-incidents.json` so alert buttons survive restarts.
- **What's New**: On startup the bot posts the current release notes (`src/features/whatsNew.ts`) once to the What's New channel (`WHATS_NEW_CHANNEL_ID`, default `1554331042293485649`). Posted releases are tracked in `src/data/whats-new.json`; change the release `id` to announce the next update.
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
   - `/addpoints @user amount`: Add mod points to a specified user.

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
set -e
git pull --ff-only origin main
npm install --include=dev
npm run verify:all
npm run restart:pm2
npx pm2 save
npx pm2 logs titan-raid-bot --lines 50 --nostream
```

The verification gate builds `dist` before PM2 restarts `titan-raid-bot`. Check the logs for successful login and command registration.

## Operations and Reliability
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