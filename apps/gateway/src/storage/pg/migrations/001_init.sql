-- 001_init.sql — 9Lives.ai schema

CREATE TABLE IF NOT EXISTS lives (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  file_path     TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  model_provider TEXT NOT NULL DEFAULT 'openai',
  model_name    TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  channels      JSONB NOT NULL DEFAULT '[]',
  skills        JSONB NOT NULL DEFAULT '[]',
  routing_default BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connectors (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  config     JSONB NOT NULL DEFAULT '{}',
  enabled    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS secrets (
  key        TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id            SERIAL PRIMARY KEY,
  provider      TEXT NOT NULL,
  email         TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  live_id     TEXT NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  cron_expr   TEXT NOT NULL,
  prompt      TEXT NOT NULL DEFAULT '',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT,
  action     TEXT NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
