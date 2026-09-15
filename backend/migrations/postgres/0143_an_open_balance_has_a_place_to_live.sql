-- 0143: The Payment Ledger. Every balance somebody has to follow until it is
-- settled, in one table, beside the journal entry that put it in the books.
--
-- # Why a third ledger at all
--
-- The architecture keeps three: the General Ledger says what the company is
-- worth, the Stock Ledger says what is on the shelf, and this one says who owes
-- whom and how much of it is still open. Accounts Payable and Accounts
-- Receivable are not ledgers; they are two readings of this table, filtered by
-- side.
--
-- Until now there was no such table, and the absence showed in two places:
--
--   * **Supplier outstanding was worked out afresh on every read**, by
--     subtracting `supplier_payment_allocation` from `supplier_invoice` inside
--     `payables_aging`. It is correct, and it only answers for suppliers. Every
--     new kind of open balance would need its own subtraction written again,
--     against different tables, with its own idea of what "as at" means.
--   * **Acquirer receivable did not exist at all.** A card sale credits sales
--     and debits `card_receivable_debit`, and the money arrives from the
--     acquirer two days later net of a fee. Nothing followed the gap. Nobody
--     could say which day's takings had not landed.
--
-- # The rule for what belongs here, written down because it will be argued
--
-- A row exists here only when an event creates or settles a receivable or a
-- payable whose outstanding balance somebody has to follow over time. Money
-- moving is NOT sufficient reason.
--
--   IN   a supplier bill posted; a supplier payment; a card or QRIS sale
--        (acquirer receivable); an acquirer settlement; head office sending
--        funds to a store manager (Piutang Kepala Toko) and the manager
--        settling or returning them; a payroll payable Finance follows to
--        settlement.
--   OUT  a bank-to-bank transfer, a cash deposit, a bank fee, a remittance
--        order, an ordinary expense paid on the spot, a bank statement line,
--        an asset movement. Each of those is a register or a journal entry.
--        None of them leaves anything open.
--
-- A table that took everything would be a second general ledger with worse
-- constraints.
--
-- # Why the control account is a triple and not an account code
--
-- `(account_key, qualifier, site_id)` is exactly what `account_map` resolves.
-- Storing the resolved code instead would freeze it: Finance moves an account,
-- the map moves with them, and every open item written before the move would
-- go on claiming an account nothing posts to any more. Storing the triple means
-- the entry and its GL control account are asking the map the same question,
-- which is the whole basis of the integrity check in 0145.
--
-- # Why a side and not a sign
--
-- `amount_minor` is always positive and `side` says which way it faces. A
-- signed column would make every query decide, silently and separately, whether
-- a negative payable is a receivable or a mistake — and the two readings would
-- agree until somebody reversed something.

CREATE TABLE payment_ledger_entry (
    entry_id          uuid PRIMARY KEY,

    -- The control account, as the map resolves it. Not the resolved code: see
    -- the header.
    account_key       text NOT NULL CHECK (btrim(account_key) <> ''),
    -- Which bank, which card scheme. Empty when the meaning needs no
    -- narrowing, never NULL, so the unique key below does not have to reason
    -- about NULLs.
    qualifier         text NOT NULL DEFAULT '',
    site_id           text NOT NULL REFERENCES site(id),

    -- Who the balance is with. A supplier and an acquirer are both "the other
    -- party", and a table that had a `supplier_id` column would need a second
    -- one the day the first card settlement arrived.
    party_type        text NOT NULL CHECK (party_type IN
                          ('SUPPLIER', 'ACQUIRER', 'EMPLOYEE', 'CUSTOMER', 'OTHER')),
    party_id          text NOT NULL CHECK (btrim(party_id) <> ''),
    -- Denormalised for reading only. A list of open items that had to join out
    -- to four different party tables to print a name is a list that gets slow
    -- and then gets cached.
    party_name        text,

    -- The document that created the balance. `voucher_id` is text rather than
    -- uuid because the documents that open balances are not all keyed the same
    -- way: a bill is a uuid, a sale day is a date and a site.
    voucher_kind      text NOT NULL CHECK (btrim(voucher_kind) <> ''),
    voucher_id        text NOT NULL CHECK (btrim(voucher_id) <> ''),

    -- The document that settled it. Maintained by 0144 from the settlement
    -- rows, never written by hand: when several documents settled one item the
    -- history is in `payment_ledger_settlement` and this names the last of
    -- them.
    against_voucher_kind text,
    against_voucher_id   text,

    -- The GL entry posted in the same transaction. NOT NULL, and that is the
    -- defining rule of this ledger expressed as a constraint: an open balance
    -- that never reached the books is a number on a screen, and a book entry
    -- with no open item behind it is a balance nobody is following. Neither may
    -- exist alone, so both are written or neither is.
    journal_entry_id  uuid NOT NULL REFERENCES journal_entry(entry_id),

    side              text NOT NULL CHECK (side IN ('RECEIVABLE', 'PAYABLE')),
    amount_minor      bigint NOT NULL CHECK (amount_minor > 0),

    -- What has been allocated against it. Maintained by the trigger in 0144 by
    -- RE-SUMMING the settlement rows, never incremented, so it cannot drift the
    -- way a running total drifts. This is the one place the repository stores a
    -- figure it could derive, and the reason is that following an open balance
    -- IS the purpose of the table: an index on "still open" is what makes an
    -- ageing report over a year of card settlements answerable at all.
    settled_minor     bigint NOT NULL DEFAULT 0 CHECK (settled_minor >= 0),

    -- Generated rather than maintained, so no code path can leave it
    -- disagreeing with the two columns it is made of.
    outstanding_minor bigint GENERATED ALWAYS AS
                          (CASE WHEN delinked THEN 0 ELSE amount_minor - settled_minor END)
                          STORED,

    currency          char(3) NOT NULL DEFAULT 'IDR',

    -- When it falls due, when anybody agreed a date. A card settlement has one
    -- (T+1, T+2); a store manager's float usually has none, and ageing it from
    -- the posting date is the honest answer rather than calling it never due.
    due_date          date,
    -- The date it belongs to in the books, which is the posting date of the
    -- journal entry beside it. Ageing and the "as at" reads both key on this.
    posting_date      date NOT NULL,

    -- Cancellation. The row is kept and stops counting, rather than being
    -- deleted: an open item that was raised and reversed is a thing that
    -- happened, and a ledger that could forget it could not explain a
    -- reversing journal entry sitting next to it in the books.
    delinked          boolean NOT NULL DEFAULT false,
    delinked_reason   text,
    delinked_by       text,
    delinked_at       timestamptz,
    -- The date the cancellation belongs to in the books, beside `delinked_at`
    -- which is only the moment somebody clicked. Without it an "as at last
    -- month end" read could not tell a balance that was open then from one
    -- cancelled since, and would quietly disagree with a general ledger where
    -- the reversing entry has a posting date of its own.
    delinked_on       date,

    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        text NOT NULL CHECK (btrim(created_by) <> ''),

    -- Over-settlement is impossible in the database, not only in Rust. The
    -- trigger in 0144 refuses it with a sentence a person can read; this is
    -- what still holds when somebody opens psql.
    CHECK (settled_minor <= amount_minor),
    CHECK ((against_voucher_kind IS NULL) = (against_voucher_id IS NULL)),
    CHECK (delinked = (delinked_at IS NOT NULL)),
    CHECK (delinked = (delinked_by IS NOT NULL)),
    CHECK (delinked = (delinked_on IS NOT NULL)),
    CHECK (due_date IS NULL OR due_date >= posting_date),

    -- Idempotence, as a constraint rather than as a check somebody remembers to
    -- write. A posting rule that runs twice — a retried command, a replayed
    -- sync batch — must not open the balance twice, and `ple_open` leans on
    -- this: it inserts ON CONFLICT DO NOTHING and hands back the row that was
    -- already there.
    --
    -- The grain is the document, the meaning and the party. A voucher that
    -- genuinely opens two balances on one control account says so by naming two
    -- parties, which every real case already does: a sale day's card receivable
    -- is per acquirer, a payroll payable is per employee.
    UNIQUE (voucher_kind, voucher_id, account_key, party_type, party_id)
);

-- The control account, which is how Finance reads it: what does
-- `trade_payable` at this shop come to.
CREATE INDEX ix_payment_ledger_control
    ON payment_ledger_entry (account_key, site_id, qualifier);
-- The party, which is how everybody else reads it: what do we owe this
-- supplier, what has this acquirer not paid us.
CREATE INDEX ix_payment_ledger_party
    ON payment_ledger_entry (party_type, party_id);
-- The document, which is how a screen showing a bill answers "and what is
-- still open against it".
CREATE INDEX ix_payment_ledger_voucher
    ON payment_ledger_entry (voucher_kind, voucher_id);
-- Open items, which is every ageing report and every allocation screen. Partial
-- on purpose: a settled item is most of the table within a year and none of the
-- question.
CREATE INDEX ix_payment_ledger_open
    ON payment_ledger_entry (account_key, site_id, qualifier, due_date, posting_date)
    WHERE outstanding_minor > 0;
-- Back to the books from the ledger, for the integrity read and for anybody
-- asking which entry a balance came from.
CREATE INDEX ix_payment_ledger_journal
    ON payment_ledger_entry (journal_entry_id);

COMMENT ON TABLE payment_ledger_entry IS
    'The Payment Ledger: one row per receivable or payable whose outstanding balance is followed until it is settled. Accounts Payable and Accounts Receivable are views over this, not separate ledgers. Money moving is not sufficient reason for a row — a bank transfer, a bank fee and a paid-on-the-spot expense all leave nothing open and belong in the journal alone.';
COMMENT ON COLUMN payment_ledger_entry.account_key IS
    'The semantic key of the control account, resolved through account_map with qualifier and site_id — the same triple a posting rule names, so the entry and its GL account can be compared.';
COMMENT ON COLUMN payment_ledger_entry.journal_entry_id IS
    'The GL entry written in the same transaction. NOT NULL: an open balance that never reached the books, or a book entry with nothing following it, are both states nobody could explain afterwards.';
COMMENT ON COLUMN payment_ledger_entry.settled_minor IS
    'Re-summed from payment_ledger_settlement by trigger, never incremented, so it cannot drift from the rows it summarises.';
COMMENT ON COLUMN payment_ledger_entry.delinked IS
    'Cancelled or reversed. The row is kept and stops counting; deleting it would leave a reversing journal entry with nothing to explain it.';
