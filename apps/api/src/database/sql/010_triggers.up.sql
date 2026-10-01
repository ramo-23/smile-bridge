-- Audit log, note versions, claim history: no UPDATE or DELETE, ever.
CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable              BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER clinical_note_versions_immutable BEFORE UPDATE OR DELETE ON clinical_note_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER claim_status_history_immutable   BEFORE UPDATE OR DELETE ON claim_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Issued invoices cannot be changed or deleted (corrections use credit_notes).
-- One function per table: each reads columns that only exist on its own table.
CREATE FUNCTION forbid_issued_invoice_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION 'issued invoices are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION forbid_issued_invoice_change();

-- Lines of an issued invoice cannot be updated or deleted.
CREATE FUNCTION forbid_issued_invoice_line_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND status = 'issued') THEN
    RAISE EXCEPTION 'lines of an issued invoice are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_lines_immutable BEFORE UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_issued_invoice_line_change();

-- No new lines may be added to an issued invoice.
CREATE FUNCTION forbid_line_insert_on_issued_invoice() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND status = 'issued') THEN
    RAISE EXCEPTION 'cannot add lines to an issued invoice';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_lines_no_insert_after_issue BEFORE INSERT ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_line_insert_on_issued_invoice();