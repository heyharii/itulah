-- An investigation stays on the grievance it answered.
--
-- 0343 paired `investigated_by` with the INVESTIGATED state alone, so the
-- moment head office resolved, invalidated, or the filer withdrew an
-- investigated grievance, the row broke its own CHECK: the domain carries the
-- investigation into RESOLVED and INVALID (a decision stands on the inquiry
-- that preceded it), and the UPDATE leaves the columns where they are. Every
-- resolution therefore failed with a constraint violation.
--
-- The investigation is written once and never erased. What the schema can
-- say is: an OPEN grievance has not been investigated, and a decided one has.
-- A WITHDRAWN grievance may be either, because the filer may take it back
-- before or after the inquiry.
ALTER TABLE employee_grievance DROP CONSTRAINT employee_grievance_check1;

ALTER TABLE employee_grievance
    ADD CONSTRAINT employee_grievance_investigation_matches_state CHECK (
        CASE state
            WHEN 'OPEN' THEN investigated_by IS NULL
            WHEN 'WITHDRAWN' THEN true
            ELSE investigated_by IS NOT NULL
        END
    );
