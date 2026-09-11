-- The design harness: author a picture as source, render it, measure it, and
-- record which criteria a host check settled and which a model only opined on.
--
-- A separate table from `labs` rather than a new `artifact_kind`, for two
-- reasons. The artifact of a design round is *source text* — SVG or a scene
-- program — not an image, and the image is a derived measurement of it. And the
-- verdicts here are a different shape: each one records its own basis, so a
-- reader can tell a checked claim from an opinion after the fact.
--
-- `all_verified` is deliberately not named `all_met`. It is true only when every
-- criterion was settled met by a host check against the source or the pixels,
-- and the criteria settled by a vision model are counted separately so a caller
-- cannot quietly fold the two together.

CREATE TABLE design_labs (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  surface       TEXT NOT NULL CHECK (surface IN ('vector','scene')),
  criteria      TEXT NOT NULL DEFAULT '[]',
  state         TEXT NOT NULL CHECK (state IN ('open','closed')),
  rounds        INTEGER NOT NULL DEFAULT 0,
  summary       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_design_labs_session ON design_labs(session_id, created_at);

CREATE TABLE design_revisions (
  id            TEXT PRIMARY KEY,
  lab_id        TEXT NOT NULL REFERENCES design_labs(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  surface       TEXT NOT NULL CHECK (surface IN ('vector','scene')),
  -- The artifact. Kept verbatim so a revision can be re-measured later against
  -- a changed checker without having to trust the verdicts recorded here.
  source        TEXT NOT NULL,
  source_hash   TEXT NOT NULL,
  -- Where the rendered bytes live, one PNG per view. Null when nothing could be
  -- rendered, which is recorded rather than hidden: an unrendered revision has
  -- no pixel evidence and its pixel criteria are unverifiable, not met.
  render_key    TEXT,
  render_storage TEXT CHECK (render_storage IN ('r2','kv')),
  views         TEXT NOT NULL DEFAULT '[]',
  -- The per-criterion verdicts, each carrying its own basis.
  verdicts      TEXT NOT NULL DEFAULT '[]',
  -- True only when every criterion was settled met by a host check.
  all_verified  INTEGER NOT NULL DEFAULT 0,
  counts        TEXT NOT NULL DEFAULT '{}',
  -- Criteria no host check could compile, kept so the refusal is visible even
  -- after the session that wrote them has gone.
  refused       TEXT NOT NULL DEFAULT '[]',
  issues        TEXT NOT NULL DEFAULT '[]',
  other_observations TEXT NOT NULL DEFAULT '[]',
  reviewed_by   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_design_revisions ON design_revisions(lab_id, created_at);
