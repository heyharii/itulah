-- 0173: What a campaign runs, and where, is DECLARED — not read back out of
-- the rules that happen to name it.
--
-- 0161 gave a campaign an objective, a metric and a target, and argued that
-- everything `commercial_campaign` held was a constraint on promotions. Three
-- things are still missing, and all three have the same shape: the campaign
-- can only be described by reverse-engineering it.
--
--   * WHAT IT DOES. A promotion joins a campaign by writing
--     `definition->>'campaign_id'` in a price book. So "what did we actually
--     run at Lebaran?" is answered by opening every published book, reading
--     every rule document and grouping by a JSON field — and the answer is
--     wrong before it starts, because half of what a campaign does is not in a
--     price book at all. A poster in thirteen windows, an email to forty
--     thousand members and a push notification cost money, take effort, and
--     leave no trace anywhere in this database.
--
--   * WHERE IT RUNS. Today the shops a campaign reaches are inferred from the
--     scope of its rules. That is backwards. A campaign whose rules happen to
--     name six shops is not the same statement as a campaign DECLARED to run in
--     six shops: the first is an accident of authoring, the second is a
--     decision somebody made and can be held to. Only the second can be
--     compared against what the book actually binds, and only the second gives
--     a baseline comparison two like things to put side by side.
--
--   * WHAT THE LINE IS MEASURED AGAINST. `target_direction` says which side of
--     the line is success. Nothing says what the line IS: a total, a rate per
--     day, or a number relative to the campaign named as precedent. "+20%" was
--     rejected in 0161 because nobody could say +20% OF WHAT; the other half of
--     that answer — `baseline_campaign_id` — has been stored ever since and
--     never read by a target.
--
-- One rule, three tables' worth of consequence: a campaign says what it is
-- doing. Nothing downstream has to guess.

-- # What a campaign does
--
-- One row per thing the campaign RUNS. The kinds are closed because the point
-- is to be able to count them — "we ran four promotions, two clearance drops
-- and one email" is a sentence about a campaign, and a free-text kind makes it
-- unwriteable within a month.
--
-- `ref_id` points into the id space its kind names: `commercial_rule.rule_id`
-- for a PROMOTION, `commercial_markdown.markdown_id` for a MARKDOWN, the
-- coupon code for a COUPON_SET. It is deliberately NOT a foreign key, for the
-- reason 0161 gives for `baseline_campaign_id`: those ids are unique per
-- PUBLICATION, not globally, and the book that carried the rule may since have
-- been superseded. An activity also gets declared while a campaign is being
-- planned — before any book exists to point at.
--
-- PLACEMENT and MESSAGE have no row anywhere in this database and never will;
-- their `ref_id` is null and their whole existence is this row. That is the
-- half of a campaign that has been invisible.
CREATE TABLE campaign_activity (
    activity_id  UUID PRIMARY KEY,
    campaign_id  TEXT NOT NULL,

    kind         TEXT NOT NULL CHECK (kind IN (
                     'PROMOTION',    -- a price rule in a published book
                     'MARKDOWN',     -- a clearance drop: a new price, not a discount
                     'COUPON_SET',   -- codes handed out
                     'PLACEMENT',    -- a poster, a window, a banner
                     'MESSAGE'       -- an email, a push, a broadcast
                 )),
    name         TEXT NOT NULL CHECK (btrim(name) <> ''),
    ref_id       TEXT CHECK (ref_id IS NULL OR btrim(ref_id) <> ''),

    -- Where it got to. A campaign that is over still has to be able to say
    -- which of the things it planned actually ran: DROPPED is a finding, and
    -- deleting the row instead would make the plan agree with the outcome
    -- retrospectively — the one thing a post-mortem must not do.
    status       TEXT NOT NULL DEFAULT 'PLANNED'
                 CHECK (status IN ('PLANNED', 'LIVE', 'DONE', 'DROPPED')),

    -- DATE rather than TIMESTAMPTZ, and the difference is not laziness. Every
    -- window in this schema that a TILL compares against a clock is a
    -- timestamp, because a price that turns on at noon has to turn on at noon
    -- somewhere in particular. Nothing here is ever compared against a clock by
    -- anything: these are the days a poster was up and the morning an email
    -- went, written by a person who means a calendar day in their own shop.
    starts_on    DATE,
    ends_on      DATE,

    -- What the activity itself cost, where that is a real number somebody paid:
    -- printing, a mailing list, an agency. NEVER the discount it gave away —
    -- that is measured from the sale facts and is a different kind of money.
    -- Adding the two would book a poster and a price cut as the same thing.
    cost_minor   BIGINT CHECK (cost_minor IS NULL OR cost_minor >= 0),

    detail       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   TEXT NOT NULL,

    CONSTRAINT campaign_activity_runs_forwards
        CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);

-- The same rule filed under one campaign twice is a double count in every
-- report drawn from this table, and it happens by the ordinary route: somebody
-- adds the activity, cannot see it in a stale list, and adds it again.
--
-- Partial, because the two kinds that point at nothing would otherwise collapse
-- into one row per campaign — a campaign may perfectly well run four posters.
CREATE UNIQUE INDEX ux_campaign_activity_points_once
    ON campaign_activity (campaign_id, kind, ref_id)
    WHERE ref_id IS NOT NULL;

CREATE INDEX ix_campaign_activity_campaign
    ON campaign_activity (campaign_id, kind, created_at);

-- # Where a campaign runs, as a statement rather than as a consequence
--
-- **This does not bind anything, and must not.** `commercial_campaign.site_ids`
-- is the enforcing list: it rides in the published book, a till parses it, and
-- a rule inside the campaign runs where BOTH lists allow — the intersection,
-- checked in `pricing-engine/src/engine.rs` beside the campaign's window. That
-- stays exactly as it is. A second spelling of the same fact would be a second
-- parser on the edge and a second thing to get wrong, which 0161 said when it
-- added the column.
--
-- This is the other half: what somebody SAID the campaign would reach. The two
-- are different kinds of fact and the interesting thing about them is when they
-- disagree —
--
--     declared  store-01 … store-06        (a regional push)
--     binding   null                       (the book narrows nothing)
--
-- — which reads as a campaign running in thirteen shops that was planned for
-- six, and which today nobody can see at all. The read endpoint reports that
-- drift rather than reconciling it, because reconciling it would mean either
-- rewriting a published book or quietly rewriting what somebody decided.
--
-- Composition, written down once so no reader has to infer it: within a
-- dimension the values are ALTERNATIVES, across dimensions they NARROW, and a
-- dimension with no rows is "all of them" — the same reading an empty
-- `site_ids` already has everywhere else in this estate.
CREATE TABLE campaign_scope (
    campaign_id  TEXT NOT NULL,
    dimension    TEXT NOT NULL CHECK (dimension IN (
                     'SITE',      -- a shop id, as `commercial_campaign.site_ids` spells it
                     'CHANNEL',   -- STORE / ONLINE / MARKETPLACE
                     'SEGMENT',   -- a member segment this was aimed at
                     'DIVISION',  -- the merchandise it is about
                     'ARTICLE',
                     'TAG'
                 )),
    value        TEXT NOT NULL CHECK (btrim(value) <> ''),
    declared_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    declared_by  TEXT NOT NULL,
    PRIMARY KEY (campaign_id, dimension, value)
);

-- # What the target line is measured against
--
-- `target_value` has meant one thing since 0161: a total, over the campaign's
-- own window, in the metric's own unit. These two columns say what ELSE it can
-- mean, and the default keeps every row already written meaning exactly what it
-- meant before.
--
--   REACH          a floor on the total.                       (the old AT_LEAST)
--   KEEP_BELOW     a ceiling on the total.                     (the old AT_MOST)
--   REACH_PER_DAY  a floor on the total DIVIDED BY the days the
--                  campaign has run. The only model under which a
--                  ten-day campaign and a thirty-day campaign can
--                  be given the same number, and the only one that
--                  can be scored halfway through without reporting
--                  a failure: a floor on the total is "missed"
--                  every day until the last one.
--   BEAT_BASELINE  the target is BASIS POINTS BETTER than the
--                  campaign named as this one's precedent — 2000
--                  is "twenty per cent better than last Lebaran".
--                  This is the half 0161 could not write down.
--   STAY_WITHIN    a band. Some metrics are wrong at both ends: a
--                  discount rate below the band buys nothing and
--                  above it gives the shop away, and an average
--                  basket that doubles because only the big
--                  spenders came is not the campaign anybody
--                  planned.
--
-- Two rules about the models that divide by days, and neither is arbitrary:
-- REACH_PER_DAY only means anything for a metric that ADDS UP over days
-- (promo sales, discount given, gross profit, units, new customers). Average
-- basket and sell-through are already rates — "average basket per day" is not
-- a smaller number, it is not a number at all — so BEAT_BASELINE compares
-- those two level to level and divides nothing.
--
-- The CHECK below holds the first of those rules because both columns it names
-- are written by the same statement. The rules that would span
-- `baseline_campaign_id` or `target_value` are deliberately NOT constraints:
-- those columns have a different writer (`save_campaign_intent`), and a
-- cross-writer CHECK turns somebody else's legitimate edit — clearing a
-- baseline, raising a target — into a 500 from a route that has never heard of
-- target models. They are enforced where the model is written and reported as
-- "cannot be scored" where it is read, which is the same answer 0161 gives for
-- a metric nothing has measured yet.
ALTER TABLE campaign_intent
    ADD COLUMN target_model TEXT NOT NULL DEFAULT 'REACH'
        CHECK (target_model IN (
            'REACH', 'KEEP_BELOW', 'REACH_PER_DAY', 'BEAT_BASELINE', 'STAY_WITHIN'
        )),
    ADD COLUMN target_value_upper BIGINT
        CHECK (target_value_upper IS NULL OR target_value_upper >= 0),
    ADD CONSTRAINT campaign_intent_per_day_target_adds_up
        CHECK (target_model <> 'REACH_PER_DAY' OR success_metric IN (
            'PROMO_SALES', 'DISCOUNT_GIVEN', 'GROSS_PROFIT', 'UNITS_SOLD', 'NEW_CUSTOMERS'
        ));

-- A ceiling written before the models existed is a KEEP_BELOW and always was.
-- Without this every AT_MOST target already stated would read as a floor the
-- day the screen starts drawing the model's name, and a discount budget would
-- be reported as a goal to reach.
UPDATE campaign_intent
   SET target_model = 'KEEP_BELOW'
 WHERE target_direction = 'AT_MOST';
