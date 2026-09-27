-- The five seeded flows are named in English.
--
-- The hub's copy is English (owner, 27 Sep); printed papers stay Indonesian.
-- A flow's name is what the hub's "Goods flows" screen and every flow document
-- show, so the five 0619 seeded are renamed. Their codes do not change: a
-- code is what a creation path, a log line and a person's memory refer to.
--
-- Only a name still as seeded is renamed. An Admin who has already renamed a
-- flow chose that name, and a migration does not overrule them. The versions'
-- notes are left as written: a version never changes (0615), and a note is
-- what its author wrote down at the time.

UPDATE flow_template t
   SET name = renamed.name,
       updated_by = 'migration:0627',
       updated_at = now()
  FROM (VALUES
        ('f10e0000-0000-4000-8000-000000000001'::uuid, 'Kirim gudang → toko',   'Gudang → store'),
        ('f10e0000-0000-4000-8000-000000000002'::uuid, 'Mutasi antar toko',     'Store → store transfer'),
        ('f10e0000-0000-4000-8000-000000000003'::uuid, 'Retur toko → gudang',   'Store return → Gudang'),
        ('f10e0000-0000-4000-8000-000000000004'::uuid, 'Retur ke supplier',     'Return to supplier'),
        ('f10e0000-0000-4000-8000-000000000005'::uuid, 'Terima dari supplier',  'Receive from supplier')
       ) AS renamed (id, seeded, name)
 WHERE t.id = renamed.id
   AND t.name = renamed.seeded;
