-- Who signs in at a store or gudang server follows from their job role and
-- their unit, and nobody keeps a per-server list.
--
-- Owner's decision, 28 Sep 2026. Until now head office granted access one
-- server at a time (System › Access): pick the node, pick the person, pick a
-- rung, and — at a store — type a password for them to use there. That was a
-- second list of who-works-where beside HR's postings, kept by hand, and the
-- two drifted: somebody transferred to Store 07 still signed in at Store 03,
-- and the administrator knew a password that was not theirs to know.
--
-- Now an assignment is DERIVED (`source = 'ROLE'`) from two facts that
-- already exist:
--
--   * the job role's `node_reach` (0633): `UNIT` — every server of every site
--     of the unit the person is posted to; `EVERY` — every server (OWNER,
--     ADMIN and IT, the head-office roles that span every store); `NONE`;
--   * the person's open posting (`employee_assignment`, valid_to IS NULL).
--
-- The rung at the server is the role's rung, and the lease is the default for
-- that rung (7 days for a cashier, 24 hours above). `node_access_reconcile`
-- below is the one statement of the rule. The cloud calls it for one login
-- whenever the login's role, posting, binding or state changes and when an
-- invitation is accepted, then publishes the policy of every server whose
-- list changed; the lease-renewal agent calls it for everybody on each tick,
-- which is what catches a server enrolled or a role edited since.
--
-- # The credential a server checks, and why it is the person's own
--
-- A store must sign people in with the line to head office down, so the
-- server has to hold something it can check a password against; an exchange
-- with the cloud at sign-in (the gudang's SSO ticket) cannot work offline.
-- The owner ruled that nobody types a per-server password, so the only
-- password there is is the one the person chose. For a derived assignment the
-- auth policy therefore publishes the login's own argon2id verifier
-- (`app_user.password_hash`), read at publication time — so a password change
-- reaches the servers on the next publication and no copy here goes stale.
-- `credential_hash` on a derived row holds the SSO-only marker
-- (`security::SSO_ONLY_VERIFIER`) and is never published.
--
-- This reverses "the Edge never receives the Cloud password" for derived
-- rows, on purpose and on the owner's ruling. What bounds it: a server
-- receives verifiers only for people whose role and posting put them there;
-- argon2id makes each guess expensive; and the lockout counts at the server
-- as it does at the centre.
--
-- # What is left alone
--
-- A grant made by hand (`source = 'MANUAL'`, every row before this migration)
-- is never touched by the derivation: it keeps its own password, its own rung
-- and its own switch. A person with a hand grant at a server their role also
-- reaches keeps the hand grant there. Suspending a login still closes every
-- server at once (`(a.active AND u.active)` in the policy), derived or not.

ALTER TABLE edge_identity_assignment
    ADD COLUMN source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'ROLE'));

COMMENT ON COLUMN edge_identity_assignment.source IS
    'MANUAL: granted by hand, with its own credential. ROLE: derived from the job role and posting (0635); the policy publishes the login''s own verifier.';

-- Servers whose list changed and have not been told yet. The lease-renewal
-- agent publishes these on its next tick; a publication clears the row.
CREATE TABLE edge_auth_policy_due (
    origin_id text PRIMARY KEY REFERENCES sync_origin_credential (origin_id) ON DELETE CASCADE,
    since     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE edge_auth_policy_due IS
    'A server whose sign-in list changed and whose policy has not been published since (0635).';

-- Bring the derived assignments of one login (or of everybody, for NULL) in
-- line with their role and posting. Returns the servers whose list changed,
-- and marks each of them due.
CREATE FUNCTION node_access_reconcile(p_user uuid, p_actor text)
RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
    changed text[];
BEGIN
    WITH due AS (
        SELECT o.origin_id, u.id AS user_id, r.rung AS edge_role
          FROM app_user u
          JOIN job_role r ON r.code = u.role_code
          LEFT JOIN LATERAL (
                SELECT a.unit_id
                  FROM employee_assignment a
                 WHERE a.employee_id = u.employee_id AND a.valid_to IS NULL
                 ORDER BY a.valid_from DESC
                 LIMIT 1
          ) posting ON true
          JOIN sync_origin_credential o ON o.inventory_enabled
          LEFT JOIN site s ON s.id = o.site_id
         WHERE (p_user IS NULL OR u.id = p_user)
           AND (r.node_reach = 'EVERY'
                OR (r.node_reach = 'UNIT' AND s.unit_id = posting.unit_id))
    ),
    removed AS (
        DELETE FROM edge_identity_assignment e
         WHERE e.source = 'ROLE'
           AND (p_user IS NULL OR e.user_id = p_user)
           AND NOT EXISTS (
               SELECT 1 FROM due d
                WHERE d.origin_id = e.origin_id AND d.user_id = e.user_id
           )
        RETURNING e.origin_id
    ),
    added AS (
        INSERT INTO edge_identity_assignment AS e
            (origin_id, user_id, edge_role, credential_hash, active, auth_version,
             offline_ttl_seconds, created_by, source)
        SELECT d.origin_id, d.user_id, d.edge_role, '!cloud-sso-only', true, 1,
               CASE WHEN d.edge_role = 'CASHIER' THEN 604800 ELSE 86400 END,
               p_actor, 'ROLE'
          FROM due d
        ON CONFLICT (origin_id, user_id) DO UPDATE
           SET edge_role = EXCLUDED.edge_role,
               offline_ttl_seconds = EXCLUDED.offline_ttl_seconds,
               auth_version = e.auth_version + 1,
               updated_at = now()
         WHERE e.source = 'ROLE' AND e.edge_role <> EXCLUDED.edge_role
        RETURNING e.origin_id
    )
    SELECT COALESCE(array_agg(DISTINCT c.origin_id), ARRAY[]::text[])
      INTO changed
      FROM (SELECT r.origin_id FROM removed r
            UNION ALL
            SELECT a.origin_id FROM added a) c;

    INSERT INTO edge_auth_policy_due (origin_id)
    SELECT unnest(changed)
    ON CONFLICT (origin_id) DO NOTHING;

    RETURN QUERY SELECT unnest(changed);
END;
$$;

COMMENT ON FUNCTION node_access_reconcile(uuid, text) IS
    'Derive who signs in at which server from job_role.node_reach and the open posting (0635). NULL user = everybody. Returns the servers whose list changed.';

-- Everybody, once, from the roles 0633 gave them.
SELECT count(*) FROM node_access_reconcile(NULL, 'migration:0635');
