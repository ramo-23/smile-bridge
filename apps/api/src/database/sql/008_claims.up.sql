CREATE TABLE claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            uuid NOT NULL REFERENCES invoices(id),
  insurance_policy_id   uuid NOT NULL REFERENCES insurance_policies(id),
  status                claim_status NOT NULL DEFAULT 'draft',
  amount_claimed_cents  bigint NOT NULL CHECK (amount_claimed_cents >= 0),
  amount_paid_cents     bigint CHECK (amount_paid_cents >= 0),
  rejection_reason      text,
  submitted_at          timestamptz,
  resolved_at           timestamptz,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CHECK (status <> 'paid'     OR amount_paid_cents IS NOT NULL)
);
CREATE INDEX claims_by_status ON claims (status, submitted_at);

CREATE TABLE claim_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         uuid NOT NULL REFERENCES claims(id),
  invoice_line_id  uuid NOT NULL REFERENCES invoice_lines(id),
  procedure_code   text NOT NULL,
  amount_cents     bigint NOT NULL CHECK (amount_cents >= 0)
);

CREATE TABLE claim_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    uuid NOT NULL REFERENCES claims(id),
  from_status claim_status,
  to_status   claim_status NOT NULL,
  changed_by  uuid NOT NULL REFERENCES users(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);