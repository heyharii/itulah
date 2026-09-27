-- An advance can be repaid from the wage.
--
-- The mechanism 0250 anticipated in prose — "a *kasbon* instalment is a
-- positive amount under a DEDUCTION component" — but nothing linked a
-- payroll_adjustment to the advance it repays, so the outstanding never
-- moved. This adds the link, and the settlement the approval produces.
--
-- # The settlement's honest shape
--
-- A PAYROLL settlement has no journal of its own: the deduction moves inside
-- the payout envelope and the handover, so the entry reference is the one
-- thing it must not pretend to have. `entry_id` therefore stops being NOT
-- NULL, and the new CHECK pins it the other way — PAYROLL has none, and
-- anything with an entry is not PAYROLL.
--
-- # Provenance, both directions
--
-- The settlement remembers which adjustment repaid it, so a reopen can take
-- back exactly what one run's approval made; the adjustment remembers which
-- advance it repays, so filing can refuse what there is nothing to repay.
-- The DEDUCTION direction itself is not pinned here: the component's kind is
-- a fact of the pay_component row the adjustment already references, and SQL
-- cannot see it — it is enforced at filing, in the domain, where that row is
-- loaded anyway.

ALTER TABLE advance_settlement
    ALTER COLUMN entry_id DROP NOT NULL,
    DROP CONSTRAINT advance_settlement_kind_check,
    ADD CONSTRAINT advance_settlement_kind
        CHECK (kind IN ('EXPENSE', 'REFUND', 'PAYROLL')),
    ADD CONSTRAINT advance_settlement_entry_only_when_it_has_one
        CHECK ((kind = 'PAYROLL') = (entry_id IS NULL));

-- Which adjustment repaid it, when the wage did. Set only on a PAYROLL row,
-- so the CHECK mirrors the entry one.
ALTER TABLE advance_settlement
    ADD COLUMN payroll_adjustment_id text REFERENCES payroll_adjustment (id),
    ADD CONSTRAINT advance_settlement_payroll_only_when_it_is_one
        CHECK ((kind = 'PAYROLL') = (payroll_adjustment_id IS NOT NULL));

-- The reopen deletes by it, and it is the only door.
CREATE INDEX IF NOT EXISTS ix_advance_settlement_payroll_adjustment
    ON advance_settlement (payroll_adjustment_id)
    WHERE payroll_adjustment_id IS NOT NULL;

-- 0280's comment said "each with the entry it posted", which a PAYROLL
-- settlement never had.
COMMENT ON TABLE advance_settlement IS
    'What came back: receipts (EXPENSE), change (REFUND), or the wage line '
    'that repaid it (PAYROLL) — the last with no entry of its own, because '
    'the deduction moved inside the payout envelope and the handover (0347).';

-- The advance a filed figure repays, when it is one.
ALTER TABLE payroll_adjustment
    ADD COLUMN advance_id uuid REFERENCES advance (advance_id);

-- A recovery rides a DEDUCTION: money coming BACK out of a wage can never be
-- an earning. The component's kind is pinned by the row's own foreign key to
-- pay_component (code, basis); the direction is pinned at filing, in the
-- domain — this keeps SQL to what SQL can see.
ALTER TABLE payroll_adjustment
    ADD CONSTRAINT payroll_adjustment_recovery_is_a_deduction
    CHECK (advance_id IS NULL OR basis = 'PER_OCCASION');

COMMENT ON COLUMN payroll_adjustment.advance_id IS
    'The advance this figure repays, when it is one. The DEDUCTION direction '
    'is checked at filing; SQL sees only that a recovery is a one-off (0347).';
