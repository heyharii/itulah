-- An account may have no permitted path at all.
--
-- 0261 gave `posting_mode` three values and every one of them lets SOMETHING
-- post: `AUTO_ONLY` admits a rule, `SEMI_AUTO` and `MANUAL` admit a person too.
-- The workbook has accounts where the answer is neither — where the policy that
-- would say who may post has not been decided — and folding those onto
-- `AUTO_ONLY` says the opposite of what they mean. It says "a rule may".
--
-- Two accounts in `COA 162 Config` are not `SEMI_AUTO`/`AUTO_ONLY`:
--
--     1202691  Reserve Replacement Operating Equipment
--              Posting Mode RESTRICTED · Status PENDING POLICY · Status desain Ditahan
--     3101002  Laba (Rugi) Ditahan
--              Posting Mode SYSTEM_ONLY · Status SYSTEM
--
-- The second is genuinely `AUTO_ONLY`: only the close writes retained earnings,
-- and a person must not. The first is not, and it is the reason this value
-- exists.
--
-- # What BLOCKED means, and what it is not
--
-- Nothing posts. Not a rule, not a person, not an approved correction. It is a
-- statement about POLICY — "we have not decided what may move this" — and it is
-- deliberately not `is_active = false`, which is a statement about the CLIENT's
-- chart: that they retired the account. Two different facts; an account can be
-- live in their books and undecided in ours.
--
-- It is also not the lifecycle work. ACTIVE / DORMANT / RETIRED / PENDING_POLICY
-- is a fuller vocabulary that is still wanted and still ahead — `204001 Giro
-- Keluar` is confirmed RETIRED and has nowhere to say so yet. This is one value
-- on a column that already exists, added because the validator needs it now;
-- when the lifecycle lands, BLOCKED is what PENDING_POLICY enforces.

ALTER TABLE ledger_account DROP CONSTRAINT IF EXISTS ledger_account_posting_mode_check;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_posting_mode_check
    CHECK (posting_mode IN ('AUTO_ONLY', 'SEMI_AUTO', 'MANUAL', 'BLOCKED'));

COMMENT ON COLUMN ledger_account.posting_mode IS
    'How this account is allowed to move. BLOCKED: not at all, because the policy is undecided — distinct from `is_active = false`, which is the client retiring an account. AUTO_ONLY: only a posting rule. SEMI_AUTO: a rule ordinarily, a person where the workbook permits. MANUAL: either. From `COA 162 Config.Posting Mode`, where RESTRICTED and a PENDING POLICY status both land here.';

-- ---------------------------------------------------------------------------
-- The replacement reserve does NOT get this value
-- ---------------------------------------------------------------------------
--
-- `1021607001 Reserve Replacement Operating Equipment- Rak 1` is the account the
-- workbook marks RESTRICTED / PENDING POLICY, and BLOCKED would be wrong for it.
-- The owner ruled on one of its two paths, not on the account:
--
--     formation   Cr replacement_reserve   `postgres::reserves`      ASSET_RESERVE
--                 undecided — nobody has said what creates the balance (0139)
--     draw-down   Dr replacement_reserve   `postgres::payables:1251` SUPPLIER_INVOICE
--                 known and approved
--
-- BLOCKED stops both, so it would take away something the owner called known.
-- The refusal belongs to the DOCUMENT, and `account_source_rule.effect = 'DENY'`
-- (0261) says exactly that in one row:
--
--     INSERT INTO account_source_rule (account_code, source_kind, effect, set_by, note)
--     VALUES ('1021607001', 'ASSET_RESERVE', 'DENY', '…',
--             'formation undecided (0139); the draw-down is approved');
--
-- `scripts/seed-posting-profile.py` emits that row, and deliberately does NOT
-- map this account's PENDING POLICY status onto BLOCKED — the two would fight,
-- and the coarser one would win.
--
-- Note also that the workbook cannot carry this policy by itself: it files
-- `1202691` as a NEW account, with no row in `Mapping Legacy` pointing at it,
-- while the client's own export has 36 leaves under `1021607*` and our chart
-- keeps one of them. The seed bridges it semantically instead.
