-- A finger recorded at the store waits for head office (owner, 24 Oct 2026).
--
-- The store head records her own finger at the POS after signing in with her
-- password, and then the fingers of the people head office added. None of
-- them opens anything here: each is sent to head office, which approves or
-- refuses it in the hub, and an approved finger comes back with every other
-- finger head office holds (`fingerprint::replace_from_head_office`). Kept
-- apart from `edge_fingerprint` on purpose, so a waiting finger can never be
-- matched at a till by mistake. Creates only.
CREATE TABLE IF NOT EXISTS edge_finger_submission (
    submission_id   TEXT PRIMARY KEY,
    -- Whose finger, and which: `RIGHT_INDEX`, `LEFT_THUMB`, ...
    username        TEXT NOT NULL,
    finger          TEXT NOT NULL,
    template_base64 TEXT NOT NULL,
    reader_kind     TEXT NOT NULL,
    quality         INTEGER CHECK (quality IS NULL OR quality BETWEEN 0 AND 100),
    recorded_by     TEXT NOT NULL,
    recorded_at     TEXT NOT NULL,
    -- Head office's answer, as it last said. The template is wiped once it is
    -- decided: approved, it comes back as head office's own finger; refused,
    -- it is a biometric held for nothing.
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'APPROVED', 'REFUSED')),
    reason          TEXT,
    decided_at      TEXT
);

-- One finger of one person waits at a time: recording it again replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_edge_finger_submission_waiting
    ON edge_finger_submission (username, finger) WHERE status = 'PENDING';
