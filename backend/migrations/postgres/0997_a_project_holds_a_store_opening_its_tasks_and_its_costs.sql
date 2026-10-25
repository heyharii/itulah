-- 0997 — a project holds a store opening, its tasks and its costs.
--
-- # One project, two desks (owner, 25 Oct 2026, project-cip-prototype.html)
--
-- Opening a store is weeks of work that GA runs and Finance pays for. GA keeps
-- the work in one place: the tasks counted back from the opening day, the
-- assets it registers for the new store, the contracts, repairs and supply
-- requests the opening needs, and the files. Finance keeps the money: every
-- bill, cash voucher and expense claim the opening caused. When the store is
-- ready GA closes the project; Finance then capitalises it, sending each cost
-- to the asset it built, to the store's Pre-opening balance (amortised month
-- by month), or to expense.
--
-- # Why it is `contractor_project` grown, and not a second table
--
-- 0720 already had the money half: a project in a unit's books, its CIP
-- invoices, and a close that divides the cost into assets and expenses and
-- registers the assets. A store opening is the same act with more than one
-- supplier and with GA's work around it, so the table grows instead of a
-- second one starting that Finance would have to keep in step. The table keeps
-- its name because nine screens and statements already read it; the hub calls
-- every row a Project.
--
--   kind     CONTRACTOR (0720's: one contractor, an advance, its invoices),
--            STORE_OPENING, RENOVATION
--   status   OPEN → READY (GA closed it: the work is done) → CAPITALISED
--            (Finance placed the cost). 0720's CLOSED is CAPITALISED.
--
-- # How a cost joins a project
--
-- A cost joins by its line: a bill line, a BKK line or an expense-claim line
-- names the project. Nothing about how those documents post changes. A line
-- Finance coded to Contract in Progress is credited from CIP at capitalising;
-- a line that went to an expense is moved out of that expense. Either way the
-- capitalising entry is the only one this feature writes.

-- ── the project ──────────────────────────────────────────────────────────

ALTER TABLE contractor_project ALTER COLUMN supplier_id DROP NOT NULL;

ALTER TABLE contractor_project
    ADD COLUMN kind          text NOT NULL DEFAULT 'CONTRACTOR'
        CHECK (kind IN ('CONTRACTOR', 'STORE_OPENING', 'RENOVATION')),
    -- The store or office the work is for. The cost lands in that site's
    -- unit; `unit_id` stays the books the project posts in.
    ADD COLUMN site_id       text REFERENCES site (id),
    -- The day the store opens, or the renovation should be done by. Every
    -- task's due date is counted back from it.
    ADD COLUMN opens_on      date,
    -- The person in charge, by login.
    ADD COLUMN pic           text CHECK (pic IS NULL OR btrim(pic) <> ''),
    ADD COLUMN template_code text,
    -- GA's close: the work is done and the site is ready.
    ADD COLUMN ready_on      date,
    ADD COLUMN ready_by      text,
    ADD COLUMN ready_at      timestamptz,
    ADD COLUMN version       integer NOT NULL DEFAULT 1;

ALTER TABLE contractor_project DROP CONSTRAINT contractor_project_status_check;
ALTER TABLE contractor_project DROP CONSTRAINT contractor_project_check;
UPDATE contractor_project SET status = 'CAPITALISED' WHERE status = 'CLOSED';
ALTER TABLE contractor_project
    ADD CONSTRAINT contractor_project_status
        CHECK (status IN ('OPEN', 'READY', 'CAPITALISED')),
    ADD CONSTRAINT contractor_project_capitalised_says_when
        CHECK ((status = 'CAPITALISED') = (closed_on IS NOT NULL)),
    ADD CONSTRAINT contractor_project_ready_says_who
        CHECK ((ready_on IS NULL) = (ready_by IS NULL)),
    -- A contractor project is the contractor's; the others need not name one.
    ADD CONSTRAINT contractor_project_contractor_names_supplier
        CHECK (kind <> 'CONTRACTOR' OR supplier_id IS NOT NULL),
    -- GA's projects are for a place and a day.
    ADD CONSTRAINT contractor_project_opening_says_where_and_when
        CHECK (kind = 'CONTRACTOR' OR (site_id IS NOT NULL AND opens_on IS NOT NULL));

-- Numbers from a sequence: COUNT(*) + 1 gave two projects opened at once the
-- same number.
CREATE SEQUENCE contractor_project_serial;
SELECT setval('contractor_project_serial', GREATEST((SELECT COUNT(*) FROM contractor_project), 1),
              (SELECT COUNT(*) FROM contractor_project) > 0);

CREATE INDEX ix_contractor_project_site ON contractor_project (site_id, status);

COMMENT ON TABLE contractor_project IS
    'A project (0720, grown in 0997): a contractor''s work, a store opening or a renovation. GA runs its tasks, assets and work; Finance capitalises its cost. OPEN → READY → CAPITALISED.';

-- ── the split, line by line ──────────────────────────────────────────────
--
-- 0720 split a project by destination. A capitalised project splits by cost
-- line: each line says where it went and which account it left, so the entry
-- can be read back line by line.

ALTER TABLE contractor_project_split DROP CONSTRAINT contractor_project_split_kind_check;
ALTER TABLE contractor_project_split DROP CONSTRAINT contractor_project_split_check;
ALTER TABLE contractor_project_split
    ADD COLUMN source_kind     text CHECK (source_kind IN ('BILL_LINE', 'BKK_LINE', 'CLAIM_LINE')),
    ADD COLUMN source_id       text,
    -- What the line was debited to before: Contract in Progress or an expense.
    ADD COLUMN from_account    text,
    ADD CONSTRAINT contractor_project_split_kind
        CHECK (kind IN ('ASSET', 'PRE_OPENING', 'EXPENSE')),
    ADD CONSTRAINT contractor_project_split_class_for_assets
        CHECK ((kind IN ('ASSET', 'PRE_OPENING')) = (class_code IS NOT NULL)),
    ADD CONSTRAINT contractor_project_split_source_both_or_neither
        CHECK ((source_kind IS NULL) = (source_id IS NULL));

-- ── tasks ────────────────────────────────────────────────────────────────

-- A checklist a project starts from. The client's own list for a new store
-- is seeded below; days_before counts back from the opening day.
CREATE TABLE project_task_template (
    template_code text PRIMARY KEY CHECK (btrim(template_code) <> ''),
    name          text NOT NULL CHECK (btrim(name) <> ''),
    kind          text NOT NULL CHECK (kind IN ('STORE_OPENING', 'RENOVATION'))
);

CREATE TABLE project_task_template_line (
    template_code text NOT NULL REFERENCES project_task_template (template_code),
    line_number   integer NOT NULL CHECK (line_number > 0),
    name          text NOT NULL CHECK (btrim(name) <> ''),
    -- The department that does it, by the hub's section code. A GA line goes
    -- to the project's PIC; the others wait for a name.
    department    text NOT NULL CHECK (department IN ('ga', 'stores', 'people', 'merchandise', 'marketing', 'finance')),
    days_before   integer NOT NULL CHECK (days_before >= 0),
    milestone     boolean NOT NULL DEFAULT false,
    PRIMARY KEY (template_code, line_number)
);

CREATE TABLE project_task (
    task_id       uuid PRIMARY KEY,
    project_id    uuid NOT NULL REFERENCES contractor_project (project_id),
    name          text NOT NULL CHECK (btrim(name) <> ''),
    department    text NOT NULL CHECK (department IN ('ga', 'stores', 'people', 'merchandise', 'marketing', 'finance')),
    -- The person in charge, by login. Empty until somebody is named.
    pic           text CHECK (pic IS NULL OR btrim(pic) <> ''),
    due_on        date NOT NULL,
    milestone     boolean NOT NULL DEFAULT false,
    from_template boolean NOT NULL DEFAULT false,
    done_on       date,
    done_by       text,
    created_by    text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    version       integer NOT NULL DEFAULT 1,
    CONSTRAINT project_task_done_says_who CHECK ((done_on IS NULL) = (done_by IS NULL))
);
CREATE INDEX ix_project_task_project ON project_task (project_id, due_on);

COMMENT ON TABLE project_task IS
    'A to-do of a project (0997): who does it and by when, counted back from the opening day. No money: what a vendor does for money is a contract, a repair or a supply request.';

INSERT INTO project_task_template (template_code, name, kind) VALUES
    ('STORE_OPENING', 'Store opening', 'STORE_OPENING'),
    ('RENOVATION', 'Renovation', 'RENOVATION')
ON CONFLICT (template_code) DO NOTHING;

INSERT INTO project_task_template_line (template_code, line_number, name, department, days_before, milestone) VALUES
    ('STORE_OPENING', 1, 'Tanda tangan kontrak kontraktor', 'ga', 48, false),
    ('STORE_OPENING', 2, 'Renovasi mulai', 'ga', 45, true),
    ('STORE_OPENING', 3, 'Izin PBG & reklame', 'ga', 30, false),
    ('STORE_OPENING', 4, 'Pesan AC, rak dan PC kasir', 'ga', 21, false),
    ('STORE_OPENING', 5, 'Buat toko di Stores', 'stores', 14, false),
    ('STORE_OPENING', 6, 'Rekrut tim & rekam sidik jari', 'people', 10, false),
    ('STORE_OPENING', 7, 'Training kasir', 'ga', 7, false),
    ('STORE_OPENING', 8, 'HO approve POS', 'stores', 5, false),
    ('STORE_OPENING', 9, 'Serah terima dari kontraktor', 'ga', 3, true),
    ('STORE_OPENING', 10, 'Stok pertama tiba dari DC', 'merchandise', 3, false),
    ('STORE_OPENING', 11, 'Signage & promo opening', 'marketing', 2, false),
    ('STORE_OPENING', 12, 'Toko buka', 'ga', 0, true),
    ('RENOVATION', 1, 'Tanda tangan kontrak kontraktor', 'ga', 30, false),
    ('RENOVATION', 2, 'Renovasi mulai', 'ga', 21, true),
    ('RENOVATION', 3, 'Izin renovasi dari pengelola', 'ga', 21, false),
    ('RENOVATION', 4, 'Pindahkan stok dan display', 'merchandise', 21, false),
    ('RENOVATION', 5, 'Serah terima dari kontraktor', 'ga', 2, true),
    ('RENOVATION', 6, 'Selesai renovasi', 'ga', 0, true)
ON CONFLICT (template_code, line_number) DO NOTHING;

-- ── what belongs to a project ────────────────────────────────────────────
--
-- GA's records and Finance's cost lines name the project they are for. One
-- project each: a repair for two openings is two repairs.

ALTER TABLE fixed_asset ADD COLUMN project_id uuid REFERENCES contractor_project (project_id);
ALTER TABLE ga_contract ADD COLUMN project_id uuid REFERENCES contractor_project (project_id);
ALTER TABLE ga_repair ADD COLUMN project_id uuid REFERENCES contractor_project (project_id);
ALTER TABLE ga_supply_request ADD COLUMN project_id uuid REFERENCES contractor_project (project_id);
ALTER TABLE supplier_invoice_expense_line ADD COLUMN project_id uuid REFERENCES contractor_project (project_id);
ALTER TABLE cash_document_line ADD COLUMN project_id uuid REFERENCES contractor_project (project_id);
ALTER TABLE expense_claim_line ADD COLUMN project_id uuid REFERENCES contractor_project (project_id);

CREATE INDEX ix_fixed_asset_project ON fixed_asset (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ix_ga_contract_project ON ga_contract (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ix_ga_repair_project ON ga_repair (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ix_ga_supply_request_project ON ga_supply_request (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ix_invoice_line_project ON supplier_invoice_expense_line (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ix_cash_document_line_project ON cash_document_line (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ix_expense_claim_line_project ON expense_claim_line (project_id) WHERE project_id IS NOT NULL;

-- 0720's invoices are the project's cost already; their lines say so now.
UPDATE supplier_invoice_expense_line l
   SET project_id = ci.project_id
  FROM contractor_project_invoice ci
 WHERE ci.invoice_id = l.invoice_id AND l.project_id IS NULL;

-- Files and activity attach to a project like to any record.
INSERT INTO record_kind (code, label) VALUES
    ('project', 'Project')
ON CONFLICT (code) DO NOTHING;
