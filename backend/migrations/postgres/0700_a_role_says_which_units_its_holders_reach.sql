-- 0700: A job role says which units its holders reach.
--
-- # The question a posting could not answer
--
-- `Reach` (`domain::employment::reach`) answers "where may this person act"
-- from their posting: an Admin reaches every unit, anybody else reaches the
-- one unit they are posted to. That was right while the only callers were HR
-- screens, and its module doc said what was missing: a head-office person who
-- must work across every unit without the Admin rung needs "a per-unit grant
-- beside the rung. That is a decision, not a default".
--
-- The decision arrived with the finance, payables and cash routes being put
-- behind the same reach (the owner, 28 Sep 2026, "scope akses yang ditegakkan
-- terpusat"). Finance is posted to head office and keeps the books of all
-- fourteen units; under posting-only reach it would see head office's books
-- and nobody else's. So the grant lives where the owner already edits what a
-- job includes — on the role, beside its sections, exactly as ERPNext's User
-- Permission sits beside its roles.
--
-- # Why this does not reopen the leak the posting rule closed
--
-- The reach doc withdrew "posted at head office reaches everywhere" because a
-- procurement supervisor could then decide leave in thirteen shops. That leak
-- was a missing SECTION gate, not a missing reach: since 0633 a procurement
-- role holds `procurement`, `inventory` and `reports`, and People's routes
-- refuse it before reach is ever asked. Reach answers *where*; sections answer
-- *what*. A role that reaches every unit still only opens its own sections.
--
-- # The two answers
--
-- `EVERY` — the head-office departments: they work on every unit's records.
-- `OWN`   — a store's roles: the one unit they are posted to, as before.
--
-- OWNER and ADMIN reach everywhere through their rung whatever this says; the
-- column is written `EVERY` for them so the row does not lie.

ALTER TABLE job_role
    ADD COLUMN unit_reach text NOT NULL DEFAULT 'OWN'
        CHECK (unit_reach IN ('OWN', 'EVERY'));

COMMENT ON COLUMN job_role.unit_reach IS
    'Which units holders reach in the hub: OWN = the unit they are posted to, '
    'EVERY = all units. Answers where; sections still answer what (0700).';

UPDATE job_role
   SET unit_reach = 'EVERY',
       updated_by = 'migration:0700',
       updated_at = now()
 WHERE code IN ('OWNER', 'ADMIN', 'FINANCE', 'MERCHANDISE', 'PROCUREMENT',
                'OPERATIONS', 'INVENTORY', 'MARKETING', 'HR', 'GA', 'AUDITOR', 'IT');

ALTER TABLE job_role
    ADD CONSTRAINT job_role_administrators_reach_everywhere
        CHECK (code NOT IN ('OWNER', 'ADMIN') OR unit_reach = 'EVERY');
