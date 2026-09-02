#!/usr/bin/env python3
"""Find the label printer on this LAN, and ask it which language it speaks.

Two questions have to be answered before a tagging run is worth attempting,
and neither can be answered by looking at the machine:

  1. **Where is it.** A printer handed a DHCP lease has an address nobody
     wrote down. Port 9100 is the one it always listens on, so the subnet can
     simply be asked.

  2. **What does it understand.** Our renderer emits a strict subset of ZPL II
     (backend/src/edge/zpl.rs). A TSC printer speaks TSPL natively and only
     answers ZPL if it has been switched into emulation — and the command that
     matters most, the `^RFW` RFID write, is the likeliest one for an emulation
     to accept and ignore. A printer that replies to `~!T` but not to `~HI` is
     in TSPL mode, and the run would produce blank tags.

    python3 scripts/printer-probe.py scan                 # this machine's /24
    python3 scripts/printer-probe.py scan --network 10.0.0.0/24
    python3 scripts/printer-probe.py ask 192.168.1.50

`ask` is the one that decides the demo. `scan` only narrows the field.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import ipaddress
import socket
import sys

PORT = 9100
# Long enough to cross a switch, short enough to sweep 254 addresses quickly.
CONNECT_TIMEOUT = 0.6
# A printer answers a status query immediately or not at all; waiting longer
# only makes a silent printer take longer to report as silent.
REPLY_TIMEOUT = 2.5

# Each probe is (language, label, bytes to send, what a reply proves).
PROBES = [
    ("TSPL", "~!T  model name", b"~!T\r\n",
     "answers TSPL — this printer is in its native TSC mode"),
    ("TSPL", "~!@  firmware", b"~!@\r\n", ""),
    ("ZPL", "~HI  host identification", b"~HI\r\n",
     "answers ZPL — emulation is on, which is what the renderer needs"),
    ("ZPL", "~HS  host status", b"~HS\r\n", ""),
]


def open_port(address: str) -> bool:
    with socket.socket() as probe:
        probe.settimeout(CONNECT_TIMEOUT)
        return probe.connect_ex((address, PORT)) == 0


def scan(network: ipaddress.IPv4Network) -> list[str]:
    hosts = [str(host) for host in network.hosts()]
    print(f"scanning {network} on port {PORT} ({len(hosts)} addresses)…")
    found: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=128) as pool:
        for address, is_open in zip(hosts, pool.map(open_port, hosts)):
            if is_open:
                print(f"  open  {address}:{PORT}")
                found.append(address)
    if not found:
        print("  nothing listening on 9100.\n"
              "  A printer on a wired switch is on this subnet only if the laptop is too —\n"
              "  check the printer's own self-test page for the address it took.")
    return found


def ask(address: str) -> None:
    print(f"\n{address}:{PORT}")
    answered: set[str] = set()
    for language, name, payload, meaning in PROBES:
        # A fresh connection per probe: a printer that ignores one query may
        # leave the stream in a state where the next answer never arrives, and
        # that would read as a second failure rather than one.
        try:
            with socket.create_connection((address, PORT), timeout=CONNECT_TIMEOUT) as link:
                link.settimeout(REPLY_TIMEOUT)
                link.sendall(payload)
                reply = link.recv(2048)
        except OSError as error:
            print(f"  {name:26} — {error}")
            continue
        if reply:
            answered.add(language)
            shown = reply.decode("utf-8", errors="replace").strip().replace("\r\n", " | ")
            print(f"  {name:26} → {shown}")
            if meaning:
                print(f"  {'':26}   {meaning}")
        else:
            print(f"  {name:26} — silence")

    print()
    if "ZPL" in answered:
        print("  ZPL is understood. Print a real tag next and read it back with a "
              "handheld:\n  a label that prints and reads empty means the emulation "
              "accepted ^RFW and dropped it.")
    elif "TSPL" in answered:
        print("  TSPL only. The renderer's ZPL will not print as-is. Either switch the\n"
              "  printer's command language to ZPL/ZGL in TSC Console, or the node needs\n"
              "  a TSPL renderer written against this model's manual.")
    else:
        print("  Nothing answered. The port is open but the peer is not a printer, or it\n"
              "  only speaks when spoken to in a language not tried here.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    scanner = sub.add_parser("scan", help="sweep a subnet for anything listening on 9100")
    scanner.add_argument("--network", default=None,
                         help="CIDR to sweep; defaults to this machine's /24")
    scanner.add_argument("--ask", action="store_true",
                         help="interrogate every address found")

    asker = sub.add_parser("ask", help="interrogate one printer")
    asker.add_argument("address")

    args = parser.parse_args()

    if args.command == "ask":
        ask(args.address)
        return 0

    if args.network is None:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            # Nothing is sent; this only asks the routing table which address
            # this machine would use, which is the subnet the printer shares.
            probe.connect(("8.8.8.8", 53))
            local = probe.getsockname()[0]
        network = ipaddress.ip_network(f"{local}/24", strict=False)
        print(f"this machine is {local}")
    else:
        network = ipaddress.ip_network(args.network, strict=False)

    found = scan(network)
    if args.ask:
        for address in found:
            ask(address)
    elif found:
        print(f"\nnow ask one: python3 scripts/printer-probe.py ask {found[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
