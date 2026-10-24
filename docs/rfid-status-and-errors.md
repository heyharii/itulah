# RFID status and errors: the R3 at the till

What the Windows till shows about its Chainway R3, and what every failure
means. The cashier sees one state and, when something is wrong, one sentence
and one action. Support sees the same code with the detail behind it. The
codes are stable: a code keeps its meaning for as long as this catalogue
exists, and a new failure gets a new code.

The catalogue lives in code as `CATALOGUE` in
`pos-desktop/src-tauri/src/rfid.rs`. A unit test there checks that this doc
lists exactly those codes, with the same words in each row. The tag refusals
(`TAG-`) are worded in `pos-desktop/ui/src/till.tsx`. The C5 handheld can
adopt the same numbers later; see [For the C5](#for-the-c5).

Numbers below are for the current recipe, `r3-conservative-v1`: power 15 dBm,
a 2000 ms read, 1000 ms between reads, floor −70 dBm unless calibrated.

## The four states

| State | Chip | What it means | Back to Ready when |
|---|---|---|---|
| **Ready** | green | The reader is open, its settings are confirmed, and nothing since has gone wrong. | — |
| **Busy** | grey | The reader is opening, reading, being tested or calibrating. | It finishes. Asking never waits for it. |
| **Needs attention** | amber | The reader is there, but a check failed: a setting it would not take or keep, a read it could not finish cleanly, its check tag missing or faint, or a Test reader run that failed. | The step that failed works the next time, or a radio check passes (see below). |
| **Not connected** | red | No reader answers, or it went away. | The next open or read finds it. |

The state is worked out in this order, first match wins:

1. A read, test or calibration holds the reader: **Busy**.
2. The driver gave up on the open link: **Not connected** (R3-07).
3. The last open, check or read failed: that fault's state.
4. The last radio check failed: that fault's state (R3-31 to R3-34).
5. A link is open: **Ready**. No link and nothing learned: **Not connected** (R3-05).

A **radio check** is a Test reader run, or a read on a counter with a check
tag. A read on a counter without a check tag says nothing about the radio, so
it leaves the last check as it was. A failed Test reader run therefore keeps
the counter at Needs attention until a test passes, a read hears the check
tag clearly, or the app restarts.

**Where it shows.** The chip sits beside the R3 read button on the sale screen.
Pressing it checks again, which opens the reader if needed. The status bar's
RFID light shows the same state. Till devices has the same chip, with Check
beside it. The sale screen asks the shell every 5 s without touching the
reader, so an unplugged cable shows without a read. It also asks after every
read.

## How a fault reads

- **Cashier:** what happened, what to do, and the code, in the note under the
  scan field: “The R3 is not connected. Check its USB cable, then read again.
  (R3-05)”.
- **Support:** the chip's tooltip holds the same sentence plus the detail. The
  log has a `Chainway R3 R3-05 …` line for every fault the till learns. Till
  devices → **Copy diagnostics** holds everything else
  ([below](#copy-diagnostics)).
- A **note** (R3-23, R3-24, R3-35, R3-36) is about one read or one
  calibration. It never changes the state.

## The reader: R3 codes

“Raised by” names the function in `rfid.rs` unless another file is named.

### Not connected: the app, the driver and the cable

| Code | State | Cashier sees | Cashier does | Support checks | Raised by |
|---|---|---|---|---|---|
| R3-01 | Not connected | This till app cannot use the R3. | Use the Windows till app. | The till is the web edition, a browser tab, or a build for another OS. Only the Windows MSI drives the R3. | `reader_status` and the rest off Windows; `edge.ts` with no shell |
| R3-02 | Not connected | The R3 driver is missing from this till app. | Call support. | `rfid-native` in the install folder lacks `UHFAPI.dll` or `libusb-1.0.dll`; the detail names the folder. Reinstall the MSI that Windows CI built. | `sdk_directory` |
| R3-03 | Not connected | The R3 driver could not be loaded. | Call support. | The detail names the DLL and the Windows error. Check that the three Visual C++ runtime DLLs sit beside it, that antivirus has not quarantined one, and that diagnostics says “the pinned build” for both SDK files. | `keep` |
| R3-04 | Not connected | This R3 driver is a version the till does not know. | Call support. | The detail names the export it lacks. Compare its SHA-256 in diagnostics with the pinned `25c044a8…def8`. | `symbol` |
| R3-05 | Not connected | The R3 is not connected. | Check its USB cable, then read again. | The detail says which step: `UsbOpen` answered other than 0; the driver held no link for the disconnect callback; it gave up on the link as it opened; nothing answered once it was opened (no stop acknowledgement and no buzzer answer); the link was lost while it was being set up; or the till has not opened it yet. Check Device Manager for VID 2047 / PID 0301, that Chainway's demo or another app is not holding it, and the hub and cable. | `open_reader`, `ready`, `status_from` |
| R3-06 | Not connected | The R3 was disconnected during the read, so it was not used. | Check its USB cable, then read again. | The detail gives the link this till held and the link the last disconnect callback named. A loss right after a reopen points at the SDK's late USB thread (the 1.2 s reopen gap); repeated losses point at the cable, the hub or USB power saving. | `read_locked` |
| R3-07 | Not connected | The R3 was disconnected. | Check its USB cable, then read again. | The driver's disconnect callback fired while the till was not reading. The next read reopens it. | `status_from` |
| R3-08 | Not connected | The till app could not ask the R3. | Restart the till app. | The shell's worker thread failed or the bridge refused; the detail has the error. Look for a panic in the log. | `device.rs`, `edge.ts` |

### Needs attention: what the till sets in the reader

Every setting is made without saving it in the reader, and read back. A
reader that will not take one is not read. Unplugging the R3 power-cycles it,
which clears whatever another app left in its working memory; the till sets
everything again on the next read.

| Code | State | Cashier sees | Cashier does | Support checks | Raised by |
|---|---|---|---|---|---|
| R3-10 | Needs attention | This till's R3 settings are not valid. | Call support. | `node.json` was edited by hand. The detail says which: the floor outside −100 to −20 dBm, power or window outside their ranges, or a check tag that is not whole words of hex. Fix it in Till devices and Save. | `PadSettings::of`, `check_desk_reader`, `canary_epc` in `peripherals.rs` |
| R3-11 | Needs attention | The R3 did not take this till's settings. | Unplug the R3, plug it back in, then read again. | The buzzer could not be confirmed off; the detail has the set and read codes. | `mute` |
| R3-12 | Needs attention | The R3 did not take this till's settings. | Unplug the R3, plug it back in, then read again. | EPC-only output was refused (`UHFSetEPCTIDUSERMode` code in the detail). | `epc_only` |
| R3-13 | Needs attention | The R3 did not take this till's settings. | Unplug the R3, plug it back in, then read again. | The power was refused, could not be read, or reads back other than 15 dBm; the detail has both values. At 30 dBm the bench R3 reset itself. | `set_power`, `power_now` |
| R3-14 | Needs attention | The R3 did not take this till's settings. | Unplug the R3, plug it back in, then read again. | A tag filter did not clear; the detail names the bank (EPC, TID or USER). A filter left in place hides every tag it does not match. | `clear_filters` |
| R3-15 | Needs attention | The R3 did not take this till's settings. | Unplug the R3, plug it back in, then read again. | The radio profile would not hold. FastID or Tag Focus was not confirmed off, the Gen2 block could not be read or did not read back as written, the RF link could not be read or moved, or a setting moved once all of them were made. The detail lists which. | `pin_profile` and its helpers |
| R3-16 | Needs attention | The R3 holds settings that can miss tags. | Unplug the R3, plug it back in, then read again. | Read back at rest: Fast Inventory on, a wait between reads that would not go to 0, an air protocol other than Gen2, or output other than EPC only. The log line “Chainway R3 refused, as it holds: …” has all of them. The till never saves settings in the reader; if a replug does not clear it, Chainway's tool saved it, and changing that is the owner's decision. | `pin_profile` (`Rest::refused`) |
| R3-17 | Needs attention | The R3's settings changed since it was set up, so it was not read. | Read the pad again. | The check before every read found the profile changed (a reset of the radio alone) or a getter did not answer. The till drops the link, and the next read opens and sets it again. If it repeats, look at the R3-15 data in diagnostics. | `ready` |

### Needs attention: reads

| Code | State | Cashier sees | Cashier does | Support checks | Raised by |
|---|---|---|---|---|---|
| R3-21 | Needs attention | The R3 did not confirm the read ended, so it was not used. | Read the pad again. | No stop acknowledgement (`8D`) came within 600 ms of `UHFStopGet`. The detail says whether a second stop, sent straight, was acknowledged or the link was closed. This is bench question R3 Q8. | `read_locked` |
| R3-22 | Needs attention | The R3 went back to its own settings, so the read was not used. | Read the pad again. | Records came with TID bytes: the reader reset to its saved output during the read. The next read sets everything again. If it repeats, check USB power. | `read_locked` |
| R3-23 | Note | No tag was heard on the pad. | Put the items on the pad, then read again. | Either the pad was empty, or every tag was under the floor (“N too faint…” is in the same note). With a check tag, R3-31 shows whether the radio heard anything at all. | `till.tsx` (`readWithR3`); `judge` |
| R3-24 | Note | None of the tags on the pad is on that line. | Put only the item to take off on the pad, then read again. | The cashier was taking one unit off a line, and the pad held tags of other articles only. | `till.tsx` (`readWithR3`) |

### Needs attention: checks

| Code | State | Cashier sees | Cashier does | Support checks | Raised by |
|---|---|---|---|---|---|
| R3-31 | Needs attention | The R3 did not hear its check tag, so an item may be missing. | Read the pad again. | The read did not hear the check tag at all. The tags it did hear are still added. Causes: a deaf radio (interference), the check tag moved or covered, or a wrong EPC in Till devices. Diagnostics → Last reads shows the check tag in each read. | `check_tag_health`, `judge` |
| R3-32 | Needs attention | The R3 heard its check tag only faintly, so an item may be missing. | Read the pad again. | The check tag read less than 2 dB above the floor; the detail has its RSSI and margin. Look for something on or near the pad, or a floor set too high, then Calibrate. | `check_tag_health`, `judge` |
| R3-33 | Needs attention | The tags heard changed from one read to the next. | Keep the items still on the pad, then test again in Till devices. | The tags kept per read are in the detail. Tags near the floor drop in and out; so do items that moved, or a radio that goes deaf. Calibrate warns with this code when a tag on the pad was missed by one of its reads. | `judge`, `calibration` |
| R3-34 | Needs attention | The weakest item reads too close to the floor. | Calibrate and test the reader in Till devices. | The weakest tag kept read less than 2 dB above the floor; the detail has the tag and the margin. | `judge` |
| R3-35 | Note | No floor could be suggested. | Put the test items on the pad, then calibrate again. | Nothing was kept above the floor in force, no read finished, or the suggestion falls outside −100 to −20 dBm. The detail says which. | `calibration` |
| R3-36 | Note | A tag off the pad reads close to the suggested floor. | Move tagged goods away from the counter, then calibrate again. | The detail gives a tag that no read kept, its RSSI, and how far it is from the suggestion (under 6 dB, or above it). Fix it physically, with distance or shielding. A lower floor does not fix it. | `calibration` |

## Tags the node refuses: TAG codes

The node refuses a tag at the quote (`quote.unsellable`, `quote_basket` in
`backend/src/edge/sqlite.rs`), or the sale after the money
(`complete_sale`). The till shows the refusal in plain words. These codes are
about the tag, not the reader: they appear whether the tag came from the pad,
a scan or a handheld pull. A refusal the till does not recognise is shown in
the node's own words, without a code.

| Code | The node says | Cashier sees | Cashier does | Support checks | Where |
|---|---|---|---|---|---|
| TAG-01 | not in this shop's stock: sold already, or never received here | Already sold, or never received at this shop. | Put it aside and call the supervisor. | The tag has no stock row at this shop. Either it was sold (look up the EPC's last movement), or it was never received here (another shop's goods, or a receipt not done). | taken off the basket at the quote |
| TAG-02 | in the stockroom, not on the shop floor | Still in the stockroom, not on the shop floor. | Ask the supervisor to move it to the shop floor. | The unit sits in the stockroom pool. Move it to the floor in the store app, then scan again. | taken off at the quote |
| TAG-03 | set aside as damaged | Set aside as damaged. | Put it aside and call the supervisor. | The unit is in the reject pool. It is not for sale until someone decides otherwise. | taken off at the quote |
| TAG-04 | marked missing on the shop floor | Marked missing on the shop floor. | Ask the supervisor to check it in the store app. | A count marked it missing. Find it in the store app so it is back in stock. | taken off at the quote |
| TAG-05 | not on the shop floor | Not on this shop's floor. | Ask the supervisor to check it in the store app. | The unit is held in some other place or state; the store app shows where. | taken off at the quote |
| TAG-06 | not found: EPC … (404) | Not this shop's item. | Put it aside and call the supervisor. | This node has never heard of the EPC. The whole quote fails, so the basket cannot be priced until the tag comes off (× on its line, with a supervisor). | under the total |
| TAG-07 | conflict: insufficient quantity at …: have 0, need 1 (409) | Already sold, or no longer on the shop floor. | Resolve the sale with the supervisor. | The tag passed the quote, but by the time of the sale it had left the floor: sold at another till, or moved. The sale is in the outbox as refused; Resolve replaces the tag or sends it again. | the refused-sale banner and Resolve |

## The checks and their numbers

| Number | Where | Why |
|---|---|---|
| 2 dB | The check tag, and the Test reader's weakest tag, must read at least this far above the floor. | Closer than that, a garment slightly weaker than them falls under the floor. On the bench, static tags held their RSSI within ±0.4 dB. |
| 3 dB | Calibrate puts the floor this far under the weakest tag on the pad, rounded down to a whole dBm. | The bench R3 left 3–5 dB between its pad and a tag a metre away. The −70 dBm floor is the only guard: the power did not change the reach. |
| 6 dB | Calibrate warns when a tag off the pad reads within this of the suggested floor. | A floor that close to the racks lets them in when the room changes. |

**The check tag** (Till devices → Check tag) is the EPC of a tag fixed at the
pad, at a typical distance from the antenna: around the RSSI of the weakest
garments the pad must read. Do not put it right on the antenna. A strong tag
keeps reading while weaker ones vanish, so it would never warn. The shell
leaves it out of every read's tags, so it is never added to a basket and never
counted as “not this shop's tags”. A scan of it is refused, and a handheld pull
skips it. Each read reports it apart. If it is missing, the read needs
attention (R3-31). If it reads under 2 dB above the floor, the read also needs
attention (R3-32). The tags the read did hear are still added: they are on the
pad.

**Test reader** (Till devices) uses the saved settings. It closes the reader
and waits out the 1.2 s reopen gap. Then it opens the reader with the clock
running and reads every setting back. Then it reads the pad three times, a
second apart. It reports:

- the recipe the reader was set to (`r3-conservative-v1`), and the open time;
- each read's time, without the wait for the gap;
- the tags per read, and whether they were the same tags each time;
- the records and the distinct EPCs per read. The bench R3 stopped sending
  after about 35 records in one inventory, however long the window, so a
  basket of 30 to 40 garments may not be read whole in one 2000 ms read:
  records near 35 with fewer EPCs than items on the pad is that ceiling;
- the weakest tag kept, and its margin to the floor;
- the check tag in each read;
- the firmware and the full profile read back, and the last read's tags, kept
  and left out.

The verdict is FAIL at the first of these, and PASS otherwise:

1. The reader did not open (its R3-0x or R3-1x code).
2. A read failed (that read's code).
3. No read kept a tag (R3-23, a note).
4. A read did not hear the check tag (R3-31).
5. The reads did not keep the same set of EPCs (R3-33). Matching counts are not
   enough.
6. The weakest tag is under 2 dB above the floor (R3-34).
7. The check tag is under 2 dB above the floor (R3-32).

**Calibrate** (Till devices) works like this:

1. The installer puts the test items on the pad and presses Calibrate. The till
   reads three times, a second apart.
2. A tag is **on the pad** when any of the reads kept it at the floor in force.
   The check tag counts as on the pad whatever it read at. A tag that no read
   kept is **off the pad**.
3. The till suggests the weakest RSSI of any tag on the pad, in any read, less
   3 dB, rounded down.
4. It warns with R3-36 when the strongest tag off the pad is within 6 dB of
   that suggestion, and with R3-33 when a read missed a tag on the pad.
5. **Nothing is saved until the installer presses “Use … dBm”.** That saves the
   floor alone, not other edits on the form. Run Test reader afterwards.
6. If the floor in force is far too high, the items on the pad are left out,
   and Calibrate says R3-35. Lower the floor by hand, then calibrate again.

## Copy diagnostics

Till devices → **Copy diagnostics** puts a text bundle on the clipboard. If the
clipboard refuses it, the text is shown to copy by hand. Nothing is uploaded.
The bundle holds:

- **App:** product name and version, and the reader recipe id
  (`r3-conservative-v1`).
- **Settings:** the desk reader, power, read, floor, gap and check tag as saved,
  whether they are in range, and the margins above.
- **Driver:** the folder it was loaded from, the SHA-256 of `UHFAPI.dll` and
  `libusb-1.0.dll` with “the pinned build” or “NOT the pinned build”, and any
  optional call this DLL lacks.
- **Reader:**
  - the state and its code;
  - stop acknowledgements and disconnect callbacks since loading;
  - the link id, and whether the driver has given up on it;
  - how long the open took;
  - the firmware text and the raw `C8` answer in hex;
  - the power read back, the region and the channels;
  - the profile read back, with the whole Gen2 block, the work and wait time,
    and everything read at rest;
  - whether the last read showed a reset.
- **Last reads** (10): tags, left out, unreadable, records, time, the wait
  for the gap, the check tag, and any code.
- **Last faults** (10): the time, the code, and the cashier's words with the
  detail.
- **Last SDK calls** (40): each call with what it was given, its answer and
  how long it took. The drain is summarised once per read rather than
  listed poll by poll. Stop acknowledgements and lost links appear here too.

Times are in UTC.

## For the C5

The numbers are meant to carry over: a code's number is its meaning, and
the prefix names the reader. When the handheld adopts the catalogue, it should
use `C5-` with the same number wherever the meaning matches, and leave
unmatched numbers unused rather than reusing them.

- **R3-01 to R3-08 map directly:** `C5-02` for the SDK/aar missing,
  `C5-05` for a module that does not answer on open, `C5-06` for a link lost
  mid-sweep, and so on.
- **R3-11 to R3-17 map to its profile** (FastID, Tag Focus, session, RF link,
  Fast Inventory). The C5's `PowerOffReceiver` free fits `C5-07`.
- **R3-31 to R3-34** are the canary and margin checks the 23 Oct C5 bench
  asked for.
- **New C5-only meanings take numbers in the 40s.** Examples are the −25 dBm
  window and a sweep ended during a deaf stretch.
- **`TAG-` codes are the node's verdicts on a tag,** whichever reader heard it.

The four states mean the same on the C5.

## Needs a bench run on riza-1

Nothing here has run on a Windows till yet. Windows CI compiles it and runs its
unit tests. A scratch copy of `rfid.rs` was built on a Mac with plain `rustc`
(SDK and Tauri stubbed), and its 32 tests passed. On the bench:

1. **Test reader on the pad's 16 tags.**
   - What are the open time, the read times (2000 ms window) and the margin?
   - Does it PASS three runs in a row? It should, given 8/8 at 1000 ms.
   - How many records per read? The 23 Oct sweep stalled at about 35. Then
     pile 30–40 tags on the pad: do the EPCs per read reach the pile, or stop
     where the records do?
2. **Calibrate with the tag placed 1 m away.**
   - Is the suggestion 3 dB under the weakest pad tag?
   - Does R3-36 fire when that tag is brought within 6 dB?
3. **The check tag.**
   - Fix one at the pad's edge. Does every read hear it?
   - Is its RSSI steady enough that 2 dB of margin does not flap (R3-32 on a
     quiet bench)?
4. **Unplug while idle.**
   - Does the chip turn Not connected within one 5 s poll (R3-07)? That needs
     the disconnect callback to fire (R3 Q7).
   - Plug back in: does the next read reopen it to Ready?
5. **Busy without blocking.**
   - During a Test reader run, does `rfid_status` answer Busy at once?
   - Does a sale read on the same till wait its turn?
6. **Diagnostics.**
   - Do both SDK files say “the pinned build”?
   - Are the `C8` bytes there, and are the last 40 calls readable?
7. **Bench scripts.** `rfid_read_pad` now rejects with a fault object
   `{code, state, says, action, detail}` instead of a string. `cdp.mjs` and
   `series.mjs` should print `JSON.stringify(error)`. `rfid_state` keeps its
   old `{bound, detail}` shape.
