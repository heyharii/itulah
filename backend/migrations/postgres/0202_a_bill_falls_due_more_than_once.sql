-- A bill falls due in instalments, not once.
--
-- Step two of `PAYMENT-TERMS-PLAN.md`, and the one the whole plan turns on.
-- `supplier_invoice.due_date` is a single nullable date, and three live
-- readings depend on it:
--
--   postgres/payables.rs  `CURRENT_DATE - i.due_date`, the ageing column
--   postgres/ledger.rs    `i.due_date < CURRENT_DATE`, what is overdue
--   postgres/payments.rs  the order bills are offered to a payment in
--
-- So a bill 40% paid whose second instalment falls next month reads, in all
-- three, as wholly overdue. Putting a schedule on the purchase order changes
-- none of that; this does.
--
-- # What this deliberately does NOT do
--
-- It does not make instalments compulsory. Every bill in the database today
-- has none, every bill the current code writes has none, and a migration that
-- required them would have to rewrite bill creation in the same change. The
-- invariant below is therefore conditional: **a bill with no instalments is
-- legal; a bill with instalments must have them add up.**
--
-- It also does not rewrite the three readings above. They keep working off
-- `due_date` until they are moved deliberately, one at a time, onto the view
-- this adds.

-- ---------------------------------------------------------------------------
-- The instalment
-- ---------------------------------------------------------------------------
CREATE TABLE supplier_invoice_payment_term (
    -- A surrogate key, and it matters. A payment will settle an instalment
    -- (step three), and an allocation that named `(invoice_id, seq)` would
    -- name a POSITION: correct a two-line schedule into three and every
    -- allocation pointing at 2 settles something else, silently. `seq` is
    -- presentation and ordering; identity is this.
    invoice_payment_term_id uuid PRIMARY KEY,
    invoice_id   uuid NOT NULL
                     REFERENCES supplier_invoice(invoice_id) ON DELETE CASCADE,
    seq          integer NOT NULL CHECK (seq > 0),

    -- What the arrangement called it — "Advance", "Before dispatch". Carried
    -- rather than joined to `payment_term`, for the reason a purchase order
    -- line carries its own name: the master may be renamed or retired, and a
    -- bill states what was agreed when it was agreed.
    label        text NOT NULL CHECK (btrim(label) <> ''),

    -- The day this portion falls due, already computed. The BILL owns the
    -- dates — this is the authoritative schedule, and the order's is the
    -- agreement that seeded it. ERPNext splits it the same way and recomputes
    -- against the invoice's own date in `fetch_payment_terms_from_order`.
    due_date     date NOT NULL,

    portion_bps  integer NOT NULL CHECK (portion_bps > 0 AND portion_bps <= 10000),

    -- The portion in money, settled once at the bill's total rather than
    -- recomputed on every read. Basis points of a total that ends in an odd
    -- rupiah do not divide evenly, and a figure recomputed in three places
    -- rounds three ways.
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),

    UNIQUE (invoice_id, seq)
);

-- The order every reading wants: a bill's instalments, earliest first.
CREATE INDEX ix_supplier_invoice_payment_term_due
    ON supplier_invoice_payment_term (invoice_id, due_date, seq);

-- ---------------------------------------------------------------------------
-- Invariant: a schedule is the whole bill, or there is no schedule
-- ---------------------------------------------------------------------------
--
-- Deferred and on both tables, the shape `assert_payment_allocated` (0084) and
-- `assert_template_whole` (0201) already use: the instalments do not exist
-- when the header is inserted, and checking one side leaves a hole.
--
-- P0001 so `AppError::into_response` passes the sentence through as a 409.
--
-- ERPNext validates the same sum to a 0.1 tolerance and fails rather than
-- adjusting the last row. In minor units there is no tolerance to spend, so
-- the writer balances it — and the amounts are stored precisely so that the
-- balancing happens once, where somebody can see it.
CREATE OR REPLACE FUNCTION assert_bill_schedule_whole() RETURNS trigger AS $$
DECLARE
    target   uuid;
    parts    bigint;
    bps      bigint;
    money    bigint;
    expected bigint;
BEGIN
    -- One function, three record shapes: the header has `invoice_id` under its
    -- own name, and a DELETE on the instalment table has no NEW at all.
    IF TG_TABLE_NAME = 'supplier_invoice' THEN
        target := NEW.invoice_id;
    ELSIF TG_OP = 'DELETE' THEN
        target := OLD.invoice_id;
    ELSE
        target := NEW.invoice_id;
    END IF;

    SELECT total_minor INTO expected FROM supplier_invoice WHERE invoice_id = target;
    -- The bill may have been rolled back out from under its instalments.
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(portion_bps), 0), COALESCE(SUM(amount_minor), 0)
      INTO parts, bps, money
      FROM supplier_invoice_payment_term WHERE invoice_id = target;

    -- No schedule is a legal state and the ordinary one today. This is what
    -- lets the table land without rewriting how a bill is created.
    IF parts = 0 THEN
        RETURN NULL;
    END IF;

    IF bps <> 10000 THEN
        RAISE EXCEPTION
            'bill % schedules % of itself; the instalments have to add up to all of it',
            target, (trim(trailing '.' from trim(trailing '0' from
                        round(bps / 100.0, 2)::text)) || '%')
            USING ERRCODE = 'P0001';
    END IF;

    IF money <> expected THEN
        RAISE EXCEPTION
            'bill % totals % but its instalments come to %; a schedule that does '
            'not settle the bill is not a schedule',
            target, expected, money
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER assert_bill_schedule_whole_on_bill
    AFTER UPDATE ON supplier_invoice
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_bill_schedule_whole();

CREATE CONSTRAINT TRIGGER assert_bill_schedule_whole_on_term
    AFTER INSERT OR UPDATE OR DELETE ON supplier_invoice_payment_term
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_bill_schedule_whole();

-- ---------------------------------------------------------------------------
-- Where a bill stands
-- ---------------------------------------------------------------------------
--
-- A view rather than maintained columns. `next_due_date` moves when an
-- instalment is added, when one is edited, when a payment is allocated, and
-- when a payment is posted — four tables' worth of triggers to keep one date
-- in step, each of them a chance to drift. Computed here it cannot drift, and
-- an AP list is thousands of rows, not millions.
--
-- **`next_due_date` is the earliest UNPAID instalment, and this is a deliberate
-- divergence from ERPNext**, which sets `due_date = max(payment_schedule.due_date)`
-- — the day a bill is finally settled. That answers a different question. The
-- one an AP office asks every morning is *what must I pay next*.
--
-- Paid-ness is at bill level, not instalment level, because an allocation does
-- not yet name an instalment — that is step three. Walking the instalments in
-- date order and finding the first whose cumulative amount exceeds what has
-- been paid gives the same answer without it, and keeps giving it afterwards.
CREATE VIEW supplier_invoice_standing AS
SELECT
    i.invoice_id,
    i.total_minor,
    settled.paid_minor,
    (i.total_minor - settled.paid_minor) AS outstanding_minor,

    -- A bill with no instalments falls back to its own `due_date`, which is
    -- every bill in the database on the day this lands. A bill that is fully
    -- paid has nothing next: NULL, and `overdue` goes false with it.
    CASE
        WHEN settled.paid_minor >= i.total_minor THEN NULL
        ELSE COALESCE(upcoming.due_date, i.due_date)
    END AS next_due_date,

    CASE
        WHEN settled.paid_minor >= i.total_minor THEN 'PAID'
        WHEN settled.paid_minor > 0              THEN 'PARTIALLY_PAID'
        ELSE 'UNPAID'
    END AS payment_state,

    -- Its own flag, not a fourth value of the state above. A bill can be
    -- partly paid AND overdue at once, and one enum cannot say both — which
    -- is exactly what ERPNext's single Select cannot express.
    (settled.paid_minor < i.total_minor
     AND COALESCE(upcoming.due_date, i.due_date) < CURRENT_DATE) AS overdue
FROM supplier_invoice i
CROSS JOIN LATERAL (
    -- POSTED only. A payment keyed in but not in the books has not settled
    -- anything, which is the same line `payables.rs` already draws between
    -- `paid_minor` and `allocated_minor`.
    SELECT COALESCE(SUM(al.amount_minor), 0)::bigint AS paid_minor
      FROM supplier_payment_allocation al
      JOIN supplier_payment p USING (payment_id)
     WHERE al.invoice_id = i.invoice_id AND p.status = 'POSTED'
) settled
LEFT JOIN LATERAL (
    SELECT t.due_date
      FROM (SELECT due_date,
                   SUM(amount_minor) OVER (ORDER BY due_date, seq) AS through
              FROM supplier_invoice_payment_term
             WHERE invoice_id = i.invoice_id) t
     WHERE t.through > settled.paid_minor
     ORDER BY t.due_date
     LIMIT 1
) upcoming ON true;

COMMENT ON VIEW supplier_invoice_standing IS
    'Where a bill stands: what is outstanding, what falls due next, and whether it is late. next_due_date is the EARLIEST UNPAID instalment — not ERPNext''s max() — because the question an AP office asks is what must be paid next.';

-- ---------------------------------------------------------------------------
-- Backfill: every dated bill becomes a schedule of one
-- ---------------------------------------------------------------------------
--
-- One instalment at 100% carrying the bill's own due date, so a bill that
-- always fell due once still does and nothing on screen moves.
--
-- Bills with no `due_date` are left with no schedule rather than given an
-- invented one. The view falls back to `i.due_date` for them, which is NULL,
-- which is what they have always said.
INSERT INTO supplier_invoice_payment_term
    (invoice_payment_term_id, invoice_id, seq, label, due_date, portion_bps, amount_minor)
SELECT gen_random_uuid(), i.invoice_id, 1, 'Full amount', i.due_date, 10000, i.total_minor
  FROM supplier_invoice i
 WHERE i.due_date IS NOT NULL;
