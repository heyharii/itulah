-- An account says who may post to it.
--
-- The COA 162 workbook carries a posting policy per account — `Posting Mode`,
-- `Manual JE`, `Required Dimension`, `Source Document` — and until now none of
-- it reached the database. A manual journal could be keyed straight into
-- `Piutang Kartu Kredit`, which the workbook marks `AUTO_ONLY` because the only
-- thing that should ever move it is a settlement.
--
-- # Four of the six columns already existed, and nothing read them
--
-- 0243 added `dimension` ('unit' | 'company'), `requires_counterparty`,
-- `normal_balance` and `is_contra`. Grep for them in `src/`:
-- `requires_counterparty` — nil. `is_contra` — nil. `normal_balance` — one hit,
-- and it is `allotments::normal_balance_tx`, a pool quantity with the same name
-- and nothing to do with the ledger. Four policy columns in the schema, none
-- enforced anywhere.
--
-- So this migration adds the two that are missing rather than six, and the
-- validator that comes with it reads all six. A column nobody reads is the
-- mistake 0243 made in good faith; repeating it at twice the size would be
-- worse.
--
-- # What is deliberately NOT here
--
-- No `lifecycle`/`status` enum. `is_active` already says whether an account may
-- be used and `is_group` whether it is a heading, which is what the validator
-- needs. DORMANT vs RETIRED vs PENDING_POLICY is a real distinction and it
-- belongs with the thing that acts on it — the activation work — not here,
-- unread, waiting to disagree with `is_active`.
--
-- No `account_required_reference` table. Half the reference types that were
-- proposed for it (principal, financing facility, prepaid schedule, tax period,
-- project) point at tables that do not exist yet. What CAN be required today is
-- already expressible: the unit is `dimension`, the counter unit is
-- `requires_counterparty`, and the party and the asset are `journal_line`'s own
-- `supplier_id` and `asset_id`.
--
-- # The defaults are chosen so that this migration changes no behaviour
--
-- `MANUAL` and `YES` on every existing row: the most permissive pair. Turning
-- the policy on is a SEED, account by account, and a chart that has not been
-- seeded refuses nothing. That is the opposite of a shadow mode and better than
-- one — there is no second code path, only rows that do not constrain yet.

ALTER TABLE ledger_account
    ADD COLUMN posting_mode     text NOT NULL DEFAULT 'MANUAL'
        CHECK (posting_mode IN ('AUTO_ONLY', 'SEMI_AUTO', 'MANUAL')),
    ADD COLUMN manual_je_policy text NOT NULL DEFAULT 'YES'
        CHECK (manual_je_policy IN ('NO', 'OVERRIDE', 'YES'));

COMMENT ON COLUMN ledger_account.posting_mode IS
    'How this account is allowed to move. AUTO_ONLY: only a posting rule, never a person. SEMI_AUTO: a rule ordinarily, a person where the workbook permits it. MANUAL: either. From `COA 162 Config.Posting Mode`.';
COMMENT ON COLUMN ledger_account.manual_je_policy IS
    'Whether a hand-written journal entry may name this account. NO: never. OVERRIDE: only through an approved correction. YES: freely. From `COA 162 Config.Manual JE`.';

-- ---------------------------------------------------------------------------
-- Which documents may reach an account, and which may not
-- ---------------------------------------------------------------------------
--
-- ERPNext has no equivalent: it restricts an account by what it IS (group,
-- disabled, frozen, balance direction, account type) and never by which document
-- touches it. The workbook does state it per account, and it is the client's
-- policy rather than a borrowed idea, so it is here — the one place this design
-- goes further than the thing it copies.
--
-- # Why a rule has an `effect` and is not simply a whitelist
--
-- A whitelist can only say "these and nothing else", and the first real case
-- needs the opposite. The replacement reserve has two paths and the owner has
-- ruled on exactly one of them:
--
--     formation   Cr replacement_reserve   `postgres::reserves`      ASSET_RESERVE
--                 -> PENDING POLICY: nobody has said what creates the balance
--     draw-down   Dr replacement_reserve   `postgres::payables:1251` SUPPLIER_INVOICE
--                 -> known and permitted
--
-- Expressed as a whitelist that is `{SUPPLIER_INVOICE, ASSET_DISPOSAL, …}` and
-- the risk is the `…`: every kind somebody forgets becomes a refusal nobody
-- chose, on an account that IS supposed to move. Expressed as one DENY row it is
-- `ASSET_RESERVE`, which is the only thing actually decided, and everything else
-- keeps working. One row, and it cannot over-refuse.
--
-- So both directions exist and DENY is checked first:
--
--     no rows at all        -> any kind may post
--     a DENY row matches    -> refused, whatever else says
--     ALLOW rows exist      -> only those kinds, and the refusal names them
--
-- # `source_kind` is deliberately not re-declared with a CHECK
--
-- The list lives in `journal_entry_source_kind_check` and restating it is exactly
-- how 0107 and 0242 came to disagree — see 0257. A row naming a kind the journal
-- does not allow is unreachable rather than dangerous: nothing can post with that
-- kind, so the rule never matches.
CREATE TABLE account_source_rule (
    account_code text NOT NULL REFERENCES ledger_account(account_code),
    source_kind  text NOT NULL CHECK (source_kind ~ '^[A-Z][A-Z_]*$'),
    effect       text NOT NULL DEFAULT 'ALLOW' CHECK (effect IN ('ALLOW', 'DENY')),
    -- Who decided, because a rule is a policy and a policy has an author.
    set_by       text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at       timestamptz NOT NULL DEFAULT now(),
    note         text,
    PRIMARY KEY (account_code, source_kind)
);

COMMENT ON TABLE account_source_rule IS
    'Which source kinds may or may not post to an account. NO ROWS for an account means every kind may — the table constrains only what it names, so it can be filled one account at a time. DENY wins over ALLOW; a set of ALLOW rows means "these and nothing else".';
COMMENT ON COLUMN account_source_rule.effect IS
    'DENY refuses one kind and leaves the rest alone, which is what a single undecided posting path needs. ALLOW narrows the account to the kinds listed. DENY is checked first.';
