-- 003_llm_configs.sql
CREATE TABLE IF NOT EXISTS llm_configs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'openai', -- 'openai', 'anthropic', 'ollama', etc.
  base_url      TEXT,
  api_key_cipher TEXT, -- encrypted API key
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add llm_config_id to lives
ALTER TABLE lives ADD COLUMN IF NOT EXISTS llm_config_id TEXT REFERENCES llm_configs(id) ON DELETE SET NULL;
