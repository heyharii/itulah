-- 1007: the return policy says what the till used to decide alone.
--
-- Two rules lived only in the store server's code (Hari, 28–29 Oct 2026):
-- a struk takes one return and is then locked whole, and a return's own struk
-- never comes back. The owner wants the return policy to say everything the
-- till enforces (29 Oct 2026), so both become settings, defaulting to exactly
-- what the till does today. They ride the same snapshot to every store.
--
-- A policy also says who last changed it: `created_by` named only the first
-- author, and a shortened window had no name on it.
ALTER TABLE return_policy_setting
    ADD COLUMN one_return_per_receipt boolean NOT NULL DEFAULT true,
    ADD COLUMN return_receipt_returnable boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN return_policy_setting.one_return_per_receipt IS
    'True: once any piece of a struk came back, the struk takes no further return.';
COMMENT ON COLUMN return_policy_setting.return_receipt_returnable IS
    'True: what went out on a return may itself come back. False: a return''s struk never comes back.';

ALTER TABLE return_policy ADD COLUMN updated_by text;
