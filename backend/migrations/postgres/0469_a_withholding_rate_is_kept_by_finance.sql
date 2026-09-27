-- 0469: a withholding rate is kept by Finance.
--
-- Stage 5 of "Desain Fondasi Finance Dinamis", ERPNext's Tax Withholding
-- Category. What a payment keeps back from a supplier — the code, the rate,
-- whether it is final, and the payable it is owed on — was four constants in
-- `domain/withholding.rs` and a CHECK. Now it is `tax_template`, master data
-- Finance edits, and the payable is an account link (role
-- `withholding_payable`, source `TAX_TEMPLATE`).
--
-- Owner decision 27 Sep: tax follows the client's own accounts only. The
-- client has PPh 23 (2012) and no PPh 4(2) account, so the company does not
-- withhold PPh 4(2); the three PPh 23 templates are seeded and 4(2) is not. If
-- it is ever needed, Finance adds the account and the template from the screen.

CREATE TABLE tax_template (
    code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    -- WITHHOLDING: kept back from a supplier at payment.
    kind        text NOT NULL DEFAULT 'WITHHOLDING' CHECK (kind IN ('WITHHOLDING')),
    rate_bps    integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
    -- Final for the supplier (PPh 4(2)) or creditable (PPh 23). Two templates
    -- with different finality never share one payment.
    is_final    boolean NOT NULL DEFAULT false,
    is_active   boolean NOT NULL DEFAULT true,
    note        text,
    created_by  text NOT NULL DEFAULT 'system',
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tax_template IS
    'ERPNext Tax Withholding Category (0469): what a supplier payment keeps back, at what rate. The payable is an account_link with role withholding_payable and source TAX_TEMPLATE.';

INSERT INTO tax_template (code, name, rate_bps, is_final, created_by) VALUES
    ('PPH23_SERVICE',        'PPh 23 — jasa (2%)',                     200,  false, 'migration:0469'),
    ('PPH23_RENT_EQUIPMENT', 'PPh 23 — sewa kendaraan & peralatan (2%)', 200,  false, 'migration:0469'),
    ('PPH23_ROYALTY',        'PPh 23 — royalti & lisensi (15%)',        1500, false, 'migration:0469');

INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_site_kind, scope_site_id, account_code,
     set_by, note)
SELECT 'withholding_payable', 'TAX_TEMPLATE', t.code, l.scope_type, l.scope_site_kind,
       l.scope_site_id, l.account_code, 'migration:0469', 'from pph23_payable'
  FROM tax_template t
  JOIN account_link l ON l.role = 'pph23_payable' AND l.source_type = 'COMPANY' AND l.source_id = '';

INSERT INTO posting_role (role, allowed_account_types, note)
VALUES ('withholding_payable', ARRAY['TAX'], 'tax kept back from a supplier payment (0469)')
ON CONFLICT (role) DO NOTHING;

-- A bill names a template; a payment names the template it withheld under.
ALTER TABLE supplier_invoice DROP CONSTRAINT IF EXISTS supplier_invoice_withholding_code_check;
DO $$
DECLARE
    name text;
BEGIN
    FOR name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'supplier_invoice'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%PPH23_SERVICE%'
    LOOP
        EXECUTE format('ALTER TABLE supplier_invoice DROP CONSTRAINT %I', name);
    END LOOP;
    FOR name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'supplier_payment'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%pph_final_payable%'
    LOOP
        EXECUTE format('ALTER TABLE supplier_payment DROP CONSTRAINT %I', name);
    END LOOP;
END
$$;

UPDATE supplier_invoice SET withholding_code = NULL WHERE withholding_code = 'PPH42_RENT_PROPERTY';
ALTER TABLE supplier_invoice
    ADD CONSTRAINT supplier_invoice_withholding_template_fkey
        FOREIGN KEY (withholding_code) REFERENCES tax_template (code);

-- `withholding_key` named the payable role; it names the template now. No
-- payment carries one yet, and a template code is what the certificate quotes.
UPDATE supplier_payment SET withholding_key = 'PPH23_SERVICE'
 WHERE withholding_key = 'pph23_payable';
ALTER TABLE supplier_payment
    ADD CONSTRAINT supplier_payment_withholding_template_fkey
        FOREIGN KEY (withholding_key) REFERENCES tax_template (code);
