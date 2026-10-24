-- 0989: a shop's EDC says what it takes and where each kind lands.
--
-- Owner, 24 Oct 2026 (the client's review of the POS): head office sets, per
-- shop and per bank, the EDC machines the counter has — whether each takes
-- debit cards, credit cards and the bank's QRIS — and which Cash In Bank
-- account each of those settles to. The till's Bayar then offers exactly that
-- shop's machines.
--
-- Nothing new is invented for it:
--
--   * `edc_terminal` (0373) already is "a bank's machine at a shop". It learns
--     what it takes and, per kind, the account the money lands in. One machine
--     per shop and bank is what head office sets; extra terminal ids of the
--     same bank (registered for QRIS lookups) are the same machine and are
--     kept in step by the screen.
--   * The shop's card and QRIS methods (`payment_method_site`, 0474) are read
--     off its machines from now on, so the existing `payment.methods.replace`
--     carries the machines to the shop's node and its tills unchanged.
--   * The day posting debits the machine's account for the kind when it names
--     one; a machine with no account keeps today's `bank_giro` link by bank.
--
-- Points (the member's points paid at the till) become a method a shop can be
-- given or not, like the employee balance (0819): accepted at every shop, so
-- no till loses its Poin row when this lands.

ALTER TABLE edc_terminal
    ADD COLUMN takes_debit    boolean NOT NULL DEFAULT false,
    ADD COLUMN takes_credit   boolean NOT NULL DEFAULT false,
    ADD COLUMN takes_qris     boolean NOT NULL DEFAULT false,
    ADD COLUMN debit_account  text REFERENCES ledger_account (account_code),
    ADD COLUMN credit_account text REFERENCES ledger_account (account_code),
    ADD COLUMN qris_account   text REFERENCES ledger_account (account_code);

COMMENT ON COLUMN edc_terminal.debit_account IS
    'The Cash In Bank account a debit card taken on this machine lands in (0989). NULL: the bank_giro link of the machine''s bank.';
COMMENT ON COLUMN edc_terminal.credit_account IS
    'The Cash In Bank account a credit card taken on this machine lands in (0989). NULL: the bank_giro link of the machine''s bank.';
COMMENT ON COLUMN edc_terminal.qris_account IS
    'The Cash In Bank account a QRIS payment on this machine lands in (0989). NULL: the bank_giro link of the machine''s bank.';

-- The terminals registered so far: what their shop takes through their bank
-- today. One registered only so a QRIS could find its bank takes QRIS.
UPDATE edc_terminal e
   SET takes_debit = EXISTS (
           SELECT 1 FROM payment_method_site ps JOIN payment_method p ON p.code = ps.method_code
            WHERE ps.site_id = e.site_id AND p.is_active AND upper(p.bank_code) = e.bank_code
              AND p.tender_type = 'DEBIT_CARD'),
       takes_credit = EXISTS (
           SELECT 1 FROM payment_method_site ps JOIN payment_method p ON p.code = ps.method_code
            WHERE ps.site_id = e.site_id AND p.is_active AND upper(p.bank_code) = e.bank_code
              AND p.tender_type = 'CREDIT_CARD'),
       takes_qris = EXISTS (
           SELECT 1 FROM payment_method_site ps JOIN payment_method p ON p.code = ps.method_code
            WHERE ps.site_id = e.site_id AND p.is_active AND upper(p.bank_code) = e.bank_code
              AND p.tender_type = 'QRIS');

UPDATE edc_terminal
   SET takes_qris = true
 WHERE NOT (takes_debit OR takes_credit OR takes_qris);

-- Every shop and bank whose cards or QRIS the shop takes today, and that has
-- no terminal yet, gets its machine — so the screen shows what the tills
-- already offer, and the first change to a shop changes nothing else.
INSERT INTO edc_terminal
    (site_id, terminal_id, bank_code, label, active, created_by,
     takes_debit, takes_credit, takes_qris)
SELECT ps.site_id, b.code, b.code,
       'EDC ' || max(regexp_replace(b.name, '^Bank\s+', '')),
       true, 'migration:0989',
       bool_or(p.tender_type = 'DEBIT_CARD'),
       bool_or(p.tender_type = 'CREDIT_CARD'),
       bool_or(p.tender_type = 'QRIS')
  FROM payment_method_site ps
  JOIN payment_method p ON p.code = ps.method_code
  -- A bank of the register: a credit method kept per card scheme (VISA,
  -- MASTER) is not a machine.
  JOIN bank b ON b.code = upper(p.bank_code) AND b.active
  -- Only where a till sells: head office's own site took every method in
  -- 0474 too, and has no counter.
  JOIN site s ON s.id = ps.site_id AND s.kind IN ('STORE', 'SHOP')
 WHERE p.is_active
   AND p.tender_type IN ('DEBIT_CARD', 'CREDIT_CARD', 'QRIS')
   AND NOT EXISTS (SELECT 1 FROM edc_terminal e
                    WHERE e.site_id = ps.site_id AND e.bank_code = b.code AND e.active)
 GROUP BY ps.site_id, b.code
ON CONFLICT (site_id, terminal_id) DO UPDATE
   SET active = true,
       bank_code = EXCLUDED.bank_code,
       takes_debit = EXCLUDED.takes_debit,
       takes_credit = EXCLUDED.takes_credit,
       takes_qris = EXCLUDED.takes_qris;

ALTER TABLE edc_terminal
    ADD CONSTRAINT edc_terminal_takes_something
        CHECK (NOT active OR takes_debit OR takes_credit OR takes_qris);

CREATE INDEX ix_edc_terminal_site_bank ON edc_terminal (site_id, bank_code) WHERE active;

-- Points: a method the till's Poin row follows, at every shop to begin with.
-- A point pays one rupiah, as the member app redeems it.
WITH made AS (
    INSERT INTO payment_method
        (code, name, tender_type, bank_code, settlement_mode, point_value_minor, created_by)
    SELECT 'POINTS', 'Poin', 'POINTS', '', 'NONE', 1, 'migration:0989'
     WHERE NOT EXISTS (SELECT 1 FROM payment_method WHERE tender_type = 'POINTS')
    ON CONFLICT DO NOTHING
    RETURNING code
)
INSERT INTO payment_method_site (method_code, site_id, set_by)
SELECT made.code, s.id, 'migration:0989'
  FROM made CROSS JOIN site s
ON CONFLICT DO NOTHING;
