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
/// The counter is the screen that gets looked at hardest, so it has to be
/// workable in a normal browser tab while it is being designed. Outside Tauri
/// there is no shell to ask, and rather than fake an answer — the one thing
/// that teaches you a till works when it does not — every call reports the
/// same honest refusal a dead node would.

export type EdgeReply<T = unknown> = {
  readonly ok: boolean
  readonly status: number
  readonly body: T
  readonly problem: string | null
}

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
    `Jendela ini dibuka di browser biasa, bukan di aplikasi kasir, ` +
    `jadi ${what} tidak bisa dijangkau. Jalankan lewat “npm run tauri dev”.`,
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
  if (invoke === null) return noShell("node toko")
  return invoke<EdgeReply<T>>("edge_call", { method, path, body })
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
  if (invoke === null) return noShell("node toko")
  return invoke<EdgeReply<T>>("edge_signed_call", { method, path, body })
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
      detail: "Pemindai sidik jari hanya bisa dijangkau dari aplikasi kasir.",
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
    return "Layar pelanggan hanya bisa dibuka dari aplikasi kasir."
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
      detail: "Perangkat hanya bisa dijangkau dari aplikasi kasir.",
    }
  }
  return invoke<DeviceState>(which)
}

/// Read one EPC with the local Chainway R3. The Rust command mutes the buzzer
/// and verifies it before inventory, so the page cannot start a noisy sweep.
export async function readRfidSingle(): Promise<string> {
  const invoke = bridge()
  if (invoke === null) {
    throw new Error("Chainway R3 hanya bisa dibaca dari aplikasi kasir Windows.")
  }
  return invoke<string>("rfid_read_single")
}
