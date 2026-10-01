ALTER TABLE IF EXISTS appointments
	DROP CONSTRAINT IF EXISTS appointments_no_overlap;

DROP INDEX IF EXISTS appointments_patient;
DROP INDEX IF EXISTS appointments_calendar;
DROP INDEX IF EXISTS booking_requests_queue;

DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS booking_requests;
DROP TABLE IF EXISTS treatment_types;