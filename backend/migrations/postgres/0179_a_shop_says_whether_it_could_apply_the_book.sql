-- 0179: A shop says whether it could apply the book.
--
-- Since 0036 a row in `commercial_publication_activation` has meant one thing
-- and its absence has meant nothing at all. "Never told", "told and not yet
-- applied" and "tried and failed" are the same empty space, so the only
-- question the centre can answer is "who succeeded", and everything else is a
-- subtraction: target minus activated. A subtraction cannot say WHEN a shop was
-- told, and the gap between told and applied is the number worth watching. It
-- cannot say a shop failed at all — UI-001 §6 asks for "10/13 stores · 2
-- pending, 1 failed" and the third number was permanently nought, with the
-- code saying so out loud because there was nowhere for it to come from.
--
-- # Why this is the same table and not a new one
--
-- Whether a shop is running a book has exactly one answer, and a second table
-- claiming to hold it would be a second answer. So the evidence model 0036
-- started is extended: the same primary key, the same columns, the same rows,
-- plus a state and the evidence behind it.
--
-- # Why the storage is renamed and the old name becomes a view
--
-- The rows in this table have carried an invariant since 0036 that five readers
-- depend on and none of them states: **a row exists if and only if the shop has
-- this book in service.** `pricing::activated_versions` is the one that matters
-- — it decides which books a shop's prices are resolved from, so a PENDING row
-- sitting in the same table would price a shop from a book it has never
-- applied. That is the cloud-and-till divergence this estate has already lived
-- through once.
--
-- Widening the table under that name would therefore have meant editing every
-- reader in the same breath, and getting one wrong is a wrong price rather than
-- a wrong screen. So the storage takes a name that describes what it now holds
-- — all three states — and `commercial_publication_activation` survives as a
-- view over the ACTIVE rows, which is precisely what that name has always
-- meant. Nothing derived is stored twice: the view is the subset, not a copy.

ALTER TABLE commercial_publication_activation
    RENAME TO commercial_publication_rollout;

ALTER TABLE commercial_publication_rollout
    -- PENDING: the centre handed this shop the book and the shop has not
    -- reported back. ACTIVE: the shop reported putting it into service.
    -- FAILED: the shop reported that it could not.
    ADD COLUMN state TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (state IN ('PENDING', 'ACTIVE', 'FAILED')),
    -- The centre's clock: when this shop was handed the book. Written in the
    -- transaction that publishes it, so "which shops are outstanding" is a
    -- record rather than a subtraction.
    ADD COLUMN told_at timestamptz,
    -- The shop's clock, both ends of it. A book that applied first time has the
    -- two equal; one that took four days and three tries has a gap somebody
    -- should be looking at, and an average of one number cannot show it.
    ADD COLUMN first_attempt_at timestamptz,
    ADD COLUMN last_attempt_at timestamptz,
    -- Retrying is ordinary. A shop that has tried eleven times and is still
    -- PENDING is a different problem from one that has never tried, and without
    -- a count the two are the same row.
    ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    -- The shop's own words. Not a code: the centre cannot enumerate what can go
    -- wrong inside a till, and a classification invented here would be a guess
    -- laid over the only description anybody actually has.
    ADD COLUMN last_error TEXT;

-- Every row already here is a success — 164 of them — so they default to
-- ACTIVE, and any other backfill would invent history.
--
-- PENDING would invent a queue of thirteen shops nobody is working on, for
-- books that went into service months ago. FAILED would invent failures that
-- never happened. And leaving the state nullable would keep the original fault
-- alive under a new name: a NULL state is once again a row that means nothing
-- in particular.
--
-- The attempt columns are backfilled the same way and for the same reason: a
-- row reporting an activation IS one successful attempt, at the instant it
-- reports. Leaving `attempt_count` at nought would say these shops are running
-- books they never tried to apply.
UPDATE commercial_publication_rollout
   SET first_attempt_at = activated_at,
       last_attempt_at = activated_at,
       attempt_count = 1;

-- `told_at` is NOT backfilled from thin air. Where the command that carried the
-- book to that shop is still on file, its issue time IS when the shop was told
-- and is copied; where it is not, the column stays NULL, which reads as "the
-- centre never wrote down when it told this shop" — true, and more useful than
-- a plausible timestamp.
UPDATE commercial_publication_rollout r
   SET told_at = c.issued_at
  FROM sync_command_delivery d
  JOIN sync_command c ON c.command_id = d.command_id
 WHERE c.command_type = 'commercial.publication.activate'
   AND d.origin_id = r.origin_id
   AND c.payload ->> 'publication_id' = r.publication_id::text;

-- A PENDING row has no activation to report, so the two columns that describe
-- one stop being mandatory. They are governed by the state instead, below.
ALTER TABLE commercial_publication_rollout
    ALTER COLUMN activated_at DROP NOT NULL,
    ALTER COLUMN price_rule_count DROP NOT NULL,
    ALTER COLUMN reported_at DROP NOT NULL,
    -- `now()` was the right default while every row was a shop reporting in.
    -- It is a trap now: a PENDING row that omitted the column would claim the
    -- centre heard from a shop at the moment it decided to tell it.
    ALTER COLUMN reported_at DROP DEFAULT;

-- Each state must carry the evidence its name claims. Without this the state
-- is a label a writer can put on anything, and the first careless INSERT makes
-- it one — an ACTIVE row with no activation, or a FAILED one with nothing
-- saying what went wrong, which is exactly the empty space this migration
-- exists to close.
ALTER TABLE commercial_publication_rollout
    ADD CONSTRAINT commercial_publication_rollout_state_evidence CHECK (
        (state <> 'ACTIVE' OR (activated_at IS NOT NULL
                               AND reported_at IS NOT NULL
                               AND price_rule_count IS NOT NULL))
        AND (state <> 'FAILED' OR last_error IS NOT NULL)
        -- A shop that has not reported has nothing to report with.
        AND (state <> 'PENDING' OR (activated_at IS NULL AND last_error IS NULL))
        -- An attempt without a time, or a time without an attempt, is half a
        -- record and reads as the other half being lost.
        AND (attempt_count = 0) = (last_attempt_at IS NULL)
        AND (first_attempt_at IS NULL) = (last_attempt_at IS NULL)
    );

-- What is outstanding on one book, which is the question UI-001 §6 asks and
-- the reason this table is read at all. The primary key leads on
-- `publication_id` already; this carries the state so the counts are answered
-- from the index rather than from the heap.
CREATE INDEX ix_publication_rollout_state
    ON commercial_publication_rollout (publication_id, state);

-- The rollout reader's other source, indexed.
--
-- `rollout::rollout_for` unions the rows above with `sync_command_delivery`,
-- which is how a book dispatched before this migration can still say which
-- shops were told. Unindexed that union costs a full scan of the command ledger
-- and a full scan of the delivery ledger, per book, on a detail screen — and
-- both ledgers grow with every publish, every promotion broadcast and every
-- campaign switch, for ever. Measured on the seeded estate (896 commands, 9.211
-- deliveries) the pair turns a hash join over both scans into thirteen index
-- lookups; the scans are affordable today and are the shape of thing that stops
-- being affordable without anybody noticing the day it does.
CREATE INDEX ix_sync_command_publication
    ON sync_command ((payload ->> 'publication_id'))
 WHERE command_type = 'commercial.publication.activate';

-- `ux_command_delivery_once` leads on `origin_id`, so it cannot answer "who was
-- handed THIS command".
CREATE INDEX ix_command_delivery_by_command
    ON sync_command_delivery (command_id);

COMMENT ON TABLE commercial_publication_rollout IS
    'How far one price book has reached one shop: told, in service, or failed '
    'with the shop''s own account of why. Every state but the first is '
    'reported by the shop itself — nobody ticks this off by hand.';

-- The old name, meaning exactly what it has meant since 0036.
--
-- Five readers were written against "a row here is a shop running this book"
-- and stay correct without being touched, which is the point: the invariant
-- moves into the view definition where it can be read, instead of living
-- unwritten in five separate queries.
CREATE VIEW commercial_publication_activation AS
SELECT publication_id, origin_id, site_id, version,
       activated_at, reported_at, price_rule_count, state
  FROM commercial_publication_rollout
 WHERE state = 'ACTIVE'
  WITH CASCADED CHECK OPTION;

-- The default lives on the view rather than on the table, and the difference
-- is the whole reason 0164 dropped its own default after backfilling.
--
-- On the table it would mean any writer that forgot the column got ACTIVE for
-- free — a shop reported as running a book on the strength of an omission. On
-- the view it means only what the view's name already says: a row written
-- through `commercial_publication_activation` is an activation. Anything
-- writing the three-state table must state which of the three it means.
ALTER TABLE commercial_publication_rollout ALTER COLUMN state DROP DEFAULT;
ALTER VIEW commercial_publication_activation ALTER COLUMN state SET DEFAULT 'ACTIVE';

-- `reported_at` moves the same way and for the same reason. On the table its
-- `now()` was a trap: a PENDING row that omitted the column would claim the
-- centre had heard from a shop at the moment it decided to tell it. On the view
-- it is simply true — an insert through this name IS the centre hearing from a
-- shop — and it keeps every writer that predates this migration working, which
-- matters while a fleet of binaries is mid-rollout.
ALTER VIEW commercial_publication_activation ALTER COLUMN reported_at SET DEFAULT now();

COMMENT ON VIEW commercial_publication_activation IS
    'The ACTIVE rows of commercial_publication_rollout, under the name they '
    'had before rollout state existed. A row here is a shop with this book in '
    'service, which is what this name has always meant.';
