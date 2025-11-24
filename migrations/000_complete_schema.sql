CREATE TABLE IF NOT EXISTS subscribers (
  chat_id BIGINT PRIMARY KEY,
  zone TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;


CREATE INDEX IF NOT EXISTS idx_subscribers_zone ON subscribers (zone);

COMMENT ON TABLE subscribers IS 'Telegram bot subscribers. RLS enabled but no policies - accessed via service role key only.';
COMMENT ON COLUMN subscribers.chat_id IS 'Telegram chat ID (unique identifier for each user)';
COMMENT ON COLUMN subscribers.zone IS 'Subscribed Yasno zone (e.g., 1.1, 2.1, etc.)';


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

