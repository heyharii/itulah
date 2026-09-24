-- 0356: an asset class says which build it is.
--
-- The register names WHAT a thing is, and until now that one answer had to
-- carry two different jobs. 0355 split the first one off — which accounts the
-- class posts to — and left the second one homeless: which FORM the person
-- filling it in should be looking at.
--
-- Those are not the same question. `AIR_CONDITIONER`, `LIFT`, `ESKALATOR` and
-- `GENSET` are four classes — four sets of accounts, four depreciation lives —
-- and one form: a technical machine with a make, a capacity, an installation
-- date and a warranty. `FFE_OFFICE`, `FFE_INTERIOR` and `FFE_EXTERIOR` are
-- three more classes and one other form: furniture with a material and a
-- dimension. Asking a shop manager to choose between four AC-shaped forms
-- would be asking them a question the business does not have, and asking them
-- to fill in one generic form would be asking for the warranty date of a
-- curtain rail.
--
-- So the class gains a `build`, and `build` is the eleven shapes the estate
-- actually has. It decides the form and the icon; the class still decides the
-- accounts, exactly as 0355 left it. Nothing here changes a posting.
--
-- # Why eleven, and where each one comes from
--
-- The list is the client's own register read back. Their `MASTER ASSET` has
-- 1,342 rows in a flat list of 59 sub-types; the sub-types group into eleven
-- families by what a person has to WRITE DOWN about one of them:
--
--   LAND      Tanah Hak Milik, Hak Sewa Tanah / HGB — a certificate, an area,
--             a right that expires.
--   BUILDING  Bangunan Utama, Tambahan, Staff House / Mess — an area, floors,
--             what it is used for.
--   TECH      Instalasi ME, AC, Lift, Eskalator, Genset — make, capacity,
--             installed on, warranted until. The largest family after OE.
--   VEHICLE   Mobil, Sepeda Motor — plate, year, chassis, engine, odometer.
--   FFE       the five FFE classes — kind, material, dimension.
--   IT        FFE Komputer — device, make, specification, hostname, warranty.
--   AUDIO     FFE Music — make, power, warranty.
--   OE        all thirty-six operating-equipment classes — material, size,
--             shop area; replaced rather than depreciated.
--   SOFTWARE  Seventh Soft, Opti Tex — no physical facts at all.
--   DEFERRED  Pre Opening — likewise.
--   CIP       Contract In Progress — likewise, until it is re-filed.
--
-- # The one rule rather than a second list
--
-- Everything above is written out class by class, so the day somebody adds a
-- class the omission is visible in this file. Operating equipment is not: it
-- is `kind = 'OE'`, which is how 0355 maps its accounts too, because the
-- thirty-six OE sub-types are one thing told thirty-six ways and the
-- thirty-seventh will be the same thing again.
--
-- # Deliberately not a form definition
--
-- The fields of each build are NOT here. They are validation — which keys of
-- `fixed_asset.specs` a build accepts and what shape each one must be — and
-- validation belongs next to the writer, in Rust, where a wrong value is a
-- sentence somebody reads rather than a row that silently went in. This
-- migration answers only "which build", because that is the question the list
-- of classes can answer and the form cannot.

ALTER TABLE asset_class
    ADD COLUMN build TEXT
        CONSTRAINT asset_class_build_is_one_of_the_builds CHECK (
            build IN ('LAND', 'BUILDING', 'TECH', 'VEHICLE', 'FFE', 'IT',
                      'AUDIO', 'OE', 'SOFTWARE', 'DEFERRED', 'CIP')
        );

WITH builds(class_code, build) AS (
    VALUES
        ('TANAH_HAK_MILIK',                'LAND'),
        ('HAK_SEWA_TANAH_HGB',             'LAND'),
        ('BANGUNAN_UTAMA',                 'BUILDING'),
        ('BANGUNAN_TAMBAHAN',              'BUILDING'),
        ('BANGUNAN_STAFF_HOUSE_MESS',      'BUILDING'),
        ('INSTALASI_MEKANIKAL_ELEKTRIKAL', 'TECH'),
        ('AIR_CONDITIONER',                'TECH'),
        ('LIFT',                           'TECH'),
        ('ESKALATOR',                      'TECH'),
        ('GENSET',                         'TECH'),
        ('MOBIL',                          'VEHICLE'),
        ('SEPEDA_MOTOR',                   'VEHICLE'),
        ('FFE_OFFICE',                     'FFE'),
        ('FFE_TOKO_DAN_GUDANG',            'FFE'),
        ('FFE_STAFF_HOUSE_MESS',           'FFE'),
        ('FFE_INTERIOR',                   'FFE'),
        ('FFE_EXTERIOR',                   'FFE'),
        ('FFE_KOMPUTER',                   'IT'),
        ('FFE_MUSIC',                      'AUDIO'),
        ('SEVENTH_SOFT_APPLICATION',       'SOFTWARE'),
        ('OPTI_TEX_SYSTEM',                'SOFTWARE'),
        ('PRE_OPENING',                    'DEFERRED'),
        ('CONTRACT_IN_PROGRESS',           'CIP')
)
UPDATE asset_class c
   SET build = builds.build
  FROM builds
 WHERE builds.class_code = c.class_code;

-- The thirty-six, by kind, for the reason 0355 gives: they are one thing.
UPDATE asset_class SET build = 'OE' WHERE kind = 'OE';

-- A class without a build is a class whose form nobody can draw, which is the
-- bug this migration exists to close — so it is a schema fact and not a
-- convention. Nothing is left nullable.
ALTER TABLE asset_class ALTER COLUMN build SET NOT NULL;

DO $$
DECLARE
    short integer;
    builds text;
BEGIN
    SELECT count(*) INTO short FROM asset_class WHERE build IS NULL;
    IF short <> 0 THEN
        RAISE EXCEPTION '0356 left % asset classes without a build', short;
    END IF;

    -- Every one of the eleven is reachable, so a build nobody can arrive at is
    -- a form and an icon maintained for nothing. Software and deferred have
    -- two classes each, CIP one: the seed is exhaustive, not a sample.
    SELECT string_agg(DISTINCT b, ', ' ORDER BY b) INTO builds
      FROM unnest(ARRAY['LAND', 'BUILDING', 'TECH', 'VEHICLE', 'FFE', 'IT',
                        'AUDIO', 'OE', 'SOFTWARE', 'DEFERRED', 'CIP']) b
     WHERE NOT EXISTS (SELECT 1 FROM asset_class c WHERE c.build = b);
    IF builds IS NOT NULL THEN
        RAISE EXCEPTION '0356 installed builds nothing is filed under: %', builds;
    END IF;

    -- Operating equipment stays whole. A fifth of the class list is OE and the
    -- replacement reserve is resolved by `kind`, so a partial mapping here
    -- would refuse a rack's monthly charge and nowhere else.
    IF EXISTS (SELECT 1 FROM asset_class WHERE kind = 'OE' AND build <> 'OE') THEN
        RAISE EXCEPTION '0356 filed an operating-equipment class somewhere other than OE';
    END IF;

    -- And this migration answers a form question; it must not have disturbed
    -- the posting pause 0355 left in place.
    IF EXISTS (
        SELECT 1 FROM finance_posting_control
         WHERE singleton = true AND automatic_posting_enabled
    ) THEN
        RAISE EXCEPTION '0356 expected automatic posting to remain paused during review';
    END IF;
END;
$$;
