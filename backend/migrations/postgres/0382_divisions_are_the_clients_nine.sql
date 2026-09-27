-- 0382: The divisions are the client's nine.
--
-- Owner decision, 25 Sep 2026 (resolving open decision 1 in
-- docs/product-master.md §7). The six divisions seeded by 0022 and 0043 mixed
-- three axes — customer segment (Menswear, Womenswear, Kids), product type
-- (Footwear, Accessories) and a line (Divided) — and the question "what does a
-- division divide by" had no answer.
--
-- The client already answers it. Their "Summary Penjualan per Divisi" report
-- (2025, all stores) groups every sale under nine divisions, KODE DIVISI 1–9.
-- Those nine mix axes too (a woman's sandal is Wanita or Sandal dan Sepatu),
-- and the owner accepts that: the client reports by them, so an article filed
-- under anything else is an article their report cannot place.
--
-- `display_order` is the client's KODE DIVISI, so every list and every report
-- we print sorts the way theirs does.
--
-- The six old divisions are RETIRED, not deleted and not rewritten
-- (product-master §4): articles, purchase order lines, supplier items, setup
-- sessions and published promotions that already hold `MENSWEAR` keep it, and
-- last year's report still groups by it. They are simply offered for nothing
-- new. `version` moves with the flip, as it does for a retire through the
-- API, so a screen holding the old version cannot write over the retirement.
--
-- The nine new rows keep `ever_used = false`: that flag means what it says for
-- every value created after 0180, and the first article filed under one of
-- them sets it.

INSERT INTO division (code, label, display_order) VALUES
    ('WANITA',            'Wanita',            1),
    ('PRIA',              'Pria',              2),
    ('ANAK_LAKI',         'Anak Laki-laki',    3),
    ('ANAK_PEREMPUAN',    'Anak Perempuan',    4),
    ('PERLENGKAPAN_BAYI', 'Perlengkapan Bayi', 5),
    ('SANDAL_SEPATU',     'Sandal dan Sepatu', 6),
    ('TAS',               'Tas',               7),
    ('AKSESORIS',         'Aksesoris',         8),
    ('NON_DIVISI',        'Non Divisi',        9)
ON CONFLICT (code) DO NOTHING;

UPDATE division
   SET active  = false,
       version = version + 1
 WHERE code IN ('MENSWEAR', 'WOMENSWEAR', 'KIDS', 'FOOTWEAR', 'ACCESSORY', 'DIVIDED')
   AND active;
