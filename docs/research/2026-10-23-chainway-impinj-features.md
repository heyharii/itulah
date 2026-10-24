# Impinj features in the Chainway SDKs: C5 handheld and R3/R3S desk reader (23 Oct 2026)

Follow-up to [2026-10-22-chainway-sdk-knobs.md](2026-10-22-chainway-sdk-knobs.md),
which covers transport, timing, region and the bugs around them. This one maps
every **Impinj** feature the two SDKs expose: what it does on the air, which
call and which module frame carries it, what the SDK does around it, and
whether we should use it. The SDK pass ran nothing on a device; the bench
sections (23 Oct) did, with every module write unsaved and restored.

**R** = read in the binary, the bytecode or the vendor demo (address or class given).
**I** = inferred; settle it on the bench (questions at the end).
**D** = from Impinj / GS1 documentation (source linked), not from our artifacts.

## Artifacts and method

Same stable copies as 22 Oct (`~/tools/rea-targets/chainway/`, checked against `SHA256SUMS`):

| What | File | SHA-256 |
|---|---|---|
| C5 native, MTK path, arm64 | `libDeviceAPIM.arm64.so` | `014d6f06…135e` |
| C5 Java | `DeviceAPI_ver20251103.classes.jar` | `354081c7…4819` |
| R3/R3S DLL, x64 | `UHFAPI.x64.dll` | `25c044a8…def8` |
| R3 header | `UHFAPI.h` | `00bf948b…a8be6` |
| R3 vendor demo (.NET) | `UHFAPP.demo.exe` | `d4da4e35…b688` |

- **Native:** REA 6.7.0 over MCP, Ghidra 12.1.4 provider, one binary open at a
  time. C5 addresses are Ghidra's (objdump + 0x100000). Evidence IDs are in the
  table at the end.
- **Java:** `javap -c -p` (JDK 21) on the classes jar. No REA ID.
- **Demo:** REA managed-member metadata for the M775 form, plus the UTF-16
  strings of `UHFAPP.demo.exe` for the combo-box tables.
- **Impinj side:** public Impinj and GS1 documents, linked where used.

---

## The short version

1. **Every Impinj feature is a module command, and the module firmware does the
   Impinj work.** Both SDKs only pack bytes for the Chainway module protocol
   (`A5 5A | LEN | CMD | DATA | XOR | 0D 0A`). The C5 `.so` and the R3 DLL build
   **the same frames for the same features** (R, cross-checked function by
   function below). What the E710/E310 then puts on the air is firmware we do
   not have.
2. **Gen2X is two things here:** RF link modes 10–15 (A–F in the vendor UI), and
   the "Fast Inventory" command `64` with its CR / coding / protection / ID
   fields. Our field notes already measured the first (SCAN-REDESIGN.md §Gen2X);
   nobody has touched the second.
3. **`getGen2` is decoded correctly — the off-by-one suspicion was refuted on
   the bench (23 Oct).** Both SDKs read reply bytes 0–3 of `22` without a status
   check, which looked like a one-byte shift. On the C5, read → change session
   → write → read changed only the session and left every other field as it
   was, so the `23` reply carries no status byte and our read-modify-writes are
   safe there. The R3 decodes the same way; not benched yet.
4. **The C5 saves to flash on settings our code treats as volatile (R frame /
   I meaning):** RF link `52 [00][01]`, Fast Inventory `64 [01]`, single/dual
   target `6A [01]`. The R3 DLL names that byte `saveflag`. This is why "the
   module keeps its link mode across an app restart" even though every `free()`
   cuts the module's power.
5. **Command `97` means two things in both SDKs:** Margin Read and QT-set. One
   of them is wrong for any given firmware.
6. **M775 authentication is supported end to end in the SDK** (inventory mode 3
   on the C5, and the access-time `Authenticate` frame `8E` on both). The SDK
   only returns raw hex; verifying it needs Impinj's service.
7. **Protected Mode and Short Range (`90`) change the tag itself.** A protected
   tag stops answering readers that do not know its PIN. Never in our flows
   without a plan.
8. **Why the C5's count jumps (bench, 23 Oct): mostly the radio, not the tags.**
   The module sits on the US plan (region 0x08). At Hari's apartment it reads
   cleanly at 902–916 MHz, fades above ~917 MHz and is down to a trickle or
   nothing above ~923 MHz, which is exactly where Indonesia's band is (its
   "Indonesia" preset hops 923.25–924.75 MHz). As booted it also inventories in bursts (Fast Inventory
   off, the byte the SDK calls "LBT"), so a burst on a drowned channel loses a
   whole second; with that byte at 1 it reads continuously, ~7× the reads, no
   deaf second. TagFocus and S1/S2 add their own silences on top: under
   TagFocus an Impinj tag answers once per sweep. Tags at the edge of range
   (−75 dBm or weaker) turn up only now and then.

---

## Why tags go quiet for a long time

Hari's complaint: "the Impinj features act strange — sometimes a tag is kept
silent for a long time". Nothing in either SDK holds a tag back on its own
schedule; silence comes from **flags inside the tag** that the reader set, from
**settings the module kept**, or from a **duty cycle or repeat filter** in the
reader. Each row below is a separate mechanism, with how to tell it apart.

Gen2 flag persistence (D, the "tag flags and persistence values" table of the
[GS1 EPC UHF Gen2 air interface standard](https://www.gs1.org/standards/rfid/uhf-air-interface-protocol)):

| Flag | While the tag is energised | After it loses power |
|---|---|---|
| S0 inventoried | for as long as it stays energised | none: back to A at once |
| S1 inventoried | 0.5 – 5 s, then back to A, **even if still energised** | 0.5 – 5 s |
| S2, S3 inventoried | for as long as it stays energised | more than 2 s |
| SL | for as long as it stays energised | more than 2 s |

A reader that asks only for target A never hears a tag whose flag says B. "How
long" is therefore "for as long as the tag keeps getting power", plus the
column on the right, and that is why it looks random: a tag at the edge of the
field drops out of power, resets, and answers again; a tag well inside the
field stays powered and stays silent.

| # | Mechanism | Silent for | Which tags | Comes back when | Set by | Check | Fix |
|---|---|---|---|---|---|---|---|
| 1 | **TagFocus** in S1, target A | as long as it stays energised, then S1's 0.5–5 s | Impinj tags with TagFocus support only | it leaves the field (or RF stops) for longer than S1 persistence | `setTagFocus(true)` → `60 [01][00]` | `62` | off whenever the same tag must be seen again (locate, verify, pad re-read) |
| 2 | **S2 / S3 session**, single target | as long as energised, then >2 s | every Gen2 tag | RF off for >2 s | Gen2 block byte 3, bits 4–5 | `22` (beware the decode, above) | S0 or S1 for counting; never S2/S3 on a pad |
| 3 | **S1 session** without TagFocus | 0.5–5 s per read, by chip and temperature | every Gen2 tag | by itself | same | `22` | expected; the spread across chip models is the "sometimes" |
| 4 | **Single target in S0** | as long as energised | every Gen2 tag | RF off, even briefly | `6A [save][1]` (C5 forces save) | `6C` | dual target (`6A [00][00]`) when a still pile must be re-read |
| 5 | **Select left behind** (target S0–S3 with an action that sends non-matches to B, or SL with Query Sel = SL) | as long as energised | the tags the mask did not match | RF off (module re-open) | `6E` + Gen2 byte 0 + Query Sel | log every `setFilter`; read `22` | SL-based filter, cleared by Query Sel = 0 |
| 6 | **Gen2X RF link** (modes 10–15) | always | tags without Gen2X | link back to 0–5 | `52 [00][01][m]` — **saved** on the C5 | `54` | pin a plain mode on wake (done on both) |
| 7 | ~~Corrupted Gen2 block after read-modify-writes~~ | – | – | – | – | **refuted on the C5, 23 Oct** (Gen2 round trip exact) | – |
| 8 | **Reader-side repeat filter** (R3 family, "UR tag filter") | the configured timeout | every tag, after its first report | the timeout expires | `SetURTagFilter(enable, timeout)` → `A1 [15][en][timeout BE 4]` | `A1 [14]` → `[14][en][timeout]` | read it; must be off on the till. Whether the R3 firmware implements it, and the timeout's unit, are I |
| 9 | **Duty cycle** (work/wait) | the wait period, repeatedly | every tag | next work period | R3 `UHFSetWorkTime` → `3C [5 bytes]`; C5 hidden `UHFSetPwm` → `3C [01][work 2][wait 2]` | `3E` | wait = 0 for continuous reads |
| 10 | **C5 RSSI window** (22 Oct §1) | while the tag is closer than about −25 dBm | any tag held against the antenna | moved away | firmware frame layout + `UHF_GetReceived_EX` drop | logcat `okcnt` vs our reads | phase/channel start frames (window-free path) |
| 11 | **Protected Mode** | permanently | Impinj M7xx/M8xx tags someone protected | a Select carrying the PIN, or turning it off with the PIN | `90 [AP][mask][01][sr]` | a FastID/TID census shows the tag missing everywhere | never enable |

**What the C5 itself showed** (SCAN-REDESIGN.md §Tag Focus, session S1, target A,
FastID off, 20 s sweeps, per-EPC gap = time between two reads of the same tag):

| Bench | Tag Focus | Mean gap | Longest gap | Re-reads per sweep |
|---|---|---|---|---|
| mixed rack, 66 tags | off | ~1.5 s | ~4.4–6.5 s | (936 sightings) |
| mixed rack, 66 tags | on | ~2.1–2.2 s | ~10.3–11.4 s | (338–353 sightings) |
| open desk, 34 tags | off | 1.29 s | – | ~530 |
| open desk, 34 tags | on | 2.62 s | – | **~9** |

Read against the persistence table:
- **Tag Focus off:** the gaps sit inside S1's 0.5–5 s window. That is plain S1
  persistence: read, go quiet for a few seconds, come back.
- **Tag Focus on, tags lying still with good power (desk):** almost total
  silence for the whole sweep — about nine re-reads among 34 tags in 20 s.
  The tags stayed powered, so they stayed quiet.
- **Tag Focus on, tags in a rolled bundle:** gaps grow but stay finite (max
  ~11 s): tags at the edge of power drop out, their S1 flag runs out, and they
  answer again. That is the "sometimes": it depends on how well each tag is
  powered, not on a timer in the reader.
- **After the trigger is released:** not yet measured validly (the old table was
  withdrawn). By the spec, a tag that went quiet in S1 stays quiet for 0.5–5 s
  after the field stops; a C5 that starts again sooner hears the slow ones late.

Ruled out (R): **SDK-side de-duplication.** The C5 `readTagFromBuffer()` only
drops repeats when `InventoryParameter.isTagUnique` is true; every constructor
sets it false, and `Reader.kt` never sets it. The R3 DLL has no de-duplication in
its tag queue (22 Oct §6).

**The most likely culprits for "sometimes silent for a long time", in order:**
running in S1 or S2 at all (bench 23 Oct: the same tags were read 4, 1 or 0
times per 8-s run depending on the seconds before, while S0 stayed at 12–13);
TagFocus on Impinj tags (row 1); and a Select that left tags in B (row 5,
measured: only a module re-open recovered). Row 7 was refuted on the bench. On
the R3, rows 8 and 9 are unread settings that another app could have saved.

---

## Bench results on the C5, 23 Oct (why the count jumps)

Rig: our C5 (Android 13, `E710_V7.10.1`) in Hari's apartment, over adb
wireless debugging, the tags lying near it, the dc app's lab channel first and then a standalone probe app
(`id.itulah.uhfprobe`, Java, same vendor SDK) that logs every read with a
timestamp and channel. Fixed: 30 dBm, RF link 1, dynamic Q (StartQ 6, MaxQ 15),
target A, no Select. Each run is 8 s.

**Module facts read raw (B):**
- Region `2E` → `01 08`: **code 0x08, USA 902–928 MHz.** Reads hopped over
  ~33–38 channels from 902.8 to 922.8 MHz in every 8-s run. Indonesia's preset is
  0x3F (920–923 MHz); this needs fixing with Chainway/the certificate in hand.
- Single/dual `6C` and `6A` → no reply (rc −1) on this firmware: there is no
  dual-target switch to use, and the reader asks target A only.
- Gen2 `22` → exactly 4 bytes (`01 60 F0 20` in S2, `01 60 F0 00` in S0): no
  status byte, SDK decode correct.
- Fast Inventory `66` → `01 00 01 02 02`: CR off (code 1, protection 2, id 2 kept).
- TagFocus, FastID off at rest; duty cycle `3E` → `00`.
- EPC+TID census (5 s): the three tags that returned a TID are **NXP**
  (TID `E2806915`, UCODE 9 family) — our `A0` test tags. TagFocus is an Impinj
  feature, so it cannot apply to them.

**Counts per run (B):**

| Run | Tags | Reads | Pattern |
|---|---|---|---|
| S0 ×3 (base) | 12, 13, 12 | 182–224 | every tag re-read every ~0.3 s |
| S0 after the "single/dual" commands (no effect) | 12, 13 | 189–203 | same |
| S1, TagFocus off | **3** | 12 | the 3 NXP tags, each read every ~2.2 s; the rest silent all 8 s |
| S1, TagFocus on | 13 | 22 | the 3 NXP tags ×4; ten others read **once**, then silent |
| S1, TagFocus on, again after 1 s / 8 s rest | **5 / 4** | 13–14 | the ten mostly absent |
| S1, TagFocus off, last | 12 | 102 | all back, re-read every ~0.4 s |
| S2, twice | 3, 7 | 36–41 | – |
| S0 after S2 | 8 | 164 | – |

**What this says:**
1. **S0 is the stable count here** (12–13 every time). The ~0.3 s re-read period
   matches the channel dwell (≈38 channels in 8 s), the moment S0 flags reset.
2. **S1 and S2 make each count depend on the last few seconds.** A tag that has
   just answered is B, the reader only ever asks A, and the same tags were read
   4, 1 or 0 times depending on what ran before. That is the "tiba-tiba turun,
   tiba-tiba naik": the reader is not missing tags at random, it is not asking
   for them.
3. **"TagFocus effects" on our bench are mostly S1 effects.** Our own test tags
   are NXP; they re-answered every ~2.2 s with TagFocus on or off. The ten tags
   that went silent after one read are the only candidates for Impinj
   silicon (unconfirmed: no TID in the census).
4. **Not reproduced yet:** why the first S1 run heard only 3 tags. A follow-up
   with fixed rests and a full chip census would pin it down.

### Follow-up run (07:10): chip census and the alternating sweeps

**Chip census (B), EPC+TID 15 s plus a FastID run:**

| Tag | Chip | FastID reply |
|---|---|---|
| `0000…01AAAA` (96-bit EPC) | **Impinj M830/M850** (TID `E28011B0`) | yes, TID returned |
| `0829…4904E3` (128-bit EPC) | **Impinj Monza R6-P** (TID `E2801170`) | yes, TID returned |
| `A000…000001/2/3` (our test tags) | **NXP UCODE 9** (TID `E2806915`) | no — FastID is Impinj-only, as expected |

**TagFocus per chip (B, S1, target A, 4–6 s runs):** both Impinj tags were read
**at most once per run** in every TagFocus-on run (9 runs) and then stayed
silent for the rest of it — up to ~7 s, which was simply where the run ended;
no TagFocus'd Impinj tag ever answered twice while the radio stayed on. The NXP
tags were re-read every **2.0–2.5 s** whether TagFocus was on or off (S1
persistence, or the wait for a usable channel — not separated).

**After the radio stops (B, one clean pair):** the R6-P, held silent in one run
(read at 3.1 s), answered **0.22 s into the next run after a 2 s pause**, so it
was released within ~2.2 s of the radio stopping. Other pairs fell in bad
periods and say nothing. Keonn's figure is 1–2 s (D).

**The sweeps alternated between two shapes, in every session, S0 included:**
- *Good:* nothing for the first 1–3 s, then **every tag at once**, re-read every
  ~130–160 ms (e.g. 4–6 tags, 50–78 reads in 4 s).
- *Bad:* only the strongest NXP tag, every ~2.2 s; every other tag silent for
  the whole run (1 tag, 1–3 reads) — even S0 after a 20 s rest.

That rules out "S1 vs S0" as the whole story: the first run's stable S0 counts
were taken in a good stretch.

**Target-B test (07:20, B):** a Query with target B returned **no tag at all**
in S0, S1 and S2, even straight after an A sweep had read 5–6 tags. So the
missing tags are not parked in B, and target-B rounds on this firmware yield
nothing.

**A false alarm, recorded so nobody repeats it:** the SDK's `getCW()` said 1
("continuous carrier on"). The raw `26` reply is `01 09`; `UHF_GetCW` 0x18f188
returns reply byte 0, which is the status byte (R, `ev_11f5772a…`). `getCW()` on
the C5 therefore reads 1 whenever the module answers at all. The value byte (9)
does not fit an on/off flag; what `26` means on E710 firmware is unknown.

### Q test and the channel picture (07:25, B)

- **Fixed Q (4 or 5) behaves like dynamic Q:** the same good/bad alternation, one
  8-s fixed-Q run with **0 tags**. The Q algorithm is not the cause.
- **The silences are reader-wide:** in good runs every tag goes quiet in the
  same 1–1.5 s windows, so the reader stopped hearing, not the tags.
- **Reads per channel, 2,631 reads over all runs:** 50–130 per channel from
  902.8 to 919.3 MHz, then 26 → 13 → 9 → 4 → 2 → 1 from 919.8 to 923.3 MHz,
  and **zero on every channel from 923.8 to 927.3 MHz**. The module hops the
  whole US plan; the top fifth of it never hears a tag.
- **Bad runs keep only the middle:** their few reads all sit at 913–920 MHz,
  where good runs read from 902 MHz up.

Reading (I): the upper channels sit next to Indonesia's cellular downlink
(925–960 MHz, always on) and the lower ones inside the phone uplink (880–915 MHz,
bursty). A constant dead top band plus intermittent losses below 915 MHz would
give exactly "fine, then suddenly almost nothing". An antenna or filter whose
response falls with frequency would explain the top band but not the bursts.
Neither is proven yet; per-read RSSI by channel, and a run with phones and other
readers away from the C5, would separate them.

### RSSI per channel (07:35, B): interference, not the antenna

Three 20-s S0 runs logging every read (1,122 reads, 7–8 tags). Mean RSSI of the
**same tag** by band:

| Tag | 902–908 | 908–914 | 914–918 | 918–920 | 920–924 | Slope |
|---|---|---|---|---|---|---|
| NXP `…0001` | −62.2 (96) | −62.4 (115) | −62.2 (88) | −62.2 (41) | −61.1 (8) | −0.00 dB/MHz |
| NXP `…0003` | −60.9 (122) | −61.5 (106) | −62.1 (72) | −62.2 (35) | −61.8 (5) | −0.10 |
| NXP `…0002` | −65.6 (69) | −64.3 (78) | −62.4 (85) | −61.8 (46) | −61.2 (10) | +0.30 |
| Impinj M830 | −67.1 (35) | −66.6 (39) | −66.1 (30) | −65.0 (16) | −62.9 (6) | +0.16 |
| Impinj R6-P (weakest) | −69.2 (11) | −72.2 (5) | −74.0 (1) | – | – | – |

- **RSSI is flat across the band** (or slightly higher at the top, the
  signature of only the strongest replies getting through). An antenna or
  filter rolling off with frequency would lower RSSI at 920+ MHz by several dB.
  It does not. **Antenna/filter roll-off: ruled out.**
- **Read counts collapse at the top anyway** (918–920: 33–62 reads per run;
  920–924: 3–21) and the weakest tag disappears first. Same link, fewer
  decodes: the receiver is being drowned on those channels — **interference**.
- **Dropouts are time-varying:** run B lost almost everything for ~4 s
  mid-run (reads/s 4, 1, 0, 1, 1), then recovered; runs A and C show ~1-s dips
  every few seconds.

Consistent reading (I, now well supported): the module, set to the US plan,
receives on channels that sit against Indonesia's cellular downlink (925–960
MHz, constant) — the upper-band loss — plus a bursty emitter that raises the
noise floor for seconds at a time — the bad periods. A C5_GL front end built for
902–928 MHz passes 925–928 MHz to the receiver; whether Chainway has a variant
with a 920–925 MHz filter for Indonesia is a question for them.

Counting advice: the session choice and TagFocus change **how often** a tag is
reported; interference changes **whether** it is heard at all, and was the
bigger swing on this bench. A count must therefore know when the radio was deaf
(see the recommendations).

**One fixed tag tracks the deafness (B, same runs):** the strongest NXP tag's
reads per second fell exactly when everything else did — run B seconds 10–14:
1, 0, 0, 0, 0 (others 3, 1, 0, 1, 1), then back to 6–8/s. A canary tag works.

### Region presets compared (07:45, B)

US → Indonesia → China 2, interleaved three rounds, 10 s each, region written
raw with save byte 0 (`2C 00 <code>`), each write read back by `2E`, US restored
at the end (`01 08`).

| Preset | Reads | Reads/s | Deaf seconds (≤2 reads) | Channels actually used |
|---|---|---|---|---|
| **USA 0x08** | 493 | 16.4 | **0 / 30** | 902.8–924.8 MHz (37) |
| **Indonesia 0x3F** | 77 | 2.6 | **23 / 30** | **923.3–924.8 MHz (4)** |
| **China 2 0x02** | 23 | 0.8 | **28 / 30** | 921.1–924.1 MHz (11) |

- **This firmware's "Indonesia" preset hops 923.25–924.75 MHz** — the old
  923–925 band — although Chainway's demo labels it 920–923 MHz. Raise with
  Chainway; the current SDPPI band to certify against is 920–923 MHz.
- At this spot **920–925 MHz is nearly deaf**, while the same minutes on the US
  plan were clean. Even the Indonesia runs had a few seconds of full reception
  (13–15 reads/s), so the band is not dead, it is drowned most of the time.
- So no preset that sits in the Indonesian allocation works here today; the
  only one that does uses frequencies that are not allowed. That puts the
  problem on the site's 920–925 MHz environment and the C5's ability to cope
  with it, not on our settings.

### With the R3 unplugged, and with our own channels (08:00, B)

Hari unplugged the R3 that was running near the C5; the same interleaved test
was repeated.

| Preset | R3 on | R3 unplugged |
|---|---|---|
| USA | 0/30 deaf s | 0/30 |
| Indonesia | 23/30 | 29/30 |
| China 2 | 28/30 | 30/30 |
| US plan, 2×20 s per-read | a 4-s dropout seen earlier | **no deaf second** |

Then, still on the US region, a custom channel list through raw `14 [N][3-byte
kHz]…`: accepted (`01`), but **the module used only the first channel of the
list** — every read fell on it. `2C 00 08` restores the default table (`16` →
`00`). So we can change the region and force one frequency; a multi-channel
list of our own did not work in this frame format.

| US region, one fixed channel | Reads/s (6-s runs) |
|---|---|
| **903.25 MHz** | 31–36, steady, never deaf |
| **920.25 MHz** | 9–10 for 2 s, then 1–2; two more runs **0** |

**What this proves:**
1. **920–925 MHz is drowned at this spot by something other than the R3** and
   other than the region preset's behaviour: on the same US settings, one
   frequency in it is deaf while 903 MHz is perfect. Candidates: cellular
   downlink at 925+ MHz (a nearby tower or indoor repeater), or another emitter
   in 920–925 MHz (Indonesia's LoRaWAN AS923-2 plan also sits at 920–923 MHz).
   A store test decides whether it is this apartment building.
2. **The intermittent "bad periods" are not explained by the R3 being plugged
   in.** R3 unplugged: ~94 s of US operation, 0 deaf seconds. R3 plugged back in
   (08:15): 70 s of US operation plus 10 s at 903 MHz, **also 0 deaf seconds**
   (13–36 reads/s; 35–42 at 903 MHz). The bad periods seen between 07:10 and
   07:35 simply were not happening any more. Open: whether they need the R3
   *actively reading* (not just powered), or come from something else in the
   apartment that varies over time (phones, neighbours' devices, cellular
   load). A long, timestamped monitor run is the way to catch them.
3. Fixed-channel operation is a diagnostic only: hopping is what the rules and
   the presets expect.

### The Fast Inventory switch the SDK calls "LBT" (08:30–08:45, R + B)

- **R:** the C5 SDK has `setLBTMode(b)` → `UHFSetFastInventoryMode(0, b, 2, 0, 0)` →
  frame `64 [00][b][02][00][00]`, and `getLBTMode()` → `66 [02][00]`, reply byte 1.
  The R3 vendor demo's "LBT Open/Close" button calls `UHFSetFastInventoryEX`
  (REA call edges, `ev_950dccbe…`). So LBT rides on the Fast Inventory command,
  whose four bytes the R3 header names `cr`, `code`, `protection`, `id` (the
  3-byte form calls the first one `enable`; see Gen2X Fast Inventory below).
- **B, 20-min monitor (08:10–08:30, as booted, tags not moved):** 19 of 41
  five-second samples were bad, one stretch 08:12–08:17 and scattered after.
  Every bad sample (1 tag) had reads on only **2–4 channels**, every good one on
  **17–36**.
- **B, `66` reads:** as booted `01 00 01 02 02`; after `64 00 00 02 00 00`
  `01 00 02 00 00`; after `64 00 01 02 00 00` `01 01 02 00 00`. The request's
  parameter byte is ignored; the reply mirrors the last write. After a power
  cycle it is back to `01 00 01 02 02` (save byte 0 honoured).
- **B, interleaved, 8-s runs, two rounds each:**

| Preset | "LBT off" `64 00 00 02 00 00` | "LBT on" `64 00 01 02 00 00` |
|---|---|---|
| USA | 277 reads / 16 s (~17/s), 0 deaf s | **1,733 reads / 16 s (~110/s)**, 0 deaf s |
| Indonesia (923–925) | **0** reads, 16/16 deaf | round 1: 0; round 2: 108 reads |
| China 2 (920–925) | **0** reads, 16/16 deaf | round 1: 0; round 2: **215 reads, 0 deaf s** |

**Which byte (08:40, B).** Four frames, each read back by `66`, interleaved
twice for 8 s on the US plan and on China 2:

| Bytes after save | First byte | US reads/s | US deaf s | US channels with reads | China 2 reads/s (tags) |
|---|---|---|---|---|---|
| `00 01 02 02` as booted | 0 | 16 | 1/16 | 25–27 | 10 (1–2) |
| `00 02 00 00` SDK "LBT off" | 0 | 14 | 1/16 | 14–22 | – |
| `01 02 00 00` SDK "LBT on" | 1 | 104 | 0/16 | 42–45 | 23 (2) |
| `01 01 02 02` first byte only | 1 | 101 | 0/16 | 41–42 | 22 (2) |

All four found 19–21 tags per US run.

**Over a minute (08:41–08:44, B):**

| 60-s run | Tags | Reads/s median (min) | Deaf s | 100-ms slots with a read | Strongest tag: reads, longest gap | Last new tag at |
|---|---|---|---|---|---|---|
| US, first byte 1 | 21 | 114 (38) | **0** | 96 % | 597, 0.3 s | 13.3 s |
| US, as booted (0) | 22 | 13 (0) | **6** | 46 % | 57, 2.6 s | 25.5 s |
| China 2, first byte 1 | **2** | 28 (19) | 0 | 98 % | 1,610, 0.3 s | 1.4 s |

**What it shows:**
1. **Only the first byte matters**: the one the R3 header calls `cr`, the
   3-byte form calls `enable`, and the C5's `setLBTMode` writes. Code,
   protection and id changed nothing visible.
2. **At 0 the module inventories in bursts:** reads for ~0.1–0.3 s about every
   0.4 s, any read in only 41–57 % of 100-ms slots; the strongest tag comes up
   about once a second, weaker ones every 2–4 s. A burst that lands on a drowned
   channel loses the whole second: those are the deaf seconds. **At 1 it reads
   continuously** (90–98 % of slots), each tag several times a second, and no
   second of 92 s of US runs was deaf. It also reached a few tags at 923.8–925.3
   MHz (5–17 reads per channel a minute), where the booted setting got 0–2.
3. **It does not make the radio more sensitive.** In 60 s both values found the
   same tags (21 vs 22; the difference is one tag at −77 dBm read four times).
   On China 2 (920–925 MHz) the first byte at 1 still heard only the two tags
   stronger than about −64 dBm; the other ~19 stayed invisible.
4. **No tag family is hidden by it:** the NXP tags and both Impinj tags (M830,
   R6-P) were read at either value; the M830 366 times in 60 s at 1, 43 at 0.
5. **The 08:30 "listens first" reading is withdrawn.** At 1 the module read
   steadily on the noisy China 2 channels instead of avoiding them: it behaves
   like continuous inventory (Chainway's "Fast Inventory"), not
   listen-before-talk. What the firmware really switches, and why the SDK
   calls it LBT, is a question for Chainway.
6. Every write was unsaved. The run ended with `2C 00 08` and
   `64 00 00 01 02 02`; the final read was `66` → `01 00 01 02 02`, region
   `01 08`, table `00`, TagFocus and FastID off, as at the start.
7. Not shown yet: whether the first byte at 1 rides through a long bad stretch
   like 08:12–08:17 (none came back during the test), and what continuous
   inventory costs in battery and heat.

**The edge decides the count, not the setting (B).** Between 08:30 and 08:40
ten weak tags (−71 to −76 dBm) dropped out of every run at every setting,
while the M830 got ~2.5 dB stronger and the R6-P ~2–3 dB weaker: the geometry
changed (the C5 or the tags moved a little), not the radio settings. Tags
weaker than about −75 dBm at the reader turned up only now and then (the R6-P
3–4 times a minute), so a still reader keeps finding "new" tags for 10–25 s and
a live count swings by the number of edge tags. A handheld can be brought to
the goods; a fixed station (the till's R3) keeps its edge where it is.

### What still has to be proven

| # | Question | Test | Needs |
|---|---|---|---|
| 1 | ~~Is the 920–925 MHz noise the nearby R3?~~ **No** (still deaf with it unplugged). ~~Does a plugged-in R3 cause the dropouts?~~ **Not shown** (A/B both clean, 08:15). What does cause the intermittent dropouts? The 20-min monitor caught them (19/41 samples bad, 08:12–08:17 the longest) but not their source | a longer timestamped monitor, noting R3 activity and phone use | C5 left on the bench |
| 2 | Do phones cause the bursty dropouts in the US plan? | same test with phones in airplane mode or away | Hari, 5 minutes |
| 3 | Is it this location? | rerun the preset test in a store or far from windows | someone on site |
| 4 | What does Chainway's Indonesia table really contain, and is there a module/filter variant for 920–923 MHz near 925 MHz cellular? | ask Chainway | message to Chainway |
| 5 | Does canary gating make counts consistent? | prototype in the C5 app: no sweep ends during deaf seconds | code change, bench |
| 6 | How fast do TagFocus'd Impinj tags come back? | recovery curve, 0.25–4 s pauses, canary-gated | bench |
| 7 | Does the R3 at the till suffer the same? | read its region, run the same preset test there | Windows till with an R3 |
| 8 | ~~Which byte of the "LBT" frame matters?~~ **The first** (08:40). Does it ride through a long bad stretch, and hold in a store? | the same A/B during a bad period, then at a store | bench, then site |
| 9 | What does continuous inventory cost? | battery per hour and module temperature, first byte 0 vs 1, same sweep pattern | C5, 2 hours |
| 10 | Which chips are the ~17 tags with no census yet, i.e. how many can TagFocus silence? | EPC+TID and FastID census, 15 s each, tags as they lie now | bench, 1 minute |

---

## Steering which tags answer (reader-side, for counts)

All of this is reader-side and temporary: it moves flags inside the tags for
the inventory rounds of one session, and the flags decay on their own (table
above). Nothing is written to tag memory.

**The two Gen2 levers (D, GS1 Gen2 Select and Query).** A Select names a mask
and says what happens to the flag of the tags that match and of those that do not:

| Action | Matching tags | Non-matching tags |
|---|---|---|
| 0 | → A (assert SL) | → B (deassert SL) |
| 1 | → A (assert SL) | nothing |
| 2 | nothing | → B (deassert SL) |
| 3 | flip A↔B (negate SL) | nothing |
| 4 | → B (deassert SL) | → A (assert SL) |
| 5 | → B (deassert SL) | nothing |
| 6 | nothing | → A (assert SL) |
| 7 | nothing | flip A↔B (negate SL) |

Select target 0–3 picks the S0–S3 flag, 4 picks SL. The Query then asks one
session and one target (A or B), and with Sel 3 only tags with SL asserted.

**Where those live in our SDKs (R):** the mask is `setFilter` / `UHFSetFilter`
(`6E`, pointer and length in bits, EPC data starts at bit 32); Select target and
action are Gen2 byte 0 (`selectTarget`, `selectAction`); Query session, target
and Sel are byte 3 (`querySession`, `queryTarget`, `querySel`); dual target is `6A`.

| Goal | Settings | Notes |
|---|---|---|
| Wake every silent tag of ours now | Select target = the session in use, action 1, mask header `A1` (bit 32, 8 bits) | flips our tags to A, leaves foreign tags alone |
| Never let a still pile go silent | dual target (`6A` mode 0), or session S0 with the field stopped between reads | dual asks B too; S0 resets as soon as the field stops |
| Silence one SKU (e.g. already counted) | Select target S1, action 5, mask = SKU (bit 32, 52 bits); Query S1, target A | matching tags sit in B; refreshed if the module re-sends the Select each round (I) |
| Hear only tags NOT matching a mask | Select target SL, action 4, mask; Query Sel 3 | clear instantly with Sel 0; touches no session flag |
| Hear only our tags | Select target SL, action 0, mask header `A1`; Query Sel 3 | the SL form of today's "ours only" filter |

Limits:
- **One mask is one contiguous bit range.** A SKU prefix or the header is one
  mask; a list of unrelated serials is one mask each. The C5 SDK takes up to 8
  masks in one `setFilter(List)` call (R); the module's own limit is unknown.
  Longer lists belong in software (an ignore set), at the cost of air time.
- **Session flags are shared by every reader in range.** Two handhelds in one
  aisle on S1 move each other's tags. Pick sessions on purpose.
- **Whether the Chainway firmware sends the Select once or every round, and
  whether a zero-length mask turns it off, is I.** Bench before relying on it.
- Select target and action live in Gen2 byte 0 and are written with the whole
  block; on the C5 a read-modify-write keeps the other fields (bench, 23 Oct).

---

## Seeing under the hood without the module firmware

Chainway is unlikely to hand over `E710_V7.10.1`. None of the questions above
needs it; each one has a cheaper window:

| Window | What it shows | Cost | Evidence |
|---|---|---|---|
| **C5 SDK debug log** | every command frame the SDK sends and every raw reply chunk, in logcat (tag `DeviceAPI`): settles the `22` layout, shows every read-modify-write, every setting's raw value | one `setDebug(true)` call in a lab build; C5 on USB | R: Java `setDebug(b)` → `UHFSetDebug` → `UHF_SetDebug` 0x193344 sets the flag; `External_SendAndRecv` 0x187be4 then logs `send command length` + the whole frame and `recv length` + the bytes. Our app never calls it. Tag frames (`83`) come through the reader thread, not this path. |
| **Raw commands** | settings no SDK call returns: single/dual `6C`, duty cycle `3E`, R3 repeat filter `A1 14`, Fast Inventory `66`, raw `22` | none | C5 `DeviceAPI.UHFUnvarnishedTransmission`, R3 `SendBytes`/`RecvBytes` (22 Oct doc) |
| **USB capture on the till** | every frame between `rfid.rs`/the DLL and the R3, both ways | free: Wireshark + USBPcap on the Windows till | the R3 talks HID reports over libusb (22 Oct §8), which USBPcap records |
| **Black-box bench runs** | how long tags stay quiet per setting, whether the Select is re-sent each round, whether a zero-length mask clears, TagFocus on Impinj vs other silicon | bench time; the per-EPC gap instrument already exists in the C5 app | – |
| **Radio sniffing (SDR)** | the actual Gen2 commands on the air: the Select TagFocus sends, Query session/target/Q, how often each is repeated | an SDR that covers 920 MHz (e.g. a HackRF-class radio) + an open-source Gen2 decoder; passive listening to our own reader in our own room | the only window onto what the E710 itself transmits |

Order of attack: debug log and raw reads first (free, settle the `getGen2`
question in minutes), bench runs second, SDR only if the bench leaves a
question about what the chip puts on the air.

---

## Feature map

| Impinj feature | What it does | C5 call → frame | R3 call → frame | We use it | Verdict |
|---|---|---|---|---|---|
| RF link / RF mode | forward/back link profile (Miller, BLF); Gen2X and AutoSet variants | `setRFLink(m)` → `52 [00][01][m]` (saves) | `UHFSetRFLink(save,m)` → `52 [00][save][m]` | C5: pinned and re-applied; R3: moved off Gen2X | keep pinning; send save=0 raw on the C5 |
| Gen2 Query/Select block | session, target A/B, Q, Select target/action, Query Sel, M, BLF | `setGen2(Gen2Entity)` → `20 [4 bytes]` | `UHFSetGen2(14 × u8)` → `20 [4 bytes]` | both, via read-modify-write | **write full explicit blocks; settle the `22` layout first** |
| Single / dual target | Query always A, or alternate A↔B | hidden `UHFSetSingelMode(m)` → `6A [01][m]` | `UHFSetDualSingelMode(save,m)` → `6A [save][m]` | no | read it; it decides whether S0 tags go quiet |
| TagFocus | Impinj tags in S1/target A stay quiet while energised after one read | `setTagFocus(b)` → get `62`, set `60 [b][00]` if different | `UHFSetTagfocus(b)` → `60 [b][00]` | C5: on for counting (S1, A); R3: forced off | keep as is |
| FastID | TID returned with the EPC in the same reply | `setFastID(b)` → get `5E`, set `5C [b][00]` if different | `UHFSetFastID(b)` → `5C [b][00]` | C5: off, diagnostics only; R3: forced off | keep off for counts |
| Gen2X Fast Inventory (CR) | compact replies, coded backscatter, reply protection, short IDs | `setFastInventoryMode(cr)` → raw `64 [01][cr][00]` (saves) | `UHFSetFastInventory(save,en)` → `64 [save][en][00]`; `…EX(save,cr,code,prot,id)` → `64 [5 bytes]` | no | bench only, after the tag census |
| Select filter | Gen2 Select on a mask; up to 8 on the C5 | `setFilter(bank,ptr,len,hex)` → `6E [00][bank][ptr2][len2][mask]`; `setFilter(List)` → raw multi-`6E` | `UHFSetFilter(save,bank,ptr,len,data)` → same | C5: SKU and "ours only"; R3: cleared on open | use SL-based Select (below) |
| Inventory data mode | EPC, EPC+TID, +USER, +Reserved, **+M775 auth** | `setEPCAndTIDUserMode(entity)` → `70 [00][mode][off][len][pwd 4]` | `UHFSetEPCTIDUSERMode(save,mode,addr,len)` → `70 [4 bytes]` | EPC only | keep EPC |
| Chip identification | maker/model from the TID | Java table `utility.c.a(tid)` | none | no (own `Tid` decoder) | keep ours |
| M775 authentication | tag proves it holds an Impinj-held AES key | mode 3 of `70`, or `UHFAuthenticateCommon` → `8E` | `UHFAuthenticateCommon` → `8E` | no | only with Impinj's service |
| Protected Mode + Short Range | hide the tag behind a PIN; cut its range | `setProtectedModeAndShortRangeMode(pwd,filter,pm,sr)` → `90` | `UHFSetProtectionAndShortRange` → `90` | no | never in production flows |
| Margin Read | check written bits have enough margin (Integra) | `marginRead(...)` → `97` | `UHFMarginRead` → `97` | no | do not call until `97` is settled |
| Monza 4QT "QT" | public/private memory profile, short range | hidden `SetQTPara`/`GetQTPara`, `UHFRead/WriteQTData*` → `97`/`99`/`9B`/`9D` | `UHFSetQT`/`GetQT`/`ReadQT`/`WriteQT` → same | no | obsolete chip; ignore |
| BlockWrite / BlockPermalock | multi-word write; permanent per-block lock of user memory | `blockWriteData` → `93`; `uhfBlockPermalock` → `9F` | `UHFBlockWriteData` → `93`; `UHFBlockPermalock` → `9F` | no | not needed |
| Phase, channel, RSSI | per-read RF phase and channel for motion/locate | `startInventoryTag(InventoryParameter)` → `82 FF FF` / `FF FE` / `FF FD` | same start frames in the DLL | no | bench (also escapes the C5 −25 dBm drop) |

---

## Module command map (Impinj-related opcodes)

Every row was read in both SDKs unless marked. The reply carries `CMD+1`.
"AP" is the 4-byte access password; "mask" is `[bank][ptr 2 BE][len 2 BE][ceil(len/8) bytes]`,
pointer and length in **bits**.

| Cmd | Purpose | Payload | C5 | R3 |
|---|---|---|---|---|
| `08` | inventory mode, 8 fields | `[01][p1][p2 BE 4][p3..p8]` | hidden `UHFSetInventoryMode` | – |
| `20` / `22` | Gen2 block set / get | 4 packed bytes (below) / none | `UHF_SET_Gen2`, `UHF_Get_Gen2` | `UHFSetGen2`, `UHFGetGen2` |
| `52` / `54` | RF link set / get | `[00][save][mode]` / `[00][00]` | save forced `01` | caller's save |
| `5C` / `5E` | FastID set / get | `[flag][00]` / `[00][00]` | get first, write only if different | write always |
| `60` / `62` | TagFocus set / get | `[flag][00]` / `[00][00]` | get first, write only if different | write always |
| `64` / `66` | Fast Inventory set / get | `[save][en][00]` or `[save][cr][code][prot][id]` / `[00][00]` | Java sends `[01][cr][00]` raw | both forms |
| `6A` / `6C` | single / dual target set / get | `[save][mode]` (1 single, 0 dual) / none | hidden, save forced `01` | caller's save |
| `6E` | Select filter | `[save][bank][ptr 2][len 2][mask bytes]` | save `00` | caller's save |
| `70` / `72` | inventory data mode | C5 `[00][mode][off][len][AP]`; R3 `[save][mode][addr][len]` | modes 0–4, 10–15 | header documents 0–2 |
| `80` | one-shot inventory, first tag | `[00 64]` | used inside the C5 QT calls | – |
| `82` | start inventory (+phase/channel flags) | `[00 00]`, `[FF FF]`, `[FF FE]`, `[FF FD]` | yes | yes |
| `8E` | Gen2v2 Authenticate | `[AP][mask][msgLen+1][keyID][msg]` | yes | yes |
| `90` | Protected Mode + Short Range | `[AP][mask][pm][sr]` | E710 only | yes |
| `93` | BlockWrite | `[AP][mask][bank][ptr 2][cnt 2][data]` | yes | yes |
| `97` | **Margin Read** | `[AP][mask][bank][ptr 2][cnt 2][expected data]` | yes | yes |
| `97` | **QT set** (same opcode) | `[AP][mask][QT byte]` | yes | yes |
| `99` | QT get | `[AP][mask]` | yes | yes |
| `9B` / `9D` | QT read / write | `[AP][mask][QT][bank][ptr 2][00][cnt]` (+ data) | yes | yes |
| `9F` | BlockPermalock | `[AP][mask][readLock][bank][blockPtr 2][00][range][mask words]` | yes | yes |

---

## Feature by feature

### Reader chips

(D, from the research agent's sources; numbers in the agent report's source list.)

| Device | Module and chip |
|---|---|
| C5 | CM710-1 (Impinj **E710**) or CM2000-1 (Indy R2000). Ours reports `E710_V7.10.1`. |
| R3 | CM310-4 (Impinj **E310**) or CM510-4 (Impinj **E510**), 1–30 dBm, up to 50 cm |
| R3S | Impinj **E310** with Gen2X, rated 100 cm with an M750 tag |

| | E710 | E510 | E310 |
|---|---|---|---|
| Rx sensitivity, FCC dense-reader mode (250 kHz, Miller 4) | −88 dBm | −82 dBm | −75 dBm |
| Rx sensitivity, most sensitive mode (160 kHz, Miller 8) | −98 dBm | −93 dBm | −84 dBm |
| Max read rate | ~1,100 tags/s | ~700 tags/s | ~250 tags/s |
| RF modes | all | no FM0 modes | only 222, 223, 241, 244, 285 |

All four E-series chips run Impinj firmware only, talk to the host MCU over
SPI, measure phase to ±5° (180° ambiguity outside FM0), and give RSSI to ±3 dB
after calibration. The C5's module MCU runs Chainway's firmware on top; that is
the layer the `A5 5A` protocol talks to.

### RF link profiles: Impinj RF modes, Gen2X, AutoSet

**The table (R).** `UHFAPI.h` still documents four R2000-era modes (0 DSB-ASK/FM0/40 kHz …
3 DSB-ASK/FM0/400 kHz). The vendor demo's `cmbRFLink` offers the current set,
and `rfid.rs` carries the vendor API document V1.0.3's version of it:

| Mode | Kind | Back link |
|---|---|---|
| 0 | PR-ASK | Miller 8, 160 kHz |
| 1 | PR-ASK | Miller 4, 250 kHz |
| 2 | PR-ASK | Miller 4, 320 kHz |
| 3 | PR-ASK | Miller 4, 640 kHz |
| 4 | PR-ASK | Miller 2, 320 kHz |
| 5 | PR-ASK | Miller 2, 640 kHz |
| 10–15 (A–F) | **Gen2X** | same six, in the same order |
| 20–25 | "Autoset" (API doc only) | same six |

**What the SDKs do (R).** C5 `setRFLink(m)` → `52 [00][01][m]`; R3
`UHFSetRFLink(save, m)` → `52 [00][save][m]`. Neither SDK checks the mode
against a table, so the firmware is the only judge. Getter `54 [00][00]`, mode in
reply byte 2, status checked on both.

**The save byte.** The C5 hard-codes `01` where the R3 puts its save flag. Our
own notes say the link mode survived app restarts, and every C5 `free()` cuts
the module's power through GPIO (22 Oct §1), so the value lives in the module's
flash. That fits a save. **Every C5 `setRFLink` is a flash write (I, strong).**
`Reader.kt` already re-applies the link on wake, which is the right defence; the
remaining risk is flash wear and other apps' leftovers. Raw `52 00 00 m` through
`UHFUnvarnishedTransmission` would set it without saving (bench).

**What a Gen2X round is (D, Impinj M830/M850 datasheet).** It starts with a
Gen2X preamble and a **Scan** command instead of Query; the tag answers with an
improved preamble, antipodal (BPSK) encoding, an optional extended pilot and
forward error correction (up to 7.5 dB better Eb/N0). A tag without Gen2X never
recognises Scan, so it is not slow in a Gen2X round — it is absent. That is the
field note's "11 of 31, in all six Gen2X modes, whatever the data rate": a
population, not a link budget. Gen2X tags: M830/M850 and M770/M775/M780/M781;
**not** M730/M750 (D). Session and Select flags are shared between Gen2 and
Gen2X rounds, so a tag silenced in one is silent in the other.

**AutoSet (D):** the reader cycles through several RF modes until no new tag
answers (2–4 modes depending on the profile). The vendor API document's modes
20–25 are presumably Chainway's handle on it (I).

**Impinj's own RF modes** (103, 120, 124, 141, 146, 185, 222–244, 285, 302–382…)
pair Tari, PIE, BLF and encoding per region; Chainway's 0–5 table names only the
back link. Which Impinj mode each Chainway number selects is firmware detail (I).
On an E310 (R3, R3S) only five Impinj modes exist, all ETSI-band, so Chainway's
six numbers cannot all be distinct there (I).

### Gen2 block: session, target, Q, Select

**Encoding (R, identical in both SDKs).** Fourteen fields packed into four bytes:

```
byte 0  Target(3) <<5 | Action(3) <<2 | Truncate(1) <<1 | Q algorithm(1)
byte 1  StartQ(4) <<4 | MinQ(4)
byte 2  MaxQ(4)   <<4 | DR(1) <<3 | M(2) <<1 | TRext(1)
byte 3  Sel(2)    <<6 | Session(2) <<4 | Target A/B(1) <<3 | LF(3)
```

- Target/Action/Truncate are the **Select** command's (Target 0–3 = S0–S3, 4 = SL).
- Q algorithm: 0 fixed (StartQ used), 1 dynamic (between MinQ and MaxQ).
- DR 0 = 8, 1 = 64/3. M 0–3 = FM0, Miller 2, 4, 8. TRext = pilot tone.
- Sel: which tags the Query asks by SL (0/1 all, 2 not-SL, 3 SL). Session S0–S3.
  The Query target A/B is the bit the header calls `G`.
- LF codes (demo `cmbLinkFrequency`): 0 = 40, 1 = 160, 2 = 200, 3 = 250,
  4 = 300, 5 = 320, 6 = 400, 7 = 640 kHz.

C5 `UHF_SET_Gen2` 0x18d9a8 and R3 `UHFSetGen2` 0x180013b10 compute the same
bytes. `setGen2` (Java) does not call `Gen2Entity.checkParameter()`; if anything
does, note that it rejects `startQ == 1` (it compares that one field with `1`
instead of `-1`, R).

**Bench result, 23 Oct (C5, E710_V7.10.1): no trap.** Through the app's lab
channel, `state` read `q=1, startQ=6, minQ=0, maxQ=15, querySel=0, S0, target A`;
`session 1` (a read-modify-write) then `state` read the identical block with
only `querySession=1`. An off-by-one would have read back `startQ=0, minQ=1,
maxQ=6, querySel=3, session 3`. So the reasoning below was tested and **did not
happen**; it is kept only as the record of what was checked.

**The suspected getter trap (refuted).** C5 `UHF_Get_Gen2` 0x18d84c and R3
`UHFGetGen2` 0x180013c50 both send `22` with no data and decode reply bytes 0–3
straight into the fourteen fields. Neither looks for a status byte (the C5
assembly reads `[sp+0x20..0x23]`, the start of the reply buffer, right after a
zero return). Almost every other getter in both SDKs treats reply byte 0 as the
status (`01`) and the value as byte 1 or 2.

- **If the `23` reply has no status byte,** the decode is right and nothing below matters.
- **If it does,** every `getGen2` returns `selectTarget 0, selectAction 0,
  selectTruncate 0, q 1` whatever the module holds, and every other field comes
  from the byte before it. Read-modify-write then writes the shifted block
  back. With a typical block the written result has StartQ taken from the real
  Target/Action bits (a handful of slots) and Sel taken from the real MaxQ (often 3 = SL).
- Our code reads before every write: `Reader.kt` `tuneGen2` and
  `resetRadioDefaults` (which sets ten fields and keeps DR, M, TRext and LF from
  the read), and `rfid.rs` `pin_profile` (which changes only session and
  target). `rfid.rs` then checks session and target only; under the
  off-by-one they read back from the real StartQ/MinQ bits, so the check can
  pass on a corrupted block.
- `Reader.kt`'s own history fits the off-by-one: "the block came back carrying
  `q=1` … a rack that counts three garments instead of fifty". It fits a real
  dynamic-Q default too. The bench test below separates them in one call.

**Where repeated read-modify-writes end up (arithmetic on the R encoding; holds
only if the off-by-one is real).** Each cycle writes `[01][old b0][old b1][old b2
with session/target replaced]`, so the real block moves one byte per cycle:

```
start      (r0, r1, r2, r3)
1 cycle    (01, r0, r1, r2')
2 cycles   (01, 01, r0, r1')
3 cycles   (01, 01, 01, r0')
4+ cycles  (01, 01, 01, 01 | session<<4 | target<<3)     fixed point
```

The fixed point is: dynamic Q, **StartQ 0, MinQ 1, MaxQ 0** — one slot per
round, capped there — FM0 with pilot tone, LF code 1 (160 kHz), no Select, the
wanted session and target. One slot per round means two tags in the field
already collide, and a pile reads a few tags at a time, different ones each
round: **most tags look "silent for a long time"**, and the count lands far
below the pile.

- The C5 does one such cycle on **every module open** (`Reader.kt`
  `restoreGen2`, run after power changes, cleared filters and re-opens), plus one
  per `tuneGen2`. Four opens reach the fixed point.
- The R3 does one per till start (`rfid.rs` `pin_profile`).
- `resetRadioDefaults` writes q 0, StartQ 6, MinQ 0, MaxQ 15 explicitly, which
  would undo the damage: that matches "reset fixed it".
- **Signature to look for:** at the fixed point a `gen2Dump()` prints
  `selectTarget=0, selectAction=0, selectTruncate=0, q=1, startQ=0, minQ=1,
  maxQ=0, queryDR=0, queryM=0, queryTRext=1, querySel=0, querySession=0,
  queryTarget=0, linkFrequency=1`, whatever session the module really runs.
  The comment on `gen2Dump()` already guesses "a Q of zero, say".

### Single vs dual target

`6A [save][mode]`, 1 = single (Query target stays A), 0 = dual (A↔B each round).
R3 exposes it; on the C5 it is only the hidden native `UHFSetSingelMode`, which
forces save `01` (R, 0x1837b4). Neither app reads it, and the C5 value is
whatever was last saved.

It matters for everything below: in **single-target S0**, a tag that has been
read flips to B and stays quiet while energised, so a still pile reads once; in
**dual**, B is asked too and the pile is re-read every round.

Impinj's reader software names the same choice "search mode" (D): Single
Target (only A answers), Dual Target (A and B rounds alternate, so tags are read
over and over), TagFocus (single target with suppression), Single Target Reset,
and Dual Target with B→A Select (each tag once, then everything in view reset;
paired with S2/S3). Small or still populations want dual; large or moving ones
want single.

**When a flag actually flips (D, Gen2 3.0.1 §6.3.2.10):** not on the ACK. The
tag flips A→B on the **next** QueryRep or QueryAdjust of the same session, or on
the next Query if it was acknowledged. S1 never times out in the middle of a
round. A NAK leaves the flag alone.

### TagFocus

**SDK (R).** C5 `R2000_Set_TagFocus` 0x18cd78 reads `62` first and writes
`60 [flag][00]` only when the module reports a different value; R3
`UHFSetTagfocus` 0x180015200 writes `60` always. Getter `62 [00 00]` → byte 1.

**How it works on the air (D).**
- **The tag:** a read tag flips its S1 flag to B, as any tag does. A
  TagFocus-capable Impinj tag that receives the TagFocus Select keeps
  **refreshing** that B for as long as it stays energised ("indefinitely
  refreshing their S1 B state": Monza 5, R6, M700, M800 datasheets). Plain S1
  would fall back to A within 0.5–5 s.
- **The round:** session S1, target A. In any round that also asks for B (dual
  target), the held tags answer the B query and flip back to A — so TagFocus
  only works with single target A.
- **The command:** a Select sent **every round**. Zebra: tags that miss the
  first round's Select get read 2–3 times. Impinj's patents (US 9,330,284
  "broadcast refresh of RFID tag persistence"; US 8,134,451 for FastID) describe
  it as a Select whose mask, over the TID bank (example: MemBank 2, Pointer
  0x06, Length 0x14), carries Impinj's MDID plus a 5-bit custom command code;
  supporting tags ignore the Select's Target and Action. The production bit
  values are not published.
- **Who honours it:** Monza 4/5/R6/X, M730–M781, M830/M850. No non-Impinj chip
  is documented. A foreign tag in the same round behaves like plain S1.
- **How long silent:** for as long as it stays powered; once out of the field,
  S1 runs down in 0.5–5 s (Keonn measures 1–2 s).

**What we measured** (SCAN-REDESIGN.md §Tag Focus): in S0 it changed nothing
(93.1 % → 92.6 % duplicates); in S1/target A it is a large win, and with Gen2X
modes it reached 1.2 reads per tag. `Reader.kt` sets the session before TagFocus.
`rfid.rs` forces it off on the till, which is right for a pad that must re-read a
basket at every sale.

### FastID

**SDK (R).** Same shape as TagFocus: C5 `R2000_Set_FastID` 0x18cca8 reads `5E`,
writes `5C [flag][00]` only on change; R3 writes `5C` always.

**How it works on the air (D).** The same Impinj custom-Select scheme switches
the tag into a mode where its reply to ACK is the EPC **followed by its TID**,
so the reader skips Req_RN + Read(TID) for each tag ("2–3× faster EPC+TID
inventory"). The reply is roughly twice as long, which is why weak tags drop
out (field note: 58 → 42 tags). On M800 it works in Gen2 rounds only; Gen2X
rounds have their own TID option in Scan, which fits "Gen2X mode 11 + FastID →
1 tag". Impinj now calls EPC+TID checks spoofable and pushes Endpoint IC
Verification instead.

**What we measured:** Gen2 mode 1 found 58 tags without FastID and 42 with it;
Gen2X mode 11 + FastID found 1. FastID stays a diagnostic.

### Gen2X Fast Inventory (CR)

**SDK (R).**
- R3 `UHFSetFastInventory(save, enable)` 0x180014d20 → `64 [save][enable][00]`.
- R3 `UHFSetFastInventoryEX(save, cr, code, protection, id)` 0x180014e50 →
  `64 [save][cr][code][protection][id]`; `UHFGetFastInventoryEX` → `66 [00 00]`,
  four bytes back after the status.
- Header enums: **cr** 0 off, 1 `CrID16`, 2 `CrStoredCRC`, 3 `CrRN16`, 4 `CrID32`;
  **code** 1 `CodeAntipodal`, 2 `CodeCCOneHalf`, 3 `CodeCCThreeQuarters`;
  **protection** 0 none, 1 parity, 2 CRC5, 3 CRC5Plus;
  **id** 0 `IdNoAckResponse`, 1 `IdTMNPlusTSN`, 2 `IdPart`, 3 `IdFull`.
- The demo exposes only CR (`CrID16 … CrID32`) and a save box.
- C5 Java `setFastInventoryMode(FastInventoryEntity)` does not use the native
  5-byte builder: it sends **raw `64 [01][cr][00]`** (saves, the 3-byte form) and
  `getFastInventoryMode` reads `66 [00 00]` → byte 1 only. So on the C5 the
  `cr` field is really the 3-byte form's enable byte.

**What the fields mean (D, Impinj application WO 2022/159608 and the M800
datasheet; mapping to Chainway's names is close but partly inferred).**
- **cr — collision resolution:** what the tag sends in its first reply instead
  of a random RN16: an RN16, 16 or 32 trailing bits of its identifier, or a
  stored CRC. Replies that already carry part of the ID cut a round trip.
- **id — reply to ACK:** nothing, part of the TID, the identifier minus the part
  already sent, or the whole identifier. `TMNPlusTSN` reads as TID model number
  plus serial (I, from the name).
- **code:** antipodal (BPSK) backscatter or FEC symbol coding; the CC 1/2 and
  3/4 names suggest convolutional code rates (I).
- **protection:** error protection on the first reply; Impinj's patent ties
  parity to the session. What "CRC5Plus" adds is not public.
Impinj markets the result as Gen2X "Fast Reinventory"/"Tag Selection"; none of
it matters to a tag without Gen2X.

### Select filters

**SDK (R).**
- C5 `setFilter(bank, ptr, len, hex)` → `UHFSetFilter_Ex(0, …)` → `6E [00][bank][ptr 2][len 2][mask]`.
  Pointer and length in bits; save `00`.
- C5 `setFilter(List<FilterEntity>)`: up to 8 masks in one raw `6E` frame; an
  empty list falls back to `setFilter(1, 0, 0, "0000")`.
- R3 `UHFSetFilter(save, bank, ptr, len, data)` 0x180015590 → the same frame.
- The mask only says **which** tags match. **What a match does** is in the Gen2
  block: Select target and action (byte 0), and whether the Query looks at SL
  (Sel, byte 3).

**Why our filters "were accepted and not applied", and why clearing needed a
re-open (I, Gen2 mechanics D).**
- With Select target SL and Query Sel = all, the module dutifully sets SL on the
  matching tags and then asks everybody: the filter has no visible effect.
- With Select target S0 and action 0, matching tags go to A and the rest to B.
  The Query asks A, so only matches answer — the filter works.
  **S0 flags persist for as long as the tag stays energised.** If the firmware
  simply stops sending a Select once the mask is cleared (length 0), the B tags
  stay B under a still handheld, in single-target mode for ever. Only cutting
  the field resets them, and a module re-open cuts it (`free()` powers the
  module off). That is exactly what `Reader.kt` `setOursOnlyFilter(false)` found.
- The clean pattern is SL-based: Select target 4 (SL), action 0 (assert on match,
  deassert otherwise), Query Sel 3; **clear by writing Sel 0**, which makes the
  Query ignore SL at once and touches no session flag. That needs a correct,
  full Gen2 write (previous section).

### Inventory data modes and chip identification

**Modes (R, `InventoryModeEntity` constants).** 0 EPC, 1 EPC+TID, 2 EPC+TID+USER,
**3 EPC+TID+M775 authentication**, 4 EPC+TID+Reserved, 10 EPC+Reserved,
11–13 EPC + one bank by offset/length, 14 LED tag, 15 temperature tag.
C5 sends `70 [00][mode][offset][length][AP 4]`; R3 sends `70 [save][mode][addr][len]`
and its DLL range-checks the **save** byte (`< 4`) instead of the mode (R).

**Chip table (R, `com.rscja.utility.c.a(String tid)`).** Case-sensitive
`startsWith` on the TID hex. Impinj rows:

| TID prefix | SDK says |
|---|---|
| `E2801100` | "Moza 4D" |
| `E2801105` | "Moza4 QT" |
| `E280110C` | "Moza 4E" |
| `E2801114` | "Moza 4" |
| `E2801130` | "Moza 5" |
| `E2801160` | "Moza R6" |
| `E2801170` / `71` / `73` | "Moza R6-P" / "R6-A" / "S6-C" |
| `E2801190` | "M750" |
| `E2801191` | "M730" |
| `E28011B0` | "M830/M850" |

"Moza" is the SDK's spelling. No other Impinj model numbers are listed, so
newer M700 parts (M770, M775, M781) come back with no chip info. The EM rows
contain the letter `O` and `/` (`E200BO01/2`) and can never match. Our own `Tid`
decoder (MDID/TMN) is the better source.

### M775 authentication

**Inventory-time (R, C5 only).** Mode 3 of `70`. `parseUHFTag` (`team.qcom.deviceapi.H`)
expects exactly **22 bytes after the TID** and splits them as hex:
8 bytes shortened TID, 8 bytes tag response, 6 bytes "message" (the challenge).
The R3 header lists the same three parts: challenge 6, shortened TID 8, response 8.

**Access-time (R, both).** `UHFAuthenticateCommon(pwd, bank, ptr, mask, maskBits,
keyID, msgLen, msg, …)` → `8E [AP BE][bank][ptr 2][len 2][mask][msgLen+1][keyID][msg]`.
Success is status `01` plus a `00` byte; the rest is returned as raw bytes.
The demo's M775 form insists on a **10-byte message** (default all zeros) and
shows Challenge, Tags Shortened TID and Tag Response.

**What happens underneath (D).** The reader sends a Gen2v2 `Authenticate`
(CSI + message) to an open or secured tag. The M775 computes its answer with
PRESENT-80 (ISO/IEC 29167-11) under a per-chip key Impinj programs at the
factory; an 8-byte response is one PRESENT block. Only Impinj's cloud
Authentication Service can check it (developer programme; Chainway's C66 is a
listed reader). Gen2v2 also defines a broadcast `Challenge` that makes the
answer ride on the next ACK reply during inventory, which is presumably what
data mode 3 uses (I). M830/M850 do not authenticate.

### Protected Mode and Short Range

**SDK (R).** Both send `90 [AP][mask][pm][sr]` (C5 `UHF_ProtectedModeAndShortRangeMode`
0x18e7ec, E710 only; R3 0x180014fc0). The R3 returns the tag's error code on
failure (header: 1 write failed, 34 no tag); the C5 returns −1. Java requires a
hex password; a null filter means "no mask".

**What they do (D).** Both are settings stored in the tag (M700/M800 Reserved
word 4 and a 32-bit PIN). A protected tag stops answering ordinary readers
until one presents the PIN; Impinj calls it a "reversible kill". Short range
cuts the tag's range by roughly 90 % (M700) to 20 dB (M800). Either would make a
store's own tags look missing to every count, which is why this stays out of
our flows.

### Margin Read (Integra) and the `97` collision

**SDK (R).** C5 `UHF_MarginRead` 0x192f18 and R3 `UHFMarginRead` 0x1800150b0 send
`97 [AP][mask][bank][ptr 2][cnt 2][cnt × 2 bytes]`: the last block is the
**expected** data, compared by the tag. The C5 version's return value is computed
from the reply but its pseudocode drops it; R3 returns 0 or the tag's error code.

**Collision (R).** C5 `UHF_SetQTPara` 0x188a58 and R3 `UHFSetQT` 0x180016bf0 also
send `97`, with `[AP][mask][QT byte]`. Same opcode, different layouts, in both
SDKs. One of them is wrong for whatever firmware is installed. Ask Chainway
which one E710_V7.10.1 implements before calling either.

**What it checks (D).** Impinj Integra: every memory word has a parity bit and
a write can leave bits weakly programmed. MarginRead (custom command
`1110000000000001` on M700) asks the tag whether the given bits match the
expected values **with margin**, i.e. whether the write will hold. The M800
runs it by itself after every write.

### Monza 4QT (QT)

**SDK (R).** QT get `99`, read `9B`, write `9D`, set `97` (above). The header's QT
byte: bit 0 short-range control, bit 1 memory map (0 private, 1 public).
- **The C5 versions choose their own tag.** `UHF_SetQTPara` and `UHF_GetQTPara`
  first send `80 [00 64]` (one-shot inventory), take whichever tag answers, and
  build the mask from its PC+EPC (bank 1, pointer 0x10). In a pile, that is a
  random tag.
- C5 `SetQTPara(0)` writes bit 1 = 1 (public); any other value writes 0
  (private). `GetQTPara` returns 1 for private. Neither touches short range.

Background (D): Monza 4QT's custom `QT` command (E000h, secured state only)
switches between a public profile (96-bit public EPC, base TID) and a private
one (128-bit EPC, 512-bit user memory, full TID), with a short-range bit. The
M700/M800 have no QT; they offer Protected Mode and short range instead.

### BlockWrite and BlockPermalock

Plain Gen2 access commands that Impinj chips implement. BlockWrite `93`, the
C5 return is status `01` **and** a `00` byte (assembly at 0x1901bc). BlockPermalock
`9F`: `readLock` 0 reads the lock bits back, 1 locks; the reply returns
`range × 2` bytes. Neither is needed for our tags.

### Phase, frequency, RSSI and locate

- Start frames and the C5's window-free branch are in the 22 Oct doc (§2). The
  native code does not decode phase or channel; Java takes the last 2 bytes
  (phase, raw u16) and 3 bytes (channel, kHz) from the record.
- C5 `startLocation(ctx, epc, …)` is a Select on that EPC, a plain
  `startInventoryTag()` (no phase) and an RSSI loop (R, `m.startLocation`).
  Locate is RSSI-only.

Phase (D): φ = 4πd/λ + fixed offsets, wrapped to 2π; the offsets change with
tag, orientation and **channel**, so phase is only comparable within one
channel. E-series accuracy ±5°, with 180° ambiguity outside FM0. Doppler from a
walking tag is about 6 Hz per m/s and, by an R700 study, too noisy for most
uses. The scale of the SDK's raw u16 phase is not documented (I).

---

## What this means for us

No code was changed. Ranked:

0. **Make every count know whether the radio was deaf** (from the 23 Oct bench).
   - Judge health from three signals, not one: **channel spread** (bad samples
     had reads on 2–4 channels, good ones on 17–36), **coverage of tags already
     seen**, and a **canary tag at a typical distance** (around the RSSI of the
     weakest tags that must be counted). A canary right at the antenna misleads:
     on the drowned 920–925 MHz band the strongest tag kept reading 25×/s while
     ~19 others were invisible.
   - Do not end or file a count during a dropout; stop after ~2 s with no new
     EPC while healthy (minimum 2 s, cap 15–20 s), and tell the operator
     ("signal disturbed — keep scanning"; for stragglers, move closer rather
     than wait).
   - **Try continuous inventory** (Fast Inventory first byte 1, save 0, raw
     `64 00 01 …`) as a lab option in the C5 app and A/B it in a store: on the
     bench it gave ~7× the reads and no deaf second in the same minutes the
     as-booted setting lost 6 of 60. It does not reach further, so it adds to
     the health check rather than replacing it. The till switches Fast Inventory
     off on the R3 (`fast_inventory_off` in `rfid.rs`, part of the plain
     profile); revisit that with the same A/B on an R3.
   - Set the **Indonesian region** with Chainway, then re-measure: on this bench
     920–923 MHz was the weakest stretch, so the band change alone may not cure it.
   - Ask Chainway whether a C5 variant with a 920–925 MHz front-end filter exists.

1. **Gen2 read-modify-write is safe on the C5** (bench, 23 Oct). Repeat the same
   round trip on an R3 before trusting `pin_profile` the same way.
2. **Implement the filter as SL-based** (Select target SL, action 0, Query Sel 3)
   and clear it by writing Sel 0. That should replace the module re-open in
   `setOursOnlyFilter(false)` (bench 3).
3. **Stop saving on the C5 where we can.** RF link, Fast Inventory and
   single/dual go to flash on every call. Send the `00` variant raw, or keep
   re-applying on wake as now and accept the wear.
4. **Read single/dual target** (`6C`) on both readers and record it; it changes
   how S0 behaves.
5. **Leave alone in production:** Margin Read and QT (opcode collision),
   Protected Mode/Short Range (changes tags), Authenticate (needs Impinj's
   service), Fast Inventory until the store A/B in item 0, FastID (costs reads).
6. **Gen2X stays a purchasing question.** Field notes: Gen2X modes see 11 of 31
   of our tags, at 1.2 reads per tag with TagFocus.

## Bench questions

1. **Gen2 reply layout — answered for the C5 (23 Oct): decode is right.** Still to do on an R3: `SendBytes(A5 5A 00 08 22 2A 0D 0A)` then `RecvBytes`, or the same session round trip. Four data bytes means the SDK decode is right; five starting with `01` means it is off by one.
   Cross-check by writing a distinctive block (Target 4, Action 1, Q 0, StartQ 6, MinQ 2, MaxQ 12, DR 1, M 2, TRext 1, Sel 0, Session 1, Target A, LF 4) and calling `getGen2`: off by one reads back `0,0,0,1, 8,4, 6,0,1,0, 3,0,1,5`.
2. Single/dual target on each reader (`6C`), and whether it survives a power cycle.
3. SL-based filter on the C5: Select SL + Sel 3 shows only matches; Sel 0 brings everything back without a re-open.
4. Does `52 00 00 m` (save 0) change the C5 link without surviving a power cycle?
5. Which of Margin Read and QT-set does E710_V7.10.1 run for `97`? (Ask Chainway.)
6. Fast Inventory: what does `66` return on each reader today, and does CR change tags-per-second on our Gen2X-capable tags? **C5 answered (23 Oct):** `01 00 01 02 02` as booted; first byte 1 turns bursty inventory into continuous (~7× reads on every chip we have, same tags found). R3 not benched.
7. M775: does mode 3 return 22 bytes after the TID on any of our tags (only if we ever stock M775).

---

## REA evidence (23 Oct, Ghidra 12.1.4)

| Claim | Function(s) | Address | Evidence |
|---|---|---|---|
| C5 Impinj-related natives (inventory) | search | – | `ev_c6c7543e…` |
| FastID / TagFocus get-then-set, getters, Protected Mode `90`, Margin Read `97` | `R2000_Set_FastID`, `R2000_Set_TagFocus`, `UHF_GetFastId`, `UHF_GetTagFocus`, `UHF_ProtectedModeAndShortRangeMode`, `UHF_MarginRead` | 0x18cca8, 0x18cd78, 0x1931ec, 0x193168, 0x18e7ec, 0x192f18 | `ev_06a8d1dc…` |
| Inventory mode `08`, Authenticate `8E`, Gen2 encode/decode, single/dual `6A`/`6C` | `UHFSetInventoryMode`, `UHFAuthenticateCommon`, `UHF_SET_Gen2`, `UHF_Get_Gen2`, `UHF_SetSingelMode`, `UHF_GetSingelMode` | 0x192370, 0x192a8c, 0x18d9a8, 0x18d84c, 0x1837b4, 0x18385c | `ev_ec953aa7…` |
| Fast Inventory `64`/`66`, QT set/get via `80`, QT read `9B`, JNI Gen2 packing | `UHF_SetFastInventory`, `UHF_GetFastInventory`, `UHF_SetQTPara`, `UHF_GetQTPara`, `UHF_ReadQTData_Ex`, JNI `GetGen2`, `UHFGetGen2_RecvData` | 0x18dd84, 0x18deb0, 0x188a58, 0x1896f8, 0x188f14, 0x154918, 0x1325c4 | `ev_e9ea0928…` |
| Select `6E` (two builders), BlockPermalock `9F`, QT write `9D`, BlockWrite `93` | `UHF_SetFilterer`, `UHF_SetFiltererEx`, `UHF_BlockPermalock_Ex`, `UHF_WriteQTData_Ex`, `UHF_BlockWriteData` | 0x1832b8, 0x18ed1c, 0x18d5e8, 0x18949c, 0x18ffe4 | `ev_748e0ce5…` |
| C5 Gen2 getter reads reply bytes 0–3, no status | `UHF_Get_Gen2` assembly | 0x18d84c | `ev_a82e60b6…` |
| C5 BlockWrite needs status `01` and `00` | `UHF_BlockWriteData` assembly | 0x1901bc | `ev_942084f7…` |
| C5 debug switch logs every frame and reply | `UHF_SetDebug`, `External_SendAndRecv`, `Um7_Send` | 0x193344, 0x187be4, 0x17ec80 | `ev_49d6a60a…` (search `ev_36b7a80c…`) |
| C5 `getCW()` returns the status byte of `26`, not the value | `UHF_GetCW`, JNI `UHFGetCW`, `UHF_SetCW` (`24`) | 0x18f188, 0x148538, 0x18f0e8 | `ev_11f5772a…` (search `ev_471dfb53…`) |
| R3 Impinj-related exports | search | – | `ev_c1b9cc54…` |
| R3 Gen2 getter (same decode), FastID, TagFocus, Fast Inventory both forms | `UHFGetGen2`, `UHFSetFastID`, `UHFGetFastID`, `UHFSetTagfocus`, `UHFSetFastInventory`, `UHFSetFastInventoryEX`, `UHFGetFastInventoryEX` | 0x180013c50 … 0x180014f00 | `ev_53e93654…` |
| R3 Protected Mode `90`, Margin Read `97`, single/dual `6A`, QT set `97` / get `99`, Authenticate `8E` | `UHFSetProtectionAndShortRange`, `UHFMarginRead`, `UHFSetDualSingelMode`, `UHFSetQT`, `UHFGetQT`, `UHFAuthenticateCommon` | 0x180014fc0, 0x1800150b0, 0x180015470, 0x180016bf0, 0x180016d20, 0x180019c60 | `ev_f396fc05…` |
| R3 RF link `52`, Gen2 encode, Select `6E`, data mode `70`, QT read `9B` | `UHFSetRFLink`, `UHFSetGen2`, `UHFSetFilter`, `UHFSetEPCTIDUSERMode`, `UHFReadQT` | 0x180014ac0, 0x180013b10, 0x180015590, 0x1800157c0, 0x180016e50 | `ev_7a3d888c…` |
| R3 RF link getter (byte 2), TagFocus getter, QT write `9D`, BlockPermalock `9F` | `UHFGetRFLink`, `UHFGetTagfocus`, `UHFWriteQT`, `UHFBlockPermalock` | 0x180014b60, 0x1800152a0, 0x180017030, 0x1800171e0 | `ev_651a3229…` |
| Demo M775 form: 10-byte message, Challenge / Shortened TID / Tag Response | `M775AuthenticateAPI`, `M775AuthenticateForm` | – | `ev_7f2d3077…`, strings `ev_ad6c5037…` |
| R3 repeat filter `A1 15`/`A1 14`, duty cycle `3C`, user params `F0 02`, work-mode params `A1 0B`, work seconds `A1 16` | `SetURTagFilter`, `GetURTagFilter`, `UHFSetWorkTime`, `UHFDownloadUserParam`, `UHFSetWorkModePara`, `GetURWorkSeconds` | 0x180018200, 0x180018130, 0x18001a0c0, 0x1800142f0, 0x180017ad0, 0x1800182d0 | `ev_e806cedb…` (search `ev_20d2a310…`) |
