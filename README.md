# Yasno Power Outage Bot 🔌⚡

A Telegram bot that monitors Ukrainian power outage schedules from the Yasno API and sends automatic notifications when schedules change.

[![Deploy to Cloudflare Workers](https://github.com/jenkokov/yasno-bot/actions/workflows/deploy.yml/badge.svg)](https://github.com/jenkokov/yasno-bot/actions/workflows/deploy.yml)

## Features

- 🤖 **Telegram Bot Interface** - Easy zone subscription via inline keyboards
- ⚡ **Automatic Notifications** - Get notified when schedules change for your zone
- 🔄 **Real-time Updates** - Checks Yasno API every 5 minutes via cron
- 📊 **Smart Change Detection** - Uses timestamps to detect schedule updates reliably
- 🗄️ **Persistent Storage** - Supabase integration for subscribers and cache
- ☁️ **Serverless Deployment** - Runs on Cloudflare Workers
- 🔒 **Type-Safe** - Written in TypeScript with full type coverage

## Bot Commands

- `/start` - Subscribe to a power zone (initial setup)
- `/subscribe` - Change your subscribed zone
- `/now` - Get current schedule immediately
- `/stop` - Unsubscribe from updates

## Supported Zones

The bot supports all Yasno zones in Kyiv region:
- Zones 1.1, 1.2
- Zones 2.1, 2.2
- Zones 3.1, 3.2
- Zones 4.1, 4.2
- Zones 5.1, 5.2
- Zones 6.1, 6.2

## Message Format

Schedule messages show:
- 📅 Date with day of week and status (✅ confirmed or ⏳ pending)
- 🔴 Outages - all power outage periods with times and durations
- 🟢 Power - all power availability periods with times and durations
- ⏱ Last update timestamp from Yasno API

Example:
```
⚡️ Current Schedule
Zone: 1.1

📅 Today (21.11.2025, чт) ✅

🔴 Outages (7h30m total):
  • 00:00–00:30 (30m)
  • 07:00–11:30 (4h30m)
  • 17:30–21:30 (4h)
🟢 Power (16h30m total):
  • 00:30–07:00 (6h30m)
  • 11:30–17:30 (6h)
  • 21:30–24:00 (2h30m)

⏱ Updated: 21.11.2025, 16:55
```

## Architecture

### Technology Stack
- **Runtime**: Cloudflare Workers (V8 isolates)
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **CI/CD**: GitHub Actions
- **API**: Yasno public API

### How It Works

1. **User Subscription**: Users select their zone via Telegram bot
2. **Schedule Monitoring**: Cron job checks Yasno API every 5 minutes
3. **Change Detection**: Compares fresh data with cached data using timestamps
4. **Notifications**: Sends updates to all subscribers of changed zones
5. **Cache Update**: Stores latest schedule data in Supabase

### Code Organization

```
src/index.ts
├── Type Definitions       # TypeScript interfaces
├── Constants              # Configuration & messages
├── Worker Entry Points    # Fetch & scheduled handlers
├── Telegram Handling      # Command routing & handlers
├── Schedule Checking      # Change detection & notifications
├── Yasno API              # External API integration
├── Message Formatting     # Schedule display logic
└── Telegram API Helpers   # Bot communication
```

## Setup & Deployment

### Prerequisites

- Node.js 20+
- Cloudflare account
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Supabase account

### 1. Clone Repository

```bash
git clone https://github.com/jenkokov/yasno-bot.git
cd yasno-bot
npm install
```

### 2. Set Up Supabase

Create two tables in your Supabase project:

```sql
-- Subscribers table
CREATE TABLE subscribers (
  chat_id BIGINT PRIMARY KEY,
  zone TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Schedule cache table
CREATE TABLE schedule_cache (
  id INTEGER PRIMARY KEY DEFAULT 1,
  raw_data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize cache with empty data
INSERT INTO schedule_cache (id, raw_data) VALUES (1, '{}');
```

### 3. Configure Secrets

Create `.dev.vars` file for local development:

```bash
TELEGRAM_TOKEN=your_telegram_bot_token
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_key
```

For production (Cloudflare Workers):

```bash
npx wrangler secret put TELEGRAM_TOKEN
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

### 4. Set Up Telegram Webhook

After deploying, set your webhook URL:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://yasno-bot.YOUR_SUBDOMAIN.workers.dev"}'
```

### 5. Deploy

```bash
# Deploy to Cloudflare Workers
npm run deploy

# Or push to GitHub (automatic deployment via Actions)
git push origin master
```

## Development

```bash
# Start local development server
npm run dev

# Run tests
npm test

# Type check
npx tsc --noEmit

# Generate Cloudflare types
npm run cf-typegen
```

## GitHub Actions CI/CD

The repository includes two workflows:

- **Deploy** (`deploy.yml`) - Automatically deploys to Cloudflare Workers on push to master
- **Test** (`test.yml`) - Runs tests on pull requests and non-master branches

### Required Secrets

Set these in GitHub repository settings:
- `CLOUDFLARE_API_TOKEN` - API token with Workers edit permission
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

## Configuration

Edit `wrangler.jsonc` to customize:

```jsonc
{
  "name": "yasno-bot",                    // Worker name
  "compatibility_date": "2025-11-21",     // Cloudflare compatibility date
  "triggers": {
    "crons": ["*/5 * * * *"]              // Schedule check frequency
  }
}
```

## Project Structure

```
yasno-bot/
├── .github/
│   └── workflows/
│       ├── deploy.yml          # Deployment workflow
│       └── test.yml            # Testing workflow
├── src/
│   └── index.ts                # Main worker code
├── test/
│   └── index.spec.ts           # Tests
├── .gitignore                  # Git ignore rules
├── .env.example                # Environment variables template
├── CLAUDE.md                   # Development guide
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── vitest.config.mts           # Test config
├── wrangler.jsonc              # Cloudflare Workers config
└── README.md                   # This file
```

## API Reference

### Yasno API

The bot uses the public Yasno API:
```
https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages
```

Response structure:
```typescript
{
  "1.1": {
    "today": { slots: [...], date: "...", status: "..." },
    "tomorrow": { slots: [...], date: "...", status: "..." },
    "updatedOn": "2025-11-21T16:55:19+00:00"
  },
  // ... other zones
}
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Bot doesn't respond
- Check webhook is set correctly: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Verify worker is deployed: check Cloudflare Dashboard
- Check worker logs in Cloudflare Dashboard

### No schedule updates
- Verify cron trigger is enabled in `wrangler.jsonc`
- Check Cloudflare Workers logs for errors
- Ensure Supabase credentials are correct

### Database errors
- Verify Supabase tables exist with correct schema
- Check `SUPABASE_URL` and `SUPABASE_KEY` are set correctly
- Ensure service role key is used (not anon key)

## License

MIT License - see [LICENSE](LICENSE) file for details

---

**Made with ❤️ for Ukraine 🇺🇦**
