import { ChevronDown, ChevronLeft, X } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import "./rp.css"

import { useLayout } from "@/lib/layout"
import type { ReachableUnit } from "@/lib/queries/people"
import type { UnitView } from "@itulah/contract"

/// What the roster, attendance and payroll pages share: the dates they count
/// in, the colours a shift wears, the frame that holds the toast and the sheet,
/// and the strip of stores along the top. Ported from `roster-prototype.html`.

// ── dates ───────────────────────────────────────────────────────────────────
// A roster date is a calendar day, never an instant: everything here is done in
// UTC and only ever exchanges `YYYY-MM-DD` with the server.

export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

export function addDays(iso: string, n: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}
export const dnum = (iso: string) => Number(iso.slice(8, 10))
export const dlabel = (iso: string) => `${dnum(iso)} ${MON[Number(iso.slice(5, 7)) - 1]}`
export const weekLabel = (monday: string) => `${dlabel(monday)} – ${dlabel(addDays(monday, 6))}`
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))
export const weekdayIndex = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
export const mondayOfIso = (iso: string) => addDays(iso, -weekdayIndex(iso))
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
export const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
export function todayIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10)
}

export const fmtH = (hours: number) =>
  `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`

// ── shift colours ───────────────────────────────────────────────────────────
// A shift has no colour on the server. It wears one from this ring by its place
// in the list, and a picked colour is kept in this browser.

export const SHIFT_COLORS = [
  "#ee8b2e",
  "#4a82f0",
  "#8a6cf0",
  "#46a06a",
  "#d65b95",
  "#1f9fb4",
  "#b7791f",
] as const

const COLOR_KEY = "rp.shift-colour."
export function savedColour(id: string): string | null {
  try {
    return window.localStorage.getItem(COLOR_KEY + id)
  } catch {
    return null
  }
}
export function saveColour(id: string, colour: string): void {
  try {
    window.localStorage.setItem(COLOR_KEY + id, colour)
  } catch {
    // A colour that is not kept is the ring's own next time.
  }
}
export function colourOf(id: string, index: number): string {
  return savedColour(id) ?? SHIFT_COLORS[index % SHIFT_COLORS.length]
}

// ── the frame: a toast with an Undo ────────────────────────────────────────

interface Toast {
  readonly text: string
  readonly undo?: () => void
  readonly seq: number
}

interface RpApi {
  /// A line at the foot of the page; `undo` puts an Undo button on it.
  readonly toast: (text: string, undo?: () => void) => void
}

const RpContext = createContext<RpApi | null>(null)
export function useRp(): RpApi {
  const api = useContext(RpContext)
  if (api === null) throw new Error("useRp outside <RpFrame>")
  return api
}

export function RpFrame({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const [toastOn, setToastOn] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const seq = useRef(0)

  const say = useCallback((text: string, undo?: () => void) => {
    seq.current += 1
    setToast({ text, undo, seq: seq.current })
    setToastOn(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToastOn(false), 4000)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const api = useMemo<RpApi>(() => ({ toast: say }), [say])

  return (
    <RpContext.Provider value={api}>
      <div className="rp">
        {children}
        <div className={`toast${toastOn ? "" : " off"}`} role="status">
          <span>{toast?.text}</span>
          {toast?.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.()
                setToastOn(false)
              }}
            >
              Undo
            </button>
          )}
        </div>
      </div>
    </RpContext.Provider>
  )
}

/// The one sheet a page has: slides in from the right over a dimmed page. The
/// page owns what is inside it and says when it is open.
export function RpSheet({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      // Off-screen for a beat, then in: that is the slide. (A timer, not a
      // frame: a hidden tab holds its frames back and the sheet would never come.)
      const id = window.setTimeout(() => setShown(true), 30)
      return () => window.clearTimeout(id)
    }
    setShown(false)
    const id = window.setTimeout(() => setMounted(false), 220)
    return () => window.clearTimeout(id)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])
  return (
    <>
      <div
        className={`scrim${shown ? "" : " off"}`}
        hidden={!mounted}
        onPointerDown={onClose}
      />
      <aside
        className={`sheet${shown ? "" : " off closing"}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!mounted}
      >
        {mounted ? children : null}
      </aside>
    </>
  )
}

/// The head of a sheet: a title, an optional line under it, and a way out.
export function SheetHead({
  title,
  sub,
  back,
  onClose,
}: {
  title: ReactNode
  sub?: ReactNode
  back?: () => void
  onClose: () => void
}) {
  return (
    <div className="shead">
      {back && (
        <button className="icbtn" type="button" aria-label="Back" onClick={back}>
          <ChevronLeft className="lucide" />
        </button>
      )}
      {sub ? (
        <div className="who2" style={{ flex: 1 }}>
          <h2>{title}</h2>
          <span className="r num">{sub}</span>
        </div>
      ) : (
        <h2>{title}</h2>
      )}
      <button className="icbtn" type="button" aria-label="Close" onClick={onClose}>
        <X className="lucide" />
      </button>
    </div>
  )
}

// ── the stores along the top ────────────────────────────────────────────────

export interface StoreTile {
  readonly id: string
  readonly code: string
  readonly name: string
}

/// The unit's own code (`C001`, `HO`) from the register, falling back to what
/// the reach called it.
export function storeTiles(
  reach: readonly ReachableUnit[],
  register: readonly UnitView[] | undefined
): StoreTile[] {
  const codes = new Map((register ?? []).map((unit) => [unit.id, unit.code]))
  return reach.map((unit) => ({
    id: unit.id,
    code: codes.get(unit.id) ?? unit.id.toUpperCase(),
    name: unit.name,
  }))
}

/// Every store at once on a desk; on a phone, the open one as a row that
/// unfolds them.
export function StoresStrip({
  tiles,
  value,
  onChange,
}: {
  tiles: readonly StoreTile[]
  value: string | null
  onChange: (id: string) => void
}) {
  const phone = useLayout() === "phone"
  const [open, setOpen] = useState(false)
  if (tiles.length < 2) return null
  const here = tiles.find((tile) => tile.id === value) ?? tiles[0]
  return (
    <>
      {phone && (
        <button
          type="button"
          className="storepick"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="who2">
            <span className="r num">{here.code}</span>
            <span className="n">{here.name}</span>
          </span>
          <ChevronDown className="lucide" />
        </button>
      )}
      <div className={`stores${open ? " open" : ""}`}>
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className="scard"
            aria-pressed={tile.id === value}
            title={tile.name}
            onClick={() => {
              onChange(tile.id)
              setOpen(false)
            }}
          >
            <span className="sc num">{tile.code}</span>
            <span className="sn">{tile.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}
