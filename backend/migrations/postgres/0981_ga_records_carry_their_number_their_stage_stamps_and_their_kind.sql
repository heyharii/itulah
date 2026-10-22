-- 0981: GA records carry their number, their stage stamps and their kind.
--
-- The 18 Oct GA tidy of the hub drew what the owner's prototypes show, and
-- found the database could not answer five of the questions those screens
-- ask. This migration is the stored half of the answers; the rest are reads.
--
-- # A supply request and a repair have a number (SR-, RPR-)
--
-- People say "SR-191026-002", not a uuid. The day, then a three-digit serial
-- that restarts each day — the owner's PO format (PO-DDMMYY-NNN, 26 Sep 2026)
-- with the record's own prefix. The day is Jakarta's day of `created_at`, so
-- the number and the "Created" date can never disagree. Numbers are the
-- database's to give, in a trigger, so whatever inserts the row gets one: a
-- binary from before this migration, still serving during a rollout, as much
-- as the new one (the same reason 0969 gives). Rows that exist are numbered in
-- the order they were made. A thousandth record in one day widens the serial
-- rather than failing.
--
-- # A repair keeps who moved it and when
--
-- The writer used to append "APPROVED -> IN_PROGRESS oleh rina (2026-10-13)"
-- to the repair's notes, and the hub read who and when back out of the audit
-- log by counting POSTs to /move. Each stage now has its own stamp: started,
-- completed (`completed_at` stays the DAY the work was done, which GA may
-- correct; `completed_by` is who said so), closed and cancelled. The existing
-- sentences are read once into the stamps — the time from the audit log's nth
-- successful move when it has one, noon of the written day when it has not —
-- and then taken out of the notes, keeping whatever the person wrote after
-- the colon.
--
-- # A supplier has a kind
--
-- "What do we buy from them": Utilities, Cleaning, Workshop, AC, Logistics,
-- Office, Landlord or Other. The account a supplier's bills debit is the
-- usual answer, so `supplier_kind_account` maps the client's chart onto the
-- kinds and every non-merchandise supplier is given the kind of its account
-- (Other when the account is not one of them). From here the column is the
-- fact: a person may set it, and a supplier written without one takes its
-- account's. A merchandise supplier has none — its bills debit stock.

-- ---------------------------------------------------------------------------
-- Supply request number
-- ---------------------------------------------------------------------------

ALTER TABLE ga_supply_request ADD COLUMN request_number text;

UPDATE ga_supply_request AS q
   SET request_number = numbered.number
  FROM (
      SELECT request_id,
             'SR-' || to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'DDMMYY') || '-' ||
             lpad(n::text, GREATEST(3, length(n::text)), '0') AS number
        FROM (
            SELECT request_id, created_at,
                   row_number() OVER (
                       PARTITION BY (created_at AT TIME ZONE 'Asia/Jakarta')::date
                       ORDER BY created_at, request_id
                   ) AS n
              FROM ga_supply_request
        ) AS ordered
  ) AS numbered
 WHERE q.request_id = numbered.request_id;

ALTER TABLE ga_supply_request ALTER COLUMN request_number SET NOT NULL;
ALTER TABLE ga_supply_request
    ADD CONSTRAINT ga_supply_request_number_key UNIQUE (request_number);

CREATE FUNCTION ga_supply_request_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    stamp text := 'SR-' || to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Jakarta', 'DDMMYY') || '-';
    serial integer;
BEGIN
    IF NEW.request_number IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('ga_supply_request.request_number'));
        SELECT COALESCE(max(substring(request_number FROM length(stamp) + 1)::integer), 0) + 1
          INTO serial
          FROM ga_supply_request
         WHERE request_number LIKE stamp || '%'
           AND substring(request_number FROM length(stamp) + 1) ~ '^[0-9]+$';
        NEW.request_number := stamp || lpad(serial::text, GREATEST(3, length(serial::text)), '0');
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER ga_supply_request_number
    BEFORE INSERT ON ga_supply_request
    FOR EACH ROW EXECUTE FUNCTION ga_supply_request_number();

-- ---------------------------------------------------------------------------
-- Repair number
-- ---------------------------------------------------------------------------

ALTER TABLE ga_repair ADD COLUMN repair_number text;

UPDATE ga_repair AS r
   SET repair_number = numbered.number
  FROM (
      SELECT repair_id,
             'RPR-' || to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'DDMMYY') || '-' ||
             lpad(n::text, GREATEST(3, length(n::text)), '0') AS number
        FROM (
            SELECT repair_id, created_at,
                   row_number() OVER (
                       PARTITION BY (created_at AT TIME ZONE 'Asia/Jakarta')::date
                       ORDER BY created_at, repair_id
                   ) AS n
              FROM ga_repair
        ) AS ordered
  ) AS numbered
 WHERE r.repair_id = numbered.repair_id;

ALTER TABLE ga_repair ALTER COLUMN repair_number SET NOT NULL;
ALTER TABLE ga_repair ADD CONSTRAINT ga_repair_number_key UNIQUE (repair_number);

CREATE FUNCTION ga_repair_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    stamp text := 'RPR-' || to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Jakarta', 'DDMMYY') || '-';
    serial integer;
BEGIN
    IF NEW.repair_number IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('ga_repair.repair_number'));
        SELECT COALESCE(max(substring(repair_number FROM length(stamp) + 1)::integer), 0) + 1
          INTO serial
          FROM ga_repair
         WHERE repair_number LIKE stamp || '%'
           AND substring(repair_number FROM length(stamp) + 1) ~ '^[0-9]+$';
        NEW.repair_number := stamp || lpad(serial::text, GREATEST(3, length(serial::text)), '0');
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER ga_repair_number
    BEFORE INSERT ON ga_repair
    FOR EACH ROW EXECUTE FUNCTION ga_repair_number();

-- ---------------------------------------------------------------------------
-- Repair stage stamps
-- ---------------------------------------------------------------------------

ALTER TABLE ga_repair
    ADD COLUMN started_at   timestamptz,
    ADD COLUMN started_by   text,
    ADD COLUMN completed_by text,
    ADD COLUMN closed_at    timestamptz,
    ADD COLUMN closed_by    text,
    ADD COLUMN cancelled_at timestamptz,
    ADD COLUMN cancelled_by text;

-- The sentences the old writer appended, read once into the stamps. The nth
-- sentence is the nth successful POST to the repair's /move, as the hub read
-- them; a move the audit log does not have is placed at noon of its day.
WITH moves AS (
    SELECT r.repair_id, m.part[1] AS to_status, m.part[2] AS actor,
           m.part[3]::date AS day, m.n
      FROM ga_repair r
     CROSS JOIN LATERAL regexp_matches(
               r.notes, '[A-Z_]+ -> ([A-Z_]+) oleh (\S+) \((\d{4}-\d{2}-\d{2})\)', 'g'
           ) WITH ORDINALITY AS m(part, n)
     WHERE r.notes IS NOT NULL
), logged AS (
    SELECT a.subject_id, a.at,
           row_number() OVER (PARTITION BY a.subject_id ORDER BY a.at, a.audit_id) AS n
      FROM audit_log a
     WHERE a.subject_kind = 'repair'
       AND a.method = 'POST'
       AND a.path LIKE '%/move'
       AND a.status < 400
), stamped AS (
    SELECT m.repair_id, m.to_status, m.actor,
           COALESCE(l.at, (m.day + time '12:00') AT TIME ZONE 'Asia/Jakarta') AS at
      FROM moves m
      LEFT JOIN logged l ON l.subject_id = m.repair_id::text AND l.n = m.n
), last_of AS (
    SELECT DISTINCT ON (repair_id, to_status) repair_id, to_status, actor, at
      FROM stamped
     ORDER BY repair_id, to_status, at DESC
)
UPDATE ga_repair r
   SET started_at   = (SELECT at FROM last_of x WHERE x.repair_id = r.repair_id AND x.to_status = 'IN_PROGRESS'),
       started_by   = (SELECT actor FROM last_of x WHERE x.repair_id = r.repair_id AND x.to_status = 'IN_PROGRESS'),
       completed_by = (SELECT actor FROM last_of x WHERE x.repair_id = r.repair_id AND x.to_status = 'COMPLETED'),
       closed_at    = (SELECT at FROM last_of x WHERE x.repair_id = r.repair_id AND x.to_status = 'CLOSED'),
       closed_by    = (SELECT actor FROM last_of x WHERE x.repair_id = r.repair_id AND x.to_status = 'CLOSED'),
       cancelled_at = (SELECT at FROM last_of x WHERE x.repair_id = r.repair_id AND x.to_status = 'CANCELLED'),
       cancelled_by = (SELECT actor FROM last_of x WHERE x.repair_id = r.repair_id AND x.to_status = 'CANCELLED')
 WHERE r.notes ~ '[A-Z_]+ -> [A-Z_]+ oleh \S+ \(\d{4}-\d{2}-\d{2}\)';

-- Then out of the notes. What the person wrote after the colon stays, on a
-- line of its own; a note that was nothing but moves is no note.
UPDATE ga_repair
   SET notes = NULLIF(
           btrim(regexp_replace(
               regexp_replace(notes, '\s*[A-Z_]+ -> [A-Z_]+ oleh \S+ \(\d{4}-\d{2}-\d{2}\)(:\s*)?', E'\n', 'g'),
               E'\n\\s*\n+', E'\n', 'g'), E' \n'),
           '')
 WHERE notes ~ '[A-Z_]+ -> [A-Z_]+ oleh \S+ \(\d{4}-\d{2}-\d{2}\)';

-- A repair that is past a stage and was never stamped (moved by hand, or by a
-- path that wrote no sentence) still says when, from the last time anybody
-- touched it; who is left unknown rather than guessed.
UPDATE ga_repair
   SET started_at = COALESCE(approved_at, updated_at, created_at)
 WHERE started_at IS NULL AND status IN ('IN_PROGRESS', 'COMPLETED', 'CLOSED');
UPDATE ga_repair
   SET closed_at = COALESCE(updated_at, created_at)
 WHERE closed_at IS NULL AND status = 'CLOSED';
UPDATE ga_repair
   SET cancelled_at = COALESCE(updated_at, created_at)
 WHERE cancelled_at IS NULL AND status = 'CANCELLED';

-- ---------------------------------------------------------------------------
-- Supplier kind
-- ---------------------------------------------------------------------------

CREATE TABLE supplier_kind_account (
    account_code text PRIMARY KEY,
    kind         text NOT NULL
        CHECK (kind IN ('UTILITIES','CLEANING','WORKSHOP','AC','LOGISTICS','OFFICE','LANDLORD','OTHER'))
);

-- The client's chart, by what each account buys.
INSERT INTO supplier_kind_account (account_code, kind) VALUES
    -- Telephone and internet, electricity, water.
    ('6044', 'UTILITIES'), ('6045', 'UTILITIES'), ('6046', 'UTILITIES'),
    -- Kebersihan.
    ('6040', 'CLEANING'),
    -- Repairs and upkeep: electrical, tyres, fuel, tools, furniture, computers,
    -- buildings, staff houses, vehicles, power plant, paint, lifts.
    ('6054', 'WORKSHOP'), ('6055', 'WORKSHOP'), ('6056', 'WORKSHOP'), ('6057', 'WORKSHOP'),
    ('6066', 'WORKSHOP'), ('6068', 'WORKSHOP'), ('6069', 'WORKSHOP'), ('6070', 'WORKSHOP'),
    ('6071', 'WORKSHOP'), ('6073', 'WORKSHOP'), ('6074', 'WORKSHOP'), ('6075', 'WORKSHOP'),
    -- Air conditioners and refrigerators.
    ('6072', 'AC'),
    -- Couriers and loading.
    ('6009', 'LOGISTICS'), ('6010', 'LOGISTICS'),
    -- Stationery, household, computer and shop supplies.
    ('6041', 'OFFICE'), ('6042', 'OFFICE'), ('6050', 'OFFICE'), ('6052', 'OFFICE'),
    ('6063', 'OFFICE'),
    -- Rent of land, shops, warehouses and the staff house.
    ('7002', 'LANDLORD'), ('7004', 'LANDLORD'), ('7005', 'LANDLORD');

ALTER TABLE supplier
    ADD COLUMN kind text
        CHECK (kind IN ('UTILITIES','CLEANING','WORKSHOP','AC','LOGISTICS','OFFICE','LANDLORD','OTHER'));

UPDATE supplier s
   SET kind = COALESCE(
           (SELECT m.kind FROM supplier_kind_account m
             WHERE m.account_code = btrim(s.expense_account_code)),
           'OTHER')
 WHERE s.category <> 'MERCHANDISE';

-- ---------------------------------------------------------------------------
-- "1.000 pcs" is a thousand
-- ---------------------------------------------------------------------------

-- The old reading took the dot for a decimal point. A number grouped by dots
-- in threes is an Indonesian thousand; read those again.
UPDATE ga_supply_request
   SET quantity_value = replace(replace(
           substring(btrim(quantity) FROM '^(\d{1,3}(?:\.\d{3})+(?:,\d+)?)'), '.', ''), ',', '.')::numeric
 WHERE unit_code IS NOT NULL
   AND btrim(quantity) ~ '^\d{1,3}(\.\d{3})+(,\d+)?\s*[^\d\s.,]';

-- ---------------------------------------------------------------------------
-- Verified, not assumed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    number_one text;
BEGIN
    IF EXISTS (SELECT 1 FROM ga_repair WHERE notes ~ ' -> [A-Z_]+ oleh ') THEN
        RAISE EXCEPTION '0981 left a stage sentence in a repair''s notes';
    END IF;
    IF EXISTS (SELECT 1 FROM supplier WHERE category <> 'MERCHANDISE' AND kind IS NULL) THEN
        RAISE EXCEPTION '0981 left a non-merchandise supplier with no kind';
    END IF;

    -- The trigger numbers a new request. An estate with no site yet (a fresh
    -- database) has nowhere to file one, and nothing to prove it on.
    IF NOT EXISTS (SELECT 1 FROM site) THEN
        RETURN;
    END IF;
    INSERT INTO ga_supply_request (site_id, requested_by, category_code, item, created_by)
    VALUES ((SELECT id FROM site ORDER BY id LIMIT 1), 'migrasi', 'ATK', 'probe', 'migrasi')
    RETURNING request_number INTO number_one;
    IF number_one !~ '^SR-[0-9]{6}-[0-9]{3,}$' THEN
        RAISE EXCEPTION '0981 numbered a supply request %', number_one;
    END IF;
    DELETE FROM ga_supply_request WHERE request_number = number_one;
END;
$$;
