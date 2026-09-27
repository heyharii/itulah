-- Head office sets when a store is late, or off, and who is told.
--
-- The store exceptions list (owner's decision of 28 Sep 2026) is one "needs
-- attention" list of the things that go wrong in stores and that head office
-- must see: a till shift left open past its day, takings not deposited, goods
-- not received by their deadline, missing stock nobody has decided, a drawer
-- that counted wrong. It is business, not technical: the fleet status page
-- (0637-0640) keeps the machines, and this keeps the work.
--
-- Every exception is read from data the store already produces; what decides
-- that the data is an EXCEPTION is a threshold, and a threshold is a setting,
-- not a constant (the rule `finance_setting` and `fleet_setting` follow). One
-- row, typed columns, each held to a range, the way 0637 does it.
--
-- # Till shifts
--
--   shift_grace_minutes      A shift is late once its business day (the
--                            shop's own clock, `site_business_timezone`) has
--                            ended and this long has gone by. Two hours, for
--                            the shop that closes at ten and counts at eleven.
--   shift_bad_hours          Red when it is later than this. Twelve.
--   cash_difference_minor    A counted drawer off by more than this, and not
--                            yet accepted by head office, is an exception.
--                            Rp 10.000.
--   cash_difference_bad_minor  Red above this. Rp 100.000.
--
-- # Deposits
--
--   deposit_due_days         A day's cash takings are banked by the end of the
--                            day this many days later. One: tomorrow.
--   deposit_tolerance_minor  A shortfall no larger than this is rounding.
--   deposit_bad_days         Red once the deposit is this many days late.
--   deposit_lookback_days    How far back the takings are read. A month.
--
-- # Goods
--
--   stage_bad_hours          A flow stage past its template deadline is red
--                            once it is this late. A day.
--   missing_open_days        Missing goods nobody has decided (found or lost)
--                            for this long are an exception. A week.
--   missing_bad_days         Red at this age. Thirty days.
--
-- # Money a shop holds with no sale behind it
--
--   checkout_bad_hours       A checkout the till could not finish is red once
--                            head office has left it unanswered this long.
--
-- # Who is told
--
-- An exception is told once, when it is red — when it appears red, or when it
-- turns red — to the unit's PIC (`notify_unit_pic`) and to the people holding
-- the job roles that own it at that unit, or at head office for head-office
-- roles. `also_notify_roles` adds job roles on top (none by default).

CREATE TABLE exception_setting (
    singleton                  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled                    boolean NOT NULL DEFAULT true,

    shift_grace_minutes        integer NOT NULL DEFAULT 120
                               CHECK (shift_grace_minutes BETWEEN 0 AND 1440),
    shift_bad_hours            integer NOT NULL DEFAULT 12
                               CHECK (shift_bad_hours BETWEEN 1 AND 720),
    cash_difference_minor      bigint NOT NULL DEFAULT 10000
                               CHECK (cash_difference_minor >= 0),
    cash_difference_bad_minor  bigint NOT NULL DEFAULT 100000
                               CHECK (cash_difference_bad_minor >= 0),

    deposit_due_days           integer NOT NULL DEFAULT 1
                               CHECK (deposit_due_days BETWEEN 0 AND 14),
    deposit_tolerance_minor    bigint NOT NULL DEFAULT 1000
                               CHECK (deposit_tolerance_minor >= 0),
    deposit_bad_days           integer NOT NULL DEFAULT 2
                               CHECK (deposit_bad_days BETWEEN 1 AND 60),
    deposit_lookback_days      integer NOT NULL DEFAULT 31
                               CHECK (deposit_lookback_days BETWEEN 7 AND 120),

    stage_bad_hours            integer NOT NULL DEFAULT 24
                               CHECK (stage_bad_hours BETWEEN 1 AND 720),
    missing_open_days          integer NOT NULL DEFAULT 7
                               CHECK (missing_open_days BETWEEN 1 AND 365),
    missing_bad_days           integer NOT NULL DEFAULT 30
                               CHECK (missing_bad_days BETWEEN 1 AND 730),

    checkout_bad_hours         integer NOT NULL DEFAULT 24
                               CHECK (checkout_bad_hours BETWEEN 1 AND 720),

    notify_unit_pic            boolean NOT NULL DEFAULT true,
    also_notify_roles          text[] NOT NULL DEFAULT '{}'
                               CHECK (cardinality(also_notify_roles) <= 16),

    updated_by                 text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at                 timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT exception_setting_red_is_past_the_line
        CHECK (cash_difference_bad_minor >= cash_difference_minor
               AND missing_bad_days >= missing_open_days)
);

COMMENT ON TABLE exception_setting IS
    'Thresholds of the store exceptions list (0646-0648): when a shift, a deposit, a flow stage, missing goods, a drawer count or an unfinished checkout becomes an exception, when it turns red, and who is told. One row.';

INSERT INTO exception_setting (singleton, updated_by) VALUES (true, 'migration:0646');
