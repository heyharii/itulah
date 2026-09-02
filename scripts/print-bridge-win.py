#!/usr/bin/env python3
"""The print bridge, for a printer that hangs off a Windows laptop.

Same idea as `print-bridge.py` and the same reason: the DC node prints by
opening a TCP connection to `host:9100`, because that is what a network label
printer listens on. A printer on a USB cable is not on a LAN, so this listens
where the node expects a printer and hands each job to Windows' spooler.

RAW, always. `StartDocPrinter` is told the datatype is RAW so the bytes reach
the printer untouched; without that Windows renders them as a document and the
printer is sent a picture of the commands rather than the commands.

    py -m pip install pywin32
    py scripts\\print-bridge-win.py --printer "TSC MB240T"

`--printer` is the name exactly as it appears in Settings > Printers, and
`--list` prints the names this machine actually has.

Then, on the machine running the DC node, put THIS laptop's address in the
print bench — both machines on the same network, and the Windows firewall
asking about Python on first run must be allowed, or the connection is
refused silently from the other side.
"""
from __future__ import annotations

import argparse
import datetime
import re
import socketserver
import sys

try:
    import win32print
except ImportError:  # pragma: no cover - the message is the whole point
    print("pywin32 is missing. Install it with:  py -m pip install pywin32")
    raise SystemExit(1)

RFID = re.compile(
    r"\^RFW,[^^]*\^FD([0-9A-Fa-f]+)\^FS|RFWRITE [^,]+,[^,]+,[^,]+,\"([0-9A-Fa-f]+)\""
)


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

        print(f"\n-- {stamp}  {len(raw)} bytes  {language}  {len(found)} EPC")
        for epc in found:
            print(f"    {epc}")
        if not found:
            print("    no RFID write in this job")

        handle = win32print.OpenPrinter(self.server.printer)
        try:
            job = win32print.StartDocPrinter(handle, 1, ("label", None, "RAW"))
            try:
                win32print.StartPagePrinter(handle)
                win32print.WritePrinter(handle, raw)
                win32print.EndPagePrinter(handle)
            finally:
                win32print.EndDocPrinter(handle)
            print(f"    -> {self.server.printer}: job {job}")
        except Exception as error:  # noqa: BLE001 - report whatever the spooler said
            print(f"    -> {self.server.printer} REFUSED: {error}")
        finally:
            win32print.ClosePrinter(handle)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    printer = ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--printer", help="printer name, exactly as Windows shows it")
    parser.add_argument("--list", action="store_true", help="print the names this machine has")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=9100)
    args = parser.parse_args()

    names = [
        p[2]
        for p in win32print.EnumPrinters(
            win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        )
    ]
    if args.list or not args.printer:
        print("printers on this machine:")
        for name in names:
            print(f"  {name}")
        return 0
    if args.printer not in names:
        print(f"no printer named {args.printer!r}. This machine has:")
        for name in names:
            print(f"  {name}")
        return 1

    Server.printer = args.printer
    with Server((args.host, args.port), Bridge) as server:
        print(f"bridge: {args.host}:{args.port} -> {args.printer} (RAW) - Ctrl-C to stop")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
