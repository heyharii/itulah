-- 0467: an asset class is kept by Finance.
--
-- Stage 3 of "Desain Fondasi Finance Dinamis". The asset register's classes
-- (0287) could only be added by a migration. As ERPNext's Asset Category, a
-- class is now master data Finance adds from the screen, with the life and
-- method an asset of the class starts with; its accounts are the account links
-- the class code already narrows (fixed_asset, accumulated_depreciation,
-- depreciation_expense, …, with the class as source).
--
-- `legacy_code` — the client's ten-digit template a class was taken from —
-- stays for the classes that have one and is not asked of a new class.

ALTER TABLE asset_class ALTER COLUMN legacy_code DROP NOT NULL;
ALTER TABLE asset_class
    ADD COLUMN default_useful_life_months integer CHECK (default_useful_life_months > 0),
    ADD COLUMN default_method text CHECK (default_method IN ('STRAIGHT_LINE', 'DECLINING', 'NONE')),
    ADD COLUMN created_by text NOT NULL DEFAULT 'system',
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN asset_class.default_useful_life_months IS
    'The life an asset of this class is assessed with when the assessment names none (0467).';
