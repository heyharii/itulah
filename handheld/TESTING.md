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
`operator_token`, `session_code`. The device must exist in the Edge's
`edge_rfid_device` with `auth_key_sha256 = sha256(device_key)` and a row in
`edge_rfid_device_pool`, or every batch is refused.

## Drive the UI

`uiautomator dump` reports a narrower width than the panel (2016 vs 2160 on the
C5), so taps computed from it miss. Take a screenshot and read coordinates from
the image, or scale. Buttons move as content grows — re-dump before each tap.

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
