-- 0073: A published markdown and a published promotion decide money, so they
-- are frozen like every other published price.
--
-- Migration 0003 froze the three tables that existed then — tax rules,
-- assortment rules, price rules — and the publication header. Markdowns and
-- promotions arrived later, in 0031, and the protection was never extended to
-- them. Nobody noticed because nothing edits them; the hole is that nothing
-- STOPS anything editing them.
--
-- The reason it matters is not tidiness. A published book is dispatched to
-- every shop, and each shop keeps its own copy. Editing the centre's row after
-- that changes what the centre says and nothing at any till: the clearance
-- price on a shelf-edge screen and the price at the counter part company, with
-- no new version for anyone to point at. That is strictly worse than the edit
-- being refused.
--
-- `protect_commercial_rule` already says exactly this, and already reads
-- `publication_id`, which both tables carry. It is reused rather than copied.

CREATE TRIGGER commercial_markdown_immutable
BEFORE INSERT OR UPDATE OR DELETE ON commercial_markdown
FOR EACH ROW EXECUTE FUNCTION protect_commercial_rule();

CREATE TRIGGER commercial_rule_immutable
BEFORE INSERT OR UPDATE OR DELETE ON commercial_rule
FOR EACH ROW EXECUTE FUNCTION protect_commercial_rule();

-- `commercial_campaign` and `commercial_coupon` are deliberately NOT frozen
-- here, and the difference is worth writing down.
--
-- Both mix three things in one row. The decisions — a window, a budget, which
-- rule a code opens — belong frozen with the book. The counters `used` and
-- `spent_minor` are dead: nothing has ever incremented them, because 0035
-- moved counting to `commercial_usage` on the grounds that a count cannot live
-- inside a document the database holds immutable. And the switches — a
-- campaign's `status`, a coupon's `active` — are the lever the business
-- actually pulls when it says "stop the Lebaran promo".
--
-- Freezing the row wholesale would take that lever away, and freezing it
-- partially would still not work: a pause has to reach the shops, which hold
-- their own copies, and no trigger can do that. The switch belongs outside the
-- publication with a command that carries it down the sync lane — the shape
-- 0035 already established for counts. Until that exists, these two stay
-- writable on purpose rather than by omission.

COMMENT ON TABLE commercial_markdown IS
    'A clearance price, frozen once its publication is published. Editing one '
    'after dispatch would change the centre and no till.';
