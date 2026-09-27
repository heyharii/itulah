/// Who is standing at this till, and which shop's node it is pointed at.
///
/// # Why the token lives in the shell and not here
///
/// `src-tauri/src/edge.rs` holds the node's address, the terminal's number and
/// the bearer token together, and puts the token on every call itself. A copy
/// kept in this window would be readable by anything the WebView ever loads,
/// and it is the credential that can sell. So this file never stores a token —
/// it hands one over and asks for it back. The password is not even that: it
/// is a parameter, an argument to `login()`, and then gone.
///
/// # Why the state is a module and not a component
///
/// There is one shell, one token and one terminal, so there is one session.
/// Two screens each keeping their own copy is the mistake `README.md` names
/// for stock and price — a second authority — and here it would surface as a
/// cashier who is signed in on one screen and out on the next. A context would
/// say that better, but its provider would have to go in `app.tsx`, which this
/// file may not touch; so the store is a module and the hooks are readings of
/// it.
///
/// # What it refuses to pretend
///
/// Outside Tauri there is no shell, and every call already refuses honestly.
/// That refusal is carried up and shown, never swallowed into a "signed in"
/// that a browser tab invented. A till that looks signed in and cannot sell is
/// worse than one that says it is not a till.

import { useEffect, useSyncExternalStore } from "react"

import { claimFinger, claimPin, login, logout, me, roster, type Me } from "@/api"
import { identifyFinger } from "@/edge"
import type { Peripherals } from "@/peripherals"

/// The shell's copy of what this terminal is. Field names are the Rust
/// struct's — `NodeConfig` in `src-tauri/src/edge.rs` — because they cross the
/// bridge as they are spelled.
export type NodeConfig = {
  readonly base_url: string
  readonly token: string | null
  readonly terminal_id: string
  /// The receipt printer as the NODE will reach it, not as this machine would:
  /// the node does the printing because it is the party on the printer's LAN.
  readonly printer_host: string | null
  readonly printer_port: number
  /// `NARROW` (58mm) or `WIDE` (80mm).
  readonly paper: string
  /// What this terminal was called when it was paired with the node. Present
  /// means paired; absent means fingerprints cannot be used here, because the
  /// node has no way to be sure a claim came from this machine.
  readonly pairing_id: string | null
  /// Never read back from the shell — it is handed over once at pairing and
  /// lives only where the signing happens.
  readonly pairing_secret: string | null
  readonly pairing_sequence: number
  /// Whose finger this terminal pretends matched, while there is no scanner to
  /// press. Only a development build of the shell reads it; a release compiles
  /// that code out entirely.
  readonly simulate_fingerprint: string | null
  /// Which node this till joined, and what it is called there — as the node
  /// said when it let the till in (`src-tauri/src/join.rs`). Null for a till
  /// paired the old way, or not at all. Only the shell writes it.
  readonly joined?: JoinedNode | null
  /// What is plugged into this till. Only `set_peripherals` changes it; see
  /// `peripherals.ts`.
  readonly peripherals?: Peripherals
}

/// `JoinedNode` in `src-tauri/src/edge.rs`.
export type JoinedNode = {
  readonly origin_id: string
  readonly site_id: string
  /// The shop in head office's words when this till joined. Absent when the
  /// node had not heard from head office yet.
  readonly site_code?: string | null
  readonly site_name?: string | null
  /// "Kasir 3" — also this terminal's `terminal_id`.
  readonly label: string
  /// Unix seconds.
  readonly joined_at: number
}

/// What a person may change. The token is deliberately not in it: the node
/// issues that, nobody types it.
export type NodeEdit = {
  readonly base_url: string
  readonly terminal_id: string
  readonly printer_host: string | null
  readonly printer_port: number
  readonly paper: string
  /// Carried through an ordinary save so editing the printer does not unpair a
  /// terminal. `pairing_secret` is null on every save but the pairing itself:
  /// a secret this page does not hold is a secret it cannot leak.
  readonly pairing_id?: string | null
  readonly pairing_secret?: string | null
  readonly simulate_fingerprint?: string | null
}

/// The same string `NodeConfig::default()` uses in `src-tauri/src/edge.rs`.
/// Repeated here only so the top bar has something to print in the moment
/// before the bridge answers — and, outside Tauri, forever. It names a till
/// nobody configured, which is why every *call* still refuses rather than
/// quietly trading under it.
const SHELL_DEFAULT_TERMINAL = "POS-01"

// ── the bridge, for the shell's own commands ────────────────────────────

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/// Read lazily, for the same reason `edge.ts` does: in dev the page can be up
/// before the shell has finished wiring the bridge.
function bridge(): Invoke | null {
  const host = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: Invoke }
  }
  return host.__TAURI_INTERNALS__?.invoke ?? null
}

export type ShellReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string }

/// Ask the shell about itself — its settings, not the node's answers.
///
/// Separate from `edge()` because these commands are not HTTP: they take no
/// path and come back as the value itself rather than an `EdgeReply`. Outside
/// Tauri it refuses in the same words, rather than returning a made-up config,
/// which is how a browser tab would talk somebody into believing a till is set
/// up.
export async function shellCall<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<ShellReply<T>> {
  const invoke = bridge()
  if (invoke === null) {
    return {
      ok: false,
      problem:
        `Jendela ini dibuka di browser biasa, bukan di aplikasi kasir, ` +
        `jadi setelan terminal tidak bisa dibaca. ` +
        `Jalankan lewat “npm run tauri dev”.`,
    }
  }
  try {
    return { ok: true, value: await invoke<T>(command, args) }
  } catch (refusal) {
    // A Tauri command rejects with its own words. They are the shell's, and
    // anything invented here could only disagree with them.
    return { ok: false, problem: String(refusal) }
  }
}

/// Give the shell a config and take back what it kept — never assume the two
/// are the same, since the shell is the one that decides.
const hand = (next: NodeConfig) =>
  shellCall<NodeConfig>("set_node_config", { next })

// ── the one session ─────────────────────────────────────────────────────

type Held = {
  readonly config: NodeConfig | null
  readonly me: Me | null
  readonly ready: boolean
  readonly problem: string | null
}

let held: Held = { config: null, me: null, ready: false, problem: null }

const watchers = new Set<() => void>()

function put(change: Partial<Held>): void {
  held = { ...held, ...change }
  for (const watcher of watchers) watcher()
}

function watch(watcher: () => void): () => void {
  watchers.add(watcher)
  return () => void watchers.delete(watcher)
}

const snapshot = (): Held => held

let opening: Promise<void> | null = null

/// Read the shell once, and find out whether the token it kept is still a
/// session.
///
/// Held as a promise rather than a flag so that two screens mounting together
/// — and StrictMode, which mounts everything twice — ask the node who we are
/// once.
function open(): Promise<void> {
  opening ??= (async () => {
    const got = await shellCall<NodeConfig>("node_config")
    if (!got.ok) {
      put({ ready: true, problem: got.problem })
      return
    }
    const config = got.value
    if (config.token === null || config.token === "") {
      // A node running without sign-in (a demo rig, a bench) refuses every
      // password with "authentication is disabled" — so the sign-in screen
      // would be a door with no key. Ask who we are instead: only such a node
      // answers a caller with no token, and it says so by naming itself
      // DEVELOPMENT. A node that checks answers 401 and the screen stays.
      const open = await me()
      if (open.ok && open.body?.source === "DEVELOPMENT") {
        put({ config, me: open.body, ready: true })
        return
      }
      put({ config, ready: true })
      return
    }

    // A token the shell kept is not yet a session: the node may have expired
    // it while this terminal was closed. Asking costs one call at start-up; not
    // asking costs a counter that opens and then refuses its first sale.
    const who = await me()
    if (who.ok) {
      put({ config, me: who.body, ready: true })
      return
    }

    // A refusal of the token is not a fault — it is a spent token, and the
    // answer to it is the sign-in screen, not red text. Anything else, a node
    // that is not answering above all, has to be read by whoever is at the
    // counter, because typing a password will not fix it.
    const spent = who.status === 401 || who.status === 403
    if (!spent) {
      put({ config, ready: true, problem: who.problem })
      return
    }
    const cleared: NodeConfig = { ...config, token: null }
    await hand(cleared)
    put({ config: cleared, ready: true })
  })()
  return opening
}

/// Sign in on this terminal.
///
/// `password` is read once, on its way to the node, and is held by nothing
/// here afterwards — not in this module, not in the shell, not in storage.
/// That is the only version of the promise worth making.
async function signIn(username: string, password: string): Promise<boolean> {
  await open()
  const config = held.config
  // No shell, or a shell that would not answer. There is nowhere to put a
  // token and no address to sign in against, and guessing one would point this
  // till at a machine nobody chose. `open()` has already said why.
  if (config === null) return false

  put({ problem: null })
  const reply = await login(username, password)
  if (!reply.ok) {
    // The node's own wording. It knows why it refused.
    put({ problem: reply.problem })
    return false
  }
  const token = reply.body?.token ?? ""
  if (token === "") {
    put({
      problem:
        "Node menerima nama dan sandi itu tetapi tidak mengirim token, " +
        "jadi terminal ini belum boleh menjual apa pun.",
    })
    return false
  }

  const saved = await hand({ ...config, token })
  if (!saved.ok) {
    put({ problem: saved.problem })
    return false
  }
  // Asked, not assumed: a token proves the node accepted the password, and
  // `me()` is what says which permissions came with it.
  const who = await me()
  if (!who.ok) {
    put({ config: saved.value, problem: who.problem })
    return false
  }
  put({ config: saved.value, me: who.body, problem: null })
  return true
}

/// Open the counter with a finger.
///
/// Three steps, and the middle one never leaves this machine: ask the node
/// which fingers may open this shop, match the one on the scanner **here**
/// against them, then tell the node which enrolment matched and let it decide
/// what that is worth.
///
/// The matching is local because the scanner and its matcher are on the
/// counter; the node has neither. That is also what lets a till be opened while
/// head office is unreachable. What stops any machine on the shop wifi from
/// simply claiming to be a supervisor is the pairing secret the shell signs
/// with — see `edge_signed_call`.
async function signInWithFinger(): Promise<string | null> {
  await open()
  const config = held.config
  if (config === null) {
    return held.problem ?? "Setelan terminal tidak bisa dibaca dari sini."
  }

  const book = await roster()
  if (!book.ok) return book.problem
  const fingers = book.body?.items ?? []
  if (fingers.length === 0) {
    return "Belum ada sidik jari terdaftar di toko ini. Daftarkan dulu lewat akun admin."
  }

  const seen = await identifyFinger(
    fingers.map((one) => ({
      actor_id: one.username,
      template_base64: one.template_base64,
    })),
  )
  if (!seen.bound) return seen.detail

  // A no-match is still reported to the node, and the node writes it down. A
  // finger tried repeatedly at one terminal late in the evening is the shape a
  // table of successes could never show.
  const matched = fingers.find((one) => one.username === seen.actor_id) ?? null
  const claimed = await claimFinger(
    matched?.finger_id ?? null,
    "SESSION",
    seen.score,
  )
  if (!claimed.ok) return claimed.problem

  const token = claimed.body?.token ?? ""
  if (token === "") {
    return "Node menerima sidik jari itu tetapi tidak mengirim token."
  }
  const saved = await hand({ ...config, token })
  if (!saved.ok) return saved.problem
  const who = await me()
  if (!who.ok) {
    put({ config: saved.value, problem: who.problem })
    return who.problem
  }
  put({ config: saved.value, me: who.body, problem: null })
  return null
}

/// Open the counter with a PIN.
///
/// The same session a password opens, claimed through `claimPin` instead of
/// `login`. There is no roster step and nothing local to match: the secret goes
/// to the node and the node compares it — which is also why this needs the
/// pairing channel (`signedEdge`) rather than the plain one. The node refuses
/// the route outright unless this shop's `till_step_up` is `PIN`, and that
/// refusal comes back in the node's own words.
///
/// Returns the node's own refusal text, or null when the counter is open.
async function signInWithPin(username: string, pin: string): Promise<string | null> {
  await open()
  const config = held.config
  if (config === null) {
    return held.problem ?? "Setelan terminal tidak bisa dibaca dari sini."
  }

  const claimed = await claimPin({ username, pin, purpose: "SESSION" })
  if (!claimed.ok) return claimed.problem

  const token = claimed.body?.token ?? ""
  if (token === "") {
    return "Node menerima PIN itu tetapi tidak mengirim token."
  }
  const saved = await hand({ ...config, token })
  if (!saved.ok) return saved.problem
  const who = await me()
  if (!who.ok) {
    put({ config: saved.value, problem: who.problem })
    return who.problem
  }
  put({ config: saved.value, me: who.body, problem: null })
  return null
}

/// One supervisor authorisation, earned by a finger instead of a password.
///
/// Not a sign-in: the cashier stays signed in and a supervisor walks over,
/// presses a finger, and walks away. What comes back is single-use and expires
/// in three minutes — long enough to get back to their own counter, short
/// enough that it is not a spare key left lying on this one.
export async function supervisorByFinger(): Promise<{
  readonly authorization: string | null
  readonly username: string | null
  readonly problem: string | null
}> {
  const book = await roster()
  if (!book.ok) {
    return { authorization: null, username: null, problem: book.problem }
  }
  const supervisors = (book.body?.items ?? []).filter((one) => one.is_supervisor)
  if (supervisors.length === 0) {
    return {
      authorization: null,
      username: null,
      problem:
        "Belum ada sidik jari supervisor yang terdaftar di toko ini. " +
        "Gunakan nama pengguna dan kata sandi.",
    }
  }

  const seen = await identifyFinger(
    supervisors.map((one) => ({
      actor_id: one.username,
      template_base64: one.template_base64,
    })),
  )
  if (!seen.bound) {
    return { authorization: null, username: null, problem: seen.detail }
  }

  const matched =
    supervisors.find((one) => one.username === seen.actor_id) ?? null
  const claimed = await claimFinger(
    matched?.finger_id ?? null,
    "SUPERVISOR",
    seen.score,
  )
  if (!claimed.ok) {
    return { authorization: null, username: null, problem: claimed.problem }
  }
  const authorization = claimed.body?.authorization ?? null
  if (authorization === null) {
    return {
      authorization: null,
      username: null,
      problem: "Node menerima sidik jari itu tetapi tidak memberi otorisasi.",
    }
  }
  return {
    authorization,
    username: claimed.body?.username ?? null,
    problem: null,
  }
}

/// One supervisor authorisation, earned by a PIN instead of a finger.
///
/// The same grant by the same route family: the node checks the PIN itself,
/// confirms the person behind it may authorise, and hands back a token that is
/// single-use and expires in three minutes — the same clock a finger's grant
/// runs on, because what expires is the grant and not the method that bought
/// it. The cashier stays signed in; the supervisor types six-to-eight digits
/// and walks away.
///
/// The PIN is spent here and held by nothing afterwards — the caller empties
/// its pad the moment this answers, and nothing on this terminal ever writes
/// one down.
export async function supervisorByPin(
  username: string,
  pin: string,
): Promise<{
  readonly authorization: string | null
  readonly username: string | null
  readonly problem: string | null
}> {
  const claimed = await claimPin({ username, pin, purpose: "SUPERVISOR" })
  if (!claimed.ok) {
    return { authorization: null, username: null, problem: claimed.problem }
  }
  const authorization = claimed.body?.authorization ?? null
  if (authorization === null) {
    return {
      authorization: null,
      username: null,
      problem: "Node menerima PIN itu tetapi tidak memberi otorisasi.",
    }
  }
  return {
    authorization,
    username: claimed.body?.username ?? null,
    problem: null,
  }
}

/// Hand the terminal back to nobody.
async function signOut(): Promise<void> {
  // The node is told first, while the shell still holds the token that says
  // who is leaving. Clearing the shell first would make this call anonymous
  // and leave the session open at the node.
  //
  // Its answer is deliberately not surfaced: a cashier walking away from an
  // open till must be able to lock it whether or not the shop node is up.
  await logout()
  const config = held.config
  if (config === null) {
    put({ me: null, problem: null })
    return
  }
  const cleared: NodeConfig = { ...config, token: null }
  await hand(cleared)
  put({ config: cleared, me: null, problem: null })
}

/// Point this terminal at a node.
///
/// Changing the address drops the token, and not as housekeeping: a session
/// issued by one shop's node means nothing at another's, and sending it there
/// would hand a machine in a different building a credential that can sell. So
/// re-pointing signs the terminal out, and whoever did it signs in again.
///
/// Returns the refusal in the shell's own words, or null when it was taken.
async function pointAt(next: NodeEdit): Promise<string | null> {
  await open()
  const config = held.config
  if (config === null) {
    return held.problem ?? "Setelan terminal tidak bisa dibaca dari sini."
  }

  const base = next.base_url.trim().replace(/\/+$/, "")
  const terminal = next.terminal_id.trim()
  if (base === "") {
    return "Alamat node tidak boleh kosong — terminal ini tidak memutuskan apa pun sendiri."
  }
  // The shell pastes the path straight onto this string, so an address without
  // a scheme is not a shorter address, it is a URL that will never resolve.
  if (!/^https?:\/\//i.test(base)) {
    return "Alamat node harus dimulai dengan http:// atau https://, misalnya http://192.168.1.20:8082."
  }
  if (terminal === "") {
    return "Nomor terminal tidak boleh kosong — nomor itu ikut tercetak di struk."
  }

  const printer = next.printer_host?.trim() ?? ""
  const port = Math.trunc(next.printer_port)
  if (printer !== "" && (port <= 0 || port > 65535)) {
    return "Port printer tidak masuk akal. Umumnya 9100."
  }
  const paper = next.paper.trim().toUpperCase()
  if (paper !== "NARROW" && paper !== "WIDE") {
    return "Lebar kertas hanya NARROW (58mm) atau WIDE (80mm)."
  }

  const moved = base !== config.base_url.trim().replace(/\/+$/, "")
  const saved = await hand({
    // Everything the shell holds that this screen does not edit — which node
    // the till joined, its peripherals — rides through unchanged. The shell
    // keeps its own copy of those regardless; this keeps the two in step.
    ...config,
    base_url: base,
    terminal_id: terminal,
    token: moved ? null : config.token,
    // Blank means this counter has no printer, which is an ordinary state: a
    // till can sell all day and hand over no paper. Stored as null rather than
    // "" so nothing downstream has to guess which empty it is looking at.
    printer_host: printer === "" ? null : printer,
    printer_port: port > 0 ? port : 9100,
    paper,
    // Undefined means "leave it alone": only the pairing screen ever sets these,
    // and a save that blanked them would unpair a terminal by tidying a printer
    // address.
    pairing_id:
      next.pairing_id !== undefined ? next.pairing_id : config.pairing_id,
    pairing_secret:
      next.pairing_secret !== undefined && next.pairing_secret !== null
        ? next.pairing_secret
        : config.pairing_secret,
    pairing_sequence: config.pairing_sequence,
    simulate_fingerprint:
      next.simulate_fingerprint !== undefined
        ? next.simulate_fingerprint
        : config.simulate_fingerprint,
  })
  if (!saved.ok) return saved.problem
  put({ config: saved.value, me: moved ? null : held.me, problem: null })
  return null
}

/// Take the shell's config as it now is, after the shell changed it on its
/// own: a till that was let into a node, peripherals saved.
///
/// A till that joined a *different* node has had its token dropped by the
/// shell — a session one shop's node issued means nothing at another's — and
/// whoever was signed in here is signed out with it. The session is then read
/// afresh, exactly as at start-up, so a node that checks nobody is still
/// recognised as one.
export function adoptConfig(config: NodeConfig): void {
  const before = held.config
  const moved =
    before !== null &&
    before.base_url.replace(/\/+$/, "") !== config.base_url.replace(/\/+$/, "")
  const lostToken =
    (before?.token ?? null) !== null && (config.token ?? null) === null
  if (moved || lostToken) {
    put({ config, me: null, ready: false, problem: null })
    opening = null
    void open()
    return
  }
  put({ config })
}

/// Read the shell's config again and adopt it. For screens that asked the
/// shell to change something and were not handed the result.
export async function refreshFromShell(): Promise<void> {
  const got = await shellCall<NodeConfig>("node_config")
  if (got.ok) adoptConfig(got.value)
}

// ── what screens see ────────────────────────────────────────────────────

export type Session = {
  /// Null until the node has said who this token belongs to. Never a guess.
  readonly me: Me | null
  /// The shell's token, shown only so a screen can tell "no token" from "a
  /// token the node would not honour". It is not what authorises a call — the
  /// shell does that.
  readonly token: string | null
  /// Which till this is, printed on receipts and carried when a shift opens.
  /// Never empty: before the shell answers, and where there is no shell at
  /// all, it is the shell's own default rather than a blank space on a screen
  /// that is supposed to say which counter you are standing at.
  readonly terminalId: string
  /// False while the shell is still being read. A till that drew its sign-in
  /// form as though it already knew the answer would flicker a cashier through
  /// a screen they did not need.
  readonly ready: boolean
  /// Why the last thing failed, in the node's or the shell's own words.
  readonly problem: string | null
  /// True when the node accepted, which is the only thing that opens a counter.
  readonly signIn: (username: string, password: string) => Promise<boolean>
  /// Returns the node's own refusal text, or null when the counter is open.
  readonly signInWithFinger: () => Promise<string | null>
  readonly signInWithPin: (username: string, pin: string) => Promise<string | null>
  readonly signOut: () => Promise<void>
}

export function useSession(): Session {
  const now = useSyncExternalStore(watch, snapshot)
  useEffect(() => {
    void open()
  }, [])
  const terminal = now.config?.terminal_id ?? ""
  return {
    me: now.me,
    token: now.config?.token ?? null,
    terminalId: terminal === "" ? SHELL_DEFAULT_TERMINAL : terminal,
    ready: now.ready,
    problem: now.problem,
    signIn,
    signInWithFinger,
    signInWithPin,
    signOut,
  }
}

export type NodeSettings = {
  /// Null until the shell has answered, and null forever when there is no
  /// shell to answer.
  readonly config: NodeConfig | null
  /// Null when the shell took it; otherwise the refusal, to be shown as it is.
  readonly save: (next: NodeEdit) => Promise<string | null>
}

export function useNodeConfig(): NodeSettings {
  const now = useSyncExternalStore(watch, snapshot)
  useEffect(() => {
    void open()
  }, [])
  return { config: now.config, save: pointAt }
}
