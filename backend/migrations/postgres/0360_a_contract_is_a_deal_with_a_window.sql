-- 0360: a contract is a deal with a window.
--
-- General Affairs' register answers "what do we own and where is it"; this
-- table answers the question beside it: what have we AGREED to, with whom,
-- over which window of time. A lease, a maintenance contract, an insurance
-- policy, a business permit, a PLN subscription, a shopfront we sublet —
-- they are one shape: two parties, a start, an end (sometimes), a value
-- (sometimes), and a day the department must act before the window shuts.
--
-- # The type is the client's word, and it is a table rather than a CHECK
--
-- The seventeen types (brief §9.2) could be a CHECK listing seventeen codes,
-- but three things want MORE than a code: the screen wants the client's own
-- label ("Sewa toko/gudang/kantor", "STNK / KIR"), the account mapping wants
-- a qualifier it can join on, and stage 4's repairs will want the same kind
-- of vocabulary for their objects. A table carries all three and lets a new
-- type be added without touching a constraint; the CHECK spelling would make
-- the seventeenth type a migration that rewrites a line eighteen other
-- migrations have already blessed.
--
-- `domain::ga::CONTRACT_TYPES` in Rust keeps the same seventeen, because the
-- validation that refuses an unknown type wants to answer with a sentence
-- naming the seventeen, and a sentence is written in code. The two are
-- written in the same change and the DO block below counts the table's side;
-- the Rust side is counted by `ga_contracts_integration`.
--
-- # The eleven repair objects are here too, a stage early
--
-- `ga_contract.objek` (what a maintenance contract maintains) and stage 4's
-- `ga_repair.objek` are the SAME list — the eleven of brief §9.3, each with
-- the expense account its repairs are charged to. Two CHECK lists would be
-- two lists to keep in step, so the list is a table now, `ga_contract.objek`
-- references it, and stage 4 references the same rows. The account_code is
-- seeded here (unused until stage 4) so the §9.3 mapping and the vocabulary
-- cannot drift apart in between.

CREATE TABLE contract_type (
    code       text PRIMARY KEY CHECK (btrim(code) <> ''),
    -- The client's own words, from the prototype's TYPES[...].label.
    name       text NOT NULL CHECK (btrim(name) <> ''),
    group_code text NOT NULL CHECK (group_code IN
                   ('SEWA', 'JASA', 'ASURANSI', 'IZIN', 'LANGGANAN', 'DISEWAKAN')),
    sort_order integer NOT NULL UNIQUE CHECK (sort_order > 0)
);

INSERT INTO contract_type (code, name, group_code, sort_order) VALUES
    ('SEWA_TANAH',          'Sewa tanah',               'SEWA',       1),
    ('SEWA_TOKO',           'Sewa toko/gudang/kantor',  'SEWA',       2),
    ('SEWA_RUMAH',          'Sewa rumah/mess',          'SEWA',       3),
    ('SEWA_KENDARAAN',      'Sewa kendaraan',           'SEWA',       4),
    ('JASA_MAINTENANCE',    'Kontrak maintenance',      'JASA',       5),
    ('JASA_CLEANING',       'Cleaning',                 'JASA',       6),
    ('ASURANSI_PROPERTI',   'Asuransi properti',        'ASURANSI',   7),
    ('ASURANSI_KENDARAAN',  'Asuransi kendaraan',       'ASURANSI',   8),
    ('IZIN_USAHA',          'Izin usaha',               'IZIN',       9),
    ('IZIN_KENDARAAN',      'STNK / KIR',               'IZIN',      10),
    ('PAJAK_PBB',           'PBB',                      'IZIN',      11),
    ('PAJAK_REKLAME',       'Pajak reklame',            'IZIN',      12),
    ('LANGGANAN_LISTRIK',   'Listrik',                  'LANGGANAN', 13),
    ('LANGGANAN_AIR',       'Air',                      'LANGGANAN', 14),
    ('LANGGANAN_TELEKOM',   'Telepon / internet',       'LANGGANAN', 15),
    ('DISEWAKAN_GEDUNG',    'Sewa ruang/gedung',        'DISEWAKAN', 16),
    ('DISEWAKAN_PERALATAN', 'Sewa peralatan',           'DISEWAKAN', 17);

-- The eleven things this company repairs (brief §9.3), each with the expense
-- its repairs are charged to. The account is READ by stage 4, so it is seeded
-- where the word is, rather than mapped again in stage 4 from a second list.
CREATE TABLE ga_repair_object (
    code         text PRIMARY KEY CHECK (btrim(code) <> ''),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    account_code text NOT NULL REFERENCES ledger_account (account_code)
);

INSERT INTO ga_repair_object (code, name, account_code) VALUES
    ('FFE',         'FFE & OE',               '6066'),
    ('SOFTWARE',    'Software',               '6067'),
    ('KOMPUTER',    'Komputer',               '6068'),
    ('BANGUNAN',    'Bangunan',               '6069'),
    ('STAFF_HOUSE', 'Staff house / mess',     '6070'),
    ('KENDARAAN',   'Kendaraan',              '6071'),
    ('AC',          'AC & refrigerator',      '6072'),
    ('POWER_PLANT', 'Genset / power plant',   '6073'),
    ('GENSET_BBM',  'Pelumas & BBM genset',   '6058'),
    ('CAT',         'Pengecatan',             '6074'),
    ('LIFT',        'Lift & eskalator',       '6075');

CREATE TABLE ga_contract (
    contract_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The number ON THE PAPER, not one we minted. Most contracts arrived with
    -- their own number before this system did, and a number that differs from
    -- the one written on the agreement is a number that cannot find its file.
    contract_number text,
    contract_type   text NOT NULL REFERENCES contract_type (code),
    -- JASA_MAINTENANCE only: what the contract maintains.
    objek           text REFERENCES ga_repair_object (code),
    -- Exactly one of two: a registered supplier, or a free-text counterparty
    -- (the tenant renting our space, the koperasi, an event organiser) who is
    -- not a supplier and must not be filed as one.
    supplier_id     uuid REFERENCES supplier (supplier_id),
    counterparty_name text,
    -- Exactly one of two: one site, or a scope that covers every store (or
    -- every site) at once — one cleaning contract for fifteen shops is one
    -- contract, not fifteen rows pretending to agree.
    site_id         text REFERENCES site (id),
    site_scope      text CHECK (site_scope IN ('ALL_STORES', 'ALL_SITES')),
    -- The one thing a maintenance contract maintains, when it is a thing.
    asset_id        uuid REFERENCES fixed_asset (asset_id),
    starts_on       date NOT NULL,
    ends_on         date,
    contract_value_minor bigint CHECK (contract_value_minor IS NULL
                                     OR contract_value_minor >= 0),
    is_signed       boolean NOT NULL DEFAULT false,
    signed_by       text,
    -- The PLN / PDAM / Telkom customer number, for the Langganan types: the
    -- one number a vendor's own invoice answers to.
    customer_number text,
    -- How many days before `ends_on` this contract wants itself remembered.
    -- The threshold is the CONTRACT's, not a global setting, because a permit
    -- whose renewal queue is months long needs a bigger window than a
    -- subscription renewed by phone.
    reminder_days   integer NOT NULL DEFAULT 60 CHECK (reminder_days >= 0),
    notes           text,
    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'ACTIVE', 'TERMINATED')),
    -- Archived, not deleted (brief §12): a contract a bill pointed at must
    -- stay findable, and a contract's history outlives the deal itself.
    archived        boolean NOT NULL DEFAULT false,
    created_by      text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text,
    updated_at      timestamptz,
    version         integer NOT NULL DEFAULT 1,

    -- Exactly one party: a deal with nobody on the other side is a note, and
    -- a deal with two names on one side is two deals wearing one number.
    CONSTRAINT ga_contract_one_party CHECK
        ((supplier_id IS NULL) <> (counterparty_name IS NULL)),
    -- Exactly one coverage: a contract is somewhere, or it is everywhere.
    CONSTRAINT ga_contract_one_scope CHECK
        ((site_id IS NULL) <> (site_scope IS NULL)),
    -- An objek only exists for a maintenance contract, and a maintenance
    -- contract without one does not say what it maintains.
    CONSTRAINT ga_contract_objek_is_maintenance CHECK
        ((contract_type = 'JASA_MAINTENANCE') = (objek IS NOT NULL)),
    -- A window does not end before it opens.
    CONSTRAINT ga_contract_ends_after_start CHECK
        (ends_on IS NULL OR ends_on >= starts_on)
);

-- The register's commonest questions: what is ending soon (the overview), and
-- which contracts does one asset sit under.
CREATE INDEX ix_ga_contract_ends_on
    ON ga_contract (ends_on) WHERE NOT archived;
CREATE INDEX ix_ga_contract_asset
    ON ga_contract (asset_id) WHERE asset_id IS NOT NULL;

-- ── meter readings ───────────────────────────────────────────────────────
--
-- A Langganan contract is measured: the meter is read, opening and closing,
-- once per period. One row per contract per period, and corrections REWRITE
-- the row rather than adding one — a mis-typed closing figure corrected next
-- week is one reading with a new number, not two readings from one month
-- (the UNIQUE below says so, and the writer upserts).
CREATE TABLE ga_meter_reading (
    reading_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES ga_contract (contract_id),
    -- The month being measured, always its first day.
    period      date NOT NULL CHECK (date_trunc('month', period) = period),
    unit        text NOT NULL CHECK (btrim(unit) <> ''),
    opening     bigint NOT NULL CHECK (opening >= 0),
    closing     bigint NOT NULL CHECK (closing >= 0),
    read_on     date NOT NULL,
    recorded_by text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (contract_id, period),
    -- A meter runs forward. The one exception is a meter swap, and a swap is
    -- a new reading entered by a person who knows why the numbers went down.
    CONSTRAINT ga_meter_reading_runs_forward CHECK (closing >= opening)
);

-- Every object GA keeps can carry files, comments and history (brief §6), and
-- that machinery hangs everything on `record_kind`. One row is the whole of
-- the wiring: without it, filing a paper against a contract is a foreign key
-- violation nobody asked for.
INSERT INTO record_kind (code, label)
VALUES ('contract', 'Contract')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    bad text;
    refused text;
BEGIN
    IF (SELECT count(*) FROM contract_type) <> 17 THEN
        RAISE EXCEPTION '0360 expected seventeen contract types, found %',
            (SELECT count(*) FROM contract_type);
    END IF;

    IF (SELECT count(*) FROM ga_repair_object) <> 11 THEN
        RAISE EXCEPTION '0360 expected eleven repair objects, found %',
            (SELECT count(*) FROM ga_repair_object);
    END IF;

    -- The two "exactly one" rules are the contract's whole shape, so they are
    -- exercised the way a person would trip over them: by trying to write a
    -- row that breaks each one, and expecting the database to say no. The
    -- probes name their party as free text because the probes must not depend
    -- on a supplier row existing — a fresh database seeds none.
    BEGIN
        INSERT INTO ga_contract (contract_type, starts_on, site_id, created_by)
        VALUES ('SEWA_TANAH', DATE '2026-01-01', 'dc', 'migrasi');
        RAISE EXCEPTION '0360 did not refuse a contract with no counterparty';
    EXCEPTION WHEN check_violation THEN
        refused := 'party'; NULL;
    END;

    BEGIN
        INSERT INTO ga_contract (contract_type, starts_on, counterparty_name,
                                 site_id, site_scope, created_by)
        VALUES ('SEWA_TANAH', DATE '2026-01-01', 'Pasar inkubator',
                'dc', 'ALL_STORES', 'migrasi');
        RAISE EXCEPTION '0360 did not refuse a contract with two coverages';
    EXCEPTION WHEN check_violation THEN
        refused := refused || '+scope'; NULL;
    END;

    -- And the objek rule, both directions: allowed for maintenance — the one
    -- shape that must go in, and which is deleted again before this block is
    -- done — and refused for everything else.
    INSERT INTO ga_contract (contract_type, starts_on, counterparty_name,
                             site_id, objek, created_by)
    VALUES ('JASA_MAINTENANCE', DATE '2026-01-01', 'Pasar inkubator', 'dc', 'AC',
            'migrasi');
    DELETE FROM ga_contract
     WHERE contract_type = 'JASA_MAINTENANCE'
       AND counterparty_name = 'Pasar inkubator';

    BEGIN
        INSERT INTO ga_contract (contract_type, starts_on, counterparty_name,
                                 site_id, objek, created_by)
        VALUES ('SEWA_TOKO', DATE '2026-01-01', 'Pasar inkubator', 'dc', 'AC',
                'migrasi');
        RAISE EXCEPTION '0360 did not refuse objek on a non-maintenance contract';
    EXCEPTION WHEN check_violation THEN
        refused := refused || '+objek'; NULL;
    END;

    IF refused <> 'party+scope+objek' THEN
        RAISE EXCEPTION '0360 verified only % of the three refusals', refused;
    END IF;

    -- `usage` is deliberately not a column: it is closing - opening, and
    -- storing it would store the same number twice with a disagreement
    -- waiting between the two.
    SELECT string_agg(column_name, ', ') INTO bad
      FROM information_schema.columns
     WHERE table_name = 'ga_meter_reading' AND column_name = 'usage';
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION '0360 stored usage as a column; it is closing - opening';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM record_kind WHERE code = 'contract') THEN
        RAISE EXCEPTION '0360 did not install the contract record kind';
    END IF;

    IF EXISTS (
        SELECT 1 FROM finance_posting_control
         WHERE singleton = true AND automatic_posting_enabled
    ) THEN
        RAISE EXCEPTION '0360 expected automatic posting to remain paused during review';
    END IF;
END;
$$;
