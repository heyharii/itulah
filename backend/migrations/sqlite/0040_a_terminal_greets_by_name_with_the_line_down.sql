-- A terminal greets by name with the line down.
--
-- The punch station at a unit is a fingerprint reader and nothing else: no PIN,
-- no card, no exception. That was the owner's decision, reaffirmed after being
-- told twice what it costs. It makes this box's job very specific.
--
-- # Why the punch is taken here and not in the cloud
--
-- Because a shop's uplink goes down and people still arrive. The owner chose
-- the expensive option knowing it was expensive: punches are recorded at the
-- edge and synced up, rather than posted straight to a cloud endpoint that is
-- unreachable exactly when the shutter is going up.
--
-- That choice has a consequence this file is entirely about. A terminal with no
-- uplink must still greet somebody by name, show them the shift they are on
-- today, and refuse a person who is not posted to this unit. None of those
-- three is answerable from `edge_user`, which is an access credential and knows
-- nothing about employment, postings or rosters. So a slice of the employee
-- book has to live here — the first employment data this node has ever held.
--
-- # It is a projection, and it is replaced wholesale
--
-- Everything except `attendance_punch` below is a copy of what the cloud
-- decided, delivered by the `attendance.book.replace` command and replaced in
-- full on every delivery. Never merged. A merge needs a way to say "and forget
-- this person", and a forgotten deletion is somebody who left the company still
-- being greeted by name — and, worse, still counted on a roster. Replacing the
-- whole book makes a transfer and a termination propagate by construction,
-- which is the same reason the cloud's template bundle is a replacement rather
-- than a delta.
--
-- Nothing here is authoritative and nothing here is edited locally. The one
-- table this box owns is the punch log.
--
-- # What is deliberately NOT here
--
-- **Templates.** Matching happens on the reader, and the hardware agent holds
-- the loaded set — it pulls them from the cloud directly, over the same
-- per-origin credential this node syncs with, and keeps them for as long as it
-- is running. Copying regulated biometric data into thirteen shops' SQLite
-- files as well would widen the exposure without buying anything the agent's
-- own loaded set does not already give.
--
-- **Outcomes.** No `late`, no `absent`, no `status`. Whether somebody was late
-- depends on a policy this box is not told and a correction chain it does not
-- hold, and a column here would be a second answer to a question the cloud
-- already answers. The box records what the reader saw and shows the plan; the
-- centre decides what it meant.
--
-- # Not the same thing as `0039`
--
-- `0039_a_finger_opens_a_till_and_authorises_a_void.sql` also has fingerprints,
-- an `edge_terminal` and an enrolment table, and it is a **different feature**:
-- fingerprint as a way to sign in to a till and to authorise a void, keyed to
-- `edge_user`, with templates enrolled and held locally. This is attendance,
-- keyed to the cloud's `employee`, with templates held centrally.
--
-- The tables are kept apart on purpose. `0039`'s terminal is paired in the shop
-- by whoever installs it; an attendance station is registered centrally by head
-- office, because registering one creates the authority to produce attendance.
-- Merging them would mean one row answering two questions with two different
-- lives, and lying about one of them. Somebody should unify the *device* story
-- later, once `0039` has callers; that is a decision, not a default.

-- Which unit this box is, and how fresh its book is.
--
-- A singleton — `id = 1` — because a node is one place. It is not decoration:
-- `published_at` is what lets a station say "this book is from Tuesday" instead
-- of silently greeting people from a roster that is three weeks old, and
-- `place_id` is what every refusal of a stranger is checked against.
CREATE TABLE IF NOT EXISTS attendance_book (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    place_id     TEXT NOT NULL CHECK (trim(place_id) <> ''),
    -- When the CLOUD published this book, not when this box received it. A
    -- receive time would read as freshness the data does not have.
    published_at TEXT NOT NULL,
    received_at  TEXT NOT NULL
);

-- The people posted to this unit.
--
-- `display_name` rather than a name split into parts: this is read off a screen
-- at six in the morning by somebody holding a finger on a reader, and a box
-- that has to assemble a greeting is a box with two ways to get it wrong.
CREATE TABLE IF NOT EXISTS attendance_employee (
    employee_id  TEXT PRIMARY KEY,
    -- The badge number. Shown beside the name, because two people share a first
    -- name in every shop of more than nine staff.
    code         TEXT NOT NULL,
    display_name TEXT NOT NULL,
    -- Carried even though the whole book is one place's, so a punch can be
    -- refused against the row rather than against a variable somebody forgot
    -- to check.
    place_id     TEXT NOT NULL,
    -- Only ACTIVE people are published, and the column says so rather than
    -- being implied by their presence: a station that shows a status can say
    -- "suspended" to somebody's face instead of "not recognised", which is the
    -- difference between an explanation and an argument.
    status       TEXT NOT NULL CHECK (status IN ('ACTIVE')),
    updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS attendance_employee_code
    ON attendance_employee(code);

-- What each of them is planned to be doing, by date.
--
-- Clock positions are minutes since local midnight on a 0..2879 timeline
-- anchored at the roster date, exactly as the cloud stores them, so an
-- overnight shift (22:00 → 06:00) needs no timezone machinery here either:
-- start 1320, end 360, end_day_offset 1.
CREATE TABLE IF NOT EXISTS attendance_roster_day (
    employee_id      TEXT NOT NULL,
    on_date          TEXT NOT NULL,
    place_id         TEXT NOT NULL,
    plan             TEXT NOT NULL CHECK (plan IN ('SCHEDULED', 'REST_DAY', 'PUBLIC_HOLIDAY')),
    -- The four shift columns are all NULL together or all set together: a
    -- SCHEDULED day has a shift and the other two plans have none. Stated as a
    -- table constraint at the end rather than inline, because SQLite refuses to
    -- open a database whose multi-column CHECK sits between two columns and
    -- gives no compile error saying so.
    shift_id         TEXT,
    shift_name       TEXT,
    start_minute     INTEGER,
    end_minute       INTEGER,
    end_day_offset   INTEGER,
    unpaid_break_min INTEGER,
    PRIMARY KEY (employee_id, on_date),
    CONSTRAINT attendance_roster_shift_matches_plan CHECK (
        (plan =  'SCHEDULED' AND shift_id IS NOT NULL AND start_minute IS NOT NULL
                             AND end_minute IS NOT NULL AND end_day_offset IN (0, 1)
                             AND unpaid_break_min >= 0) OR
        (plan <> 'SCHEDULED' AND shift_id IS NULL AND start_minute IS NULL
                             AND end_minute IS NULL AND end_day_offset IS NULL
                             AND unpaid_break_min IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS attendance_roster_day_date
    ON attendance_roster_day(on_date, employee_id);

-- The stations registered at this unit, as the centre sees them.
--
-- Here so that a station can be refused **offline**. Head office suspending a
-- device is only an effective act if the refusal survives the uplink going
-- down; a box that fell back to "allow" when it could not ask would be a box
-- where suspending a reader means nothing after the router reboots.
CREATE TABLE IF NOT EXISTS attendance_terminal (
    terminal_id TEXT PRIMARY KEY,
    place_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    method      TEXT NOT NULL CHECK (method IN ('FINGERPRINT'))
);

-- The one table this box owns: what the reader saw.
--
-- # This is the durable buffer
--
-- Not a browser queue. The shell's `localStorage` is not the mechanism and
-- never was — the donor's README says so in as many words, because that is the
-- mistake it made first. A punch is a row here plus a `sync_fact_log` entry
-- written in the **same transaction**, so an acknowledged punch is always
-- queued for upload, and the upload's retries, its circuit breaker and its dead
-- letters are the ones `0002_edge_sync.sql` already provides.
--
-- There is deliberately **no `pending`/`synced` column.** The donor has one
-- because its outbox is separate from its punch table; ours is not, and a
-- second state column would be a second answer to "has this been delivered" —
-- with `sync_watermark` as the first. What is still unsent is the sync
-- backlog, and `GET /api/v1/sync/status` is where a station reads it.
--
-- # Append-only, like the cloud's
--
-- No UPDATE path and no DELETE path. A punch is what the device observed; a
-- correction is an overlay recorded centrally and never an edit here. The
-- acknowledged rows are pruned by the sync retention sweep, not by anything
-- that could be mistaken for a fix.
CREATE TABLE IF NOT EXISTS attendance_punch (
    -- Minted HERE, so a redelivery is free: the same punch may reach the cloud
    -- any number of times and only the first lands, because the identity
    -- collides. A server-assigned id would give a retried punch a new identity
    -- and a day of reconnection would read as a day of double-taps.
    punch_id      TEXT PRIMARY KEY,
    employee_id   TEXT NOT NULL,
    terminal_id   TEXT NOT NULL,
    direction     TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
    -- The roster day this answers. For an overnight shift, the day the shift
    -- started — which is why it is a column rather than derived from
    -- `recorded_at`.
    business_date TEXT NOT NULL,
    day_offset    INTEGER NOT NULL CHECK (day_offset IN (0, 1)),
    minute        INTEGER NOT NULL CHECK (minute BETWEEN 0 AND 1439),
    -- What this box's clock said. Recorded, and **no rule reads it**: lateness
    -- is measured in place-local business time against the plan, so a drifting
    -- clock cannot manufacture a penalty.
    recorded_at   TEXT NOT NULL,
    -- What the box knew about that clock. UNKNOWN is a real answer — it means
    -- the node could not tell — and is worth reading differently from a node
    -- that said the clock was fine.
    clock_quality TEXT NOT NULL CHECK (clock_quality IN ('OK', 'DRIFT', 'UNKNOWN')),
    created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS attendance_punch_day
    ON attendance_punch(business_date, employee_id);
CREATE INDEX IF NOT EXISTS attendance_punch_employee
    ON attendance_punch(employee_id, business_date);
