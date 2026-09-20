-- A voucher is a promise the books can see.
--
-- # What was wrong
--
-- `2401 Kewajiban voucher & uang muka penjualan` — the client's `65 Uang Muka
-- Penjualan` — only ever moved ONE way. The day's takings debit it when a
-- shopper settles a basket with a card (`sales_posting` maps the VOUCHER tender
-- to `voucher_liability`), but nothing ever credited it: `issue_voucher` wrote
-- the card, its movement and its balance, and no journal. So the account drifted
-- ever more negative — red in the direction that says the company owes *less*
-- than nothing — and the only reason a trial balance did not scream was that
-- nothing had ever asked the question.
--
-- # What this migration does, and what it deliberately does NOT
--
-- It maps, and it adds one name. **It creates no account.** The estate is
-- moving to the client's own chart, and the rules can already speak it: a
-- voucher's liability is `65`, a giveaway is `74 Biaya Promosi`, advertising is
-- `76`, a discount is `47`, a return is `49`, COGS is `45` against `61
-- Persediaan`. Not one of those needs a new code, so not one is added here, and
-- the check at the bottom counts the forty to prove it.
--
-- 1. **`voucher_liability` is mapped for every site** — `2401` (the client's
--    `65`), qualified `VOUCHER_LIABILITY`, the category 0290 gave the remap row
--    for `2012305001 Hutang Voucher`. 0290 remapped the map rows it found, but
--    the seed could only write this one once 0275 made the account real, so a
--    site commissioned before that has no row and would refuse with "set it on
--    the Account Map screen" for a decision already made. The guard is
--    `NOT EXISTS`, so a site that has the row keeps it.
--
-- 2. **Two names the expense rules need, on accounts the chart already has.**
--    `74 Biaya Promosi` and `76 Biaya Advertising / Iklan` are the SAME `6101
--    Beban penjualan` carrying two categories (0287/0289). What was missing was
--    something a posting rule can ask for, which is what `marketing_expense`
--    and `advertising_expense` are: a giveaway voucher, a campaign's agency fee
--    and a billboard are now one ask each.
--
-- 3. **No points account is touched and no loyalty source kind is added.** The
--    client keeps a loyalty obligation on `66 Hutang Lain-lain`, and 0264 left
--    that account unresolved in the forty-account shape in as many words: *"it
--    needs its own decision"*. Minting a liability for it here would be the
--    addition this migration exists not to make, and booking points to a
--    related-party payable would be wrong in a way that balances. So a points
--    redemption posts nothing — what 0297 said it does — and the trial balance
--    stays silent about a promise nobody has priced.
--
-- 4. **One source kind is added**: `VOUCHER_ISSUE`, for the entry item 1 makes
--    possible. Restated in full rather than appended to, for the reason 0257
--    learned: a DROP-and-ADD constraint two lanes both touch loses whichever
-- The map. `2401` is the client's `65`; the category is the one 0290 read off
-- `ledger_account_remap` for `2012305001 Hutang Voucher`.
INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT 'voucher_liability', s.id, '', '2401', 'VOUCHER_LIABILITY', 'migration 0298',
       'the client''s 65 Uang Muka Penjualan; mapped so issuing and redeeming a card both post'
  FROM site s
 WHERE NOT EXISTS (
           SELECT 1 FROM account_map m
            WHERE m.semantic_key = 'voucher_liability' AND m.site_id = s.id AND m.qualifier = ''
       );

-- `74 Biaya Promosi`, on the account the chart already files it under.
INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT 'marketing_expense', s.id, '', '6101', 'BIAYA_PROMOSI', 'migration 0298',
       'the client''s 74 Biaya Promosi: giveaway vouchers, sampling, activation'
  FROM site s
 WHERE NOT EXISTS (
           SELECT 1 FROM account_map m
            WHERE m.semantic_key = 'marketing_expense' AND m.site_id = s.id AND m.qualifier = ''
       );

-- `76 Biaya Advertising / Iklan`, the same account, the other category.
INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT 'advertising_expense', s.id, '', '6101', 'BIAYA_ADVERTISING_IKLAN', 'migration 0298',
       'the client''s 76 Biaya Advertising / Iklan: media placement, billboards, digital'
  FROM site s
 WHERE NOT EXISTS (
           SELECT 1 FROM account_map m
ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
        'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPOSIT', 'DEPRECIATION',
        'EQUITY_MOVEMENT', 'GIRO', 'GOODS_RECEIPT', 'INTERUNIT_SETTLE',
        'LANDED_COST', 'MANUAL', 'OPENING', 'PAYMENT', 'PAYROLL_RUN',
        'PETTY_REPLENISH', 'PREPAID_ALLOCATION', 'RECLASS', 'REMITTANCE',
        'RETENDER', 'REVERSAL', 'SALE_DAY', 'STOCK_COUNT', 'STORE_DEPOSIT',
        'STORE_EXPENSE', 'SUPPLIER_ADVANCE', 'SUPPLIER_INVOICE',
        'TAX_SETTLEMENT', 'TRANSFER', 'VOUCHER_ISSUE', 'WRITE_OFF'
    ));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. EQUITY_MOVEMENT is an owner putting capital in,
     taking drawings out, lending to the company or being repaid — see 0284.
     VOUCHER_ISSUE is a card being written: the credit is the client''s 65 and
     the debit is where the money behind it came from — cash for a gift card, a
     return for a refund card, 74 Biaya Promosi for a giveaway. See 0298.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM site s
                WHERE NOT EXISTS (SELECT 1 FROM account_map m
                                   WHERE m.semantic_key = 'voucher_liability'
                                     AND m.site_id = s.id AND m.qualifier = '')) THEN
        RAISE EXCEPTION 'a site has no voucher_liability mapping';
    END IF;
    IF EXISTS (SELECT 1 FROM site s
                WHERE NOT EXISTS (SELECT 1 FROM account_map m
                                   WHERE m.semantic_key = 'marketing_expense'
                                     AND m.site_id = s.id AND m.qualifier = '')) THEN
        RAISE EXCEPTION 'a site has no marketing_expense mapping';
    END IF;
    IF EXISTS (SELECT 1 FROM site s
                WHERE NOT EXISTS (SELECT 1 FROM account_map m
                                   WHERE m.semantic_key = 'advertising_expense'
                                     AND m.site_id = s.id AND m.qualifier = '')) THEN
        RAISE EXCEPTION 'a site has no advertising_expense mapping';
    END IF;
    -- The count is the client's, unchanged. This migration NAMES accounts; it
    -- does not mint them, and a wrong turn that added one would otherwise be
    -- invisible until the estate reconciled against the chart.
    IF (SELECT count(*) FROM ledger_account WHERE NOT is_group AND is_active) <> 40 THEN
        RAISE EXCEPTION 'this migration must leave the forty postable accounts exactly as it found them';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'journal_entry_source_kind_check'
                      AND pg_get_constraintdef(oid) LIKE '%VOUCHER_ISSUE%') THEN
        RAISE EXCEPTION 'VOUCHER_ISSUE is not allowed as a source kind';
    END IF;
END $$;
            WHERE m.semantic_key = 'advertising_expense' AND m.site_id = s.id AND m.qualifier = ''
       );
--    half merged second, silently.