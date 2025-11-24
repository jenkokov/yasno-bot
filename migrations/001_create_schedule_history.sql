CREATE TABLE IF NOT EXISTS schedule_history (
  id BIGSERIAL PRIMARY KEY,
  raw_data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_zones TEXT[],
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedule_history_fetched_at ON schedule_history (fetched_at DESC);


ALTER TABLE schedule_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE schedule_history IS 'Historical log of all Yasno API responses for debugging schedule changes. RLS enabled but no policies - accessed via service role key only.';
COMMENT ON COLUMN schedule_history.raw_data IS 'Complete JSON response from Yasno API';
COMMENT ON COLUMN schedule_history.fetched_at IS 'Timestamp when this data was fetched';
COMMENT ON COLUMN schedule_history.changed_zones IS 'Array of zones detected as changed at this fetch';
COMMENT ON COLUMN schedule_history.notes IS 'Optional notes about what triggered the change';
