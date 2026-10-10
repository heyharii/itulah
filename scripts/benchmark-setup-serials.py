#!/usr/bin/env python3
"""Replay serial reservation SQL, using only connection-local temporary data.

Run: python3 scripts/benchmark-setup-serials.py [postgresql:///postgres]
Timings include psql/database round trips; this is not full setup latency.
"""

import json
import re
import statistics
import subprocess
import sys

sql = """
SET statement_timeout = '30s';
CREATE TEMP TABLE bench_epc_counter (
    sku_code text PRIMARY KEY, last_serial bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bench_epc_counter (sku_code, last_serial)
SELECT 'SKU-' || n, 100 FROM generate_series(1, 100) n;
"""
for _ in range(5):
    for variant in ("before", "after"):
        sql += "\nBEGIN;\n\\echo " + variant + "\n\\timing on\n"
        if variant == "before":
            for number in range(1, 101):
                sku = f"SKU-{number}"
                sql += f"""
INSERT INTO bench_epc_counter (sku_code, last_serial) VALUES ('{sku}', 0)
ON CONFLICT (sku_code) DO NOTHING;
SELECT last_serial FROM bench_epc_counter WHERE sku_code = '{sku}' FOR UPDATE;
UPDATE bench_epc_counter SET last_serial = 110, updated_at = now()
WHERE sku_code = '{sku}';
"""
        else:
            sql += """
INSERT INTO bench_epc_counter (sku_code, last_serial)
SELECT sku_code, quantity
FROM unnest(ARRAY(SELECT 'SKU-' || n FROM generate_series(1, 100) n),
            ARRAY(SELECT 10::bigint FROM generate_series(1, 100)))
     AS requested(sku_code, quantity)
ORDER BY sku_code
ON CONFLICT (sku_code) DO UPDATE
SET last_serial = bench_epc_counter.last_serial + EXCLUDED.last_serial,
    updated_at = now()
WHERE bench_epc_counter.last_serial <= 9223372036854775807::bigint - EXCLUDED.last_serial
RETURNING sku_code, last_serial;
"""
        sql += "\\timing off\nROLLBACK;\n"

result = subprocess.run(
    ["psql", sys.argv[1] if len(sys.argv) > 1 else "postgresql:///postgres",
     "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    input=sql, text=True, capture_output=True, check=True,
)
measurements = {"before": [], "after": []}
variant = None
times = []
for line in result.stdout.splitlines():
    if line in measurements:
        if variant:
            measurements[variant].append(sum(times))
        variant = line
        times = []
    elif line.startswith("Time:"):
        times.append(float(re.search(r"Time: ([\d.]+) ms", line).group(1)))
if variant:
    measurements[variant].append(sum(times))
for variant, times in measurements.items():
    print(json.dumps({
        "serial_reservation": variant,
        "variants": 100,
        "queries": 300 if variant == "before" else 1,
        "median_ms": statistics.median(times),
        "runs_ms": times,
    }))
