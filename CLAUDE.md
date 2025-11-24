# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Worker that serves as a Telegram bot for monitoring Ukrainian power outage schedules from Yasno (Ukraine's electricity distribution service). The bot:
- Allows users to subscribe to specific power zones via Telegram
- Monitors the Yasno API every 10 minutes via cron triggers
- Sends automatic notifications when power schedules change for subscribed zones
- Uses Supabase for data persistence (users, subscriptions, and schedule cache)
- Features a modular architecture with clear separation of concerns

## Key Commands

### Development
```bash
npm run dev          # Start local development server with hot reload
npm start            # Alias for dev
```

### Testing
```bash
npm test            # Run tests with Vitest (using Cloudflare Vitest pool)
npx tsc --noEmit    # Check TypeScript types without emitting files
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

### Modular Code Organization

The codebase follows a modular architecture with clear separation of concerns:

```
src/
├── index.ts                 # Main entry point (fetch & scheduled handlers)
├── types/
│   └── index.ts            # All TypeScript interfaces and types
├── config/
│   └── constants.ts        # Configuration constants (API URLs, messages, etc.)
├── database/
│   ├── client.ts           # Supabase client initialization
│   ├── users.ts            # User CRUD operations
│   ├── subscriptions.ts    # Subscription CRUD operations
│   └── cache.ts            # Cache and history operations
├── telegram/
│   ├── api.ts              # Telegram Bot API helpers (sendMessage, bulk sending)
│   ├── handlers.ts         # Command handlers (start, stop, now, broadcast, etc.)
│   └── keyboards.ts        # Inline keyboard builders
├── yasno/
│   ├── api.ts              # Yasno API fetching with retry logic
│   ├── changes.ts          # Schedule change detection logic
│   └── formatter.ts        # Schedule message formatting
└── services/
    └── scheduler.ts        # Cron job orchestration and bulk notifications
```

### Database Schema

The database uses **separated users and subscriptions** for better data management:

#### Tables
- **`users`**: Stores all users who have interacted with the bot (persisted even after unsubscribing)
  - `id` (BIGSERIAL PRIMARY KEY)
  - `chat_id` (BIGINT UNIQUE) - Telegram chat ID
  - `created_at` (TIMESTAMPTZ)
  - `last_interaction_at` (TIMESTAMPTZ) - Updated on every interaction

- **`subscriptions`**: Stores active zone subscriptions
  - `id` (BIGSERIAL PRIMARY KEY)
  - `user_id` (BIGINT REFERENCES users) - Links to user
  - `zone` (TEXT) - Subscribed zone (e.g., "1.1", "2.1")
  - `subscribed_at` (TIMESTAMPTZ)
  - Constraint: One subscription per user (UNIQUE on user_id)

- **`schedule_cache`**: Cached Yasno API response
  - `id` (INTEGER PRIMARY KEY, always 1)
  - `raw_data` (JSONB) - Complete API response
  - `updated_at` (TIMESTAMPTZ)

- **`schedule_history`**: Historical log for debugging
  - `id` (BIGSERIAL PRIMARY KEY)
  - `raw_data` (JSONB) - API response snapshot
  - `fetched_at` (TIMESTAMPTZ)
  - `changed_zones` (TEXT[]) - Zones that changed
  - `notes` (TEXT) - Debug notes

#### Database Setup
The complete database schema is in `migrations/000_complete_schema.sql`. This single file creates all required tables, indexes, and constraints. It can be run on a fresh database to set up the entire schema.

### Entry Points

The worker has two main entry points in `src/index.ts`:

1. **`fetch()` handler**: Handles incoming HTTP requests (Telegram webhooks)
   - POST requests process Telegram updates (commands and callback queries)
   - Delegates to `handleTelegramUpdate()` in `telegram/handlers.ts`

2. **`scheduled()` handler**: Runs on cron schedule (every 10 minutes per `wrangler.jsonc`)
   - Delegates to `checkScheduleUpdates()` in `services/scheduler.ts`

### Data Flow

#### User Commands
1. **`/start`** → Bot sends zone selector keyboard (initial setup)
2. **`/subscribe`** → Bot sends zone selector keyboard (allows changing zone)
3. **User selects zone** → Creates/updates user and subscription, sends immediate schedule
4. **`/now`** → Fetches and displays current schedule for user's subscribed zone (from cache)
5. **`/stop`** → Removes subscription (but keeps user record)
6. **`/test`** → Test API connectivity and display diagnostic information

#### Admin Commands
- **`/broadcast <message>`** → (Admin only, chat_id: 67306153) Sends a message to all active subscribers using bulk sending with rate limiting

#### Automatic Updates
1. Cron job runs every 10 minutes → Calls `checkScheduleUpdates()`
2. Fetches fresh data from Yasno API (with retry logic)
3. Compares with cached data using `detectChangedZones()`
4. If changes detected → Groups subscribers by zone
5. Sends bulk notifications with rate limiting (30 messages/second)
6. Updates cache in `schedule_cache` table
7. Logs everything to `schedule_history` for debugging

### Change Detection Logic

The bot compares fresh API data with cached data to detect schedule changes:
- **Primary method**: Compares schedule data (slots and status) for today and tomorrow
- **Ignores**: Date strings and timestamp fields (to prevent false positives)
- **First run**: All zones marked as changed if no cache exists
- **Detailed logging**: Logs specific changes (slots, status, counts) for debugging

Change detection is in `yasno/changes.ts`:
- `detectChangedZones()` - Compares all zones
- `hasZoneChanged()` - Single zone comparison
- `compareScheduleData()` - Deep comparison of day schedules

### Bulk Notification System

The bot uses efficient bulk sending to handle many subscribers:
- **Grouping**: Subscribers are grouped by zone (avoids duplicate message sends)
- **Rate Limiting**: Respects Telegram's 30 messages/second limit
- **Chunking**: Processes subscribers in chunks of 30
- **Delays**: Waits 1 second between chunks
- **Parallel Sending**: Sends messages in parallel within each chunk
- **Error Handling**: Tracks successful and failed sends

Implementation in `telegram/api.ts`:
- `sendBulkMessages()` - Handles chunking and rate limiting
- Used by both broadcast command and schedule updates

### Key Modules

#### Database Operations (`src/database/`)
- **`users.ts`**:
  - `ensureUser()` - Create user if not exists, update last interaction
  - `getUserId()` - Get user ID by chat ID

- **`subscriptions.ts`**:
  - `subscribeUser()` - Subscribe user to zone (upsert)
  - `unsubscribeUser()` - Remove subscription
  - `getUserSubscription()` - Get user's active zone
  - `getZoneSubscribers()` - Get all subscribers for a zone
  - `getAllSubscribersGroupedByZone()` - Efficient grouping for bulk send

- **`cache.ts`**:
  - `getCachedData()` - Fetch cached schedule
  - `updateCache()` - Update cached schedule
  - `saveToHistory()` - Log to history table

#### Telegram Operations (`src/telegram/`)
- **`api.ts`**:
  - `sendMessage()` - Send single message
  - `sendBulkMessages()` - Bulk send with rate limiting
  - `answerCallback()` - Acknowledge button click
  - `sendMessageWithKeyboard()` - Send message with inline keyboard

- **`handlers.ts`**:
  - `handleTelegramUpdate()` - Main update router
  - Command handlers: start, stop, now, test, broadcast
  - `handleCallbackQuery()` - Zone selection handler

- **`keyboards.ts`**:
  - `buildZoneKeyboard()` - Build zone selector (4 buttons per row)

#### Yasno Operations (`src/yasno/`)
- **`api.ts`**:
  - `fetchYasnoData()` - Fetch from API with browser headers
  - `fetchYasnoDataWithRetry()` - Fetch with automatic retry

- **`changes.ts`**:
  - `detectChangedZones()` - Compare fresh vs cached
  - Change detection and detailed logging

- **`formatter.ts`**:
  - `formatScheduleMessage()` - Complete message for zone
  - `formatDay()` - Format single day schedule
  - Time formatting utilities

#### Services (`src/services/`)
- **`scheduler.ts`**:
  - `checkScheduleUpdates()` - Main cron job orchestrator
  - `notifySubscribersOfChanges()` - Bulk notification with grouping

### Message Formatting

Schedule messages use a simple list format for each day (today and tomorrow):
- Date header with day of week and status indicator:
  - ✅ = Schedule confirmed (ScheduleApplies)
  - ⏳ = Schedule pending/waiting (WaitingForSchedule)
- 🔴 **Outages** section: Lists all outage periods with start-end times and durations, plus total outage time
- 🟢 **Power** section: Lists all power availability periods with start-end times and durations, plus total power time
- ⏱ **Updated timestamp**: Shows when the API last updated the schedule (from `updatedOn` field)

Example:
```
⚡️ Current Schedule
Zone: 1.1

📅 Today (21.11.2025, чт) ✅

🔴 Outages (10h total):
  • 04:00–08:00 (4h)
  • 14:30–20:30 (6h)
🟢 Power (14h total):
  • 00:00–04:00 (4h)
  • 08:00–14:30 (6h30m)
  • 20:30–24:00 (3h30m)

📅 Tomorrow (22.11.2025, пт) ⏳

🔴 Outages (8h total):
  • 06:00–14:00 (8h)
🟢 Power (16h total):
  • 00:00–06:00 (6h)
  • 14:00–24:00 (10h)

⏱ Updated: 21.11.2025, 20:29
```

### External Dependencies

- **Yasno API**: `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages`
  - Returns zone schedules (1.1, 1.2, 2.1, etc.) with today/tomorrow data
  - Each day has slots with start/end times (in minutes from midnight) and type (Definite=outage, NotPlanned=power on)
  - Includes `updatedOn` timestamp for reference
  - Uses browser-like headers to avoid WAF blocking

- **Telegram Bot API**: Standard bot methods via HTTPS
  - sendMessage (with Markdown support)
  - answerCallbackQuery
  - Inline keyboards for zone selection
  - Rate limit: 30 messages per second

- **Supabase**: PostgreSQL database with Row Level Security
  - All tables have RLS enabled (accessed via service role key)
  - See Database Schema section above for table details

### Environment Variables

Required in Cloudflare Workers secrets (not in code):
- `TELEGRAM_TOKEN`: Bot token from @BotFather
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase service role key

### Cron Configuration

Configured in `wrangler.jsonc`:
- Triggers: `*/10 * * * *` (every 10 minutes)
- Uses Cloudflare Workers cron triggers (not external cron)

### TypeScript Configuration

- Target: ES2021
- Module: ES2022 with Bundler resolution
- Strict mode enabled
- Worker types from `worker-configuration.d.ts` (auto-generated)
- Test files excluded from main compilation

## Development Guidelines

### Adding New Commands
1. Add handler in `src/telegram/handlers.ts`
2. Add to switch statement in `handleCommand()`
3. Import any needed utilities from other modules

### Adding New Database Operations
1. Add functions to appropriate module (`users.ts`, `subscriptions.ts`, or `cache.ts`)
2. Follow existing patterns (async/await, error handling)
3. Use Supabase client passed as parameter

### Modifying Schedule Detection
1. Update logic in `src/yasno/changes.ts`
2. Keep `compareScheduleData()` focused on data, not metadata
3. Update `getChangeDetails()` for better debugging logs

### Performance Optimization
- Use bulk operations where possible
- Group database queries to minimize round trips
- Use the grouping feature in `getAllSubscribersGroupedByZone()` for notifications
- Respect Telegram rate limits using `sendBulkMessages()`
