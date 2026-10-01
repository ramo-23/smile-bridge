CREATE TABLE patients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_number  bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  date_of_birth   date NOT NULL CHECK (date_of_birth <= current_date),
  sex             text,
  phone_e164      text NOT NULL,
  email           citext,
  address         text,
  guardian_name   text,          -- required by the API when under 18
  guardian_phone  text,
  do_not_message  boolean NOT NULL DEFAULT false,
  archived_at     timestamptz,
  merged_into_id  uuid REFERENCES patients(id),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_name_trgm ON patients
  USING gin ((lower(first_name || ' ' || last_name)) gin_trgm_ops);
CREATE INDEX patients_phone     ON patients (phone_e164);
CREATE INDEX patients_dup_check ON patients (lower(last_name), lower(first_name), date_of_birth);

CREATE TABLE next_of_kin (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id),
  full_name     text NOT NULL,
  relationship  text NOT NULL,
  phone_e164    text NOT NULL,
  is_emergency_contact boolean NOT NULL DEFAULT true
);

CREATE TABLE medical_histories (
  patient_id    uuid PRIMARY KEY REFERENCES patients(id),
  conditions    bytea,   -- ENC
  medications   bytea,   -- ENC
  notes         bytea,   -- ENC
  confirmed_at  timestamptz,           -- NULL = "profile incomplete" warning shown to dentist
  confirmed_by  uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE allergies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES patients(id),
  substance   text NOT NULL,
  reaction    text,
  severity    severity_level NOT NULL,
  resolved_at timestamptz
);

CREATE TABLE insurance_policies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL REFERENCES patients(id),
  insurer_name          text NOT NULL,
  policy_number         text NOT NULL,
  principal_member_name text NOT NULL,
  plan_name             text,
  is_active             boolean NOT NULL DEFAULT true
);