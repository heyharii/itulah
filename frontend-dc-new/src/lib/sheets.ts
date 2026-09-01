import { getRouteApi, useNavigate, useSearch } from "@tanstack/react-router"

/// Every sheet and every open session in this app, named once, and held in the
/// URL.
///
/// The hub keeps sheets here because a record you are looking at is something
/// you send a colleague. A warehouse has a second, harder reason: **a station
/// is a session**. A picker opens a round, walks the aisles, and the handheld
/// sleeps in their hand. A packer opens a box against a target and carries it
/// to the RFID arch. If "which session is open" lived in `useState`, coming
/// back would mean a fresh screen with an open session on the server that
/// nothing on the device points at any more — and the second round they open
/// is the paperwork saying they picked twice.
///
/// So the session id is a URL parameter like everything else, and waking the
/// device up is a page load that lands back in the same round.
///
/// This is the file `nuqs` would be doing in another codebase; TanStack Router
/// validates search itself, so no second library is needed. It is a central
/// registry rather than a declaration per screen because the **root route has
/// to validate all of them at once**: Router merges the validated search of
/// every matched route, so declaring the keys once on the root is what makes
/// them legal on every route below it.

/// An identifier out of a query string, or nothing.
///
/// Shape-checked rather than passed through: the value is handed to a query key
/// and then to the server, and an empty string is not an id — it is a sheet
/// that opens onto a request nobody can answer.
function id(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/// A sheet with nothing to identify: it is either open or it is not.
///
/// `"true"` as well as `true`, because a pasted URL arrives as text and a flag
/// that only understood the boolean would silently ignore the link somebody
/// sent.
function flag(value: unknown): true | undefined {
  return value === true || value === "true" ? true : undefined
}

/// One of a fixed set. Anything else is dropped rather than passed on: the
/// value reaches the server as a filter, and `?stage=somewhere` is a 400
/// dressed up as a link.
function oneOf<const T extends readonly string[]>(allowed: T) {
  return (value: unknown): T[number] | undefined =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T[number])
      : undefined
}

/// The key is the query parameter, so it is also what somebody reads in the
/// address bar — `?koli=` and not `?koliId=`.
const SHEET_PARAMS = {
  // ── Intake ───────────────────────────────────────────────────────────────
  /// The delivery document open on the bay.
  receipt: id,
  /// One blind count waiting for a verifier. Named for the decision rather
  /// than for the document, so it does not collide with `count` — the
  /// official stock count, which is a different thing entirely.
  verify: id,
  /// The purchase-order line a checker is counting against.
  line: id,

  // ── Tagging ──────────────────────────────────────────────────────────────
  /// The tagging job whose labels are being printed or confirmed.
  job: id,
  /// The print run. Held in the URL for the same reason as a session: a run is
  /// resumed at a different bench as often as it is finished at the first one.
  run: id,
  /// The printer settings panel — a fact about the bench, not about a record.
  printer: flag,

  // ── Counting ─────────────────────────────────────────────────────────────
  /// The official stock count being read or executed.
  count: id,
  /// One pool of this node's stock.
  pool: id,
  /// One movement in the ledger.
  movement: id,

  // ── Picking ──────────────────────────────────────────────────────────────
  /// **The open pick round.** A handheld that slept mid-pick comes back here.
  pick: id,
  /// The rack stock is being taken off. A choice, not a record — but it is
  /// what every pick on the screen is written against, so it survives a
  /// reload with the round it belongs to.
  rack: id,
  /// An allotment line, for "has this store's stock actually left yet".
  allotment: id,

  // ── Packing ──────────────────────────────────────────────────────────────
  /// **The open packing round.**
  pack: id,
  /// **The open RFID box**: one carton being filled against a fixed target.
  /// Different from `pack` — a box belongs to a round, but a round is a shift
  /// and a box is ten minutes.
  box: id,
  /// One carton, and its manifest.
  koli: id,
  /// Which store a box is being packed for. In the URL because every read on
  /// the fill screen is scoped to it, and because a packer sent to help at
  /// another bench is sent a link.
  store: id,

  // ── Despatch ─────────────────────────────────────────────────────────────
  /// The consignment note.
  shipment: id,
  /// The loading manifest for one truck run.
  dispatch: id,

  // ── Shared ───────────────────────────────────────────────────────────────
  /// Which slice of a carton list is being read. A fixed set, because it
  /// reaches the node as `?ready=true` / `?unassigned=true` and nothing else
  /// is answerable.
  slice: oneOf(["all", "unassigned", "open"] as const),
  /// How far back the ledger is read. Its own key rather than a second meaning
  /// for `slice`: two screens sharing one parameter means arriving from one
  /// with the other's value in the URL, and a ledger that quietly showed 250
  /// rows because somebody had been looking at open cartons is a number nobody
  /// can explain. The node caps at 500, so the set stops there.
  depth: oneOf(["100", "250", "500"] as const),
} as const

export type SheetKey = keyof typeof SHEET_PARAMS

export type SheetSearch = {
  [K in SheetKey]?: ReturnType<(typeof SHEET_PARAMS)[K]>
}

/// The root route's `validateSearch`.
///
/// Unknown keys are dropped rather than preserved: a URL is a public surface,
/// and letting arbitrary parameters ride along means a stale link keeps
/// resurrecting state nothing reads any more.
export function validateSheetSearch(raw: Record<string, unknown>): SheetSearch {
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(SHEET_PARAMS)) {
    const value = check(raw[key])
    if (value !== undefined) out[key] = value
  }
  return out as SheetSearch
}

const rootApi = getRouteApi("__root__")

/// Open, read and close one sheet — or one session.
///
/// `replace: true` on close so dismissing does not leave an entry in the
/// history: pressing back after closing should go to the previous *screen*,
/// not reopen what was just dismissed. Opening does push, because arriving at
/// a record is a place you can go back from.
export function useSheet<K extends SheetKey>(key: K) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as SheetSearch
  const value = search[key]

  return {
    /// The id in the URL, or `undefined`. Feed it straight to `enabled:`.
    value,
    isOpen: value !== undefined,
    open: (next: SheetSearch[K] extends true | undefined ? true : string) =>
      navigate({
        // The screen does not change; only which record is being looked at.
        to: ".",
        search: (prev: SheetSearch) => ({ ...prev, [key]: next }),
      }),
    /// Swap the value without a history entry. What a session does when it is
    /// closed and the next one opened — the round that just ended is not
    /// somewhere `back` should return to.
    replace: (next: SheetSearch[K] extends true | undefined ? true : string) =>
      navigate({
        to: ".",
        replace: true,
        search: (prev: SheetSearch) => ({ ...prev, [key]: next }),
      }),
    close: () =>
      navigate({
        to: ".",
        replace: true,
        search: (prev: SheetSearch) => ({ ...prev, [key]: undefined }),
      }),
  }
}

export { rootApi }
