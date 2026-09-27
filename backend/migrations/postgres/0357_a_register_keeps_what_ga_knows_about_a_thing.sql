-- 0357: a register keeps what GA knows about a thing.
--
-- `fixed_asset` has carried an IDENTITY since 0070: a number, a name, a class,
-- a location, a status, the serial. That is what Finance needs to decide
-- whether the thing belongs in the books and what it is worth, and Finance has
-- never wanted anything else from it.
--
-- It is not what the person standing in front of the thing needs. The questions
-- asked in a shop are where in the building it is ("Lt. 1 · area kasir"), who
-- signed for it ("Kurir antar toko", and that person is often not a user of this
-- system at all), what condition it is in, and what was written down about it
-- when it was bought — the plate of a car, the warranty end of an air
-- conditioner, the certificate number of a piece of land.
--
-- # Four columns and not four tables
--
-- The obvious tidier shape would be `asset_location` and `asset_custodian` as
-- tables with their own histories. It would be the wrong shape here:
--
--   * Who is ASKING is somebody on their feet in the shop. "Where is it?" has
--     to be one line in a list, not a join through a table whose third row
--     supersedes the first two.
--   * The history that matters is not "which rows of a location table exist".
--     It is "this thing moved, on this day, for this reason" — a fact about the
--     ASSET, and it has its own table below, where the transfer that changed
--     the column also writes the row.
--   * `holder` is deliberately TEXT and not a foreign key to `app_user`. The
--     holder of a shop's laptop is a shift, not a login: "Visual merchandiser"
--     and "Kurir antar toko" hold things here and have no account. A foreign
--     key would have refused exactly the answers this column exists for.
--
-- # `specs`, and why the fields are not here
--
-- What somebody has to WRITE DOWN about a thing depends on which of the eleven
-- forms it is filed on, and 0356 put that answer on the class as `build`. A
-- vehicle has a plate; an air conditioner has a capacity and a warranty; land
-- has a certificate and an area.
--
-- Those fields are structured because two of them are FACTS ABOUT WHAT THE
-- SYSTEM MAY DO and not just description: the plate has to be unique among
-- vehicles still in service, and a warranty end is a date something can be
-- asked about later. So they live in `specs` as JSON, one object per asset,
-- keyed by the build's own field names.
--
-- What may be IN `specs` is validation — which key a build accepts and what
-- shape its value must take — and 0356 already argued where that belongs: next
-- to the writer, in Rust, where a wrong value is a sentence somebody reads
-- rather than a row that silently went in. This migration is deliberately
-- silent about the keys. It asserts only the one structural fact it can: that
-- `specs` is an OBJECT, so a scalar or an array cannot be stored where the
-- readers will look for fields.
--
-- # One plate, one car
--
-- Two vehicles in service must not carry the same plate: it is the number a
-- traffic officer, an insurer and a parking attendant read, and two cars
-- wearing one is not a cosmetic problem. So the plate is unique — but only
-- among the vehicles that HAVE one and only among the ones still here. A car
-- whose plate was `B 1234 XYZ` and which has been disposed of must not keep
-- that plate occupied for ever: the plate went back to the owner, or to the
-- next car, and in this country a registration number genuinely does move
-- between vehicles. `status <> 'DISPOSED'` is that sentence.

ALTER TABLE fixed_asset
    -- "Lt. 1 · area kasir". A line of text rather than a table, because the
    -- only person who reads it is standing in the building.
    ADD COLUMN sub_location TEXT,
    -- Who is holding it. TEXT and not a foreign key — see above. Nullable
    -- because a rack in a warehouse is held by nobody in particular.
    ADD COLUMN holder       TEXT,
    -- `BAIK` / `PERLU_SERVIS` / `RUSAK` — the words a shop already uses on a
    -- walk-round sheet. Not free text: a condition that could be spelled four
    -- ways is a condition no report can group by. Defaulting to `BAIK` rather
    -- than leaving it null is deliberate and is not an assumption about the
    -- thing — it is the answer "nobody has looked at it and nothing about it
    -- has been reported", which is what an untouched item is.
    ADD COLUMN condition    TEXT NOT NULL DEFAULT 'BAIK'
        CHECK (condition IN ('BAIK', 'PERLU_SERVIS', 'RUSAK')),
    -- The build's fields, as an object — see above. `{}` for a build that has
    -- no physical facts at all (SOFTWARE, DEFERRED, CIP), which is why the
    -- default is an empty object rather than NULL: "this form has no fields"
    -- and "nobody filled the form in" must not look the same to a reader.
    ADD COLUMN specs        JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The one structural promise the migration can make about `specs` on its own.
-- Named, so a refusal says which promise was broken.
ALTER TABLE fixed_asset ADD CONSTRAINT fixed_asset_specs_are_an_object
    CHECK (jsonb_typeof(specs) = 'object');

COMMENT ON COLUMN fixed_asset.sub_location IS
    'Where inside the site the thing is, as somebody standing there would say it ("Lt. 1 · area kasir"). GA''s fact, not Finance''s.';
COMMENT ON COLUMN fixed_asset.holder IS
    'Who physically holds it. Deliberately not a foreign key to app_user: holders are often not users of this system ("Kurir antar toko"). The name, written by whoever handed it over.';
COMMENT ON COLUMN fixed_asset.condition IS
    'The shop''s own three words. Default BAIK is "nothing has been reported about it", which is what an item nobody has looked at is.';
COMMENT ON COLUMN fixed_asset.specs IS
    'The build''s fields, as an object keyed by the field names 0356''s form defines. Which keys and what shape is validated in Rust (domain::ga::assert_specs), not here.';

-- One plate, one vehicle still in service. The expression index over
-- `specs ->> 'plate'` is what makes the rule reachable: the plate is a FIELD of
-- a vehicle, not a column, because the eight other builds have no such field
-- and a `plate` column that is null for a lift is a column that lies about the
-- schema.
CREATE UNIQUE INDEX ux_fixed_asset_active_plate
    ON fixed_asset ((specs ->> 'plate'))
 WHERE specs ->> 'plate' IS NOT NULL
   AND status <> 'DISPOSED';

-- ---------------------------------------------------------------------------
-- The history: what happened to this thing, appended
-- ---------------------------------------------------------------------------
--
-- `site_id`, `sub_location` and `holder` say where the thing is NOW. They say
-- nothing about how it got there, and the question an auditor asks is always
-- the second one: "the air conditioner is in the Cilandak shop, who moved it,
-- when, and why".
--
-- So every change GA makes to those three writes a row here, and the row is
-- never edited. A register that can be edited in place is not a register: the
-- mistake it hides is exactly the fact somebody came looking for. Append-only
-- is enforced by a trigger below rather than by a convention — the brief's §12
-- rule, and the same shape `asset_capitalization` (0070) and `asset_transfer`
-- (0096) already use.
--
-- The kinds are the five acts GA actually performs on a thing:
--
--   REGISTERED  somebody put it in the register
--   TRANSFER    it moved to another site, sub-location or holder
--   ASSIGN      the holder changed and the place did not
--   CONDITION   somebody walked past it and it was no longer fine
--   NOTE        anything else worth writing down
--
-- `reason` is required on EVERY kind, REGISTERED included. It is the one line
-- that says why the row exists, and a history in which the day-one entry says
-- nothing is a history whose first question cannot be answered.
CREATE TABLE ga_asset_event (
    event_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id     uuid NOT NULL REFERENCES fixed_asset (asset_id),
    kind         TEXT NOT NULL CHECK (kind IN
                     ('REGISTERED', 'TRANSFER', 'ASSIGN', 'CONDITION', 'NOTE')),
    -- Where it came from and went to, for a TRANSFER. `site` is the estate's
    -- own list, so a move to a place that does not exist is refused rather
    -- than recorded.
    from_site    TEXT REFERENCES site (id),
    to_site      TEXT REFERENCES site (id),
    -- The holders either side of an ASSIGN or a TRANSFER. Text, for the reason
    -- `fixed_asset.holder` is: a holder is a name, not an account.
    from_holder  TEXT,
    to_holder    TEXT,
    reason       TEXT NOT NULL CHECK (btrim(reason) <> ''),
    -- The date the act happened, which is not the moment somebody typed it: a
    -- move made on Friday gets written up on Monday.
    occurred_on  date NOT NULL,
    -- Who wrote it down. Required, and taken from the session rather than from
    -- a request body — an authority that can be typed is not an authority.
    recorded_by  TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at  timestamptz NOT NULL DEFAULT now()
);

-- The hot read is "the history of one thing", newest act first. `occurred_on`
-- leads because that is the order a person reads a history in; `recorded_at`
-- breaks a tie between two acts on the same day, which a shop fitting-out
-- produces several of.
CREATE INDEX ix_ga_asset_event_asset ON ga_asset_event (asset_id, occurred_on, recorded_at);

COMMENT ON TABLE ga_asset_event IS
    'What happened to one asset, appended and never edited. The columns on fixed_asset say where the thing is now; this says how it got there.';
COMMENT ON COLUMN ga_asset_event.reason IS
    'Why this row exists, in a sentence. Required on every kind, REGISTERED included — the first question about any history is the first entry of it.';

CREATE OR REPLACE FUNCTION protect_ga_asset_event() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'an asset history is appended, not %: write the correction as a new event and the old one stays',
        lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ga_asset_event_append_only
    BEFORE UPDATE OR DELETE ON ga_asset_event
    FOR EACH ROW EXECUTE FUNCTION protect_ga_asset_event();

DO $$
DECLARE
    absent   text;
    loose    text;
    defaulted text;
    refused  text;
    probe_id uuid;
    probe    text;
BEGIN
    -- The four columns, present. Counted rather than checked one by one so the
    -- refusal can name the ones that are missing.
    SELECT string_agg(c.name, ', ' ORDER BY c.name) INTO absent
      FROM unnest(ARRAY['sub_location', 'holder', 'condition', 'specs']) c(name)
     WHERE NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_name = 'fixed_asset' AND column_name = c.name);
    IF absent IS NOT NULL THEN
        RAISE EXCEPTION '0357 left fixed_asset without %', absent;
    END IF;

    -- And the two that must not be nullable, because a condition or a set of
    -- fields that can be NULL is a screen that has to decide what an absent one
    -- means — which is the question `{}` and `BAIK` were chosen to answer.
    SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO loose
      FROM information_schema.columns
     WHERE table_name = 'fixed_asset'
       AND column_name IN ('condition', 'specs')
       AND is_nullable = 'YES';
    IF loose IS NOT NULL THEN
        RAISE EXCEPTION '0357 left fixed_asset.% nullable', loose;
    END IF;

    -- The default matters as much as the nullability: a row inserted by a
    -- writer that never heard of this migration must still get `{}`, or the
    -- JSONB object promise below is only true of rows this code wrote.
    SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO defaulted
      FROM information_schema.columns
     WHERE table_name = 'fixed_asset'
       AND column_name IN ('condition', 'specs')
       AND (column_name, column_default) NOT IN
           (('condition', '''BAIK''::text'), ('specs', '''{}''::jsonb'));
    IF defaulted IS NOT NULL THEN
        RAISE EXCEPTION '0357 gave fixed_asset.% an unexpected default', defaulted;
    END IF;

    -- `specs` is an object in every row that exists. Nothing but this CHECK
    -- stands between a scalar and the readers that look up fields in it.
    IF EXISTS (SELECT 1 FROM fixed_asset WHERE jsonb_typeof(specs) <> 'object') THEN
        RAISE EXCEPTION '0357 left a fixed_asset.specs that is not an object';
    END IF;

    -- And the CHECK itself, named, so the next reader finds the same rule the
    -- writers are told about.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'fixed_asset'::regclass
           AND conname  = 'fixed_asset_specs_are_an_object')
    THEN
        RAISE EXCEPTION '0357 did not constrain fixed_asset.specs to be an object';
    END IF;

    -- The plate index, present and partial. Asserting the predicate rather
    -- than the name: an index that exists but applied to every vehicle,
    -- disposed ones included, would refuse the next car the plate was moved to.
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE tablename = 'fixed_asset'
           AND indexname = 'ux_fixed_asset_active_plate'
           AND indexdef LIKE '%UNIQUE%'
           AND indexdef LIKE '%specs ->> ''plate''%'
           AND indexdef LIKE '%DISPOSED%')
    THEN
        RAISE EXCEPTION '0357 did not install a unique index on the plate of a vehicle still in service';
    END IF;

    -- # The append-only trigger, proven rather than assumed
    --
    -- Both probes run inside a subtransaction of their own. The point is not
    -- just that the trigger exists — it is that an UPDATE and a DELETE really
    -- come back as an error, which is a thing only a live attempt can show.
    -- Each probe writes its own asset, because `ga_asset_event` needs one to
    -- point at; if the refusal does not arrive, the whole migration aborts and
    -- the probe rows go with it.
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'ga_asset_event'::regclass
           AND tgname  = 'ga_asset_event_append_only'
           AND NOT tgisinternal)
    THEN
        RAISE EXCEPTION '0357 did not install the append-only trigger on ga_asset_event';
    END IF;

    FOREACH probe IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
        probe_id := gen_random_uuid();
        refused  := NULL;
        BEGIN
            INSERT INTO fixed_asset
                (asset_id, asset_number, name, category_code, site_id, acquired_on, registered_by)
            VALUES (probe_id, 'PROBE-0357-' || probe, '0357 probe', 'TANAH_HAK_MILIK', 'dc',
                    current_date, 'probe');
            INSERT INTO ga_asset_event (asset_id, kind, reason, occurred_on, recorded_by)
            VALUES (probe_id, 'NOTE', '0357 probe', current_date, 'probe');
            IF probe = 'UPDATE' THEN
                UPDATE ga_asset_event SET reason = 'diubah' WHERE asset_id = probe_id;
            ELSE
                DELETE FROM ga_asset_event WHERE asset_id = probe_id;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            refused := SQLERRM;
        END;

        IF refused IS NULL THEN
            RAISE EXCEPTION '0357: the append-only trigger allowed a % on ga_asset_event', probe;
        END IF;
        -- Anything other than the trigger's own sentence means the probe failed
        -- for a reason that has nothing to do with append-only — a missing
        -- site, a class that is not there — and passing on that would be
        -- passing on nothing.
        IF refused NOT LIKE '%appended, not%' THEN
            RAISE EXCEPTION '0357: the % probe on ga_asset_event failed for another reason: %',
                probe, refused;
        END IF;
    END LOOP;

    -- And the pause is still in place. This migration adds a column and a
    -- history; it must not have talked anybody into switching posting on.
    IF EXISTS (
        SELECT 1 FROM finance_posting_control
         WHERE singleton = true AND automatic_posting_enabled
    ) THEN
        RAISE EXCEPTION '0357 expected automatic posting to remain paused during review';
    END IF;
END;
$$;
