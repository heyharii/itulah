-- Head office approves a new POS, and a finger recorded at the store (owner,
-- 24 Oct 2026: "toko hanya buka toko tutup toko, setup toko ga bisa").
--
-- # A new POS
--
-- A till asking to join is reported in its node's heartbeat
-- (`status -> 'devices' -> 'joins_waiting'`) and decided in the hub, on the
-- store's POS tab, into a free seat. The decision travels to the node as a
-- signed `device.join.decide.v1`; it is kept here so the hub shows "on its
-- way" until the next heartbeat no longer lists the till, and so a second
-- press is not a second command.
CREATE TABLE pos_join_decision (
    join_id            uuid PRIMARY KEY,
    origin_id          text NOT NULL REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    approve            boolean NOT NULL,
    -- The till this one takes over from, as the register names it.
    replaces_device_id text,
    decided_by         text NOT NULL CHECK (btrim(decided_by) <> ''),
    decided_at         timestamptz NOT NULL DEFAULT now(),
    command_id         uuid NOT NULL,
    CHECK (approve OR replaces_device_id IS NULL)
);

CREATE INDEX ix_pos_join_decision_origin ON pos_join_decision (origin_id, decided_at DESC);

-- # A finger recorded at the store
--
-- The store head records her own finger at the POS after signing in with her
-- password, then the people head office added. Each waits here until head
-- office approves it (it becomes the person's `fingerprint_template`, and
-- every server they sign in at takes it) or refuses it (the template is
-- wiped). Sealed under the same key and binding as a template, so an approval
-- copies the bytes and never opens them.
CREATE TABLE fingerprint_submission (
    -- The node's own id for it, so a resend is the same row.
    id           uuid PRIMARY KEY,
    origin_id    text NOT NULL REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    employee_id  text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- The login it was recorded for, as the store's server knows them.
    username     text NOT NULL CHECK (btrim(username) <> ''),
    finger       text NOT NULL CHECK (finger IN (
                     'LEFT_THUMB',  'LEFT_INDEX',  'LEFT_MIDDLE',  'LEFT_RING',  'LEFT_LITTLE',
                     'RIGHT_THUMB', 'RIGHT_INDEX', 'RIGHT_MIDDLE', 'RIGHT_RING', 'RIGHT_LITTLE'
                 )),
    -- NULL once decided: approved, the bytes live on in the template; refused,
    -- they are a biometric held for nothing.
    sealed       bytea CHECK (sealed IS NULL OR octet_length(sealed) > 0),
    nonce        bytea CHECK (nonce IS NULL OR octet_length(nonce) = 12),
    key_id       text,
    format       text NOT NULL CHECK (format IN ('ZKFINGER_V10')),
    quality      smallint CHECK (quality IS NULL OR quality BETWEEN 0 AND 100),
    -- The store head who pressed it, by login.
    recorded_by  text NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at  timestamptz NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now(),
    status       text NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'APPROVED', 'REFUSED', 'REPLACED')),
    decided_by   text,
    decided_at   timestamptz,
    reason       text,
    CHECK ((status = 'PENDING') = (decided_at IS NULL)),
    CHECK ((status = 'PENDING') = (sealed IS NOT NULL)),
    CHECK ((sealed IS NULL) = (nonce IS NULL) AND (sealed IS NULL) = (key_id IS NULL))
);

-- One finger of one person waits at a time: a new recording replaces it.
CREATE UNIQUE INDEX ux_fingerprint_submission_waiting
    ON fingerprint_submission (employee_id, finger) WHERE status = 'PENDING';
CREATE INDEX ix_fingerprint_submission_origin
    ON fingerprint_submission (origin_id, status, recorded_at);

-- A template approved from a store was captured by a POS, not a punch
-- station: it names the store's server instead.
ALTER TABLE fingerprint_template ALTER COLUMN terminal_id DROP NOT NULL;
ALTER TABLE fingerprint_template ADD COLUMN origin_id text;
ALTER TABLE fingerprint_template ADD CONSTRAINT fingerprint_template_names_its_capture
    CHECK (terminal_id IS NOT NULL OR origin_id IS NOT NULL);
ALTER TABLE fingerprint_enrolment_event ADD COLUMN origin_id text;

-- Employment ending erases what waits as well as what was enrolled.
CREATE OR REPLACE FUNCTION erase_fingerprints_when_employment_ends()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO fingerprint_enrolment_event
        (employee_id, finger, kind, terminal_id, origin_id, authorized)
    SELECT t.employee_id, t.finger, 'ERASED_ON_TERMINATION', t.terminal_id, t.origin_id, NULL
      FROM fingerprint_template t
     WHERE t.employee_id = NEW.id;

    DELETE FROM fingerprint_template WHERE employee_id = NEW.id;
    DELETE FROM fingerprint_submission WHERE employee_id = NEW.id;
    RETURN NEW;
END;
$$;

COMMENT ON TABLE fingerprint_submission IS
    'A finger recorded at a store''s POS, waiting for head office. Sealed like a '
    'template; the bytes are dropped once it is decided, and erased with the '
    'person''s templates when employment ends.';
