-- Minting EPCs, and the tagging work that carries them to the goods.
--
-- # Why the centre mints every serial
--
-- An EPC identifies one physical garment. If two garments ever carry the same
-- one, the system has two objects it cannot tell apart, and no later
-- correction recovers which was which — the tags are already on the clothes.
--
-- Two DCs numbering independently will eventually collide. Not "might": a
-- counter that starts at 1 in two places produces 1 twice on the first day.
-- So serials come from here, one counter per SKU, advanced under a row lock.
-- A DC never chooses a number; it receives finished EPC strings and prints
-- them.
--
-- # Why a range and not a row per tag
--
-- A job for 118 pieces needs 118 EPCs, and storing 118 rows to say
-- "500 through 617" is storing the same fact 118 times. The range is the
-- record; the strings are derived from it by the shared codec whenever they
-- are needed. What the centre must never lose is which serials it has ISSUED,
-- and `epc_serial_counter` alone answers that.
--
-- # What comes back
--
-- The DC confirms that tagging happened. It does not report the EPCs — those
-- arrive anyway, on the movement facts that carry each newly tagged unit into
-- the warehouse. Asking for them twice would create a second version of the
-- truth to reconcile against the first.

-- One counter per SKU. Serial 7 exists for thousands of SKUs at once; what
-- keeps tags apart is that the SKU is encoded inside the EPC alongside it.
CREATE TABLE epc_serial_counter (
    sku_code    char(11) PRIMARY KEY CHECK (sku_code ~ '^[0-9]{11}$'),
    -- The highest serial handed out so far. Allocation adds to this under a
    -- row lock and takes the range that opens up, so two jobs for the same
    -- SKU issued at the same instant get adjacent ranges, never equal ones.
    last_serial bigint NOT NULL DEFAULT 0 CHECK (last_serial >= 0),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE epc_serial_counter IS
    'The centre''s sole authority on which EPC serials have been issued. Advanced under FOR UPDATE; never reset, never reused.';

-- The work order a DC receives: print these labels, attach them to those
-- goods.
CREATE TABLE tagging_job (
    job_id       uuid PRIMARY KEY,
    -- One job per setup session: the session decides the identity, the job
    -- carries it to the goods.
    session_id   uuid NOT NULL UNIQUE REFERENCES article_setup_session(session_id) ON DELETE CASCADE,
    site_id      text NOT NULL,
    article_code text NOT NULL,
    article_name text NOT NULL,
    image_url    text,
    -- How many units this job accounts for, across all its lines. Equal to
    -- the receipt quantity the session was opened against.
    total_quantity bigint NOT NULL CHECK (total_quantity > 0),

    status       text NOT NULL DEFAULT 'ISSUED'
                 CHECK (status IN ('ISSUED', 'TAGGED', 'CANCELLED')),
    issued_by    text NOT NULL,
    issued_at    timestamptz NOT NULL DEFAULT now(),
    -- Who at the DC confirmed the tags are on the goods, and when.
    confirmed_by text,
    confirmed_at timestamptz,
    command_id   uuid,

    CHECK ((status = 'TAGGED') = (confirmed_at IS NOT NULL)),
    CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL))
);
CREATE INDEX ix_tagging_job_site ON tagging_job(site_id, status);
CREATE INDEX ix_tagging_job_status ON tagging_job(status, issued_at);

-- One line per SKU in the job, carrying the serial range minted for it.
CREATE TABLE tagging_job_line (
    job_id      uuid     NOT NULL REFERENCES tagging_job(job_id) ON DELETE CASCADE,
    sku_code    char(11) NOT NULL CHECK (sku_code ~ '^[0-9]{11}$'),
    colour_digit char(1) NOT NULL CHECK (colour_digit ~ '^[0-9]$'),
    colour_label text    NOT NULL,
    size_code   char(2)  NOT NULL,
    size_label  text     NOT NULL,
    quantity    bigint   NOT NULL CHECK (quantity > 0),
    -- Inclusive range. `serial_to` is stored rather than derived so that a
    -- reader sees the span without having to trust arithmetic, and the CHECK
    -- keeps the two in step.
    serial_from bigint   NOT NULL CHECK (serial_from >= 0),
    serial_to   bigint   NOT NULL,
    -- The same QR on every unit of this SKU. Carried explicitly rather than
    -- recomputed at the edge, because the edge must never encode anything.
    qr_payload  text     NOT NULL CHECK (btrim(qr_payload) <> ''),
    barcode_payload text NOT NULL CHECK (btrim(barcode_payload) <> ''),
    base_price_minor bigint NOT NULL CHECK (base_price_minor >= 0),

    PRIMARY KEY (job_id, sku_code),
    CHECK (serial_to = serial_from + quantity - 1)
);
CREATE INDEX ix_tagging_job_line_sku ON tagging_job_line(sku_code);

-- No two live jobs may claim overlapping serials for one SKU. The counter
-- already makes this impossible; this index makes it impossible to have made
-- a mistake in the code that uses the counter.
CREATE UNIQUE INDEX tagging_job_line_serial_start_unique
    ON tagging_job_line(sku_code, serial_from);

COMMENT ON COLUMN tagging_job_line.serial_from IS
    'First serial in this line''s minted range. The EPC strings are derived from (sku_code, serial) by the shared codec — they are not stored, because the range already says exactly which ones exist.';
