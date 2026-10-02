-- Gapless document numbering (one row per document series; locked FOR UPDATE at issue time).
CREATE TABLE document_counters (
  name       text PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

INSERT INTO document_counters (name, last_value) VALUES ('invoice', 0), ('credit_note', 0);

-- A plan item can produce at most one performed treatment.
ALTER TABLE performed_treatments
  ADD COLUMN plan_item_id uuid UNIQUE REFERENCES treatment_plan_items(id);

-- Payments and credit notes are append-only (corrections are new rows).
CREATE TRIGGER payments_immutable     BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER credit_notes_immutable BEFORE UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Fix: a draft line could be re-pointed at an issued invoice by UPDATE invoice_id,
-- because only OLD.invoice_id was checked. Check the target invoice as well.
CREATE OR REPLACE FUNCTION forbid_issued_invoice_line_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND status = 'issued') THEN
    RAISE EXCEPTION 'lines of an issued invoice are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.invoice_id <> OLD.invoice_id
     AND EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND status = 'issued') THEN
    RAISE EXCEPTION 'cannot add lines to an issued invoice';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
