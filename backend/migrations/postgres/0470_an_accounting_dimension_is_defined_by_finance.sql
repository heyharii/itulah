-- 0470: an accounting dimension is defined by Finance.
--
-- Stage 5 of "Desain Fondasi Finance Dinamis", ERPNext's Accounting
-- Dimension. A journal line already says which site it belongs to; any other
-- way somebody wants to cut the books — division, cost center, project — was a
-- column a developer had to add. Now Finance defines a dimension, its values,
-- and whether profit-and-loss or balance-sheet lines must carry it, and a
-- journal line carries a value for each dimension it is tagged with.
--
-- Seeded: DIVISION with the client's divisions (KODE DIVISI, 0382), and
-- COST_CENTER and PROJECT with no values yet. None is mandatory until Finance
-- says so.

CREATE TABLE accounting_dimension (
    code             text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name             text NOT NULL CHECK (btrim(name) <> ''),
    -- ERPNext's dimension defaults: a line on a P&L (or balance-sheet) account
    -- is refused at commit when it carries no value for a mandatory dimension.
    mandatory_for_pl boolean NOT NULL DEFAULT false,
    mandatory_for_bs boolean NOT NULL DEFAULT false,
    is_active        boolean NOT NULL DEFAULT true,
    created_by       text NOT NULL DEFAULT 'system',
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounting_dimension_value (
    dimension_code text NOT NULL REFERENCES accounting_dimension (code),
    value_code     text NOT NULL CHECK (btrim(value_code) <> ''),
    name           text NOT NULL CHECK (btrim(name) <> ''),
    is_active      boolean NOT NULL DEFAULT true,
    PRIMARY KEY (dimension_code, value_code)
);

-- A line's values. Append-only like the line itself.
CREATE TABLE journal_line_dimension (
    line_id        uuid NOT NULL REFERENCES journal_line (line_id),
    dimension_code text NOT NULL,
    value_code     text NOT NULL,
    PRIMARY KEY (line_id, dimension_code),
    FOREIGN KEY (dimension_code, value_code)
        REFERENCES accounting_dimension_value (dimension_code, value_code)
);

CREATE INDEX ix_journal_line_dimension_value ON journal_line_dimension (dimension_code, value_code);

CREATE FUNCTION protect_journal_line_dimension() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'a journal line''s dimensions are part of the line and cannot change; reverse the entry'
        USING ERRCODE = 'P0001';
END
$$;

CREATE TRIGGER journal_line_dimension_append_only
    BEFORE UPDATE OR DELETE ON journal_line_dimension
    FOR EACH ROW EXECUTE FUNCTION protect_journal_line_dimension();

-- The mandatory rule, checked when the entry commits (its dimension rows are
-- written after its lines, in the same transaction).
CREATE FUNCTION assert_mandatory_dimensions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(DISTINCT format('%s on %s', d.code, l.account_code), ', ')
      INTO missing
      FROM journal_line l
      JOIN ledger_account a ON a.account_code = l.account_code
      JOIN accounting_dimension d
        ON d.is_active
       AND ((a.root_type IN ('INCOME', 'EXPENSE') AND d.mandatory_for_pl)
         OR (a.root_type IN ('ASSET', 'LIABILITY', 'EQUITY') AND d.mandatory_for_bs))
     WHERE l.entry_id = NEW.entry_id
       AND NOT EXISTS (SELECT 1 FROM journal_line_dimension x
                        WHERE x.line_id = l.line_id AND x.dimension_code = d.code);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'this entry leaves mandatory dimensions empty: %', missing
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER journal_entry_mandatory_dimensions
    AFTER INSERT ON journal_entry
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_mandatory_dimensions();

INSERT INTO accounting_dimension (code, name, created_by) VALUES
    ('DIVISION',    'Divisi',      'migration:0470'),
    ('COST_CENTER', 'Cost center', 'migration:0470'),
    ('PROJECT',     'Project',     'migration:0470');

INSERT INTO accounting_dimension_value (dimension_code, value_code, name, is_active)
SELECT 'DIVISION', d.code, d.label, d.active FROM division d;

COMMENT ON TABLE accounting_dimension IS
    'ERPNext Accounting Dimension (0470): a way Finance cuts the books beyond the site, with its values and whether P&L or balance-sheet lines must carry it.';
