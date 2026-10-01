CREATE TABLE message_templates (
  key        text PRIMARY KEY,           -- e.g. 'confirmation', 'reminder_24h'
  channel    message_channel NOT NULL,
  body       text NOT NULL,              -- with {{placeholders}}
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id           uuid REFERENCES patients(id),
  appointment_id       uuid REFERENCES appointments(id),
  booking_request_id   uuid REFERENCES booking_requests(id),
  kind                 message_kind NOT NULL,
  channel              message_channel NOT NULL,
  to_phone_e164        text NOT NULL,
  body                 text NOT NULL,
  status               message_status NOT NULL DEFAULT 'queued',
  attempts             int NOT NULL DEFAULT 0 CHECK (attempts <= 3),
  scheduled_for        timestamptz NOT NULL,
  sent_at              timestamptz,
  provider_message_id  text,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_due ON messages (scheduled_for) WHERE status = 'queued';
-- At most one live reminder per appointment
CREATE UNIQUE INDEX messages_one_reminder ON messages (appointment_id)
  WHERE kind = 'reminder' AND status <> 'cancelled';