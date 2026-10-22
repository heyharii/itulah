/// The shop node, as this window is allowed to see it.
///
/// Every call goes out through the shell, never straight from the page: the
/// WebView is a different origin to the node and the edge sends no CORS
/// headers — see `src-tauri/src/edge.rs` for why that is right and stays that
/// way. So there is no `fetch` in this app, and this file is the only place
/// that knows the shell exists.
///
/// # Why it also runs in an ordinary browser
///
/// The web edition (`edition.ts`) is served from the node's own origin, so an
/// ordinary call goes straight there through `web.ts` — a real answer from the
/// real node. The desktop edition opened in a browser tab while it is being
/// designed has no shell and no node, and says so rather than fake an answer.
/// What only the shell can do (the pairing secret, the devices, a second
/// window) refuses in either, in words that say why.

export type EdgeReply<T = unknown> = {
  readonly ok: boolean
  readonly status: number
  readonly body: T
  readonly problem: string | null
  /// The node's new address, when the shell found it there after the old one
  /// stopped answering (`src-tauri/src/edge.rs`). Present only then.
  readonly moved_to?: string
}

/// Said on the window when the shell has followed its node to a new address.
/// `session.ts` listens and re-reads the settings; nobody is signed out,
/// because it is the same node.
export const NODE_MOVED = "itulah:node-moved"

function heard<T>(reply: EdgeReply<T>): EdgeReply<T> {
  if (typeof reply.moved_to === "string") {
    window.dispatchEvent(new CustomEvent(NODE_MOVED, { detail: reply.moved_to }))
  }
  return reply
}

import { isWeb } from "@/edition"
import { webEdge } from "@/web"

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/// Tauri injects this on the window. Read lazily rather than at module load:
/// in dev the page can be up before the shell has finished wiring the bridge.
function bridge(): Invoke | null {
  const host = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: Invoke }
  }
  return host.__TAURI_INTERNALS__?.invoke ?? null
}

export const inShell = () => bridge() !== null

const noShell = (what: string): EdgeReply<never> => ({
  ok: false,
  status: 0,
  body: undefined as never,
  problem:
    isWeb
      ? `This is the web till, so ${what} is not available — ` +
        `it only works in the till app on the counter machine.`
      : `This window was opened in an ordinary browser, not in the till app, ` +
        `so ${what} cannot be reached. Run it with “npm run tauri dev”, ` +
        `or use the web version: “npm run dev:web”.`,
})

/// Ask the node for something. `path` is a path — the shell decides which
/// machine that is, and a window that could name a host is a window that could
/// send the day's takings somewhere else.
export async function edge<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<EdgeReply<T>> {
  const invoke = bridge()
  if (invoke === null) {
    return isWeb ? webEdge<T>(method, path, body) : noShell("node toko")
  }
  return heard(await invoke<EdgeReply<T>>("edge_call", { method, path, body }))
}

/// Call the node **as this terminal**, not as the person signed into it.
///
/// Two calls need this and no others — asking for the fingerprint roster, and
/// saying whose finger matched — and both happen when nobody is signed in yet,
/// which is exactly why a bearer token cannot be what carries them. The shell
/// holds the pairing secret and does the signing; this side never sees it.
export async function signedEdge<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<EdgeReply<T>> {
  const invoke = bridge()
  if (invoke === null) {
    // The pairing secret lives only in the shell. A browser tab has none to
    // sign with, so fingerprint and PIN sign-in are not offered here.
    return noShell("fingerprint and PIN sign-in")
  }
  return heard(
    await invoke<EdgeReply<T>>("edge_signed_call", { method, path, body }),
  )
}

export type DeviceState = { readonly bound: boolean; readonly detail: string }

/// Who the finger on the scanner belongs to.
///
/// `bound` and `actor_id` answer two different questions and must not be
/// collapsed: a scanner that is not attached and a finger that is not enrolled
/// look identical to a cashier standing at the counter, and only one of them is
/// fixed by pressing again.
export type Identified = {
  readonly bound: boolean
  readonly actor_id: string | null
  readonly score: number | null
  readonly detail: string
}

/// Match the finger on the scanner against the fingers the node has enrolled.
///
/// The templates are passed in rather than fetched by the shell: which fingers
/// may open this till is the node's decision, and matching happens here so a
/// counter can still be opened when the line to head office is down.
export async function identifyFinger(
  enrolled: readonly { actor_id: string; template_base64: string }[],
): Promise<Identified> {
  const invoke = bridge()
  if (invoke === null) {
    return {
      bound: false,
      actor_id: null,
      score: null,
      detail: "The fingerprint scanner can only be reached from the till app.",
    }
  }
  return invoke<Identified>("fingerprint_identify", { enrolled })
}

/// Open the screen that faces the shopper.
///
/// A second window showing the same basket from the other side of the glass.
/// Outside the shell there is no second window to open, and saying so is better
/// than a button that quietly does nothing.
export async function openCustomerDisplay(): Promise<string | null> {
  const invoke = bridge()
  if (invoke === null) {
    return "The customer display can only be opened from the till app."
  }
  try {
    await invoke<null>("open_customer_display")
    return null
  } catch (error) {
    return String(error)
  }
}

/// What the counter's own hardware can do today. Never assumed: a till that
/// believes in a reader it does not have is a till that silently drops tags.
export async function device(
  which: "rfid_state" | "fingerprint_state" | "open_drawer",
): Promise<DeviceState> {
  const invoke = bridge()
  if (invoke === null) {
    return {
      bound: false,
      detail: "The device can only be reached from the till app.",
    }
  }
  return invoke<DeviceState>(which)
}

/// One tag the R3's pad heard — `PadTag` in `src-tauri/src/rfid.rs`.
export type PadTag = {
  /// Upper-case hex, without the PC word.
  readonly epc: string
  /// The strongest it was heard at, in dBm.
  readonly rssi_dbm: number
  readonly reads: number
}

/// One read of the R3's pad — `PadRead` in `src-tauri/src/rfid.rs`.
export type PadRead = {
  /// Each EPC once, strongest first.
  readonly tags: readonly PadTag[]
  /// Tags heard only below this till's signal floor, left out.
  readonly too_weak: number
  /// Records the reader sent that did not read as a PC word and its EPC.
  readonly unreadable: number
  readonly power_dbm: number
  readonly window_ms: number
  readonly min_rssi_dbm: number
  /// The reader's firmware version, as it reported it.
  readonly firmware: string
  readonly profile: RadioProfile
}

/// The radio profile a read ran with, as the R3 read it back when the shell
/// last set it up (on opening, or after a reset) — `RadioProfile` in
/// `src-tauri/src/rfid.rs`.
export type RadioProfile = {
  readonly fast_id: boolean
  readonly tag_focus: boolean
  /// The session the Query asks, "S0" to "S3".
  readonly session: string
  /// The flag the Query asks for, "A" or "B".
  readonly target: string
  /// The RF link mode, as the vendor's API document names it.
  readonly rf_link: string
  /// The Gen2X mode the shell moved the reader off, not saved in the reader.
  readonly rf_link_moved_from: string | null
}

/// Read every tag on the local Chainway R3's pad. The shell asks the buzzer
/// and the power (a reset moves one or the other, and then everything is set
/// again) and runs one short inventory off the window's thread
/// (`src-tauri/src/rfid.rs`); nothing reads until this is called.
export async function readRfidPad(): Promise<PadRead> {
  const invoke = bridge()
  if (invoke === null) {
    throw new Error("The Chainway R3 can only be read from the Windows till app.")
  }
  return invoke<PadRead>("rfid_read_pad")
}
