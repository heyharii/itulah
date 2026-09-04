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
