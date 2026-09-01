-- The buyer's basket: what somebody has picked out, before it is an order.
--
-- This existed already, in every buyer's browser. `localStorage` held a set of
-- supplier item ids, which meant the basket was a property of a laptop rather
-- than of a person: it did not follow them to a second machine, it did not
-- survive clearing site data, and nobody else could see it — including the
-- server, which could not so much as count how many people were mid-decision.
-- A basket that only one browser knows about is not a record of anything.
--
-- Per user, not per team. "Keranjang" means mine, the way it does everywhere
-- else somebody shops; two buyers working the same range each keep their own
-- and neither can empty the other's. A shared team basket is a different
-- product with different rules about who may remove what, and it is not this.

CREATE TABLE sourcing_basket_line (
    -- The owner is the username, not the user's uuid, because that is what the
    -- session hands every handler (`Principal.username`) and what the audit
    -- columns on `supplier` and `supplier_item` already record. One vocabulary
    -- for "who did this" across the catalogue.
    --
    -- Deliberately NOT a foreign key to `app_user`, matching `created_by` and
    -- `updated_by` on `supplier` and `supplier_item`, which are plain checked
    -- text for the same reason: a node running with INVENTORY_AUTH_MODE=disabled
    -- hands every handler the synthetic actor "development", which is not a row
    -- in `app_user` and never will be. A foreign key here would make the
    -- development mode this project ships fail on its first write.
    owner_username   text NOT NULL CHECK (btrim(owner_username) <> ''),
    supplier_item_id uuid NOT NULL
                     REFERENCES supplier_item(supplier_item_id) ON DELETE CASCADE,
    -- Zero is not a quantity, it is a removal — and the route for that is
    -- removing the line. Storing a zero would leave a basket that renders an
    -- item nobody is buying.
    quantity         bigint NOT NULL CHECK (quantity > 0),
    added_at         timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    -- One line per item per buyer. Adding something already in the basket
    -- raises its quantity; it does not append a second line, which is what a
    -- shopper means by adding two of a thing.
    PRIMARY KEY (owner_username, supplier_item_id)
);

-- The basket is always read whole, for one person, oldest first — so the
-- primary key already serves the lookup and this index serves the ordering.
CREATE INDEX ix_sourcing_basket_line_owner_added
    ON sourcing_basket_line (owner_username, added_at);

COMMENT ON TABLE sourcing_basket_line IS
    'One buyer''s picked-out supplier items, before any of it becomes a '
    'purchase order. Emptied by the buyer, or by raising an order from it.';

COMMENT ON COLUMN sourcing_basket_line.quantity IS
    'Pieces, the same unit a purchase order line is ordered in — so the basket '
    'carries the number straight through to the order rather than making the '
    'buyer type it again at the last step.';
