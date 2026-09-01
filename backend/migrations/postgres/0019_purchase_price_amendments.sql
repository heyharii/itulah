-- A DC asking head office to change a price, and head office's answer.
--
-- # Why this is a request and not an action
--
-- The verifier is the only person who ever sees the supplier's invoice; the
-- system does not. So when the invoice says something the order does not, the
-- verifier is the only one who can notice — but they are not the one who may
-- decide. A warehouse that could rewrite the price it is being billed at
-- would be settling the company's debts from the loading bay.
--
-- So it travels as a request: raised at the DC, decided by whoever raised the
-- order, and the decision travels back. This is the first thing in the system
-- to go up as a question and come back as an answer, joined by
-- `causation_request_id`.
--
-- # Why the requested price is kept even when refused
--
-- A refused request is the record that someone looked at the invoice and
-- disagreed with the order. That is worth more than the amendment would have
-- been: a supplier who repeatedly bills above the agreed price leaves a trail
-- here, and nowhere else.

CREATE TABLE purchase_price_amendment (
    request_id          uuid PRIMARY KEY,
    po_line_id          uuid NOT NULL REFERENCES purchase_order_line(po_line_id) ON DELETE CASCADE,
    origin_id           text NOT NULL,
    generation          bigint NOT NULL,
    seq                 bigint NOT NULL,
    -- The count that was held up by this. A verifier raises the request
    -- INSTEAD of accepting, so the delivery waits for the answer.
    count_id            uuid NOT NULL,
    -- What the ordered price was when the request was raised, kept so a later
    -- reader can see the gap without reconstructing history.
    ordered_price_minor bigint NOT NULL CHECK (ordered_price_minor >= 0),
    -- What the invoice in the verifier's hand actually said.
    invoiced_price_minor bigint NOT NULL CHECK (invoiced_price_minor >= 0),
    note                text NOT NULL CHECK (btrim(note) <> ''),
    requested_by        text NOT NULL,
    requested_at        timestamptz NOT NULL,
    received_at         timestamptz NOT NULL DEFAULT now(),

    status              text NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    decided_by          text,
    decided_at          timestamptz,
    decision_note       text,
    -- The command that carried the answer back to the DC.
    decision_command_id uuid,
    CHECK ((status = 'PENDING') = (decided_at IS NULL)),
    CHECK ((status = 'PENDING') = (decided_by IS NULL))
);
CREATE INDEX ix_price_amendment_pending ON purchase_price_amendment (status, requested_at);
CREATE INDEX ix_price_amendment_line ON purchase_price_amendment (po_line_id);
