CREATE TABLE clinic_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),  -- single row
  clinic_name            text NOT NULL,
  address                text,
  phone_e164             text,
  timezone               text NOT NULL,
  currency_code          char(3) NOT NULL,
  buffer_minutes         int NOT NULL DEFAULT 10 CHECK (buffer_minutes >= 0),
  reminder_hours_before  int NOT NULL DEFAULT 24,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  user_id      uuid REFERENCES users(id),      -- NULL for public/system actions
  action       text NOT NULL,                  -- e.g. 'patient.view_clinical', 'appointment.cancel'
  entity_type  text NOT NULL,
  entity_id    uuid,
  patient_id   uuid,                           -- denormalised for "who looked at this patient"
  ip_address   inet,
  metadata     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_by_patient ON audit_log (patient_id, occurred_at DESC);
CREATE INDEX audit_by_user    ON audit_log (user_id, occurred_at DESC);