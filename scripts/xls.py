#!/usr/bin/env python3
"""Read a legacy `.xls` (BIFF8) workbook with nothing but the standard library.

The client's system — `GAPNO KH`, the same one that produced
`Laporan_Master_Account1.csv` — exports `.xls`, and every file they send
arrives in that format. There are three ways to read one:

1. `pip install xlrd`. A network fetch and a dependency for a repository that
   has none, to read a file format that will stop arriving the day they
   upgrade.
2. Ask them to save it as CSV. This is the tempting one and it is the worst:
   saving through Excel silently reformats dates by locale, drops the leading
   zeros off account codes, and turns `1,329,100` into either a number or a
   string depending on which machine did it. A column that changes meaning
   between the export and the import is the hardest kind of defect to find,
   because both files look right.
3. Read the bytes. It is about two hundred lines and it is exact.

This is (3). It reads what the file actually contains, so what the importer
sees is what the client's system wrote.

Deliberately partial: enough of BIFF8 to read a report — cells, shared
strings, cached formula results, and the number formats needed to tell a date
from a number. No styling, no charts, no formula evaluation.

    from xls import parse
    sheets = parse("MASTER ASSET.xls")     # {sheet name: {(row, col): value}}

Rows and columns are zero-based, so spreadsheet row 1,282 is key `1281`.
"""

from __future__ import annotations

import datetime
import struct
import sys

# ---------------------------------------------------------------------------
# The container: OLE2 / Compound File Binary
# ---------------------------------------------------------------------------
#
# An `.xls` is a tiny filesystem. The bytes of the workbook live in a stream
# called `Workbook` (or `Book`, in files old enough), reached through a sector
# allocation table. Streams smaller than the cutoff live in a second, finer
# allocation inside the root stream — the "mini" one — which is why there are
# two chain readers below and not one.

MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
END_OF_CHAIN = 0xFFFFFFFE


def _u16(buf: bytes, off: int) -> int:
    return struct.unpack_from("<H", buf, off)[0]


def _u32(buf: bytes, off: int) -> int:
    return struct.unpack_from("<I", buf, off)[0]


def _i32(buf: bytes, off: int) -> int:
    return struct.unpack_from("<i", buf, off)[0]


class Ole:
    """The compound file, opened far enough to hand back one named stream."""

    def __init__(self, data: bytes) -> None:
        if data[:8] != MAGIC:
            raise ValueError("not an OLE2 file; a real .xls starts with D0CF11E0")
        self.data = data
        self.sector_size = 1 << _u16(data, 0x1E)
        self.mini_size = 1 << _u16(data, 0x20)
        self.cutoff = _u32(data, 0x38)

        fat_count = _u32(data, 0x2C)
        mini_fat_count = _u32(data, 0x40)
        difat_start, difat_count = _u32(data, 0x44), _u32(data, 0x48)

        # The FAT is itself scattered, and the list of where its pieces are is
        # scattered too: 109 entries in the header, the rest in a chain.
        difat = [_u32(data, 0x4C + 4 * i) for i in range(109)]
        sector = difat_start
        for _ in range(difat_count):
            if sector >= END_OF_CHAIN:
                break
            raw = self._sector(sector)
            per = self.sector_size // 4
            difat += [_u32(raw, 4 * i) for i in range(per - 1)]
            sector = _u32(raw, 4 * (per - 1))

        self.fat: list[int] = []
        for sec in difat[:fat_count]:
            if sec >= END_OF_CHAIN:
                continue
            raw = self._sector(sec)
            self.fat += [_u32(raw, 4 * i) for i in range(self.sector_size // 4)]

        self.mini_fat: list[int] = []
        for raw in self._chain(_u32(data, 0x3C), mini_fat_count):
            self.mini_fat += [_u32(raw, 4 * i) for i in range(self.sector_size // 4)]

        self.entries: list[dict] = []
        directory = b"".join(self._chain(_u32(data, 0x30)))
        for off in range(0, len(directory) - 127, 128):
            raw = directory[off : off + 128]
            name_len = _u16(raw, 0x40)
            self.entries.append(
                {
                    "name": raw[: max(0, name_len - 2)].decode("utf-16-le", "replace"),
                    "kind": raw[0x42],
                    "start": _u32(raw, 0x74),
                    "size": _u32(raw, 0x78),
                }
            )

        root = next((e for e in self.entries if e["kind"] == 5), None)
        self.mini_stream = (
            b"".join(self._chain(root["start"]))[: root["size"]]
            if root and root["size"]
            else b""
        )

    def _sector(self, index: int) -> bytes:
        off = 512 + index * self.sector_size
        return self.data[off : off + self.sector_size]

    def _chain(self, start: int, limit: int | None = None) -> list[bytes]:
        out, sector, seen = [], start, 0
        while sector < END_OF_CHAIN and (limit is None or seen < limit):
            out.append(self._sector(sector))
            sector = self.fat[sector] if sector < len(self.fat) else END_OF_CHAIN
            seen += 1
        return out

    def _mini(self, start: int, size: int) -> bytes:
        out, sector = [], start
        while sector < END_OF_CHAIN and sum(len(p) for p in out) < size:
            off = sector * self.mini_size
            out.append(self.mini_stream[off : off + self.mini_size])
            sector = (
                self.mini_fat[sector] if sector < len(self.mini_fat) else END_OF_CHAIN
            )
        return b"".join(out)[:size]

    def stream(self, name: str) -> bytes | None:
        for entry in self.entries:
            if entry["name"] == name and entry["kind"] == 2:
                if entry["size"] < self.cutoff:
                    return self._mini(entry["start"], entry["size"])
                return b"".join(self._chain(entry["start"]))[: entry["size"]]
        return None


# ---------------------------------------------------------------------------
# The contents: BIFF8 records
# ---------------------------------------------------------------------------

BOF = 0x0809
EOF = 0x000A
CONTINUE = 0x003C
BOUNDSHEET = 0x0085
DATEMODE = 0x0022
FORMAT = 0x041E
XF = 0x00E0
SST = 0x00FC
LABELSST = 0x00FD
LABEL = 0x0204
RK = 0x027E
MULRK = 0x00BD
NUMBER = 0x0203
FORMULA = 0x0006
STRING = 0x0207
NOTE = 0x001C
TXO = 0x01B6

# Built-in number formats that mean a date. A serial number formatted with one
# of these is a date; the same serial with format 0 is the number 46,000.
BUILTIN_DATE_FORMATS = frozenset(
    list(range(14, 23)) + list(range(27, 37)) + list(range(45, 48)) + list(range(50, 59))
)


def records(data: bytes):
    """Walk (id, payload) pairs. Every BIFF record is id, length, bytes."""
    off = 0
    while off + 4 <= len(data):
        rid, length = _u16(data, off), _u16(data, off + 2)
        yield rid, data[off + 4 : off + 4 + length]
        off += 4 + length


def unicode_string(buf: bytes, off: int, wide_length: bool = True) -> tuple[str, int]:
    """An `XLUnicodeString`: a length, an options byte, then the characters."""
    if wide_length:
        count, cursor = _u16(buf, off), off + 2
    else:
        count, cursor = buf[off], off + 1
    options = buf[cursor]
    cursor += 1
    rich, far = options & 8, options & 4
    runs = _u16(buf, cursor) if rich else 0
    cursor += 2 if rich else 0
    extra = _i32(buf, cursor) if far else 0
    cursor += 4 if far else 0
    if options & 1:
        text = buf[cursor : cursor + 2 * count].decode("utf-16-le", "replace")
        cursor += 2 * count
    else:
        text = buf[cursor : cursor + count].decode("latin-1", "replace")
        cursor += count
    return text, cursor + 4 * runs + extra - off


def shared_strings(chunks: list[bytes]) -> list[str]:
    """The SST, across its CONTINUE records.

    The trap, and the reason this is not a loop over one buffer: a string may
    straddle the boundary between the SST and a CONTINUE, and when it does the
    continuation RE-STATES the options byte — the second half of a string can
    be stored one byte per character while the first half was two. Reading the
    blob as if it were contiguous produces text that is right for a few
    thousand strings and then quietly turns into mojibake, which is exactly
    the sort of thing that survives a spot check.
    """
    blob = chunks[0]
    boundaries = set()
    for chunk in chunks[1:]:
        boundaries.add(len(blob))
        blob += chunk

    out: list[str] = []
    cursor = 8  # total count, unique count
    for _ in range(_u32(blob, 4)):
        if cursor + 3 > len(blob):
            break
        count, options = _u16(blob, cursor), blob[cursor + 2]
        cursor += 3
        rich, far = options & 8, options & 4
        runs = _u16(blob, cursor) if rich else 0
        cursor += 2 if rich else 0
        extra = _i32(blob, cursor) if far else 0
        cursor += 4 if far else 0

        wide = options & 1
        parts, left = [], count
        while left > 0:
            nxt = min((b for b in boundaries if b > cursor), default=len(blob))
            room = nxt - cursor
            take = min(left, room // 2 if wide else room)
            if take <= 0:
                if cursor in boundaries or nxt == cursor:
                    wide = blob[cursor] & 1
                    boundaries.discard(cursor)
                    cursor += 1
                    continue
                break
            if wide:
                parts.append(
                    blob[cursor : cursor + 2 * take].decode("utf-16-le", "replace")
                )
                cursor += 2 * take
            else:
                parts.append(blob[cursor : cursor + take].decode("latin-1", "replace"))
                cursor += take
            left -= take
            if left > 0 and cursor in boundaries:
                wide = blob[cursor] & 1
                cursor += 1
        cursor += 4 * runs + extra
        out.append("".join(parts))
    return out


def _is_date_format(code: int, pattern: str | None) -> bool:
    if pattern is None:
        return code in BUILTIN_DATE_FORMATS
    stripped = pattern.replace('"', "")
    return any(ch in stripped for ch in "ymdhs") and "#" not in stripped


def serial_to_date(value: float, date_1904: bool) -> str:
    """A spreadsheet serial as `YYYY-MM-DD`.

    The `> 59` correction is Lotus 1-2-3's non-existent 29 February 1900,
    which Excel keeps for compatibility and which every reader has to undo.
    """
    base = datetime.date(1904, 1, 1) if date_1904 else datetime.date(1899, 12, 31)
    days = int(value)
    if not date_1904 and days > 59:
        days -= 1
    try:
        return (base + datetime.timedelta(days=days)).isoformat()
    except OverflowError:
        return str(value)


def _rk(bits: int) -> float:
    """An RK: a float squeezed into four bytes, two ways, sometimes /100."""
    if bits & 2:
        number = float(bits >> 2)
    else:
        number = struct.unpack("<d", struct.pack("<Q", (bits & 0xFFFFFFFC) << 32))[0]
    return number / 100 if bits & 1 else number


def parse(path: str) -> dict[str, dict[tuple[int, int], object]]:
    """`{sheet name: {(row, column): value}}`, rows and columns zero-based."""
    ole = Ole(open(path, "rb").read())
    book = ole.stream("Workbook") or ole.stream("Book")
    if book is None:
        raise ValueError("no Workbook stream; is this really a .xls?")
    stream = list(records(book))

    # The globals substream: which sheets exist, how dates are counted, and
    # the format of every cell style. It ends at the first EOF.
    sheets: list[dict] = []
    sst_chunks: list[bytes] | None = None
    formats: dict[int, str] = {}
    styles: list[int] = []
    date_1904 = False
    index = 0
    while index < len(stream):
        rid, payload = stream[index]
        if rid == BOUNDSHEET:
            name, _ = unicode_string(payload, 6, wide_length=False)
            sheets.append({"offset": _u32(payload, 0), "name": name})
        elif rid == DATEMODE:
            date_1904 = _u16(payload, 0) == 1
        elif rid == FORMAT:
            code = _u16(payload, 0)
            formats[code] = unicode_string(payload, 2)[0]
        elif rid == XF:
            styles.append(_u16(payload, 2))
        elif rid == SST:
            sst_chunks = [payload]
            look = index + 1
            while look < len(stream) and stream[look][0] == CONTINUE:
                sst_chunks.append(stream[look][1])
                look += 1
            index = look - 1
        elif rid == EOF:
            break
        index += 1

    strings = shared_strings(sst_chunks) if sst_chunks else []

    def dated(style: int) -> bool:
        if style >= len(styles):
            return False
        code = styles[style]
        return _is_date_format(code, formats.get(code))

    def number(value: float, style: int):
        return serial_to_date(value, date_1904) if dated(style) and value > 0 else value

    out: dict[str, dict[tuple[int, int], object]] = {}
    for sheet in sheets:
        cells: dict[tuple[int, int], object] = {}
        pending_string: tuple[int, int] | None = None
        for rid, payload in records(book[sheet["offset"] :]):
            if rid == EOF:
                break
            if rid == LABELSST:
                row, col = _u16(payload, 0), _u16(payload, 2)
                which = _u32(payload, 6)
                cells[(row, col)] = strings[which] if which < len(strings) else ""
            elif rid == LABEL:
                row, col = _u16(payload, 0), _u16(payload, 2)
                cells[(row, col)] = unicode_string(payload, 6)[0]
            elif rid == RK:
                row, col, style = (_u16(payload, i) for i in (0, 2, 4))
                cells[(row, col)] = number(_rk(_u32(payload, 6)), style)
            elif rid == MULRK:
                row, first = _u16(payload, 0), _u16(payload, 2)
                for i in range((len(payload) - 6) // 6):
                    style = _u16(payload, 4 + 6 * i)
                    cells[(row, first + i)] = number(
                        _rk(_u32(payload, 6 + 6 * i)), style
                    )
            elif rid == NUMBER:
                row, col, style = (_u16(payload, i) for i in (0, 2, 4))
                cells[(row, col)] = number(
                    struct.unpack_from("<d", payload, 6)[0], style
                )
            elif rid == FORMULA:
                row, col, style = (_u16(payload, i) for i in (0, 2, 4))
                # A cached result of 0xFFFF in the high word is not a number:
                # the first byte then says which kind of non-number it is, and
                # a string result arrives in the NEXT record.
                if payload[12] == 0xFF and payload[13] == 0xFF:
                    kind = payload[6]
                    if kind == 0:
                        pending_string = (row, col)
                    elif kind == 1:
                        cells[(row, col)] = bool(payload[8])
                    elif kind == 2:
                        cells[(row, col)] = "#ERR"
                    else:
                        cells[(row, col)] = ""
                else:
                    cells[(row, col)] = number(
                        struct.unpack_from("<d", payload, 6)[0], style
                    )
            elif rid == STRING and pending_string is not None:
                cells[pending_string] = unicode_string(payload, 0)[0]
                pending_string = None
        out[sheet["name"]] = cells
    return out


def comments(path: str) -> list[str]:
    """Cell comments, as text.

    Worth having: the legend for what the client's own report columns mean was
    written in four of these and nowhere else.
    """
    ole = Ole(open(path, "rb").read())
    book = ole.stream("Workbook") or ole.stream("Book")
    if book is None:
        return []
    stream = list(records(book))
    out = []
    for index, (rid, _) in enumerate(stream):
        if rid != TXO:
            continue
        buf = b""
        look = index + 1
        while look < len(stream) and stream[look][0] == CONTINUE:
            buf += stream[look][1]
            look += 1
        if not buf:
            continue
        text = (
            buf[1:].decode("utf-16-le", "replace")
            if buf[0] & 1
            else buf[1:].decode("latin-1", "replace")
        )
        if text.strip():
            out.append(text.strip())
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: xls.py FILE.xls [sheet]")
    wanted = sys.argv[2] if len(sys.argv) > 2 else None
    for name, cells in parse(sys.argv[1]).items():
        if wanted and name != wanted:
            continue
        if not cells:
            print(f"### {name}: empty")
            continue
        rows = max(r for r, _ in cells)
        cols = max(c for _, c in cells)
        print(f"### {name}  rows={rows + 1} cols={cols + 1}")
        for row in range(rows + 1):
            line = [str(cells.get((row, col), "")) for col in range(cols + 1)]
            if any(cell.strip() for cell in line):
                print(f"{row + 1}\t" + "\t".join(line))
