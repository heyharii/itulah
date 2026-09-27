-- 0387: A limit that must hold is split between the shops.
--
-- A budget is a brake by default: every shop enforces the fleet's count, as
-- fresh as its last sync, so a shop offline all afternoon keeps giving an
-- offer away against a count from lunchtime. For a promotion that must not be
-- exceeded, head office can split the limit instead. Each shop is granted an
-- allowance and enforces it against its own sales, which it counts itself
-- (edge `0043`), and it stops at its allowance whether or not it can reach the
-- centre. The usage message carries each shop's allowance and its own count
-- (edge `0044`); `domain::cap_allocation` decides the split.
--
-- # A grant only ever grows
--
-- Taking allowance back from a quiet shop to give a busy one would be wrong:
-- the centre cannot know what a shop has sold and not yet uploaded, so a shop
-- cut back may already be past its new figure, and the difference handed
-- elsewhere would put the fleet over the limit. Allowance moves only out of
-- what has never been granted. The trigger below refuses a grant that shrinks
-- and a grant deleted, so no later code path can quietly do either.
--
-- Switching the split off (`enabled = false`) stops the allowances being sent,
-- and the shops go back to the fleet's count. The grants stay, so switching it
-- back on resumes from where it was rather than granting the limit twice.

CREATE TABLE commercial_cap_allocation_policy (
    kind       text NOT NULL CHECK (kind IN ('RULE', 'CAMPAIGN')),
    key        text NOT NULL CHECK (btrim(key) <> ''),
    enabled    boolean NOT NULL,
    updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, key)
);

CREATE TABLE commercial_cap_allocation (
    kind        text NOT NULL CHECK (kind IN ('RULE', 'CAMPAIGN')),
    key         text NOT NULL CHECK (btrim(key) <> ''),
    measure     text NOT NULL CHECK (measure IN ('BUDGET', 'USES')),
    origin_id   text NOT NULL CHECK (btrim(origin_id) <> ''),
    -- What this shop may give away in total under this limit, ever.
    granted     bigint NOT NULL CHECK (granted >= 0),
    -- The limit it was last split from, kept to explain a grant that looks
    -- large beside a limit lowered since.
    limit_value bigint NOT NULL CHECK (limit_value > 0),
    granted_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, key, measure, origin_id)
);

CREATE FUNCTION commercial_cap_allocation_only_grows() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'an allowance granted to shop % is never withdrawn', OLD.origin_id;
    END IF;
    IF NEW.granted < OLD.granted THEN
        RAISE EXCEPTION 'an allowance never shrinks: shop % held % and was offered %',
            OLD.origin_id, OLD.granted, NEW.granted;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_cap_allocation_only_grows
    BEFORE UPDATE OR DELETE ON commercial_cap_allocation
    FOR EACH ROW EXECUTE FUNCTION commercial_cap_allocation_only_grows();
