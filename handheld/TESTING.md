# Testing on a Chainway handheld

`adb` lives at `/opt/homebrew/share/android-commandlinetools/platform-tools/adb`
and is not on `PATH`. Gradle needs `JAVA_HOME=/opt/homebrew/opt/openjdk@21`.

## Connect

Wireless debugging drops whenever the device sleeps. Pairing survives; the
connect port does not.

```
adb pair 192.168.1.x:PAIRPORT 123456     # only if pairing was lost
adb mdns services                        # usually auto-connects from here
adb connect 192.168.1.x:CONNECTPORT      # the port on the Wireless debugging
                                         # screen — NOT the pairing port
```

**Unlock before anything else.** On the lock screen the activity resumes and
immediately pauses, screenshots come back black, and `uiautomator dump` returns
nothing — it looks exactly like a crash:

```
adb shell wm dismiss-keyguard
adb shell svc power stayon true
```

## Configure

`run-as` works on **debug builds only**. Push a prefs file rather than typing
into the UI — field focus does not advance, so typed values land in one box:

```
adb push prefs.xml /data/local/tmp/p.xml
adb shell "run-as id.itulah.pindai mkdir -p shared_prefs && \
  run-as id.itulah.pindai cp /data/local/tmp/p.xml shared_prefs/itulah-pindai.xml"
```

Keys: `base_url`, `site_id`, `pool`, `device_id`, `device_key`,
`operator_token`, `session_code`, and `reader_power` — the last one an `<int>`,
not a `<string>`, or `load()` throws `ClassCastException` on the first read. The device must exist in the Edge's
`edge_rfid_device` with `auth_key_sha256 = sha256(device_key)` and a row in
`edge_rfid_device_pool`, or every batch is refused.

## Drive the UI

`uiautomator dump` reports 2016 where the C5 panel is 2160. It is **cropped,
not scaled**: the dump covers the app area and leaves out the 144 px navigation
bar below it, so dump coordinates are 1:1 with `input tap` and need no
correction. "Correcting" them by 2160/2016 pushes every tap down by up to 100 px
— enough to fall clean off a 56 dp control and look exactly like a tap that was
ignored.

Buttons move as content grows, so re-dump before each tap, and note that
`uiautomator dump` itself takes a second or more: a state that lasts three
seconds can be missed entirely by a dump started one second in.

## Measure

### Repeatable frame capture

Use a non-debuggable release build for comparisons. The release manifest allows
shell profiling; it does not enable debug mode. Preserve the pre-change APK
before rebuilding, and install with `adb install -r` to preserve app settings.
Do not uninstall or replace configuration to run a benchmark. Installation
restarts the app, so finish/preserve any active scan first.

`tools/frame_metrics.py` refuses debug builds and captures normal completed
frames from Android's rolling frame buffer. It does not start a scan, touch the
UI, or send observations. The operator performs the named scenario while it
records. For example, from the repository root:

```sh
python3 handheld/tools/frame_metrics.py --label release-scroll-scan-duplicates \
  --seconds 30 --output /tmp/handheld-perf/release-scroll-scan-duplicates-01
```

Use `--serial` if multiple devices are connected. Every output directory must be
new. The helper saves frame CSV, summary JSON, Android's own jank counters, and
before/after CPU, thermal, and memory reports, without exporting credentials or
unrestricted logcat. Capture adds some overhead; keep the same method for both
builds, and confirm borderline results with a system trace.

The metric is **IntendedVsync to FrameCompleted**, including scheduling delay;
it is not just CPU drawing time. p95 <= 10 ms is an aspirational target, not a
claim that this C5 already achieves it. Check p99, worst frame, percent <= 10 ms,
and Android missed-frame counters too. The rolling buffer can lose frames if
ADB stalls, and flagged/incomplete frames are excluded: compare captured count
with Android's total. A passing percentile with poor capture coverage is not a
passing test. For definitive deadline analysis, use a system/FrameTimeline
trace if supported by the device, not just this summary.

Repeat each case at least three times with the same tag set, RF power, network,
warm-up, and scroll actions: reader off; empty scan; duplicate tags; new tags
while scrolling; shared session; slow/offline network. Record unique tags and
time to discover them separately. Test only against an appropriate test session
because configured scanning auto-files real observations. Follow with 30–60
minutes of scanning to check sustained load, memory growth, and thermal effects.
Do not accept smoother frames at the cost of missed tags.

Run capture-parser checks with:

```sh
python3 -m unittest discover -s handheld/tools -p 'test_*.py'
```

**Never judge speed on a debug build.** Compose debug is roughly twice as slow;
the same screen measured 31 ms in debug and 22 ms in release.

```
adb shell dumpsys gfxinfo id.itulah.pindai reset
# scroll a few times
adb shell dumpsys gfxinfo id.itulah.pindai | grep -E "Janky|50th|90th"
```

Baselines on the C5 (MT6765, 60 Hz panel): Android's own Settings app renders
at 27 ms p50. Our release product list sits at 27 ms / 28% janky. Debug is 42 ms.

Measured again at **5 006 tags / 255 products**: still 27 ms p50 and 27% janky in
release. The list does not care how many tags are behind it, because a row is a
product. What used to care was `publish()` — 90 ms per call on the main thread
every 200 ms, 68% janky, 42 ms median frame — from sorting five thousand tags
and regrouping them from scratch five times a second. It now costs ~5 ms and is
flat in tag count.

**`uiautomator dump` fails while this app animates** — `ERROR: could not get idle
state` — and then `cat` hands you the PREVIOUS dump, silently. Delete the file
first (`rm -f /sdcard/u.xml`) or check the command's own output, or you will read
the last screen and believe it. Prefer `screencap` and logcat for anything
measured.

## Things that will waste your afternoon

- **The reader is exclusive.** `startInventoryTag` fails with a bare "gagal" if
  another app still holds it. `am force-stop` the other one first.
- **Two apps, one port.** Another session may already be serving `:8081`; bind
  a local Edge somewhere else and check `pgrep -fl "target/debug/dc"`.
- **`r2.dev` is blocked by Indonesian ISPs** — product photographs fail on shop
  wifi and succeed on the Mac. Images are proxied through the Edge for this
  reason; if tiles are blank, check the node, not the app.
- **30 dBm eats the battery.** Plug in before a long session.
- Writing tags: `setFilter()` is silently ignored on the E710. See the reader
  notes in `README.md` before touching that path.

## The imager, and who owns the trigger

Two things here are **not proven on hardware**. Both are written down as
questions rather than answers, because the vendor's own sample states them and
then declines to demonstrate them.

### Scan sound and vibration — vendor-sanctioned, untested

`Barcode.init()` now calls the three settings Chainway's 2D sample puts beside
`barcodeDecoder.open()`:

```java
BarcodeUtility.getInstance().enablePlaySuccessSound(ctx, true);
BarcodeUtility.getInstance().enablePlayFailureSound(ctx, true);
BarcodeUtility.getInstance().enableVibrate(ctx, true);
```

In `barcode-2d-demo/.../MainActivity.java` those three lines sit inside a
`/*TODO ... */` block — **commented out**. So the vendor shows the wiring on
exactly our `BarcodeDecoder` + `setDecodeCallback` path and never runs it. It is
possible the system scanner service only sounds for scans IT performed, in
which case these do nothing and the fallback is `res/raw/scan_beep.wav`, which
is in the tree for that reason.

Two properties worth holding in mind:

- **They are DEVICE settings, not app settings.** Broadcasts to the system
  scanner service; they outlive this process and change every other app on the
  handheld. `Barcode.close()` puts them back.
- **There is no getter.** `BarcodeUtility` exposes no way to read the current
  value, so `close()` restores to *off*, not to whatever was there before. A
  handheld that arrived with the beep already on loses it.

### The trigger does nothing in Labels mode

Reported from the floor: in Labels mode the physical gun trigger does nothing at
all, while the same key drives an RFID sweep normally. So the keycode exists;
the question is who gets it.

The one thing that differs between the two modes is whether `BarcodeDecoder` is
open — `setLabelMode(true)` opens it, RFID mode closes it. That points at the
**keyboard helper**, the system component that owns the scan key on these
handhelds. `IBarcodeUtility` documents its master switch:

```
openKeyboardHelper(Context)    打开键盘助手功能总开关
closeKeyboardHelper(Context)   关闭键盘助手功能总开关
setOutputMode(Context, mode)   0:to cursor 1:clipboard 2:broadcast 3:analog keyboard
```

It is also why Chainway's own 2D sample scans from an **on-screen button**
(`btnScan.setOnClickListener(v -> start())`) and never touches `onKeyDown` or
`dispatchKeyEvent`: with the module open, the trigger is not the app's to read.

**Do not "fix" this by calling `closeKeyboardHelper` on a hunch.** It is another
device-wide switch with no getter, and the cause is not established yet.

#### Separating the two causes, without guessing

The screen could not tell them apart before, because the note under "Trigger
reads labels" is only written on refusal — a scan that starts cleanly and
decodes nothing is silent by design. `Barcode` now counts the ask separately
from the outcome:

| `Barcode.requested` on a pull | Reading |
|---|---|
| does **not** move | the key never reached the app — the keyboard helper has it |
| moves, outcome `started — waiting for a decode` | imager is fine; the label is not being read |
| moves, outcome `startScan() refused` | the module is open but will not scan |

`Barcode.diagnostics()` returns that as one line. Surface it under the label
card before testing, or the pull is unobservable again.

If it turns out to be the keyboard helper, the vendor-shaped answer is probably
not to fight it for the key but to let it scan and take the result:
`setOutputMode(ctx, 2)` plus `setScanResultBroadcast(ctx, action, extra)`. That
also makes the sound question moot, because the service performing the scan is
the thing that beeps.
