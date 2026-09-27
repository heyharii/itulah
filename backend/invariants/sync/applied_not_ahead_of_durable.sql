-- id: sync.applied_not_ahead_of_durable
-- severity: critical
-- rule: the centre never applies a fact it has not durably received: applied_seq ≤ durable_seq per (origin, generation)
-- enforced: Rust sync::apply_one; DB only checks each is ≥ 0
-- requires: sync_applied_watermark, sync_ingest_watermark
-- mutate: UPDATE sync_applied_watermark SET applied_seq = applied_seq + 1000000 WHERE (origin_id, generation) = (SELECT origin_id, generation FROM sync_applied_watermark ORDER BY 1, 2 LIMIT 1)
SELECT a.origin_id, a.generation, a.applied_seq, i.durable_seq
  FROM sync_applied_watermark a
  LEFT JOIN sync_ingest_watermark i ON i.origin_id = a.origin_id AND i.generation = a.generation
 WHERE i.durable_seq IS NULL OR a.applied_seq > i.durable_seq
