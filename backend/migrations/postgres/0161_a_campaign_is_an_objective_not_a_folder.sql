-- 0161: A campaign is a business objective, not a folder of promotions.
--
-- # What a campaign has today, and why it is not enough
--
-- `commercial_campaign` already carries a shared budget, a shared window and
-- live counters, and `/commercial/performance/campaigns` already rolls up every
-- rule underneath one. That is three quarters of a real campaign and it is
-- still not a reason for the menu to exist: everything it holds is a
-- CONSTRAINT on promotions, and a thing whose entire content is constraints on
-- another thing is a folder.
--
-- What is missing is the half that makes it a business initiative:
--
--     Objective        Clear seasonal inventory
--     Success metric   Sell-through
--     Target           at least 80%
--
-- Three fields rather than one, because "+20%" is not a target — it is half of
-- one, and nobody can say +20% OF WHAT. The objective is the intent, the metric
-- is how we will know, and the target is the line. Separating them is also what
-- lets the screen compare like with like: two campaigns with the objective
-- `CLEAR_INVENTORY` are comparable; two campaigns whose goal field reads
-- "habiskan stok" and "clear old stock" are not.
--
-- # Why this is NOT a column on `commercial_campaign`
--
-- That table is a row inside a PUBLISHED PRICE BOOK — `publication_id`, unique
-- per `(publication_id, campaign_id)` — and a published book is frozen and
-- dispatched to every till, which parses it. Putting an objective there would
-- mean two things, both wrong:
--
--   * a till would be shipped the sentence "clear seasonal inventory", which it
--     has no use for and no way to act on; and
--   * changing a target would require cutting a new price book, which
--     re-dispatches PRICES to thirteen shops. Nobody should have to reprice the
--     estate to raise a goal from 75% to 80%.
--
-- So intent lives here, in the centre, keyed by `campaign_id` and by nothing
-- else. It survives every republication of the campaign it describes, because
-- it was never part of what was published.
--
-- # The baseline, and the reason it is a campaign rather than a period
--
-- "Versus the previous period" is the wrong question for the campaigns this
-- shop actually runs. Lebaran moves roughly eleven days earlier every year: the
-- thirty days before it are ordinary trading, and the same calendar dates last
-- year were not Lebaran. Both comparisons are arithmetic that looks rigorous
-- and answers nothing.
--
-- `baseline_campaign_id` names the campaign this one should be read against —
-- Lebaran 2027 against Lebaran 2026 — and the windows compared are those two
-- campaigns' own, whatever dates they fell on. Which Lebaran is the precedent
-- for this Lebaran is a judgement a merchandiser makes and a calendar cannot.
--
-- It is deliberately not a foreign key. A campaign id is only unique per
-- publication here, and the campaign being pointed at may have been published
-- in a book that has since been superseded — the comparison is still valid, and
-- a constraint would make naming a retired campaign impossible.

CREATE TABLE campaign_intent (
    campaign_id          TEXT PRIMARY KEY,

    -- A closed set, so the objective can be reported on. Free text here would
    -- make "Drive Sales" and "drive sales" two objectives within a month.
    objective            TEXT NOT NULL CHECK (objective IN (
                             'DRIVE_SALES',
                             'INCREASE_BASKET',
                             'CLEAR_INVENTORY',
                             'ACQUIRE_CUSTOMERS',
                             'RETAIN_MEMBERS',
                             'LAUNCH_PRODUCT'
                         )),

    -- How we will know. Every one of these is measured from sale facts by
    -- `cloud/postgres/performance.rs`, and the set is closed for that reason
    -- and not for tidiness: a metric nothing computes is a target nobody can
    -- ever be held to.
    success_metric       TEXT NOT NULL CHECK (success_metric IN (
                             'PROMO_SALES',
                             'DISCOUNT_GIVEN',
                             'GROSS_PROFIT',
                             'UNITS_SOLD',
                             'AVERAGE_BASKET',
                             'NEW_CUSTOMERS',
                             'SELL_THROUGH'
                         )),

    -- Which side of the line is success. Most targets are a floor; discount
    -- given is the one that is a ceiling, and a single `target_value` with no
    -- direction would have the screen congratulating a campaign for
    -- overspending.
    target_direction     TEXT NOT NULL CHECK (target_direction IN ('AT_LEAST', 'AT_MOST')),

    -- Read according to `success_metric`, and the unit is never stored beside
    -- it because it is never in doubt: money metrics are MINOR UNITS like every
    -- other amount in this database, counts are whole, and `SELL_THROUGH` is
    -- BASIS POINTS — 8000 is 80%. Basis points rather than a percentage for the
    -- reason every ratio in this schema is an integer: a float target would
    -- round, and a goal that rounds is a goal that argues.
    target_value         BIGINT NOT NULL CHECK (target_value >= 0),

    -- The campaign this one is read against. See the note above: a campaign,
    -- not a period, and not a foreign key.
    baseline_campaign_id TEXT,

    notes                TEXT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by           TEXT NOT NULL,

    -- A campaign cannot be its own precedent. Cheap to write, and it is the
    -- first thing somebody does by accident when duplicating last year's.
    CONSTRAINT campaign_intent_baseline_is_another
        CHECK (baseline_campaign_id IS NULL OR baseline_campaign_id <> campaign_id)
);

-- Read the other way round whenever a campaign is opened: "which campaigns name
-- this one as their precedent" is how a screen offers to carry the intent
-- forward into next year's.
CREATE INDEX ix_campaign_intent_baseline
    ON campaign_intent (baseline_campaign_id)
    WHERE baseline_campaign_id IS NOT NULL;

-- # The shops a campaign reaches
--
-- The one campaign-level fact that IS a pricing fact, and therefore the one
-- that belongs in the book rather than in the table above: a till has to know
-- it, because a till is what decides whether an offer applies in this shop.
--
-- It composes with a rule's own `scope.site_ids` exactly the way the campaign's
-- WINDOW already composes with the rule's — both bind, and what a shop gets is
-- the intersection (`pricing-engine/src/engine.rs`). Empty is everywhere, which
-- is what every campaign published before this migration will read as: nothing
-- narrows, and no book already in force changes meaning.
--
-- A campaign naming thirteen shops and a rule inside it naming six gives six.
-- That is the case this exists for — a student offer that only runs where there
-- is a campus, inside a campaign that runs everywhere.
-- `TEXT[]`, which is how `commercial_price_rule` and `commercial_markdown`
-- already spell a list of shops. A second spelling of the same fact would be a
-- second parser on the edge and a second thing to get wrong.
ALTER TABLE commercial_campaign ADD COLUMN site_ids TEXT[];
