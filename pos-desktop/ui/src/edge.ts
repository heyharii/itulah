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
  // The node ended this session because the person signed in on another
  // device (one device per person, head office's switch per store): any call
  // that hears so takes the terminal back to its door (`session.ts`).
  if (reply.status === 401 && /another device/i.test(`${reply.problem ?? ""} ${JSON.stringify(reply.body ?? "")}`)) {
    window.dispatchEvent(new CustomEvent(SIGNED_IN_ELSEWHERE))
  }
  return reply
}

/// Raised when the node says this terminal's session was ended by a sign-in
/// on another device.
export const SIGNED_IN_ELSEWHERE = "central-signed-in-elsewhere"

import { isWeb } from "@/edition"
import { webEdge, webImage } from "@/web"

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

/// A product photograph as a `data:` URL, or null when there is none to show.
/// Bytes cannot ride `edge()` (it answers JSON), so the shell fetches the
/// picture from the node's proxy (`/api/v1/catalog/image?sku=`) and hands it
/// back wrapped; the browser edition fetches it itself. Never throws.
export async function edgeImage(sku: string): Promise<string | null> {
  const invoke = bridge()
  if (invoke === null) return isWeb ? webImage(sku) : null
  try {
    return (await invoke<string | null>("edge_image", { sku })) ?? null
  } catch {
    return null
  }
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

/// Central Gudang: tie the session just signed in to this warehouse PC
/// (`edge_bind_session`). The shell sends the session's token and this
/// machine's signature in one request — the node's proof that the session is
/// this PC's, which is what lets a cashier here receive and move stock.
/// Answers `{ terminal_id, label }`.
export type BoundSession = { readonly terminal_id: string; readonly label: string }

export async function bindSession(): Promise<EdgeReply<BoundSession>> {
  const invoke = bridge()
  if (invoke === null) return noShell("the warehouse PC's sign-in")
  return heard(await invoke<EdgeReply<BoundSession>>("edge_bind_session"))
}

export type DeviceState = { readonly bound: boolean; readonly detail: string }

/// Who the finger on the scanner belongs to — `Identified` in
/// `src-tauri/src/fingerprint.rs`.
///
/// `bound` and `actor_id` answer two different questions and must not be
/// collapsed: a scanner that is not attached and a finger that is not enrolled
/// look identical to a cashier standing at the counter, and only one of them is
/// fixed by pressing again. `placed: false` is a third answer — nobody pressed
/// before the wait ran out — and is never claimed at the node.
export type Identified = {
  readonly bound: boolean
  readonly placed: boolean
  readonly actor_id: string | null
  readonly score: number | null
  readonly detail: string
}

/// One enrolled finger as the shell matches it: `actor_id` is what a match
/// answers with (the window sends the enrolment's `finger_id`), `username`
/// whose it is.
export type ScannerFinger = {
  readonly actor_id: string
  readonly template_base64: string
  readonly username?: string
}

/// How long to wait for a finger, and the name a wait is called off by.
export type FingerWait = {
  /// Default ten seconds in the shell, at most thirty.
  readonly waitMs?: number
  /// A wait that only listens (the door) gives a name, and calls it off with
  /// `cancelFinger` the moment its screen changes.
  readonly watch?: string
}

/// Match the finger on the scanner against the fingers the node has enrolled.
///
/// The templates are passed in rather than fetched by the shell: which fingers
/// may open this till is the node's decision, and matching happens here so a
/// counter can still be opened when the line to head office is down. The shell
/// waits for a finger (`wait.waitMs`), off the window's thread.
export async function identifyFinger(
  enrolled: readonly ScannerFinger[],
  wait: FingerWait = {},
): Promise<Identified> {
  const invoke = bridge()
  if (invoke === null) {
    return {
      bound: false,
      placed: false,
      actor_id: null,
      score: null,
      detail: "The fingerprint scanner can only be reached from the till app.",
    }
  }
  try {
    return await invoke<Identified>("fingerprint_identify", {
      enrolled,
      waitMs: wait.waitMs,
      watch: wait.watch,
    })
  } catch (error) {
    return { bound: false, placed: false, actor_id: null, score: null, detail: String(error) }
  }
}

/// Call off a wait for a finger by its name. Never throws: a wait that has
/// already ended has nothing to call off.
export async function cancelFinger(watch: string): Promise<void> {
  const invoke = bridge()
  if (invoke === null) return
  try {
    await invoke<null>("fingerprint_cancel", { watch })
  } catch {
    // nothing to call off
  }
}

/// One press towards enrolling a finger — `Enrolled` in
/// `src-tauri/src/fingerprint.rs`. Three presses of the same finger are
/// merged into `template_base64`, which the window posts to the node.
export type EnrolPress = {
  readonly bound: boolean
  readonly placed: boolean
  readonly presses: number
  readonly needed: number
  readonly template_base64: string | null
  /// The press matched an enrolment already on the roster (its `actor_id`).
  readonly duplicate_of: string | null
  /// Not the same finger as the press before; it did not count.
  readonly retry: boolean
  readonly reader_kind: string
  readonly detail: string
}

/// One enrolment press. `restart` begins again; with `enrolled` the shell
/// refuses a finger already enrolled to anybody on its first press.
export async function enrolPress(
  options: { restart?: boolean; enrolled?: readonly ScannerFinger[] } & FingerWait,
): Promise<EnrolPress> {
  const invoke = bridge()
  const refused = (detail: string): EnrolPress => ({
    bound: false,
    placed: false,
    presses: 0,
    needed: 3,
    template_base64: null,
    duplicate_of: null,
    retry: false,
    reader_kind: "",
    detail,
  })
  if (invoke === null) {
    return refused("The fingerprint scanner can only be reached from the till app.")
  }
  try {
    return await invoke<EnrolPress>("fingerprint_enroll", {
      restart: options.restart,
      enrolled: options.enrolled,
      waitMs: options.waitMs,
      watch: options.watch,
    })
  } catch (error) {
    return refused(String(error))
  }
}

/// Print text to the till's USB printer, silently: no print window. Resolves
/// "printed", "not-usb" (this till prints no other way — the caller uses the
/// browser's print) or the reason it failed. Used by the slips of the cash
/// screens (Hari, 30 Oct 2026: the printer window must not appear).
export async function printTextHere(
  text: string,
  paper: string,
): Promise<"printed" | "not-usb" | string> {
  const invoke = bridge()
  if (invoke === null) return "not-usb"
  try {
    await invoke<unknown>("print_text_here", { text, paper })
    return "printed"
  } catch (error) {
    const reason = String(error)
    return reason.includes("NOT_USB") ? "not-usb" : reason
  }
}

/// Run the scanner's driver installer that ships with the till. Null when it
/// started (Windows asks for an administrator), else why not.
export async function installFingerDriver(): Promise<string | null> {
  const invoke = bridge()
  if (invoke === null) return "The driver can only be installed from the till app."
  try {
    await invoke<null>("fingerprint_install_driver")
    return null
  } catch (error) {
    return String(error)
  }
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

/// One tag heard only below this till's signal floor, and so left out —
/// `WeakTag` in `src-tauri/src/rfid.rs`.
export type WeakTag = {
  /// Upper-case hex, without the PC word.
  readonly epc: string
  /// The strongest it was heard at, in dBm; null when it came with none.
  readonly rssi_dbm: number | null
  readonly reads: number
}

/// One read of the R3's pad — `PadRead` in `src-tauri/src/rfid.rs`.
export type PadRead = {
  /// Each EPC once, strongest first.
  readonly tags: readonly PadTag[]
  /// Tags heard only below this till's signal floor, left out.
  readonly too_weak: number
  /// Those tags, strongest first, for setting the floor on Test read.
  readonly left_out: readonly WeakTag[]
  /// Records the reader sent that did not read as a PC word and its EPC.
  readonly unreadable: number
  /// Every record the read took, readable or not. The bench R3 stopped at
  /// about 35 records an inventory, so a large basket may not be read whole.
  readonly records: number
  readonly power_dbm: number
  readonly window_ms: number
  readonly min_rssi_dbm: number
  /// The reader's firmware version, as it reported it.
  readonly firmware: string
  readonly profile: RadioProfile
  /// The counter's check tag as this read heard it — never in `tags` or
  /// `left_out`. Null: the counter has none.
  readonly canary: CanaryRead | null
  /// What this read leaves needing attention (its check tag missing or
  /// faint); null when nothing.
  readonly attention: Fault | null
  /// From the request to the last record, without the wait for the gap.
  readonly took_ms: number
  readonly waited_ms: number
}

/// The counter's check tag in one read — `CanaryRead` in `src-tauri/src/rfid.rs`.
export type CanaryRead = {
  readonly epc: string
  readonly heard: boolean
  readonly rssi_dbm: number | null
  readonly reads: number
  /// How far above the floor it was heard, in dB; negative below it.
  readonly margin_db: number | null
}

/// How the R3 stands — `ReaderState` in `src-tauri/src/rfid.rs`.
export type ReaderState = "ready" | "busy" | "attention" | "not_connected"

/// One step that failed, by its code — `Fault` in `src-tauri/src/rfid.rs`.
/// Every code is in `docs/rfid-status-and-errors.md`.
export type Fault = {
  readonly code: string
  /// What the till shows while this is the last thing it learned; null for
  /// a note about one read that leaves the state as it was.
  readonly state: ReaderState | null
  /// What happened, for the cashier.
  readonly says: string
  /// The one thing to do about it.
  readonly action: string
  /// For support.
  readonly detail: string
}

/// How the R3 stands — `ReaderStatus` in `src-tauri/src/rfid.rs`.
export type ReaderStatus = {
  readonly state: ReaderState
  /// What made it Needs attention or Not connected; null otherwise.
  readonly fault: Fault | null
  /// For support: the reader as last confirmed, or the fault's detail.
  readonly detail: string
}

/// What the cashier reads: what happened, what to do, and the code.
export const sentence = (fault: Fault) => `${fault.says} ${fault.action} (${fault.code})`

/// A read, a test or a calibration that failed, with its coded fault. The
/// message is the cashier's sentence, so a caller that only shows
/// `error.message` still shows the right words.
export class ReaderFault extends Error {
  readonly fault: Fault

  constructor(fault: Fault) {
    super(sentence(fault))
    this.fault = fault
  }
}

/// Faults the window raises itself, worded as in `CATALOGUE` in
/// `src-tauri/src/rfid.rs`: no shell to ask, or a shell that did not answer.
const NOT_THIS_APP: Omit<Fault, "detail"> = {
  code: "R3-01",
  state: "not_connected",
  says: "This till app cannot use the R3.",
  action: "Use the Windows till app.",
}
const APP_NO_ANSWER: Omit<Fault, "detail"> = {
  code: "R3-08",
  state: "not_connected",
  says: "The till app could not ask the R3.",
  action: "Restart the till app.",
}
/// Notes about one read, raised only by the window (`till.tsx`).
export const NOTHING_HEARD: Omit<Fault, "detail"> = {
  code: "R3-23",
  state: null,
  says: "No tag was heard on the pad.",
  action: "Put the items on the pad, then read again.",
}
export const NOT_ON_THAT_LINE: Omit<Fault, "detail"> = {
  code: "R3-24",
  state: null,
  says: "None of the tags on the pad is on that line.",
  action: "Put only the item to take off on the pad, then read again.",
}

/// What a failed R3 call says to the cashier: its coded sentence.
export function readerProblem(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/// What a shell call that failed comes to: the shell's own fault when it
/// sent one, or R3-08 with whatever the bridge said.
function faultOf(error: unknown): Fault {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Fault).code === "string" &&
    typeof (error as Fault).says === "string"
  ) {
    return error as Fault
  }
  return { ...APP_NO_ANSWER, detail: error instanceof Error ? error.message : String(error) }
}

/// How the R3 stands, for the chip beside its read button. `open`: open it
/// and confirm its settings first, as a read would; otherwise only what the
/// shell already knows, which never touches the reader and never waits for a
/// read (a reader a read holds is Busy).
export async function readerStatus(open: boolean): Promise<ReaderStatus> {
  const invoke = bridge()
  if (invoke === null) {
    const detail = "There is no till shell in this window."
    return { state: "not_connected", fault: { ...NOT_THIS_APP, detail }, detail }
  }
  try {
    return await invoke<ReaderStatus>("rfid_status", { open })
  } catch (error) {
    const fault = faultOf(error)
    return { state: "not_connected", fault, detail: fault.detail }
  }
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
  /// The region the reader is set to, by the vendor's name for it; null when
  /// it could not be read. Read only: the band is the owner's decision.
  readonly region: string | null
  /// The channels the reader hops over; null when they could not be read.
  readonly channels: string | null
  /// The antenna mask's two bytes in hex, as the reader sent them; null when
  /// it could not be read. Shown, never judged: its byte order is unproven.
  readonly antennas: string | null
  /// The work and wait time the read ran with (a wait other than 0 is set to
  /// 0 by the shell, not saved in the reader); null when it could not be read.
  readonly work_wait: string | null
}

/// Read every tag on the local Chainway R3's pad. The shell asks the buzzer
/// and the power (a reset moves one or the other, and then everything is set
/// again) and runs one short inventory off the window's thread
/// (`src-tauri/src/rfid.rs`); nothing reads until this is called. A read that
/// fails throws a `ReaderFault`.
export async function readRfidPad(): Promise<PadRead> {
  return shellAsk<PadRead>("rfid_read_pad")
}

/// One read of a Test reader run or of Calibrate — `ReadSummary`.
export type ReadSummary = {
  readonly took_ms: number
  readonly waited_ms: number
  readonly tags: number
  readonly left_out: number
  readonly unreadable: number
  /// Every record the read took, readable or not.
  readonly records: number
  /// The EPCs it heard, each once: kept, left out and the check tag.
  readonly epcs: number
  readonly canary: CanaryRead | null
  readonly fault: Fault | null
}

/// Till devices' Test reader — `ReaderTest` in `src-tauri/src/rfid.rs`: the
/// R3 opened afresh, its settings read back, then three reads a gap apart.
export type ReaderTest = {
  readonly passed: boolean
  /// The first check that failed, or what passed.
  readonly reason: string
  readonly fault: Fault | null
  readonly open_ms: number | null
  readonly firmware: string | null
  readonly profile: RadioProfile | null
  readonly reads: readonly ReadSummary[]
  /// Every read kept the same tags.
  readonly stable: boolean
  readonly weakest: PadTag | null
  readonly margin_db: number | null
  /// The recipe the reader was set to: `r3-conservative-v1`.
  readonly profile_id: string
  readonly power_dbm: number
  readonly window_ms: number
  readonly gap_ms: number
  readonly floor_dbm: number
  /// The last read in full, for its lists of tags.
  readonly last: PadRead | null
}

/// One tag as Calibrate weighs it — `SeenTag`.
export type SeenTag = {
  readonly epc: string
  readonly rssi_dbm: number
  readonly check_tag: boolean
}

/// Till devices' Calibrate — `Calibration` in `src-tauri/src/rfid.rs`. A
/// suggestion only: the floor is saved when the installer says so.
export type Calibration = {
  readonly suggested_dbm: number | null
  readonly floor_dbm: number
  readonly weakest: SeenTag | null
  readonly strongest_off: SeenTag | null
  readonly on_pad: number
  readonly unsteady: number
  readonly warnings: readonly Fault[]
  readonly reads: readonly ReadSummary[]
}

/// Open the R3 afresh, read its settings back and read the pad three times.
export const testReader = () => shellAsk<ReaderTest>("rfid_test_reader")

/// Read the test items on the pad three times and suggest a floor.
export const calibrateReader = () => shellAsk<Calibration>("rfid_calibrate")

/// The reader's facts for support, as text for the clipboard.
export const readerDiagnostics = () => shellAsk<string>("rfid_diagnostics")

/// One R3 call through the shell; a failure, or no shell at all, throws a
/// `ReaderFault`.
async function shellAsk<T>(command: string): Promise<T> {
  const invoke = bridge()
  if (invoke === null) {
    throw new ReaderFault({ ...NOT_THIS_APP, detail: "There is no till shell in this window." })
  }
  try {
    return await invoke<T>(command)
  } catch (error) {
    throw new ReaderFault(faultOf(error))
  }
}
