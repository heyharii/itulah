import "@/stopped-d.css"

import { useCallback, useEffect, useState } from "react"

import { tillStanding, type TillStanding } from "@/api"
import { isWeb } from "@/edition"
import { siteTitle } from "@/joining"
import { Mark } from "@/screens/login"
import { shellCall, useNodeConfig } from "@/session"
import { kasirLabel } from "@/till"

/// What head office has stopped, shown on the till's door (postgres 0990; the
/// client's review of 23 Oct 2026; `ho-stop-access-prototype.html`).
///
/// Head office alone stops or removes a till, stops a whole store, or removes
/// a store that closed for good. The node knows it, and says so to anybody who
/// asks (`GET /api/v1/till/standing`, open like `authMethods`): this till asks
/// every half minute, signed in or not. While something is stopped, the door
/// below is all the till shows. The node refuses the sale and the shift
/// anyway; this is so nobody stands at a till wondering why.
///
/// One rule, as at the node: stopped means no selling and no new shift, and a
/// drawer already open can still be counted and closed. A stopped store's door
/// offers "Tutup kasir" for the drawer at this till. A stopped till cannot
/// sign anybody in by finger (the node refuses its signature), so its drawer
/// is closed from another till, where the gate already offers it.
///
/// Removed: the till lets go of its hold on the installer (`till_hold`,
/// `src-tauri/src/uninstall.rs`) and offers "Uninstall POS". Until then the
/// installer refuses to remove a till that is still its store's.

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const two = (n: number) => String(n).padStart(2, "0")

/// `24 Okt 14:05`, in this machine's clock.
function when(iso: string | null | undefined): string | null {
  if (iso == null) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return `${at.getDate()} ${BULAN[at.getMonth()]} ${two(at.getHours())}:${two(at.getMinutes())}`
}

/// Ask the node what is stopped, now and every half minute. A node that does
/// not answer leaves the last answer standing — and before any answer, nothing
/// is stopped: a wifi blip must not close a till that was selling.
///
/// On the desktop till it also holds or lets go of the installer: held while
/// this machine is a till of its store, let go once head office removed it.
export function useStanding(terminalId: string): {
  readonly standing: TillStanding | null
  readonly refresh: () => void
} {
  const [standing, setStanding] = useState<TillStanding | null>(null)
  const { config } = useNodeConfig()
  const joined = !isWeb && config !== null && config.pairing_id !== null

  const refresh = useCallback(() => {
    void tillStanding(terminalId).then((reply) => {
      if (reply.ok && reply.body !== null) setStanding(reply.body)
    })
  }, [terminalId])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const removed = standing !== null && isRemoved(standing)
  useEffect(() => {
    if (!joined) return
    void shellCall<null>("till_hold", { held: !removed })
  }, [joined, removed])

  return { standing, refresh }
}

function isRemoved(standing: TillStanding): boolean {
  return standing.till?.status === "REVOKED" || standing.store?.removed_at != null
}

/// Whether the door must be shown instead of the till.
export function isStopped(standing: TillStanding | null): boolean {
  return standing !== null && (standing.store !== null || standing.till !== null)
}

const PAUSE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M9.5 8v8M14.5 8v8" />
  </svg>
)
const GONE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M8 8l8 8M16 8l-8 8" />
  </svg>
)

/// The door of a stopped or removed till.
export function StoppedScreen({
  standing,
  terminalId,
  onCloseShift,
}: {
  standing: TillStanding
  terminalId: string
  /// "Tutup kasir": count and close the drawer still open at this till. Only
  /// offered for a stopped store, whose tills still sign people in.
  onCloseShift: () => void
}) {
  const { config } = useNodeConfig()
  const [now, setNow] = useState(() => new Date())
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(tick)
  }, [])

  const till = config === null ? kasirLabel(terminalId) : kasirLabel(config.terminal_id)
  const site = config?.joined != null ? siteTitle(config.joined) : null
  const where = site !== null ? `${till} · ${site}` : till
  const label = standing.till?.label ?? till

  const { store } = standing
  const storeRemoved = store?.removed_at != null
  const tillRemoved = standing.till?.status === "REVOKED"
  const removed = storeRemoved || tillRemoved
  const shift = standing.open_shift
  // Only a stopped store may close its drawer here: a stopped till cannot
  // sign anybody in.
  const closeHere = !removed && store !== null && shift !== null

  const title = storeRemoved
    ? "Toko sudah dihapus"
    : tillRemoved
      ? `${label} sudah dihapus`
      : store !== null
        ? "Toko dihentikan"
        : `${label} dihentikan`
  const at = storeRemoved
    ? when(store?.removed_at)
    : tillRemoved || store === null
      ? when(standing.till?.at)
      : when(store.at)
  const reason = removed ? null : (store?.reason ?? standing.till?.reason ?? null)

  async function uninstall() {
    const reply = await shellCall<null>("open_uninstall")
    setProblem(reply.ok ? null : reply.problem)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter") return
      event.preventDefault()
      if (closeHere) onCloseShift()
      else if (removed && !isWeb) void uninstall()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <div className="pdoor">
      <div className="d-card m-lift">
        <div className="d-in">
          <Mark />
          <p className="d-word">Central<i>.</i></p>
          <p className="d-till">{where}</p>
          <div className={`st-orb${removed ? " gone" : ""}`}>{removed ? GONE : PAUSE}</div>
          <p className="d-say">{title}</p>
          <p className="d-hint">{at !== null ? `Kantor pusat · ${at}` : "Kantor pusat"}</p>
          {reason !== null && reason.trim() !== "" && <p className="st-why">{reason}</p>}
          <div className="st-foot">
            {closeHere && shift !== null && (
              <>
                <p>Shift {shift.name} masih terbuka</p>
                <button className="pd-btn" type="button" onClick={onCloseShift}>
                  Tutup kasir <span className="kbd">Enter</span>
                </button>
              </>
            )}
            {!closeHere && !removed && shift !== null && (
              <p>Shift {shift.name} masih terbuka · tutup di kasir lain</p>
            )}
            {removed && !isWeb && (
              <>
                {problem !== null && <p className="d-err">{problem}</p>}
                <button className="pd-btn" type="button" onClick={() => void uninstall()}>
                  Uninstall POS <span className="kbd">Enter</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <p className="d-status m-lift">
        <span className="live" />
        <span>Central online</span>
        <span className="dot">·</span>
        <span>{where}</span>
        <span className="dot">·</span>
        <span>
          {two(now.getHours())}:{two(now.getMinutes())}
        </span>
      </p>
    </div>
  )
}
