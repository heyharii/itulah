-- 0111: A shop's takings on their way to the bank, and never nowhere.
--
-- # The hole
--
-- Every bank account in this business belongs to head office. Cash sitting in
-- a shop is head office's money on deposit with that shop, and the only two
-- honest things that can happen to it are: it goes to an HO bank account, or it
-- is paid out on HO's written order (0112). There was no document for either.
--
-- Without a deposit document the money makes an untracked jump. `Cash on Hand
-- C007` is credited on the day the shop hands a bag to a courier and `Cash In
-- Bank Giro HO` is debited on the day the bank posts it — usually a different
-- day, sometimes several. In between, the amount is in neither account and in
-- no report, and if the bag never arrives nothing in the books notices. That
-- gap is where cash goes missing in every retail chain that has lost cash.
--
-- # Cash in transit is an account, not a report
--
-- So there are two postings, not one:
--
--   DEPOSITED   Dr cash_in_transit (shop)  / Cr cash (shop)
--   CONFIRMED   Dr bank (HO, qualified)    / Cr cash_in_transit (shop)
--
-- Between them the money has a name and an owner. `cash_in_transit` per site is
-- the answer to "what is out of our hands right now", and a deposit that stays
-- in transit for four days is a row on a screen rather than a discovery.
--
-- The client's chart has no such account — the nearest thing is `Barang Dalam
-- Perjalanan`, which is goods — so `1011005001` is PROPOSED, under the unused
-- `1011005` rung of `10110 KAS & SETARA KAS`, beside CASH ON HAND, CASH IN BANK
-- GIRO, CASH IN BANK TABUNGAN and TIME DEPOSIT. It is created by the seed, not
-- by this migration: the chart is imported from the client's own export
-- (`scripts/import-coa.py`), and a migration that invented accounts would be a
-- second author of a document the client owns.
--
-- # Why the second posting is cross-site
--
-- Because that is where the money actually is. The credit is the shop's cash in
-- transit; the debit is head office's bank. The entry balances in total and not
-- per location, which is exactly what an inter-unit balance is for — and this
-- lane deliberately does NOT write the affiliate legs itself. One rule, inside
-- the poster, is the only way they can be guaranteed to exist on every
-- cross-site entry rather than on the ones somebody remembered.

-- Where a shop's cash goes by default.
--
-- A shop banks with whoever is nearest, and the person preparing a deposit
-- should not be choosing between fourteen HO bank accounts on a screen at six
-- in the evening. One row per shop, and the deposit inherits it.
--
-- Said as a meaning plus a qualifier, never as a client account code — the same
-- rule `supplier_payment` follows and for the same reason: a code stored here
-- is a second copy of `account_map`, and it still names last year's BCA
-- account the day Finance moves it.
CREATE TABLE store_bank_destination (
    site_id        text PRIMARY KEY REFERENCES site(id),
    bank_key       text NOT NULL CHECK (bank_key IN ('bank_giro', 'bank_savings')),
    bank_qualifier text NOT NULL CHECK (btrim(bank_qualifier) <> ''),
    set_by         text NOT NULL,
    set_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE store_bank_destination IS
    'Which HO bank account a shop''s takings go to by default. A meaning and a '
    'qualifier, resolved through account_map at posting time.';

CREATE TABLE store_deposit (
    deposit_id     uuid PRIMARY KEY,
    -- `SB-26-09-00001`. Setoran bank: the shop's own reference, written on the
    -- slip that goes in the bag.
    deposit_number text NOT NULL UNIQUE CHECK (btrim(deposit_number) <> ''),

    site_id        text NOT NULL REFERENCES site(id),
    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    currency       char(3) NOT NULL DEFAULT 'IDR',

    -- Which HO account this is going to. Copied from `store_bank_destination`
    -- when the deposit is prepared, and copied on purpose: a deposit already in
    -- transit must not change destination because somebody edited a default.
    bank_key       text NOT NULL CHECK (bank_key IN ('bank_giro', 'bank_savings')),
    bank_qualifier text NOT NULL CHECK (btrim(bank_qualifier) <> ''),

    -- PREPARED   counted and bagged, still in the shop
    -- DEPOSITED  handed over; out of the shop's cash, in transit
    -- CONFIRMED  the bank agrees; in HO's account
    -- CANCELLED  never left. Only from PREPARED, because after that there is
    --            an entry in the books and the way back is a reversal, not a
    --            status.
    status         text NOT NULL
                   CHECK (status IN ('PREPARED', 'DEPOSITED', 'CONFIRMED', 'CANCELLED')),

    prepared_by    text NOT NULL CHECK (btrim(prepared_by) <> ''),
    prepared_at    timestamptz NOT NULL DEFAULT now(),
    deposit_date   date NOT NULL,

    deposited_by   text,
    deposited_at   timestamptz,
    -- The photograph of the slip. Evidence, and the reason a shop can be asked
    -- for a deposit it says it made.
    proof_file_id  uuid REFERENCES stored_file(file_id),

    -- What the bank says. Nullable because confirmation may be manual — a
    -- person reading a statement — and because the reconciliation lane's
    -- matcher fills it in when it finds the line itself.
    bank_statement_line_id uuid REFERENCES bank_statement_line(line_id),
    confirmed_by   text,
    confirmed_at   timestamptz,

    -- One posting per transition, each named.
    out_entry_id   uuid REFERENCES journal_entry(entry_id),
    in_entry_id    uuid REFERENCES journal_entry(entry_id),

    cancelled_by   text,
    cancelled_at   timestamptz,
    note           text,

    -- Each stamp is set exactly when its status is reached, and the states are
    -- a ladder: a CONFIRMED deposit was DEPOSITED first, so it carries both.
    CHECK ((deposited_by IS NULL) = (deposited_at IS NULL)),
    CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
    CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
    CHECK ((status IN ('DEPOSITED', 'CONFIRMED')) = (deposited_at IS NOT NULL)),
    CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    -- The books follow the status, not the other way round.
    CHECK ((out_entry_id IS NOT NULL) = (status IN ('DEPOSITED', 'CONFIRMED'))),
    CHECK ((in_entry_id IS NOT NULL) = (status = 'CONFIRMED'))
);

-- "What is in transit from this shop", which is the question the account
-- exists to answer, and "what has this shop banked this month".
CREATE INDEX ix_store_deposit_site_date ON store_deposit (site_id, deposit_date DESC);
CREATE INDEX ix_store_deposit_in_transit ON store_deposit (site_id, deposited_at)
    WHERE status = 'DEPOSITED';
-- The reconciliation lane looks a deposit up by the statement line it matched.
CREATE INDEX ix_store_deposit_bank_line ON store_deposit (bank_statement_line_id)
    WHERE bank_statement_line_id IS NOT NULL;

-- A bank line settles one deposit. Two deposits claiming one line would each be
-- confirmed by the same money.
CREATE UNIQUE INDEX ux_store_deposit_bank_line ON store_deposit (bank_statement_line_id)
    WHERE bank_statement_line_id IS NOT NULL;

COMMENT ON TABLE store_deposit IS
    'A shop''s takings on their way to an HO bank account. Two postings: out of '
    'shop cash into cash-in-transit when it is handed over, out of transit into '
    'the bank when the bank agrees.';
