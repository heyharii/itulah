-- A label job knows the delivery line its goods came in on (0071), so the
-- Printing station can list labels by purchase order. The centre has always
-- sent it (`receipt_line_id` on the job); the node did not keep it.
ALTER TABLE tagging_job ADD COLUMN receipt_line_id TEXT;
CREATE INDEX IF NOT EXISTS ix_tagging_job_receipt_line ON tagging_job(receipt_line_id);
