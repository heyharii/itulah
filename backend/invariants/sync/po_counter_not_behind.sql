-- id: sync.po_counter_not_behind
-- severity: high
-- rule: the day's purchase-order counter is at or past every PO number already filed that day, so the server never hands out a number twice (0385)
-- enforced: Rust suppliers::next_po_number (one upsert inside the order's transaction); DB UNIQUE po_number is the backstop
-- requires: purchase_order_number_day, purchase_order
-- mutate: UPDATE purchase_order_number_day SET last_serial = 0 WHERE day = (SELECT day FROM purchase_order_number_day ORDER BY day LIMIT 1)
SELECT d.day, d.last_serial, MAX(substring(po.po_number FROM '-([0-9]+)$')::int) AS highest_filed
  FROM purchase_order_number_day d
  JOIN purchase_order po ON po.po_number ~ ('^PO-' || to_char(d.day, 'YYYYMMDD') || '-[0-9]+$')
 GROUP BY d.day, d.last_serial
HAVING MAX(substring(po.po_number FROM '-([0-9]+)$')::int) > d.last_serial
