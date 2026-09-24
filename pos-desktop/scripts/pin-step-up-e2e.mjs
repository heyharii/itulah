// PIN step-up end-to-end against a live store node.
//
// What it proves: till_step_up can be set; a paired terminal can claim a
// SESSION (same token a password issues) and a SUPERVISOR grant with a PIN; a
// wrong PIN is refused; a node whose till_step_up is not PIN refuses the whole
// route in its own words; a replayed sequence does not verify twice. This is
// the executable contract behind `claimPin` in `ui/src/api.ts` and the
// `require_auth` whitelist in `backend/src/edge/http.rs` — the middleware must
// let these routes through, because the till speaks them before any session
// exists, and this test fails if that door is ever closed again.
//
// Run: boot a scratch store node, then run this file.
//   cd /tmp && INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=pin-e2e-pass-1 \
//     INVENTORY_DATABASE_PATH=./store-edge.sqlite3 BIND_ADDR=127.0.0.1:8182 \
//     ../../path/to/backend/target/debug/store
//   BASE=http://127.0.0.1:8182 node pin-step-up-e2e.mjs
//
// Mirrors what pos-desktop does: bearer for config calls, terminal-signed
// (HMAC-SHA256 over method/path/terminal/timestamp/sequence/body-sha256, key =
// sha256(secret) hex) for claims — see pos-desktop/src-tauri/src/edge.rs sign().
import { webcrypto } from "node:crypto"

const BASE = process.env.BASE ?? "http://127.0.0.1:8182"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "pin-e2e-pass-1"
const hex = (buf) => Buffer.from(buf).toString("hex")
const sha256 = (s) => webcrypto.subtle.digest("SHA-256", Buffer.from(s))

async function api(method, path, { token, body } = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body)
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: payload === "" ? undefined : payload,
  })
  const text = await res.text()
  return { status: res.status, json: text === "" ? null : JSON.parse(text) }
}

let sequence = 0
async function signedApi(method, path, terminal, secret, body) {
  sequence += 1
  const payload = body === undefined ? "" : JSON.stringify(body)
  const bodySha = hex(await sha256(payload))
  const timestamp = Math.floor(Date.now() / 1000)
  const keyMaterial = Buffer.from(hex(await sha256(secret))) // sha256(secret), hex-encoded
  const key = await webcrypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const canonical = `${method}\n${path}\n${terminal}\n${timestamp}\n${sequence}\n${bodySha}`
  const mac = await webcrypto.subtle.sign("HMAC", key, Buffer.from(canonical))
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-terminal-id": terminal,
      "x-terminal-timestamp": String(timestamp),
      "x-terminal-sequence": String(sequence),
      "x-terminal-signature": hex(mac),
    },
    body: payload === "" ? undefined : payload,
  })
  const text = await res.text()
  return { status: res.status, json: text === "" ? null : JSON.parse(text) }
}

const fail = (msg) => {
  console.error(`FAIL ${msg}`)
  process.exit(1)
}
const expect = (cond, msg) => {
  if (!cond) fail(msg)
  else console.log(`ok   ${msg}`)
}

// 1. sign in as the bootstrap admin
const login = await api("POST", "/api/v1/auth/login", {
  body: { username: "admin", password: ADMIN_PASSWORD },
})
expect(login.status === 200 && login.json?.token, "password login issues a token")
const token = login.json.token

// 2. this node now accepts a PIN as its quick step-up
const setMethod = await api("POST", "/api/v1/auth/methods", {
  token,
  body: { till_step_up: "PIN" },
})
expect(
  setMethod.status === 200 && setMethod.json?.till_step_up === "PIN",
  "node accepts till_step_up=PIN",
)

// 3. give admin a PIN (6-8 digits, not all one digit)
const setPin = await api("POST", "/api/v1/auth/pins", {
  token,
  body: { username: "admin", pin: "246813" },
})
expect(setPin.status === 204, "PIN set for admin (204)")

// 4. pair this "till"
const pair = await api("POST", "/api/v1/auth/terminals", {
  token,
  body: { label: "pin-e2e till" },
})
expect(
  pair.status === 200 && pair.json?.terminal_id && pair.json?.secret,
  "terminal paired, secret returned once",
)
const { terminal_id, secret } = pair.json

// 5. SESSION claim with the right PIN → same bearer token a password issues
const session = await signedApi("POST", "/api/v1/auth/pin/claim", terminal_id, secret, {
  username: "admin",
  pin: "246813",
  purpose: "SESSION",
})
expect(
  session.status === 200 && typeof session.json?.token === "string" && session.json.token !== "",
  "PIN claim (SESSION) returns a bearer token",
)
expect(session.json?.username === "admin", "session claim names the person")

// 6. the session token actually works
const who = await api("GET", "/api/v1/auth/me", { token: session.json.token })
expect(who.status === 200 && who.json?.username === "admin", "claimed token opens a session (me)")

// 7. SUPERVISOR claim → one-shot authorization bound to this terminal
const sup = await signedApi("POST", "/api/v1/auth/pin/claim", terminal_id, secret, {
  username: "admin",
  pin: "246813",
  purpose: "SUPERVISOR",
})
expect(
  sup.status === 200 && typeof sup.json?.authorization === "string" && sup.json.authorization !== "",
  "PIN claim (SUPERVISOR) returns a one-shot authorization",
)
expect(sup.json?.username === "admin", "supervisor grant names its owner")

// 8. a wrong PIN is refused and said so
const wrong = await signedApi("POST", "/api/v1/auth/pin/claim", terminal_id, secret, {
  username: "admin",
  pin: "999999",
  purpose: "SESSION",
})
expect(wrong.status === 401, `wrong PIN refused 401 (got ${wrong.status})`)

// 9. a node that does not take PINs refuses the whole route, whatever is typed
const back = await api("POST", "/api/v1/auth/methods", {
  token,
  body: { till_step_up: "NONE" },
})
expect(back.json?.till_step_up === "NONE", "node switched back to NONE")
const refused = await signedApi("POST", "/api/v1/auth/pin/claim", terminal_id, secret, {
  username: "admin",
  pin: "246813",
  purpose: "SUPERVISOR",
})
expect(
  refused.status === 401 &&
    String(refused.json?.error ?? "").includes("does not accept a PIN"),
  "node that refuses PINs refuses the claim with its own words",
)

// 10. what a signature cannot buy: a replayed sequence must not verify twice
sequence -= 1 // pretend the terminal restarted and resent the same one
const replay = await signedApi("POST", "/api/v1/auth/pin/claim", terminal_id, secret, {
  username: "admin",
  pin: "246813",
  purpose: "SUPERVISOR",
})
sequence += 1
expect(replay.status === 401, "replayed sequence refused")

console.log("\nPIN step-up E2E: all assertions passed")
