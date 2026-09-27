-- A unit — a store, the Gudang, head office — is a record people can be told
-- about and talk about.
--
-- Head office's "Open store" (0630) tells every Admin that the store is open,
-- and names the store's unit as the notification's subject so the bell links
-- to it. `record_kind` never had a unit, so the notification broke its
-- foreign key and the store could not be opened at all (found by the
-- store-opening test, 28 Sep 2026). A unit is filed under its own kind, as a
-- pool and a node already are.

INSERT INTO record_kind (code, label) VALUES
    ('unit', 'Unit')
ON CONFLICT (code) DO NOTHING;
