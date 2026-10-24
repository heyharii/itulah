/// Till devices → Sidik jari: the scanner on this till, and enrolling a
/// person's finger at the counter.
///
/// # Who may enrol
///
/// The Kepala toko, signed in at this till: a cashier's finger or her own
/// (`enrol_fingerprint` in `backend/src/edge/http.rs`; an admin enrols
/// anybody). Pick the person, pick the finger, press it three times; the shell
/// merges the three presses into one template (`src-tauri/src/fingerprint.rs`)
/// and the template goes to the node, which is the only place an enrolment
/// lives — so a finger enrolled here opens every till in the shop.
///
/// A finger already enrolled to anybody is refused on its first press: the
/// shop's roster is handed to the scanner when the enrolment starts.

import { useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { cancelFinger, device, enrolPress, installFingerDriver, type ScannerFinger } from "@/edge"
import { useSession } from "@/session"
import { sound } from "@/sound"

const FINGERS = [
  "Telunjuk kanan",
  "Jempol kanan",
  "Jari tengah kanan",
  "Telunjuk kiri",
  "Jempol kiri",
  "Jari tengah kiri",
] as const

/// One press waits this long for the finger.
const PRESS_WAIT_MS = 20_000

type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "pressing"; readonly presses: number; readonly needed: number; readonly say: string }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly say: string }
  | { readonly kind: "failed"; readonly say: string }

export function FingerprintSection() {
  const session = useSession()
  const [state, setState] = useState<{ bound: boolean; detail: string } | null>(null)
  const [people, setPeople] = useState<readonly api.TillPerson[]>([])
  const [roster, setRoster] = useState<readonly api.RosterEntry[] | null>(null)
  const [rosterProblem, setRosterProblem] = useState<string | null>(null)
  const [who, setWho] = useState("")
  const [finger, setFinger] = useState<string>(FINGERS[0])
  const [step, setStep] = useState<Step>({ kind: "idle" })
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  const watch = useRef<string | null>(null)

  const role = (session.me?.role ?? "").toUpperCase()
  const head = session.me !== null && role !== "" && role !== "CASHIER"
  const self = session.me?.username ?? ""

  async function check() {
    setState(null)
    const answer = await device("fingerprint_state")
    setState(answer)
  }

  async function loadRoster() {
    const reply = await api.roster()
    if (!reply.ok) {
      setRoster(null)
      setRosterProblem(reply.problem)
      return
    }
    setRosterProblem(null)
    setRoster(reply.body?.items ?? [])
  }

  useEffect(() => {
    void check()
    void loadRoster()
    // An enrolment left pressing when the screen closes is called off.
    return () => {
      if (watch.current !== null) void cancelFinger(watch.current)
    }
  }, [])

  useEffect(() => {
    if (!head) return
    void api.tillPeople().then((reply) => {
      if (!reply.ok) return
      const listed = reply.body?.items ?? []
      // An admin may enrol anybody; a store head a cashier or herself.
      const allowed = listed.filter(
        (one) => role === "ADMIN" || one.role === "CASHIER" || one.username === self,
      )
      const mine = allowed.some((one) => one.username === self)
      const all =
        mine || self === ""
          ? allowed
          : [
              {
                username: self,
                display_name: session.me?.display_name ?? self,
                role,
              },
              ...allowed,
            ]
      setPeople(all)
      setWho((current) => (current === "" ? (all[0]?.username ?? "") : current))
    })
  }, [head, role, self])

  const enrolledOf = (username: string) =>
    (roster ?? []).filter((one) => one.username === username)
  const nameOf = (username: string) =>
    people.find((one) => one.username === username)?.display_name ?? username

  async function install() {
    setNote(null)
    const problem = await installFingerDriver()
    setNote(
      problem === null
        ? { bad: false, text: "Pemasang driver dibuka. Selesaikan, cabut-pasang pemindai, lalu tekan Periksa." }
        : { bad: true, text: problem },
    )
  }

  async function enrol() {
    if (who === "" || step.kind === "pressing" || step.kind === "saving") return
    setNote(null)
    const name = `enrol-${Date.now().toString(36)}`
    watch.current = name
    const book: ScannerFinger[] = (roster ?? []).map((one) => ({
      actor_id: one.finger_id,
      username: one.username,
      template_base64: one.template_base64,
    }))
    let restart = true
    let presses = 0
    setStep({ kind: "pressing", presses: 0, needed: 3, say: "Tempelkan jari" })
    for (;;) {
      const press = await enrolPress({
        restart,
        enrolled: restart ? book : undefined,
        waitMs: PRESS_WAIT_MS,
        watch: name,
      })
      restart = false
      if (watch.current !== name) return
      if (!press.bound) {
        sound.no()
        setStep({ kind: "failed", say: press.detail })
        return
      }
      if (!press.placed) {
        setStep({ kind: "failed", say: "Tidak ada jari yang terbaca. Ulangi dari awal." })
        return
      }
      if (press.duplicate_of !== null) {
        sound.no()
        const owner = (roster ?? []).find((one) => one.finger_id === press.duplicate_of)
        setStep({
          kind: "failed",
          say:
            owner !== undefined
              ? `Jari ini sudah terdaftar untuk ${nameOf(owner.username)} (${owner.label}).`
              : "Jari ini sudah terdaftar.",
        })
        return
      }
      if (press.retry) {
        sound.no()
        setStep({ kind: "pressing", presses, needed: press.needed, say: press.detail })
        continue
      }
      presses = press.presses
      sound.read()
      if (press.template_base64 === null) {
        if (presses >= press.needed) {
          setStep({ kind: "failed", say: press.detail })
          return
        }
        setStep({
          kind: "pressing",
          presses,
          needed: press.needed,
          say: `Angkat, lalu tempelkan lagi`,
        })
        continue
      }
      setStep({ kind: "saving" })
      const saved = await api.enrolFinger({
        username: who,
        label: finger,
        template_base64: press.template_base64,
        reader_kind: press.reader_kind,
      })
      watch.current = null
      if (!saved.ok) {
        sound.no()
        setStep({ kind: "failed", say: saved.problem ?? "Sidik jari tidak tersimpan di server toko." })
        return
      }
      sound.ok()
      setStep({ kind: "saved", say: `${finger} ${nameOf(who)} tersimpan` })
      void loadRoster()
      return
    }
  }

  function stop() {
    if (watch.current !== null) void cancelFinger(watch.current)
    watch.current = null
    setStep({ kind: "idle" })
  }

  const pressing = step.kind === "pressing" || step.kind === "saving"
  const mine = enrolledOf(who)

  return (
    <section className="rows">
      <span className="label">Sidik jari</span>
      <div className="kv">
        <span className="muted" style={{ fontSize: 15 }}>
          {state === null ? "Memeriksa pemindai…" : state.detail}
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={state === null ? "badge plain" : state.bound ? "badge ok" : "badge warn"}>
            {state === null ? "…" : state.bound ? "Siap" : "Tidak terhubung"}
          </span>
          <button className="btn ghost" type="button" disabled={pressing} onClick={() => void check()}>
            Periksa
          </button>
        </span>
      </div>
      {state !== null && !state.bound && (
        <div>
          <button className="btn" type="button" onClick={() => void install()}>
            Pasang driver
          </button>
        </div>
      )}

      {!head ? (
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>
          Masuk sebagai kepala toko untuk mendaftarkan jari.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              Karyawan
              <select value={who} disabled={pressing} onChange={(event) => { setWho(event.target.value); setStep({ kind: "idle" }) }}>
                {people.map((one) => (
                  <option key={one.username} value={one.username}>
                    {one.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              Jari
              <select value={finger} disabled={pressing} onChange={(event) => { setFinger(event.target.value); setStep({ kind: "idle" }) }}>
                {FINGERS.map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {who !== "" && roster !== null && (
            <span className="muted" style={{ fontSize: 15 }}>
              {mine.length === 0
                ? "Belum ada jari terdaftar"
                : `Terdaftar: ${mine.map((one) => one.label).join(", ")}`}
            </span>
          )}
          {rosterProblem !== null && (
            <span className="error" style={{ fontSize: 15 }}>{rosterProblem}</span>
          )}

          {step.kind === "pressing" && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }} aria-live="polite">
              <span style={{ display: "flex", gap: 6 }} aria-hidden="true">
                {Array.from({ length: step.needed }, (_, at) => (
                  <span
                    key={at}
                    style={{
                      width: 28,
                      height: 8,
                      borderRadius: 4,
                      background: at < step.presses ? "#2862dc" : "#dcdce1",
                      transition: "background-color 200ms ease",
                    }}
                  />
                ))}
              </span>
              <b style={{ fontSize: 17 }}>
                {step.presses} dari {step.needed}
              </b>
              <span className="muted" style={{ fontSize: 15 }}>{step.say}</span>
            </div>
          )}
          {step.kind === "saving" && <span className="muted" style={{ fontSize: 15 }}>Menyimpan…</span>}
          {(step.kind === "saved" || step.kind === "failed") && (
            <span className={step.kind === "failed" ? "error" : "muted"} style={{ fontSize: 15 }} aria-live="polite">
              {step.say}
            </span>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {pressing ? (
              <button className="btn" type="button" disabled={step.kind === "saving"} onClick={stop}>
                Batal
              </button>
            ) : (
              <button
                className="btn primary"
                type="button"
                disabled={who === "" || state === null || !state.bound}
                onClick={() => void enrol()}
              >
                {step.kind === "failed" ? "Ulangi" : "Daftarkan jari"}
              </button>
            )}
          </div>
        </>
      )}
      {note !== null && (
        <span className={note.bad ? "error" : "muted"} style={{ fontSize: 15 }}>{note.text}</span>
      )}
    </section>
  )
}
