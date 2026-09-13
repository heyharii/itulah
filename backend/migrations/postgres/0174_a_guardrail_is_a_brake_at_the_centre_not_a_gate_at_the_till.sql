-- 0174: A campaign can be given a line it must not cross, and crossing it is a
-- thing that gets RECORDED and acted on at the centre — never a check a till
-- performs.
--
-- # Why this is not enforcement
--
-- The estate settled this question for budgets and the answer is the same here.
-- `pricing-engine/src/engine.rs`: "the figure a shop holds is only as fresh as
-- its last sync, and a budget here is a brake rather than a gate. What must not
-- be exceeded is counted at the centre."
-- `commercial.rs::publish_commercial_usage_to_fleet`: "What a shop enforces
-- from this is always behind, and cannot be otherwise: no till knows what the
-- other shops sold this morning."
--
-- So a guardrail is not shipped to anybody. It is measured here, from the sale
-- facts that have arrived here, and when it has been crossed the campaign is
-- stopped by pulling the lever that already exists — `switch_campaign`, which
-- sets the status and dispatches it to every shop in the same call. The chain
-- is: shops sell → the centre measures → the centre decides → the shops are
-- told. Every link takes time, and none of it can be removed by writing a
-- cleverer check.
--
-- The consequence is worth stating plainly rather than discovering: **a
-- guardrail is always breached by more than the threshold.** By the time the
-- centre can see 5.2 million spent against a 5 million ceiling, the shops have
-- spent more than that and do not yet know to stop. `observed` records what was
-- seen, not what was spent, and nothing in this file pretends otherwise. A rail
-- that must not be crossed AT ALL is not a rail — it is a smaller budget, and
-- `commercial_campaign.budget_minor` is where that goes, because the engine
-- caps against it at the till.
--
-- # Why it is not the budget
--
-- `budget_minor` is one number, it caps one kind of money (what promotions
-- discount), and it is spent by the engine as it decides prices. A guardrail is
-- a measurement of the campaign's BEHAVIOUR — the rate it is discounting at,
-- the margin it is leaving, the basket it is producing, what it is burning per
-- day. None of those is a cap the engine could apply to a line even in
-- principle: a till cannot know the campaign's average basket, and a rule that
-- refused a sale because the average basket was too low would be refusing the
-- very sale that raised it.

CREATE TABLE campaign_guardrail (
    guardrail_id  UUID PRIMARY KEY,
    campaign_id   TEXT NOT NULL,

    -- Closed, and every one of them is measured by the same read the campaign's
    -- outcome is measured by. A rail on a figure nothing computes is a promise
    -- nobody can keep — the argument 0161 makes for the metric set, and it is
    -- the same argument.
    --
    -- The two rates are BASIS POINTS, like every other ratio in this schema and
    -- for the same reason: a threshold that rounds is a threshold that argues.
    measure       TEXT NOT NULL CHECK (measure IN (
                      'SPEND_MINOR',           -- discounted + cleared, over the whole window
                      'SPEND_PER_DAY_MINOR',   -- the burn rate: catches a runaway on day two
                      'DISCOUNT_RATE_BPS',     -- what came off, over what was taken
                      'MARGIN_BPS',            -- what was left, over what was taken
                      'AVERAGE_BASKET_MINOR'   -- taken, over the baskets it was taken from
                  )),

    -- Which side of the line is the wrong side. Fully decided by the measure —
    -- and stored anyway, with the CHECK below to stop the stored copy ever
    -- disagreeing with the measure that implies it. A breach is read months
    -- later by somebody asking what went wrong, and a record that needs a
    -- lookup in the source to say which way the line was crossed is a record
    -- nobody can audit.
    direction     TEXT NOT NULL CHECK (direction IN ('AT_MOST', 'AT_LEAST')),
    threshold     BIGINT NOT NULL CHECK (threshold >= 0),

    -- What crossing it does. A rail that only lights a lamp and a rail that
    -- stops the campaign are different instruments, and which one this is has
    -- to be decided when it is set rather than by whoever happens to read the
    -- report.
    breach_action TEXT NOT NULL CHECK (breach_action IN ('WARN', 'PAUSE_CAMPAIGN')),

    -- Switched off rather than deleted, so a breach that already happened keeps
    -- the rail it was measured against.
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    TEXT NOT NULL,

    CONSTRAINT campaign_guardrail_direction_follows_measure CHECK (
        direction = CASE measure
            WHEN 'MARGIN_BPS'           THEN 'AT_LEAST'
            WHEN 'AVERAGE_BASKET_MINOR' THEN 'AT_LEAST'
            ELSE 'AT_MOST'
        END
    ),

    -- Two ceilings on one measure is a contradiction somebody has to resolve,
    -- and the resolution is not "take the lower one" — it is to find out which
    -- of the two numbers the business actually meant.
    CONSTRAINT campaign_guardrail_one_per_measure UNIQUE (campaign_id, measure)
);

CREATE INDEX ix_campaign_guardrail_campaign
    ON campaign_guardrail (campaign_id)
    WHERE active;

-- # A breach is an observation, not a flag
--
-- A boolean on the rail above would answer "is it breached" and destroy the
-- only question worth asking afterwards: when did it go, how far past was it by
-- the time we saw, and what did we do about it. This table is what makes a
-- guardrail REPORTABLE, which is the whole reason it is more than a number in a
-- form.
CREATE TABLE campaign_guardrail_breach (
    breach_id       UUID PRIMARY KEY,
    guardrail_id    UUID NOT NULL REFERENCES campaign_guardrail(guardrail_id) ON DELETE CASCADE,
    campaign_id     TEXT NOT NULL,

    -- Copied off the rail rather than read through it. A rail raised after it
    -- was crossed — which is the ordinary response to crossing one — must not
    -- rewrite the history of its own breach into compliance.
    measure         TEXT NOT NULL,
    threshold       BIGINT NOT NULL,
    observed        BIGINT NOT NULL,

    -- The window the reading was taken over, because a campaign's numbers are
    -- only ever true of a window, and the campaign's own dates can be moved
    -- afterwards by the same lever that pauses it.
    window_from     TIMESTAMPTZ NOT NULL,
    window_to       TIMESTAMPTZ NOT NULL,

    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Updated in place while the breach stays open. A check that ran every hour
    -- and wrote a row each time would turn one breach into a hundred, and the
    -- report would say a campaign crossed its line a hundred times.
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    seen_count      INTEGER NOT NULL DEFAULT 1 CHECK (seen_count >= 1),

    action_taken    TEXT NOT NULL CHECK (action_taken IN (
                        'WARNED',
                        'PAUSED',
                        -- The campaign was told to stop and the instruction did
                        -- not land. Recorded as its own outcome because it is
                        -- the one case where the report saying "PAUSED" would
                        -- be a lie somebody acts on.
                        'PAUSE_FAILED'
                    )),
    detail          TEXT,

    -- Somebody looked at it and decided. Until then the breach is open, and the
    -- index below is what keeps it a single row.
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,

    CONSTRAINT campaign_guardrail_breach_acknowledged_by_somebody
        CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL))
);

-- One open breach per rail. The check is expected to run repeatedly — on every
-- opening of the screen, and from whatever calls it on a schedule later — and
-- it has to be able to say "still breached, now at 6.1 million" without
-- inventing a second event.
CREATE UNIQUE INDEX ux_campaign_guardrail_breach_one_open
    ON campaign_guardrail_breach (guardrail_id)
    WHERE acknowledged_at IS NULL;

CREATE INDEX ix_campaign_guardrail_breach_campaign
    ON campaign_guardrail_breach (campaign_id, first_seen_at DESC);
