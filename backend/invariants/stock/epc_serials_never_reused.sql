-- id: stock.epc_serials_never_reused
-- severity: high
-- rule: an EPC serial is issued once — the counter is at or past every serial printed, and no two tagging lines for one SKU overlap
-- enforced: Rust tagging::allocate_serials (FOR UPDATE on epc_serial_counter); DB only makes serial_from unique, overlapping ranges are not prevented
-- requires: epc_serial_counter, tagging_job_line
-- mutate: UPDATE epc_serial_counter SET last_serial = 0 WHERE sku_code = (SELECT sku_code FROM tagging_job_line WHERE serial_to > 0 ORDER BY sku_code LIMIT 1)
SELECT c.sku_code, c.last_serial, MAX(t.serial_to) AS highest_printed, NULL::text AS other_job,
       'counter behind a printed serial' AS problem
  FROM epc_serial_counter c JOIN tagging_job_line t ON t.sku_code = c.sku_code
 GROUP BY c.sku_code, c.last_serial
HAVING MAX(t.serial_to) > c.last_serial
UNION ALL
SELECT a.sku_code, a.serial_from, a.serial_to, b.job_id::text, 'two tagging lines share serials'
  FROM tagging_job_line a
  JOIN tagging_job_line b
    ON b.sku_code = a.sku_code AND a.ctid < b.ctid
   AND a.serial_from <= b.serial_to AND b.serial_from <= a.serial_to
