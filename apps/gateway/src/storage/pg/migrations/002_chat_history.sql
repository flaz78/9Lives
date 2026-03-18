-- 002_chat_history.sql
CREATE TABLE IF NOT EXISTS chat_history (
  id          BIGSERIAL PRIMARY KEY,
  live_id     TEXT NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  role        TEXT NOT NULL, -- 'user', 'assistant'
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(live_id, session_key, created_at);
