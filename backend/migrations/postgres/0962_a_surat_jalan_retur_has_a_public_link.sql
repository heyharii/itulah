-- A Surat Jalan Retur has a link anyone holding the paper can open.
--
-- The QR on the printed note (owner, 2026-10-10) opens a read-only page of that
-- surat jalan, with no login: the supplier's driver scans it and sees what the
-- note says. The page shows the note as it was printed, so the note is kept as
-- a snapshot when its link is first made and never rewritten afterwards.
--
-- `note_key` is the note's return numbers, comma-joined as the hub sends them:
-- printing the same note twice gives the same link, and the first snapshot
-- wins. `token` is the credential in the link (32 random bytes, base64url);
-- nothing lists these rows and an unknown token is simply not found.
CREATE TABLE return_note_link (
    token       text PRIMARY KEY CHECK (length(token) BETWEEN 32 AND 128),
    note_key    text NOT NULL UNIQUE CHECK (length(note_key) BETWEEN 1 AND 500),
    note        jsonb NOT NULL CHECK (jsonb_typeof(note) = 'object'),
    created_by  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
