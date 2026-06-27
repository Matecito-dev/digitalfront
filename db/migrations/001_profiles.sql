CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username            VARCHAR(20) NOT NULL,
  username_lower      VARCHAR(20) NOT NULL UNIQUE,
  captain_name        VARCHAR(20) NOT NULL,
  barbarians_killed   INT NOT NULL DEFAULT 0,
  explored_pct_max    REAL NOT NULL DEFAULT 0,
  play_time_ms        BIGINT NOT NULL DEFAULT 0,
  missions_completed  INT NOT NULL DEFAULT 0,
  composite_score     INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_composite ON profiles (composite_score DESC);
CREATE INDEX idx_profiles_kills ON profiles (barbarians_killed DESC);
