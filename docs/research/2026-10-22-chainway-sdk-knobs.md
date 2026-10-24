# Chainway SDK knobs: C5 handheld and R3/R3S desk reader (22 Oct 2026)

Static reverse engineering of the two vendor SDKs we ship, to list every
setting we could adjust and every place the SDK behaves differently from what
our code assumes. Nothing was run on a device.

**R** = read in the binary or decompiled code (address or class given).
**I** = inferred; settle it on the bench (questions at the end).

## Artifacts and method

| What | File | SHA-256 |
|---|---|---|
| C5 SDK | `handheld/app/libs/DeviceAPI_ver20251103_release.aar` | `4eb33826…2c7a` |
| C5 native, MTK path, arm64 | `jni/arm64-v8a/libDeviceAPIM.so` in that aar | `014d6f06…135e` |
| R3 SDK archive | `Demo_Windwos_R3.rar` (pinned in `pos-windows.yml`) | `65fcb027…8ce3` |
| R3 DLL, x64, built 2025-08-29 | `UHFAPI.dll` (inner `win-UHF_LIB_20250829.rar`) | `25c044a8…def8` |
| R3 vendor demo (.NET, x86) | `UHFAPP.exe` | `d4da4e35…b688` |

- **REA 6.7.0** (`npx -y rea-agents@6.7.0`, CLI) did the engine-free parts:
  - `inspect-artifact` on the aar: evidence `ev_82aabc3e…`.
  - `inspect-managed-native-boundaries` on `UHFAPP.exe`: `ev_4cf57bf1…`.
    - The demo declares 207 `UHFAPI.dll` imports, all cdecl.
    - 4 of them are not exported by the pinned DLL: `UHFBuildDateTime`, `UHFGetInventoryMode`, `UHFSetInventoryMode`, `UHFStopSingle`.
  - `inspect-managed-members --type UHFAPP.ConfigForm`: `ev_4f566992…`, the region labels below.
  - `inspect-pe-resources` on `UHFAPI.dll`: `ev_7efa4831…`. It holds a manifest only, no version resource.
- **Native facts are `llvm-objdump` reads.** REA had no native engine when this audit ran. The key ones were re-checked by hand: the C5 RSSI window, the C5 power frame, and the R3 stop/start flag and return values.
- **Ghidra was set up for REA later the same day** (Ghidra 12.1.4 at `~/tools`, natives built locally for mac_arm_64, JDK 21). REA's Ghidra decompile of `UHF_GetReceived_EX` (`0x182a0c`, Ghidra base 0x100000) shows the C5 window as `if (0x3b6 < (-(uint)CONCAT11(rssi_hi, rssi_lo) & 0xffff) - 0xfa) goto drop;` (evidence `ev_50bb0f55…`).
- Java was decompiled with JADX 1.5.6.

### REA + Ghidra evidence (re-run 22 Oct, Ghidra 12.1.4)

Every key native claim was decompiled again through REA's Ghidra provider. Ghidra rebases the C5 `.so` to 0x100000 (objdump address + 0x100000); DLL addresses are unchanged.

| Claim | Function | Address | REA evidence | What the pseudocode shows |
|---|---|---|---|---|
| C5 drops frames stronger than −25 dBm | `UHF_GetReceived_EX` | 0x182a0c | `ev_50bb0f55…` | `if (0x3b6 < (-(uint)CONCAT11(hi,lo) & 0xffff) - 0xfa) goto drop` |
| C5 power always sends option 2 | `UHF_SetPower` | 0x17fd70 | `ev_54ac9dea…` | E710: `1 ≤ P ≤ 30`, payload `[2][1][P×100][P×100]`, `External_SendAndRecv(0x10, …, 0x4b0)` |
| …while the builder treats 2 as a flag | `UHFSetPower_SendData` | 0x12e05c | `ev_fd6db7e9…` | `bVar3 = param_1 != 0 ? 2 : 0` |
| C5 dynamic power is fire-and-forget | `UHF_SetPowerOnDynamic` | 0x17fb80 | `ev_790e670f…` | sends `A5 5A 00 0A 30 01 P (P^3B) 0D 0A`, no reply read |
| C5 idle stop costs ~2.6 s | `UHF_StopGet` | 0x1838fc | `ev_afc5013f…` | 5 tries × (send `8C`, wait ≤100×5 ms for `closeflag`) |
| C5 raw passthrough | JNI `UHFUnvarnishedTransmission` | 0x13b9dc | `ev_d6a72216…` | argument checks (−1…−5, len ≤ 0x800) → `UHF_UnvarnishedTransmission` → copies reply and length out |
| C5 duty cycle ignores the answer | `UHF_SetPwm` | 0x183424 | `ev_804786c6…` | `External_SendAndRecv(0x3c, [1][work][wait], 5, …)`, reply never checked |
| C5 region codes pass through, always option 1 | `UHF_SetFrequency_EX` | 0x1802bc | `ev_314be894…` | index switch (0→2, 1→1, 2→4, 4→8, 5→0x16, 6→0x32, 7→0x80, 8→0x33, 9→0x34; other values unchanged), then `2C [01][code]` |
| R3 stop needs the DLL's own running flag | `UHFStopGet` | 0x180015c30 | `ev_c11ac3ff…` | per link: `if (+0xa8 && +0xc) stop()`; `return 0` |
| R3 start always returns 0 | `UHFInventory` | 0x180015a70 | `ev_8c56af6f…` | clear queue, `+0x10 = 1`, start routine, `return 0` |
| R3 start sets the running flag | start routine | 0x180011ab0 | `ev_7c0dd195…` | send start frame, then `+0xc = 1` |
| R3 open clears it | link init | 0x18000c680 | `ev_0229969c…` | `memset(link, 0, 0x21d0)`, `_Dst[1] = 0` (+0x8..+0xF) |
| R3 empty and dropped both give −1 | `UHFGetTagData` | 0x180015f60 | `ev_7251bf36…` | length outside 8..256 → −1; `rlen < len` → −1; `2000 < -rssi` → "invalid RSSI!" → −1 |
| R3 power option byte is the save flag | `UHFSetPower` | 0x180013450 | `ev_8b8db921…` | `[save ? 2 : 0][1][P×100][P×100]`, timeout 0x5dc |
| R3 region | `UHFSetRegion` | 0x1800141b0 | `ev_9c0d222d…` | `2C [save][code]`, timeout 0x5dc |
| R3 duty cycle | `UHFSetWorkTime` | 0x18001a0c0 | `ev_627a2757…` | `3C [5 bytes]`, success only when the status byte is 1 |

So the C5 sends option byte 01 on region (`2C [01]`) and on RF link (`52 [00][01]`), where the R3 sends its save flag. **Every C5 region or link write is probably a flash write too (I).**

**Wire frame (both readers, R).** `A5 5A | LEN (2, big-endian, whole frame) | CMD | DATA | XOR(LEN..DATA) | 0D 0A`. The reply carries `CMD+1`, and its first data byte is the status (1 = OK).

---

## C5: `RFIDWithUHFUART` → `com.rscja.team.mtk.deviceapi.m` → `libDeviceAPIM.so`

`ro.cw.model` containing "C5" selects the MTK class. `UHF_OpenAndConnect` sets module type 2 (E710) when the module answers command `0x00`. Every address below is in the E710 branch.

### What the SDK does that our code does not expect

**1. Tags stronger than −25 dBm are dropped silently (R).**
- Where: `UHF_GetReceived_EX` at 0x82fa0–0x82fd8.
- Rule: `v = (−rssi) & 0xFFFF`. A frame is kept only when `250 ≤ v ≤ 1200`, i.e. −120.0 dBm ≤ RSSI ≤ −25.0 dBm. Anything else makes `readTagFromBuffer()` return `null`. Nothing is logged and `getErrCode()` is not set.
- Which frames: only those carrying exactly PC + EPC + RSSI + antenna (branch at 0x82c10). That is every frame in our EPC-only mode, on both the polling path and the callback path. It is the only window in the function.
- Ways around it:
  - **Make frames carry extra bytes.** Start with `startInventoryTag(InventoryParameter(ResultData().setNeedPhase(true)))` (`82 FF FF`, +2 phase bytes), or with `setNeedFrequencyPoint(true)` (`82 FF FE`, +3 bytes). Those frames take the branch at 0x82c14, which has no window. Whether firmware E710_V7.10.1 actually appends the bytes is I.
  - **Drain differently.** `DeviceAPI.getInstance().UHFGetReceived_EX_R2000()` has no window either, but it takes no lock and logs every frame.
- Bench count: logcat tag `DeviceAPI`, line `UHF_StopGet: okcnt=…, GetTagCount=…`. Frames dropped ≈ okcnt − our non-null reads − 1 (one bogus frame per stop).

**2. Any app can make our reader let go (R).**
- `UhfBase.registerUhfPowerOffReceiver` registers `PowerOffReceiver` with flag 2 (`RECEIVER_EXPORTED`) on API 34+.
- An `com.rscja.deviceapi.action.UHF_POWER_OFF` broadcast carrying another `apiId` makes our instance call `free()`.
- `init(null)` skips the receiver, the 200 ms sleep, and the 2 s TCP-service wait (when `sys.uhf.service.enable=1`). But then other UHF apps are not told to release `/dev/ttyS1`.
- The alternative: open normally, then call `unregisterUhfPowerOffReceiver(ctx)` (protected) by reflection.

**3. The screen receiver never runs in this build (R).**
- `isMonitorScreen` is only ever assigned `false` (`iconst_0` in the `UhfBase` constructor), so `ScreenReceiver` never registers.
- `Reader.kt`'s note that the SDK frees the module on screen-off and re-opens it on unlock is wrong for this SDK. If that is seen on a device, the cause is elsewhere.

**4. Every `setPower` probably writes flash (R frame / I meaning).**
- `UHF_SetPower` (0x7fe6c) sends `10 [02][01][RP_H RP_L][WP_H WP_L]`: option byte, antenna, read power, write power, each in dBm×100. It only accepts 1..30 dBm and waits 1200 ms.
- On the same command, the R3 DLL sends 0x02 for save=1 and 0x00 for save=0. On the C5, 0x02 is hard-coded.

**5. A stop on an idle module costs about 2.6 s (R).**
- `UHF_StopGet` waits for the reader thread's `closeflag`, and that thread is not running when nothing is inventorying.
- Keep the `isInventorying` guard.

**6. The reader thread busy-spins and is never joined (R).**
- `Uhf_GetR2000UartData` loops without sleeping on a non-blocking descriptor.
- It is never joined, so each start leaves one thread behind (memory impact I).
- It drops every reply except 0x83 / 0x7F / 0x8D, which is why getters fail during a sweep.

**Not adjustable.** Timeouts are compiled-in constants: 1200 ms per command, 5×100×5 ms for stop, 500/200/20 ms on open. No field can be changed by reflection.

### Knobs

| Knob | API | CMD + payload | Saves? | Values | Ours | Worth it |
|---|---|---|---|---|---|---|
| Power | `setPower` | `10 [02][01][RP][WP]` | 0x02 always (I) | 1–30 dBm | yes, re-opens | send the `00` variant raw (below) |
| Power mid-sweep | `setDynamicDistance(int)` | raw `30 [01][dBm]`, no flush, no reply | – | 1–30 | no | **bench**: may avoid the 1–7 s re-open |
| Region | `setFrequencyMode` / `get` | `2C [01][code]` / `2E` | 01 (I) | code passes through (≥10 unchanged; 0/5/6/7/9 aliased) | read only | **yes**, see Indonesia |
| Channel list | `setFreHop(MHz)` | `14 [01][kHz, 3 bytes BE]`; raw `14 [N][F1..FN]` | ? | kHz | no | narrow to legal channels |
| RF link | `setRFLink` | `52 [00][01][mode]` | 01 (I) | any byte; no table in the SDK | 1 | keep 1 until benched |
| Gen2 | `setGen2` | `20 [4 packed bytes]` | none | q is 1 bit (0 fixed, 1 dynamic) | yes | bench dynamic Q |
| Tag Focus / FastID | `setTagFocus`, `setFastID` | `60 [v][00]` / `5C [v][00]`, only written when changed | – | 0/1 | on / off | keep |
| Data mode | `setEPCAndTIDUserMode` | `70 [00][mode][off][len][pwd 4]` | – | 0–4, 10–15 | EPC | decides whether the −25 dBm window applies |
| Start extras | `startInventoryTag(InventoryParameter)` | `82 [FF FF \| FF FE \| FF FD]` | – | phase / freq point | no | **bench**: escapes the window |
| Fast inventory | `setFastInventoryMode` | `64 [01][cr][00]` / `66` | 01 | 0/1 | no | read, then A/B |
| Duty cycle | hidden `DeviceAPI.UHFSetPwm(work,wait)` / `UHFGetPwm()` | `3C [01][work 2][wait 2]` / `3E` | 01 | u16 (ms, I) | no | read; want wait = 0 |
| Temperature | `getTemperature` | `34` → °C×100 | – | – | no | bench diagnostics |
| Raw frame | hidden `DeviceAPI.UHFUnvarnishedTransmission(byte[]{CMD,…}, len, out, outLen)` | any; waits ≤1200 ms for CMD+1 | – | at rest only | no | **makes the rows above reachable** |

`DeviceAPI.getInstance()` is public and every native it declares is exported, so none of the hidden calls needs reflection. Also hidden: `UHFDwell` (`B2`), `UHFSetParam`/`UHFGetParam` (`18`/`1A`), `UHFSetSoftReset` (`68`), `UHFGetReceived_EX2` (the locked drain that `readTag()` wraps, without its per-tag `DecimalFormat`).

**Never call:**
- `setCW` (continuous carrier) and `factoryReset`.
- `setBaudRate`: the host port is not reopened, and every later open loses about 3.4 s.
- `UHFReadRSSI` and `UHFInventoryBank`: they reuse E710 command IDs for other things.
- `setEPCAndUserReservedModeEx`: it sends `1C`, the baud-rate ID.
- Temperature-protect writes: `38` is the TX-boost getter on this module.
- `setInventoryCallback` together with polling: its thread never exits.

---

## R3 / R3S: `UHFAPI.dll` (x64, image base 0x180000000)

There are 464 exports. Of the 386 that are not `cJSON_*`, all are in `UHFAPI.h` / `HFReader.h`, but only 159 are in the API document. Most knobs below are header-only.

The DLL talks USB through libusb, not hidapi, and accepts only **VID 0x2047 / PID 0x0301** (0x1800221A2). Its transceive routine (`0x18000CA80`) zeroes the reply ring, sends one frame, and waits **1500 ms**; the user-param commands wait 3000 ms. **Any failure comes back as −1** (R), so the 251–255 codes in `said()` never appear.

### What the DLL does that `rfid.rs` does not expect

**1. "Stop on open" sends nothing (R).**
- `UHFStopGet` (0x180015C30) sends `8C` only on links whose running flag `[link+0xC]` is set.
- Only the DLL's own start sets it (0x180011B72 / 0x180011BB3). A fresh `UsbOpen` clears it (0x18000C742).
- So `set_up`'s `stop()` (`rfid.rs:985`) never reaches a reader that a crashed till left inventorying. Such a reader answers only stop (I), so every open would then fail.
- Fix: `SendBytes(A5 5A 00 08 8C 84 0D 0A)` right after `UsbOpen`.

**2. Start and stop always return 0 (R).**
- `UHFInventory` (0x180015AD2) and `UHFStopGet` (0x180015C71) both return 0, and the start is send-only.
- The `started != 0` branch (`rfid.rs:808`) and the stop error branch can never fire, so an ignored start returns an empty basket.
- `setOnEventStopInventory` reports the reader's `8D` acknowledgement; use it to verify the stop.

**3. An empty queue and a dropped record look the same (R).**
- `UHFGetTagData` returns −1 for both: RSSI window at 0x180016238–0x180016276, plus length checks.
- `take_waiting` (`rfid.rs:1440`) stops at the first −1, so every record behind a dropped one is lost. The next `UHFInventory` wipes the queue (0x180015A7F).
- Fix: drain until roughly 30–50 ms of quiet.

**4. No −25 dBm cut on this reader (R).** The window is 0.0 to −200.0 dBm, so tags lying on the pad pass.

**5. Queue overflow loses everything (R).** The 256 KB tag queue is wiped whole when it overflows. The 8 KB USB receive ring is overwritten without checking the consumer.

**6. The last ~150 ms of a read may be lost.**
- Tags are fetched by polling `EB` every 50 ms after a batch that had tags, 150 ms otherwise (R).
- Polling stops when the stop is requested (R), so the tail is lost unless the firmware pushes it (I).
- `UHFStopGet` also always costs at least 100 ms (`Sleep(100)` at 0x180011C68).

**7. Settings `rfid.rs` never reads, any of which can silently empty or bias a read:**

| Setting | Command (get / set) |
|---|---|
| FastInventory | `66` / `64` |
| work/wait duty cycle | `3E` / `3C` |
| antenna mask | `2A` / `28` |
| air protocol | `06 [01]` / `06 [00][type]` |
| work mode (command / auto / trigger) | `A1 06` / `A1 05` |
| dual / single target | `6C` / `6A` |
| reader-side repeat filter | `A1 14` / `A1 15` |
| flash user params | `F0 02` |

The flash user params are `mode` (USB HID keyboard, virtual COM…), `filter`, `stay`, `area` and `power`.

### Region codes

From the vendor UI (REA `ev_4f566992…`; `ConfigForm.Designer.cs:4256`, `ConfigForm.cs:1130`).

| Code | Label | Code | Label |
|---|---|---|---|
| 0x01 | China Standard1 840–845 | 0x02 | **China Standard2 920–925** |
| 0x04 | Europe 865–868 | 0x08 | USA 902–928 |
| 0x16 | Korea 917–923 | 0x32 | Japan 916.8–920.8 |
| 0x33 | South Africa 915–919 | 0x34 | China Taiwan 920–928 |
| 0x35 | Vietnam 918–923 | 0x36 | Peru 915–928 |
| 0x37 | Russia 860–867.6 | 0x3B | Malaysia 919–923 |
| 0x3C | Brazil | 0x3D | ETSI_UPPER 915–921 |
| 0x3E | Australia 920–926 | 0x3F | **Indonesia 920–923** |
| 0x40 | Israel 915–917 | 0x41 | **HK 920–925** |
| 0x42 | New Zealand 920–928 | 0x43 | 880–930 |
| 0x44 | Singapore | | |

The R3 sets it with `UHFSetRegion(save, code)`, which sends `2C [save][code]`. The C5's `setFrequencyMode` passes codes 10 and above through unchanged, so 0x3F reaches the C5 module too. Whether its firmware accepts 0x3F is I: read it back after setting.

### R3 vs R3S

- **There is no separate R3S SDK.** Chainway Europe lists only a datasheet and manual for it, and the manual drives the same UHFAPP over USB.
- **The R3S is not an R3 with a new name.** It uses an Impinj E310 with a near-field antenna, yet is rated at more than 100 cm with an M750 tag. R3 bench values (power, window, RSSI floor) do not carry over.
- **Version string:** both report it from command `C8` as `V<a>.<b>.<c>,<values>`. A form like "R3S-PoE" would be refused by `names_a_desk_reader` (`rfid.rs:196`) (I). Record the real string on the bench.
- **The LAN model (PoE)** uses `TCPConnect`. Tags are pushed rather than polled, and the IP is set with `A1 01`.
- **Power range:** the manual's app and DEVICE.CFG say 5–30 dBm. `R3_POWER_RANGE` is `1..=30`.

---

## Indonesia's band

| Source | Band |
|---|---|
| Chainway's own preset "Indonesia" (code 0x3F) | 920–923 MHz |
| A January 2024 SDPPI certificate (Pepperl+Fuchs UHF head), citing Perdirjen SDPPI 161/2019 | 920–923 MHz |
| The 2007 rule and the GS1 table | 923–925 MHz at 2 W ERP |

- No vendor preset covers exactly 923–925 MHz.
- **Neither device's current region is known.**
- Confirm the band on the devices' own SDPPI certificates before anything writes a region.

---

## Recommended, ranked

**Safe without a bench (R3, `rfid.rs`):**
1. Raw stop after `UsbOpen`.
2. Verify the stop through `setOnEventStopInventory`.
3. Drain until quiet.
4. Read back FastInventory, wait time, antenna mask, protocol and output mode in `pin_profile`. Refuse a bad value; never write with save=1.
5. Read the region and channel list on open, and show them.
6. Change the power range to 5–30.
7. Reword `said()`.

**Bench first (C5, `Reader.kt`), as Lab switches before any default changes:**
1. Phase or frequency-point start, to escape the −25 dBm window.
2. `setDynamicDistance` for power changes without the re-open.
3. Read out PWM, fast inventory and temperature.
4. Raw `setPower` with option byte 00.
5. Unregister `PowerOffReceiver` after open.
6. Region: read it out by name; write 0x3F only once the band is confirmed.

**Both:** an adaptive read window. Minimum about 250 ms, then stop after 150–200 ms with no new EPC, capped at the configured window.

---

## REA follow-up (22 Oct, MCP session)

REA 6.7.0 over MCP with its Ghidra 12.1.4 provider, one binary open at a time, nothing run. Targets are the stable copies in `~/tools/rea-targets/chainway/`, checked against `SHA256SUMS`. C5 addresses are Ghidra's (objdump + 0x100000).

- Every native answer cites its REA evidence (`ev_` + 8 hex digits).
- Java steps were read with `javap -c -p` (JDK 21) from `DeviceAPI_ver20251103.classes.jar` and have no REA ID.
- The vendor demo was read with REA's managed-metadata tools.

### C5 (`libDeviceAPIM.arm64.so`)

**1. Open time.**
- **Java path (R, javap).** `init(ctx)` → `init_R2000`:
  1. `sendBroadcastCloseUHF`: sleeps 2 s if the TCP service reads "1", then 200 ms after the `UHF_POWER_OFF` broadcast.
  2. `registerUhfPowerOffReceiver`.
  3. `UHFInit(deviceName)`.
  4. `UHFOpenAndConnect(uart)`. Not the `_Ex` variant.
- **Power-up (R).**
  - `UHF_Init` 0x17dc04, branch `"C5_6765"` / `"CW103_6765"`: writes `set 165 0111000100`, `set 21 0111000100` and `set 24 0111000100` to the MTK pinctrl sysfs node, then `usleep(200 ms)` (`ev_38b25590…`).
  - `mt_gpio_ioctl` only opens, writes and closes (`ev_07362f9c…`).
  - `UHF_Free` writes `0100000100` to the same three pins (`ev_c87f775a…`). So every `free()` powers the module off, and every open is a cold boot.
- **`UHF_OpenAndConnect` 0x17e91c (R, `ev_27a1e104…`):**

| Step | Wait | Purpose |
|---|---|---|
| Open 115200 (`O_NONBLOCK`) | – | |
| Sleep | 500 ms | boot wait after power-up (I) |
| `tcflush`, send `8C`, no reply read | – | stop, in case it was left reading |
| Sleep | 20 ms | lets the stop's reply land before the ping's flush (I) |
| Ping `00` → `01` | ≤1200 ms, polled every 5 ms | first ping |
| 500 ms, `8C`, 20 ms, ping | ≤1720 ms | only if the first ping failed |
| Close, reopen at 460800, `tcflush`, `8C`, 20 ms, ping | ≤1220 ms | baud fallback |
| 200 ms, `8C`, 20 ms, ping | ≤1420 ms | last try, then −1 |

- **Results.**
  - A success at 460800 leaves the port at 460800 (R).
  - **Minimum open:** 200 + 500 + 20 + ≥5 ms + one round trip ≈ **0.73 s** native, plus 200 ms in Java when given a context.
  - **Worst case:** about 6.1 s in `UHF_OpenAndConnect`, plus the 0.2 s power-up, before −1. After `setBaudRate(460800)`, every open loses the first two tries, 3.44 s; this matches the 3.4 s noted earlier.
- **Skippable: only the Java 200 ms and 2 s, through `init(null)`** (trade-off above).
  - The 200 ms after the GPIO writes and the 500 ms after opening are cold-boot waits that every `free()` → `init()` pays. They are compiled in.
  - Keeping the reader open across reads is the only way to avoid them.
- **Keep the 20 ms.** `External_SendAndRecv` (0x187be4) re-parses its buffer from the start, and `parsePack` (0x187a98) returns only the first complete frame (R, `ev_07362f9c…`, `ev_441f251b…`).
  - So a late frame at the head of the buffer hides the real reply until the 1200 ms timeout.
  - This holds for every getter, and for raw `UHFUnvarnishedTransmission` (I).

**2. The −25 dBm window.**
- **Start frames (R).** Java `startInventoryTag(InventoryParameter)` calls `UHFInventory_EX_cnt(a, b, 6)`. The JNI shim only moves registers (`ev_d44d3e9d…`). `UHF_Inventory_EX_cnt` 0x181c0c then sends `Um7_Send(0x82, [a][b])` (`ev_e19dc4d5…`).

| `ResultData` | Frame |
|---|---|
| none | `A5 5A 00 0A 82 00 00 88 0D 0A` |
| `setNeedPhase(true)` | `A5 5A 00 0A 82 FF FF 88 0D 0A` |
| `setNeedFrequencyPoint(true)` | `A5 5A 00 0A 82 FF FE 89 0D 0A` |
| both | `A5 5A 00 0A 82 FF FD 8A 0D 0A` |

  The R3 DLL holds the same four frames at 0x180029060–0x18002909F (`ev_913240ed…`). That cross-checks the bytes and checksums.
- **The start is send-only (R).** It creates the thread, waits 1 ms, writes the frame, waits 5 ms, and returns 0 if the write succeeded. No `83` acknowledgement is read.
- **Extra-bytes branch** 0x182c14–0x182c90 (R, `ev_286d3a2b…` assembly, `ev_50bb0f55…`):
  - **When:** the record is longer than EPC bytes + 5. The record is the payload of an `83`/`7F` frame: PC + EPC [+ extra] + RSSI (2) + antenna (1).
  - **Output:** `[L = PC+EPC length][PC+EPC][00][X][X extra bytes, raw][RSSI hi][RSSI lo][antenna]`, length = record + 3.
  - **No window.** The branch jumps straight to the success exit (0x18300c). The function's only RSSI compare is at 0x182fd4, in the no-extra branch.
  - **No decoding.** The native code does not decode phase or frequency.
- **Decoding is Java (R, javap):** `com.rscja.team.qcom.deviceapi.H.parseUHFTag`, called by the MTK `readTag()`.
  - **Trailer:** the last 3 bytes (frequency point) and 2 bytes (phase) of the X block. Which ones apply comes from the start's `ResultData` flags, not from the frame.
  - **Phase:** big-endian u16, raw (`setPhase(int)`). With both flags it sits just before the 3 frequency bytes.
  - **Frequency:** big-endian 24-bit kHz ÷ 1000 → `setFrequencyPoint(float MHz)`.
  - **Other bytes:** those before the trailer go to TID, USER or Reserved, by inventory mode.
  - **RSSI:** shown as `−(65535 − raw)/10`, which reads 0.1 dB weak, and as "N/A" outside 0–200. The tag is kept either way: Java has no window.
- **Still I:** whether FW E710_V7.10.1 appends the bytes. If it does not, X = 0 and the window applies as before.

**3. Reader thread `Uhf_GetR2000UartData` 0x18c5e0 (R, `ev_27c60a01…`).**
- **Busy spin: yes.** The loop is `do { if (R2000ThreadCloseFlag) return; n = read(fd) } while (n < 1)`, with no sleep.
  - The descriptor is opened `O_NONBLOCK` (`SerialPort_Open` flags 0x80902, `ev_07362f9c…`).
  - Nothing in the library imports `fcntl`, `poll`, `select`, `epoll`, `pthread_join` or `pthread_detach` (`ev_5898ec97…`).
- **Kept: `83` and `7F` frames with at least one data byte.**
  - The payload is stored and the command byte dropped.
  - So a `7F` payload reaches `UHF_GetReceived_EX` as if it were a tag record. What `7F` means is I.
- **`8D`: handled only with exactly one data byte (LEN 9).**
  - It sets `closeflag` = (byte ≠ 0) and logs `stop closeflag=1` or `stop fail`. The frame is not stored.
  - The flag is set before the checksum is checked.
- **Every other reply is dropped.** That is why getters fail during a sweep: this thread reads their bytes first.
- **Ring: 20,000 slots × 512 B** (`gBUF` 0x1e71f7, `ev_e141d205…`; `.bss` is 10,360,808 B, `ev_6b800ae3…`).
  - Indices, `okcnt` and `GetTagCount` reset whenever a thread starts. Records not yet read are lost at the next start.
  - **Overflow, writer side.** The writer wraps at 20,000 and counts `goverflow`. A second wrap before the reader wraps logs `goverflow` and zeroes the read index, so the ring looks empty and up to 20,000 records are lost.
  - **Overflow, reader side.** A reader that sees itself lapped resets everything and returns −1.
  - **Staging buffer.** `tempbuf` holds 513 B, but the parser accepts payloads up to 759 B (LEN high byte ≤ 2). A longer payload would overrun `gBUF_LenH` (`ev_38e970e9…`, `ev_907fd3e0…`). EPC records never come near that (I).
- **At stop (R, `ev_afc5013f…`).**
  - Once `closeflag` is set, `UHF_StopGet` lets the thread run 50 ms more.
  - It then sets the close flag, waits 5 ms and flushes input.
  - Tail records are kept, and the ring is not cleared.

**4. Region and frequency.**
- **Read-back (R, `ev_ecc1ca54…`; JNI `ev_4812a9d2…`; javap).**
  - `UHF_GetFrequency_Ex` 0x180708 sends `2E` and needs status 01.
  - It maps the code in data[1] to an SDK index: 02→0, 01→1, 04→2, 08→4, 16→5, 32→6, 80→7, 33→8, 34→9. Any other code comes back raw.
  - Java `getFrequencyMode()` maps the index back to the code.
  - **Net: the module's raw code.** Indonesia 0x3F reads 63 and HK 0x41 reads 65. The exceptions are raw 00/05/06/07/09, which read back as 02/16/32/80/34. That round trip, both ways, is the "0/5/6/7/9 aliased" in the knob table.
- **`UHF_Frequency_Hopping_Setting` 0x188798 (R, `ev_926cc782…` assembly).**
  - Sends `14 [01][kHz, 3 bytes BE]` and waits up to 1200 ms.
  - Returns 0 only on reply status 01 (0x1888ec–0x188904). Ghidra's pseudocode shows `void`.
  - Java `setFreHop(MHz)` sends `(int)(MHz × 1000f)`. That truncates: 920.1 becomes 920099 kHz. Compute kHz as an integer instead.
- **Multi-channel form (R, `ev_4812a9d2…`).**
  - The generic builder `UHFSetJumpFrequency_SendData` (0x134760) writes `A5 5A [LEN = 3N+9] 14 [N][F1]…[FN] XOR 0D 0A`, where each F is 3 BE bytes of kHz. Reply status 01 means OK.
  - **So the C5's fixed `01` is N = 1, and `setFreHop` replaces the hop table with one channel (I).** The R3 getter `16` supports this: it returns `[N][N × 3 bytes]` (`ev_42f90266…`).
  - To narrow to the legal channels, send the N-channel form raw, at rest.

**5. RF link (R, `ev_04a56241…`, `ev_648774e6…`, `ev_642789d9…`).**
- `UHF_Set_RFLink` 0x18cb4c sends `52 [00][01][mode]` and returns 0 only on reply status 01.
- `UHF_Get_RFLink` 0x18cbf8 sends `54 [00][00]` and returns data[2] when the status is 01.
- **There is no table anywhere.** The JNI wrapper is a tail call, and Java `setRFLink` only casts to `char`. Only the firmware can refuse a mode.

### R3 / R3S (`UHFAPI.dll`, x64)

**6. The tail of a read** (R, `ev_3cb41c1e…`, `ev_e46bbc20…`, `ev_505be324…` assembly, `ev_6677c77c…`, `ev_81c86702…`).
- **When the thread polls.** The receive thread polls `EB` (`A5 5A 00 08 EB E3 0D 0A`) only when all of these hold (0x180010d74–0x180010e41):
  - the running flag `[link+0xC]` ≠ 0;
  - the link is USB;
  - the stopping flag `[link+8]` = 0;
  - the link is not in raw mode.

  It polls more than 50 ms after a batch with tags, and more than 150 ms after one without.
- **No `EB` once the stop starts.**
  - The stop routine sets `[link+8] = 1` before its first `8C` (`A5 5A 00 08 8C 84 0D 0A`). It resends the stop every 100 ms for up to 500 ms.
  - An `EB` already in flight is still answered and parsed.
- **The `8D` turns polling off until the next start.** The handler (0x18001133c–0x18001133e) is `XOR ECX,ECX; MOV qword [RBX+8],RCX`, which clears `[link+8]` **and** `[link+0xC]`.
- **A stop with no `8D` within 500 ms restarts polling.**
  - The routine resets `[link+8] = 0` and returns 1.
  - `UHFStopGet` still returns 0 and never clears `[link+0xC]`.
  - So the thread resumes polling `EB` every ~150 ms in the background (R).
- **Tags that arrive after the `8D` are kept.** The parse path ignores both flags:
  - `EC` (replies to `EB`) and `E1` (pushed batches) go to the tag queue;
  - `83`/`7F` single-tag frames with more than 3 data bytes go to the tag queue.

  They stay until the next `UHFInventory` or `UsbOpen` clears the queue (`ev_5221635b…`).
- **What is lost** is whatever the reader still holds when polling stops, up to about 150 ms of reads, unless the firmware pushes it (I).
  - A raw `EB` sent through `SendBytes` after the `8D` would be answered with `EC` and parsed into the queue.
  - The parse is R. Whether the reader still answers `EB` after a stop is I.
- **At `UsbOpen`** the receive thread sleeps 500 ms before reading anything (0x180010cc7).
- **After 5 s with nothing received**, it writes a lone `00` byte to the reader (R).

**7. `UHFGetReaderVersion`, command `C8` (R, `ev_48199631…`, `ev_6eaf900d…` assembly).**
- **The exact string it builds.**
  - It sends `C8` with no data, waits up to 1500 ms, and needs at least 3 data bytes.
  - `out[1..]` = `"V%d.%d.%d"` of data[0..2].
  - Then, for each TLV from data[3]: skip the tag byte, read the length byte, and append `,` plus the raw value bytes.
  - `out[0]` = total length. **No NUL follows the TLVs.**
  - Returns 0 or −1.
- **`rfid.rs` matches it.** `firmware()` reads exactly this layout: the length byte first, NULs trimmed only at the ends.
- **What the vendor demo does with it.** It wraps this call as `GetSTM32Version` and shows it as "Mainboard version", next to the hardware, software and API versions. It never looks for a model name in it. Its device-type and device-ID buttons use other calls (`GetURDeviceType`, `UHFGetDeviceIdEx`). (R, REA managed metadata: `ev_8faaab11…`, `ev_e8aa5f9a…`.)
- **Prediction for an R3S:** the same `V<a>.<b>.<c>`, followed by whatever TLVs its mainboard firmware sends.
  - Nothing in the DLL or the demo guarantees that any part equals "R3" or "R3S" (I).
  - If the firmware sends only version or date fields, `names_a_desk_reader` refuses both models.
  - It also refuses a value with a suffix or NUL padding (`R3S-PoE`, `R3\0\0`), because the per-part `trim()` strips only whitespace.

**8. USB matching (R, `ev_196bf4cc…`, `ev_f2a47aeb…` assembly).**
- **Accepted:** only **VID 0x2047, PID 0x0301** (0x1800221e4–0x1800221fa).
- **Interface:** the active configuration needs an alternate setting with **`bInterfaceClass` 3 (HID) and exactly 2 endpoints** (0x1800222a1–0x1800222ab).
  - Endpoints are chosen by the direction bit.
  - Every HID interface with 2 endpoints in configuration 0 is claimed.
- **Nothing else is checked:** no other VID, PID, class or product string. A device whose bus and address are already open on another link is skipped.
- **An R3S with another PID is refused, and the refusal is not reported.**
  - `UsbOpen` is an alias of `HF_Open` (0x1800129b0, `ev_dd1eb444…`, `ev_123e9384…`). It returns the link setup's result (`ev_6989fd43…`).
  - The matcher's result starts at 0, and only a matched device changes it. So **with no matching device, `UsbOpen` returns 0** (`ev_d95926b6…`).
  - The DLL then makes current a link with a NULL libusb handle. Sends report success without sending anything.
  - About 500 ms later the receive thread finds no USB queue and closes the link. Every command then times out after 1.5 s.
  - So `rfid.rs`'s "not connected" message (code ≠ 0) never fires. The first failure the user sees is `mute()`'s "buzzer could not be confirmed off".
  - The same happens on a second `UsbOpen` while the first link is still open.
  - `UsbReadDeviceInfo` is a stub: it writes "usb information" and returns 15 (`ev_6f8b4a70…`). It cannot confirm a device.

**9. Exact semantics (R, `ev_5221635b…`, `ev_6677c77c…`, `ev_7015bbd6…`).**
- **`SendBytes(buf, len)`** (0x180012b60) is a tail call to the raw send on the current link.
  - It adds no framing and no checksum. USB goes out in 64-byte bulk transfers, zero-padded.
  - It returns `len` on success, 0 on a write error (which also runs the disconnect path), and −2 for an unknown link type.
  - A **1-byte** send is dropped, returning 0, if anything was sent in the last 3 s.
  - It does not check that a link exists. With a NULL USB handle it returns `len` without sending.
- **`RecvBytes(buf, max)`** (0x180012b80) copies, without blocking, from the current link's 8 KB **reply ring**. That ring is not raw USB.
  - It returns the number of bytes copied, or 0 when the ring is empty.
  - The ring holds whole frames of every reply except `E1`, `83`/`7F` tag frames and `8D`. `EC` frames are included.
  - Every DLL command (transceive 0x18000ca80) zeroes the ring and both indices before sending, so `RecvBytes` competes with the DLL.
  - **An `8D` never shows up through it.**
- **`setOnEventStopInventory(cb)`** (0x180012750) stores one **global** callback, not one per link.
  - It runs **on the DLL's receive thread**, synchronously, as `cb(link id)`.
  - It runs for **every** complete `8D`, whoever caused it: `UHFStopGet`, the stop `UHFInventory` sends when a sweep is still running, a raw stop sent through `SendBytes`, or the firmware.
  - It runs before the thread clears `[link+8]`/`[link+0xC]`, and it does not receive the `8D` status byte.
  - With no `8D`, it is never called.
  - **The callback must only signal.** A DLL getter called inside it would wait 1.5 s for a reply that only this same thread can deliver.
- **`SetDisconnectCallback(cb)`** (0x180012b30) must be called after open. It returns −1 when the current link is not open.
  - It is stored per link and fires **once**: on a read error, a send error, or the USB reader thread ending (an unplug), while the link is open.
  - The DLL then marks the link closed, calls `cb(link id)` and forgets the callback.
  - It runs on the thread that hit the error: usually the receive thread, or the caller's thread for a send error.

**10. Getter replies (R, `ev_50bc11e4…`, `ev_42f90266…`).**
- Every getter goes through the transceive, which times out at 1500 ms.
- The transceive checks only the **first** frame of each chunk that arrives. So an `EC` arriving mid-sweep can hide a getter's reply; read the profile at rest.
- Every failure returns −1. The transceive's internal −3/−4 never reach the caller.

| Getter | Sends | Checks | Fills | Success |
|---|---|---|---|---|
| `UHFGetFastInventory(u8*)` | `66 00 00` | data[0] = 01 | data[1] | 0 |
| `UHFGetANT(u8[2])` | `2A` | **none** | data[0..1] | 0 |
| `UHFGetProtocolType(u8*)` | `06 01` | exactly 2 bytes, data[0] = 01 | data[1] | 0 |
| `UHFGetEPCTIDUSERMode(a, b, u8[3])` | `72 a b` | ≥4 bytes, data[0] = 01 | data[1..3] | **3** |
| `UHFGetWorkTime(u8[4])` | `3E` | ≥5 bytes, data[0] = 01 | data[1..4] | **4** |
| `UHFGetWorkMode(u8*)` | `A1 06` | data[0] = **06** (echo) | data[1] | 0 |
| `UHFGetDualSingelMode(u8*)` | `6C` | data[0] = 01 | data[1] | 0 |
| `GetURTagFilter(u8*, u32*)` | `A1 14` | data[0] = **14** (echo) | data[1]; BE u32 from data[2..5], no length check | 0 |
| `UHFGetRegion(u8*)` | `2E` | data[0] = 01 | data[1] | 0 |
| `UHFGetJumpFrequency(u32*)` | `16` | **none** | N = data[0], then N × 3-byte BE kHz | 0 |

### What this changes in the planned fixes

**R3 (`rfid.rs`):**
1. **Raw stop on open: still right.** `SendBytes` sends the 8-byte frame as it is.
   - Its `8D` is handled about 500 ms later, and only the stop event can see it.
   - **`UsbOpen` returning 0 does not prove a reader is there.** Treat the first failing command as "not connected", or register `SetDisconnectCallback` right after open.
   - Never call `UsbOpen` twice without `UsbClose`.
2. **Stop event: usable, with limits.**
   - It is global, it fires for every `8D` (including the one at the start of `UHFInventory`), and it carries no status.
   - If none comes within about 600 ms, the DLL starts polling `EB` again. Then send a raw stop, or close the link.
3. **Drain until quiet: confirmed worthwhile.** Frames that arrive after the `8D` are still queued. A raw `EB` sent once the stop event has fired may pull what the reader still holds (bench).
4. **Profile read-backs.**
   - Treat 3 (`EPCTIDUSERMode`) and 4 (`WorkTime`) as success.
   - Parse the `UHFGetANT` and `UHFGetJumpFrequency` replies raw: they have no status byte.
   - Read them at rest.
5. **Version gate: it may refuse a genuine reader.** Record the raw `C8` bytes first. Consider gating on the DLL's VID/PID instead, which is already exact.

**C5 Lab switches (`Reader.kt`):**
1. **Phase or frequency-point start.** The frames and the window-free branch are confirmed. Whether the firmware appends the bytes is still the open bench question.
2. **Region by name.** Safe for codes 10 and above.
3. **Channel list.** `setFreHop` sets a one-channel table; it does not add a channel. Build the N-channel `14` frame raw.
4. **PWM, fast-inventory and temperature reads: at rest only.** During a sweep the reader thread swallows their replies.
5. **Open cost.** About 0.73 s native per cold open, all compiled in. Avoid `free()`/`init()` cycles.
6. **Read every tag before the next start.** The start clears the ring.

## Bench questions

**C5:**
1. Does FW E710_V7.10.1 append phase or frequency-point bytes? Look for records longer than EPC + 5 bytes, or a non-zero `getPhase()`. The start frames are in REA follow-up §2.
2. How many frames are dropped with a tag on the antenna at 30 dBm, in EPC mode against phase mode?
3. Does `setDynamicDistance` change the radiated power mid-sweep, and does it survive a re-open?
4. Does raw `10 00 01 …` radiate without a re-open, and does it survive a power cycle?
5. What are the current region, the channel list per region code, and the PWM, fast-inventory and LBT values? Read them at rest: during a sweep the reader thread drops getter replies.
6. Does an idle module answer a raw `8C` (a bounded stop of 1.2 s instead of 2.6 s)?
7. After `setFreHop(f)`, does a raw `16` report a single channel, and does the module stop hopping?
8. Do `7F` frames arrive during a sweep, and does each one surface as a bogus tag?

**R3 / R3S:**
1. Does a reader left inventorying answer anything but stop?
2. Which settings survive a power cycle with save=0?
3. What are the exact `C8` reply bytes (hex) and VID/PID of each R3 and R3S variant? Does any TLV name the model? The DLL opens only 0x2047/0x0301.
4. Are tags lost at stop? Drain the queue after the stop event, with and without one raw `EB` (`A5 5A 00 08 EB E3 0D 0A`), and compare.
5. What are the shipped values of FastInventory, wait time, dual/single, the antenna mask and the user params?
6. How long does a full pile take at RF link 1 against 5?
7. With no reader plugged in, does `UsbOpen` return 0, and how long until the disconnect callback fires?
8. Does every stop raise the stop event within 500 ms, and what does the DLL do after a stop that does not?
