#!/usr/bin/env python3
"""Give a printer that has no network a socket the DC node can talk to.

The node prints by opening a TCP connection to `host:9100` and writing the
job. That is what every network label printer listens on, and it is the only
thing `backend/src/edge/printing.rs` knows how to do — deliberately, because a
warehouse printer is on a LAN and nothing else needs to be true.

A printer on the end of a USB cable is not on a LAN. Neither is a virtual one
installed as a print queue. This listens where the node expects a printer and
hands each job to a queue instead, so the bench, the run, the repoint and the
reprint all work unchanged and nothing in the node has to learn about USB.

    lpstat -p                                   # what queues exist
    python3 scripts/print-bridge.py --queue VirtualZPLPrinter_hari
    python3 scripts/print-bridge.py --queue TSC_MB240T --port 9101

Then put this machine's address and that port into the print bench.

Raw, always: `lp -o raw` hands the bytes over untouched. Without it CUPS would
try to render ZPL as if it were a document, and the printer would be sent a
picture of the commands rather than the commands.
"""
from __future__ import annotations

import argparse
import datetime
import pathlib
import re
import socketserver
import subprocess
import sys
import tempfile

RFID = re.compile(r"\^RFW,[^^]*\^FD([0-9A-Fa-f]+)\^FS|RFWRITE [^,]+,[^,]+,[^,]+,\"([0-9A-Fa-f]+)\"")


def epcs_in(payload: str) -> list[str]:
    return [zpl or tspl for zpl, tspl in RFID.findall(payload)]


class Bridge(socketserver.StreamRequestHandler):
    timeout = 30

    def handle(self) -> None:
        raw = self.rfile.read()
        if not raw:
            return
        text = raw.decode("utf-8", errors="replace")
        stamp = datetime.datetime.now().strftime("%H:%M:%S")
        language = "ZPL" if "^XA" in text else "TSPL" if "PRINT " in text else "?"
        found = epcs_in(text)

        print(f"\n── {stamp}  {len(raw)} bytes  {language}  "
              f"{len(found)} EPC" + ("" if len(found) == 1 else "s"))
        for epc in found:
            print(f"    {epc}")
        if not found:
            # Said plainly: this is what a dropped RFID write looks like.
            print("    no RFID write in this job")

        with tempfile.NamedTemporaryFile(suffix=".prn", delete=False) as handle:
            handle.write(raw)
            path = pathlib.Path(handle.name)
        try:
            result = subprocess.run(
                ["lp", "-o", "raw", "-d", self.server.queue, str(path)],
                capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                print(f"    -> {self.server.queue}: {result.stdout.strip()}")
            else:
                print(f"    -> {self.server.queue} REFUSED: "
                      f"{(result.stderr or result.stdout).strip()[:200]}")
        except (OSError, subprocess.SubprocessError) as error:
            print(f"    -> could not reach lp: {error}")
        finally:
            path.unlink(missing_ok=True)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    queue = ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--queue", required=True, help="CUPS queue name, from `lpstat -p`")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=9100)
    args = parser.parse_args()

    queues = subprocess.run(["lpstat", "-p"], capture_output=True, text=True)
    if args.queue not in queues.stdout:
        print(f"no queue named {args.queue}. What this machine has:\n{queues.stdout}")
        return 1

    Server.queue = args.queue
    with Server((args.host, args.port), Bridge) as server:
        print(f"bridge: {args.host}:{args.port} -> queue {args.queue} (raw) — Ctrl-C to stop")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
