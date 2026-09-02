#!/usr/bin/env python3
"""Stand in for the label printer, and say out loud what reached the wire.

A print run that produces no tag tells you nothing about where it broke: the
node may not have claimed a chunk, the chunk may have carried no EPC, or the
printer may simply be off. This listens on the port a printer listens on and
reports every job it is handed, so the failure has an address.

It is also the only way to see the RFID write. `^RFW` leaves no ink: a tag can
print perfectly and carry nothing, which is exactly what a ZPL emulation that
ignores the command looks like from the other side of the room. Here it is
either in the payload or it is not.

    python3 scripts/label-sink.py                 # 0.0.0.0:9100
    python3 scripts/label-sink.py --port 9101 --save /tmp/jobs

Point the DC bench at this host and press the same button the demo will use.
"""
from __future__ import annotations

import argparse
import datetime
import pathlib
import re
import socketserver
import sys

# Full form only: `^RFW,t,b,n,r^FD<hex>^FS`. The shorthand `^RFW,E` is
# deliberately not emitted by the renderer, so seeing it here would mean
# something other than our node is talking to this socket.
RFID = re.compile(r"\^RFW,([^,]+),(\d+),(\d+),(\d+)\^FD([0-9A-Fa-f]+)\^FS")
FIELD = re.compile(r"\^FD(.*?)\^FS", re.S)
QUANTITY = re.compile(r"\^PQ(\d+)")

# A printer holds the socket open between jobs, so end-of-stream is not what
# marks the end of a job: `^XZ` is. Anything still buffered when the peer goes
# away is reported as a fragment rather than silently dropped.
END = "^XZ"


def describe(label: str, index: int) -> str:
    fields = [text.strip() for text in FIELD.findall(label) if not text.startswith("^")]
    rfid = RFID.search(label)
    quantity = QUANTITY.search(label)
    copies = quantity.group(1) if quantity else "1"

    lines = [f"  label {index}  ×{copies}"]
    if rfid:
        bank, byte_count, hex_payload = rfid.group(2), rfid.group(3), rfid.group(5)
        bits = len(hex_payload) * 4
        ink = [value for value in fields if value != hex_payload]
        lines.append(f"    EPC   {hex_payload}  ({bits}-bit, bank {bank}, {byte_count} bytes)")
    else:
        ink = fields
        # Said as a finding, not a warning in passing: a run of these is the
        # whole demo failing quietly.
        lines.append("    EPC   NONE — this label carries no RFID write")
    if ink:
        lines.append("    ink   " + " · ".join(ink))
    return "\n".join(lines)


class Sink(socketserver.StreamRequestHandler):
    # Long enough that a slow chunk is not mistaken for a finished job, short
    # enough that a wedged sender does not hold the report forever.
    timeout = 30

    def handle(self) -> None:
        peer = self.client_address[0]
        started = datetime.datetime.now().strftime("%H:%M:%S")
        raw = self.rfile.read()
        text = raw.decode("utf-8", errors="replace")

        print(f"\n── {started}  {len(raw)} bytes from {peer} " + "─" * 24)

        if "^XA" not in text:
            # A TSC in its native mode answers in TSPL, and none of the above
            # will match. Show the head of it rather than reporting "0 labels",
            # which would read as a node problem when it is a printer-language
            # problem.
            print("  NOT ZPL — no ^XA in this payload. First 400 bytes:")
            print("  " + text[:400].replace("\n", "\n  "))
            self.server.jobs += 1
            self.save(raw, peer)
            return

        labels = [chunk for chunk in text.split(END) if "^XA" in chunk]
        encoded = sum(1 for chunk in labels if RFID.search(chunk))
        trailing = text.rsplit(END, 1)[-1]

        for index, label in enumerate(labels, start=1):
            print(describe(label, index))
        if trailing.strip() and "^XA" in trailing:
            print("  (a fragment arrived without its ^XZ — the sender was cut off)")

        print(f"  {len(labels)} label(s), {encoded} with an EPC")
        self.server.jobs += 1
        self.server.labels += len(labels)
        self.save(raw, peer)

    def save(self, raw: bytes, peer: str) -> None:
        if self.server.save_to is None:
            return
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        path = self.server.save_to / f"{stamp}-{peer}.zpl"
        path.write_bytes(raw)
        print(f"  saved  {path}")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    jobs = 0
    labels = 0
    save_to: pathlib.Path | None = None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=9100)
    parser.add_argument("--save", type=pathlib.Path, default=None,
                        help="directory to write each raw job into")
    args = parser.parse_args()

    Server.save_to = args.save
    if args.save is not None:
        args.save.mkdir(parents=True, exist_ok=True)

    with Server((args.host, args.port), Sink) as server:
        print(f"label sink listening on {args.host}:{args.port} — Ctrl-C to stop")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print(f"\n{server.jobs} job(s), {server.labels} label(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
