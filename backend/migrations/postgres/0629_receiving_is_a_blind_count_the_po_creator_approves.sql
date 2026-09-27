-- Receiving from a supplier is a blind count that the PO's creator approves.
--
-- The flow engine seeded TERIMA_DARI_SUPPLIER (0619) as arrival, blind count,
-- verification by a Gudang supervisor, tagging and putaway. That is not how
-- the company receives. The owner's rules (26-27 Sep, and again 28 Sep):
--
--   * the Gudang counts what arrived blind — no ordered quantity, no price;
--   * the person who raised the PO approves the count: they may ask for a
--     recount, accept part, or accept and close the rest short; an excess is
--     recorded as returned to the supplier. There is no separate verifier;
--   * a new item is set up as master data (Procurement › Setups: purchase
--     price, markup, base price, price and quantity per SKU) — that is item
--     setup, not a stage goods pass through;
--   * tagging and putaway are not part of receiving.
--
-- Templates are versioned and a running document keeps its version, so this
-- adds version 2 and makes it current; version 1 stays as history.

INSERT INTO flow_template_version
    (id, template_id, version, starters, destination_pool_role, notes, created_by)
VALUES
    ('f10e0000-0000-4000-8000-000000000205', 'f10e0000-0000-4000-8000-000000000005', 2,
     ARRAY['HO_BUYER'], 'WAREHOUSE',
     'Born from a PO. The Gudang counts blind; the PO''s creator approves the count (recount, accept part, or accept and close short; an excess goes back to the supplier). New items are set up as master data, not as a stage. No tagging or putaway here.',
     'migration:0629');

INSERT INTO flow_template_stage
    (version_id, ordinal, stage_kind, performer_role, proof, deadline_hours, skippable)
VALUES
    ('f10e0000-0000-4000-8000-000000000205', 0, 'ARRIVAL',      'GUDANG_STAFF', ARRAY[]::text[],       NULL, false),
    ('f10e0000-0000-4000-8000-000000000205', 1, 'BLIND_COUNT',  'GUDANG_STAFF', ARRAY['MANUAL_COUNT'], 24,   false),
    ('f10e0000-0000-4000-8000-000000000205', 2, 'VERIFICATION', 'HO_BUYER',     ARRAY[]::text[],       24,   false);

UPDATE flow_template
   SET current_version_id = 'f10e0000-0000-4000-8000-000000000205',
       updated_by = 'migration:0629'
 WHERE id = 'f10e0000-0000-4000-8000-000000000005';
