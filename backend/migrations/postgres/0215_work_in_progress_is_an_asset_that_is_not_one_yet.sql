-- Work in progress is an asset that is not one yet. And a rate is how this
-- client says a life.
--
-- Both of these come from the client's own register, which arrived on
-- 2026-09-13 as `MASTER ASSET.xls`: 1,342 rows, Rp 50.7 billion, purchases
-- from 2016 to 2026, across all fourteen units.
--
-- # Half that register is not an asset
--
-- 668 of the 1,342 rows — Rp 5.65 billion — are `Contract In Progress`: shop
-- fit-outs and renovations being paid for in instalments, sitting in
-- `1031803 Contract In Progress (CIP)` per unit, depreciating nothing, with 23
-- more rows named "REKLAS CIP" showing the move out of it. It is not an edge
-- case; it is the largest single thing in their book by count.
--
-- This module could not hold any of it. An asset here is either capitalised —
-- cost in `10215*`, charged every month — or expensed, and neither is true of
-- a renovation that is half paid for. The cost is real and on the balance
-- sheet; it simply has not become a thing yet.
--
-- So `decision` gains a third value. It is a decision, and it belongs beside
-- the other two rather than in a table of its own: the same person, looking at
-- the same invoice, decides one of three things — this is capital, this is an
-- expense, or this is work that is not finished. And because assessments are
-- append-only, the day the shop opens somebody records a SECOND assessment
-- saying CAPITALIZE, and the sequence carries its own history: parked in
-- February, capitalised in September, and the reason for each.
--
-- What it deliberately does NOT do is post. A capitalised asset's cost is
-- already posted by the bill that bought it; the same is true here, into the
-- CIP account. What the eventual capitalisation has to post is the MOVE —
-- `1031803` out, `10215*` in — and that is a handler, not a constraint.
--
-- # A rate is how this client states a life
--
-- Their register carries `PERSEN` and `UMUR` side by side: 20% and 5 years,
-- 12.5% and 8, 10% and 10, 33.33% and 3, 5% and 20. The two are one fact said
-- twice, and this module has only ever stored the second.
--
-- Storing the rate as well is not redundancy, for the reason ERPNext keeps
-- both on `Asset Finance Book`: for a straight line the life leads and the
-- rate is arithmetic, and for a declining balance the RATE leads — 20% of the
-- carrying amount every year has no "life" until it is calculated backwards.
-- More plainly: their accountants say "dua puluh persen", their forms are
-- printed with a `%` column, and a system that can only be told "sixty months"
-- makes them convert before they can type.
--
-- Basis points rather than a decimal: 33.33% is `3333`, and integers do not
-- drift. The life stays the value the arithmetic uses — see
-- `domain::depreciation` — so nothing downstream changes.

-- ---------------------------------------------------------------------------
-- The third decision
-- ---------------------------------------------------------------------------

ALTER TABLE asset_capitalization
    DROP CONSTRAINT asset_capitalization_decision_check,
    ADD CONSTRAINT asset_capitalization_decision_check
        CHECK (decision IN ('CAPITALIZE', 'EXPENSE', 'IN_PROGRESS'));

-- A capitalised row carries a COMPLETE basis, an expensed one carries none,
-- and work in progress carries the cost and nothing else: no life, no method,
-- no in-service date, because none of those is known until it is finished.
ALTER TABLE asset_capitalization
    DROP CONSTRAINT asset_capitalization_check,
    ADD CONSTRAINT asset_capitalization_check CHECK (
        (decision = 'CAPITALIZE'
            AND capitalized_cost_minor IS NOT NULL AND capitalized_cost_minor > 0
            AND salvage_value_minor IS NOT NULL AND salvage_value_minor >= 0
            AND salvage_value_minor < capitalized_cost_minor
            AND useful_life_months IS NOT NULL AND useful_life_months >= 0
            AND method IS NOT NULL
            AND in_service_on IS NOT NULL)
        OR (decision = 'EXPENSE'
            AND capitalized_cost_minor IS NULL AND salvage_value_minor IS NULL
            AND useful_life_months IS NULL AND method IS NULL
            AND in_service_on IS NULL)
        OR (decision = 'IN_PROGRESS'
            AND capitalized_cost_minor IS NOT NULL AND capitalized_cost_minor > 0
            AND salvage_value_minor IS NULL
            AND useful_life_months IS NULL AND method IS NULL
            AND in_service_on IS NULL)
    );

-- Only a capitalised asset charges anything, so only a capitalised asset says
-- what kind of charge it is.
ALTER TABLE asset_capitalization
    DROP CONSTRAINT asset_capitalization_charge_kind_follows_decision,
    ADD CONSTRAINT asset_capitalization_charge_kind_follows_decision
        CHECK ((decision = 'CAPITALIZE' AND charge_kind IS NOT NULL)
               OR (decision <> 'CAPITALIZE' AND charge_kind IS NULL));

-- ---------------------------------------------------------------------------
-- The rate
-- ---------------------------------------------------------------------------

ALTER TABLE asset_capitalization
    ADD COLUMN rate_bps integer
        CHECK (rate_bps IS NULL OR (rate_bps > 0 AND rate_bps <= 100000));

COMMENT ON COLUMN asset_capitalization.rate_bps IS
    'The annual rate the client stated, in basis points: 20% is 2000, 33.33% '
    'is 3333. The arithmetic uses useful_life_months; this is what they typed '
    'and what their own register prints.';

-- ---------------------------------------------------------------------------
-- The asset's own lifecycle
-- ---------------------------------------------------------------------------
--
-- `IN_PROGRESS` sits before `REGISTERED`: the thing does not exist yet, so it
-- cannot be found, counted, or handed to anybody. What exists is a cost.
ALTER TABLE fixed_asset
    DROP CONSTRAINT fixed_asset_status_check,
    ADD CONSTRAINT fixed_asset_status_check
        CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'REGISTERED', 'IN_SERVICE', 'DISPOSED'));

COMMENT ON COLUMN fixed_asset.status IS
    'IN_PROGRESS is a cost being incurred on something not yet built — the '
    'client''s Contract In Progress. REGISTERED is a thing that exists; '
    'IN_SERVICE is one Finance has capitalised; DISPOSED has left.';
