-- 0702: Every change to a master record is kept, field by field.
--
-- # What the activity log could not say
--
-- `audit_log` (0078) records that somebody called `PUT /suppliers/{id}` at
-- 10:41. It does not record that the call changed the supplier's bank account
-- from BCA 123 to BCA 987 — and that is the change a fraud is made of. ERPNext
-- keeps a Version per save with every field's before and after; 7Soft's menu
-- History shows who added, edited or deleted what. This is the same thing,
-- kept by the database rather than by each handler, so no handler can forget.
--
-- # How
--
-- One trigger function, `record_version_capture`, attached AFTER UPDATE OR
-- DELETE to each table below. It compares the row before and after as JSON
-- and writes one `record_version` row with only the fields that changed. An
-- UPDATE that changed nothing but `updated_at` writes nothing.
--
-- Its arguments: the record kind the row is filed under (a word from
-- `domain::RecordKind`, so the hub's sheet for that record shows it), the
-- column that names the record, and then any columns never to copy — secrets
-- such as a password hash, and bookkeeping that changes on every sign-in.
-- A child table files under its parent: a supplier's bank account change is
-- in the supplier's history, which is where somebody will look for it.
--
-- # Who
--
-- The actor is `app.actor` when the transaction set it (`SET LOCAL`), else the
-- row's own `updated_by` / `set_by` / `recorded_by` after the change, else the
-- database role. Most master tables already carry `updated_by`, written by the
-- handler from the server-owned principal.
--
-- Inserts are not kept: a record's creation is already in the activity log
-- and in its own `created_by`/`created_at`. Ledgers are not attached: they are
-- append-only and nothing about them can change.

CREATE TABLE record_version (
    version_id  bigserial PRIMARY KEY,
    record_kind text NOT NULL CHECK (btrim(record_kind) <> ''),
    record_id   text NOT NULL CHECK (btrim(record_id) <> ''),
    table_name  text NOT NULL,
    operation   text NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    -- {"field": {"from": <old>, "to": <new>}, ...}; `to` is null on DELETE.
    changes     jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'object'),
    actor       text NOT NULL,
    changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_record_version_record
    ON record_version (record_kind, record_id, changed_at DESC, version_id DESC);

COMMENT ON TABLE record_version IS
    'Field-by-field history of master records, written by record_version_capture (0702).';

CREATE TRIGGER record_version_append_only
    BEFORE UPDATE OR DELETE ON record_version
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE FUNCTION record_version_capture() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    kind      text := TG_ARGV[0];
    key_col   text := TG_ARGV[1];
    ignored   text[] := ARRAY['updated_at', 'updated_by', 'set_at'];
    before    jsonb := to_jsonb(OLD);
    after     jsonb;
    diff      jsonb := '{}'::jsonb;
    field     text;
    who       text;
    i         integer;
BEGIN
    FOR i IN 2 .. TG_NARGS - 1 LOOP
        ignored := ignored || TG_ARGV[i];
    END LOOP;

    IF TG_OP = 'UPDATE' THEN
        after := to_jsonb(NEW);
        FOR field IN SELECT jsonb_object_keys(after) LOOP
            CONTINUE WHEN field = ANY (ignored);
            IF (before -> field) IS DISTINCT FROM (after -> field) THEN
                diff := diff || jsonb_build_object(
                    field, jsonb_build_object('from', before -> field, 'to', after -> field));
            END IF;
        END LOOP;
        IF diff = '{}'::jsonb THEN
            RETURN NULL;
        END IF;
    ELSE
        after := '{}'::jsonb;
        FOR field IN SELECT jsonb_object_keys(before) LOOP
            CONTINUE WHEN field = ANY (ignored);
            diff := diff || jsonb_build_object(
                field, jsonb_build_object('from', before -> field, 'to', NULL));
        END LOOP;
    END IF;

    who := COALESCE(
        NULLIF(current_setting('app.actor', true), ''),
        NULLIF(after ->> 'updated_by', ''),
        NULLIF(after ->> 'set_by', ''),
        NULLIF(after ->> 'recorded_by', ''),
        session_user::text);

    INSERT INTO record_version (record_kind, record_id, table_name, operation, changes, actor)
    VALUES (kind, COALESCE(before ->> key_col, '?'), TG_TABLE_NAME, TG_OP, diff, who);
    RETURN NULL;
END $$;

COMMENT ON FUNCTION record_version_capture() IS
    'AFTER UPDATE OR DELETE: keep what changed. Args: record kind, key column, '
    'then columns never to copy (0702).';

-- ── the records whose changes are kept ───────────────────────────────────

-- Buying: the supplier, and what the money is paid to.
CREATE TRIGGER supplier_versions
    AFTER UPDATE OR DELETE ON supplier
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('supplier', 'supplier_id');
-- A supplier's bank accounts live in `bank_account` beside the company's own
-- (0308); only the supplier's rows are the supplier's history. The number is
-- kept encrypted and is never copied here: its mask and fingerprint are, and
-- they are what says the account changed.
CREATE TRIGGER supplier_bank_account_versions
    AFTER UPDATE OR DELETE ON bank_account
    FOR EACH ROW
    WHEN (OLD.party_type = 'SUPPLIER')
    EXECUTE FUNCTION record_version_capture('supplier', 'party_id', 'account_number_enc');
CREATE TRIGGER supplier_contact_versions
    AFTER UPDATE OR DELETE ON supplier_contact
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('supplier', 'supplier_id');
CREATE TRIGGER supplier_item_versions
    AFTER UPDATE OR DELETE ON supplier_item
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('supplier_item', 'supplier_item_id');

-- Product master.
CREATE TRIGGER article_versions
    AFTER UPDATE OR DELETE ON article
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('article', 'id');
CREATE TRIGGER colour_versions
    AFTER UPDATE OR DELETE ON colour
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('colour', 'code');

-- Money: the chart and the assets.
CREATE TRIGGER ledger_account_versions
    AFTER UPDATE OR DELETE ON ledger_account
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('account', 'account_code');
CREATE TRIGGER fixed_asset_versions
    AFTER UPDATE OR DELETE ON fixed_asset
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('asset', 'asset_id');

-- The organisation, and who may sign in.
CREATE TRIGGER unit_versions
    AFTER UPDATE OR DELETE ON unit
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('unit', 'id');
CREATE TRIGGER site_versions
    AFTER UPDATE OR DELETE ON site
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('unit', 'unit_id');
CREATE TRIGGER app_user_versions
    AFTER UPDATE OR DELETE ON app_user
    FOR EACH ROW EXECUTE FUNCTION record_version_capture(
        'app_user', 'id',
        'password_hash', 'last_login_at', 'auth_version', 'login_blocked_until',
        'failed_login_count', 'failed_logins');

-- GA's agreements.
CREATE TRIGGER ga_contract_versions
    AFTER UPDATE OR DELETE ON ga_contract
    FOR EACH ROW EXECUTE FUNCTION record_version_capture('contract', 'contract_id');
