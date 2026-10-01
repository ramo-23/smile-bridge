DO $$
DECLARE
  target_table record;
BEGIN
  FOR target_table IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name = 'updated_at'
      AND table_schema = current_schema()
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I.%I',
      target_table.table_schema,
      target_table.table_name
    );
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS set_updated_at();