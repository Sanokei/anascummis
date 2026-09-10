-- Roles, introduced with the Cloudflare Access gate.
--
-- Access decides who reaches the Worker at all. A role decides what they can
-- do once inside, which is a separate question: passing the Access policy is
-- not the same as being an administrator.
--
-- The super-admin role is granted from SUPER_ADMIN_EMAILS at first sign-in and
-- is never inferred from the email domain alone.

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';

-- One row per Access identity seen, so an admin can audit who got in without
-- that record being mistaken for conversation content.
CREATE TABLE access_identities (
  subject       TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  seen_count    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_access_email ON access_identities(email);
