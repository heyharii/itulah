-- A koli is known at the centre by the number on its label.
--
-- The Gudang numbers every koli it packs (`koli.koli_number`, printed on the
-- label) but only its id travelled, so a surat jalan printed at head office
-- could say how many pieces were going and not which boxes to hand over.
-- The owner's rule (2026-09-28): head office allots in pieces, and once goods
-- are packed they travel, are handed over and are counted by the koli — each
-- holding however many pieces went into it. The number now rides on the
-- fulfilment fact; koli packed before it are filled in on their next stage.
ALTER TABLE edge_koli ADD COLUMN koli_number text;
