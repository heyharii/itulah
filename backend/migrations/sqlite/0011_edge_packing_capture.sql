-- 0011: A packing session is one box, and the sweep is what closes it.
--
-- Until now a koli was filled by handing the server a list of EPCs. Whoever
-- sent that list was asserting what was in the box, and nothing checked. The
-- handheld already sweeps the box — it posts observations tagged with a reader
-- session — so the contents can be read from the sweep instead of claimed.
--
-- The shape the packer works in:
--
--   open a session for a box  →  the target, qty per SKU, is set here
--   sweep the box             →  the reader session says what is actually in it
--   the two agree             →  the box freezes and becomes printable
--
-- There is no separate verify step and no seal button. Agreement IS the seal:
-- a box whose sweep matches its target has nothing left to decide. And because
-- freezing happens at agreement rather than at printing, reprinting a lost
-- packing list is simply rendering a fact that was already settled — no second
-- seal, no ambiguity.
--
-- The handheld never prints. It moves a box from "being filled" to "ready", and
-- the DC application prints from there.

PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

-- One session, one box. The packer opens a session when they start filling a
-- carton and it ends when that carton is closed.
ALTER TABLE packing_session ADD COLUMN koli_id TEXT REFERENCES koli(koli_id);
ALTER TABLE packing_session ADD COLUMN destination_store_id TEXT;

-- Two sessions filling one box would each hold a target the other knows
-- nothing about, and the box would satisfy whichever was checked last.
CREATE UNIQUE INDEX IF NOT EXISTS ux_packing_session_koli
    ON packing_session (koli_id) WHERE koli_id IS NOT NULL;

-- What this box is supposed to hold. Set when the session opens, from what is
-- still picked and unpacked for the destination, and not changed afterwards:
-- a target edited to match the sweep is not a target.
CREATE TABLE IF NOT EXISTS packing_session_target (
    session_id TEXT NOT NULL REFERENCES packing_session(session_id) ON DELETE CASCADE,
    sku_code   TEXT NOT NULL,
    target_qty INTEGER NOT NULL CHECK (target_qty > 0),
    PRIMARY KEY (session_id, sku_code)
);

-- One sweep of the box, and what it found. Kept rather than recomputed: the
-- freeze rests on what was true at that moment, and a rule that changes later
-- must not retroactively unfreeze a box already on a truck.
CREATE TABLE IF NOT EXISTS packing_capture (
    capture_id        TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES packing_session(session_id) ON DELETE CASCADE,
    -- One sweep, one reader session. It is what makes a capture reproducible
    -- after the fact, and it is all the handheld sends: a list that travels
    -- twice is a list that can disagree with itself.
    reader_session_id TEXT NOT NULL CHECK (trim(reader_session_id) <> ''),
    device_id         TEXT,
    operator_id       TEXT,
    captured_at       TEXT NOT NULL,

    -- Per SKU: what was asked for, what the sweep found, and what the sweep
    -- found that has no business being in this box at all.
    detail_json       TEXT NOT NULL,
    matched           INTEGER NOT NULL CHECK (matched IN (0, 1))
);

CREATE INDEX IF NOT EXISTS ix_packing_capture_session
    ON packing_capture (session_id, captured_at);

-- The box is frozen by agreement, and the capture that did it is named. A seal
-- that cannot say what justified it is a seal nobody can audit.
ALTER TABLE koli ADD COLUMN sealed_by_capture_id TEXT REFERENCES packing_capture(capture_id);

-- The capture that froze a box must be a capture OF that box.
CREATE TRIGGER IF NOT EXISTS koli_seal_names_its_own_capture
BEFORE UPDATE OF sealed_by_capture_id ON koli
WHEN NEW.sealed_by_capture_id IS NOT NULL
 AND (SELECT s.koli_id
        FROM packing_capture c
        JOIN packing_session s ON s.session_id = c.session_id
       WHERE c.capture_id = NEW.sealed_by_capture_id) IS NOT NEW.koli_id
BEGIN
    SELECT RAISE(ABORT, 'that capture belongs to a different koli');
END;

-- A target is a statement about what should be in the box. Editing it after a
-- sweep has run would turn every mismatch into a matter of retyping.
CREATE TRIGGER IF NOT EXISTS packing_target_is_fixed_once_swept
BEFORE UPDATE ON packing_session_target
WHEN EXISTS (SELECT 1 FROM packing_capture WHERE session_id = OLD.session_id)
BEGIN
    SELECT RAISE(ABORT, 'the target cannot change after the box has been swept');
END;

CREATE TRIGGER IF NOT EXISTS packing_target_not_added_once_swept
BEFORE INSERT ON packing_session_target
WHEN EXISTS (SELECT 1 FROM packing_capture WHERE session_id = NEW.session_id)
BEGIN
    SELECT RAISE(ABORT, 'the target cannot change after the box has been swept');
END;

COMMIT;
PRAGMA foreign_keys=ON;
