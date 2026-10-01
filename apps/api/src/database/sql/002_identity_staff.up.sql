CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  password_hash       text NOT NULL,
  full_name           text NOT NULL,
  role                user_role NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  failed_login_count  int NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES users(id),
  display_name  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE working_hours (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  uuid NOT NULL REFERENCES providers(id),
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  CHECK (end_time > start_time)
);  -- multiple rows per weekday allowed (e.g. lunch break)

CREATE TABLE blocked_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  uuid NOT NULL REFERENCES providers(id),
  during       tstzrange NOT NULL,
  reason       text,
  created_by   uuid NOT NULL REFERENCES users(id),
  CHECK (NOT isempty(during))
);