-- Migration: Separate users from subscriptions
-- This migration separates user data from active subscriptions
-- Users retain their chat_id even after unsubscribing

-- Step 1: Create new users table
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

-- Step 2: Create new subscriptions table
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

-- Step 3: Migrate existing data from old subscribers table
-- Insert users from existing subscribers
INSERT INTO users (chat_id, created_at)
SELECT chat_id, created_at
FROM subscribers
ON CONFLICT (chat_id) DO NOTHING;

-- Insert subscriptions linking to the new users
INSERT INTO subscriptions (user_id, zone, subscribed_at)
SELECT u.id, s.zone, s.created_at
FROM subscribers s
JOIN users u ON u.chat_id = s.chat_id
ON CONFLICT (user_id) DO NOTHING;

-- Step 4: Rename old table for backup (don't drop yet, keep for safety)
ALTER TABLE subscribers RENAME TO subscribers_backup;

COMMENT ON TABLE subscribers_backup IS 'Backup of old subscribers table before migration. Can be dropped after verification.';

-- Step 5: Create view for backward compatibility during transition
CREATE OR REPLACE VIEW subscribers AS
SELECT
  u.chat_id,
  s.zone,
  s.subscribed_at as created_at
FROM subscriptions s
JOIN users u ON u.id = s.user_id;

COMMENT ON VIEW subscribers IS 'Compatibility view that mimics old subscribers table structure. Maps to new users + subscriptions tables.';
