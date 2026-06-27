-- PvP ranking columns (separate ladder from PvE composite score)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pvp_kills INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pvp_deaths INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pvp_elo INT NOT NULL DEFAULT 1000;

CREATE INDEX IF NOT EXISTS idx_profiles_pvp_elo ON profiles (pvp_elo DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_pvp_kills ON profiles (pvp_kills DESC);
