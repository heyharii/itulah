-- 0050: The chart of accounts, the map into it, and the periods it is kept in.
--
-- # Whose chart this is
--
-- Not ours. This table holds CENTRAL FASHION STORE's own chart of accounts,
-- imported from their master export: 7,528 accounts on a code-length ladder of
-- {1,3,5,7,10,12}, with the twelve-character leaves scoped to one of fourteen
-- locations. Our `site` table is a DC and thirteen stores — fourteen, exactly.
--
-- The alternative was to invent a tidy retail chart of forty accounts. That is
-- the same mistake this system has already made twice with prices: a second
-- authority that agrees on ordinary days and parts company on the day somebody
-- asks why the two sets of books disagree. A ledger whose trial balance cannot
-- be laid beside the client's own is a ledger nobody will use twice.
--
-- # Why nothing in Rust may name an account code
--
-- A posting rule that says `1011201001` is a rule that has to be recompiled when
-- Finance moves an account, and that silently posts to the wrong place if they
-- move it and nobody notices. So rules name a MEANING — `persediaan`,
-- `hutang_supplier` — and `account_map` turns that meaning plus a location into
-- a code. The map is data. It is edited on a screen, by somebody who knows the
-- chart, and it is the only place a client account code appears.
--
-- A meaning with no mapping is not a default. Posting refuses, and says which
-- key it could not resolve. Guessing an account is how a general ledger becomes
-- a thing that has to be unwound by hand a year later.

CREATE TABLE ledger_account (
    -- The client's own code, verbatim. Text and not an integer: `0` is not a
    -- legal leading digit here today, but a code is a label and arithmetic on
    -- it is never wanted.
    account_code   text PRIMARY KEY CHECK (account_code ~ '^[0-9]+$'),
    name           text NOT NULL CHECK (btrim(name) <> ''),

    -- Longest declared strict prefix, not "the previous rung". Six accounts in
    -- the client's chart skip a rung — 204001, 205001, 600104, 7010310001,
    -- 7010310002, 7020310 — and a strict parent rule rejects all six. They are
    -- not orphans; they simply hang higher than the ladder suggests.
    parent_code    text REFERENCES ledger_account(account_code),

    -- 1 ASSET, 2 LIABILITIES, 3 MODAL, 4 PENDAPATAN, 5 BEBAN POKOK,
    -- 6 BEBAN USAHA, 7 BEBAN USAHA LAINNYA, 8 BEBAN NON OPERASIONAL.
    -- Derived, so it cannot disagree with the code it came from.
    root_class     char(1) GENERATED ALWAYS AS (left(account_code, 1)) STORED,
    depth          smallint GENERATED ALWAYS AS (length(account_code)::smallint) STORED,

    -- The client's own declaration, imported as-is. A group is a heading: it
    -- has a balance by summation and nothing may be posted to it directly.
    is_group       boolean NOT NULL,
    -- 104 accounts arrive inactive. Imported inactive rather than dropped: an
    -- account that was used last year still has to appear in last year's ledger.
    is_active      boolean NOT NULL DEFAULT true,

    -- The location this account belongs to, when its code carries one. NULL on
    -- every group and on leaves that are company-wide.
    site_id        text REFERENCES site(id),
    -- Goods in transit is a matrix, not a location. `1011203` (BDP Barang
    -- Dagangan) names its SOURCE at the ten-character rung and its DESTINATION
    -- in the two-digit suffix, so one leaf means "from the DC, to store 01".
    -- `site_id` is the destination; this is the source. NULL everywhere else.
    --
    -- Without this column a blind "suffix means location" import files all 210
    -- BDP leaves under the wrong place, and the first transfer posted would be
    -- wrong in a way the trial balance cannot see, because it still balances.
    counterparty_site_id text REFERENCES site(id),

    imported_at    timestamptz NOT NULL DEFAULT now(),

    -- No account is its own parent. Cheap, and it makes the tree walk safe.
    CHECK (parent_code IS NULL OR parent_code <> account_code),
    CHECK (parent_code IS NULL OR account_code LIKE parent_code || '%'),
    CHECK (counterparty_site_id IS NULL OR site_id IS NOT NULL)
);
CREATE INDEX ix_ledger_account_parent ON ledger_account (parent_code);
CREATE INDEX ix_ledger_account_class ON ledger_account (root_class, account_code);
CREATE INDEX ix_ledger_account_site ON ledger_account (site_id) WHERE site_id IS NOT NULL;

-- What makes "you cannot post to a heading" declarative rather than a rule
-- somebody has to remember. Referencing tables carry a `is_group` column fixed
-- at false and point at this pair, so the database refuses the row.
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_code_group_unique
    UNIQUE (account_code, is_group);

COMMENT ON TABLE ledger_account IS
    'The client''s own chart of accounts, imported verbatim. Nothing in Rust names a code from this table; posting rules name a semantic key and account_map resolves it.';

-- What a posting rule means, and which account carries that meaning here.
--
-- Three parts to the key, and each earns its place:
--   * the meaning         — `kas`, `hutang_supplier`, `persediaan`
--   * the location        — cash at store 01 is not cash at the DC
--   * a qualifier         — which bank, which card scheme, which source site
--
-- Without the qualifier there is no way to say "the BCA savings account" as
-- distinct from Mandiri's, and the client has five of each. Empty string rather
-- than NULL so the primary key works without a partial index.
CREATE TABLE account_map (
    semantic_key   text NOT NULL CHECK (semantic_key ~ '^[a-z][a-z0-9_]*$'),
    site_id        text NOT NULL REFERENCES site(id),
    qualifier      text NOT NULL DEFAULT '',
    account_code   text NOT NULL,

    -- Pinned false and part of the foreign key: a heading cannot be mapped.
    is_group       boolean NOT NULL DEFAULT false CHECK (is_group = false),

    set_by         text NOT NULL,
    set_at         timestamptz NOT NULL DEFAULT now(),
    note           text,

    PRIMARY KEY (semantic_key, site_id, qualifier),
    FOREIGN KEY (account_code, is_group)
        REFERENCES ledger_account (account_code, is_group)
);
CREATE INDEX ix_account_map_account ON account_map (account_code);

COMMENT ON TABLE account_map IS
    'semantic_key x site x qualifier -> client account code. The only place a client account code is chosen. An unmapped key makes posting refuse, never guess.';

-- The months, and whether they are still open.
--
-- A closed period is not advice. The gate is a trigger on the journal in 0048,
-- which reads this row FOR SHARE, so a close and a posting cannot interleave:
-- one of them waits, and whichever waits then sees the other's decision.
CREATE TABLE fiscal_period (
    year        smallint NOT NULL CHECK (year BETWEEN 2000 AND 2999),
    month       smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    closed_by   text,
    closed_at   timestamptz,
    PRIMARY KEY (year, month),
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CHECK ((closed_at IS NULL) = (closed_by IS NULL))
);

COMMENT ON TABLE fiscal_period IS
    'One row per accounting month. CLOSED refuses new journal entries, enforced by a trigger that locks this row rather than by application code.';
