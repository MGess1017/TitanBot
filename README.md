# Titan Raid Bot

## Overview
Titan Raid Bot is a Discord bot designed to provide an engaging gaming experience inspired by Escape from Tarkov. Users build persistent PMC progression through raids, earning rewards and map reputation based on performance. The bot also features an economy, daily rewards, moderation, tickets, giveaways, and casino games.

## Features
- **PMC Progression**: Users advance through 50,000 levels and optional Prestige I-X with permanent raid bonuses.
- **Raid System**: Initiate raids with random outcomes, where users can earn XP and FN Token$ based on their performance.
- **Economy Management**: Users can manage their FN Token$ balance, earn daily rewards, and participate in games like crash.
- **Leaderboard**: Track user progress and achievements through an XP leaderboard.
- **Moderation Points**: Users can earn and manage mod points, which can be used for moderation actions like timeout, kick, and ban.

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
   - `/raid`: Initiate a raid with your selected character.
   - `/daily`: Claim your daily rewards.
   - `/balance`: Check your FN Token$ balance.
   - `/leaderboard`: View the XP leaderboard.
   - `/addpoints @user amount`: Add mod points to a specified user.

## Raid Quality of Life
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