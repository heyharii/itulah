-- An accountant gets their own numbers back.
--
-- Forty accounts is the right chart to keep books in and the wrong chart to
-- hand somebody who has been reading the other one for years. The client's
-- 2024 and 2025 statements are in twelve-digit codes, their filed returns are
-- in twelve-digit codes, and the accountant who has to sign the next set will
-- reconcile them against the last set. If the new chart cannot print the old
-- numbers, the answer to "is this the same company" is a spreadsheet somebody
-- maintains by hand, and the honest thing to have said would have been no.
--
-- So the bridge is a function, and it is exact wherever it is possible to be
-- exact and NULL wherever it is not. There are three cases and they are worth
-- separating, because the third one is the limit of this migration and it
-- should be visible rather than fudged.
--
-- **The category knows.** 130 of the 190 retired accounts folded into an
-- account that takes a category, and the fold was one-for-one: `6010310006
-- Biaya Pemakaian Listrik` became `6301` carrying `BIAYA_PEMAKAIAN_LISTRIK`,
-- and nothing else became that pair. `ledger_account_remap` is therefore
-- invertible on (new_code, category_code), and that is the whole of this case.
--
-- **The bank account knows.** Fourteen bank accounts became one `1102`, and
-- what tells them apart is `bank_account_id`. 0291 kept each one's old ledger
-- code in `company_bank_account.legacy_ledger_account_code` for exactly this.
--
-- **The asset register knows, and this function does not.** An asset line
-- carries `asset_id`, and the asset carries its class, and the class carries
-- the client's own sub-type — `OE_RAK_27` is `1021507027`. But the account
-- decides which of the client's four parallel asset families the code comes
-- from: cost `1021507`, replacement reserve `1021607`, replacement expense
-- `7010215`. That correspondence is not a string rule — `1021504 Machineries`
-- depreciates into `7010212` and `1021506 FFE` into `7010214`, and land does
-- not depreciate at all — and reconstructing it by pattern would be inventing a
-- mapping nobody has checked. So asset lines return NULL here and are
-- reconciled through the register, which carries the client's sub-type on every
-- row. `docs/finance-legacy-codes.md` says so in the same words.
--
-- **And one case where the client had fewer accounts than we have categories.**
-- `1011101001 Piutang kartu Kredit` is a single client account covering every
-- scheme; the VISA/MasterCard split has only ever existed in our map qualifier,
-- and it is now three tender categories (`CREDIT_VISA`, `CREDIT_MASTER`, and
-- `CREDIT_CARD` for a settlement that names no scheme). Their code for all
-- three is the same one code, which `ledger_account_remap` cannot say, because
-- it is keyed on the client's code and theirs is one row. `legacy_code_span`
-- below says it instead: several of our categories, one of their accounts.
--
-- **And one case where the sign knows.** The six affiliate families became one
-- signed `1501 Rekening koran antar-unit`, which is the whole point of it: a
-- receivable from Cikupa and Cikupa's payable to us are one fact written twice,
-- and one signed account makes the mirror automatic. It also means the pair
-- (`1501`, `FINANCING`) stands for two client accounts — `1021401001 Piutang
-- Affiliasi Pembiayaan` and `2012301001 Hutang Affiliasi Pembiayaan` — and what
-- tells them apart is which side of the line the money is on. A debit is the
-- receivable, a credit is the payable. So the function takes the side, and the
-- assertion at the bottom permits an ambiguous pair only when the candidates sit
-- in different root classes, which is to say only when the sign really does
-- decide. Any other collision stops the migration.
--
-- One more limit, and it is the older one: this returns the client's TEN-digit
-- code, which is one row per meaning. Their twelve-digit leaf is that code plus
-- a two-digit unit suffix, and the mapping from their fourteen unit NAMES to
-- `00`–`13` is an ordinal-offset assumption nobody has confirmed
-- (`docs/coa-cube.md` §8). The ten digits are exact; the last two are a
-- question for the owner.

-- Where several of our categories fold back onto ONE client account. The
-- reverse direction of `ledger_account_remap`, for the rows that direction
-- cannot hold.
CREATE TABLE legacy_code_span (
    new_code      TEXT NOT NULL REFERENCES ledger_account (account_code),
    category_code TEXT NOT NULL REFERENCES line_category (category_code),
    legacy_code   TEXT NOT NULL CHECK (legacy_code ~ '^[0-9]+$'),
    PRIMARY KEY (new_code, category_code)
);

INSERT INTO legacy_code_span (new_code, category_code, legacy_code) VALUES
    ('1201', 'CREDIT_VISA',   '1011101001'),
    ('1201', 'CREDIT_MASTER', '1011101001'),
    ('1201', 'CREDIT_CARD',   '1011101001'),
    ('1201', 'DEBIT_BCA',     '1011101002'),
    ('1201', 'DEBIT_MANDIRI', '1011101002'),
    ('1201', 'DEBIT_BRI',     '1011101002'),
    ('1201', 'DEBIT_BNI',     '1011101002'),
    ('1201', 'DEBIT_CARD',    '1011101002');

CREATE FUNCTION legacy_account_code(
    account_code    TEXT,
    category_code   TEXT DEFAULT NULL,
    bank_account_id UUID DEFAULT NULL,
    is_debit        BOOLEAN DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
    found     TEXT;
    candidates INTEGER;
BEGIN
    IF bank_account_id IS NOT NULL THEN
        SELECT b.legacy_ledger_account_code INTO found
          FROM company_bank_account b WHERE b.account_id = bank_account_id;
        IF found IS NOT NULL THEN RETURN found; END IF;
    END IF;

    IF category_code IS NOT NULL THEN
        SELECT count(*) INTO candidates
          FROM ledger_account_remap r
         WHERE r.new_code = legacy_account_code.account_code
           AND r.category_code = legacy_account_code.category_code;

        IF candidates = 1 THEN
            SELECT r.legacy_code INTO found
              FROM ledger_account_remap r
             WHERE r.new_code = legacy_account_code.account_code
               AND r.category_code = legacy_account_code.category_code;
            RETURN found;
        END IF;

        -- More than one, which happens on the signed inter-unit account and
        -- nowhere else. The side decides: a debit is the client's receivable
        -- (root class 1), a credit is their payable (root class 2). Without a
        -- side we decline rather than pick.
        IF candidates > 1 AND is_debit IS NOT NULL THEN
            SELECT r.legacy_code INTO found
              FROM ledger_account_remap r
             WHERE r.new_code = legacy_account_code.account_code
               AND r.category_code = legacy_account_code.category_code
               AND left(r.legacy_code, 1) = CASE WHEN is_debit THEN '1' ELSE '2' END;
            RETURN found;
        END IF;

        -- No remap row at all for this pair: it may be one of ours that folds
        -- back onto a single client account.
        SELECT sp.legacy_code INTO found
          FROM legacy_code_span sp
         WHERE sp.new_code = legacy_account_code.account_code
           AND sp.category_code = legacy_account_code.category_code;
        IF found IS NOT NULL THEN RETURN found; END IF;

        -- Last, the category's own note of where it came from. This is not a
        -- weaker version of the remap lookup, it answers a case the remap
        -- cannot: 0287 took its values from the CLIENT's chart, which has leaves
        -- our 190 never carried — `Sewa Toko Bayar Dimuka`, `THR/Insentif/Bonus/
        -- Pesangon YMHD`, `Biaya Lubrication & Grease`. Those became categories
        -- with no retired account behind them, and their client code is the one
        -- thing that does know.
        SELECT c.legacy_code INTO found
          FROM line_category c
         WHERE c.category_code = legacy_account_code.category_code;
        RETURN found;
    END IF;

    -- No category and no bank: invertible only where exactly one client account
    -- folded in. `1102` had fourteen; `2102` had one.
    SELECT count(*) INTO candidates
      FROM ledger_account_remap r
     WHERE r.new_code = legacy_account_code.account_code
       AND r.category_code IS NULL;
    IF candidates <> 1 THEN RETURN NULL; END IF;

    SELECT r.legacy_code INTO found
      FROM ledger_account_remap r
     WHERE r.new_code = legacy_account_code.account_code
       AND r.category_code IS NULL;

    RETURN found;
END $$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION legacy_account_code(TEXT, TEXT, UUID, BOOLEAN) IS
    'The client ten-digit code a posting would have carried before the chart '
    'collapsed to forty accounts, or NULL where the new line does not determine '
    'one. See docs/finance-legacy-codes.md.';

-- A journal in the client's own numbers. One row per line, so it can be summed
-- into their trial balance or read straight across against their 2024/2025
-- general ledger.
CREATE VIEW journal_line_legacy AS
SELECT l.line_id,
       l.entry_id,
       l.account_code,
       l.category_code,
       l.site_id,
       l.debit_minor,
       l.credit_minor,
       legacy_account_code(l.account_code, l.category_code, l.bank_account_id,
                           l.debit_minor > 0) AS legacy_code
  FROM journal_line l;

DO $$
DECLARE
    invertible INTEGER;
    total      INTEGER;
    wrong      TEXT;
BEGIN
    -- Every remap row that carries a category must inverate to itself, or the
    -- bridge is decorative.
    SELECT count(*) INTO total FROM ledger_account_remap WHERE category_code IS NOT NULL;
    SELECT count(*) INTO invertible
      FROM ledger_account_remap r
     WHERE r.category_code IS NOT NULL
       AND legacy_account_code(r.new_code, r.category_code, NULL,
                               left(r.legacy_code, 1) = '1') = r.legacy_code;
    IF invertible <> total THEN
        SELECT string_agg(r.legacy_code, ', ') INTO wrong
          FROM ledger_account_remap r
         WHERE r.category_code IS NOT NULL
           AND legacy_account_code(r.new_code, r.category_code, NULL,
                                   left(r.legacy_code, 1) = '1') IS DISTINCT FROM r.legacy_code;
        RAISE EXCEPTION 'these do not read back to themselves: %', wrong;
    END IF;

    -- Everything in the span table must read back too.
    SELECT string_agg(sp.new_code || '/' || sp.category_code, ', ') INTO wrong
      FROM legacy_code_span sp
     WHERE legacy_account_code(sp.new_code, sp.category_code) IS DISTINCT FROM sp.legacy_code;
    IF wrong IS NOT NULL THEN
        RAISE EXCEPTION 'these spans do not read back: %', wrong;
    END IF;

    -- Every category that remembers a client code must read back to exactly
    -- that code. The ones with no client code behind them — a tender, a cash
    -- pot, a reason for an inter-unit balance — are distinctions the client's
    -- chart never drew, and NULL is the truthful answer for those.
    SELECT string_agg(c.category_code, ', ') INTO wrong
      FROM line_category c
      JOIN ledger_account a ON a.category_family = c.family AND a.is_active
     WHERE c.legacy_code IS NOT NULL
       AND legacy_account_code(a.account_code, c.category_code, NULL, TRUE) IS DISTINCT FROM c.legacy_code
       -- a category whose own account retired into a DIFFERENT one of the forty
       -- is answered by the remap, which the first assertion already covered
       AND NOT EXISTS (SELECT 1 FROM ledger_account_remap r
                        WHERE r.category_code = c.category_code);
    IF wrong IS NOT NULL THEN
        RAISE EXCEPTION 'these categories do not read back to their client code: %', wrong;
    END IF;

    -- And no (new account, category) pair may stand for two client accounts,
    -- because then the bridge would have to choose one and would be wrong half
    -- the time.
    SELECT string_agg(new_code || '/' || category_code, ', ') INTO wrong FROM (
        SELECT new_code, category_code FROM ledger_account_remap
         WHERE category_code IS NOT NULL
         GROUP BY 1, 2
        HAVING count(*) > 1
           -- permitted only when the side decides, which is the signed
           -- inter-unit account and is meant to be
           AND count(DISTINCT left(legacy_code, 1)) <> count(*)
    ) d;
    IF wrong IS NOT NULL THEN
        RAISE EXCEPTION
            'these pairs stand for more than one client account and the sign '
            'does not tell them apart: %', wrong;
    END IF;
END $$;
