-- The client sells under nine more names than our chart kept.
--
-- Their chart splits revenue by TENDER, and the card tenders by acquiring bank
-- and by scheme:
--
--     4010110001  Penjualan Tunai                      (we kept this one)
--     4010111001  Penjualan Debit Card Bank BCA
--     4010111002  Penjualan Debit Card Bank Mandiri
--     4010111003  Penjualan Debit Card Bank BRI
--     4010111004  Penjualan Debit Card Bank BNI
--     4010112001  Penjualan Kartu Kredit VISA Card
--     4010112002  Penjualan Kartu Kredit Master Card
--     4010113001  Penjualan  Online Sendiri
--     4010113002  Penjualan  Online Market Place
--
-- The collapse of 0243/0244 kept one revenue meaning and dropped the rest, so
-- every sale this system has posted — Rp 3,297,168,037 across 1,248 entries —
-- credits `Penjualan Tunai`, including every card and QRIS sale. These nine are
-- the client's own accounts and their absence is ours. Names and spacing are
-- theirs verbatim, double spaces included.
--
-- # What this migration does NOT do
--
-- It does not re-point anything. The rule in `sale_day.rs` splits a day's
-- credit per tender only when `revenue` is bound for EVERY tender the day took,
-- all or nothing, and binding the card tenders is not yet possible honestly:
-- `sale_payment.acquirer` and `sale_payment.card_kind` are empty on all 14,628
-- card and QRIS payments, so the till does not know which bank acquired a
-- card, or even whether it was debit or credit. Choosing `Bank BCA` for a
-- payment nobody recorded a bank for would invent the data instead of the
-- account, which is the same offence one step along.
--
-- So the accounts come back now and stand unbound. They can be bound the day
-- the till records an acquirer, and not before.
--
-- QRIS, when that day comes, belongs with the DEBIT family: the money leaves
-- the payer's account at once and the acquirer settles T+1 net of a fee, which
-- is a debit card's behaviour and not a credit card's. That is also where its
-- receivable already sits (`1011101002 Piutang Debit Card`), so both halves of
-- a QRIS sale would agree. The client's chart has no QRIS account of its own —
-- it predates QRIS — and that remains a question for them rather than a gap for
-- us to fill.

BEGIN;

CREATE TEMP TABLE before_book ON COMMIT DROP AS
SELECT SUM(debit_minor) AS d, SUM(credit_minor) AS c FROM journal_line;

-- The two rungs these hang from, in the client's own words. `40101 PENJUALAN`
-- already exists; `4010111`, `4010112` and `4010113` do not.
INSERT INTO ledger_account (account_code, name, parent_code, is_group, is_active, dimension)
VALUES
    ('4010111', 'Penjualan  Kartu Debit',  '40101', true, true, NULL),
    ('4010112', 'Penjualan  Kartu Kredit', '40101', true, true, NULL),
    ('4010113', 'Penjualan  Online',       '40101', true, true, NULL)
ON CONFLICT (account_code) DO NOTHING;

INSERT INTO ledger_account (account_code, name, parent_code, is_group, is_active, dimension)
VALUES
    ('4010111001', 'Penjualan Debit Card Bank BCA',     '4010111', false, true, 'unit'),
    ('4010111002', 'Penjualan Debit Card Bank Mandiri', '4010111', false, true, 'unit'),
    ('4010111003', 'Penjualan Debit Card Bank BRI',     '4010111', false, true, 'unit'),
    ('4010111004', 'Penjualan Debit Card Bank BNI',     '4010111', false, true, 'unit'),
    ('4010112001', 'Penjualan Kartu Kredit VISA Card',  '4010112', false, true, 'unit'),
    ('4010112002', 'Penjualan Kartu Kredit Master Card','4010112', false, true, 'unit'),
    ('4010113001', 'Penjualan  Online Sendiri',         '4010113', false, true, 'unit'),
    ('4010113002', 'Penjualan  Online Market Place',    '4010113', false, true, 'unit')
ON CONFLICT (account_code) DO NOTHING;

DO $$
DECLARE n bigint;
BEGIN
    -- Nothing was posted, so nothing may have moved.
    SELECT count(*) INTO n FROM before_book b,
         (SELECT SUM(debit_minor) d, SUM(credit_minor) c FROM journal_line) a
     WHERE b.d <> a.d OR b.c <> a.c;
    IF n > 0 THEN RAISE EXCEPTION 'adding accounts moved money, which is impossible'; END IF;

    -- All nine are here, and on their own rungs.
    SELECT count(*) INTO n FROM ledger_account
     WHERE account_code IN ('4010111001','4010111002','4010111003','4010111004',
                            '4010112001','4010112002','4010113001','4010113002');
    IF n <> 8 THEN RAISE EXCEPTION 'expected the eight card and online postings, found %', n; END IF;

    SELECT count(*) INTO n FROM ledger_account
     WHERE account_code LIKE '40101__' AND is_group AND length(account_code) = 7;
    IF n <> 4 THEN RAISE EXCEPTION 'expected four seven-digit revenue rungs, found %', n; END IF;

    -- Unbound, deliberately. Binding them needs an acquirer the till does not
    -- record; see this file's header.
    SELECT count(*) INTO n FROM account_map
     WHERE account_code LIKE '401011[123]%';
    IF n > 0 THEN RAISE EXCEPTION '% revenue bindings exist that this migration did not expect', n; END IF;
END $$;

COMMIT;
