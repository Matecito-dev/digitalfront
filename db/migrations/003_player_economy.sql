-- Player economy: gold wallet and home outpost preference

ALTER TABLE player_world_state
  ADD COLUMN IF NOT EXISTS gold INT NOT NULL DEFAULT 0;

ALTER TABLE player_world_state
  ADD COLUMN IF NOT EXISTS home_outpost_id TEXT;
