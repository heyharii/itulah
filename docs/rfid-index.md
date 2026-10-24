# RFID: where everything is (C5 handheld, R3/R3S till)

Updated 24 Oct 2026. One page that points at the rest.

## Read in this order

| # | Document | What it is |
|---|---|---|
| 1 | [rfid-conservative-recipe.md](rfid-conservative-recipe.md) | The recipe in force (v1), staff instructions, minimum validation |
| 2 | [rfid-status-and-errors.md](rfid-status-and-errors.md) | The till's reader states, the R3-xx error codes, Test reader, calibration, diagnostics, the bench list |
| 3 | [research/2026-10-23-rfid-production-standard.md](research/2026-10-23-rfid-production-standard.md) | Why the recipe is what it is |
| 4 | [research/2026-10-22-chainway-sdk-knobs.md](research/2026-10-22-chainway-sdk-knobs.md) | Reverse engineering of both SDKs, REA + Ghidra evidence, region codes |
| 5 | [research/2026-10-23-chainway-impinj-features.md](research/2026-10-23-chainway-impinj-features.md) | Impinj features, and the C5 radio bench: interference, Fast Inventory, region channels |
| 6 | [../pos-desktop/README.md](../pos-desktop/README.md) (R3 section) and [../handheld/README.md](../handheld/README.md) (reader notes) | What the code does, with the bench numbers |

## Decisions

| Date | Decision |
|---|---|
| 22 Oct | The R3/R3S is recognised by its USB identity (VID 0x2047 / PID 0x0301), not by firmware text |
| 22 Oct | A non-zero wait time is set to 0 without saving. The reader is refused only if that does not take |
| 22 Oct | The antenna mask is logged and never refuses a reader |
| 23 Oct | Conservative recipe v1 is the base: `r3-conservative-v1`, `c5-conservative-v1` |
| standing | No region is written until each device's band is commissioned from its SDPPI certificate |

## Measured on real hardware

**R3 (riza-1, 23 Oct):**
- Firmware `V2.2.9,R3,2023-08-09`, VID 2047 / PID 0301, region 0x02 (China2), saved power 12 dBm. It types no keys.
- Open takes 1.5–2.4 s.
- A window of 1000 ms or more read 14/14 EPCs in 8 of 8 reads.
- A read stalls at about 35 records.
- Power, saved or not, does not change reach. The RSSI floor is the only guard, with a 3–5 dB margin.
- At 30 dBm the reader resets.
- The test tags hold duplicate EPCs (16 tags, 14 EPCs).
- Raw data stays on riza-1 in `C:\Users\rizaa\pos-r3-test`; it is not in this repo.

**C5 (23 Oct):**
- Region 0x08 (USA). At Hari's apartment the 920 MHz band is drowned.
- Fast Inventory = 1 inventories continuously, with about 7× the reads.
- Recipe v1 reads back on a real C5. This covers configuration only; no inventory was run.

## Open before production

1. Commission the band from the SDPPI labels and certificates, then set the region per device. The C5 is still on USA 0x08.
2. Build v1 for Windows and bench it on riza-1: the reference set, a 30–40 tag basket, outside tags, kill and unplug.
3. Test a large basket against the ~35-record stall. The result decides between one 2000 ms read and several merged reads.
4. Bench the C5:
   - phase start against the −25 dBm drop;
   - `setDynamicDistance`;
   - battery and heat with Fast Inventory on;
   - a release build compiled AOT.
5. Run a pilot in one store for 1–2 weeks.
6. Ask Chainway for the Indonesia channel table, what the "LBT" / Fast Inventory byte means, and about the opcode `97` collision.
7. Commit. All of the above is uncommitted on `handheld-rfid`.
