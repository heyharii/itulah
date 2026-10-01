-- 0816: an employee asks for their own details to be changed, and HR decides.
--
-- Talenta's "change data request", for the details a person owns and HR
-- keeps: phone, email and address. The request names one field and the value
-- it should become; approving it amends the personal data through the same
-- kernel HR's own edit uses, signed by the approver, so the profile's trail
-- says who changed it and on whose request. Name, NIK and date of birth are
-- not asked for here — they change against a document, which HR keys in.
-- A request is never deleted: withdrawn, rejected and approved ones stay.

CREATE TABLE personal_data_request (
    id           text PRIMARY KEY CHECK (btrim(id) <> ''),
    employee_id  text NOT NULL REFERENCES employee (id),
    field        text NOT NULL CHECK (field IN ('phone', 'email', 'address')),
    -- The value asked for. Empty clears a phone or an email; an address
    -- cannot be cleared.
    value        text NOT NULL,
    reason       text NOT NULL CHECK (btrim(reason) <> ''),
    state        text NOT NULL DEFAULT 'PENDING'
                 CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    filed        jsonb NOT NULL,
    decided      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT personal_data_request_address_is_not_cleared
        CHECK (field <> 'address' OR btrim(value) <> ''),
    CONSTRAINT personal_data_request_decision_is_signed
        CHECK ((state IN ('PENDING')) = (decided IS NULL))
);

CREATE INDEX ix_personal_data_request_employee
    ON personal_data_request (employee_id, created_at DESC);
CREATE INDEX ix_personal_data_request_pending
    ON personal_data_request (created_at) WHERE state = 'PENDING';
