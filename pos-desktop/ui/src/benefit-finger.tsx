/// Diskon karyawan: the employee who shops lays a finger on the till's scanner
/// (client, 24 Oct 2026). The same card the Kepala toko's yes uses — title,
/// sensor, one line of what it read, Batal — saying whose balance it is; the
/// cashier then types how much of it pays.
///
/// What the finger is worth is the node's decision, never this card's: see
/// `benefitByFinger`.

import { useEffect, useRef, useState } from "react"
import { money } from "@itulah/contract/money"

import { benefitByFinger, benefitSaid, type BenefitHolder } from "@/benefit"
import { useFingerWatch, useScanner } from "@/scanner"
import { Sensor, type Read } from "@/sensor"
import { SIMULATED, SIM_FINGERS, titled } from "@/simulation"
import { sound } from "@/sound"

const UNKNOWN_FINGER = "\u0000unknown"

/// How long the matched name stays on the card before it closes by itself.
const SHOWN_MS = 900

export function EmployeeFinger({
  actorId,
  currency,
  onFound,
  onUnknown,
  onFingerless,
  onClose,
}: {
  /// The signed-in cashier: their own finger is refused.
  actorId: string
  currency: string
  /// The node granted the finger and head office read the balance.
  onFound: (found: { readonly holder: BenefitHolder; readonly grant: string }) => void
  /// A finger nobody at this shop enrolled — an employee of another shop, whose
  /// phone's code is the way in.
  onUnknown: () => void
  /// This till cannot take a finger at all: no scanner bound, a terminal not
  /// paired, a node from before fingers.
  onFingerless: () => void
  onClose: () => void
}) {
  const realScanner = useScanner() === true
  const [read, setRead] = useState<Read>("idle")
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    card.current?.focus()
    return () => {
      alive.current = false
    }
  }, [])

  function refused(text: string) {
    setRead("no")
    sound.no()
    setProblem(text)
    window.setTimeout(() => {
      if (alive.current) setRead((state) => (state === "no" ? "idle" : state))
    }, 1700)
  }

  /// One finger: with `watch` the card listening on its own (answers whether
  /// to go on listening), without it a press on the sensor or a rig's
  /// simulated finger (`person`).
  async function attempt(watch?: string, person?: string): Promise<boolean> {
    const explicit = watch === undefined
    const begin = () => {
      setBusy(true)
      setRead("reading")
      setProblem(null)
      sound.read()
    }
    if (explicit) begin()
    // Never left on "Membaca…": past the wait for a finger and the node's and
    // head office's answers, the card says so (owner, 25 Oct 2026).
    let placed = explicit
    const answered = benefitByFinger(actorId, {
      watch,
      waitMs: explicit ? 10_000 : 15_000,
      onPlaced: () => {
        placed = true
        if (!explicit) begin()
      },
      person,
    })
    const got = await new Promise<Awaited<typeof answered>>((done) => {
      const timer = window.setInterval(() => {
        if (alive.current && Date.now() - startedAt > (placed ? 30_000 : 40_000)) {
          window.clearInterval(timer)
          done({ kind: "refused", reply: { ok: false, status: 504, problem: null, body: undefined } } as never)
        }
      }, 1000)
      const startedAt = Date.now()
      void answered.then((value) => {
        window.clearInterval(timer)
        done(value)
      })
    })
    if (!alive.current) return false
    if (got.kind === "none") {
      if (explicit) {
        setBusy(false)
        setRead("idle")
        setProblem("Tidak ada jari yang terbaca")
      }
      return true
    }
    setBusy(false)
    if (got.kind === "no-finger") {
      onFingerless()
      return false
    }
    if (got.kind === "unknown") {
      onUnknown()
      refused("Jari tidak dikenali")
      return true
    }
    if (got.kind === "own") {
      refused("Saldo diskon sendiri dilayani kasir lain")
      return true
    }
    if (got.kind === "refused") {
      const reply = got.reply
      refused(
        reply.status === 0 || reply.status === 502 || reply.status === 503 || reply.status === 504
          ? "Kantor pusat tidak terjangkau — pakai cara bayar lain."
          : (benefitSaid(reply.problem) ?? "Saldo tidak bisa dibuka."),
      )
      return true
    }
    const name = got.holder.full_name ?? got.holder.employee_code
    setRead("done")
    sound.ok()
    setSaid(`${name} · saldo ${money(got.holder.balance_minor, currency).replace(/\s/g, " ")}`)
    window.setTimeout(() => {
      if (alive.current) onFound({ holder: got.holder, grant: got.grant })
    }, SHOWN_MS)
    return false
  }

  // The card listens to the scanner on its own: the employee lays a finger.
  useFingerWatch(realScanner && !busy && read !== "done", (watch) => attempt(watch))

  async function press(person?: string) {
    if (busy || read === "reading" || read === "done") return
    // With a real scanner the card is already listening (`useFingerWatch`);
    // a second wait on the same scanner would hold both (owner, 25 Oct 2026:
    // "membaca hang"). The finger on the glass is enough.
    if (person === undefined) return
    await attempt(undefined, person)
  }

  // The key that opened this card (a Space or a digit) is still on its way up
  // to the window when the card mounts: it must not press the sensor.
  const openedAt = useRef(performance.now())
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.timeStamp <= openedAt.current) return
      if (event.key === "Escape") {
        event.preventDefault()
        if (read !== "done") onClose()
      } else if (event.key === "Enter") {
        event.preventDefault()
        void press()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const say =
    read === "reading"
      ? "Membaca…"
      : read === "done"
        ? (said ?? "")
        : read === "no"
          ? (problem ?? "Jari tidak dikenali")
          : "Tempelkan jari"

  return (
    <div
      ref={card}
      tabIndex={-1}
      style={{ outline: "none" }}
      className="pdoor papr"
      role="dialog"
      aria-modal="true"
      aria-label="Jari karyawan"
    >
      <div className="sup">
        <p className="d-ttl">Diskon karyawan</p>
        <p className="d-sub" style={{ textAlign: "center" }}>
          Karyawan yang belanja menempelkan jari
        </p>
        <Sensor state={read} onPress={() => void press()} small />
        <p
          className={`d-say${read === "no" ? " bad" : ""}`}
          style={read === "done" ? { color: "#1d7a32" } : undefined}
          aria-live="polite"
        >
          {say}
        </p>
        <p className="d-hint">{read === "idle" && problem !== null ? problem : ""}</p>
        <div className="sup-foot">
          <button className="d-chip" type="button" onClick={onClose} disabled={busy || read === "done"}>
            Batal<span className="kbd">Esc</span>
          </button>
        </div>
      </div>
      {SIMULATED && !realScanner && (
        <div className="d-sims">
          {SIM_FINGERS.map((person: string) => (
            <button key={person} className="ok" type="button" disabled={busy} onClick={() => void press(person)}>
              Jari {titled(person)}
            </button>
          ))}
          <button className="bad" type="button" disabled={busy} onClick={() => void press(UNKNOWN_FINGER)}>
            Jari tak dikenal
          </button>
        </div>
      )}
    </div>
  )
}
