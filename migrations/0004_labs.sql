-- Labs: make something, look at it, record what was wrong with it.
--
-- A round is kept whether its review passed or failed. The failed rounds are
-- the useful record, because they say what was wrong and what changed next.
--
-- `all_met` is stored as what a vision model said about a picture, not as a
-- test result. Nothing in the product gates a consequential action on it.

CREATE TABLE labs (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  -- Acceptance criteria, set when the lab opens. A lab without them would be
  -- asking the model whether it likes the picture.
  criteria      TEXT NOT NULL DEFAULT '[]',
  state         TEXT NOT NULL CHECK (state IN ('open','closed')),
  rounds        INTEGER NOT NULL DEFAULT 0,
  summary       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_labs_session ON labs(session_id, created_at);

CREATE TABLE lab_rounds (
  id            TEXT PRIMARY KEY,
  lab_id        TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  artifact_key  TEXT NOT NULL,
  artifact_storage TEXT NOT NULL CHECK (artifact_storage IN ('r2','kv')),
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('generated-image','rendered-page')),
  mime_type     TEXT NOT NULL,
  -- The model or page that produced it, so a record never implies the
  -- assistant drew the thing itself.
  produced_by   TEXT NOT NULL,
  input_summary TEXT NOT NULL DEFAULT '',
  content_hash  TEXT NOT NULL,
  findings      TEXT NOT NULL DEFAULT '[]',
  all_met       INTEGER NOT NULL DEFAULT 0,
  other_observations TEXT NOT NULL DEFAULT '[]',
  reviewed_by   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_lab_rounds ON lab_rounds(lab_id, created_at);
