-- A store opens when head office says so.
--
-- Opening a store is a run of physical steps at the shop — the server PC
-- installed, the tills switched on and let in, the team's fingers enrolled,
-- the first lorry received — and one decision at head office: "Open store"
-- (`store-opening-flow.html`, phase 6). Until that decision the store is
-- getting ready, and its tills do not open a shift. So a unit says when it was
-- opened and by whom, and the store's status is read from that and nothing
-- else:
--
--   CLOSED         the unit is closed (`unit.status`, 0600);
--   OPEN           `unit.opened_at` is set;
--   GETTING_READY  otherwise.
--
-- Derived, never stored as a word: a status column beside `opened_at` would be
-- two answers to one question. What decides whether the button may be pressed
-- — the server's heartbeat, a till seen, a team and its PIC, a payment method,
-- the first delivery received — is read from the data those steps already
-- write (`postgres/stores.rs`); a checkbox somebody ticks would say what they
-- believed.
--
-- # The stores that already trade
--
-- C001-C013 and head office were trading long before this column existed.
-- They are marked opened at the moment their unit was created, by
-- `migration:0630`, so none of their tills is told to wait for a decision
-- nobody will ever take. A unit the setup wizard opens after this starts with
-- no `opened_at`: it is getting ready until an Admin opens it from the hub.
--
-- # Head office is told
--
-- `store.opened` joins the notification kinds — 0502's list otherwise
-- unchanged — so every Admin hears "Store Bumiayu is open" the moment it is.

ALTER TABLE unit
    ADD COLUMN opened_at   timestamptz,
    ADD COLUMN opened_by   text,
    ADD COLUMN opened_note text,
    ADD CONSTRAINT unit_opening_is_whole
        CHECK ((opened_at IS NULL) = (opened_by IS NULL)),
    ADD CONSTRAINT unit_opened_by_somebody
        CHECK (opened_by IS NULL OR btrim(opened_by) <> ''),
    ADD CONSTRAINT unit_opening_note_belongs_to_an_opening
        CHECK (opened_note IS NULL OR opened_at IS NOT NULL);

UPDATE unit
   SET opened_at = created_at,
       opened_by = 'migration:0630'
 WHERE kind IN ('HO', 'STORE')
   AND opened_at IS NULL;

COMMENT ON COLUMN unit.opened_at IS
    'When head office opened this unit for trade (0630). NULL: a store still getting ready, whose tills refuse to open a shift. The status the hub shows is derived: CLOSED from unit.status, else OPEN when this is set, else GETTING_READY.';
COMMENT ON COLUMN unit.opened_by IS
    'Who opened it: the Admin who pressed Open store, or migration:0630 for the units that were trading before the column existed.';
COMMENT ON COLUMN unit.opened_note IS
    'What the Admin wrote when opening the store, if anything.';

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
    CHECK (kind IN (
        'activity',
        'purchase.price_amendment.requested',
        'purchase.delivery.due_soon',
        'receipt.awaiting_identity',
        'receipt.excess_awaiting_decision',
        'finance.integrity.exception',
        'discussion.thread.opened',
        'discussion.thread.replied',
        'discussion.mentioned',
        'discussion.solution.accepted',
        'asset.assessment.overdue',
        'people.contract.expiring',
        'people.period.month_open',
        'people.roster.gap',
        'ga.contract.expiring',
        'ga.document.expiring',
        'finance.bill.due_soon',
        'finance.tax.deadline',
        'commercial.cap.near',
        'commercial.cap.reached',
        'commercial.rollout.failed',
        'commercial.rollout.stalled',
        'commercial.usage.stale',
        'commercial.guardrail.breached',
        'commercial.promotion.starting',
        'commercial.promotion.ending',
        'node.attention',
        'node.recovered',
        'assistant.brief',
        'store.opened'
    ));
