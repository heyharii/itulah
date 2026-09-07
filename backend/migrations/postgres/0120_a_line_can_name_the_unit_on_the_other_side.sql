-- 0120: A journal line can say which other unit it is with, and every unit's
-- books have to balance on their own.
--
-- # The dimension
--
-- `journal_line` has carried `site_id` since 0051 and `supplier_id` beside it.
-- Neither can answer the question a shop's bookkeeper asks first about an
-- inter-unit balance: WITH WHOM. The client's own chart answers it by encoding
-- the counterparty in the account name and the owner in the twelve-digit code's
-- last two characters — `201230200101` is "Hutang Affiliasi Atas Barang HEAD
-- OFFICE" kept at C001 — which is precise, unreadable, and useless to a query.
--
-- So the counterparty becomes a column. Nullable, because the overwhelming
-- majority of lines have no other unit: an ordinary sale, an ordinary bill, an
-- ordinary depreciation charge are one unit's business entirely, and a column
-- that forced them to name a second would be a column full of noise.
--
-- This is the same device 0050 used for `ledger_account.counterparty_site_id`
-- on the goods-in-transit matrix, for the same reason and with the same name.
--
-- # The invariant
--
-- The second half of this migration is the one that matters. From here, an
-- entry must balance AT EVERY LOCATION IT TOUCHES, not merely in total.
--
-- 0051 made an entry balance overall and said, correctly, that a ledger which
-- can be left unbalanced by a migration or a second writer is not a ledger. It
-- did not go far enough for this client. Their profit and loss is read per
-- location, and their trial balance with it, so an entry that debits store 01
-- and credits head office passes 0051's check and leaves both sets of books
-- wrong in opposite directions — while the consolidated figures balance
-- perfectly. 0098 and 0084 both named that failure and both answered it by
-- refusing the entry. `domain::interunit` answers it instead: the poster adds
-- the affiliate legs that bring each unit back to zero, and this trigger is
-- what makes that a guarantee rather than a habit.
--
-- A CONSTRAINT TRIGGER and not a CHECK, for the same reason 0051's is: the
-- lines do not exist when the header is inserted. Deferred to COMMIT, so a rule
-- may add its legs in any order.
--
-- Nothing existing is re-validated. A trigger fires on rows written from here
-- on, so the cross-location entries already in the books — an asset transferred
-- between two shops, which `assets.rs` has been posting unbalanced per unit
-- since 0096 — stay exactly as they are and are visible for what they are. A
-- CHECK would have refused to be added at all, which is the other reason this
-- is a trigger.

ALTER TABLE journal_line
    ADD COLUMN counter_site_id text REFERENCES site(id);

-- Only the lines that have one, which is a small fraction of the table. The
-- reads it serves — an inter-unit pair, a shop's own "what we owe head office"
-- — always name a counterparty, and never want the millions of rows that have
-- none.
CREATE INDEX ix_journal_line_counter_site ON journal_line (counter_site_id, site_id)
    WHERE counter_site_id IS NOT NULL;

COMMENT ON COLUMN journal_line.counter_site_id IS
    'The unit on the other side of an inter-unit line: the shop, on head office''s receivable leg, and head office on the shop''s payable leg. NULL on every ordinary line. Written by poster.rs from domain::interunit; never keyed by hand.';

-- ---------------------------------------------------------------------------
-- Invariant four: an entry balances at every location it touches.
-- ---------------------------------------------------------------------------
--
-- P0001 by design, like every other refusal in this schema: `AppError` turns
-- exactly that SQLSTATE into a 409 carrying this message, so what a person
-- reads is the sentence below and not "database operation failed". Setting a
-- more precise-looking ERRCODE makes it a 500. Same convention as 0051.

CREATE OR REPLACE FUNCTION assert_journal_balanced_per_site() RETURNS trigger AS $$
DECLARE
    offender text;
    out_by   bigint;
BEGIN
    SELECT l.site_id, SUM(l.debit_minor - l.credit_minor)
      INTO offender, out_by
      FROM journal_line l
     WHERE l.entry_id = NEW.entry_id
     GROUP BY l.site_id
    HAVING SUM(l.debit_minor - l.credit_minor) <> 0
     ORDER BY l.site_id
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'journal entry % leaves % out by %: an entry that spans two units needs the affiliate legs that bring each one back to zero',
            NEW.entry_id, offender, out_by;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- On the lines only. 0051 needed both tables because an entry with no lines at
-- all is a failure the header trigger has to catch; that one is already caught,
-- and every way of unbalancing a location goes through a line.
CREATE CONSTRAINT TRIGGER journal_line_balances_per_site
    AFTER INSERT ON journal_line
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced_per_site();

COMMENT ON FUNCTION assert_journal_balanced_per_site() IS
    'Every location an entry touches must net to zero. The client reads a trial balance per location, so an entry balanced only in total is wrong in both books at once and right in neither.';
