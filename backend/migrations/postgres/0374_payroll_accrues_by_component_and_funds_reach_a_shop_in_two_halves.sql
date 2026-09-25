-- 0374: Finance Connect stage 3 — payroll accrues by component, and head
-- office's money reaches a shop in two halves.
--
-- Client accountant and owner, 25 Sep (FINANCE-CONNECT-BRIEF.md):
--   * Payroll month end: Dr each component's expense (store 6012-6024, head
--     office and DC 6026-6038) / Cr 2017 Biaya Gaji dan Upah YMHD; PPh 21
--     withheld to 2011; THR accrued monthly to 2018. Paid on the 1st: Dr 2017
--     / Cr petty cash at a store, Cr bank at head office.
--   * Head office -> unit money: HO Dr 1057 / Cr bank (sent), unit Dr 1003
--     Petty Cash / Cr 2028 (received). 1023 is for cash shortages only.
--   * Medical claims are owed on 2020 Biaya Pengobatan YMHD; other employee
--     claims on 2031 Hutang Lain-Lain (owner HR decision 5, which supersedes
--     0372's 2049 for the liability).

ALTER TABLE operating_fund
    ADD COLUMN received_at timestamptz,
    ADD COLUMN received_by text,
    ADD COLUMN received_on date,
    ADD COLUMN receipt_entry_id uuid REFERENCES journal_entry (entry_id),
    ADD CONSTRAINT operating_fund_received_together
        CHECK ((received_at IS NULL) = (receipt_entry_id IS NULL));

COMMENT ON COLUMN operating_fund.received_at IS
    'When the shop confirmed the transfer into its petty cash (the unit half: Dr 1003 / Cr 2028). Until then the HO half (Dr 1057 / Cr bank) is money in transit.';

-- Funds sent before this migration were booked in one entry on 1023; they
-- are treated as received so their settlements keep working.
UPDATE operating_fund
   SET received_at = sent_at, received_by = sent_by, received_on = value_date,
       receipt_entry_id = journal_entry_id
 WHERE received_at IS NULL;

WITH maps(semantic_key, qualifier, account_code, note) AS (
    VALUES
        ('thr_payable',            '',        '2018', 'THR/Insentif/Bonus/Pesangon YMHD; monthly THR accrual'),
        ('severance_payable',      '',        '2018', 'THR/Insentif/Bonus/Pesangon YMHD; severance on an approved exit'),
        ('employee_claim_payable', '',        '2031', 'Owner HR decision 5: non-medical claims owed on Hutang Lain-Lain'),
        ('employee_claim_payable', 'MEDICAL', '2020', 'Owner HR decision 5: medical claims owed on Biaya Pengobatan YMHD')
)
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT maps.semantic_key, site.id, maps.qualifier, maps.account_code, NULL,
       'migration:0374', maps.note
  FROM maps CROSS JOIN site
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
    SET account_code = EXCLUDED.account_code, category_code = NULL,
        set_by = EXCLUDED.set_by, set_at = now(), note = EXCLUDED.note;

DO $$
DECLARE
    bad bigint;
BEGIN
    SELECT count(*) INTO bad
      FROM account_map mapping
      JOIN ledger_account account USING (account_code)
     WHERE mapping.set_by = 'migration:0374'
       AND (NOT account.is_active OR account.is_group);
    IF bad <> 0 THEN
        RAISE EXCEPTION '0374 installed % mappings that do not resolve to active leaves', bad;
    END IF;
END;
$$;
