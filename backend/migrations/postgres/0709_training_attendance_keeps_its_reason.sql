-- Attendance belongs to a nominated participant, and a correction must not
-- erase the reason for the earlier answer. `attended` is the current answer;
-- the ordered JSON history keeps each actor, time, outcome, and reason.
ALTER TABLE training_participant
    ADD COLUMN attended boolean,
    ADD COLUMN attendance_history jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT training_attendance_history_is_array
        CHECK (jsonb_typeof(attendance_history) = 'array'),
    ADD CONSTRAINT training_attendance_has_a_record
        CHECK (
            (attended IS NULL AND jsonb_array_length(attendance_history) = 0)
            OR
            (attended IS NOT NULL AND jsonb_array_length(attendance_history) > 0)
        );
