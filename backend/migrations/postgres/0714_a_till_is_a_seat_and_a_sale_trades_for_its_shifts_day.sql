-- A till is a seat the store has, and a sale trades for its shift's day.
--
-- Owner, 30 Sep 2026. "Kasir" is a position under the store — Kasir 1,
-- Kasir 2 — and head office decides how many there are; a machine sits at a
-- seat, it does not add one. Each person counts in their own float and counts
-- out their own drawer, and a shift opened at 23:00 that runs past midnight is
-- still that evening's takings: "masih sesi hari sebelumnya, penjualan hari
-- sebelumnya".
--
-- Until now the centre cut a store's day on the clock (`site_local_date` of
-- `occurred_at`) and found a shift's cash by the window it was open across the
-- whole site — right only while a store had one counter.

-- ── The seats ───────────────────────────────────────────────────────────────
--
-- Carried to the store's node with the site profile (`SiteProfile.till_count`).
-- Stores already trading get as many seats as they have tills enrolled, and at
-- least one, so nothing that sells today stops selling tomorrow.
ALTER TABLE site ADD COLUMN till_count integer NOT NULL DEFAULT 1
    CHECK (till_count BETWEEN 0 AND 50);

UPDATE site s
   SET till_count = GREATEST(1, (
           SELECT COUNT(*) FROM device d
            WHERE d.site_id = s.id AND d.kind = 'TILL' AND d.status = 'ACTIVE'
       ))
 WHERE s.kind = 'STORE';

COMMENT ON COLUMN site.till_count IS
    'How many till seats (Kasir 1..N) the store''s counter has. Head office''s number; sent to the node with the site profile.';

-- ── The shift's day, and a shift ended by somebody taking the seat ─────────
ALTER TABLE cash_shift ADD COLUMN business_date date;
ALTER TABLE cash_shift ADD COLUMN taken_over_by text;
ALTER TABLE cash_shift ADD COLUMN counted_at timestamptz;

UPDATE cash_shift SET business_date = site_local_date(opened_at, site_id)
 WHERE business_date IS NULL;
UPDATE cash_shift SET counted_at = closed_at
 WHERE status = 'CLOSED' AND declared_cash_minor IS NOT NULL AND counted_at IS NULL;

COMMENT ON COLUMN cash_shift.business_date IS
    'The day this shift trades for: the store''s local date when it opened. Every sale rung on it carries the same day.';
COMMENT ON COLUMN cash_shift.taken_over_by IS
    'Set when the shift ended because somebody took the seat. It is CLOSED with nothing declared until its holder counts the drawer (counted_at).';

-- ── The sale's shift and day ────────────────────────────────────────────────
ALTER TABLE edge_sale ADD COLUMN shift_id uuid;
ALTER TABLE edge_sale ADD COLUMN business_date date;

UPDATE edge_sale SET business_date = site_local_date(occurred_at, site_id)
 WHERE business_date IS NULL;

-- A writer that names no day — a shop on an older build, a fixture — gets the
-- store's date of the sale, the rule the centre used before 0714. Filled
-- before the NOT NULL is checked, so nothing that wrote a sale yesterday
-- fails to write one today.
CREATE FUNCTION edge_sale_business_date_default() RETURNS trigger AS $$
BEGIN
    IF NEW.business_date IS NULL THEN
        NEW.business_date := site_local_date(NEW.occurred_at, NEW.site_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER edge_sale_business_date_default
    BEFORE INSERT ON edge_sale
    FOR EACH ROW EXECUTE FUNCTION edge_sale_business_date_default();

ALTER TABLE edge_sale ALTER COLUMN business_date SET NOT NULL;

CREATE INDEX ix_edge_sale_site_business_date ON edge_sale (site_id, business_date);
CREATE INDEX ix_edge_sale_shift ON edge_sale (shift_id) WHERE shift_id IS NOT NULL;

COMMENT ON COLUMN edge_sale.business_date IS
    'The day this sale trades for: its shift''s business_date, or the store''s local date of occurred_at for a sale rung with no shift open. Every daily cut of store sales reads this, not the clock.';
COMMENT ON COLUMN edge_sale.shift_id IS
    'The drawer that took this sale — the shift of the person who rang it. NULL for a sale from before 0714 or rung with no shift open.';
