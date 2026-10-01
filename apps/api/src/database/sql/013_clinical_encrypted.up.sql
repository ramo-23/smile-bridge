ALTER TABLE tooth_records
  ALTER COLUMN note TYPE bytea USING NULL;

ALTER TABLE treatment_plan_items
  ALTER COLUMN description TYPE bytea USING NULL;