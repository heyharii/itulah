-- Received goods never wait for a label: there is no Untagged pool.
--
-- The Gudang used to hold new goods in two waiting pools after a count was
-- approved: Unidentified (no SKU yet) and then Untagged (SKUs minted, labels
-- not yet on). A person confirmed the labels were on, and only then were the
-- goods stock. The owner's process (28 Sep 2026) has no such step: once a new
-- item's master data is set up, its goods are the Gudang's stock; printing
-- the labels is only printing, not a stage anything waits on. So identified
-- goods go from Unidentified straight into the warehouse, each unit under its
-- own EPC (the Gudang's server, `edge::sync`), and Untagged is gone.
--
-- New sites stop getting the pool from the template. An existing site's pool
-- is removed with its places when nothing ever stood in it; one with history
-- is only switched off, so the movements that name it still read.

DELETE FROM pool_template WHERE code_suffix = 'pending.untagged';

DO $$
DECLARE
    untagged record;
BEGIN
    FOR untagged IN
        SELECT id FROM operational_pool WHERE id LIKE '%.pending.untagged'
    LOOP
        BEGIN
            DELETE FROM inventory_place WHERE pool_id = untagged.id;
            DELETE FROM operational_pool WHERE id = untagged.id;
        EXCEPTION WHEN foreign_key_violation THEN
            UPDATE operational_pool SET active = false WHERE id = untagged.id;
        END;
    END LOOP;
END
$$;
