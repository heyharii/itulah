-- 0040: Enough tag vocabulary to describe a real garment catalogue.
--
-- 0027 seeded eight tags, which is the right number for proving the mechanism
-- and far too few for browsing. A sourcing screen filtered by tag is only as
-- useful as the words available: with eight, most of a supplier's feed carries
-- no tag at all, and a facet nobody can filter by is a column of blanks.
--
-- These are the garment kinds an apparel catalogue actually divides into. They
-- are added rather than replacing anything: the eight from 0027 stay, because
-- rows already reference them and because LENGAN_PANJANG / LENGAN_PENDEK /
-- MUSIMAN describe a cut or a season rather than a kind, and compose with
-- these instead of competing.
--
-- Indonesian labels, matching 0027. The vocabulary a buyer reads is the
-- vocabulary the warehouse and the shop floor already speak; a catalogue that
-- says "Knitwear" to one and "Rajut" to the other is two catalogues.
--
-- ON CONFLICT DO NOTHING so this migration is safe on a database where somebody
-- has already added one of these by hand. Note the unique index on lower(label)
-- from 0027: a hand-added row with the same label under a different code would
-- still collide, and should — that is the split this table exists to prevent.

INSERT INTO tag (code, label) VALUES
    ('BLUS',          'Blus'),
    ('GAUN',          'Gaun'),
    ('ROK',           'Rok'),
    ('CELANA_PENDEK', 'Celana Pendek'),
    ('DENIM',         'Denim'),
    ('RAJUT',         'Rajut'),
    ('DALAMAN',       'Pakaian Dalam'),
    ('TIDUR',         'Pakaian Tidur'),
    ('KAUS_KAKI',     'Kaus Kaki'),
    ('RENANG',        'Pakaian Renang'),
    ('SEPATU',        'Sepatu'),
    ('AKSESORI',      'Aksesori'),
    ('FORMAL',        'Formal')
ON CONFLICT (code) DO NOTHING;
