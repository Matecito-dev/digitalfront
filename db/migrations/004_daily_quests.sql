ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_quest_day DATE,
  ADD COLUMN IF NOT EXISTS daily_quests JSONB NOT NULL DEFAULT '[]'::jsonb;
