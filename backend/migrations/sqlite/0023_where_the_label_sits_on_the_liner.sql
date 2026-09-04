-- A reel is not all label.
--
-- The die-cut tag sits on a liner, and on RFID stock it is inset from the left
-- edge of what the print head sweeps. Ink placed at x=0 lands on the backing
-- paper, and the tag comes out with its left column missing — which is not a
-- layout fault and cannot be fixed by moving fields, because the fields are
-- where they should be and the paper is not.
--
-- Held per session for the same reason the tag size is: a run is opened
-- against one reel and must finish on it. A bench that changes stock mid-run
-- repoints, and the run follows.
ALTER TABLE print_session
    ADD COLUMN label_offset_mm INTEGER NOT NULL DEFAULT 0
        CHECK (label_offset_mm BETWEEN 0 AND 100);
