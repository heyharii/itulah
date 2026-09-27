-- A job role is data: it names the rung a person holds, the flow stages they
-- may perform, the hub sections they may use and the servers they sign in at.
--
-- Until now a login carried a rung and nothing else (`app_user.role`, one of
-- CASHIER < SUPERVISOR < ADMIN). A rung cannot tell a buyer from a
-- merchandiser from a store manager — all three are supervisors — so the flow
-- engine checked stages by rung alone (`FlowRole::holds`), and every hub
-- section was open to every supervisor. The owner's decision of 28 Sep 2026:
--
--   * a person has exactly ONE job role, and job roles are data an Admin may
--     edit. Each role names its rung; `app_user.role` is kept in step with it
--     by the trigger below, so every reader of the rung — the path gate, the
--     action keys, the edge policy — keeps working unchanged;
--   * a flow stage is checked against the actor's job role: `flow_roles` must
--     hold the stage's performer (OWNER and ADMIN pass every stage), plus the
--     unit reach check that already exists;
--   * a role names the hub SECTIONS it may use, and the server refuses a
--     request whose section the role does not hold (`domain::job_role`).
--     OWNER and ADMIN hold every section. `read_only` is the auditor's: GET
--     only, and only in its sections;
--   * `node_reach` says which store and gudang servers the person may sign in
--     at, so nobody keeps a separate per-server list (0635): `UNIT` — the
--     servers of the unit they are posted to; `EVERY` — every server (the
--     head-office roles that span every store); `NONE` — no server.
--
-- # The backfill, and why it reads the way it does
--
-- Every existing login is given a role from its rung, as the owner named it:
--
--     ADMIN      -> OWNER
--     SUPERVISOR -> STORE_MANAGER
--     CASHIER    -> CASHIER
--
-- An existing head-office supervisor therefore reads as a store manager until
-- an Admin gives them their real role; that is the owner's call, not a guess.
--
-- A login written by code that still names only a rung (a test fixture, the
-- old account console) is given a role by the same trigger: SUPERVISOR ->
-- STORE_MANAGER and CASHIER -> CASHIER as above, but ADMIN -> ADMIN rather
-- than OWNER. Owning the company is a designation somebody makes, not
-- something a new administrator account falls into; the first account on an
-- empty database is made OWNER by the bootstrap explicitly.
--
-- # Two guards the database keeps
--
--   * OWNER and ADMIN stay on the ADMIN rung and cannot be made read-only: a
--     role that holds every section and every flow stage is an administrator
--     by definition.
--   * The last active OWNER cannot be moved to another role or suspended. A
--     company with no owner has nobody who may give the role back.

CREATE TABLE job_role (
    code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    name        text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 64),
    rung        text NOT NULL CHECK (rung IN ('CASHIER', 'SUPERVISOR', 'ADMIN')),
    -- The performer roles of `domain::flow::FlowRole`, by code.
    flow_roles  text[] NOT NULL DEFAULT '{}' CHECK (flow_roles <@ ARRAY[
        'HO_MD', 'HO_BUYER', 'HO_ADMIN', 'GUDANG_STAFF', 'GUDANG_SUPERVISOR',
        'HO_DELIVERY', 'STORE_STAFF', 'STORE_MANAGER'
    ]::text[]),
    -- The hub sections, as `domain::job_role::SECTIONS` spells them.
    sections    text[] NOT NULL DEFAULT '{}' CHECK (sections <@ ARRAY[
        'finance', 'merchandise', 'procurement', 'operations', 'inventory',
        'stores', 'sales', 'marketing', 'people', 'ga', 'system', 'reports'
    ]::text[]),
    read_only   boolean NOT NULL DEFAULT false,
    node_reach  text NOT NULL DEFAULT 'NONE' CHECK (node_reach IN ('NONE', 'UNIT', 'EVERY')),
    description text NOT NULL DEFAULT '',
    -- Seeded by a migration. A built-in role may be edited and never deleted.
    builtin     boolean NOT NULL DEFAULT false,
    sort_order  integer NOT NULL DEFAULT 1000,
    updated_by  text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_role_administrators_administer CHECK (
        code NOT IN ('OWNER', 'ADMIN') OR (rung = 'ADMIN' AND NOT read_only)
    )
);

COMMENT ON TABLE job_role IS
    'A person''s job (0633): the rung it grants, the flow stages it performs, the hub sections it may use and the servers it signs in at. Data an Admin edits.';

INSERT INTO job_role
    (code, name, rung, flow_roles, sections, read_only, node_reach, description, builtin, sort_order, updated_by)
VALUES
    ('OWNER', 'Owner', 'ADMIN',
     ARRAY['HO_MD','HO_BUYER','HO_ADMIN','GUDANG_STAFF','GUDANG_SUPERVISOR','HO_DELIVERY','STORE_STAFF','STORE_MANAGER'],
     ARRAY['finance','merchandise','procurement','operations','inventory','stores','sales','marketing','people','ga','system','reports'],
     false, 'EVERY', 'Owns the company. Every section, every flow stage, every server.', true, 10, 'migration:0633'),
    ('ADMIN', 'Admin', 'ADMIN',
     ARRAY['HO_MD','HO_BUYER','HO_ADMIN','GUDANG_STAFF','GUDANG_SUPERVISOR','HO_DELIVERY','STORE_STAFF','STORE_MANAGER'],
     ARRAY['finance','merchandise','procurement','operations','inventory','stores','sales','marketing','people','ga','system','reports'],
     false, 'EVERY', 'Administers the system for the owner. Every section, every flow stage, every server.', true, 20, 'migration:0633'),
    ('FINANCE', 'Finance', 'SUPERVISOR', ARRAY[]::text[],
     ARRAY['finance','reports'],
     false, 'NONE', 'Keeps the books: bills, payments, banking, closing.', true, 30, 'migration:0633'),
    ('MERCHANDISE', 'Merchandise', 'SUPERVISOR', ARRAY['HO_MD'],
     ARRAY['merchandise','sales','reports'],
     false, 'NONE', 'Decides what the stores sell and what goes to which store.', true, 40, 'migration:0633'),
    ('PROCUREMENT', 'Procurement', 'SUPERVISOR', ARRAY['HO_BUYER'],
     ARRAY['procurement','inventory','reports'],
     false, 'NONE', 'Buys from suppliers and approves what the Gudang counted in.', true, 50, 'migration:0633'),
    ('OPERATIONS', 'Operations (gudang)', 'SUPERVISOR', ARRAY['GUDANG_SUPERVISOR','GUDANG_STAFF','HO_DELIVERY'],
     ARRAY['operations','inventory'],
     false, 'UNIT', 'Runs the Gudang floor and head office''s own deliveries.', true, 60, 'migration:0633'),
    ('INVENTORY', 'Inventory', 'SUPERVISOR', ARRAY['GUDANG_STAFF'],
     ARRAY['inventory','operations','reports'],
     false, 'UNIT', 'Keeps stock true: counts, pools and what is missing.', true, 70, 'migration:0633'),
    ('STORE_MANAGER', 'Store manager', 'SUPERVISOR', ARRAY['STORE_MANAGER','STORE_STAFF'],
     ARRAY['stores','sales','inventory'],
     false, 'UNIT', 'Answers for one store: its team, its till and its stock.', true, 80, 'migration:0633'),
    ('STORE_SUPERVISOR', 'Store supervisor', 'SUPERVISOR', ARRAY['STORE_MANAGER','STORE_STAFF'],
     ARRAY['stores','sales','inventory'],
     false, 'UNIT', 'Runs the store floor with the manager: approvals, voids, counts.', true, 90, 'migration:0633'),
    ('CASHIER', 'Cashier', 'CASHIER', ARRAY['STORE_STAFF'],
     ARRAY[]::text[],
     false, 'UNIT', 'Sells at the till. Works in the store app and the POS, not the hub.', true, 100, 'migration:0633'),
    ('STORE_STAFF', 'Store staff', 'CASHIER', ARRAY['STORE_STAFF'],
     ARRAY[]::text[],
     false, 'UNIT', 'Works the store floor. Works in the store app, not the hub.', true, 110, 'migration:0633'),
    ('MARKETING', 'Marketing', 'SUPERVISOR', ARRAY[]::text[],
     ARRAY['marketing','sales','reports'],
     false, 'NONE', 'Campaigns, vouchers, coupons and members.', true, 120, 'migration:0633'),
    ('HR', 'HR', 'SUPERVISOR', ARRAY[]::text[],
     ARRAY['people','reports'],
     false, 'NONE', 'People: hiring, payroll, policies and the records behind them.', true, 130, 'migration:0633'),
    ('GA', 'GA', 'SUPERVISOR', ARRAY[]::text[],
     ARRAY['ga'],
     false, 'NONE', 'General affairs: places, assets, contracts, repairs and supplies.', true, 140, 'migration:0633'),
    ('AUDITOR', 'Auditor (read-only)', 'SUPERVISOR', ARRAY[]::text[],
     ARRAY['finance','reports','sales','inventory'],
     true, 'NONE', 'Reads the books, sales and stock. Can never write.', true, 150, 'migration:0633'),
    ('IT', 'IT / Support', 'SUPERVISOR', ARRAY[]::text[],
     ARRAY['system','stores'],
     false, 'EVERY', 'Keeps the servers, tills and devices running. Signs in at every server.', true, 160, 'migration:0633');

-- ── every login holds one role ───────────────────────────────────────────

ALTER TABLE app_user
    ADD COLUMN role_code text REFERENCES job_role (code) ON UPDATE CASCADE;

-- The owner's mapping, in the header above.
UPDATE app_user
   SET role_code = CASE role
                       WHEN 'ADMIN' THEN 'OWNER'
                       WHEN 'SUPERVISOR' THEN 'STORE_MANAGER'
                       ELSE 'CASHIER'
                   END;

ALTER TABLE app_user ALTER COLUMN role_code SET NOT NULL;

CREATE INDEX ix_app_user_role_code ON app_user (role_code);

-- The rung follows the role. A writer that names only a rung (see the header)
-- is given the default role for that rung; a writer that names a role has
-- the rung written for it. Either way the two columns cannot disagree.
--
-- A rung written that already IS the role's rung is not a legacy write: it is
-- the role's own rung moving (the trigger on `job_role` below), and remapping
-- the role from it would move every holder to the default role.
--
-- The two BEFORE triggers on `app_user` are numbered because PostgreSQL fires
-- them in name order, and the owner guard must see the role this one settles
-- on, not the one the statement named.
CREATE FUNCTION app_user_rung_follows_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.role_code IS NULL THEN
        NEW.role_code := CASE NEW.role
                             WHEN 'ADMIN' THEN 'ADMIN'
                             WHEN 'SUPERVISOR' THEN 'STORE_MANAGER'
                             ELSE 'CASHIER'
                         END;
    ELSIF TG_OP = 'UPDATE'
          AND NEW.role_code IS NOT DISTINCT FROM OLD.role_code
          AND NEW.role IS DISTINCT FROM OLD.role
          AND NEW.role IS DISTINCT FROM (SELECT rung FROM job_role WHERE code = NEW.role_code) THEN
        NEW.role_code := CASE NEW.role
                             WHEN 'ADMIN' THEN 'ADMIN'
                             WHEN 'SUPERVISOR' THEN 'STORE_MANAGER'
                             ELSE 'CASHIER'
                         END;
    END IF;
    SELECT rung INTO NEW.role FROM job_role WHERE code = NEW.role_code;
    IF NEW.role IS NULL THEN
        RAISE EXCEPTION 'there is no job role %', NEW.role_code;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER app_user_10_rung_follows_role
    BEFORE INSERT OR UPDATE OF role, role_code ON app_user
    FOR EACH ROW EXECUTE FUNCTION app_user_rung_follows_role();

-- A role's rung changing moves every holder with it.
CREATE FUNCTION job_role_rung_moves_its_holders() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE app_user
       SET role = NEW.rung, updated_at = now()
     WHERE role_code = NEW.code AND role <> NEW.rung;
    RETURN NULL;
END;
$$;

CREATE TRIGGER job_role_rung_moves_its_holders
    AFTER UPDATE OF rung ON job_role
    FOR EACH ROW WHEN (OLD.rung IS DISTINCT FROM NEW.rung)
    EXECUTE FUNCTION job_role_rung_moves_its_holders();

-- The last active owner stays the owner.
CREATE FUNCTION app_user_keeps_an_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.role_code = 'OWNER' AND OLD.active
       AND (NEW.role_code <> 'OWNER' OR NOT NEW.active)
       AND NOT EXISTS (
           SELECT 1 FROM app_user
            WHERE role_code = 'OWNER' AND active AND id <> OLD.id
       ) THEN
        RAISE EXCEPTION '% is the last active owner; make somebody else the owner first',
            OLD.username;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER app_user_20_keeps_an_owner
    BEFORE UPDATE OF role, role_code, active ON app_user
    FOR EACH ROW EXECUTE FUNCTION app_user_keeps_an_owner();
