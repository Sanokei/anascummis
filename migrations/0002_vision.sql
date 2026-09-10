-- Vision-first document memory.
--
-- Only an authenticated user gets a row here. A guest's page images live in
-- expiry-bound KV, so this table cannot become durable anonymous memory.

CREATE TABLE vision_pages (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  document_id   TEXT NOT NULL,
  page_number   INTEGER NOT NULL,
  object_key    TEXT NOT NULL,
  storage       TEXT NOT NULL CHECK (storage IN ('r2','kv')),
  mime_type     TEXT NOT NULL,
  byte_length   INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  -- What the vision model saw. Used for ranking, never returned as the answer.
  descriptor    TEXT NOT NULL,
  embedding     TEXT,
  origin        TEXT NOT NULL,
  stored_at     TEXT NOT NULL
);
CREATE INDEX idx_vision_user ON vision_pages(user_id, stored_at);
CREATE UNIQUE INDEX idx_vision_page ON vision_pages(user_id, document_id, page_number);

-- Box annotations produced against a stored page or an ad-hoc image.
-- Coordinates are normalised fractions, so they survive rescaling.
CREATE TABLE vision_annotations (
  id            TEXT PRIMARY KEY,
  page_id       TEXT REFERENCES vision_pages(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  box_x         REAL NOT NULL,
  box_y         REAL NOT NULL,
  box_w         REAL NOT NULL,
  box_h         REAL NOT NULL,
  -- The model's own stated confidence. Not a calibrated probability.
  stated_confidence REAL,
  parameters    TEXT NOT NULL DEFAULT '{}',
  model         TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_annotations_page ON vision_annotations(page_id);
CREATE INDEX idx_annotations_session ON vision_annotations(session_id, created_at);
