CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  token_hash    text NOT NULL UNIQUE,          -- SHA-256 of the cookie token; raw token is never stored
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,          -- absolute limit
  revoked_at    timestamptz,
  ip_address    inet,
  user_agent    text
);
CREATE INDEX sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;