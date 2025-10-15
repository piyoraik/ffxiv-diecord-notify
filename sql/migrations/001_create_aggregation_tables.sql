BEGIN;

CREATE TABLE IF NOT EXISTS aggregation_windows (
  window_start    timestamptz PRIMARY KEY,
  window_end      timestamptz NOT NULL,
  status          text NOT NULL,
  attempt         integer NOT NULL DEFAULT 0,
  last_error      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combat_segments (
  segment_id        uuid PRIMARY KEY,
  window_start      timestamptz NOT NULL REFERENCES aggregation_windows(window_start),
  content           text NOT NULL,
  start_time        timestamptz NOT NULL,
  end_time          timestamptz,
  ordinal           integer NOT NULL,
  status            text NOT NULL,
  duration_ms       integer,
  presence_resolved boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segment_participants (
  segment_id  uuid NOT NULL REFERENCES combat_segments(segment_id),
  player_name text NOT NULL,
  job_code    text,
  role        text,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, player_name)
);

CREATE TABLE IF NOT EXISTS segment_player_stats (
  segment_id     uuid NOT NULL REFERENCES combat_segments(segment_id),
  player_name    text NOT NULL,
  total_damage   bigint NOT NULL,
  dps            numeric(12,2) NOT NULL,
  hits           integer NOT NULL,
  critical_hits  integer NOT NULL,
  direct_hits    integer NOT NULL,
  job_code       text,
  role           text,
  PRIMARY KEY (segment_id, player_name)
);

CREATE TABLE IF NOT EXISTS segment_roster_presence (
  segment_id    uuid NOT NULL REFERENCES combat_segments(segment_id),
  roster_id     uuid NOT NULL,
  player_name   text NOT NULL,
  matched_name  text,
  match_score   numeric(5,2),
  participated  boolean NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, roster_id)
);

CREATE TABLE IF NOT EXISTS segment_issues (
  segment_id uuid NOT NULL REFERENCES combat_segments(segment_id),
  issue_type text NOT NULL,
  detail     text,
  PRIMARY KEY (segment_id, issue_type)
);

CREATE INDEX IF NOT EXISTS idx_aggregation_windows_status
  ON aggregation_windows(status);

CREATE INDEX IF NOT EXISTS idx_combat_segments_window_start
  ON combat_segments(window_start);

CREATE INDEX IF NOT EXISTS idx_segment_participants_name
  ON segment_participants(player_name);

CREATE INDEX IF NOT EXISTS idx_segment_player_stats_dps
  ON segment_player_stats(segment_id, dps DESC);

CREATE INDEX IF NOT EXISTS idx_segment_roster_presence_roster
  ON segment_roster_presence(roster_id);

COMMIT;
