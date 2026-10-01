CREATE TABLE treatment_types (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL UNIQUE,
  procedure_code            text,
  default_duration_minutes  int NOT NULL CHECK (default_duration_minutes > 0),
  default_price_cents       bigint NOT NULL CHECK (default_price_cents >= 0),
  patient_bookable          boolean NOT NULL DEFAULT false,
  is_active                 boolean NOT NULL DEFAULT true
);

CREATE TABLE booking_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           text NOT NULL,
  phone_e164          text NOT NULL,
  date_of_birth       date NOT NULL,
  preferred_date      date NOT NULL,
  preferred_time      time NOT NULL,
  treatment_type_id   uuid NOT NULL REFERENCES treatment_types(id),
  note                text,
  status              request_status NOT NULL DEFAULT 'pending',
  matched_patient_id  uuid REFERENCES patients(id),
  decline_reason      text,
  handled_by          uuid REFERENCES users(id),
  handled_at          timestamptz,
  submitter_ip_hash   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'declined' OR decline_reason IS NOT NULL)
);
CREATE INDEX booking_requests_queue ON booking_requests (status, created_at);

CREATE TABLE appointments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  provider_id        uuid NOT NULL REFERENCES providers(id),
  treatment_type_id  uuid NOT NULL REFERENCES treatment_types(id),
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  blocked_until      timestamptz NOT NULL,   -- ends_at + buffer, set by the API
  status             appointment_status NOT NULL DEFAULT 'scheduled',
  source             appointment_source NOT NULL,
  booking_request_id uuid UNIQUE REFERENCES booking_requests(id),
  duration_override_reason text,
  cancel_reason      text,
  notes              text,
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (blocked_until >= ends_at)
);

-- The key rule: a provider can never have two live appointments overlapping
-- (including the cleanup buffer). Enforced by the database, so two receptionists
-- clicking at once cannot both succeed.
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(starts_at, blocked_until) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'));

CREATE INDEX appointments_calendar ON appointments (provider_id, starts_at);
CREATE INDEX appointments_patient  ON appointments (patient_id, starts_at DESC);