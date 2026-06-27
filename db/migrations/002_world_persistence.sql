-- Tier C world persistence: sim checkpoints, events, player state, chronicle

CREATE TABLE worlds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed            TEXT NOT NULL,
  shard_id        TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  sim_time_ms     BIGINT NOT NULL DEFAULT 0,
  season          TEXT NOT NULL DEFAULT 'SPRING',
  phase           TEXT NOT NULL DEFAULT 'EARLY',
  last_tick_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seed, shard_id)
);

CREATE TABLE world_checkpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  sim_time_ms     BIGINT NOT NULL,
  state_json      JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_world_checkpoints_world_time
  ON world_checkpoints (world_id, sim_time_ms DESC);

CREATE TABLE world_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id            UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  sim_time_ms         BIGINT NOT NULL,
  tick_seq            BIGINT NOT NULL DEFAULT 0,
  event_type          TEXT NOT NULL,
  weight              SMALLINT NOT NULL DEFAULT 0,
  payload             JSONB NOT NULL DEFAULT '{}',
  actor_profile_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_world_events_world_time
  ON world_events (world_id, sim_time_ms DESC);
CREATE INDEX idx_world_events_world_weight
  ON world_events (world_id, weight DESC);

CREATE TABLE player_world_state (
  world_id          UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  squad_json        JSONB,
  fog_blob          BYTEA,
  last_x            REAL,
  last_y            REAL,
  disconnected_at   TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, profile_id)
);

CREATE INDEX idx_player_world_state_profile
  ON player_world_state (profile_id, updated_at DESC);

CREATE TABLE world_chronicle (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  event_id        UUID REFERENCES world_events(id) ON DELETE SET NULL,
  headline        TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  weight          SMALLINT NOT NULL DEFAULT 0,
  is_public       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_world_chronicle_world_time
  ON world_chronicle (world_id, created_at DESC);
CREATE INDEX idx_world_chronicle_world_weight
  ON world_chronicle (world_id, weight DESC);

CREATE TABLE player_chronicle (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id        UUID REFERENCES world_events(id) ON DELETE SET NULL,
  headline        TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_player_chronicle_profile_time
  ON player_chronicle (profile_id, created_at DESC);

-- Optional: mechanical world marks (Fase 6.6)
CREATE TABLE world_marks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id                UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  mark_type               TEXT NOT NULL,
  x                       REAL NOT NULL,
  y                       REAL NOT NULL,
  radius                  REAL NOT NULL DEFAULT 0,
  expires_sim_ms          BIGINT,
  caused_by_profile_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_world_marks_world_expires
  ON world_marks (world_id, expires_sim_ms);
