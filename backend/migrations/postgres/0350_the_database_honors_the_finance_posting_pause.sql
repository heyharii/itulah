-- Enforce the Finance posting pause at the journal boundary as well as in
-- `poster::post`. The database guard protects against older app processes and
-- any writer that has not yet picked up the application-level check.

CREATE FUNCTION enforce_finance_posting_pause()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    automatic_posting_enabled boolean;
BEGIN
    -- A Finance user explicitly submitting a manual journal or requesting a
    -- reversal remains an allowed, human-controlled action.
    IF NEW.source_kind IN ('MANUAL', 'REVERSAL') THEN
        RETURN NEW;
    END IF;

    SELECT control.automatic_posting_enabled
      INTO automatic_posting_enabled
      FROM finance_posting_control control
     WHERE control.singleton = true
     FOR SHARE;

    -- Fail closed if the singleton control row is ever missing.
    IF NOT COALESCE(automatic_posting_enabled, false) THEN
        RAISE EXCEPTION 'automatic posting is paused while Finance reviews the chart and posting maps'
            USING ERRCODE = 'P0001',
                  CONSTRAINT = 'finance_automatic_posting_paused';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER finance_posting_pause_guard
    BEFORE INSERT ON journal_entry
    FOR EACH ROW EXECUTE FUNCTION enforce_finance_posting_pause();

COMMENT ON TRIGGER finance_posting_pause_guard ON journal_entry IS
    'The database refuses source-driven journal entries while Finance has automatic posting disabled. MANUAL entries and explicit reversals remain permitted.';
