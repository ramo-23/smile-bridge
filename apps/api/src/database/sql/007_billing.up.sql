CREATE TABLE performed_treatments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id     uuid NOT NULL REFERENCES appointments(id),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  treatment_type_id  uuid NOT NULL REFERENCES treatment_types(id),
  tooth_number       smallint CHECK (tooth_number BETWEEN 1 AND 32),
  price_cents        bigint NOT NULL CHECK (price_cents >= 0),
  performed_at       timestamptz NOT NULL DEFAULT now(),
  performed_by       uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  text UNIQUE,                 -- assigned at issue, gapless sequence
  patient_id      uuid NOT NULL REFERENCES patients(id),
  status          invoice_status NOT NULL DEFAULT 'draft',
  issued_at       timestamptz,
  total_cents     bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (invoice_number IS NOT NULL AND issued_at IS NOT NULL))
);

CREATE TABLE invoice_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id             uuid NOT NULL REFERENCES invoices(id),
  performed_treatment_id uuid UNIQUE REFERENCES performed_treatments(id),
  description            text NOT NULL,
  procedure_code         text,
  tooth_number           smallint CHECK (tooth_number BETWEEN 1 AND 32),
  quantity               int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents       bigint NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents       bigint NOT NULL CHECK (line_total_cents = quantity * unit_price_cents)
);

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES invoices(id),
  method       payment_method NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_at      timestamptz NOT NULL DEFAULT now(),
  received_by  uuid NOT NULL REFERENCES users(id),
  reference    text
);

CREATE TABLE credit_notes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number text NOT NULL UNIQUE,
  invoice_id         uuid NOT NULL REFERENCES invoices(id),
  amount_cents       bigint NOT NULL CHECK (amount_cents > 0),
  reason             text NOT NULL,
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);