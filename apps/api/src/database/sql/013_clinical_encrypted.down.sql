ALTER TABLE tooth_records
  ALTER COLUMN note TYPE text USING NULL;

ALTER TABLE treatment_plan_items
  ALTER COLUMN description TYPE text USING NULL;