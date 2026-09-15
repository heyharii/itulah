-- 0258: A staff purchase is a discount somebody is entitled to, counted.
--
-- Asked for by Hari 2026-09-09: "employee discount ini bisa reset, bisa tau yg
-- dibeli, bisa tau berapa transaksi dan totalnya berapa".
--
-- # Why the entitlement lives in People and not in Commercial
--
-- Commercial owns *prices* — what a shop charges, which rule is live, what a
-- campaign may spend. A staff discount is not a price: it is a **term of
-- employment**. It begins when somebody is hired, it is set by grade, and it
-- must stop on the day they leave — which is a fact this module holds and the
-- pricing engine does not. A rule that lived in Commercial would keep paying
-- out to a leaver until somebody remembered to retire it, and "somebody
-- remembered" is not a control.
--
-- The *application* of the discount at the till is still Commercial's, and that
-- is the right seam: People says who is entitled to what, Commercial works out
-- what the basket costs, and the till reports back what was actually bought.
--
-- # Why a used-so-far column would be the wrong shape
--
-- The obvious model is one row per employee with `quota` and `used`, reset by
-- writing `used = 0`. It is wrong here for the same reason it is wrong for
-- leave: the moment the counter is overwritten, the question "what did this
-- allowance actually pay for" has no answer, and that question is the whole
-- point of Hari's request. Somebody will ask why a quota ran out in the third
-- week, and a column that was zeroed cannot say.
--
-- So usage is a **fold over purchases inside the window**, exactly as a leave
-- balance is a fold over its ledger. The window is decided by the policy's
-- period, and a manual reset opens a new one early rather than erasing the old.

-- What an operator has ratified: who is entitled, to how much off, and how much
-- of it they may spend before the window turns over.
--
-- Effective-dated generations rather than an editable row, because changing the
-- rate has to leave last month's purchases meaning what they meant when they
-- were rung up.
CREATE TABLE employee_discount_policy (
    version        integer PRIMARY KEY CHECK (version > 0),
    -- Which grade this generation covers. NULL is the house rule, and a row
    -- naming a grade overrides it for that grade alone.
    --
    -- Deliberately not a foreign key: grade is still free text on
    -- `employee_contract` (see the audit of 2026-09-09), and a foreign key to a
    -- master that does not exist yet would be a promise this migration cannot
    -- keep. The day grades become master data, this column joins them.
    grade          text CHECK (grade IS NULL OR btrim(grade) <> ''),
    -- Basis points off the shelf price: 1000 is ten per cent. Basis points
    -- rather than a percentage with decimals, because "twelve and a half per
    -- cent" is a real answer and 12.5 stored as a float is not the same number
    -- twice.
    rate_bp        integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
    -- How much discount may be spent in one window, in minor units. NULL means
    -- the rate applies without a ceiling — a real answer for a small chain, and
    -- it has to be distinguishable from a ceiling of nothing.
    quota_minor    bigint CHECK (quota_minor IS NULL OR quota_minor >= 0),
    -- What the quota is counted against: the discount given, or the amount
    -- spent. Both are asked for in practice — "Rp 500.000 off a year" and
    -- "Rp 5.000.000 of goods a year" are different policies — and guessing
    -- which one an operator meant is how a quota silently runs ten times long.
    quota_measure  text NOT NULL DEFAULT 'DISCOUNT'
                   CHECK (quota_measure IN ('DISCOUNT', 'SPEND')),
    -- When the window turns over.
    period         text NOT NULL CHECK (period IN ('MONTHLY', 'YEARLY')),
    effective_from date NOT NULL,
    ratified       jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- A quota with no measure to count is unreachable; a measure with no quota
    -- counts nothing. Neither is an error, but the pair must be coherent.
    CONSTRAINT employee_discount_policy_quota_is_bounded_or_absent
        CHECK (quota_minor IS NOT NULL OR quota_measure = 'DISCOUNT')
);

-- At most one generation per grade per effective date, so "which rule applied
-- on the 14th" has one answer.
CREATE UNIQUE INDEX ix_employee_discount_policy_generation
    ON employee_discount_policy (COALESCE(grade, ''), effective_from);

COMMENT ON TABLE employee_discount_policy IS
    'Effective-dated staff discount generations. A row naming a grade overrides '
    'the house rule (grade IS NULL) for that grade alone.';

-- One staff purchase, as the till reported it.
--
-- The till is the only thing that knows what was in the basket, so this table
-- is written from the shop rather than derived here. It carries the basket's
-- shape — how many lines, what they were, what they came to — because "bisa
-- tau yg dibeli" is not answerable from a total.
CREATE TABLE employee_purchase (
    id             text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id    text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- Where it was bought, which is not necessarily where they work: staff buy
    -- at the shop they happen to be in, and a report that assumed otherwise
    -- would file a purchase against the wrong place's discount cost.
    place_id       text NOT NULL REFERENCES org_place(id),
    -- The till's own sale, once it has synced. Nullable because the purchase is
    -- recorded when it happens and the sale arrives on its own schedule; a
    -- purchase that waited for the sync would be a purchase the quota did not
    -- know about while somebody was still at the counter.
    sale_id        uuid,
    bought_on      date NOT NULL,
    line_count     integer NOT NULL CHECK (line_count > 0),
    -- Before the discount, the discount itself, and what was actually paid.
    -- All three stored rather than two and a subtraction: the till computed
    -- them together, and a figure this system recomputes is a figure that can
    -- disagree with the receipt in the customer's hand.
    gross_minor    bigint NOT NULL CHECK (gross_minor >= 0),
    discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
    net_minor      bigint NOT NULL CHECK (net_minor >= 0),
    -- What was bought: `[{ sku_id, description, quantity, gross_minor }]`.
    -- JSONB rather than rows because nothing joins to it — it is read back
    -- whole, as the answer to "what did they buy", and never aggregated across
    -- purchases by SKU. The day somebody asks *that* question it becomes a
    -- table, and that will be a different migration with a reason.
    items          jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Who rang it up. A staff purchase served by the buyer themselves is the
    -- shape this records rather than forbids: the shop decides whether that is
    -- allowed, and the record is what makes the decision reviewable.
    served_by      text,
    recorded_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_purchase_net_is_gross_less_discount
        CHECK (net_minor = gross_minor - discount_minor),
    -- A discount larger than the goods is either a refund wearing the wrong
    -- clothes or a typo, and neither should be stored as a purchase.
    CONSTRAINT employee_purchase_discount_fits_the_basket
        CHECK (discount_minor <= gross_minor)
);

CREATE INDEX ix_employee_purchase_employee
    ON employee_purchase (employee_id, bought_on DESC, id);
CREATE INDEX ix_employee_purchase_place
    ON employee_purchase (place_id, bought_on DESC, id);
-- One purchase per synced sale. A till that retries its report must not spend
-- the quota twice, and the natural key for that is the sale it came from.
CREATE UNIQUE INDEX ix_employee_purchase_sale
    ON employee_purchase (sale_id) WHERE sale_id IS NOT NULL;

COMMENT ON TABLE employee_purchase IS
    'What a member of staff bought under their discount, as the till reported '
    'it. Usage is folded from these rows inside the current window; there is no '
    'used-so-far column, because a counter that is overwritten cannot say what '
    'it was spent on.';

-- Opening a new window before the calendar would have.
--
-- "Bisa reset" has two readings and this table is the second one. The first —
-- the window turning over each month or each year — needs no table at all,
-- because it is arithmetic on `bought_on`. This is the other: head office
-- deciding that somebody starts again now, which is a decision with an author
-- and a reason, and therefore a row.
--
-- It never deletes a purchase. The old window's purchases stay exactly where
-- they are and stop counting, which is what makes "why did this reset" a
-- question with an answer six months later.
CREATE TABLE employee_discount_reset (
    id           text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id  text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- The first day of the new window. Purchases before it belong to a window
    -- that is over.
    opens_on     date NOT NULL,
    reason       text NOT NULL CHECK (btrim(reason) <> ''),
    authorized   jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_employee_discount_reset_employee
    ON employee_discount_reset (employee_id, opens_on DESC, id);

COMMENT ON TABLE employee_discount_reset IS
    'A window opened early by head office. The calendar reset needs no row; '
    'this is the deliberate one, and it carries its author and its reason.';
