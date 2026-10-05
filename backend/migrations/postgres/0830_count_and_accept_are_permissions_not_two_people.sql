-- 0828: Who may count and who may accept is a permission, not two names.
--
-- The owner (2026-10-04): the person who raised a purchase order may also
-- count its deliveries, and one person may count and accept. Which of the two
-- acts a caller may perform is decided by their role and permission — the
-- stage's performer role on a flow, the route's permission ladder — and by
-- nothing else. The two-person rules come off the goods:
--
--   * `flow_stage_state`'s trigger no longer refuses a verification by the
--     person who did the blind count (0617's "the verifier is never the
--     checker"). The approver-is-not-the-requester arm STAYS: that is the
--     approval stage's own rule, untouched.
--   * `goods_receipt_line`'s CHECK (counted_by <> verified_by) is dropped
--     (0028). Both names are still required — a receipt nobody counted, or
--     nobody accepted, is still refused.
--
-- The blind count keeps its other rules: the checker still never sees the
-- ordered quantity or the price, and a stage that is done stays done.

CREATE OR REPLACE FUNCTION flow_stage_state_two_people() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'DONE' AND NEW.stage_kind = 'APPROVAL'
       AND EXISTS (SELECT 1 FROM flow_document d
                    WHERE d.id = NEW.document_id AND d.requested_by = NEW.done_by) THEN
        RAISE EXCEPTION 'the approver is never the person who asked (0617)';
    END IF;
    -- A stage that is done stays done. A recount reopens the blind count; a
    -- reversal (unpack, reopen a koli, unship, unload) reopens its step while
    -- nothing has departed. Nothing else moves backwards.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IN ('DONE', 'SKIPPED') AND NEW.status <> OLD.status
           AND NOT (NEW.status = 'PENDING'
                    AND OLD.stage_kind IN ('BLIND_COUNT', 'PACK', 'CLOSE_KOLI', 'SHIP', 'LOAD')) THEN
            RAISE EXCEPTION 'stage % of flow % is % and stays so (0617)',
                OLD.stage_kind, OLD.document_id, OLD.status;
        END IF;
        IF OLD.status = 'DONE' AND NEW.status = 'PENDING'
           AND OLD.stage_kind IN ('PACK', 'CLOSE_KOLI', 'SHIP', 'LOAD')
           AND EXISTS (SELECT 1 FROM flow_stage_state d
                        WHERE d.document_id = NEW.document_id
                          AND d.stage_kind IN ('DEPART', 'HANDOVER_WITH_PROOF')
                          AND d.status = 'DONE') THEN
            RAISE EXCEPTION 'goods of flow % have departed; they are received, not reversed (0617)',
                NEW.document_id;
        END IF;
    END IF;
    RETURN NEW;
END
$$;

ALTER TABLE goods_receipt_line DROP CONSTRAINT goods_receipt_line_check;
