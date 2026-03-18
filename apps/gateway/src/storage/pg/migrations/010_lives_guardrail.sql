-- Add guardrail JSONB column to lives table for per-agent safety constraints
ALTER TABLE lives ADD COLUMN IF NOT EXISTS guardrail JSONB DEFAULT NULL;
