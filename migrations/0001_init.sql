-- Records that outlive a single table: who played, which tables, final bill sheets.
-- Live game state stays in each table's Durable Object.

CREATE TABLE users (
  id TEXT PRIMARY KEY,            -- "g:<google sub>" or "guest:<uuid>"
  name TEXT NOT NULL,
  avatar TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE tables (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL,           -- waiting | running | ended
  currency TEXT NOT NULL,
  token_value REAL NOT NULL,
  small_blind INTEGER NOT NULL,
  big_blind INTEGER NOT NULL,
  hands INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE table_players (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
CREATE INDEX idx_table_players_user ON table_players (user_id, joined_at DESC);

-- one row per player per finished session: the final bill sheet
CREATE TABLE results (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  bought_in INTEGER NOT NULL,
  lent INTEGER NOT NULL,
  borrowed INTEGER NOT NULL,
  final_stack INTEGER NOT NULL,
  net_chips INTEGER NOT NULL,
  net_money REAL NOT NULL,
  currency TEXT NOT NULL,
  ended_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
CREATE INDEX idx_results_user ON results (user_id);
