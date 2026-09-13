-- A receipt remembers what it was worth, and says what the order could not take.
--
-- Two defects, one shape. Both come from the same habit: reading a number off
-- a row that is still being edited, instead of writing it down when it was
-- true.
--
-- # The price
--
-- `payable_minor` was computed as `received × purchase_order_line.unit_price_minor`
-- at read time, and approving a price amendment rewrites that column. So a
-- delivery accepted in March quietly became worth more in May, and nothing
-- anywhere recorded that it had changed. The receipt now carries the price
-- that applied when it was accepted, and that number is never edited again.
--
-- An approved amendment does NOT overwrite it. It is recorded beside the
-- receipt as a commercial decision, and Finance derives what it will book from
-- the pair — evidence plus decision. Two truths, both visible: what the
-- warehouse accepted, and what the company later agreed to pay for it.
--
-- # The excess
--
-- Nothing compared accepted quantity against what the order still had
-- outstanding, so a second delivery of 300 against a filled order of 300 read
-- as 600 received and 600 expected to be paid for. The receipt now splits what
-- it accepted into the part the order can take and the part it cannot.
--
-- Both are quantities, not a status on the line. A receipt of 105 against an
-- order of 100 is 100 matched and 5 excess, and Article Setup must be able to
-- take the 100 through while the 5 wait for a buyer — holding up goods the
-- company certainly bought, because five it did not buy came on the same
-- lorry, is not a control anybody wants.
--
-- Nothing here posts to the ledger. The expected value these columns support
-- is an operational estimate; the liability is booked when Finance matches a
-- supplier bill, and not before.

-- ---------------------------------------------------------------------------
-- What the receipt was worth
-- ---------------------------------------------------------------------------

ALTER TABLE goods_receipt_line
    -- The agreed price that applied to THIS acceptance, in the order's
    -- currency. Nullable because rows accepted before this column existed
    -- genuinely do not know, and inventing the order's current price for them
    -- would read as evidence of a decision nobody made.
    ADD COLUMN agreed_unit_price_minor bigint
        CHECK (agreed_unit_price_minor IS NULL OR agreed_unit_price_minor >= 0),
    -- This receipt's share of the order-level discount, allocated when it was
    -- accepted and never recomputed. Allocation is by value, largest remainder,
    -- so the shares of one order add up to its discount exactly.
    ADD COLUMN allocated_discount_minor bigint NOT NULL DEFAULT 0
        CHECK (allocated_discount_minor >= 0);

-- Which count at the DC this line was. The price query a verifier raises
-- names the count; the receipt names nothing, so the centre had no way to say
-- which acceptance a buyer's approval was about. Nullable for lines that
-- arrived before the column existed.
ALTER TABLE goods_receipt_line ADD COLUMN count_id uuid;
CREATE UNIQUE INDEX ux_goods_receipt_line_count ON goods_receipt_line (count_id)
    WHERE count_id IS NOT NULL;

COMMENT ON COLUMN goods_receipt_line.agreed_unit_price_minor IS
    'The price that applied when this delivery was accepted. Never edited: an approved amendment is recorded separately and Finance derives the approved value from both.';
COMMENT ON COLUMN goods_receipt_line.allocated_discount_minor IS
    'This receipt''s share of the order discount, fixed at acceptance. Reference for Finance''s match, not a posted amount.';

-- ---------------------------------------------------------------------------
-- What the order could take, and what it could not
-- ---------------------------------------------------------------------------

ALTER TABLE goods_receipt_line
    ADD COLUMN matched_quantity bigint,
    ADD COLUMN excess_quantity  bigint;

-- Everything accepted before this migration was treated as matched, because
-- that is what every reader assumed at the time. Saying so explicitly is
-- honest; leaving them NULL would make every later query carry a branch for a
-- question nobody can now answer.
UPDATE goods_receipt_line SET matched_quantity = quantity, excess_quantity = 0;

ALTER TABLE goods_receipt_line
    ALTER COLUMN matched_quantity SET NOT NULL,
    ALTER COLUMN excess_quantity  SET NOT NULL,
    ADD CONSTRAINT goods_receipt_line_split_is_the_whole CHECK (
        matched_quantity >= 0
        AND excess_quantity >= 0
        AND matched_quantity + excess_quantity = quantity
    );

COMMENT ON COLUMN goods_receipt_line.matched_quantity IS
    'The part of this acceptance the purchase order still had room for. What the company committed to buy.';
COMMENT ON COLUMN goods_receipt_line.excess_quantity IS
    'The part it did not. Real goods under our roof, commercially unresolved until Procurement decides.';

CREATE INDEX ix_goods_receipt_line_excess ON goods_receipt_line (receipt_line_id)
    WHERE excess_quantity > 0;

-- ---------------------------------------------------------------------------
-- What a buyer decided about the excess
-- ---------------------------------------------------------------------------

-- A table rather than columns on the receipt, because the receipt is evidence
-- of what a warehouse accepted and this is a commercial act by somebody else,
-- days later. Evidence that can be edited by a later decision is not evidence.
CREATE TABLE purchase_excess_decision (
    receipt_line_id uuid PRIMARY KEY
                    REFERENCES goods_receipt_line(receipt_line_id) ON DELETE CASCADE,
    -- KEPT     the company buys them after all; the ordered quantity rises
    -- RETURNED they go back to the supplier
    outcome         text NOT NULL CHECK (outcome IN ('KEPT', 'RETURNED')),
    -- What the company agreed to pay for them, when it keeps them. A supplier
    -- who sends more than was ordered does not thereby set the price.
    agreed_unit_price_minor bigint
        CHECK (agreed_unit_price_minor IS NULL OR agreed_unit_price_minor >= 0),
    reason          text NOT NULL CHECK (btrim(reason) <> ''),
    decided_by      text NOT NULL,
    decided_at      timestamptz NOT NULL DEFAULT now(),
    CHECK ((outcome = 'KEPT') = (agreed_unit_price_minor IS NOT NULL))
);

COMMENT ON TABLE purchase_excess_decision IS
    'A buyer resolving quantity that arrived beyond the order. One decision per receipt line; the receipt itself is never edited.';

-- ---------------------------------------------------------------------------
-- An amendment that answers a delivery, not a column
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_price_amendment
    -- Which acceptance raised this. The request already carried `count_id`,
    -- which is the DC's own identifier for the count; this is the receipt line
    -- that count became, and it is what Finance reads.
    ADD COLUMN receipt_line_id uuid REFERENCES goods_receipt_line(receipt_line_id),
    -- What the buyer approved, kept apart from what the supplier asked for.
    ADD COLUMN approved_unit_price_minor bigint
        CHECK (approved_unit_price_minor IS NULL OR approved_unit_price_minor >= 0),
    -- DELIVERY  the approval settles THIS delivery and nothing else
    -- REMAINING it also becomes the agreed price for quantity not yet received
    --
    -- Two different commercial acts, deliberately not one flag with a default.
    -- A verifier's query is about the lorry in front of them; repricing the
    -- rest of an order is a negotiation, and conflating them is how an order
    -- silently changes value because somebody approved an invoice.
    ADD COLUMN scope text CHECK (scope IS NULL OR scope IN ('DELIVERY', 'REMAINING')),
    ADD CONSTRAINT purchase_price_amendment_approval_says_how_far CHECK (
        (status = 'APPROVED') = (scope IS NOT NULL)
        AND (status = 'APPROVED') = (approved_unit_price_minor IS NOT NULL)
    );

CREATE INDEX ix_price_amendment_receipt_line
    ON purchase_price_amendment (receipt_line_id)
    WHERE receipt_line_id IS NOT NULL;

COMMENT ON COLUMN purchase_price_amendment.scope IS
    'DELIVERY settles the acceptance that raised it; REMAINING also repriced the unreceived quantity. Null while undecided.';

-- ---------------------------------------------------------------------------
-- The lorry that was turned away
-- ---------------------------------------------------------------------------

-- A delivery is the supplier's arrival, not our decision about it. A truckload
-- of soaked cartons that went straight back is a fact about that supplier, and
-- the only place it could be recorded was nowhere: `status` allowed OPEN and
-- CLOSED, nothing ever wrote CLOSED, and a delivery with no accepted line
-- never reached the centre at all.
--
-- CLOSED becomes COMPLETED, because "closed" said nothing about how it ended.
--
-- Both of 0028's rules about `status` are dropped by what they SAY rather than
-- by name: they were written inline, so their names are whatever PostgreSQL
-- generated, and a migration that guesses `goods_receipt_check1` is a
-- migration that fails on the one database whose columns were declared in a
-- different order.
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'goods_receipt'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%CLOSED%'
    LOOP
        EXECUTE format('ALTER TABLE goods_receipt DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

UPDATE goods_receipt SET status = 'COMPLETED' WHERE status = 'CLOSED';

ALTER TABLE goods_receipt
    ADD COLUMN rejected_reason text,
    ADD CONSTRAINT goods_receipt_status_is_known
        CHECK (status IN ('OPEN', 'COMPLETED', 'REJECTED')),
    -- A delivery that is no longer open was ended by somebody, at a moment.
    ADD CONSTRAINT goods_receipt_ended_when_it_ended
        CHECK ((status <> 'OPEN') = (closed_at IS NOT NULL)),
    ADD CONSTRAINT goods_receipt_refusal_says_why CHECK (
        (status = 'REJECTED') = (rejected_reason IS NOT NULL)
        AND (rejected_reason IS NULL OR btrim(rejected_reason) <> '')
    );

COMMENT ON COLUMN goods_receipt.rejected_reason IS
    'Why the whole delivery went back. Present exactly when the delivery was refused; a rejection with no reason is a rumour.';
