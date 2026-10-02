CREATE OR REPLACE FUNCTION forbid_issued_invoice_line_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND status = 'issued') THEN
    RAISE EXCEPTION 'lines of an issued invoice are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS credit_notes_immutable ON credit_notes;
DROP TRIGGER IF EXISTS payments_immutable ON payments;

ALTER TABLE performed_treatments DROP COLUMN plan_item_id;

DROP TABLE document_counters;
