-- The business clock's own history.
--
-- One append-only row per accepted change to the virtual business clock
-- (VIRTUAL-TIME-PLAN.md §7): which operation, who asked, what the clock said
-- before and what it says now. A compressed year is a legitimate way to run a
-- demo and a dangerous way to run a ledger; either way, the moment business
-- time and wall time came apart must be findable later. `previous_virtual_at`
-- is what makes a backward jump visible in the data even where one was
-- permitted (the controlled mode on a disposable database).
--
-- `recorded_at` is the server's own wall clock — this table is exactly the
-- place where real time is the point, not a leak of it.

CREATE TABLE clock_epoch (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    op                  text NOT NULL,
    actor               text NOT NULL,
    previous_mode       text,
    previous_virtual_at timestamptz,
    mode                text NOT NULL,
    virtual_at          timestamptz,
    paused              boolean NOT NULL,
    real_at             timestamptz NOT NULL,
    config              jsonb NOT NULL
);
