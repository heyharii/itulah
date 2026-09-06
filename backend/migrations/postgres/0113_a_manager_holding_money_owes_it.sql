-- 0113: Operating funds, and the one account that says a manager is holding
--       head office's money.
--
-- # What this replaces
--
-- An earlier draft of this lane called these "uang muka toko" and posted them
-- to the client's `1011303 UANG MUKA / ADVANCED` leaves — Travelling,
-- Purchase, To Contractors. That was the wrong account and the wrong idea. An
-- *advance* in that heading is money paid out ahead of a known cost, and it is
-- discharged by a receipt. What a store manager holds is not that: it is a
-- float, held on the company's behalf, in a personal bank account, over an
-- indefinite period, and discharged by an accounting rather than by a
-- purchase. The client's chart already knows the difference and keeps a
-- separate leaf for it.
--
--   1011102001  PIUTANG PEGAWAI        what an employee personally owes us
--   1011102002  PIUTANG KEPALA TOKO    what a manager is holding for us
--
-- Both verified against the client's own export. They read almost the same and
-- they are not the same debt; the second is the only account this migration
-- touches, and `store_manager_receivable` is its semantic key.
--
-- # There is no company bank account at a shop
--
-- Every bank account in this business belongs to head office. When head office
-- funds a shop, the money goes to the store manager's PERSONAL account,
-- because that is what actually happens and modelling anything else would
-- produce a set of books that does not describe the business.
--
--   Dr store_manager_receivable [the shop]  /  Cr bank [dc, qualified]
--
-- The manager's account number is on `operating_fund` as three plain text
-- columns and is **payout metadata**. It is not a `bank_account` row, it is
-- not in the chart of accounts, and nothing resolves it through `account_map`.
-- A personal account that became a Bank Account would appear on the cash
-- position of a company that does not own it.
--
-- # The equation
--
--     sent = settled payments + approved direct expenses + returned + outstanding
--
-- and `outstanding` is the same number three ways over: the sum of open
-- `operating_fund` rows, the Payment Ledger's outstanding for
-- `store_manager_receivable`, and that account's GL balance. Three readings
-- that agree because they are the same postings read three ways, not because
-- somebody reconciled them.
--
-- # Why the Payment Ledger and not a column
--
-- Because "what does this manager still owe an accounting for" is a
-- receivable with an ageing, and this system has exactly one place for those.
-- Sending funds calls `ple_open` with `party_type = EMPLOYEE`, the custodian
-- as the party and `voucher_kind = 'ADVANCE'`; every settlement calls
-- `ple_settle`. So a manager's float ages beside the card acquirers and the
-- supplier balances, on the same screen, with the same arithmetic — instead of
-- in a `spent_minor` column that would disagree with the ledger the first time
-- an expense was rejected after being approved.
--
-- # The postings
--
--   send              Dr store_manager_receivable [site] / Cr bank [dc]
--   pay a bill        Dr trade_payable                    / Cr store_manager_receivable [site]
--   pay wages         Dr payroll_payable                  / Cr store_manager_receivable [site]
--   direct expense    Dr <expense key> [site]             / Cr store_manager_receivable [site]
--   hand money back   Dr bank [dc]                        / Cr store_manager_receivable [site]
--
-- Note what is NOT among them: a second salary expense. Wages were recognised
-- when payroll was finalised; paying them through a manager discharges the
-- payable and nothing else. See `payroll_payout_task` at the bottom.
--
-- The cross-site legs that make each location balance on its own are the
-- poster's job. Nothing in this lane writes an affiliate line.

-- ---------------------------------------------------------------------------
-- Money sent to a custodian
-- ---------------------------------------------------------------------------

CREATE TABLE operating_fund (
    fund_id        uuid PRIMARY KEY,
    -- `OF-26-09-00001`, from the gapless counter in 0110.
    fund_number    text NOT NULL UNIQUE CHECK (btrim(fund_number) <> ''),

    site_id        text NOT NULL REFERENCES site(id),
    -- Who is holding it. A person, always — not a place. A shop cannot be
    -- asked to account for anything; the manager can. This is the party the
    -- Payment Ledger item is opened against, and the person a handover moves
    -- the balance away from.
    custodian_employee_id text NOT NULL REFERENCES employee(id),

    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    -- Kept by trigger from `fund_settlement`, so the header cannot disagree
    -- with its parts. Both are derived for the same reason `returned_minor`
    -- was moved out of the earlier draft's column: a stored total that a code
    -- path maintains is a total that a second code path forgets.
    settled_minor  bigint NOT NULL DEFAULT 0 CHECK (settled_minor >= 0),
    returned_minor bigint NOT NULL DEFAULT 0 CHECK (returned_minor >= 0),
    currency       char(3) NOT NULL DEFAULT 'IDR',

    -- Which head-office account it left. A meaning and a qualifier, never a
    -- client account code: a code stored here is a second copy of
    -- `account_map`, and it still names last year's BCA account the day
    -- Finance moves it.
    bank_key       text NOT NULL CHECK (bank_key IN ('bank_giro', 'bank_savings')),
    bank_qualifier text NOT NULL CHECK (btrim(bank_qualifier) <> ''),
    -- Which location's bank. Head office; kept explicit so the posting rule
    -- does not have to guess which site is the DC.
    bank_site_id   text NOT NULL REFERENCES site(id),

    -- Where it was actually sent: the custodian's own account.
    --
    -- Three plain columns and no foreign key anywhere, because this is not a
    -- company bank account and must never be mistaken for one. It exists so
    -- somebody can repeat the transfer and so a bank line can be recognised —
    -- nothing resolves it, nothing posts to it, nothing sums it.
    payout_bank_name    text NOT NULL CHECK (btrim(payout_bank_name) <> ''),
    payout_account_no   text NOT NULL CHECK (btrim(payout_account_no) <> ''),
    payout_account_name text NOT NULL CHECK (btrim(payout_account_name) <> ''),

    -- SENT     the money has gone and nothing has come back
    -- PARTIAL  some of it has been accounted for
    -- CLOSED   outstanding is nil; the custodian owes no accounting
    status         text NOT NULL CHECK (status IN ('SENT', 'PARTIAL', 'CLOSED')),

    sent_by        text NOT NULL CHECK (btrim(sent_by) <> ''),
    sent_at        timestamptz NOT NULL DEFAULT now(),
    value_date     date NOT NULL,
    -- When it has to be accounted for. What makes an ageing possible, which is
    -- the only thing that makes a float come back.
    due_date       date,

    journal_entry_id uuid NOT NULL REFERENCES journal_entry(entry_id),
    -- The Payment Ledger item this opened. Kept so a settlement can allocate
    -- against it by id rather than by searching for the manager's oldest open
    -- balance and hoping.
    payment_ledger_entry_id uuid,

    closed_at      timestamptz,
    note           text,

    CHECK (settled_minor + returned_minor <= amount_minor),
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

CREATE INDEX ix_operating_fund_site ON operating_fund (site_id, value_date DESC);
CREATE INDEX ix_operating_fund_custodian ON operating_fund (custodian_employee_id, status);
-- The ageing list: still outstanding, and past its date.
CREATE INDEX ix_operating_fund_open ON operating_fund (due_date)
    WHERE status <> 'CLOSED';

COMMENT ON TABLE operating_fund IS
    'Head office money in a store manager''s hands, accountable through '
    '1011102002 PIUTANG KEPALA TOKO. The payout columns are the custodian''s '
    'personal account: metadata, never a bank account and never a COA account.';
COMMENT ON COLUMN operating_fund.payout_account_no IS
    'The custodian''s personal account, for repeating the transfer and '
    'recognising the bank line. Nothing resolves, posts to, or sums it.';

-- ---------------------------------------------------------------------------
-- What the money is earmarked for
-- ---------------------------------------------------------------------------
--
-- A fund is sent for reasons, and the reasons are what a manager is later
-- asked about. Separating them from the fund lets one transfer cover this
-- month's wages and a supplier who will only take cash, which is what actually
-- happens, without either purpose losing its own reference and its own
-- accounting.
CREATE TABLE fund_allocation (
    allocation_id  uuid PRIMARY KEY,
    fund_id        uuid NOT NULL REFERENCES operating_fund(fund_id) ON DELETE CASCADE,

    -- PAYROLL           wages for a run head office has already finalised
    -- VENDOR_PAYMENT    a bill somebody at the shop will settle in person
    -- STORE_OPERATIONS  an approved purpose with no single document behind it
    purpose_kind   text NOT NULL CHECK (purpose_kind IN
                       ('PAYROLL', 'VENDOR_PAYMENT', 'STORE_OPERATIONS')),
    -- What it points at, said as a kind and a reference rather than three
    -- nullable foreign keys. STORE_OPERATIONS points at an approval, which is
    -- a decision and not a row.
    reference_kind text NOT NULL CHECK (reference_kind IN
                       ('PAYROLL_RUN', 'SUPPLIER_INVOICE', 'APPROVED_PURPOSE')),
    reference_id   text NOT NULL CHECK (btrim(reference_id) <> ''),
    -- In words. The reference says which document; this says what anybody has
    -- to account for.
    purpose        text NOT NULL CHECK (btrim(purpose) <> ''),

    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),

    -- OPEN    money earmarked, nothing spent against it
    -- PARTIAL something has been
    -- CLOSED  fully accounted for, or the remainder released
    status         text NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'PARTIAL', 'CLOSED')),

    created_by     text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at     timestamptz NOT NULL DEFAULT now(),

    -- The three purposes each keep their own company. A payroll allocation
    -- that pointed at a supplier invoice would produce a payout list built
    -- from the wrong document.
    CHECK ((purpose_kind = 'PAYROLL') = (reference_kind = 'PAYROLL_RUN')),
    CHECK ((purpose_kind = 'VENDOR_PAYMENT') = (reference_kind = 'SUPPLIER_INVOICE'))
);

CREATE INDEX ix_fund_allocation_fund ON fund_allocation (fund_id);
CREATE INDEX ix_fund_allocation_reference ON fund_allocation (reference_kind, reference_id);

COMMENT ON TABLE fund_allocation IS
    'What a fund was earmarked for. One transfer may carry several purposes, '
    'each with its own reference and its own accounting.';

-- The allocations on one fund may not promise more than the fund carries.
CREATE FUNCTION fund_allocation_within_fund() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    sent      bigint;
    allocated bigint;
BEGIN
    SELECT f.amount_minor INTO sent
      FROM operating_fund f WHERE f.fund_id = NEW.fund_id FOR UPDATE;

    SELECT COALESCE(SUM(a.amount_minor), 0) INTO allocated
      FROM fund_allocation a
     WHERE a.fund_id = NEW.fund_id
       AND a.allocation_id <> NEW.allocation_id
       AND a.status <> 'CLOSED';

    IF allocated + NEW.amount_minor > sent THEN
        RAISE EXCEPTION
            'fund % carries %; allocations already promise % and this one would take it past that',
            NEW.fund_id, sent, allocated;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER fund_allocation_within_fund
    BEFORE INSERT OR UPDATE ON fund_allocation
    FOR EACH ROW EXECUTE FUNCTION fund_allocation_within_fund();

-- ---------------------------------------------------------------------------
-- Accounting for it
-- ---------------------------------------------------------------------------
--
-- Every rupiah that leaves the custodian's hands, in one shape, whatever it
-- was spent on. One table rather than four, because the equation has to close
-- over all of them and an equation that had to union four tables is one
-- somebody eventually writes with three.
--
-- Each row has posted, and each row has called `ple_settle`. A settlement with
-- no journal entry would be a manager's claim; the point of this table is that
-- it is a fact in the books.
CREATE TABLE fund_settlement (
    settlement_id  uuid PRIMARY KEY,
    fund_id        uuid NOT NULL REFERENCES operating_fund(fund_id),
    -- Which earmark it discharges. Null for a return: handing money back
    -- settles the fund itself, not any particular purpose.
    allocation_id  uuid REFERENCES fund_allocation(allocation_id),

    -- VENDOR_BILL     the manager paid a supplier invoice   Dr trade_payable
    -- PAYROLL         the manager paid wages                Dr payroll_payable
    -- DIRECT_EXPENSE  an approved cost with no bill         Dr <expense key>
    -- RETURN          the money came back                   Dr bank
    kind           text NOT NULL CHECK (kind IN
                       ('VENDOR_BILL', 'PAYROLL', 'DIRECT_EXPENSE', 'RETURN')),
    -- What it was: a `supplier_invoice.invoice_id`, a `payroll_run.id`, a
    -- `store_expense.expense_id`, or a bank reference for a return.
    reference_id   text,
    -- Which expense meaning a direct expense landed in. Constrained to the
    -- same nine 0114 allows, because these two are the only ways a shop's
    -- operating cost reaches the books and they must land in the same places.
    expense_key    text,

    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    settled_on     date NOT NULL,
    settled_by     text NOT NULL CHECK (btrim(settled_by) <> ''),
    settled_at     timestamptz NOT NULL DEFAULT now(),

    journal_entry_id uuid NOT NULL REFERENCES journal_entry(entry_id),
    proof_file_id  uuid REFERENCES stored_file(file_id),
    note           text,

    -- A direct expense names the account it lands in; nothing else may.
    CHECK ((expense_key IS NOT NULL) = (kind = 'DIRECT_EXPENSE')),
    CHECK (expense_key IS NULL OR expense_key IN (
        'expense_electricity', 'expense_water', 'expense_telephone',
        'expense_household', 'expense_stationery', 'expense_repairs',
        'expense_transport', 'expense_cleaning', 'expense_misc')),
    -- A return discharges the fund, not an earmark.
    CHECK (kind <> 'RETURN' OR allocation_id IS NULL)
);

CREATE INDEX ix_fund_settlement_fund ON fund_settlement (fund_id, settled_on);
CREATE INDEX ix_fund_settlement_allocation ON fund_settlement (allocation_id)
    WHERE allocation_id IS NOT NULL;

COMMENT ON TABLE fund_settlement IS
    'One accounting against a fund: a bill paid, wages paid, an approved '
    'direct expense, or money handed back. Every row has posted and every row '
    'has settled its payment ledger item.';

-- The fund's totals follow its settlements, and its status follows the totals.
--
-- AFTER and row-level: the CHECK on the parent has to see the new totals, and
-- it is the row constraint that refuses an over-accounting rather than a
-- read-then-write in Rust that two concurrent settlements would both pass.
CREATE FUNCTION operating_fund_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target uuid := COALESCE(NEW.fund_id, OLD.fund_id);
    spent  bigint;
    back   bigint;
    sent   bigint;
BEGIN
    SELECT COALESCE(SUM(s.amount_minor) FILTER (WHERE s.kind <> 'RETURN'), 0),
           COALESCE(SUM(s.amount_minor) FILTER (WHERE s.kind =  'RETURN'), 0)
      INTO spent, back
      FROM fund_settlement s WHERE s.fund_id = target;

    SELECT f.amount_minor INTO sent FROM operating_fund f WHERE f.fund_id = target;

    UPDATE operating_fund f
       SET settled_minor  = spent,
           returned_minor = back,
           status = CASE
               WHEN spent + back >= sent THEN 'CLOSED'
               WHEN spent + back > 0     THEN 'PARTIAL'
               ELSE 'SENT'
           END,
           closed_at = CASE WHEN spent + back >= sent
                            THEN COALESCE(f.closed_at, now())
                            ELSE NULL END
     WHERE f.fund_id = target;
    RETURN NULL;
END;
$$;

CREATE TRIGGER operating_fund_totals
    AFTER INSERT OR UPDATE OR DELETE ON fund_settlement
    FOR EACH ROW EXECUTE FUNCTION operating_fund_totals();

-- ---------------------------------------------------------------------------
-- Paying wages through the manager
-- ---------------------------------------------------------------------------
--
-- When a payroll run is funded through an allocation, the manager gets a list:
-- who, how much, paid or not, and evidence. Nothing else.
--
-- Look at what this table does not have. No gross, no base, no allowance, no
-- tax, no BPJS, no deduction, no rate. Not hidden behind a permission — ABSENT,
-- because a column that exists is a column that reaches a screen the day
-- somebody adds a `SELECT *`. The manager is handing over an envelope; the
-- calculation is head office's and the employee's, and the only figure the
-- errand needs is the one in the envelope.
CREATE TABLE payroll_payout_task (
    task_id        uuid PRIMARY KEY,
    allocation_id  uuid NOT NULL REFERENCES fund_allocation(allocation_id) ON DELETE CASCADE,
    -- Repeated from the allocation so the list can be read without a join, and
    -- checked against it by the trigger below so the copy cannot drift.
    run_id         text NOT NULL REFERENCES payroll_run(id),
    employee_id    text NOT NULL REFERENCES employee(id),

    -- What to hand over. The only money on this row.
    net_minor      bigint NOT NULL CHECK (net_minor > 0),
    currency       char(3) NOT NULL DEFAULT 'IDR',

    status         text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
    paid_by        text,
    paid_at        timestamptz,
    -- The signature, or the photograph of it.
    proof_file_id  uuid REFERENCES stored_file(file_id),
    fail_reason    text,
    -- Which accounting entry covered this payment.
    settlement_id  uuid REFERENCES fund_settlement(settlement_id),

    -- One person, one line, one payroll allocation.
    UNIQUE (allocation_id, employee_id),

    CHECK ((paid_by IS NULL) = (paid_at IS NULL)),
    CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
    CHECK ((status = 'FAILED') = (fail_reason IS NOT NULL))
);

CREATE INDEX ix_payroll_payout_run ON payroll_payout_task (run_id, status);
CREATE INDEX ix_payroll_payout_pending ON payroll_payout_task (allocation_id)
    WHERE status = 'PENDING';

COMMENT ON TABLE payroll_payout_task IS
    'What a store manager has to hand to whom. Net amount only: no gross, no '
    'tax, no BPJS, no deduction — those columns are absent rather than hidden.';

-- A payout task belongs to a payroll allocation, and to the run that
-- allocation names.
CREATE FUNCTION payroll_payout_matches_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    kind      text;
    reference text;
BEGIN
    SELECT a.purpose_kind, a.reference_id INTO kind, reference
      FROM fund_allocation a WHERE a.allocation_id = NEW.allocation_id;

    IF kind IS DISTINCT FROM 'PAYROLL' THEN
        RAISE EXCEPTION
            'allocation % is a % allocation; a payout list needs a PAYROLL one',
            NEW.allocation_id, COALESCE(kind, 'missing');
    END IF;
    IF reference IS DISTINCT FROM NEW.run_id THEN
        RAISE EXCEPTION
            'allocation % funds payroll run %, not %',
            NEW.allocation_id, reference, NEW.run_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payroll_payout_matches_allocation
    BEFORE INSERT OR UPDATE ON payroll_payout_task
    FOR EACH ROW EXECUTE FUNCTION payroll_payout_matches_allocation();

-- ---------------------------------------------------------------------------
-- When the manager changes
-- ---------------------------------------------------------------------------
--
-- A store manager leaves and somebody else takes the shop. The float does not
-- go with them and it does not disappear: it moves to the new custodian, in a
-- document both of them sign.
--
-- The GENERAL ledger account does not change — it is `1011102002` at that shop
-- either way — so the entry this posts debits and credits the same account,
-- carrying both names in its memos. That looks like a no-op and is not: the
-- movement is in the PAYMENT ledger, which knows the party. `ple_settle`
-- discharges the outgoing custodian's open items and `ple_open` raises the
-- same total against the incoming one, both against this entry, so the ageing
-- report changes hands in one transaction and the GL balance never moves.
--
-- Written down rather than done by an UPDATE to `operating_fund.custodian_employee_id`
-- for one reason: an update would rewrite history. The funds the first manager
-- signed for would silently read as though the second one always had them, and
-- the question an auditor actually asks — who was holding this in March —
-- would have no answer at all.
CREATE TABLE custodian_handover (
    handover_id    uuid PRIMARY KEY,
    -- `HO-26-09-00001`.
    handover_number text NOT NULL UNIQUE CHECK (btrim(handover_number) <> ''),

    site_id        text NOT NULL REFERENCES site(id),
    from_employee_id text NOT NULL REFERENCES employee(id),
    to_employee_id   text NOT NULL REFERENCES employee(id),

    -- What was outstanding on the day, as counted. Checked against the Payment
    -- Ledger before it may be signed, so a handover cannot quietly move a
    -- different number from the one the books hold.
    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    currency       char(3) NOT NULL DEFAULT 'IDR',
    handover_date  date NOT NULL,

    -- DRAFT   prepared, one or neither signature
    -- SIGNED  both have signed; posted, and the ledger has changed hands
    -- VOID    abandoned before both signed
    status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'SIGNED', 'VOID')),

    -- Both, separately. A handover one person signed is a claim about somebody
    -- else's debt.
    from_signed_by text,
    from_signed_at timestamptz,
    to_signed_by   text,
    to_signed_at   timestamptz,

    journal_entry_id uuid REFERENCES journal_entry(entry_id),
    prepared_by    text NOT NULL CHECK (btrim(prepared_by) <> ''),
    prepared_at    timestamptz NOT NULL DEFAULT now(),
    note           text,
    void_reason    text,

    -- A float does not hand over to the person already holding it.
    CHECK (from_employee_id <> to_employee_id),
    CHECK ((from_signed_by IS NULL) = (from_signed_at IS NULL)),
    CHECK ((to_signed_by IS NULL) = (to_signed_at IS NULL)),
    CHECK ((status = 'SIGNED') =
           (from_signed_at IS NOT NULL AND to_signed_at IS NOT NULL)),
    CHECK ((journal_entry_id IS NOT NULL) = (status = 'SIGNED')),
    CHECK ((status = 'VOID') = (void_reason IS NOT NULL))
);

CREATE INDEX ix_custodian_handover_site ON custodian_handover (site_id, handover_date DESC);
CREATE INDEX ix_custodian_handover_person
    ON custodian_handover (from_employee_id, to_employee_id);

COMMENT ON TABLE custodian_handover IS
    'A store manager''s outstanding float moving to the next manager, signed '
    'by both. The GL account is unchanged; the payment ledger party is not.';

-- Which funds a signed handover carried across.
--
-- A list rather than a total, because the outstanding balance is several funds
-- of different ages and an ageing report that lost their dates at handover
-- would restart the clock on every one of them.
CREATE TABLE custodian_handover_item (
    handover_id  uuid NOT NULL REFERENCES custodian_handover(handover_id) ON DELETE CASCADE,
    fund_id      uuid NOT NULL REFERENCES operating_fund(fund_id),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    PRIMARY KEY (handover_id, fund_id)
);

COMMENT ON TABLE custodian_handover_item IS
    'Which outstanding funds a handover moved, and for how much each. A list '
    'rather than a total, so ageing survives the change of hands.';

-- ---------------------------------------------------------------------------
-- The Payment Ledger, until the Payment Ledger arrives
-- ---------------------------------------------------------------------------
--
-- TODO(lane-P): the Payment Ledger is `payment_ledger_item` and
-- `payment_ledger_allocation`, migrations 0143-0145, with `ple_open` and
-- `ple_settle` in `postgres/payment_ledger.rs`. It is not merged into this
-- branch. These two tables are the same shape under a different name, written
-- and read only through `lane_b_ple_open` / `lane_b_ple_settle` in
-- `postgres/store_money.rs`, whose arguments already match Lane P's
-- signatures.
--
-- When that lane lands, both functions become one call each and this migration
-- loses these two tables and their rows are re-opened from the funds. They are
-- here rather than absent because the equation this lane has to prove —
-- Σ open funds = payment ledger outstanding = the GL balance of Piutang Kepala
-- Toko — needs three readings to compare, and a test that compared two of them
-- and asserted the third would be proving nothing.
--
-- They are deliberately named so that nobody mistakes them for the real thing.
CREATE TABLE store_ledger_shim (
    shim_entry_id    uuid PRIMARY KEY,
    account_key      text NOT NULL,
    qualifier        text NOT NULL DEFAULT '',
    site_id          text NOT NULL REFERENCES site(id),
    party_type       text NOT NULL,
    party_id         text NOT NULL,
    party_name       text,
    voucher_kind     text NOT NULL,
    voucher_id       text NOT NULL,
    journal_entry_id uuid NOT NULL REFERENCES journal_entry(entry_id),
    side             text NOT NULL CHECK (side IN ('RECEIVABLE', 'PAYABLE')),
    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    settled_minor    bigint NOT NULL DEFAULT 0 CHECK (settled_minor >= 0),
    currency         char(3) NOT NULL DEFAULT 'IDR',
    due_date         date,
    posting_date     date NOT NULL,
    created_by       text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (settled_minor <= amount_minor)
);

CREATE INDEX ix_store_ledger_shim_open
    ON store_ledger_shim (account_key, site_id, party_id)
    WHERE settled_minor < amount_minor;

CREATE TABLE store_ledger_shim_allocation (
    shim_entry_id        uuid NOT NULL REFERENCES store_ledger_shim(shim_entry_id)
                              ON DELETE CASCADE,
    against_voucher_kind text NOT NULL,
    against_voucher_id   text NOT NULL,
    journal_entry_id     uuid NOT NULL REFERENCES journal_entry(entry_id),
    posting_date         date NOT NULL,
    amount_minor         bigint NOT NULL CHECK (amount_minor >= 0),
    created_by           text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    -- One settlement puts money against one item once. A retry is a no-op
    -- rather than a second payment.
    PRIMARY KEY (shim_entry_id, against_voucher_kind, against_voucher_id)
);

COMMENT ON TABLE store_ledger_shim IS
    'A stand-in for the Payment Ledger (lane P, migrations 0143-0145) so this '
    'lane can prove its equation before that one merges. Written only through '
    'lane_b_ple_open / lane_b_ple_settle, whose arguments match ple_open and '
    'ple_settle exactly.';
