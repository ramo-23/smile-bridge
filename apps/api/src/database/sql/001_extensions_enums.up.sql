CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraint on uuid + range
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy patient search
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email


CREATE TYPE user_role          AS ENUM ('dentist_owner', 'receptionist');
CREATE TYPE appointment_status AS ENUM ('scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show');
CREATE TYPE appointment_source AS ENUM ('staff','patient_request','walk_in');
CREATE TYPE request_status     AS ENUM ('pending','scheduled','declined');
CREATE TYPE message_kind       AS ENUM ('confirmation','reminder','request_outcome');
CREATE TYPE message_channel    AS ENUM ('whatsapp','sms');
CREATE TYPE message_status     AS ENUM ('queued','sent','delivered','failed','cancelled');
CREATE TYPE tooth_surface      AS ENUM ('occlusal','mesial','distal','buccal','lingual');
CREATE TYPE tooth_record_type  AS ENUM ('finding','treatment');
CREATE TYPE plan_status        AS ENUM ('proposed','accepted','done','declined');
CREATE TYPE attachment_kind    AS ENUM ('xray','photo','other');
CREATE TYPE invoice_status     AS ENUM ('draft','issued');
CREATE TYPE payment_method     AS ENUM ('cash','card','insurance');
CREATE TYPE claim_status       AS ENUM ('draft','submitted','paid','rejected');
CREATE TYPE severity_level     AS ENUM ('mild','moderate','severe');