-- A tagging job turns the Gudang's delivery into tagged units, in the cloud's
-- own ledger (DC-CLOUD-NATIVE.md, src/cloud/dc/tagging.rs).
--
-- When the cloud runs the Gudang, a tagging job is not sent to anybody: the
-- moment it is issued the cloud does what a DC server did when the job
-- arrived (`edge::sync::apply_tagging_job`) — the accepted delivery leaves the
-- Unidentified pool as one anonymous quantity and comes back as one unit per
-- minted EPC on the Gudang's racks. The two halves name different subjects,
-- so they balance through `system/identification`, which nothing ever rests
-- in. The centre's ledger never needed that place until now: only a node
-- wrote identification movements.

INSERT INTO inventory_place (id, kind, code, is_company, is_saleable)
VALUES ('system/identification', 'SYSTEM', 'IDENTIFICATION', FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;
