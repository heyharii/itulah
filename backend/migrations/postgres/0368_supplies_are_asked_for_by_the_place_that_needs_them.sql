-- 0368: supplies are asked for by the place that needs them.
--
-- The last GA register is the front door: a shop runs out of A4 paper, cleaning
-- fluid or light bulbs, and somebody asks head office for it. This migration
-- holds the ASK — who asked, at which site, for what, how many, by when and
-- what it is expected to cost — and the seven categories the client's own
-- expense list already names.
--
-- # The ask is not the purchase
--
-- There is deliberately no Procurement here and no purchase order. The stages
-- below stop at BILLED, and the only link to buying is `po_reference`: a free
-- text field holding the number somebody types once a non-trade PO exists
-- (brief §15 tahap 5). It is not a foreign key to a table this database has
-- not got, and it is MANDATORY nowhere — a request that is still REQUESTED has
-- no PO, and that is the ordinary state of most of them. When Procurement
-- arrives it can point the other way, and this column is the join it will use.
--
-- # The seven categories are a table, not a CHECK
--
-- Brief §9.4 names seven GA supply categories, each with the expense account a
-- bill for it is charged to. A CHECK would carry the codes and lose the client
-- name and the account; a table carries all three, and the Supplies screen and
-- the seeding agree by reading the same rows. The accounts are the client's
-- own — 6041, 6042, 6052, 6054, 6057, 6059, 6063 — and are already active
-- leaves in the chart (0348); this migration connects them and invents none.
--
-- # The domain boundary, said out loud
--
-- Customer Supplies (6004) belongs to Commercial, and the shopping-bag
-- inventory belongs to Inventory. Neither is GA's, neither is in this list,
-- and this list is the ONLY one the Supplies screen offers — so the two
-- categories that must never appear are excluded by construction and asserted
-- below. The block also refuses any category account that is a heading or
-- retired, because a bill that resolved there would be refused later at the
-- leaf, which is a worse answer than refusing now.
--
-- # Why the request table carries `notes`
--
-- Spec §3's `RecordGaSupplyRequestRequest` has a `notes` field and this table
-- would otherwise have nowhere to put it: a request field that is silently
-- dropped is a lie told to the person typing. Same `created_by/at`,
-- `updated_by/at`, `version` shape as every other GA table (brief §6).
--
-- # The global posting switch is deliberately not asserted
--
-- 0364 turned automatic posting back ON by owner decision, so a block that
-- checked for it being off here would be asserting yesterday's rule. 0365 and
-- 0366 say the same and are silent; this follows them.

CREATE TABLE ga_supply_category (
    category_code TEXT PRIMARY KEY CHECK (category_code ~ '^[A-Z][A-Z0-9_]*$'),
    name          TEXT NOT NULL CHECK (btrim(name) <> ''),
    -- Akun beban yang diusulkan. brief §9.4.
    account_code  TEXT NOT NULL REFERENCES ledger_account (account_code),
    sort_order    integer NOT NULL DEFAULT 0
);

INSERT INTO ga_supply_category (category_code, name, account_code, sort_order) VALUES
    ('ATK',            'ATK & barang cetakan',        '6041', 0),
    ('RUMAH_TANGGA',   'Rumah tangga',                '6042', 1),
    ('TOKO_KANTOR',    'Perlengkapan toko & kantor',  '6052', 2),
    ('LISTRIK',        'Peralatan listrik',           '6054', 3),
    ('TOOLS',          'Tools',                       '6057', 4),
    ('TELEPON',        'Telephone equipment',         '6059', 5),
    ('MESS',           'Perlengkapan mess',           '6063', 6);

-- The category table comes first: the request references it, and a foreign key
-- to a table that does not exist yet is not a thing PostgreSQL will create.
CREATE TABLE ga_supply_request (
    request_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id        TEXT NOT NULL REFERENCES site (id),
    requested_by   TEXT NOT NULL CHECK (btrim(requested_by) <> ''),
    -- Salah satu dari tujuh kategori GA (brief §9.4), di-seed sebagai tabel
    -- supaya layar dan akunnya membaca daftar yang sama.
    category_code  TEXT NOT NULL REFERENCES ga_supply_category (category_code),
    item           TEXT NOT NULL CHECK (btrim(item) <> ''),
    quantity       TEXT,
    needed_by      date,
    estimated_cost_minor bigint CHECK (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0),
    -- Rujukan ke Procurement, dan TIDAK LEBIH DARI ITU (brief §15 tahap 5):
    -- Procurement non-dagang belum ada, jadi ini hanya id yang diketik orang
    -- saat PO-nya ada, bukan foreign key ke tabel yang belum ada. Hanya boleh
    -- diisi saat pindah ke ORDERED (ditegakkan di `postgres::ga_supplies`).
    po_reference   TEXT,
    status         TEXT NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN ('REQUESTED','APPROVED','ORDERED','RECEIVED','BILLED','REJECTED')),
    rejected_reason TEXT,
    notes          TEXT,
    created_by     TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     TEXT,
    updated_at     timestamptz,
    version        integer NOT NULL DEFAULT 1,
    -- A rejection that does not say why is a shop told "no" with nothing to
    -- act on. The readable refusal is in Rust; this is the last word.
    CONSTRAINT ga_supply_rejection_says_why
        CHECK (status <> 'REJECTED' OR (rejected_reason IS NOT NULL AND btrim(rejected_reason) <> '')),
    -- A purchase order number only means anything once the request is ordered.
    CONSTRAINT ga_supply_po_only_when_ordered
        CHECK (po_reference IS NULL OR status IN ('ORDERED', 'RECEIVED', 'BILLED'))
);

-- The overview's "new asks" list, and the site hub's strip: both want the open
-- ones at one place.
CREATE INDEX ix_ga_supply_request_site ON ga_supply_request (site_id, status);
CREATE INDEX ix_ga_supply_request_open ON ga_supply_request (needed_by)
 WHERE status = 'REQUESTED';

-- ---------------------------------------------------------------------------
-- Verified, not assumed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    category_count integer;
    drifted text;
    bad integer;
BEGIN
    -- Seven, exactly: a typo in the VALUES list above cannot quietly seed one
    -- more or one fewer.
    SELECT count(*) INTO category_count FROM ga_supply_category;
    IF category_count <> 7 THEN
        RAISE EXCEPTION '0368 expected seven supply categories, found %', category_count;
    END IF;

    -- Each category is the brief's own pair. Joining on BOTH the code and the
    -- account means a category whose account drifted is as wrong as one that
    -- is missing entirely.
    SELECT string_agg(c.category_code || '->' || c.account_code, ', ' ORDER BY c.category_code)
      INTO drifted
      FROM ga_supply_category c
      LEFT JOIN (VALUES
            ('ATK',          '6041'),
            ('RUMAH_TANGGA', '6042'),
            ('TOKO_KANTOR',  '6052'),
            ('LISTRIK',      '6054'),
            ('TOOLS',        '6057'),
            ('TELEPON',      '6059'),
            ('MESS',         '6063')
        ) AS brief(code, account)
        ON brief.code = c.category_code AND brief.account = c.account_code
     WHERE brief.code IS NULL;
    IF drifted IS NOT NULL THEN
        RAISE EXCEPTION '0368 seeded categories that are not the brief''s: %', drifted;
    END IF;

    -- Customer Supplies is Commercial's, and never GA's.
    IF EXISTS (SELECT 1 FROM ga_supply_category WHERE account_code = '6004') THEN
        RAISE EXCEPTION '0368 put Customer Supplies (6004) in GA''s supply categories';
    END IF;

    -- Every account is a live leaf. A group or a retired account would resolve
    -- and then refuse at the leaf, which is a worse answer than refusing here.
    SELECT count(*) INTO bad
      FROM ga_supply_category c
      JOIN ledger_account a ON a.account_code = c.account_code
     WHERE a.is_group OR NOT a.is_active;
    IF bad <> 0 THEN
        RAISE EXCEPTION '0368 installed % category accounts that are not active leaves', bad;
    END IF;

    -- The two readable refusals the Rust writer repeats, proven here by live
    -- attempts so the CHECKs are really in place.
    BEGIN
        INSERT INTO ga_supply_request
            (site_id, requested_by, category_code, item, status, created_by)
        VALUES ('dc', 'migrasi', 'ATK', 'probe', 'REJECTED', 'migrasi');
        RAISE EXCEPTION '0368 did not refuse a rejection with no reason';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO ga_supply_request
            (site_id, requested_by, category_code, item, po_reference, created_by)
        VALUES ('dc', 'migrasi', 'ATK', 'probe', 'PO-0000', 'migrasi');
        RAISE EXCEPTION '0368 did not refuse a PO on a request that was never ordered';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;
