-- 0170: A coupon is a thing with a state, not a counter.
--
-- # What was here before
--
-- One number. `commercial_usage(kind='COUPON', key=<code>).uses` said how many
-- times a code had been redeemed, and `commercial_usage_customer` said how many
-- times one shopper had. Both are honest observations and neither is a coupon.
--
-- What they cannot answer, and what a shop asks every day:
--
--   * "we printed ten thousand codes for the mailing — which ones are spent?"
--     There were no codes. `commercial_coupon` holds one row per code a
--     merchandiser TYPED into a price book, which is fine for `LEBARAN10` and
--     impossible for a per-person mailing.
--   * "this code is in a basket at till 3 — may till 7 also have it?" There was
--     nothing between "unused" and "used", so both tills read the same count,
--     both passed, and the second one found out when the sales synced.
--   * "which sale used it?" The counter is a total. It names no sale, so a
--     retried sale counts twice and a returned sale never counts back.
--
-- # The three tables
--
--     coupon_set          the authored thing: a rule, a window, the caps
--     coupon_code         one row per code, with a state
--     coupon_redemption   one row per (code, sale)
--
-- plus `coupon_authorization`, which is the RESERVED state made concrete and is
-- deliberately the same shape as `voucher_authorization` from `0162` — see
-- below.
--
-- # SHARED and UNIQUE are one mechanism, not two
--
-- A SHARED set is one code everybody types; a UNIQUE set is one code per person,
-- minted in bulk. The temptation is two tables. They are the same table with a
-- different cap: a SHARED set has exactly one code row that many baskets may
-- present, and a UNIQUE set has many code rows each with `max_uses` 1. The
-- `kind` column exists so that authoring can refuse nonsense — minting ten
-- thousand codes into a SHARED set, or a second code beside `LEBARAN10` — and
-- not because redemption branches on it. Admission never reads `kind` at all.
--
-- # Three caps, because they answer three different questions
--
-- `coupon_code.max_uses` is how often ONE code may be presented.
-- `coupon_set.max_redemptions` is how much the SET may give away in total.
-- `coupon_set.max_per_customer` is how much one shopper may take out of it.
--
-- The first two are not the same number the moment a set is UNIQUE: a mailing
-- of 10,000 single-use codes with a budget for 500 redemptions is a normal
-- thing to want, and one cap cannot express it. Either may be NULL, and for a
-- SHARED set exactly one of them is usually filled in — writing 500 in both
-- would be one number with two homes, which is the shape of the fault `0086`
-- went back and removed.
--
-- The third is the limit `0086` deleted from `commercial_campaign` because
-- nothing counted a shopper's history. `coupon_redemption.customer_id` is that
-- history, so this one bites — and a set that declares it refuses an anonymous
-- basket rather than letting the cap quietly not apply.
--
-- # Why the hold is shaped exactly like a voucher's
--
-- `0162` settled this for vouchers and the argument is identical here: a
-- redemption is final and a checkout is not. Between a shopper handing over a
-- code and the card terminal answering there is a queue, a timeout and a
-- shopper who may walk away. Taking the redemption at the start means giving it
-- back by hand when the sale dies.
--
--     AUTHORIZED  the use is spoken for and no other till may have it
--     COMMITTED   the sale landed; the redemption row exists
--     RELEASED    the checkout died; the capacity is free again
--     EXPIRED     nobody came back, and the clock let it go
--
-- The invariant, stated once and in the same words `0162` states it:
--
--     available = cap − redemptions − open holds
--
-- read INSIDE `SELECT … FOR UPDATE`, in the transaction that writes the hold.
-- Two tills reading a count that neither has yet increased is not a race that
-- needs an unlucky schedule; it is the ordinary case.
--
-- A second hold mechanism with its own vocabulary would be the bug. Anybody who
-- has read `voucher_authorization` can read this without learning anything new.
--
-- # Why the SET row is locked and not only the code row
--
-- Locking the code serialises a SHARED set, because a SHARED set is one code.
-- It does nothing for a UNIQUE set: two tills presenting two DIFFERENT codes
-- from the same mailing both pass a total cap of one, because they lock
-- different rows and each sees a set-wide count the other has not yet moved.
-- So the set row is locked first and the code second — parent then child, the
-- same order in every path here, so two tills cannot take the pair backwards
-- and deadlock.
--
-- The cost is real and is named rather than hidden: every authorize against one
-- set is serial. The transaction is three counts and an insert, and a cap that
-- is enforced only when the timing is kind is not a cap.
--
-- # EXPIRED is a swept state, never the authority for admission
--
-- `voucher.status` deliberately has no EXPIRED value: `0090`'s module says
-- storing one gives a status that is wrong from the moment it is written until
-- something sweeps the table. That reasoning holds, and `EXPIRED` is in the
-- machine below anyway — because a merchandiser looking at 10,000 minted codes
-- wants to see which ones lapsed, and computing that per row on every list is a
-- different kind of waste.
--
-- The reconciliation: the column is written ONLY by a deliberate sweep, and
-- admission NEVER reads it. Every authorize re-measures the window against the
-- clock, so a code past its date is refused whether or not the sweep has run.
-- The column is a report, and the window is the rule.

CREATE TABLE coupon_set (
    coupon_set_id     UUID PRIMARY KEY,

    -- What a person calls this set. Also the code itself for a SHARED set,
    -- which is why it is normalised the same way a voucher code is: upper
    -- case, no spaces or dashes. `LEBARAN10` and `lebaran-10` are one set.
    set_code          TEXT NOT NULL UNIQUE CHECK (btrim(set_code) <> ''),

    name              TEXT NOT NULL CHECK (btrim(name) <> ''),

    -- The one promotion these codes open. A coupon never carries a discount of
    -- its own — `0031` settled that — so this is a key and not a benefit.
    --
    -- Text, and NOT a foreign key to `commercial_rule(id)`. That table's uuid
    -- is per-publication and a publication is immutable, so a set pointing at
    -- one would be a set that dies the next time the book is republished. The
    -- rule_id is the identifier that survives a republish, which is exactly why
    -- `commercial_usage.key` is text too.
    rule_id           TEXT NOT NULL CHECK (btrim(rule_id) <> ''),

    kind              TEXT NOT NULL CHECK (kind IN ('SHARED', 'UNIQUE')),

    valid_from        TIMESTAMPTZ,
    valid_to          TIMESTAMPTZ,

    -- How much the whole set may give away. NULL is uncapped.
    max_redemptions   BIGINT CHECK (max_redemptions IS NULL OR max_redemptions > 0),

    -- How often ONE shopper may redeem out of this set. NULL is uncapped. This
    -- is the limit `0086` deleted from `commercial_campaign` with the note that
    -- nothing counted a customer's history; `coupon_redemption.customer_id` is
    -- that history.
    max_per_customer  BIGINT CHECK (max_per_customer IS NULL OR max_per_customer > 0),

    -- How long a till may hold a use before the clock takes it back. Per set
    -- rather than global: a shop that sells coats takes longer at the counter
    -- than one that sells coffee, and a hold that outlives the shopper blocks
    -- the next one.
    hold_seconds      INTEGER NOT NULL DEFAULT 900 CHECK (hold_seconds > 0),

    active            BOOLEAN NOT NULL DEFAULT true,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        TEXT NOT NULL,
    note              TEXT,

    CONSTRAINT coupon_set_window_is_ordered
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);

CREATE INDEX ix_coupon_set_rule ON coupon_set (rule_id);

CREATE TABLE coupon_code (
    coupon_code_id    UUID PRIMARY KEY,
    coupon_set_id     UUID NOT NULL REFERENCES coupon_set(coupon_set_id),

    -- Unique across every set, not merely within one. A shopper types a code
    -- and nothing tells the till which set it came from; a code that resolved
    -- to two sets would be a code whose discount depends on which row the
    -- planner reached first.
    code              TEXT NOT NULL UNIQUE CHECK (btrim(code) <> ''),

    state             TEXT NOT NULL CHECK (state IN
                          ('ISSUED', 'RESERVED', 'REDEEMED', 'EXPIRED', 'CANCELLED')),

    -- How many times THIS code may be presented. One for a minted UNIQUE code.
    -- NULL is uncapped at the code, which is the usual shape for the single
    -- code of a SHARED set: there the cap is the set's and writing it in both
    -- places would be one number with two homes, which is how this area has
    -- gone wrong before (`0086`).
    max_uses          BIGINT CHECK (max_uses IS NULL OR max_uses > 0),

    -- Minted to one named person. NULL is bearer paper: whoever holds it.
    customer_id       TEXT,

    issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    issued_by         TEXT NOT NULL,

    -- Only ever set by the act that stopped it. A cancelled code is kept, not
    -- deleted: somebody will ask why it stopped working, and a missing row
    -- answers that with silence.
    cancelled_at      TIMESTAMPTZ,
    cancel_reason     TEXT,

    CONSTRAINT coupon_code_cancelled_says_when
        CHECK ((state = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE INDEX ix_coupon_code_set ON coupon_code (coupon_set_id);

-- For the mailing question: "which of this set's codes are still good".
CREATE INDEX ix_coupon_code_set_state ON coupon_code (coupon_set_id, state);

-- A UNIQUE code minted to a person, found by the person.
CREATE INDEX ix_coupon_code_customer ON coupon_code (customer_id)
    WHERE customer_id IS NOT NULL;

CREATE TABLE coupon_authorization (
    authorization_id  UUID PRIMARY KEY,
    coupon_code_id    UUID NOT NULL REFERENCES coupon_code(coupon_code_id),

    -- The checkout this hold belongs to. Text rather than a foreign key, for
    -- the reason `0162` gives: the basket lives in a till's SQLite until it is
    -- sold, so at the moment a hold is taken there is no row here to point at.
    checkout_id       TEXT NOT NULL,

    -- Who is standing at the counter, when they are known. Held here and not
    -- only on the redemption, because the per-customer cap has to count open
    -- holds too — a shopper with two tills open is the same shopper.
    customer_id       TEXT,

    status            TEXT NOT NULL CHECK (status IN
                          ('AUTHORIZED', 'COMMITTED', 'RELEASED', 'EXPIRED')),

    site_id           TEXT,
    actor             TEXT NOT NULL,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL,
    settled_at        TIMESTAMPTZ,

    -- The redemption this hold became. Null while it is open, and the link that
    -- makes "which redemption came from which hold" answerable without joining
    -- on times and hoping.
    redemption_id     UUID,

    -- One hold per checkout per code. A till that asks twice for the same
    -- basket gets the hold it already has rather than a second one, which is
    -- what makes a retried authorize safe without an idempotency header.
    CONSTRAINT coupon_authorization_one_per_checkout
        UNIQUE (coupon_code_id, checkout_id)
);

-- The only index the invariant needs: summing the open holds on one code.
-- Partial, because a committed or released hold is history and must not be
-- subtracted from anything.
CREATE INDEX ix_coupon_authorization_open
    ON coupon_authorization (coupon_code_id)
    WHERE status = 'AUTHORIZED';

CREATE INDEX ix_coupon_authorization_checkout
    ON coupon_authorization (checkout_id);

-- Open holds held by one shopper, for the per-customer cap.
CREATE INDEX ix_coupon_authorization_customer
    ON coupon_authorization (customer_id)
    WHERE status = 'AUTHORIZED' AND customer_id IS NOT NULL;

CREATE TABLE coupon_redemption (
    redemption_id     UUID PRIMARY KEY,
    coupon_code_id    UUID NOT NULL REFERENCES coupon_code(coupon_code_id),

    -- No foreign key to `sale`, and deliberately — the same decision
    -- `voucher_movement.sale_id` made. A sale is written in a till's SQLite and
    -- reaches the centre when the line is up; a constraint here would refuse
    -- every redemption taken during an outage, which is the hour it matters.
    sale_id           UUID NOT NULL,

    checkout_id       TEXT NOT NULL,
    customer_id       TEXT,

    -- What the coupon actually took off, in minor units. Integer, like every
    -- other money column in this system.
    --
    -- Recorded rather than recomputed because the rule it came from lives in a
    -- price book that will be republished: asking next year what `LEBARAN10`
    -- cost the company would otherwise mean re-running a rule that no longer
    -- exists against prices that have moved.
    discount_minor    BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),

    -- CANCELLED is a redemption undone by a return. The row stays: a code that
    -- was used and given back has a history, and deleting the row would make it
    -- indistinguishable from a code nobody ever presented.
    status            TEXT NOT NULL CHECK (status IN ('REDEEMED', 'CANCELLED')),

    site_id           TEXT,
    actor             TEXT NOT NULL,
    redeemed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at      TIMESTAMPTZ,
    cancel_reason     TEXT,

    -- A copy of `coupon_code.max_uses = 1`, and the only denormalised column
    -- here. It exists because a partial index cannot look at another table, and
    -- the guarantee below is one this must not be able to lose to a bug in
    -- application code. Filled by the trigger underneath, never by a caller —
    -- so it cannot disagree with the code it describes.
    --
    -- The default is never the value that survives: the trigger overwrites it on
    -- every insert. It is here so a writer need not NAME a column it is not
    -- allowed to decide.
    single_use        BOOLEAN NOT NULL DEFAULT FALSE,

    -- One sale counts a code once. A till retrying a lost `commit` writes
    -- nothing the second time, rather than spending the coupon twice on one
    -- receipt.
    CONSTRAINT coupon_redemption_one_per_sale
        UNIQUE (coupon_code_id, sale_id)
);

-- The guarantee that makes a UNIQUE code single-use in the DATABASE and not
-- merely in the code path that checks first. Application logic can race; a
-- unique index cannot.
CREATE UNIQUE INDEX ux_coupon_redemption_one_per_single_use_code
    ON coupon_redemption (coupon_code_id)
    WHERE single_use AND status <> 'CANCELLED';

CREATE INDEX ix_coupon_redemption_code ON coupon_redemption (coupon_code_id);
CREATE INDEX ix_coupon_redemption_sale ON coupon_redemption (sale_id);
CREATE INDEX ix_coupon_redemption_customer ON coupon_redemption (customer_id)
    WHERE customer_id IS NOT NULL;

-- `single_use` is derived from the code, and is derived HERE so that no caller
-- can supply it. A writer that got it wrong would not fail loudly; it would
-- silently opt a single-use code out of the unique index above, which is the
-- one guarantee this table exists to make.
CREATE FUNCTION coupon_redemption_single_use() RETURNS trigger AS $$
BEGIN
    -- COALESCE because `max_uses` is nullable and null means UNCAPPED, which is
    -- the opposite of single-use. Without it a shared code's redemptions would
    -- all carry a null here and fail the NOT NULL, which is at least loud — but
    -- a three-valued comparison feeding a boolean guard is worth closing on
    -- purpose rather than by accident.
    SELECT COALESCE(max_uses = 1, FALSE) INTO NEW.single_use
      FROM coupon_code WHERE coupon_code_id = NEW.coupon_code_id;
    IF NOT FOUND THEN
        -- Leave the complaint to the foreign key, which names the real problem.
        -- SELECT INTO with no row leaves a null here, and a NOT NULL violation
        -- on a column the caller never mentioned sends a reader looking in
        -- entirely the wrong place.
        NEW.single_use := FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coupon_redemption_single_use_is_not_told
    BEFORE INSERT ON coupon_redemption
    FOR EACH ROW EXECUTE FUNCTION coupon_redemption_single_use();

COMMENT ON TABLE coupon_set IS
    'The authored coupon: which rule it opens, when it runs, and the three '
    'caps. SHARED means one code everybody types; UNIQUE means one code per '
    'person, minted in bulk.';

COMMENT ON TABLE coupon_code IS
    'One code, with a state. ISSUED -> RESERVED -> REDEEMED, plus EXPIRED and '
    'CANCELLED. The state is recomputed from redemptions and open holds inside '
    'the transaction that changes them; it is a cache of those two and never a '
    'third opinion.';

COMMENT ON TABLE coupon_authorization IS
    'A use held while a basket is being paid for. Same shape as '
    'voucher_authorization (0162), on purpose: available = cap - redemptions - '
    'open holds, read inside SELECT ... FOR UPDATE.';

COMMENT ON TABLE coupon_redemption IS
    'One row per (code, sale). Unique on that pair so a retried sale cannot '
    'double-count, and unique per single-use code so a UNIQUE code has at most '
    'one redemption that was not given back.';
