-- 0808: overtime on a rest day or a holiday is paid by the hour it falls in.
--
-- Kepmenaker 102/2004 pasal 11: on a rest day or public holiday, the first
-- tier of hours (seven on a six-day week, eight on a five-day week) is paid
-- 2× the hourly wage, the next hour 3×, and every hour after it 4×. 0250
-- counted all of a rest day's minutes in one band and said so: "closing it is
-- three more units and a migration, which is a visible act". This is that act.
--
-- The new units count only the minutes in their tier, and the old bands keep
-- counting every minute — so a catalogue that already pays rest days at 2×
-- keeps paying exactly what it did, and the tiers are paid by components that
-- carry the *extra* multiplier (1× for the next hour, 2× beyond). Owner kept
-- "Aturan / tipe lembur" in scope on 2026-09-30.

CREATE TABLE overtime_tier_rule (
    singleton                    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    -- 420 on a six-day week, 480 on a five-day week.
    rest_day_first_tier_minutes  integer NOT NULL DEFAULT 420
                                 CHECK (rest_day_first_tier_minutes IN (300, 420, 480)),
    updated                      jsonb,
    updated_at                   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO overtime_tier_rule (singleton) VALUES (true);

ALTER TABLE pay_component DROP CONSTRAINT pay_component_unit_check;
ALTER TABLE pay_component ADD CONSTRAINT pay_component_unit_check CHECK (unit IN (
    'OVERTIME_WORKDAY_FIRST_HOUR',
    'OVERTIME_WORKDAY_LATER',
    'OVERTIME_REST_DAY',
    'OVERTIME_HOLIDAY',
    'OVERTIME_REST_DAY_NEXT_HOUR',
    'OVERTIME_REST_DAY_BEYOND',
    'OVERTIME_HOLIDAY_NEXT_HOUR',
    'OVERTIME_HOLIDAY_BEYOND',
    'ROSTERED_DAY',
    'LEAVE_DAY_TAKEN'));

ALTER TABLE pay_component DROP CONSTRAINT pay_component_shape_is_whole;
ALTER TABLE pay_component ADD CONSTRAINT pay_component_shape_is_whole CHECK (
    CASE basis
        WHEN 'FIXED_AMOUNT' THEN base_ref IS NULL AND unit IS NULL
        WHEN 'PER_OCCASION' THEN base_ref IS NULL AND unit IS NULL
        WHEN 'STATUTORY' THEN base_ref IS NULL AND unit IS NULL
        WHEN 'SHARE_OF_BASE' THEN base_ref IS NOT NULL AND unit IS NULL
        WHEN 'RATE_PER_UNIT' THEN base_ref IS NULL AND unit IS NOT NULL
        WHEN 'FRACTION_OF_BASE_PER_UNIT' THEN
            base_ref IS NOT NULL
            AND unit IN ('OVERTIME_WORKDAY_FIRST_HOUR',
                         'OVERTIME_WORKDAY_LATER',
                         'OVERTIME_REST_DAY',
                         'OVERTIME_HOLIDAY',
                         'OVERTIME_REST_DAY_NEXT_HOUR',
                         'OVERTIME_REST_DAY_BEYOND',
                         'OVERTIME_HOLIDAY_NEXT_HOUR',
                         'OVERTIME_HOLIDAY_BEYOND')
    END
);
