-- Complete database schema for Yasno Bot
-- This creates all required tables with proper indexes, constraints, and RLS

-- =============================================================================
-- USERS TABLE
-- =============================================================================
-- Stores all Telegram users who have interacted with the bot
-- Users are persisted even after unsubscribing

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_interaction_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users (chat_id);

COMMENT ON TABLE users IS 'All Telegram users who have interacted with the bot. RLS enabled but no policies - accessed via service role key only.';
COMMENT ON COLUMN users.chat_id IS 'Telegram chat ID (unique identifier for each user)';
COMMENT ON COLUMN users.last_interaction_at IS 'Timestamp of last user interaction with the bot';

-- =============================================================================
-- SUBSCRIPTIONS TABLE
-- =============================================================================
-- Stores active zone subscriptions
-- One subscription per user (enforced by UNIQUE constraint)

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone TEXT NOT NULL,
  subscribed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)  -- One active subscription per user
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_zone ON subscriptions (zone);

COMMENT ON TABLE subscriptions IS 'Active zone subscriptions. RLS enabled but no policies - accessed via service role key only.';
COMMENT ON COLUMN subscriptions.user_id IS 'Reference to user who owns this subscription';
COMMENT ON COLUMN subscriptions.zone IS 'Subscribed Yasno zone (e.g., 1.1, 2.1, etc.)';

-- =============================================================================
-- SCHEDULE CACHE TABLE
-- =============================================================================
-- Caches the latest Yasno API response
-- Single-row table (enforced by CHECK constraint)

CREATE TABLE IF NOT EXISTS schedule_cache (
  id INTEGER PRIMARY KEY DEFAULT 1,
  raw_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE schedule_cache ENABLE ROW LEVEL SECURITY;

-- Insert initial empty row
INSERT INTO schedule_cache (id, raw_data, updated_at)
VALUES (1, '{}'::jsonb, NOW())
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE schedule_cache IS 'Cached schedule data from Yasno API. RLS enabled but no policies - accessed via service role key only.';
COMMENT ON COLUMN schedule_cache.raw_data IS 'Complete JSON response from Yasno API';
COMMENT ON COLUMN schedule_cache.updated_at IS 'Timestamp of last cache update';

-- =============================================================================
-- SCHEDULE HISTORY TABLE
-- =============================================================================
-- Historical log of all Yasno API responses for debugging and auditing

CREATE TABLE IF NOT EXISTS schedule_history (
  id BIGSERIAL PRIMARY KEY,
  raw_data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_zones TEXT[],
  notes TEXT
);

ALTER TABLE schedule_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_schedule_history_fetched_at ON schedule_history (fetched_at DESC);

COMMENT ON TABLE schedule_history IS 'Historical log of all Yasno API responses for debugging schedule changes. RLS enabled but no policies - accessed via service role key only.';
COMMENT ON COLUMN schedule_history.raw_data IS 'Complete JSON response from Yasno API';
COMMENT ON COLUMN schedule_history.fetched_at IS 'Timestamp when this data was fetched';
COMMENT ON COLUMN schedule_history.changed_zones IS 'Array of zones detected as changed at this fetch';
COMMENT ON COLUMN schedule_history.notes IS 'Optional notes about what triggered the change';
