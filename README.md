# Titan Raid Bot

## Overview
Titan Raid Bot is a Discord bot designed to provide an engaging gaming experience inspired by Escape from Tarkov. Users can select their designated PMC characters and participate in raids, earning rewards based on their performance. The bot also features a points system, daily rewards, and various commands for managing user interactions.

## Features
- **PMC Character Selection**: Users can choose from a variety of PMC characters, each with unique attributes and abilities.
- **Raid System**: Initiate raids with random outcomes, where users can earn XP and FN Token$ based on their performance.
- **Economy Management**: Users can manage their FN Token$ balance, earn daily rewards, and participate in games like crash.
- **Leaderboard**: Track user progress and achievements through an XP leaderboard.
- **Moderation Points**: Users can earn and manage mod points, which can be used for moderation actions like timeout, kick, and ban.

## Installation
1. Clone the repository:
   ```
   git clone https://github.com/yourusername/titan-raid-bot.git
   ```
2. Navigate to the project directory:
   ```
   cd titan-raid-bot
   ```
3. Install the dependencies:
   ```
   npm install
   ```
4. Configure the bot by editing the `src/data/config.json` file with your Discord bot token and server ID.

## Usage
1. Start the bot:
   ```
   npm start
   ```
2. Use the following commands in your Discord server:
   - `/selectCharacter`: Choose your PMC character.
   - `/raid`: Initiate a raid with your selected character.
   - `/daily`: Claim your daily rewards.
   - `/balance`: Check your FN Token$ balance.
   - `/leaderboard`: View the XP leaderboard.
   - `/addpoints @user amount`: Add mod points to a specified user.

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