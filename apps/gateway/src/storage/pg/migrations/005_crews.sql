CREATE TABLE IF NOT EXISTS crews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    member_live_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    routing_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crews_channels ON crews USING GIN (channels);
