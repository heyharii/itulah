-- 0103: Overtime is ordered by the employer and agreed by the worker.
--
-- Ported from the reference HR backend's `045_overtime_v1.sql`.
-- `docs/hr-port-provenance.md` records what changed.
--
-- # The rule this table exists to make unrepresentable
--
-- **Overtime needs two consents, not one.** PP 35/2021 art. 26(2) requires both
-- a written instruction from the employer and the worker's own written
-- agreement. Either alone is not lawful overtime.
--
-- Almost every system models this as a single manager approval, and that shape
-- produces exactly the outcome the rule exists to prevent: hours worked because
-- a supervisor said so, with no record that anyone asked. The employee has no
-- artefact to point at, and neither does an inspector.
--
-- So `ordered` and `consent` are two columns holding two authorities, and the
-- CHECK constraints below make the single-consent shape unstorable: a row
-- saying overtime was agreed always names who agreed, and it is never the
-- person who ordered it, because the two acts are recorded under disjoint
-- action keys and the loader re-checks them.

-- The caps an operator has ratified.
--
-- The reference keeps these out of the database entirely, on the grounds that a
-- table makes the caps "a row somebody can leave empty, and an empty row reads
-- as no limit to the first query that forgets to check". The objection is
-- right and the conclusion does not transfer: that codebase installs them from
-- configuration at boot, and this one has no such mechanism — the equivalent
-- here would be an environment variable, which is a row somebody can leave
-- empty with less to see it by.
--
-- So it is a table, and the same guarantee is bought a different way: **no row
-- means no policy, and no policy refuses every order by name.** Both columns
-- are NOT NULL and positive, there is no default row, and nothing seeds one.
-- The failure the reference is guarding against is a cap that silently reads as
-- "unlimited"; here the absence of a cap is the absence of a row, which no
-- query can mistake for a large number.
--
-- Four hours a day and eighteen a week are the figures in PP 35/2021 art.
-- 26(1). The figures before it were three and fourteen. That change is exactly
-- why neither pair is written here: a constant would have been silently wrong
-- for every deployment that upgraded across it.
CREATE TABLE overtime_policy (
    version          integer PRIMARY KEY CHECK (version > 0),
    -- Whole minutes, like everything else that measures work here. A zero cap
    -- forbids overtime by arithmetic rather than by decision — if an operator
    -- means to forbid it, that is a policy of its own and not a limit of
    -- nought.
    max_per_day_minutes  integer NOT NULL CHECK (max_per_day_minutes > 0),
    max_per_week_minutes integer NOT NULL CHECK (max_per_week_minutes > 0),
    ratified         jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    -- A weekly cap below the daily one makes the daily cap unreachable, which
    -- means one of the two figures is a typo.
    CONSTRAINT overtime_policy_week_covers_day
        CHECK (max_per_week_minutes >= max_per_day_minutes)
);

-- One row per instruction to work overtime.
CREATE TABLE overtime_order (
    id              text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id     text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- A real foreign key, unlike the reference, which has no place tree to
    -- point at. Which shop an order belongs to is what bounds the manager who
    -- may issue or withdraw it.
    place_id        text NOT NULL REFERENCES org_place(id),
    on_date         date NOT NULL,
    -- WORKING, REST or HOLIDAY. Records *which* statutory pay table applies:
    -- Kepmenaker 102/2004 has one schedule for ordinary days and another for
    -- rest days and public holidays. **No multiplier is stored here.** A
    -- multiplier in this table would be a copy of the statute that goes stale
    -- the day it is amended, with no way to tell which rows were computed under
    -- which figures.
    day_kind        text NOT NULL CHECK (day_kind IN ('WORKING', 'REST', 'HOLIDAY')),
    -- What was *ordered*, in whole minutes. Not what was worked: that comes
    -- from punches, and there is no punch source yet. Minutes rather than
    -- fractional hours because a float cannot round-trip and cannot be compared
    -- for equality, so two systems reading the same overtime disagree about it.
    --
    -- Never authoritative on its own. The figure anything downstream may act on
    -- is this one *only* when the state is AGREED.
    planned_minutes integer NOT NULL CHECK (planned_minutes > 0),
    -- The employer's written instruction, as the domain shaped it: actor,
    -- action key, instant, reason. Stored whole because the four parts are only
    -- meaningful together — an actor with no action key recorded is a name
    -- beside an act nobody can say was permitted.
    ordered         jsonb NOT NULL,
    -- AWAITING_CONSENT, AGREED, DECLINED or WITHDRAWN.
    --
    -- Three of the four are terminal. DECLINED especially: no route and no
    -- update moves a row out of it, because a refusal a sufficiently senior
    -- person can reverse is not a refusal.
    state           text NOT NULL CHECK (
                        state IN ('AWAITING_CONSENT', 'AGREED', 'DECLINED', 'WITHDRAWN')
                    ),
    -- The worker's own authority — their answer, in their own words.
    --
    -- Recorded under `people.overtime.consent_own`, which is disjoint from the
    -- ordering key. A consent recorded under a supervisor's key is the
    -- supervisor agreeing twice, which is the single-consent model art. 26(2)
    -- does not allow; the domain refuses it on write *and* on load, so a row
    -- edited by hand into that shape fails to hydrate rather than becoming
    -- authorized overtime.
    consent         jsonb,
    -- Who withdrew the instruction, and why. Only the employer, and only while
    -- the order was still unanswered.
    withdrawal      jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- An answer is present exactly when the state is one of the two answered
    -- ones. Without this, AGREED with no consent is storable — and that row is
    -- precisely the defect this whole module exists to prevent: hours
    -- authorized because a supervisor said so, with no record that anyone asked
    -- the worker.
    CONSTRAINT overtime_order_consent_matches_state CHECK (
        (state IN ('AGREED', 'DECLINED') AND consent IS NOT NULL) OR
        (state NOT IN ('AGREED', 'DECLINED') AND consent IS NULL)
    ),
    -- A withdrawal is present exactly when the state is WITHDRAWN. The other
    -- direction matters as much: a withdrawal recorded against an AGREED order
    -- would let a commitment the worker arranged their life around be erased
    -- rather than cancelled against the agreement.
    CONSTRAINT overtime_order_withdrawal_matches_state CHECK (
        (state = 'WITHDRAWN' AND withdrawal IS NOT NULL) OR
        (state <> 'WITHDRAWN' AND withdrawal IS NULL)
    )
);

-- The week's orders, which is the question the weekly cap asks. Ordered by date
-- so a Monday–Sunday window is a range scan rather than a full read of one
-- person's history.
CREATE INDEX ix_overtime_order_employee_date
    ON overtime_order (employee_id, on_date);

-- The orders still waiting on an answer, per place — the queue a manager works
-- through, and the one the Requests screen reads. An order nobody answers
-- authorizes nothing, so an unanswered order is overtime that will be worked
-- unpaid or not worked at all.
CREATE INDEX ix_overtime_order_awaiting
    ON overtime_order (place_id, on_date) WHERE state = 'AWAITING_CONSENT';

COMMENT ON TABLE overtime_policy IS
    'The ratified daily and weekly caps. No row means no policy, and no policy '
    'refuses every order by name — there is no default and nothing seeds one.';
COMMENT ON COLUMN overtime_order.planned_minutes IS
    'What was ordered, not what was worked. Authoritative only when the state '
    'is AGREED.';
COMMENT ON COLUMN overtime_order.consent IS
    'The worker''s own authority, under a key their supervisor does not hold. '
    'The pair PP 35/2021 art. 26(2) requires, with `ordered`.';
