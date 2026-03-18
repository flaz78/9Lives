CREATE TABLE IF NOT EXISTS crew_chat_history (
  id          BIGSERIAL PRIMARY KEY,
  crew_id     TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crew_chat_history_session
  ON crew_chat_history(crew_id, session_key, created_at);
