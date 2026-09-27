-- 0460: an account link holds for a scope, and an account says what it is.
--
-- The foundation of "Desain Fondasi Finance Dinamis" (27 Sep 2026): Finance
-- ties every posting to an account through data it edits itself, the way
-- ERPNext does, instead of through migrations. Three things change here.
--
--   1. Every account says what kind of account it is. `root_type` (asset,
--      liability, equity, income, expense) is derived from the statement
--      section; `account_type` (cash, bank, receivable, payable, …) is new and
--      filled in for every leaf. A role can then say which kinds of account it
--      will accept, and a wrong link is refused when it is SAVED, not weeks
--      later when something posts through it.
--
--   2. `account_link` replaces the per-site `account_map` table. A link holds
--      for ALL sites, for one KIND of site (HO or STORE), or for ONE site, and
--      the most specific one wins. The map had 8,330 rows because every one of
--      its ~600 decisions was written out once per site; the same decisions
--      are now ~700 links, and a fifteenth shop inherits every link that holds
--      for all shops without anybody writing a row for it.
--
--   3. The `account_map` table is dropped. What a site resolves to is the
--      view `account_resolution` — one row per (role, source, site), the most
--      specific link winning — and every reader of the map reads it instead.
--      Before the map goes, the migration compares the two row by row and
--      refuses to finish if a single resolution moved.
--
-- A later migration that points a role at an account inserts into
-- `account_link`, with `scope_type = 'ALL'` unless the decision really differs
-- between sites.

-- ---------------------------------------------------------------------------
-- 1. What an account is
-- ---------------------------------------------------------------------------

-- The five roots of a chart, from the statement section every account already
-- carries. OTHER_NET is the one section that holds both sides — 8003
-- Selisih pembulatan and 8008 Pendapatan (Biaya) Lain-Lain are credit-normal,
-- the rest of the section is not — so its root follows the normal balance.
CREATE FUNCTION ledger_root_type(section text, normal_balance char)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE section
        WHEN 'ASSET'        THEN 'ASSET'
        WHEN 'LIABILITY'    THEN 'LIABILITY'
        WHEN 'EQUITY'       THEN 'EQUITY'
        WHEN 'REVENUE'      THEN 'INCOME'
        WHEN 'OTHER_INCOME' THEN 'INCOME'
        WHEN 'OTHER_NET'    THEN CASE WHEN normal_balance = 'C' THEN 'INCOME' ELSE 'EXPENSE' END
        ELSE 'EXPENSE'
    END
$$;

-- Which kinds of account may sit under which root. TAX and AFFILIATE are the
-- two that live on both sides of the balance sheet (prepaid tax / tax payable,
-- piutang / hutang afiliasi).
CREATE FUNCTION account_type_fits_root(account_type text, root_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE root_type
        WHEN 'ASSET' THEN account_type IN ('CASH', 'BANK', 'RECEIVABLE', 'INVENTORY', 'PREPAID',
                                           'TAX', 'AFFILIATE', 'FIXED_ASSET',
                                           'ACCUMULATED_DEPRECIATION', 'OTHER_ASSET')
        WHEN 'LIABILITY' THEN account_type IN ('PAYABLE', 'TAX', 'AFFILIATE', 'ACCRUED_LIABILITY',
                                               'LOAN', 'OTHER_LIABILITY')
        WHEN 'EQUITY'  THEN account_type = 'EQUITY'
        WHEN 'INCOME'  THEN account_type = 'INCOME'
        WHEN 'EXPENSE' THEN account_type IN ('COST_OF_GOODS_SOLD', 'EXPENSE', 'DEPRECIATION')
        ELSE false
    END
$$;

ALTER TABLE ledger_account
    ADD COLUMN root_type text
        GENERATED ALWAYS AS (ledger_root_type(statement_section, normal_balance)) STORED,
    ADD COLUMN account_type text;

-- The type an account gets when nobody said, in the order a person would guess
-- it: what most of its live siblings are (a new leaf under 1001 KAS & SETARA
-- KAS is a bank account, one under 4001 PENJUALAN is income), and failing
-- that the plainest type its root allows.
CREATE FUNCTION ledger_default_account_type(
    p_code text, p_parent text, p_section text, p_balance char
) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT a.account_type
           FROM ledger_account a
          WHERE a.parent_code = p_parent
            AND a.account_code <> p_code
            AND NOT a.is_group AND a.is_active
            AND a.account_type IS NOT NULL
            AND account_type_fits_root(a.account_type, ledger_root_type(p_section, p_balance))
          GROUP BY a.account_type
          ORDER BY count(*) DESC, a.account_type
          LIMIT 1),
        CASE ledger_root_type(p_section, p_balance)
            WHEN 'ASSET'     THEN 'OTHER_ASSET'
            WHEN 'LIABILITY' THEN 'OTHER_LIABILITY'
            WHEN 'EQUITY'    THEN 'EQUITY'
            WHEN 'INCOME'    THEN 'INCOME'
            ELSE CASE WHEN p_section = 'COST_OF_SALES' THEN 'COST_OF_GOODS_SOLD' ELSE 'EXPENSE' END
        END)
$$;

-- The client tree (0348), leaf by leaf. Only live leaves are classified by
-- their number: the retired leaves of the older charts reuse some of the same
-- digits for other things, so they take the plain type of their root.
UPDATE ledger_account a
   SET account_type = CASE
        WHEN NOT a.is_active OR length(a.account_code) <> 4 OR a.code_provenance IS NULL
            THEN ledger_default_account_type(a.account_code, NULL, a.statement_section, a.normal_balance)
        WHEN a.account_code IN ('1002', '1003', '1004') THEN 'CASH'
        WHEN a.account_code::int BETWEEN 1005 AND 1018 THEN 'BANK'
        WHEN a.account_code::int BETWEEN 1020 AND 1027 THEN 'RECEIVABLE'
        WHEN a.account_code::int BETWEEN 1029 AND 1034 OR a.account_code = '1110' THEN 'INVENTORY'
        WHEN a.account_code::int BETWEEN 1036 AND 1044
          OR a.account_code::int BETWEEN 1051 AND 1054 THEN 'PREPAID'
        WHEN a.account_code::int BETWEEN 1045 AND 1050
          OR a.account_code::int BETWEEN 2011 AND 2015 THEN 'TAX'
        WHEN a.account_code IN ('1057', '1058', '1059', '2028', '2029', '2030') THEN 'AFFILIATE'
        WHEN a.account_code::int BETWEEN 1061 AND 1080
          OR a.account_code IN ('1104', '1105', '1111', '1113') THEN 'FIXED_ASSET'
        WHEN a.account_code::int BETWEEN 1082 AND 1100
          OR a.account_code IN ('1106', '1107', '1112') THEN 'ACCUMULATED_DEPRECIATION'
        WHEN a.account_code IN ('2002', '2004', '2031') THEN 'PAYABLE'
        WHEN a.account_code::int BETWEEN 2017 AND 2026 THEN 'ACCRUED_LIABILITY'
        WHEN a.account_code::int BETWEEN 2035 AND 2048 THEN 'LOAN'
        WHEN a.account_code = '7003'
          OR a.account_code::int BETWEEN 7007 AND 7023
          OR a.account_code::int BETWEEN 7025 AND 7027 THEN 'DEPRECIATION'
        ELSE ledger_default_account_type(a.account_code, NULL, a.statement_section, a.normal_balance)
    END
 WHERE NOT a.is_group;

-- The update above queued the chart's deferred checks; they run now, so the
-- constraints below can be added in the same transaction.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE ledger_account
    ADD CONSTRAINT ledger_account_type_known CHECK (account_type IN (
        'CASH', 'BANK', 'RECEIVABLE', 'INVENTORY', 'PREPAID', 'TAX', 'AFFILIATE',
        'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'OTHER_ASSET',
        'PAYABLE', 'ACCRUED_LIABILITY', 'LOAN', 'OTHER_LIABILITY',
        'EQUITY', 'INCOME', 'COST_OF_GOODS_SOLD', 'EXPENSE', 'DEPRECIATION')),
    ADD CONSTRAINT ledger_account_type_only_on_leaves CHECK ((account_type IS NULL) = is_group),
    ADD CONSTRAINT ledger_account_type_fits_root
        CHECK (account_type IS NULL OR account_type_fits_root(account_type, root_type));

COMMENT ON COLUMN ledger_account.root_type IS
    'ASSET, LIABILITY, EQUITY, INCOME or EXPENSE, derived from statement_section (0460). ERPNext root_type.';
COMMENT ON COLUMN ledger_account.account_type IS
    'What kind of account a leaf is (0460). A posting role names the kinds it accepts (posting_role); a link to any other kind is refused when it is saved. NULL exactly on headings. ERPNext account_type.';

-- A leaf written without a type — `ensure_leaf` behind "Tambah bank", a test
-- fixture, a later migration — gets the type its siblings have rather than a
-- refusal. A heading never has one.
CREATE FUNCTION ledger_account_fills_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_group THEN
        NEW.account_type := NULL;
    ELSIF NEW.account_type IS NULL THEN
        NEW.account_type := ledger_default_account_type(
            NEW.account_code, NEW.parent_code, NEW.statement_section, NEW.normal_balance);
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER ledger_account_fills_type
    BEFORE INSERT OR UPDATE OF is_group, account_type, parent_code, statement_section, normal_balance
    ON ledger_account
    FOR EACH ROW EXECUTE FUNCTION ledger_account_fills_type();

-- ---------------------------------------------------------------------------
-- 2. What a role accepts
-- ---------------------------------------------------------------------------

-- A posting role is the word a posting rule uses for a line — `cash`,
-- `trade_payable`, `payroll_expense` — and it is grammar, owned by the code
-- that writes the line. Which ACCOUNT answers to it is Finance's decision
-- (account_link); which KINDS of account may answer is not, because a rule
-- that credits `trade_payable` has already decided the line is a payable.
--
-- Seeded from the accounts the map pointed each role at, so no existing
-- decision is refused by its own role. A role with no row accepts any leaf.
CREATE TABLE posting_role (
    role                  text PRIMARY KEY CHECK (role ~ '^[a-z][a-z0-9_]*$'),
    allowed_account_types text[] NOT NULL CHECK (cardinality(allowed_account_types) > 0),
    note                  text
);

INSERT INTO posting_role (role, allowed_account_types, note)
SELECT m.semantic_key,
       array_agg(DISTINCT a.account_type ORDER BY a.account_type),
       'seeded by 0460 from the accounts the map pointed at'
  FROM account_map m
  JOIN ledger_account a ON a.account_code = m.account_code
 WHERE a.account_type IS NOT NULL
 GROUP BY m.semantic_key;

COMMENT ON TABLE posting_role IS
    'The kinds of account each posting role accepts (0460). Grammar: changed by the code that writes the role, never from a screen.';

-- ---------------------------------------------------------------------------
-- 3. The link
-- ---------------------------------------------------------------------------

CREATE TABLE account_link (
    link_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role            text NOT NULL CHECK (role ~ '^[a-z][a-z0-9_]*$'),
    -- Where the decision is kept. Today every link is the company's own
    -- default, and `source_id` carries what the map called the qualifier (a
    -- bank, a pay class, an asset class). The later stages add the master
    -- records — expense category, pay component, payment method — as sources
    -- of their own.
    source_type     text NOT NULL DEFAULT 'COMPANY' CHECK (source_type IN ('COMPANY')),
    source_id       text NOT NULL DEFAULT '',
    -- For whom it holds. The most specific link wins: one site, then that
    -- site's kind, then everybody.
    scope_type      text NOT NULL CHECK (scope_type IN ('ALL', 'SITE_KIND', 'SITE')),
    scope_site_kind text CHECK (scope_site_kind IN ('HO', 'STORE')),
    scope_site_id   text REFERENCES site (id),
    scope_key       text GENERATED ALWAYS AS (COALESCE(scope_site_id, scope_site_kind, '')) STORED,
    account_code    text NOT NULL,
    -- Pinned false and part of the foreign key, as on the map: a heading
    -- cannot be linked.
    is_group        boolean NOT NULL DEFAULT false CHECK (is_group = false),
    category_code   text,
    set_by          text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at          timestamptz NOT NULL DEFAULT now(),
    note            text,
    CHECK (   (scope_type = 'ALL'       AND scope_site_kind IS NULL     AND scope_site_id IS NULL)
           OR (scope_type = 'SITE_KIND' AND scope_site_kind IS NOT NULL AND scope_site_id IS NULL)
           OR (scope_type = 'SITE'      AND scope_site_kind IS NULL     AND scope_site_id IS NOT NULL)),
    UNIQUE (role, source_type, source_id, scope_type, scope_key),
    FOREIGN KEY (account_code, is_group) REFERENCES ledger_account (account_code, is_group)
);

CREATE INDEX ix_account_link_role ON account_link (role, source_type, source_id);
CREATE INDEX ix_account_link_account ON account_link (account_code);

COMMENT ON TABLE account_link IS
    'role x source x scope -> account (0460). Finance''s own decision about which account answers to a posting role. Resolved most-specific-first: SITE, then SITE_KIND, then ALL. Read through the account_map view.';

-- The category half of a link is checked as it was on the map (0288).
CREATE FUNCTION assert_link_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM assert_category_fits(
        NEW.account_code, NEW.category_code,
        format('the link for %L', NEW.role));
    RETURN NEW;
END
$$;

CREATE TRIGGER account_link_category_fits
    BEFORE INSERT OR UPDATE ON account_link
    FOR EACH ROW EXECUTE FUNCTION assert_link_category();

-- The kind half: a role that has said which kinds of account it takes refuses
-- any other, in words a person can act on.
CREATE FUNCTION assert_link_account_fits_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    allowed text[];
    got     text;
    called  text;
BEGIN
    SELECT allowed_account_types INTO allowed FROM posting_role WHERE role = NEW.role;
    IF allowed IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT account_type, name INTO got, called FROM ledger_account WHERE account_code = NEW.account_code;
    IF got IS NULL OR NOT (got = ANY (allowed)) THEN
        RAISE EXCEPTION '% % is a % account, and % takes only % accounts',
            NEW.account_code, called, COALESCE(got, 'heading'), NEW.role,
            array_to_string(allowed, ' or ')
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER account_link_fits_role
    BEFORE INSERT OR UPDATE ON account_link
    FOR EACH ROW EXECUTE FUNCTION assert_link_account_fits_role();

-- Every change to a link, kept. A link is a decision about where money lands,
-- and "who pointed payroll at 6026, and when" has to be answerable after the
-- fact. A delete names its actor through `finance.actor`, which the deleting
-- transaction sets; a link has no column left to carry it.
CREATE TABLE account_link_history (
    history_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    link_id          bigint NOT NULL,
    action           text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    role             text NOT NULL,
    source_type      text NOT NULL,
    source_id        text NOT NULL,
    scope_type       text NOT NULL,
    scope_key        text NOT NULL,
    old_account_code text,
    new_account_code text,
    old_category     text,
    new_category     text,
    changed_by       text NOT NULL,
    changed_at       timestamptz NOT NULL DEFAULT now(),
    note             text
);

CREATE INDEX ix_account_link_history_link ON account_link_history (link_id, changed_at);

CREATE FUNCTION record_account_link_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO account_link_history
            (link_id, action, role, source_type, source_id, scope_type, scope_key,
             old_account_code, old_category, changed_by, note)
        VALUES (OLD.link_id, 'DELETE', OLD.role, OLD.source_type, OLD.source_id, OLD.scope_type,
                OLD.scope_key, OLD.account_code, OLD.category_code,
                COALESCE(NULLIF(current_setting('finance.actor', true), ''), 'unknown'), OLD.note);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (OLD.account_code, OLD.category_code) IS NOT DISTINCT FROM (NEW.account_code, NEW.category_code)
           AND OLD.note IS NOT DISTINCT FROM NEW.note THEN
            RETURN NEW;
        END IF;
        INSERT INTO account_link_history
            (link_id, action, role, source_type, source_id, scope_type, scope_key,
             old_account_code, new_account_code, old_category, new_category, changed_by, note)
        VALUES (NEW.link_id, 'UPDATE', NEW.role, NEW.source_type, NEW.source_id, NEW.scope_type,
                NEW.scope_key, OLD.account_code, NEW.account_code, OLD.category_code,
                NEW.category_code, NEW.set_by, NEW.note);
        RETURN NEW;
    ELSE
        INSERT INTO account_link_history
            (link_id, action, role, source_type, source_id, scope_type, scope_key,
             new_account_code, new_category, changed_by, note)
        VALUES (NEW.link_id, 'INSERT', NEW.role, NEW.source_type, NEW.source_id, NEW.scope_type,
                NEW.scope_key, NEW.account_code, NEW.category_code, NEW.set_by, NEW.note);
        RETURN NEW;
    END IF;
END
$$;

CREATE TRIGGER account_link_is_remembered
    AFTER INSERT OR UPDATE OR DELETE ON account_link
    FOR EACH ROW EXECUTE FUNCTION record_account_link_change();

-- ---------------------------------------------------------------------------
-- 4. The map's decisions, as links
-- ---------------------------------------------------------------------------

-- A decision collapses to the widest scope that says exactly what the map
-- said, and no wider:
--   * one link for ALL when every site had the row, with the same account;
--   * one link per KIND when every site of that kind had it, the same;
--   * otherwise one link per site, as before.
-- "Every site had the row" matters as much as "the same account": a meaning
-- the map left unset at head office must stay unset there, or a posting that
-- is refused today would start succeeding.
CREATE TEMP TABLE map_before ON COMMIT DROP AS
SELECT m.semantic_key, m.qualifier, m.site_id, s.kind, m.account_code, m.category_code,
       m.set_by, m.set_at, m.note
  FROM account_map m JOIN site s ON s.id = m.site_id;

CREATE TEMP TABLE kind_decision ON COMMIT DROP AS
SELECT b.semantic_key, b.qualifier, b.kind,
       min(b.account_code) AS account_code,
       min(b.category_code) AS category_code,
       max(b.set_at) AS set_at,
       (array_agg(b.note ORDER BY b.site_id) FILTER (WHERE b.note IS NOT NULL))[1] AS note
  FROM map_before b
 GROUP BY b.semantic_key, b.qualifier, b.kind
HAVING count(*) = (SELECT count(*) FROM site k WHERE k.kind = b.kind)
   AND count(DISTINCT (b.account_code, COALESCE(b.category_code, ''))) = 1;

CREATE TEMP TABLE all_decision ON COMMIT DROP AS
SELECT d.semantic_key, d.qualifier,
       min(d.account_code) AS account_code, min(d.category_code) AS category_code,
       max(d.set_at) AS set_at,
       (array_agg(d.note ORDER BY d.kind) FILTER (WHERE d.note IS NOT NULL))[1] AS note
  FROM kind_decision d
 GROUP BY d.semantic_key, d.qualifier
HAVING count(*) = (SELECT count(DISTINCT kind) FROM site)
   AND count(DISTINCT (d.account_code, COALESCE(d.category_code, ''))) = 1;

INSERT INTO account_link
    (role, source_type, source_id, scope_type, account_code, category_code, set_by, set_at, note)
SELECT a.semantic_key, 'COMPANY', a.qualifier, 'ALL', a.account_code, a.category_code,
       'migration:0460', a.set_at, a.note
  FROM all_decision a;

INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_site_kind, account_code, category_code,
     set_by, set_at, note)
SELECT d.semantic_key, 'COMPANY', d.qualifier, 'SITE_KIND', d.kind, d.account_code,
       d.category_code, 'migration:0460', d.set_at, d.note
  FROM kind_decision d
 WHERE NOT EXISTS (SELECT 1 FROM all_decision a
                    WHERE a.semantic_key = d.semantic_key AND a.qualifier = d.qualifier);

INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_site_id, account_code, category_code,
     set_by, set_at, note)
SELECT b.semantic_key, 'COMPANY', b.qualifier, 'SITE', b.site_id, b.account_code,
       b.category_code, b.set_by, b.set_at, b.note
  FROM map_before b
 WHERE NOT EXISTS (SELECT 1 FROM kind_decision d
                    WHERE d.semantic_key = b.semantic_key AND d.qualifier = b.qualifier
                      AND d.kind = b.kind);

-- ---------------------------------------------------------------------------
-- 5. The map goes; what a site resolves to is a view of the links
-- ---------------------------------------------------------------------------

-- `account_resolution` is the answer to "which account does this role, from
-- this source, land on at this site": one row per (role, source, site), the
-- most specific link winning. Every reader that joined the map per site joins
-- this instead. It is read-only; decisions are written to account_link.
CREATE VIEW account_resolution AS
SELECT DISTINCT ON (l.role, l.source_type, l.source_id, s.id)
       l.role,
       l.source_type,
       l.source_id,
       s.id            AS site_id,
       l.account_code,
       l.category_code,
       l.scope_type,
       l.link_id,
       l.set_by,
       l.set_at,
       l.note
  FROM account_link l
  JOIN site s
    ON l.scope_type = 'ALL'
    OR (l.scope_type = 'SITE_KIND' AND l.scope_site_kind = s.kind)
    OR (l.scope_type = 'SITE' AND l.scope_site_id = s.id)
 ORDER BY l.role, l.source_type, l.source_id, s.id,
          CASE l.scope_type WHEN 'SITE' THEN 0 WHEN 'SITE_KIND' THEN 1 ELSE 2 END;

COMMENT ON VIEW account_resolution IS
    'The account each (role, source, site) resolves to, most specific link first (0460). Read-only: decisions are written to account_link.';

-- The move is checked before the map is dropped: every resolution the map
-- held, the links give identically, and they give nothing the map did not.
DO $$
DECLARE
    missing bigint;
    extra   bigint;
BEGIN
    SELECT count(*) INTO missing FROM (
        SELECT semantic_key, site_id, qualifier, account_code, category_code FROM account_map
        EXCEPT
        SELECT role, site_id, source_id, account_code, category_code FROM account_resolution) gone;
    SELECT count(*) INTO extra FROM (
        SELECT role, site_id, source_id, account_code, category_code FROM account_resolution
        EXCEPT
        SELECT semantic_key, site_id, qualifier, account_code, category_code FROM account_map) new;
    IF missing <> 0 OR extra <> 0 THEN
        RAISE EXCEPTION 'account_link does not reproduce account_map: % resolutions lost, % invented',
            missing, extra;
    END IF;
END
$$;

-- Two foreign keys pointed at the map's natural key. The promise they kept —
-- the meaning a payment names resolves at its site — is now a trigger.
ALTER TABLE supplier_payment DROP CONSTRAINT supplier_payment_account_key_site_id_account_qualifier_fkey;
ALTER TABLE supplier_advance DROP CONSTRAINT supplier_advance_account_key_site_id_account_qualifier_fkey;

DROP TABLE account_map;
DROP FUNCTION assert_map_category();

CREATE FUNCTION assert_role_resolves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    row_json  jsonb := to_jsonb(NEW);
    wanted    text := row_json ->> TG_ARGV[0];
    at_site   text := row_json ->> TG_ARGV[1];
    source    text := COALESCE(row_json ->> TG_ARGV[2], '');
BEGIN
    IF wanted IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM account_resolution r
                    WHERE r.role = wanted AND r.site_id = at_site
                      AND r.source_type = 'COMPANY' AND r.source_id = source) THEN
        RAISE EXCEPTION 'no account is linked for % (%) at %; link it on the Account Links screen first',
            wanted, NULLIF(source, ''), at_site
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER supplier_payment_role_resolves
    BEFORE INSERT OR UPDATE OF account_key, site_id, account_qualifier ON supplier_payment
    FOR EACH ROW EXECUTE FUNCTION assert_role_resolves('account_key', 'site_id', 'account_qualifier');

CREATE TRIGGER supplier_advance_role_resolves
    BEFORE INSERT OR UPDATE OF account_key, site_id, account_qualifier ON supplier_advance
    FOR EACH ROW EXECUTE FUNCTION assert_role_resolves('account_key', 'site_id', 'account_qualifier');

-- The payment ledger's reconciliation read the map; it reads the links now.
CREATE OR REPLACE FUNCTION payment_ledger_integrity(p_as_of date, p_site text DEFAULT NULL::text)
 RETURNS TABLE(account_key text, qualifier text, site_id text, side text, account_code text,
               account_name text, open_items bigint, ledger_outstanding_minor bigint,
               gl_balance_minor bigint, difference_minor bigint)
 LANGUAGE sql
 STABLE
AS $function$
    WITH ledger AS (
        SELECT i.account_key,
               i.qualifier,
               i.site_id,
               i.side,
               COUNT(*) FILTER (WHERE i.outstanding_minor <> 0)::bigint AS open_items,
               COALESCE(SUM(i.outstanding_minor), 0)::bigint AS outstanding_minor
          FROM payment_ledger_as_of(p_as_of) i
         WHERE p_site IS NULL OR i.site_id = p_site
         GROUP BY i.account_key, i.qualifier, i.site_id, i.side
    )
    SELECT l.account_key,
           l.qualifier,
           l.site_id,
           l.side,
           r.account_code,
           a.name AS account_name,
           l.open_items,
           l.outstanding_minor AS ledger_outstanding_minor,
           COALESCE(gl.balance, 0)::bigint AS gl_balance_minor,
           (l.outstanding_minor - COALESCE(gl.balance, 0))::bigint AS difference_minor
      FROM ledger l
      LEFT JOIN account_resolution r
             ON r.role = l.account_key
            AND r.site_id = l.site_id
            AND r.source_type = 'COMPANY'
            AND r.source_id = l.qualifier
      LEFT JOIN ledger_account a ON a.account_code = r.account_code
      LEFT JOIN LATERAL (
          SELECT CASE WHEN l.side = 'RECEIVABLE'
                      THEN COALESCE(SUM(jl.debit_minor), 0) - COALESCE(SUM(jl.credit_minor), 0)
                      ELSE COALESCE(SUM(jl.credit_minor), 0) - COALESCE(SUM(jl.debit_minor), 0)
                 END AS balance
            FROM journal_line jl
            JOIN journal_entry je USING (entry_id)
           WHERE jl.account_code = r.account_code
             AND jl.site_id = l.site_id
             AND je.posting_date <= p_as_of
      ) gl ON true
     ORDER BY l.account_key, l.site_id, l.qualifier;
$function$;

-- ---------------------------------------------------------------------------
-- 6. An affiliate link names its family, not the other site
-- ---------------------------------------------------------------------------

-- The map qualified the affiliate meanings by family AND counterparty
-- (`BARANG:store-01`) and wrote one row per pair of sites — 936 of the rows
-- above. Since 0380 the counterparty decides nothing: a unit is always on the
-- family's hutang account and head office always on its piutang account (I7),
-- whoever is on the other side. The counterparty lives on the journal line as
-- `counter_site_id`; the link keeps only the family.
DELETE FROM account_link WHERE role IN ('affiliate_payable', 'affiliate_receivable');

INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_site_kind, account_code, set_by, note)
SELECT r.role, 'COMPANY', f.family, 'SITE_KIND', k.kind,
       CASE k.kind WHEN 'STORE' THEN f.unit_code ELSE f.ho_code END,
       'migration:0460', 'I7: a unit is always on hutang, head office always on piutang'
  FROM (VALUES ('affiliate_payable'), ('affiliate_receivable')) r (role)
 CROSS JOIN (VALUES ('PEMBIAYAAN', '2028', '1057'),
                    ('BARANG',     '2029', '1058'),
                    ('LAIN',       '2030', '1059')) f (family, unit_code, ho_code)
 CROSS JOIN (VALUES ('STORE'), ('HO')) k (kind);

-- The history starts with the links as they were born; the set_by and set_at
-- each link carries already say who decided it.
DELETE FROM account_link_history;
