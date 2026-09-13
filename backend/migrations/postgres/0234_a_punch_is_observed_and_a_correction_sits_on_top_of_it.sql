-- 0234: A punch is observed and a correction sits on top of it.
--
-- Ported from the reference HR backend's `044_attendance_v1.sql` — the punch
-- and correction halves, which `0104` deliberately left behind because there
-- was no punch source. There is one now: a fingerprint terminal per unit,
-- feeding the unit's edge node, which syncs up. `docs/hr-port-provenance.md`
-- records the adaptations.
--
-- # There is no UPDATE path to `attendance_punch`, and there must never be one
--
-- A punch is what a device observed. The moment it becomes editable, "what did
-- the terminal actually see?" stops having an answer. The Go implementation the
-- reference replaced kept one mutable row per `(employee, date, shift)` and
-- upserted it, so a clock-out overwrote the clock-in and an approved correction
-- overwrote both. A correction here is a separate overlay in
-- `attendance_correction` and never touches these rows.
--
-- Nothing deletes from here either. Revoking a terminal is not a way to delete
-- history, which is why the load path revalidates provenance against the
-- terminal record without consulting its current status.
--
-- # The outcome of a day is not in this file
--
-- No `status` column, anywhere. LATE, ABSENT, ON_TIME and the rest are
-- **derived** from `(roster day, punches, policy version, approvals, effective
-- correction)` and recomputed on every read. The same implementation that
-- upserted punches also wrote a `status` string at punch time and rewrote it
-- from a nightly sweep and again from a correction approval; the stored string
-- and the facts drifted, and nothing could say which was right.
--
-- A day with no punch is therefore **not** a row here saying `ABSENT`. It is
-- the absence of a row, read against a plan, under a policy — and a day nobody
-- planned is not an absence at all.

-- The append-only punch log.
CREATE TABLE attendance_punch (
    -- Minted at the **edge**, not here. That is what makes an offline
    -- terminal's retry safe: the node may deliver the same punch any number of
    -- times and only the first delivery lands, because the identity collides.
    -- A serial id would give the same punch a new identity on every retry and
    -- a day of reconnection would read as a day of double-taps.
    id            text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id   text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    place_id      text NOT NULL REFERENCES org_place(id),
    -- Provenance, and the reason a fabricated row cannot become a punch: on
    -- the way back in, the terminal named here must still be a registered
    -- terminal, at this place, performing this method, or the row does not
    -- load at all.
    terminal_id   text NOT NULL REFERENCES attendance_terminal(id),
    method        text NOT NULL CHECK (method IN ('FINGERPRINT')),
    direction     text NOT NULL CHECK (direction IN ('IN', 'OUT')),
    -- The business date the punch is filed under — the roster day it answers,
    -- which for an overnight shift is the day the shift *started*. A date, not
    -- an instant: which day a punch belongs to is a planning fact, and a
    -- timestamp would let a timezone conversion move it.
    business_date date NOT NULL,
    -- 0 or 1: whether the clock reading falls after midnight, still on the same
    -- shift. Together with `minute` this positions the punch on the same
    -- 0..2879 timeline the shift lives on, so "how late" is subtraction rather
    -- than date arithmetic.
    day_offset    smallint NOT NULL CHECK (day_offset IN (0, 1)),
    minute        smallint NOT NULL CHECK (minute BETWEEN 0 AND 1439),
    -- The instant the device claimed. **No rule reads this.** Lateness is
    -- measured in place-local business time, so a terminal with a wrong UTC
    -- offset cannot manufacture a penalty; the column answers "when did the
    -- device think this was", not "was he late".
    recorded_at   timestamptz NOT NULL,
    -- What the edge knew about its own clock when it recorded the punch. A
    -- terminal that has been offline for a week has been keeping time on its
    -- own, and a punch taken under a clock nobody had checked is evidence of a
    -- different quality from one taken a second after an NTP sync.
    --
    -- UNKNOWN is a real answer and is not a default: it means the node could
    -- not tell, which is worth reading differently from a node that said the
    -- clock was fine.
    clock_quality text NOT NULL CHECK (clock_quality IN ('OK', 'DRIFT', 'UNKNOWN')),
    -- When it reached the cloud. Differs from `recorded_at` by however long the
    -- unit was offline, and the gap is the thing an auditor wants to see.
    received_at   timestamptz NOT NULL DEFAULT now()
);

-- One day's punches for one person: the derivation's query.
CREATE INDEX ix_attendance_punch_employee_date
    ON attendance_punch (employee_id, business_date);
-- A unit's day, for the Today screen and the close's readiness counts.
CREATE INDEX ix_attendance_punch_place_date
    ON attendance_punch (place_id, business_date);

-- The append-only correction chain: one row per request, decided in place.
--
-- A correction is an **overlay, never an edit**. What the terminal observed
-- stays in `attendance_punch` exactly as recorded, and the derived outcome is
-- recomputed from both — so "what happened" and "what HR decided" remain
-- separately answerable for ever. `state` moves PENDING → APPROVED / REJECTED /
-- WITHDRAWN once and no row is ever removed: a rejected request is evidence.
CREATE TABLE attendance_correction (
    id            text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id   text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    place_id      text NOT NULL REFERENCES org_place(id),
    business_date date NOT NULL,
    -- ARRIVAL | DEPARTURE | ARRIVAL_AND_DEPARTURE | APPROVED_LEAVE, with the
    -- corrected clock readings. Deliberately cannot state an *outcome* (LATE,
    -- ABSENT) and cannot state an amount: outcomes are derived, and letting HR
    -- write one directly would put back the stored-status problem this schema
    -- removes.
    effect        jsonb NOT NULL,
    -- The approved correction this one replaces, or NULL when it is the first.
    -- Self-referencing on purpose: two people correcting the same day cannot
    -- silently clobber each other, because the second must name what the first
    -- established.
    supersedes    text REFERENCES attendance_correction(id),
    -- Who asked, under which key, when, and why. An
    -- `employment::Authorization`.
    requested     jsonb NOT NULL,
    state         text NOT NULL
                  CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    -- Who decided and why. Kept whatever the verdict, because a refusal is a
    -- decision somebody took and a day whose correction was refused is a day
    -- somebody looked at.
    decision      jsonb,
    -- Submission order within one (employee, place, date) chain. Stored because
    -- the supersede links are validated by replaying the chain in order, and
    -- "the order the rows came back in" is not an order.
    chain_seq     integer NOT NULL CHECK (chain_seq >= 1),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- A decided correction with no decision is an anonymous verdict on
    -- somebody's pay; a pending one carrying a decision is a verdict nobody has
    -- taken yet.
    CONSTRAINT attendance_correction_decision_matches_state CHECK (
        (state =  'PENDING' AND decision IS NULL) OR
        (state <> 'PENDING' AND decision IS NOT NULL)
    ),
    CONSTRAINT attendance_correction_chain_position
        UNIQUE (employee_id, place_id, business_date, chain_seq)
);

-- At most one pending request per (employee, place, date). A queue of
-- contradictory pending edits to one day has no defined meaning, and whichever
-- one an approver happened to see would become the answer.
CREATE UNIQUE INDEX ix_attendance_correction_one_pending
    ON attendance_correction (employee_id, place_id, business_date)
    WHERE state = 'PENDING';

-- The chain, in order, and the close's open-corrections count.
CREATE INDEX ix_attendance_correction_chain
    ON attendance_correction (employee_id, place_id, business_date, chain_seq);
CREATE INDEX ix_attendance_correction_open
    ON attendance_correction (place_id, business_date)
    WHERE state = 'PENDING';

COMMENT ON TABLE attendance_punch IS
    'Append-only observations from a registered terminal. No UPDATE path and no '
    'DELETE path: a punch is what the device saw. Carries no outcome — LATE and '
    'ABSENT are derived from the plan, the policy and these rows.';
COMMENT ON TABLE attendance_correction IS
    'Corrections as an append-only overlay. The punches are never edited, so '
    'what the terminal observed and what HR decided stay separately '
    'answerable. A closed period refuses a new one.';
