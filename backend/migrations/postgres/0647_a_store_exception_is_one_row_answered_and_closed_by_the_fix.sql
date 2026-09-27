-- A store exception is one row, answered by a person, and closed by the fix.
--
-- The exceptions are READ from data — an open `cash_shift`, a day's takings
-- with no `store_deposit` behind them, a `flow_stage_state` past its
-- `deadline_at`, missing goods in `inventory_projection`, an unaccepted
-- `cash_shift.variance_minor`, an `edge_checkout_exception` nobody answered.
-- None of those tables is changed. What they cannot hold is memory, and that
-- is this table:
--
--   * **one row per thing while it is wrong.** Keyed on (kind, subject_key)
--     while unresolved; the partial unique index makes a second open row for
--     the same shift, day, stage or case impossible, so a sweep that runs
--     twice, or a read that sweeps beside the clock, adds nothing;
--   * **closed by the data, never by a button.** A sweep that no longer finds
--     it sets `resolved_at`: the shift was closed, the bag was banked, the
--     goods were received. Nobody "resolves" an exception by saying so;
--   * **acknowledged by a person** — `POST /api/v1/exceptions/{id}/
--     acknowledge` with a note — which says somebody has it and survives
--     every sweep, because the row does;
--   * **told once**: when it is red, whether it appeared red or turned red
--     later. `notified_at` is written with the notification and never again.
--
-- `since` is when the thing began to be wrong (the business day ended, the
-- deposit fell due, the stage deadline passed, the goods went missing, the
-- drawer was counted, the checkout failed); `first_seen_at` is when a sweep
-- first found it. `unit_id` is whose exception it is: a store, or head office
-- for the Gudang's own receiving.

CREATE TABLE store_exception (
    exception_id        uuid PRIMARY KEY,
    kind                text NOT NULL CHECK (kind IN (
                            'SHIFT_NOT_CLOSED',
                            'DEPOSIT_MISSING',
                            'RECEIVE_OVERDUE',
                            'MISSING_OPEN',
                            'CASH_DIFFERENCE',
                            'CHECKOUT_UNRESOLVED'
                        )),
    -- What it is about, in the kind's own terms: a shift id, `unit:day`, a
    -- `document:stage`, a site, a checkout id.
    subject_key         text NOT NULL CHECK (btrim(subject_key) <> ''),
    unit_id             text NOT NULL REFERENCES unit (id),
    site_id             text REFERENCES site (id),

    title               text NOT NULL CHECK (btrim(title) <> ''),
    sentence            text NOT NULL CHECK (btrim(sentence) <> ''),
    since               timestamptz NOT NULL,
    severity            text NOT NULL CHECK (severity IN ('INFO', 'WARN', 'BAD')),
    -- Job role codes (`job_role.code`) that own the fix.
    owner_roles         text[] NOT NULL DEFAULT '{}',
    -- Where the hub goes to fix it: a screen and its parameters.
    link_screen         text NOT NULL CHECK (btrim(link_screen) <> ''),
    link_params         jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(link_params) = 'object'),

    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    -- The severity it had when it was first found, and when it first turned
    -- red: an exception that turned red later is told as escalated.
    first_severity      text NOT NULL CHECK (first_severity IN ('INFO', 'WARN', 'BAD')),
    bad_at              timestamptz,

    acknowledged_at     timestamptz,
    acknowledged_by     text,
    acknowledged_note   text CHECK (acknowledged_note IS NULL OR length(acknowledged_note) <= 500),

    notified_at         timestamptz,
    notification_id     uuid REFERENCES notification (notification_id) ON DELETE SET NULL,
    notified_to         text[] NOT NULL DEFAULT '{}',

    resolved_at         timestamptz,

    CONSTRAINT store_exception_acknowledgement_is_whole
        CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
    CONSTRAINT store_exception_note_belongs_to_an_acknowledgement
        CHECK (acknowledged_note IS NULL OR acknowledged_at IS NOT NULL),
    CONSTRAINT store_exception_ends_after_it_is_found
        CHECK (resolved_at IS NULL OR resolved_at >= first_seen_at),
    CONSTRAINT store_exception_red_says_when
        CHECK (severity <> 'BAD' OR bad_at IS NOT NULL)
);

CREATE UNIQUE INDEX ux_store_exception_open
    ON store_exception (kind, subject_key) WHERE resolved_at IS NULL;
CREATE INDEX ix_store_exception_unit_open
    ON store_exception (unit_id, since) WHERE resolved_at IS NULL;
CREATE INDEX ix_store_exception_resolved
    ON store_exception (resolved_at DESC) WHERE resolved_at IS NOT NULL;

COMMENT ON TABLE store_exception IS
    'The store exceptions list (0647): one row per thing that is wrong at a unit while it is wrong, found by a sweep over data the store already produces, closed by the sweep when the data is fixed, acknowledged by a person, told once when red.';
COMMENT ON COLUMN store_exception.subject_key IS
    'What the exception is about, per kind: SHIFT_NOT_CLOSED and CASH_DIFFERENCE a cash_shift id; DEPOSIT_MISSING unit:day; RECEIVE_OVERDUE document:stage_kind; MISSING_OPEN a site id; CHECKOUT_UNRESOLVED a checkout id.';
COMMENT ON COLUMN store_exception.since IS
    'When the thing began to be wrong, not when a sweep noticed (that is first_seen_at).';
