-- 0112: Head office decides what a shop does with its takings, and deciding
--       is not doing.
--
-- # What this replaces
--
-- An earlier draft of this lane had a document called `remittance_instruction`
-- that posted its own journal entry when head office confirmed it. That was
-- wrong twice over. It made a fourth way for money to move — beside the cash
-- document, the supplier payment and the bank transfer — so the same act, a
-- shop paying a supplier, landed in the books through two different rules
-- depending on which screen somebody opened. And it made the instruction and
-- the execution one row, so an order that was half carried out could not be
-- described at all.
--
-- # The rule
--
-- Sales proceeds are head office's money in the shop's custody. The shop may
-- not spend them. Once the day's takings are reconciled, head office says what
-- becomes of them — and that saying is a **Remittance Order**, `REM-26-09-00001`.
--
-- **A Remittance Order moves no money.** Creating one posts no journal entry,
-- opens no Payment Ledger item, and changes no balance. It is a mandate: a
-- list of destinations, amounts and reasons, signed by somebody at head office
-- who is allowed to sign it.
--
-- What actually moves the money is a document that already exists:
--
--   BANK_ACCOUNT  a store deposit (0111), or a bank transfer (`cash_document`
--                 of kind TRANSFER)
--   SUPPLIER      a supplier payment, or a cash document of kind PAY
--   VENDOR        a cash document of kind PAY to a party with no supplier row
--   OTHER_SITE    a cash document of kind TRANSFER between two shops
--
-- Each of those posts its own entry under its own rule. `remittance_order_execution`
-- is the link, and the order's progress is READ from what is linked to it. It
-- is never stored, which is the whole point: a stored status is a second
-- opinion about documents that can be reversed after somebody wrote it down.
--
-- # Why the projection is not a column
--
-- Because there are four answers and only two of them are facts about this
-- table.
--
--   pending    reconciled proceeds with no order over them yet
--   ordered    an order exists; nothing has been executed against a line
--   executed   every line has enough execution linked to cover it
--   confirmed  every one of those executions is itself confirmed — the bank
--              agreed, the payment posted
--
-- "Confirmed" is a fact about the store deposit and the cash document, which
-- have their own lifecycles and their own reversals. A column here would be a
-- copy of theirs, and it would be a stale copy the first time a deposit was
-- unmatched from a bank line.
--
-- # What a shop cannot do
--
-- Pay anybody out of sales proceeds without a line that authorises it. That is
-- enforced where the money leaves — a store expense (0114) refuses the drawer
-- outright, and the money documents ask `remittance_authority` before they
-- credit a shop's cash. The unexecuted balance of a line is the authority, and
-- it is computed from the executions rather than decremented, so two payments
-- racing for the same line cannot both believe there was room.

-- ---------------------------------------------------------------------------
-- What a shop's proceeds do by default
-- ---------------------------------------------------------------------------
--
-- Without this, reconciled takings can sit in a shop with no disposition and
-- nobody obviously at fault: head office has not said what to do with them and
-- the shop is not allowed to decide. One row per shop makes the ordinary case
-- — bank it — a standing decision rather than an evening's paperwork, and
-- makes a shop whose proceeds are NOT banked by default something a person had
-- to configure deliberately.
--
-- Distinct from `store_bank_destination` (0111), which is a different
-- question. That one says which head-office bank account this shop's cash
-- physically travels to; this one says what head office normally instructs be
-- done with the money at all. For most shops the two agree and the default is
-- BANK_ACCOUNT; a shop that routinely settles a local landlord out of takings
-- differs here and not there.
CREATE TABLE store_remittance_default (
    site_id          text PRIMARY KEY REFERENCES site(id),
    destination_kind text NOT NULL CHECK (destination_kind IN
                         ('BANK_ACCOUNT', 'SUPPLIER', 'VENDOR', 'OTHER_SITE')),
    -- A bank qualifier, a `supplier.id`, a vendor's name, or a `site.id`, as
    -- `destination_kind` says. Same shape as the order line below, so the
    -- default can be copied onto a line without translation.
    destination_ref  text NOT NULL CHECK (btrim(destination_ref) <> ''),
    purpose          text NOT NULL CHECK (btrim(purpose) <> ''),
    set_by           text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE store_remittance_default IS
    'What head office normally orders done with a shop''s reconciled '
    'proceeds, so no takings can sit with no disposition at all.';

-- ---------------------------------------------------------------------------
-- The order
-- ---------------------------------------------------------------------------

CREATE TABLE remittance_order (
    order_id      uuid PRIMARY KEY,
    -- `REM-26-09-00001`, restarting each month. Gapless, from the counter in
    -- 0110 — see the argument there for why these are a table and journal
    -- numbers are a sequence.
    order_number  text NOT NULL UNIQUE CHECK (btrim(order_number) <> ''),

    -- The shop holding the money.
    site_id       text NOT NULL REFERENCES site(id),

    -- Where the money being disposed of came from.
    --
    -- One value, and a CHECK with one value in it rather than no column at
    -- all. Operating funds are accounted for through Piutang Kepala Toko
    -- (0113) and are never remitted; petty cash is replenished, not remitted.
    -- Naming the single legal source here means a second one has to be added
    -- deliberately, by somebody who has read this paragraph.
    source        text NOT NULL DEFAULT 'SALES_PROCEEDS'
                  CHECK (source = 'SALES_PROCEEDS'),

    -- The business day through which the proceeds being disposed of have been
    -- reconciled. Head office may only order the disposal of money the shop
    -- has proved it holds.
    --
    -- The proof is `tender_reconciliation` (a neighbouring lane): one row per
    -- shop per day per tender kind, CLOSED when every receipt has been
    -- answered for. This column is the join to it and the application checks
    -- it — see `remittance_order_issue`, which refuses a date the shop has not
    -- closed and says so in a sentence. Nullable while that lane is unmerged;
    -- the hook is `TODO(lane-H)` in `postgres/store_money.rs`.
    reconciled_through date,

    currency      char(3) NOT NULL DEFAULT 'IDR',
    -- The sum of the lines, kept so the order has one figure a person can read
    -- and so the database can refuse a header that disagrees with its parts.
    -- Maintained by the trigger below, never by whichever code path remembered.
    amount_minor  bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),

    -- The document's own life, and nothing else. NOT the execution status:
    -- that is projected, and there is deliberately no column for it. See the
    -- header.
    status        text NOT NULL CHECK (status IN ('ISSUED', 'CANCELLED')),

    issued_by     text NOT NULL CHECK (btrim(issued_by) <> ''),
    issued_at     timestamptz NOT NULL DEFAULT now(),
    order_date    date NOT NULL,
    note          text,

    cancelled_by  text,
    cancelled_at  timestamptz,
    cancel_reason text,

    CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    CHECK (status <> 'CANCELLED' OR btrim(COALESCE(cancel_reason, '')) <> '')
);

CREATE INDEX ix_remittance_order_site ON remittance_order (site_id, order_date DESC);
CREATE INDEX ix_remittance_order_live ON remittance_order (site_id, order_date)
    WHERE status = 'ISSUED';

COMMENT ON TABLE remittance_order IS
    'Head office''s instruction about reconciled sales proceeds a shop holds. '
    'Posts nothing, settles nothing, opens no payment ledger item: it is a '
    'mandate, executed by the money documents linked to its lines.';

-- One destination on an order.
CREATE TABLE remittance_order_line (
    line_id          uuid PRIMARY KEY,
    order_id         uuid NOT NULL REFERENCES remittance_order(order_id) ON DELETE CASCADE,
    -- The order a person reads them in, and the identity a printed order uses.
    line_no          integer NOT NULL CHECK (line_no > 0),

    destination_kind text NOT NULL CHECK (destination_kind IN
                         ('BANK_ACCOUNT', 'SUPPLIER', 'VENDOR', 'OTHER_SITE')),
    -- What `destination_kind` says it is: a bank qualifier, a `supplier.id`, a
    -- vendor's name written on the line, or a `site.id`.
    --
    -- One column rather than four nullable foreign keys. Three of the four
    -- would be null on every row, and the fourth would still not be checkable
    -- — a vendor with no supplier record is exactly the case VENDOR exists
    -- for. The application resolves it and refuses an unknown reference before
    -- the order can be issued.
    destination_ref  text NOT NULL CHECK (btrim(destination_ref) <> ''),
    -- The name to print. Resolved once, when the order is written, so a
    -- supplier renamed in March does not rewrite what January's order said.
    destination_name text NOT NULL CHECK (btrim(destination_name) <> ''),

    amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
    -- Why. Required: an instruction to hand over money with no stated reason
    -- is the document this table exists to make impossible.
    purpose          text NOT NULL CHECK (btrim(purpose) <> ''),

    UNIQUE (order_id, line_no),
    -- Money to another shop goes to another shop.
    CHECK (destination_kind <> 'OTHER_SITE' OR btrim(destination_ref) <> '')
);

CREATE INDEX ix_remittance_line_order ON remittance_order_line (order_id, line_no);
-- "What am I authorised to pay this supplier out of takings", which is the
-- question the money documents ask before they credit a shop's cash.
CREATE INDEX ix_remittance_line_destination
    ON remittance_order_line (destination_kind, destination_ref);

COMMENT ON TABLE remittance_order_line IS
    'One destination, amount and reason on a remittance order. The authority a '
    'money document has to take cash out of a shop.';

-- The header total follows its lines, and cannot be edited to disagree.
CREATE FUNCTION remittance_order_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target uuid := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
    UPDATE remittance_order o
       SET amount_minor = COALESCE(
               (SELECT SUM(l.amount_minor) FROM remittance_order_line l
                 WHERE l.order_id = target), 0)
     WHERE o.order_id = target;
    RETURN NULL;
END;
$$;

CREATE TRIGGER remittance_order_total
    AFTER INSERT OR UPDATE OR DELETE ON remittance_order_line
    FOR EACH ROW EXECUTE FUNCTION remittance_order_total();

-- ---------------------------------------------------------------------------
-- What carried the order out
-- ---------------------------------------------------------------------------
--
-- A link, and only a link. It holds no status of its own: the state of an
-- execution is a fact about the document that performed it, read from that
-- document when somebody asks. See the header for why a mirrored column here
-- would be a stale copy.
--
-- `document_id` has no foreign key, and that is deliberate rather than lazy.
-- The executing documents live in three tables owned by two other lanes, one
-- of which (`cash_document`) is not merged yet; a foreign key would either
-- have to be four nullable columns or would block this table on somebody
-- else's migration order. The application resolves `(document_kind,
-- document_id)` and refuses a reference it cannot read, and the projection
-- treats a kind it cannot read as executed-but-not-confirmed — never as
-- confirmed, so an order can never claim more certainty than the evidence.
CREATE TABLE remittance_order_execution (
    execution_id  uuid PRIMARY KEY,
    line_id       uuid NOT NULL REFERENCES remittance_order_line(line_id) ON DELETE CASCADE,

    document_kind text NOT NULL CHECK (document_kind IN
                      ('STORE_DEPOSIT', 'CASH_DOCUMENT', 'SUPPLIER_PAYMENT')),
    document_id   uuid NOT NULL,
    -- What the printed order and the shop's file call it: `SB-26-09-00001`,
    -- `KK-26-09-00042`, `PV-00000517`. Kept so a linked execution can be named
    -- without reaching into a table this migration does not own.
    document_number text NOT NULL CHECK (btrim(document_number) <> ''),

    -- How much of this line that document carried. Not the document's total: a
    -- single transfer may discharge two lines of one order, and a line may
    -- take two transfers.
    amount_minor  bigint NOT NULL CHECK (amount_minor > 0),

    linked_by     text NOT NULL CHECK (btrim(linked_by) <> ''),
    linked_at     timestamptz NOT NULL DEFAULT now(),

    -- One document discharges one line once. A second link for the same pair
    -- would count the same money twice against the authority.
    UNIQUE (line_id, document_kind, document_id)
);

CREATE INDEX ix_remittance_execution_line ON remittance_order_execution (line_id);
-- "Which order was this transfer carrying out", asked from the money document.
CREATE INDEX ix_remittance_execution_document
    ON remittance_order_execution (document_kind, document_id);

COMMENT ON TABLE remittance_order_execution IS
    'Which money document carried out how much of which order line. A link '
    'only: the state of an execution belongs to the document that performed it.';

-- An execution may not exceed the line it discharges.
--
-- In the database rather than in Rust because it is the rule that makes a
-- remittance line an authority. A read-then-write in the application would let
-- two payments racing for the same line each see the same room left.
CREATE FUNCTION remittance_execution_within_authority() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    authorised bigint;
    already    bigint;
    order_state text;
BEGIN
    SELECT l.amount_minor, o.status
      INTO authorised, order_state
      FROM remittance_order_line l
      JOIN remittance_order o ON o.order_id = l.order_id
     WHERE l.line_id = NEW.line_id
       FOR UPDATE OF l;

    IF order_state = 'CANCELLED' THEN
        RAISE EXCEPTION
            'remittance order line % belongs to a cancelled order', NEW.line_id;
    END IF;

    SELECT COALESCE(SUM(e.amount_minor), 0) INTO already
      FROM remittance_order_execution e
     WHERE e.line_id = NEW.line_id
       AND e.execution_id <> NEW.execution_id;

    IF already + NEW.amount_minor > authorised THEN
        RAISE EXCEPTION
            'remittance order line % authorises % more; this execution of % would exceed it',
            NEW.line_id, authorised - already, NEW.amount_minor;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER remittance_execution_within_authority
    BEFORE INSERT OR UPDATE ON remittance_order_execution
    FOR EACH ROW EXECUTE FUNCTION remittance_execution_within_authority();

-- A store deposit may name the line it discharges, so banking takings is the
-- same act as any other disposal rather than a special case that escapes the
-- mandate.
--
-- Nullable, because a deposit of something other than reconciled sales
-- proceeds is a real thing — a shop banking the float it was told to stop
-- holding — and refusing it would push that money back into the untracked jump
-- 0111 exists to end.
ALTER TABLE store_deposit
    ADD COLUMN remittance_line_id uuid REFERENCES remittance_order_line(line_id);

CREATE INDEX ix_store_deposit_remittance ON store_deposit (remittance_line_id)
    WHERE remittance_line_id IS NOT NULL;

COMMENT ON COLUMN store_deposit.remittance_line_id IS
    'The order line this deposit carries out, when it is disposing of '
    'reconciled sales proceeds.';
