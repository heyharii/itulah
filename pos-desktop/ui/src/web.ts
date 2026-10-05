/// The till in an ordinary browser tab — the web version the shop app links to.
///
/// Outside Tauri there is no shell to hold the node's address, the token and
/// the terminal's name, so this file stands in for the parts of it a browser
/// can honestly do, and nothing more:
///
/// - **The node is this page's own origin.** The page is served next to the
///   node — Vite's `/api` proxy in development, the same origin in production —
///   so a path is all a call names, exactly as through the shell. There is no
///   address to type and nothing to point at another shop.
/// - **The token lives in `sessionStorage`**, one tab's worth. That is weaker
///   than the shell's config file and deliberately so: close the tab and the
///   till is signed out, which is the right default for a counter opened from a
///   link on somebody's back-office screen.
/// - **Cookies are not sent.** The shop app on the same host holds a session
///   cookie of its own; a till that rode on it would be signed in as whoever
///   last used the back office, not as the cashier standing here.
///
/// What a browser cannot do — the pairing secret behind fingerprints and PINs,
/// the RFID reader, the drawer, the customer display, joining — keeps
/// refusing in `edge.ts`, because none of it can be done from here.

import type { EdgeReply } from "@/edge"
import type { NodeConfig } from "@/session"

const TOKEN_KEY = "pos.web.token.v1"
const TERMINAL_KEY = "pos.web.terminal.v1"
const PRINTER_KEY = "pos.web.printer.v1"

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null || value === "") storage().removeItem(key)
    else storage().setItem(key, value)
  } catch {
    // Private browsing, or storage refused: the till still works for as long
    // as this page stays open, it just forgets on reload.
  }
}

const local = () => window.localStorage
const session = () => window.sessionStorage

/// This browser's till name, minted once and kept — printed on receipts and
/// carried on every shift, so it has to survive a reload.
function terminalId(): string {
  const held = read(local, TERMINAL_KEY)
  if (held !== null && held !== "") return held
  const minted = `WEB-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  write(local, TERMINAL_KEY, minted)
  return minted
}

type Printer = {
  readonly printer_host: string | null
  readonly printer_port: number
  readonly paper: string
}

function printer(): Printer {
  const fallback: Printer = { printer_host: null, printer_port: 9100, paper: "NARROW" }
  const raw = read(local, PRINTER_KEY)
  if (raw === null) return fallback
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<Printer>) }
  } catch {
    return fallback
  }
}

/// The browser's `node_config`, in the shell's own shape.
export function webConfig(): NodeConfig {
  return {
    base_url: window.location.origin,
    token: read(session, TOKEN_KEY),
    terminal_id: terminalId(),
    ...printer(),
    pairing_id: null,
    pairing_secret: null,
    pairing_sequence: 0,
    simulate_fingerprint: null,
    joined: null,
  }
}

/// The browser's `set_node_config`. The address is not taken: this page can
/// only reach the origin it was served from, so a different one would be a
/// setting that silently does nothing.
export function webSetConfig(next: NodeConfig): NodeConfig {
  write(session, TOKEN_KEY, next.token)
  if (next.terminal_id.trim() !== "") write(local, TERMINAL_KEY, next.terminal_id.trim())
  write(
    local,
    PRINTER_KEY,
    JSON.stringify({
      printer_host: next.printer_host,
      printer_port: next.printer_port,
      paper: next.paper,
    }),
  )
  return webConfig()
}

/// The shell's patience (`PATIENCE` in `src-tauri/src/edge.rs`), so a dead
/// node is reported as quickly on either road.
const PATIENCE_MS = 10_000

/// One call to the node, shaped the way `reply_from` in `src-tauri/src/edge.rs`
/// shapes it, so no screen can tell which road the answer came by.
export async function webEdge<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<EdgeReply<T>> {
  if (!path.startsWith("/")) {
    return unreachable(`“${path}” bukan path di node toko.`)
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Terminal-Id": terminalId(),
  }
  const token = read(session, TOKEN_KEY)
  if (token !== null && token !== "") headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers["Content-Type"] = "application/json"

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      signal: AbortSignal.timeout(PATIENCE_MS),
    })
  } catch (error) {
    return unreachable(
      `Node toko tidak menjawab (${error instanceof Error ? error.message : String(error)}).`,
    )
  }

  const text = await response.text().catch(() => "")
  let parsed: unknown = null
  try {
    parsed = text === "" ? null : JSON.parse(text)
  } catch {
    parsed = null
  }
  const ok = response.ok
  let problem: string | null = null
  if (!ok) {
    const said = parsed as { message?: unknown; error?: unknown } | null
    const words =
      typeof said?.message === "string"
        ? said.message
        : typeof said?.error === "string"
          ? said.error
          : null
    problem =
      words ??
      (text.trim() === ""
        ? `Node toko menolak dengan ${response.status} tanpa keterangan.`
        : text)
  }
  return { ok, status: response.status, body: parsed as T, problem }
}

function unreachable(detail: string): EdgeReply<never> {
  return { ok: false, status: 0, body: undefined as never, problem: detail }
}
