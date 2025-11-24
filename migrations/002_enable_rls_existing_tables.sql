ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

ALTER TABLE schedule_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE subscribers IS 'Telegram bot subscribers. RLS enabled but no policies - accessed via service role key only.';
COMMENT ON TABLE schedule_cache IS 'Cached schedule data from Yasno API. RLS enabled but no policies - accessed via service role key only.';
