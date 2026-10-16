-- The Download button on a store's Server tab pointed at
-- `/downloads/itulah-store-setup.msi`, a path nothing ever published (0631
-- seeded it). The store server's installer is now published to the release
-- bucket by `.github/workflows/store-server.yml` as `latest.msi`.
--
-- Only the seeded default is replaced: a link head office has set by hand
-- is its own decision and stays.
UPDATE system_setting
   SET value_text = 'https://storage.googleapis.com/itulah-central-desktop/store-server/latest.msi',
       note = 'The store server installer (published by CI as latest.msi).',
       set_by = 'migration 0967',
       set_at = now()
 WHERE setting_key = 'store_installer_url'
   AND value_text = '/downloads/itulah-store-setup.msi';
