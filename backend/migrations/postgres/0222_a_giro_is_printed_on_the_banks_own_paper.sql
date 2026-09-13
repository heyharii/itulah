-- 0222: A giro is printed on the bank's own paper.
--
-- # What is being printed, and what is not
--
-- A bilyet giro is not a document we produce. It is a leaf torn from a booklet
-- the bank issued, already carrying its own number, the bank's name and the
-- account it draws on. What a printer adds is the handful of variable facts,
-- and the whole problem is putting them where the pre-printed boxes are.
--
-- So this is not a document template. It is a set of COORDINATES, one per bank,
-- because BCA's leaf and Mandiri's put the payee line in different places and a
-- giro whose amount lands across a rule is a giro the counter rejects.
--
-- ERPNext models cheque printing exactly this way — its `Cheque Print Template`
-- is offsets in centimetres, with an optional scan of the leaf as a backdrop to
-- calibrate against. Two things are ours rather than theirs:
--
--   * millimetres, not centimetres. Calibration happens in the last two
--     millimetres, and a field that can only be moved in 0.1cm steps is a field
--     somebody rounds.
--   * the payee's BANK and ACCOUNT NUMBER are printed. ERPNext prints the
--     drawer's own account number, which is right for a cheque and wrong here:
--     a giro is an order to move money INTO a named account, so the account it
--     moves into is on the face of it. (Their template also prints
--     `doc.account_no`, a field Payment Entry does not have — so that line comes
--     out blank in ERPNext today.)
--
-- # Why the placements are rows and not columns
--
-- Nine fields today, each needing an x and a y, some a width and a line height.
-- As columns that is twenty-odd, and the tenth field is a migration. As rows it
-- is a list with a CHECK naming what may be placed, and the tenth field is an
-- INSERT. The same reason `payment_terms_template` keeps its instalments in
-- `payment_terms_template_line` rather than in `term_1_days`, `term_2_days`.
--
-- # One template per bank, not per site
--
-- Giro is written at the head office — the owner's rule of 2026-09-07
-- centralised outgoing money — so a per-site template would be a column with
-- one value in it. When a store is given its own booklet, this grows a
-- `site_id` and the unique index below grows with it.

CREATE TABLE giro_print_template (
    template_id      uuid PRIMARY KEY,

    -- WHICH of our banks this booklet is from, spelled the way `account_map`
    -- spells it: the qualifier on `bank_giro`. Not a foreign key, for the same
    -- reason `supplier.expense_account_code` is not one — the map is loaded per
    -- node, and a bank whose account has not been mapped yet is still a bank
    -- whose paper somebody is holding.
    bank_qualifier   text NOT NULL CHECK (btrim(bank_qualifier) <> ''),
    label            text NOT NULL CHECK (btrim(label) <> ''),

    -- The leaf, in millimetres. Defaults are a common Indonesian bilyet giro;
    -- every bank differs and this is measured, not assumed.
    --
    -- `double precision`, and it is the only place in this schema that holds a
    -- fractional number. Money here is always a bigint of minor units, for the
    -- reason every ledger does that — but a millimetre offset is a measurement,
    -- never summed and never compared for equality. It is read, drawn, and
    -- written back by somebody nudging a field two millimetres left.
    width_mm         double precision NOT NULL DEFAULT 190.00 CHECK (width_mm  BETWEEN 50 AND 420),
    height_mm        double precision NOT NULL DEFAULT 95.00  CHECK (height_mm BETWEEN 50 AND 420),

    -- How far down the sheet the leaf itself starts, for the operator who feeds
    -- an A4 carrier rather than the leaf alone.
    top_offset_mm    double precision NOT NULL DEFAULT 0 CHECK (top_offset_mm BETWEEN 0 AND 420),
    left_offset_mm   double precision NOT NULL DEFAULT 0 CHECK (left_offset_mm BETWEEN 0 AND 420),

    -- A photograph or scan of a blank leaf, shown UNDER the fields while
    -- somebody calibrates and never printed. Calibrating against a remembered
    -- layout is how a field ends up two millimetres into a rule.
    backdrop_url     text CHECK (backdrop_url IS NULL OR btrim(backdrop_url) <> ''),

    retired_at       timestamptz,

    version          integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by       text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One live template per bank. A second one is not a variant, it is the state
-- where two people calibrated separately and nobody knows which printed.
CREATE UNIQUE INDEX ux_giro_print_template_bank
    ON giro_print_template (bank_qualifier)
    WHERE retired_at IS NULL;

CREATE TABLE giro_print_field (
    template_id  uuid NOT NULL REFERENCES giro_print_template(template_id) ON DELETE CASCADE,

    -- What may be placed. The list is short and closed on purpose: a template
    -- that can place an arbitrary string is a template somebody uses to print
    -- something the bank did not ask for.
    --
    --   PLACE_DATE      "Jambi, 13 September 2026" — where and when it was drawn
    --   ISSUED_ON       tanggal penarikan, on its own if the leaf boxes it
    --   EFFECTIVE_ON    tanggal efektif. The field that makes it a giro
    --   PAYEE           nama penerima
    --   PAYEE_BANK      bank penerima, and the branch if the leaf asks
    --   PAYEE_ACCOUNT   nomor rekening penerima
    --   AMOUNT_FIGURES  the number
    --   AMOUNT_WORDS    terbilang, which wraps — hence width and line height
    --   NOTE            berita/keterangan, where a leaf has one
    field_code   text NOT NULL CHECK (field_code IN
                     ('PLACE_DATE', 'ISSUED_ON', 'EFFECTIVE_ON', 'PAYEE',
                      'PAYEE_BANK', 'PAYEE_ACCOUNT', 'AMOUNT_FIGURES',
                      'AMOUNT_WORDS', 'NOTE')),

    -- From the leaf's own top-left corner, not the sheet's. Moving the leaf
    -- moves every field with it, which is what `top_offset_mm` is for.
    x_mm         double precision NOT NULL CHECK (x_mm BETWEEN 0 AND 420),
    y_mm         double precision NOT NULL CHECK (y_mm BETWEEN 0 AND 420),

    -- Only the wrapping ones need these. NULL means "as wide as it needs".
    width_mm     double precision CHECK (width_mm IS NULL OR width_mm BETWEEN 5 AND 420),
    line_mm      double precision CHECK (line_mm IS NULL OR line_mm BETWEEN 2 AND 40),

    font_pt      double precision NOT NULL DEFAULT 9.0 CHECK (font_pt BETWEEN 4 AND 24),
    uppercase    boolean NOT NULL DEFAULT false,

    PRIMARY KEY (template_id, field_code)
);
