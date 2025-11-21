# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Worker that serves as a Telegram bot for monitoring Ukrainian power outage schedules from Yasno (Ukraine's electricity distribution service). The bot:
- Allows users to subscribe to specific power zones via Telegram
- Monitors the Yasno API every 5 minutes via cron triggers
- Sends automatic notifications when power schedules change for subscribed zones
- Uses Supabase for data persistence (subscribers and schedule cache)

## Key Commands

### Development
```bash
npm run dev          # Start local development server with hot reload
npm start            # Alias for dev
```

### Testing
```bash
npm test            # Run tests with Vitest (using Cloudflare Vitest pool)
```

### Deployment
```bash
npm run deploy      # Deploy to Cloudflare Workers
```

### Type Generation
```bash
npm run cf-typegen  # Generate TypeScript types from wrangler configuration
```

## Architecture

### Entry Points
The worker has two main entry points in `src/index.ts`:

1. **`fetch()` handler**: Handles incoming HTTP requests (Telegram webhooks)
   - POST requests process Telegram updates (commands and callback queries)
   - Handles `/start` command to show zone selector
   - Handles `/stop` command to unsubscribe
   - Handles `/now` command to fetch current schedule immediately
   - Processes zone selection callbacks to store subscriptions

2. **`scheduled()` handler**: Runs on cron schedule (every 5 minutes)
   - Fetches fresh data from Yasno API
   - Compares with cached data in Supabase
   - Detects changes per zone
   - Sends update notifications to subscribers
   - Updates cache

### Data Flow

#### User Commands
1. **`/start`** → Bot sends zone selector keyboard
2. **User selects zone** → Stored in `subscribers` table, immediate schedule sent
3. **`/now`** → Fetches and displays current schedule for user's subscribed zone
4. **`/stop`** → Removes user from `subscribers` table

#### Automatic Updates
1. Cron job runs every 5 minutes → Checks for changes
2. If changes detected → Notifies all subscribers of affected zones
3. Cache updated in `schedule_cache` table

### Change Detection Logic
The bot compares fresh API data with cached data to detect schedule changes:
- **Primary method**: Compares the `updatedOn` timestamp field per zone (most reliable)
- **Fallback**: If timestamps missing, compares only schedule data (today/tomorrow slots)
- **First run**: All zones marked as changed if no cache exists
- This prevents false positives from API response variations while reliably detecting actual schedule updates

### Message Formatting
Schedule messages use a simple list format for each day (today and tomorrow):
- Date header with day of week
- 🔴 **Outages** section: Lists all outage periods with start-end times and durations, plus total outage time
- 🟢 **Power** section: Lists all power availability periods with start-end times and durations, plus total power time
- ⏱ **Updated timestamp**: Shows when the API last updated the schedule (from `updatedOn` field)

Example:
```
⚡️ Current Schedule
Zone: 1.1

📅 Today (21.11.2025, чт)

🔴 Outages (10h total):
  • 04:00–08:00 (4h)
  • 14:30–20:30 (6h)
🟢 Power (14h total):
  • 00:00–04:00 (4h)
  • 08:00–14:30 (6h30m)
  • 20:30–24:00 (3h30m)

⏱ Updated: 21.11.2025, 20:29
```

### External Dependencies
- **Yasno API**: `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages`
  - Returns zone schedules (1.1, 1.2, 2.1, etc.) with today/tomorrow data
  - Each day has slots with start/end times (in minutes from midnight) and type (Definite=outage, NotPlanned=power on)
  - Includes `updatedOn` timestamp for change detection

- **Telegram Bot API**: Standard bot methods via HTTPS
  - sendMessage (with Markdown support)
  - answerCallbackQuery
  - Inline keyboards for zone selection

- **Supabase**: Two tables required
  - `subscribers`: `(chat_id, zone)` - user subscriptions
  - `schedule_cache`: `(id, raw_data, updated_at)` - cached Yasno response

### Environment Variables
Required in Cloudflare Workers secrets (not in code):
- `TELEGRAM_TOKEN`: Bot token from @BotFather
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase service role key

### Cron Configuration
Configured in `wrangler.jsonc`:
- Triggers: `*/5 * * * *` (every 5 minutes)
- Uses Cloudflare Workers cron triggers (not external cron)

### TypeScript Configuration
- Target: ES2021
- Module: ES2022 with Bundler resolution
- Strict mode enabled
- Worker types from `worker-configuration.d.ts` (auto-generated)
- Test files excluded from main compilation
