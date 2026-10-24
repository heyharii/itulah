# A C5 joins its store the way a POS does

24 Oct 2026. Owner: "termasuk nanti pendaftaran C5 device di store" — the store
sets nothing up; head office approves every device. Not built yet.

## Today

1. An Admin registers the handheld in Central (`POST /api/v1/auth/rfid-devices`).
   The answer carries `device_key` once.
2. Somebody at the store types URL, Site ID, Pool, Device ID and that key into
   the C5's Setelan (`handheld/README.md`).
3. The key reaches the store server through head office's auth policy
   (`edge_rfid_device`); the C5 signs every batch with HMAC keyed by
   `sha256(device_key)`.

Five fields typed by hand on a handheld, one of them a secret head office had
to send to the store somehow.

## Proposed: the POS's join, for a handheld

| Step | POS today (built 24 Oct) | C5 |
|---|---|---|
| Find the server | mDNS `_itulah-store._tcp` or typed address | same (Android NSD) |
| Ask | `POST /api/v1/devices/join {key_sha256, kind: TILL}` | same, `kind: HANDHELD` |
| Wait | code + 6 digits on screen | same |
| Head office sees it | heartbeat `joins_waiting` → Stores › store › POS | same list, Devices tab, kind shown |
| Approve | `device.join.decide.v1` → node writes `edge_terminal` | cloud first registers the handheld (`rfid_device` with the C5's `key_sha256`, kind HANDHELD, the store's floor pool), publishes the policy, then the same command marks the join approved with that device id |
| Learn it | `join/status` → `{terminal_id, label, site_id}` | same, plus `pool`; the C5 fills Setelan itself |

The C5 never shows or types a key: it minted it, and only its digest leaves
the device — exactly as a POS does.

## Work

- Edge: `begin_join` accepts `HANDHELD`; `WaitingJoin` gains `kind`;
  `apply_join_decision` for a handheld records the device id it was given and
  approves without an `edge_terminal` row (the credential arrives in the
  policy). `join_status` answers the pool.
- Cloud: `decide_pos_join` → `decide_device_join`; for a handheld, register
  `rfid_device` (key digest, kind, site, pool) and publish the policy in the
  same transaction as the command. No seat check for handhelds (or a separate
  handheld count per store, if the owner wants one).
- Hub: the Devices tab gets "New device asking to join" (same card as POS).
- Handheld app (Kotlin): a Gabung screen in place of the typed Setelan fields
  (NSD browse, mint key, show code, poll, save).
- Test: on the C5 over adb (`adb connect 192.168.1.198:<port>`), against a
  store server on the same LAN.

## Open

- Should a handheld also need a "seat" (a count per store set by head office)?
- Replacing a lost C5: approve the new one "in place of" the old, like a POS.
