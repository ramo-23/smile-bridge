DROP TRIGGER IF EXISTS invoice_lines_no_insert_after_issue ON invoice_lines;
DROP TRIGGER IF EXISTS invoice_lines_immutable ON invoice_lines;
DROP TRIGGER IF EXISTS invoices_immutable ON invoices;
DROP TRIGGER IF EXISTS claim_status_history_immutable ON claim_status_history;
DROP TRIGGER IF EXISTS clinical_note_versions_immutable ON clinical_note_versions;
DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;

DROP FUNCTION IF EXISTS forbid_line_insert_on_issued_invoice();
DROP FUNCTION IF EXISTS forbid_issued_invoice_line_change();
DROP FUNCTION IF EXISTS forbid_issued_invoice_change();
DROP FUNCTION IF EXISTS forbid_change();