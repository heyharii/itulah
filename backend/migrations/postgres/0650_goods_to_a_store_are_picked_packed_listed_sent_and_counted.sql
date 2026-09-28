-- Goods from the Gudang to a store: allotment, pick, pack, surat jalan,
-- depart, blind receive. Nothing else.
--
-- KIRIM_GUDANG_TOKO was seeded (0619) with seven stages: pick, pack, close
-- koli, ship, load, depart, receive. The owner's process (28 Sep 2026) has
-- five: the allotment is head office's decision, then the Gudang picks, packs,
-- writes the surat jalan and the lorry departs, and the store counts what
-- arrived blind. Closing a koli is part of packing it, and loading is part of
-- the lorry leaving; neither is a stage anybody answers for.
--
-- The Gudang's server still records a sealed koli and a loaded lorry as it
-- always did; the flow simply does not wait on them. Depart takes the goods
-- from the surat jalan when no load stage stands before it
-- (`flow::action`, Depart).
--
-- Templates are versioned and a running document keeps its version, so this
-- adds version 2 and makes it current; version 1 stays as history.

INSERT INTO flow_template_version
    (id, template_id, version, starters, destination_pool_role, notes, created_by)
VALUES
    ('f10e0000-0000-4000-8000-000000000201', 'f10e0000-0000-4000-8000-000000000001', 2,
     ARRAY['HO_MD'], 'STOCKROOM',
     'Born from head office''s allotment to a store. The Gudang picks, packs, writes the surat jalan (one per store; one lorry may carry several) and the lorry departs. The store counts what arrived blind: a difference becomes Missing, damaged goods go to reject.',
     'migration:0650');

INSERT INTO flow_template_stage
    (version_id, ordinal, stage_kind, performer_role, proof, deadline_hours, skippable)
VALUES
    ('f10e0000-0000-4000-8000-000000000201', 0, 'PICK',    'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000201', 1, 'PACK',    'GUDANG_STAFF', ARRAY['RFID_SCAN'], 24, false),
    ('f10e0000-0000-4000-8000-000000000201', 2, 'SHIP',    'GUDANG_STAFF', ARRAY[]::text[],    8,  false),
    ('f10e0000-0000-4000-8000-000000000201', 3, 'DEPART',  'HO_DELIVERY',  ARRAY[]::text[],    24, false),
    ('f10e0000-0000-4000-8000-000000000201', 4, 'RECEIVE', 'STORE_STAFF',  ARRAY['RFID_SCAN'], 72, false);

UPDATE flow_template
   SET current_version_id = 'f10e0000-0000-4000-8000-000000000201',
       updated_by = 'migration:0650'
 WHERE id = 'f10e0000-0000-4000-8000-000000000001';
