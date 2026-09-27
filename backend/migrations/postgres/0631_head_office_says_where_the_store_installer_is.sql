-- Head office says where the store installer is.
--
-- Installing a store's server starts on the store's page in the hub: an Admin
-- presses "Install server", and the hub shows a code, its QR and the link the
-- person at the shop downloads the installer from (`store-opening-flow.html`,
-- step 2.1). The code is minted per install (`node_enrolment`, 0397); the link
-- is the same for every store and changes only when a new build is published,
-- so it is a setting and not a constant in the binary.
--
-- `finance_setting` (0373) is where head office's tunable numbers live, and
-- it holds numbers only. This is its sibling for words: one row per setting,
-- who set it and when, read by the code that needs it and never guessed. A
-- key nobody has set is read as the code's own default, so a missing row
-- never stops an install.
--
-- `store_installer_url` is seeded with that same default: a path on the hub's
-- own origin, where the MSI is published beside the hub's files. Pointing it
-- elsewhere — a release bucket, a CDN — is an UPDATE of this row.

CREATE TABLE system_setting (
    setting_key text PRIMARY KEY
        CHECK (setting_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
    value_text  text NOT NULL CHECK (btrim(value_text) <> ''),
    note        text,
    set_by      text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_setting IS
    'Words head office sets for the whole system (0631): addresses and names, where finance_setting holds numbers. Read by the code that needs each key; a key with no row is read as that code''s default.';

INSERT INTO system_setting (setting_key, value_text, note, set_by) VALUES
    ('store_installer_url', '/downloads/itulah-store-setup.msi',
     'Where the person at a shop downloads the store server installer, shown on the store''s Server page beside the enrolment code. A path is on the hub''s own origin.',
     'migration:0631')
ON CONFLICT (setting_key) DO NOTHING;
