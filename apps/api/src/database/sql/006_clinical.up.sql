CREATE TABLE tooth_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id),
  tooth_number    smallint NOT NULL CHECK (tooth_number BETWEEN 1 AND 32),  -- Universal numbering
  surface         tooth_surface,                 -- NULL = whole tooth
  record_type     tooth_record_type NOT NULL,
  condition_code  text NOT NULL,                 -- e.g. 'caries','filling','crown','extracted'
  note            text,
  appointment_id  uuid REFERENCES appointments(id),
  recorded_by     uuid NOT NULL REFERENCES users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  void_reason     text,
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX tooth_records_chart ON tooth_records (patient_id, tooth_number, recorded_at DESC);

CREATE TABLE clinical_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id),
  appointment_id  uuid REFERENCES appointments(id),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinical_note_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     uuid NOT NULL REFERENCES clinical_notes(id),
  version_no  int NOT NULL CHECK (version_no >= 1),
  body        bytea NOT NULL,   -- ENC
  author_id   uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, version_no)
);

CREATE TABLE treatment_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES patients(id),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE treatment_plan_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id            uuid NOT NULL REFERENCES treatment_plans(id),
  treatment_type_id  uuid NOT NULL REFERENCES treatment_types(id),
  tooth_number       smallint CHECK (tooth_number BETWEEN 1 AND 32),
  description        text,
  price_cents        bigint NOT NULL CHECK (price_cents >= 0),
  priority           smallint NOT NULL DEFAULT 2,
  status             plan_status NOT NULL DEFAULT 'proposed'
);

CREATE TABLE attachments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  appointment_id     uuid REFERENCES appointments(id),
  kind               attachment_kind NOT NULL,
  original_filename  text NOT NULL,
  storage_key        text NOT NULL UNIQUE,     -- path or object key; never a public URL
  mime_type          text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  size_bytes         bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  sha256             text NOT NULL,
  note               text,
  uploaded_by        uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);