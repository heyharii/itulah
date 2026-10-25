-- 0999 — a posted bill line may name the project it was for.
--
-- 0094 made a posted bill line evidence: nothing about it changes once its
-- journal is written, and a mistake is reversed, not edited. 0997 gave the
-- line a `project_id`, and a store opening's bills are mostly posted long
-- before anybody gathers them into the project — the rent, the permit, the
-- contractor's invoices. Saying which project a line was for changes nothing
-- the line recorded: not its account, its amount, its unit or its journal. So
-- that one column, and only that one, may still be set on a posted line.
CREATE OR REPLACE FUNCTION protect_posted_expense_line()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    row_state  text;
    row_number text;
BEGIN
    -- Naming the project, and nothing else: allowed at any status.
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'project_id') = (to_jsonb(OLD) - 'project_id') THEN
        RETURN NEW;
    END IF;

    SELECT status, invoice_number INTO row_state, row_number
      FROM supplier_invoice
     WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);

    -- The bill is already gone: this is the cascade tidying up after a draft,
    -- not somebody editing a booked one.
    IF NOT FOUND THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF row_state IN ('POSTED', 'VOID') THEN
        RAISE EXCEPTION
            'bill % is posted; reverse its journal entry rather than editing what it was for',
            row_number;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$function$;
