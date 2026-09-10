-- Anascummis durable schema.
--
-- Two hard boundaries are encoded here:
--   1. Durable conversation content and memory hang off `users`. A guest has no
--      row, so there is no place to write long-term guest memory.
--   2. Correctness records (action receipts, capability installs, consent) are
--      separate from optional memory, because they may block dispatch even when
--      memory is disabled.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT,
  display_name  TEXT,
  created_at    TEXT NOT NULL,
  memory_enabled INTEGER NOT NULL DEFAULT 0,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;

-- One row per linked social identity. Linking is deliberate, never implicit.
CREATE TABLE identities (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  provider_uid  TEXT NOT NULL,
  email         TEXT,
  linked_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_identity_provider_uid ON identities(provider, provider_uid);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  csrf_secret   TEXT NOT NULL,
  user_agent_hash TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

-- Short-lived OAuth handshake state: nonce, PKCE verifier, redirect target.
CREATE TABLE oauth_flows (
  state         TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_to   TEXT NOT NULL,
  link_user_id  TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

-- Third-party resource authorisation, kept apart from application login.
CREATE TABLE service_connections (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service       TEXT NOT NULL,
  account_label TEXT,
  account_ref   TEXT,
  scopes        TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  token_iv      TEXT NOT NULL,
  connected_at  TEXT NOT NULL,
  revoked_at    TEXT,
  deploy_authorised INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_service_conn ON service_connections(user_id, service);

CREATE TABLE global_config (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  document      TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Immutable checkpoint DAG. One active HEAD per session is held by the
-- Durable Object; this table is the durable record for authenticated users.
CREATE TABLE checkpoints (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  parent_id     TEXT,
  story_id      TEXT NOT NULL,
  story_version TEXT NOT NULL,
  -- Full runtime snapshot, or a delta whose base is `snapshot_base_id`.
  runtime_state TEXT NOT NULL,
  snapshot_kind TEXT NOT NULL CHECK (snapshot_kind IN ('full','delta')),
  snapshot_base_id TEXT,
  continuation  TEXT,
  context_revision TEXT NOT NULL,
  active_skills TEXT NOT NULL DEFAULT '[]',
  label         TEXT,
  summary       TEXT,
  branch_state  TEXT NOT NULL DEFAULT 'current'
                  CHECK (branch_state IN ('current','inactive','archived','pinned')),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_checkpoint_session ON checkpoints(session_id, created_at);
CREATE INDEX idx_checkpoint_parent ON checkpoints(parent_id);

CREATE TABLE turns (
  id            TEXT PRIMARY KEY,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  role          TEXT NOT NULL,
  text          TEXT NOT NULL,
  raw_transcript TEXT,
  authored_line_id TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_turns_session ON turns(session_id, created_at);

-- Layered context. `memory_index` routes; `memory_files` hold the detail.
CREATE TABLE memory_files (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL CHECK (scope IN ('user','project','topic')),
  path          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 1,
  origin        TEXT NOT NULL CHECK (origin IN ('authored','learned')),
  confirmed     INTEGER NOT NULL DEFAULT 0,
  superseded_by TEXT,
  source_refs   TEXT NOT NULL DEFAULT '[]',
  branch_id     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_memory_path ON memory_files(user_id, path, revision);

CREATE TABLE memory_index (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  memory_id     TEXT NOT NULL REFERENCES memory_files(id) ON DELETE CASCADE,
  weight        REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (user_id, key, memory_id)
);

-- Registry. Installed versions are immutable; revocation is a separate column
-- so historic validation cannot resurrect a revoked version.
CREATE TABLE capabilities (
  id            TEXT NOT NULL,
  version       TEXT NOT NULL,
  owner         TEXT NOT NULL,
  workspace_scope TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('native','lua')),
  source_hash   TEXT NOT NULL,
  source        TEXT,
  contract      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('installed','draft','revoked')),
  validation    TEXT NOT NULL,
  installed_at  TEXT NOT NULL,
  revoked_at    TEXT,
  PRIMARY KEY (id, version)
);
CREATE INDEX idx_cap_status ON capabilities(status);

CREATE TABLE capability_grants (
  session_id    TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  permission    TEXT NOT NULL,
  granted_at    TEXT NOT NULL,
  expires_at    TEXT,
  PRIMARY KEY (session_id, capability_id, permission)
);

-- Intent is written before dispatch; outcome afterwards. A missing outcome is
-- reported as unknown and requires reconciliation before a retry.
CREATE TABLE action_receipts (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  user_id       TEXT,
  capability_id TEXT NOT NULL,
  capability_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  generation    INTEGER NOT NULL,
  intent_at     TEXT NOT NULL,
  outcome       TEXT NOT NULL
                  CHECK (outcome IN ('pending','completed','failed','cancelled','unknown')),
  outcome_at    TEXT,
  summary       TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_receipt_idem ON action_receipts(capability_id, idempotency_key);
CREATE INDEX idx_receipt_session ON action_receipts(session_id, intent_at);

CREATE TABLE skill_catalog (
  qualified_name TEXT NOT NULL,
  revision      TEXT NOT NULL,
  origin        TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  license       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  invocation    TEXT NOT NULL CHECK (invocation IN ('automatic','explicit-only','disabled')),
  tool_permissions TEXT NOT NULL DEFAULT '[]',
  dependencies  TEXT NOT NULL DEFAULT '[]',
  trust         TEXT NOT NULL CHECK (trust IN ('bundled','vetted','staged','revoked')),
  body          TEXT NOT NULL,
  resources     TEXT NOT NULL DEFAULT '{}',
  staged_at     TEXT NOT NULL,
  PRIMARY KEY (qualified_name, revision)
);
CREATE INDEX idx_skill_trust ON skill_catalog(trust);

CREATE TABLE skill_runs (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  user_id       TEXT,
  qualified_name TEXT NOT NULL,
  revision      TEXT NOT NULL,
  origin        TEXT NOT NULL,
  task          TEXT NOT NULL,
  capability_versions TEXT NOT NULL DEFAULT '[]',
  permissions   TEXT NOT NULL DEFAULT '[]',
  outcome       TEXT NOT NULL,
  reason        TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_skill_runs_session ON skill_runs(session_id, created_at);

CREATE TABLE stories (
  id            TEXT NOT NULL,
  version       TEXT NOT NULL,
  source        TEXT NOT NULL,
  compiled      TEXT NOT NULL,
  source_hash   TEXT NOT NULL,
  entry_points  TEXT NOT NULL DEFAULT '[]',
  action_refs   TEXT NOT NULL DEFAULT '[]',
  validation    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('published','draft','rejected')),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

-- Consent is stored minimally and never used to fingerprint a guest.
CREATE TABLE consent_records (
  subject_id    TEXT PRIMARY KEY,
  analytics     INTEGER NOT NULL DEFAULT 0,
  policy_version TEXT NOT NULL,
  decided_at    TEXT NOT NULL
);

CREATE TABLE job_records (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,
  label         TEXT NOT NULL,
  state         TEXT NOT NULL,
  speculative   INTEGER NOT NULL DEFAULT 0,
  generation    INTEGER NOT NULL,
  branch_id     TEXT,
  detail        TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX idx_jobs_session ON job_records(session_id, started_at);
