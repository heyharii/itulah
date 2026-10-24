-- Head office prepares a store's server for removal (24 Oct 2026).
--
-- A new store action, `prepare_removal`: the node sends what is waiting and,
-- once nothing is unsent, no drawer open and no basket held, writes a release
-- its uninstaller asks for (`edge/removal.rs`). Without one a connected
-- server refuses to be uninstalled, so a PC never leaves a shop with sales
-- head office has not got, nor with the shop's data on it.

ALTER TABLE store_action DROP CONSTRAINT IF EXISTS store_action_action_key_check;
ALTER TABLE store_action ADD CONSTRAINT store_action_action_key_check CHECK (action_key IN (
    'restart_server', 'resend_initial_data', 'back_up_now', 'diagnose',
    'sync_now', 'prepare_removal', 'test_print', 'suspend_device', 'reactivate_device',
    'revoke_device'
));
