-- 0175: A promotion that has started knows what it matched.
--
-- A rule selects products by a set of strings — `{"on":"TAG","tags":["DENIM"]}`
-- — and nothing anywhere records what that set resolved to. Membership is
-- recomputed every time a basket is priced, from whatever the catalogue says at
-- that moment. So a merchandiser adding a tag to an article on Tuesday changes
-- what a promotion that started on Monday gives away, and nobody involved knows
-- it happened: the promotion's own record still reads "Tag = Denim", which is
-- true and says nothing about the 312 products it meant when it started.
--
-- This is the record that was missing. When a rule's window opens, the selector
-- is resolved once against the catalogue as it stands and the answer is kept
-- with the timestamp and the selector that produced it.
--
-- # What this table is, and what it is not yet
--
-- It is the centre's statement of what a started promotion resolved to, and the
-- baseline every later question is asked against: what did this promotion mean
-- when it started, and does an edit to an article change what it would mean
-- now. `screens/master/form.tsx` asks exactly that before saving an article.
--
-- **It is not yet what the till prices against.** A shop matches
-- `Applicability::Tag` against the tags in its own copy of the catalogue, and
-- making it price against a frozen set means the set has to reach the shop —
-- which is a change to the published rule document and to what sync carries,
-- in a crate a second lane is editing this week. That step is deliberately not
-- taken here; see MASTER-LIFECYCLE-RULES.md.
--
-- # Keyed by `rule_id`, like usage
--
-- Not by (publication, rule): the shop's model is `DISTINCT ON (rule_id)`,
-- newest published book wins, and `commercial_usage` counts the same way — a
-- promotion republished is one promotion amended, not two. The publication the
-- resolution was read from is recorded beside it, because "which book said
-- this" is the first question anybody asks of a frozen number.
--
-- Written once and never rewritten. Re-resolving is a decision about a running
-- promotion, and it belongs to an explicit workflow rather than to a background
-- pass that quietly changes what a live offer covers.

CREATE TABLE commercial_rule_eligibility (
    rule_id        text PRIMARY KEY,
    -- The book the resolution was read from. Not a cascade: a publication is
    -- never deleted, and if one ever were, losing the record of what its rules
    -- covered is the opposite of what this table is for.
    publication_id uuid NOT NULL REFERENCES commercial_publication(id),
    -- The centre's clock at the moment the window was found open. Within one
    -- pass of the publisher's timer of the instant it actually opened, which is
    -- close enough for a promotion and honest about being a pass rather than an
    -- event: nothing in this estate fires when a timestamp goes by.
    resolved_at    timestamptz NOT NULL DEFAULT now(),
    -- `scope.applicability` exactly as published — the question, kept beside
    -- the answer. The rule document is immutable once published, so this is a
    -- convenience for reading rather than the only copy.
    selector       jsonb NOT NULL,
    sku_count      bigint NOT NULL CHECK (sku_count >= 0)
);

COMMENT ON TABLE commercial_rule_eligibility IS
    'What a promotion resolved to when its window opened. Written once by the '
    'freeze pass; never rewritten.';

CREATE TABLE commercial_rule_eligibility_sku (
    rule_id  text NOT NULL REFERENCES commercial_rule_eligibility(rule_id) ON DELETE CASCADE,
    -- The code, not the id. It is what the engine names a product by, what the
    -- rule document holds, and what survives a re-mint; a uuid here would need
    -- a join to say anything a person could read.
    sku_code text NOT NULL,
    PRIMARY KEY (rule_id, sku_code)
);

-- "Which promotions cover this product" — asked per article by the consequence
-- check, which turns an article into its SKUs and then asks this.
CREATE INDEX ix_rule_eligibility_sku ON commercial_rule_eligibility_sku (sku_code);
