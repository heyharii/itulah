#!/usr/bin/env python3
"""Print the cloud-hosted Gudang's labels on the warehouse's own printer.

When the Gudang runs inside the cloud (INVENTORY_DC_HOSTING=cloud), the cloud
cannot open a socket to a printer on the warehouse LAN. This runs on any
machine in the warehouse that can reach both: it asks the cloud for the next
print job over HTTPS (outbound only — nothing to open on the router), hands
it to the printer, and tells the cloud how it went. A label counts as printed
only when this says the printer took it.

In the print bench, set the printer's address to `bridge:<name>` (and the
printer's real port, normally 9100). Then, in the warehouse:

    # a network label printer on the warehouse LAN
    python3 scripts/print-bridge-cloud.py --cloud https://34-128-98-21.sslip.io \\
        --key "$PRINT_BRIDGE_KEY" --name gudang --printer 192.168.1.50

    # a USB printer installed as a queue (macOS / Linux: lp; Windows: pywin32)
    python3 scripts/print-bridge-cloud.py --cloud https://… --key … --name gudang \\
        --queue TSC_MB240T

Standard library only (pywin32 for a Windows queue). Leave it running; it
reconnects by itself.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import json
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

RFID = re.compile(r"\^RFW,[^^]*\^FD([0-9A-Fa-f]+)\^FS")


def log(message: str) -> None:
    print(f"{datetime.datetime.now():%H:%M:%S}  {message}", flush=True)


def call(args, method: str, path: str, body: dict | None = None, timeout: float = 40):
    url = args.cloud.rstrip("/") + "/api/v1/dc/print-bridge" + path
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {args.key}")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        return response.status, (json.loads(raw) if raw else None)


def to_socket(host: str, port: int, payload: bytes) -> None:
    with socket.create_connection((host, port), timeout=10) as connection:
        connection.sendall(payload)


def to_queue(queue: str, payload: bytes) -> None:
    if sys.platform.startswith("win"):
        import win32print  # pywin32

        handle = win32print.OpenPrinter(queue)
        try:
            win32print.StartDocPrinter(handle, 1, ("label", None, "RAW"))
            try:
                win32print.StartPagePrinter(handle)
                win32print.WritePrinter(handle, payload)
                win32print.EndPagePrinter(handle)
            finally:
                win32print.EndDocPrinter(handle)
        finally:
            win32print.ClosePrinter(handle)
        return
    with tempfile.NamedTemporaryFile(suffix=".prn") as job:
        job.write(payload)
        job.flush()
        # Raw: CUPS must hand the commands over, not render them.
        subprocess.run(["lp", "-d", queue, "-o", "raw", job.name], check=True,
                       capture_output=True)


def deliver(args, job: dict) -> None:
    payload = base64.b64decode(job["payload_base64"])
    epcs = RFID.findall(payload.decode("utf-8", errors="replace"))
    target = args.queue or f"{args.printer}:{args.port or job['port']}"
    log(f"job {job['job_id'][:8]}  {len(payload)} bytes  {len(epcs)} EPC  → {target}")
    if args.queue:
        to_queue(args.queue, payload)
    else:
        to_socket(args.printer, int(args.port or job["port"]), payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cloud", required=True, help="the cloud's address, e.g. https://34-128-98-21.sslip.io")
    parser.add_argument("--key", required=True, help="PRINT_BRIDGE_KEY, as set on the cloud")
    parser.add_argument("--name", required=True, help="this bridge's name: the bench's bridge:<name>")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--printer", help="the label printer's address on the warehouse LAN")
    target.add_argument("--queue", help="a print queue on this machine (USB printers)")
    parser.add_argument("--port", type=int, help="the printer's port (default: the bench's port)")
    args = parser.parse_args()

    log(f"bridge {args.name} asking {args.cloud} for print jobs")
    failures = 0
    while True:
        try:
            status, job = call(args, "GET", f"/next?name={urllib.request.quote(args.name)}")
            failures = 0
        except urllib.error.HTTPError as error:
            if error.code == 401:
                log("the cloud refused the key; check PRINT_BRIDGE_KEY")
                return 2
            failures += 1
            log(f"cloud answered {error.code}; trying again")
            time.sleep(min(30, 2 * failures))
            continue
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            failures += 1
            log(f"cannot reach the cloud ({error}); trying again")
            time.sleep(min(30, 2 * failures))
            continue
        if status == 204 or not job:
            continue
        outcome = {"ok": True}
        try:
            deliver(args, job)
        except Exception as error:  # the printer said no: report, never crash
            log(f"    printer refused: {error}")
            outcome = {"ok": False, "error": str(error)}
        try:
            call(args, "POST", f"/jobs/{job['job_id']}/result", outcome, timeout=15)
        except Exception as error:
            log(f"    could not report the outcome ({error})")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
