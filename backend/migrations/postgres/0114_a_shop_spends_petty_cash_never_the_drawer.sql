-- 0114: What a shop is allowed to spend, out of which pot, on whose approval.
--
-- # The hole
--
-- A shop's electricity meter needs topping up, a light fitting breaks, an
-- ojek has to take a parcel across town. Until now the only way any of that
-- could reach the books was as a head-office supplier bill — a document that
-- needs a supplier record, an invoice number and a person at head office, for a
-- receipt of forty thousand rupiah written on a scrap of paper. So it did not
-- reach the books. It came out of the drawer, and the drawer came up short.
--
-- # Two pots, and the drawer is not one of them
--
--   PETTY_CASH        an imprest float, `1011001002 Petty Cash` at that shop,
--                     topped back up by head office against the receipts spent
--                     out of it
--   FUND_ALLOCATION   part of an operating fund the store manager is holding
--                     (0113), spent down against the purpose it was earmarked
--                     for
--
-- The drawer is deliberately absent, and so are sales proceeds. Asking for
-- either is refused with a sentence that says where to go instead, not with a
-- code. Takings are head office's money in the shop's keeping: they are
-- reconciled, and then disposed of under a Remittance Order (0112) — banked,
-- or paid to somebody head office named. A shop that may dip into the till for
-- a light bulb is a shop whose cash variance is unreadable, because every
-- shortfall has an explanation available.
--
-- # Approval by size, not by seniority alone
--
-- Up to 500,000 the shop's own manager approves. Above it, head office finance
-- does. The limit is a constant in `domain/store_cash.rs` rather than a column,
-- because it is a company policy and not a per-shop setting, and a settings
-- table nobody has a screen for is a number nobody can change anyway.
--
-- The approver may not be the person who claimed the expense, at any size. That
-- is the same maker/checker rule `goods_receipt_line` keeps between counting and
-- verifying, and it is the one control that survives a manager being the only
-- person in the building.
--
-- # Postings
--
--   POSTED  Dr <the category's meaning>       (the shop)
--           Cr petty_cash                     (the shop)   from the imprest
--           Cr store_manager_receivable       (the shop)   from a fund
--
-- One entry per expense, at the shop, balancing there. No cross-site leg: the
-- cost belongs to the shop that incurred it and the money was already at that
-- shop. That is what makes this the cheap document it needs to be.
--
-- An expense drawn on a fund also settles the manager's payment ledger item,
-- through the `DIRECT_EXPENSE` settlement in 0113 — one document, two records,
-- one transaction. An expense from petty cash settles nothing: the imprest is
-- an asset of the shop, not a debt of a person.

CREATE TABLE store_expense (
    expense_id     uuid PRIMARY KEY,
    -- `KK-STORE-03-26-09-00001`. Kas kecil, per shop, restarting each month —
    -- the shop's own petty cash book, numbered the way the shop's own file is.
    expense_number text NOT NULL UNIQUE CHECK (btrim(expense_number) <> ''),

    site_id        text NOT NULL REFERENCES site(id),

    source         text NOT NULL CHECK (source IN ('PETTY_CASH', 'FUND_ALLOCATION')),
    -- Required for a fund, forbidden otherwise. The CHECK is what makes
    -- "spent" summable: every rupiah drawn on a fund names the earmark it came
    -- out of.
    allocation_id  uuid REFERENCES fund_allocation(allocation_id),
    CHECK ((allocation_id IS NOT NULL) = (source = 'FUND_ALLOCATION')),

    -- What kind of cost this is, said as a meaning. The posting rule resolves it
    -- through `account_map` like every other rule; nothing here names a client
    -- account code.
    --
    -- Constrained to the nine the seed maps. An unconstrained column would let
    -- a shop post its electricity to `inventory` and the entry would balance.
    -- Adding a tenth is a row in the seed, a line here, and a considered
    -- decision about the client's chart — which is the right amount of
    -- friction for "which account does this cost land in".
    category       text NOT NULL CHECK (category IN (
                       'expense_electricity', 'expense_water', 'expense_telephone',
                       'expense_household', 'expense_stationery', 'expense_repairs',
                       'expense_transport', 'expense_cleaning', 'expense_misc')),

    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    currency       char(3) NOT NULL DEFAULT 'IDR',
    spent_on       date NOT NULL,
    -- Who was paid. Free text on purpose: the warung on the corner is not going
    -- to become a supplier record, and forcing one would mean either a fictional
    -- master row per receipt or the expense not being recorded at all.
    vendor         text NOT NULL CHECK (btrim(vendor) <> ''),
    memo           text,

    -- The receipt, photographed at the counter. `stored_file` holds the bytes
    -- or the object key; this holds which one.
    photo_file_id  uuid REFERENCES stored_file(file_id),

    -- DRAFT     keyed in by the shop
    -- APPROVED  somebody with the authority for this amount said yes
    -- POSTED    in the ledger
    -- REJECTED  refused, with a reason, and it stays on the record
    status         text NOT NULL CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'REJECTED')),

    claimed_by     text NOT NULL CHECK (btrim(claimed_by) <> ''),
    claimed_at     timestamptz NOT NULL DEFAULT now(),

    approved_by    text,
    approved_at    timestamptz,
    -- Which rung actually approved it, kept because the limit may move and an
    -- audit six months later asks who was allowed to approve this, then.
    approved_role  text CHECK (approved_role IS NULL OR approved_role IN ('SUPERVISOR', 'ADMIN')),

    rejected_by    text,
    rejected_at    timestamptz,
    reject_reason  text,

    journal_entry_id uuid REFERENCES journal_entry(entry_id),
    posted_at        timestamptz,

    CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
    CHECK ((approved_by IS NULL) = (approved_role IS NULL)),
    CHECK ((rejected_by IS NULL) = (rejected_at IS NULL)),
    CHECK ((status IN ('APPROVED', 'POSTED')) = (approved_at IS NOT NULL)),
    CHECK ((status = 'REJECTED') = (rejected_at IS NOT NULL)),
    CHECK (status <> 'REJECTED' OR btrim(COALESCE(reject_reason, '')) <> ''),
    CHECK ((status = 'POSTED') = (journal_entry_id IS NOT NULL)),
    CHECK ((journal_entry_id IS NULL) = (posted_at IS NULL)),
    -- The claimant does not approve their own spending. At any amount, and
    -- with no override: an override is the only feature of this control that
    -- ever gets used.
    CHECK (approved_by IS NULL OR approved_by <> claimed_by)
);

-- The shop's own book, and head office's approval queue.
CREATE INDEX ix_store_expense_site_date ON store_expense (site_id, spent_on DESC);
CREATE INDEX ix_store_expense_awaiting ON store_expense (site_id, claimed_at)
    WHERE status = 'DRAFT';
-- Everything drawn on one earmark, which is how "spent" is summed.
CREATE INDEX ix_store_expense_allocation ON store_expense (allocation_id)
    WHERE allocation_id IS NOT NULL;

COMMENT ON TABLE store_expense IS
    'A shop spending petty cash or an operating fund. Never the drawer and '
    'never sales proceeds: takings are reconciled and then disposed of under a '
    'remittance order. The approver is never the claimant.';

-- An expense drawn on a fund is drawn on a fund its own shop's manager holds,
-- and on one with room left in the earmark.
--
-- In the database rather than in Rust because it is the rule that keeps the
-- fund equation true. A read-then-write in the application would let two
-- concurrent claims each see the same remaining balance.
CREATE FUNCTION store_expense_allocation_is_usable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    fund_site     text;
    fund_status   text;
    earmark       bigint;
    earmark_state text;
    already_spent bigint;
BEGIN
    IF NEW.allocation_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT f.site_id, f.status, a.amount_minor, a.status
      INTO fund_site, fund_status, earmark, earmark_state
      FROM fund_allocation a
      JOIN operating_fund f ON f.fund_id = a.fund_id
     WHERE a.allocation_id = NEW.allocation_id
       FOR UPDATE OF a, f;

    IF earmark IS NULL THEN
        RAISE EXCEPTION 'there is no fund allocation %', NEW.allocation_id;
    END IF;
    IF fund_status = 'CLOSED' OR earmark_state = 'CLOSED' THEN
        RAISE EXCEPTION
            'fund allocation % is closed and cannot be spent against',
            NEW.allocation_id;
    END IF;
    IF fund_site <> NEW.site_id THEN
        RAISE EXCEPTION
            'fund allocation % is held at % and cannot be spent at %',
            NEW.allocation_id, fund_site, NEW.site_id;
    END IF;

    SELECT COALESCE(SUM(e.amount_minor), 0) INTO already_spent
      FROM store_expense e
     WHERE e.allocation_id = NEW.allocation_id
       AND e.status IN ('APPROVED', 'POSTED')
       AND e.expense_id <> NEW.expense_id;

    IF NEW.status IN ('APPROVED', 'POSTED')
       AND already_spent + NEW.amount_minor > earmark THEN
        RAISE EXCEPTION
            'fund allocation % has % left; this claim of % would overdraw it',
            NEW.allocation_id, earmark - already_spent, NEW.amount_minor;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER store_expense_allocation_is_usable
    BEFORE INSERT OR UPDATE ON store_expense
    FOR EACH ROW EXECUTE FUNCTION store_expense_allocation_is_usable();

-- ---------------------------------------------------------------------------
-- Topping the imprest back up
-- ---------------------------------------------------------------------------
--
-- Petty cash is an imprest float: a shop holds a fixed sum, spends some of it,
-- and head office puts back exactly what was spent against the receipts. So
-- the replenishment is not an expense — the expenses were already posted, one
-- per receipt — it is a transfer from an HO bank account into the shop's petty
-- cash.
--
--   Dr petty_cash (the shop) / Cr bank (HO, qualified)
--
-- Cross-site, and the affiliate legs are the poster's job.
--
-- A document rather than an endpoint that posts and forgets, because somebody
-- has to be able to answer "when was C007's petty cash last topped up, by whom,
-- and against which receipts" — and because a bank line will have to be
-- reconciled against it.
CREATE TABLE petty_cash_replenishment (
    replenishment_id uuid PRIMARY KEY,
    -- `KK-RPL-26-09-00001`.
    replenishment_number text NOT NULL UNIQUE CHECK (btrim(replenishment_number) <> ''),
    site_id          text NOT NULL REFERENCES site(id),
    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    currency         char(3) NOT NULL DEFAULT 'IDR',
    bank_key         text NOT NULL CHECK (bank_key IN ('bank_giro', 'bank_savings')),
    bank_qualifier   text NOT NULL CHECK (btrim(bank_qualifier) <> ''),
    replenish_date   date NOT NULL,
    -- What it was against. A window rather than a list of expense ids: the
    -- imprest is topped up to a level, not receipt by receipt, and a link table
    -- would imply an allocation nobody actually makes.
    covers_from      date,
    covers_to        date,
    issued_by        text NOT NULL CHECK (btrim(issued_by) <> ''),
    issued_at        timestamptz NOT NULL DEFAULT now(),
    journal_entry_id uuid NOT NULL REFERENCES journal_entry(entry_id),
    note             text,
    CHECK (covers_to IS NULL OR covers_from IS NULL OR covers_to >= covers_from)
);

CREATE INDEX ix_petty_replenishment_site ON petty_cash_replenishment (site_id, replenish_date DESC);

COMMENT ON TABLE petty_cash_replenishment IS
    'Head office restoring a shop''s petty cash float. Posts on creation: there '
    'is no draft, because the money has already moved when somebody records it.';
