-- 0233: A fingerprint is kept where the person can be moved, not where they enrolled.
--
-- Adapted from the reference HR backend's `044_attendance_v1.sql` (the kiosk
-- half) plus the fingerprint device boundary in its `hardware-agent`. The
-- template store itself has no donor: that codebase leaves templates in the
-- vendor's local database on the terminal, and the owner decided against it.
-- `docs/hr-port-provenance.md` records every adaptation.
--
-- # The two decisions this schema exists to hold
--
-- **Templates live here, in the cloud, and enrolment happens at the store.** A
-- terminal pulls only the templates of people posted to its own unit. Two
-- failures are what that buys: somebody transferred from store-03 to store-07
-- does not re-enrol, and a terminal that dies does not take a unit's
-- enrolments with it. The donor's arrangement loses both — its templates are
-- the device's, so the device is the backup.
--
-- **Only a registered terminal can produce a punch.** `attendance_terminal` is
-- not a description of a device; it *is* the attendance authority, the same way
-- the donor's `attendance_kiosks` was. A row here in ACTIVE is the only thing
-- in the system that can attest an identification, because the domain's
-- `Punch::record` needs a `TerminalAttestation` and `AttendanceTerminal::attest`
-- is the only function that mints one. Registering one is therefore an
-- authorized, audited act rather than an insert.
--
-- # Biometric data is regulated, and the shape says so
--
-- UU 27/2022 (PDP) art. 4(2)(a) makes biometric data *data pribadi spesifik*.
-- Four consequences, all of them structural here rather than left to a caller:
--
-- 1. what is stored is the **vendor template** — a feature vector — and never
--    an image. There is no column an image would fit in, and `format` records
--    which vendor produced the vector so a later reader knows what it is
--    holding rather than guessing;
-- 2. it is stored **sealed**. `sealed` is ciphertext, `nonce` is its nonce and
--    `key_id` names the key that sealed it. A `psql` reader sees bytes;
-- 3. it is **deleted when employment ends** — by the trigger at the foot of
--    this file, so it cannot be forgotten, and the deletion is recorded in
--    `fingerprint_enrolment_event` because a deletion nobody can see happening
--    is indistinguishable from a deletion that did not;
-- 4. no view serves it. The only read is the per-unit terminal sync, which is
--    authenticated by the node's own ingest key rather than by a browser
--    session, so there is no session in the system that can ask for one.

-- The punch station at one unit.
--
-- A terminal attests for exactly one place. Not a nullable "current location":
-- a device whose place can be blank is a device that can punch anywhere.
CREATE TABLE attendance_terminal (
    id          text PRIMARY KEY CHECK (btrim(id) <> ''),
    place_id    text NOT NULL REFERENCES org_place(id),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    -- REVOKED is terminal and there is no transition back, because the
    -- physical device the identity named is gone. A row edited from REVOKED to
    -- ACTIVE would resurrect an identity somebody decided to destroy — which
    -- is why the status is folded from `history` on the way in and a row whose
    -- claim its own history does not produce fails to load.
    status      text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    -- How the device identifies people. Stored rather than assumed: a punch
    -- claiming a method its terminal does not perform fails provenance on the
    -- way back in.
    --
    -- One value, and that is the decision rather than a placeholder. The owner
    -- was asked twice — worn prints in retail and the warehouse, and the people
    -- who cannot enrol at all becoming a daily manual correction — and
    -- reaffirmed that fingerprint is the only way in. No PIN, no card, no
    -- exception. The check is one value so that adding a second is a migration
    -- somebody has to write on purpose.
    method      text NOT NULL CHECK (method IN ('FINGERPRINT')),
    -- Who registered it, under which key, when, and why. An
    -- `employment::Authorization`; NOT NULL because registration *creates*
    -- attendance authority where there was none, and an anonymous creation of
    -- authority is the one thing this table must not admit.
    registered  jsonb NOT NULL,
    -- Every later suspension, reactivation and revocation, oldest first, each
    -- with its own authority. Append-only.
    history     jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The terminal's own last word about itself: when it last synced templates
    -- and when it last delivered a punch. Read by the Devices screen so "that
    -- one is unplugged on a Monday" is answerable before payroll rather than
    -- after.
    synced_at   timestamptz,
    punched_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_attendance_terminal_place
    ON attendance_terminal (place_id, status);

-- One enrolled finger of one person.
--
-- The primary key is `(employee_id, finger)` rather than a surrogate id: a
-- person has one template per finger, and a second row for the same finger is
-- not a second enrolment but a replacement. Replacing bumps `revision` and
-- appends to the event log, so "when was this re-enrolled and by whom" survives
-- the overwrite.
CREATE TABLE fingerprint_template (
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- Which finger, so a second enrolment of the same one is a replacement and
    -- a second finger is a second row. The vocabulary is spelled out here for
    -- the reason every other vocabulary in this schema is.
    finger      text NOT NULL CHECK (finger IN (
                    'LEFT_THUMB',  'LEFT_INDEX',  'LEFT_MIDDLE',  'LEFT_RING',  'LEFT_LITTLE',
                    'RIGHT_THUMB', 'RIGHT_INDEX', 'RIGHT_MIDDLE', 'RIGHT_RING', 'RIGHT_LITTLE'
                )),
    -- The sealed vendor template. Ciphertext, so the bytes in this column are
    -- not a fingerprint to anybody who reads the table.
    sealed      bytea NOT NULL CHECK (octet_length(sealed) > 0),
    nonce       bytea NOT NULL CHECK (octet_length(nonce) = 12),
    -- Which key sealed it. Present so a key can be rotated without anybody
    -- having to guess which rows are still under the old one.
    key_id      text NOT NULL CHECK (btrim(key_id) <> ''),
    -- What the plaintext is, when it is opened. A vendor's feature vector is
    -- meaningless without knowing whose format it is, and a store that did not
    -- say would be a store nobody could migrate off.
    format      text NOT NULL CHECK (format IN ('ZKFINGER_V10')),
    -- The vendor's own quality score for the capture, 0..100, or NULL when the
    -- device did not report one. NULL is not zero: zero is a claim the capture
    -- was worthless, and "the sidecar told us nothing" is a different fact.
    quality     smallint CHECK (quality IS NULL OR quality BETWEEN 0 AND 100),
    -- Which terminal captured it. Kept because a run of bad enrolments is
    -- usually one reader, and the question "which device produced these" is
    -- unanswerable after the fact unless it was written down at the time.
    terminal_id text NOT NULL REFERENCES attendance_terminal(id),
    -- Who enrolled whom, under which key, when, and why.
    enrolled    jsonb NOT NULL,
    -- 1 for a first enrolment, and one more for each replacement.
    revision    integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, finger)
);

-- The terminal sync's query: every template of everybody posted here. It joins
-- through `employee_assignment` rather than storing a place on the template,
-- deliberately — a template does not belong to a shop, it belongs to a person,
-- and a copy of the posting here is the field that is wrong the day somebody
-- is transferred.
CREATE INDEX ix_fingerprint_template_employee
    ON fingerprint_template (employee_id);

-- What happened to somebody's enrolment, append-only.
--
-- Separate from the template row because the template row is *deleted* when
-- employment ends, and the one thing that must survive that deletion is the
-- record that it happened. A store where the evidence dies with the data cannot
-- answer "was this person's fingerprint disposed of", which is precisely the
-- question a data-protection audit asks.
CREATE TABLE fingerprint_enrolment_event (
    id          bigserial PRIMARY KEY,
    -- No foreign key, on purpose. `employee` rows can be deleted, and the
    -- disposal record must outlive the person's row rather than cascade with
    -- it. The id is kept as text so it is still joinable while the row exists.
    employee_id text NOT NULL CHECK (btrim(employee_id) <> ''),
    finger      text NOT NULL,
    kind        text NOT NULL CHECK (kind IN (
                    'ENROLLED', 'REPLACED', 'WITHDRAWN', 'ERASED_ON_TERMINATION'
                )),
    terminal_id text,
    -- Who did it, under which key, when, and why — except for the automatic
    -- erasure, which nobody decides: it follows from employment ending, and
    -- naming an actor for it would be inventing a decision somebody took.
    authorized  jsonb,
    at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fingerprint_event_authority_matches_kind CHECK (
        (kind =  'ERASED_ON_TERMINATION' AND authorized IS NULL) OR
        (kind <> 'ERASED_ON_TERMINATION' AND authorized IS NOT NULL)
    )
);

CREATE INDEX ix_fingerprint_enrolment_event_employee
    ON fingerprint_enrolment_event (employee_id, at DESC);

-- Erase the templates when employment ends.
--
-- A trigger rather than a line in the termination handler, because this is the
-- rule that must not be forgettable: any route that ends employment, any
-- migration that backfills a status, any correction applied in `psql`, all of
-- them dispose of the biometrics. A handler can be bypassed by the next route
-- somebody writes; this cannot.
--
-- TERMINATED only. A suspension is not the end of employment — somebody
-- suspended pending an investigation comes back, and making them re-enrol on
-- the way back in would turn a suspension into a punishment nobody ordered.
CREATE OR REPLACE FUNCTION erase_fingerprints_when_employment_ends()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO fingerprint_enrolment_event (employee_id, finger, kind, terminal_id, authorized)
    SELECT t.employee_id, t.finger, 'ERASED_ON_TERMINATION', t.terminal_id, NULL
      FROM fingerprint_template t
     WHERE t.employee_id = NEW.id;

    DELETE FROM fingerprint_template WHERE employee_id = NEW.id;
    RETURN NEW;
END;
$$;

-- `AFTER`, and on the transition rather than on every write: the templates are
-- erased when the status *becomes* TERMINATED, so a second update of an
-- already-terminated row does not log a second erasure of nothing.
CREATE TRIGGER employment_ending_erases_fingerprints
    AFTER UPDATE OF status ON employee
    FOR EACH ROW
    WHEN (NEW.status = 'TERMINATED' AND OLD.status <> 'TERMINATED')
    EXECUTE FUNCTION erase_fingerprints_when_employment_ends();

COMMENT ON TABLE attendance_terminal IS
    'The punch station at one unit, and the attendance authority itself: a row '
    'in ACTIVE is the only thing that can attest an identification. Status is '
    'folded from the history, so a row cannot claim a state its evidence '
    'contradicts.';
COMMENT ON TABLE fingerprint_template IS
    'Sealed vendor templates, held centrally so a transfer needs no re-enrolment '
    'and a dead terminal takes no unit''s enrolments with it. Never an image, '
    'never served to a browser, erased when employment ends.';
COMMENT ON TABLE fingerprint_enrolment_event IS
    'Append-only record of every enrolment, replacement, withdrawal and '
    'automatic erasure. Outlives the template row it describes, because the one '
    'thing a disposal must leave behind is the evidence it happened.';
