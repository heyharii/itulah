-- 0110: The drawer reaches the centre, and the float stops being invisible.
--
-- # What was missing
--
-- `cash_shift` and `cash_movement` existed in exactly one place: the edge's
-- SQLite (0024), on the machine under the counter. A shop opened a drawer,
-- counted it blind at close, and recorded a variance — and none of it was ever
-- pushed anywhere. Head office could read what a shop SOLD (`edge_sale`, since
-- 0014) and could not read what a shop HELD. The two questions a cash retailer
-- lives on — "how much is in that safe" and "did last night's count come up
-- short" — had no answer outside the shop that could not answer them honestly
-- about itself.
--
-- Worse, the money had nowhere to go in the books. `1011001003 Modal Kasir` is
-- an account the client keeps per location and nothing has ever posted to it,
-- because the only event that moves a float is a shift opening and shift
-- openings stopped at the edge.
--
-- # Why these are projections and not the source
--
-- Same shape and same reason as `edge_sale`: `origin_id`, `generation`, `seq`.
-- The shop's SQLite is where a shift is authored — it has to be, because the
-- counter keeps working when the line to head office does not — and this is a
-- copy of what it decided. Nothing here may be edited to disagree with the
-- shop; the two writes the centre does make (a variance approval, and the
-- journal entry ids) are columns the edge does not have and will never send.
--
-- The names are `cash_shift` and `cash_movement` rather than `edge_cash_shift`
-- because head office reads these as the drawer, not as a replication detail,
-- and no Postgres table claims either name today.
--
-- # What is deliberately NOT here
--
-- A denomination breakdown. The till captures one figure, `declared_cash_minor`
-- — see the note in 0024 about counting blind — so a `counted_denominations`
-- column would be null on every row this schema will ever receive. When the
-- till starts capturing notes and coins separately, that is a column here and
-- one more field on the wire, with nothing below undone.

CREATE TABLE cash_shift (
    shift_id            uuid PRIMARY KEY,

    -- Where it came from, and in what order. `(origin_id, generation, seq)` is
    -- the sync protocol's coordinate; it is stored so a shift can be traced to
    -- the push that delivered it and so a regression is visible rather than
    -- inferred.
    origin_id           text NOT NULL,
    generation          bigint NOT NULL,
    seq                 bigint NOT NULL,

    site_id             text NOT NULL REFERENCES site(id),
    -- One terminal, one drawer. Not unique here the way it is on the edge: the
    -- edge's partial unique index guards ONE shop's tills, and two shops may
    -- both call their till `TILL-1`.
    terminal_id         text NOT NULL CHECK (btrim(terminal_id) <> ''),

    status              text NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
    opened_by           text NOT NULL CHECK (btrim(opened_by) <> ''),
    opened_at           timestamptz NOT NULL,
    opening_float_minor bigint NOT NULL CHECK (opening_float_minor >= 0),

    closed_by           text,
    closed_at           timestamptz,
    -- What the cashier counted, and what the till worked out was owed. Both
    -- copied from the shop; the centre never recomputes them, because a
    -- recomputation that disagreed would be a second opinion about a drawer
    -- nobody at the centre has seen.
    declared_cash_minor bigint CHECK (declared_cash_minor >= 0),
    expected_cash_minor bigint,
    -- Signed: positive is over, negative is short.
    variance_minor      bigint,
    close_note          text,

    -- Head office's decision about the difference, which is the only thing on
    -- this row the centre owns. A variance is a fact about a drawer until
    -- somebody accepts it; only then is it an entry in the books. Nothing
    -- posts a variance automatically, on purpose — an automatic write-off is
    -- how a till that is short every evening becomes a line nobody reads.
    approved_by         text,
    approved_at         timestamptz,

    -- The float leaving store cash at open, and returning at close.
    float_out_entry_id  uuid REFERENCES journal_entry(entry_id),
    float_back_entry_id uuid REFERENCES journal_entry(entry_id),
    -- The approved difference, once it is in the books.
    variance_entry_id   uuid REFERENCES journal_entry(entry_id),

    received_at         timestamptz NOT NULL DEFAULT now(),

    -- The same pairing 0024 keeps, restated because this table is written by a
    -- different program and a rule enforced in one database only is a rule
    -- until somebody writes to the other.
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CHECK ((closed_by IS NULL) = (closed_at IS NULL)),
    -- A closed shift has been counted; an open one cannot have been.
    CHECK ((status = 'CLOSED') OR (declared_cash_minor IS NULL AND variance_minor IS NULL)),
    CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
    -- Nothing may be approved before it has been counted, and nothing may be
    -- approved that has no difference to approve.
    CHECK (approved_at IS NULL OR (status = 'CLOSED' AND variance_minor IS NOT NULL)),
    CHECK (variance_entry_id IS NULL OR approved_at IS NOT NULL)
);

-- "What did this shop's drawers do last week", which is how every one of these
-- is read.
CREATE INDEX ix_cash_shift_site_time ON cash_shift (site_id, opened_at DESC);
CREATE INDEX ix_cash_shift_origin ON cash_shift (origin_id, generation, seq);
-- The work queue: closed, short or over, and nobody has decided yet.
CREATE INDEX ix_cash_shift_unapproved ON cash_shift (site_id)
    WHERE status = 'CLOSED' AND variance_minor IS NOT NULL AND variance_minor <> 0
      AND approved_at IS NULL;

COMMENT ON TABLE cash_shift IS
    'A shop''s drawer, as the shop recorded it. Authored on the edge (SQLite '
    '0024) and copied here; only the variance approval and the journal entry '
    'ids are written by the centre.';

-- Cash that moved for a reason other than a sale.
--
-- Signed, exactly as on the edge, so the expected drawer is one SUM and a
-- payout written as a positive number is impossible rather than merely
-- discouraged. A magnitude column plus a direction column is the same number
-- written twice, and the two part company the first time somebody keys a
-- negative correction.
--
-- These do NOT post. A safe drop and a till pickup move custody inside one
-- shop's cash — the note leaves a drawer and enters a safe, both of which are
-- `1011001001 Cash on Hand` at that location — so an entry for one would debit
-- and credit the same account. What DOES post is the money leaving the shop
-- altogether, and that is a deposit (0111) or a remittance (0112), each with a
-- document behind it.
--
-- PAYOUT is the exception worth naming: it is money leaving the drawer for
-- something other than change, and it is exactly what this lane refuses to let
-- a shop do informally. A store expense is `store_expense` (0114), paid from
-- petty cash or an advance, never from the drawer.
CREATE TABLE cash_movement (
    movement_id  uuid PRIMARY KEY,
    shift_id     uuid NOT NULL REFERENCES cash_shift(shift_id) ON DELETE CASCADE,
    -- Copied down from the shift so "what did this site pay out" is one index
    -- rather than a join. The trigger below makes the copy unable to disagree.
    site_id      text NOT NULL REFERENCES site(id),
    kind         text NOT NULL CHECK (kind IN
                     ('OPENING_FLOAT', 'DROP', 'PICKUP', 'PAYOUT', 'CORRECTION')),
    amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
    reason       text NOT NULL,
    actor_id     text NOT NULL CHECK (btrim(actor_id) <> ''),
    -- A payout needs a second pair of eyes; a safe drop does not. The edge
    -- decides that and sends whatever it decided.
    approved_by  text,
    occurred_at  timestamptz NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_cash_movement_shift ON cash_movement (shift_id, occurred_at);
CREATE INDEX ix_cash_movement_site_kind ON cash_movement (site_id, kind, occurred_at DESC);

CREATE FUNCTION cash_movement_site_matches_shift() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    shift_site text;
BEGIN
    SELECT site_id INTO shift_site FROM cash_shift WHERE shift_id = NEW.shift_id;
    IF shift_site IS DISTINCT FROM NEW.site_id THEN
        RAISE EXCEPTION
            'a cash movement belongs to the site its shift does (% not %)',
            NEW.site_id, shift_site;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cash_movement_site_matches_shift
    BEFORE INSERT OR UPDATE ON cash_movement
    FOR EACH ROW EXECUTE FUNCTION cash_movement_site_matches_shift();

COMMENT ON TABLE cash_movement IS
    'Cash into or out of a drawer for a reason other than a sale. Signed. '
    'Nothing here posts: custody moving inside one shop''s cash is not a '
    'ledger event.';

-- ---------------------------------------------------------------------------
-- The source kinds this lane writes
-- ---------------------------------------------------------------------------
--
-- Same argument as 0083, 0095 and 0096: MANUAL is reserved for the entries a
-- person typed from nothing, and every one of these has a document behind it
-- that `source_id` names. Widened once here, for the whole lane, so that the
-- five migrations do not each drop and recreate the same constraint.
--
--   CASH_SHIFT       a float issued or returned, or an approved difference
--   STORE_DEPOSIT    a shop's takings on their way to an HO bank account
--   REMITTANCE       a shop paying somebody on head office's written order
--   ADVANCE          an operating advance issued, or returned
--   STORE_EXPENSE    a shop spending petty cash or an advance
--   PETTY_REPLENISH  head office topping the imprest back up
--
-- The last five names are declared now although 0111-0114 are what write them.
-- A CHECK widened five times is five migrations that cannot be reordered, and
-- the list is one fact about this lane rather than five.
--
-- # Why every other lane's kinds are here too
--
-- This constraint is a single list, and the only way to widen it is to drop it
-- and write it out again. Several lanes are adding kinds at the same time, so
-- if each wrote only the existing list plus its own, whichever migration ran
-- second would silently DELETE the first one's names — and the failure would
-- not appear until a document somewhere posted and was refused for a kind that
-- had been agreed weeks earlier.
--
-- So the list below is the agreed union across every lane in flight, written
-- identically in each of them. Recreating it with the same list twice is a
-- no-op; recreating it with a subset is the bug. Nothing is ever removed here.
ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        -- The list as 0096 left it.
        'SUPPLIER_INVOICE', 'PAYMENT', 'SALE_DAY', 'STOCK_COUNT',
        'TRANSFER', 'MANUAL', 'REVERSAL', 'DEPRECIATION', 'BANK_STATEMENT',
        'ASSET_DISPOSAL', 'ASSET_TRANSFER',
        -- This lane: the store cash chain.
        'CASH_SHIFT', 'STORE_DEPOSIT', 'REMITTANCE', 'ADVANCE',
        'STORE_EXPENSE', 'PETTY_REPLENISH',
        -- The neighbouring lanes', by agreement.
        'RETENDER', 'CASH_DOC', 'GIRO', 'INTERUNIT_SETTLE', 'RECLASS',
        'ADJUSTMENT', 'WRITE_OFF', 'ACQ_SETTLEMENT', 'GOODS_RECEIPT',
        'CREDIT_NOTE', 'SUPPLIER_ADVANCE', 'LANDED_COST', 'COGS_DAY',
        'ASSET_RESERVE'));

-- ---------------------------------------------------------------------------
-- Document numbers that restart with the month
-- ---------------------------------------------------------------------------
--
-- `PB-26-09-00001`, `ADV-26-09-00001`, `KK-STORE-03-26-09-00001`. The client's
-- own paperwork is numbered this way and the people who file it read the month
-- out of the number, so a global running sequence — which is what `JV-` and
-- `PV-` use — would be the wrong shape here even though it is simpler.
--
-- A counter table rather than a sequence, for a reason worth stating: a
-- sequence does NOT roll back. `nextval` outside transaction control is right
-- for a journal entry number, where a gap is harmless and contention is not,
-- and wrong for a document a shop hands to a supplier, where a gap is a
-- question from an auditor. This row is locked for the length of the caller's
-- transaction, so two shops numbering at once queue rather than collide, and a
-- rolled-back document takes its number back with it.
--
-- The cost is honest: every document in one scope in one month serialises on
-- one row. At the volumes a thirteen-shop chain produces — tens of documents
-- per shop per month — that is not a cost anybody will measure.
CREATE TABLE store_document_counter (
    -- `PB`, `ADV`, or `KK:<site_id>`. Store expenses are numbered per shop
    -- because the shop's own book is what the sequence has to be gapless in.
    scope        text NOT NULL,
    year         smallint NOT NULL,
    month        smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    last_number  integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    PRIMARY KEY (scope, year, month)
);

COMMENT ON TABLE store_document_counter IS
    'Per-scope, per-month document numbering. A table rather than a sequence '
    'because these numbers must be gapless: a sequence survives the rollback '
    'that abandoned the document.';
