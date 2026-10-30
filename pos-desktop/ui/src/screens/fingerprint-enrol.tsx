import "@/finger-d.css"

import { useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { cancelFinger, device, enrolPress, installFingerDriver, type ScannerFinger } from "@/edge"
import { isWeb } from "@/edition"
import { Sensor, type Read } from "@/sensor"
import { useSession } from "@/session"
import { sound } from "@/sound"

/// Two things about the fingerprint scanner on this POS.
///
/// **`EnrolFingerScreen` — "Daftarkan sidik jari".** The store head records a
/// finger, and recording it is her approval — a team member's (owner, 24 Oct
/// 2026) and her own (25 Oct 2026); head office can withdraw it. She opens it
/// from the door after signing in with her password (`login.tsx`). The screen
/// lists the team from `GET /api/v1/auth/fingerprints/team`; she picks a person
/// and a finger, the person presses it three times, the shell merges the
/// presses into one template (`src-tauri/src/fingerprint.rs`), and the template
/// goes to `POST /api/v1/auth/fingerprints/submissions`, which answers
/// `APPROVED` and opens the POS at once ("Sidik jari aktif"). The "Menunggu"
/// words below are for a store server from before, which still kept the head's
/// own finger waiting for head office.
///
/// One finger, one person. The shop's roster is read again when a recording
/// starts and handed to the scanner, which refuses a finger that matches
/// anybody already on it on the first press (1:N, off the window's thread); the
/// node refuses the exact same template as a second line of defence
/// (409 "Jari ini sudah terdaftar atas nama X."). A roster that cannot be read
/// stops the recording: without it there is no 1:N check to run.
///
/// **`FingerprintSection` — the scanner itself**, on the Admin's "Till devices"
/// screen: whether it is attached, and the driver installer.

const PRESS_WAIT_MS = 20_000

const SIDES = [
  { code: "LEFT", words: "kiri", row: "Tangan kiri" },
  { code: "RIGHT", words: "kanan", row: "Tangan kanan" },
] as const

const DIGITS = [
  { code: "THUMB", words: "Jempol" },
  { code: "INDEX", words: "Telunjuk" },
  { code: "MIDDLE", words: "Jari tengah" },
  { code: "RING", words: "Jari manis" },
  { code: "LITTLE", words: "Kelingking" },
] as const

/// "Telunjuk kanan" — the node's own words for a finger (`finger_words` in
/// `backend/src/edge/fingerprint.rs`), so a legacy finger that names itself
/// only in words can still be matched to a cell.
const wordsOf = (digit: string, side: string) => `${digit} ${side}`

/// One finger per person, the right thumb (Hari, 30 Oct 2026): picking a
/// person goes straight to recording it, with no finger picker.
const ONLY_FINGER: api.FingerCode = "RIGHT_THUMB"

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2)

const ROLE_WORDS: Readonly<Record<string, string | undefined>> = {
  ADMIN: "Admin",
  SUPERVISOR: "Supervisor",
  CASHIER: "Kasir",
}

type View =
  | { readonly kind: "list" }
  | { readonly kind: "fingers"; readonly username: string }
  | { readonly kind: "capture"; readonly username: string; readonly finger: api.FingerCode }

type Step =
  | { readonly kind: "pressing"; readonly presses: number; readonly needed: number; readonly say: string }
  | { readonly kind: "sending" }
  | { readonly kind: "done"; readonly say: string }
  | { readonly kind: "failed"; readonly say: string }

/// How long the filled sensor stays before the list comes back.
const DONE_MS = 1100

type Scanner = { readonly bound: boolean; readonly detail: string }

export function EnrolFingerScreen({ onBack }: { onBack: () => void }) {
  const session = useSession()
  const self = (session.me?.username ?? "").toLowerCase()
  const [team, setTeam] = useState<readonly api.TeamMember[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [scanner, setScanner] = useState<Scanner | null>(isWeb ? { bound: false, detail: "" } : null)
  const [view, setView] = useState<View>({ kind: "list" })
  const [step, setStep] = useState<Step>({ kind: "sending" })
  const [sent, setSent] = useState<string | null>(null)
  // Bumped per press taken (a ripple) and per press to make again (a shake).
  const [pulse, setPulse] = useState(0)
  const [nudge, setNudge] = useState(0)
  const watch = useRef<string | null>(null)

  async function loadTeam() {
    const reply = await api.fingerTeam()
    if (!reply.ok) {
      setProblem(reply.problem ?? "Daftar tim tidak terbaca dari server toko.")
      return
    }
    setProblem(null)
    // The head herself first, then the node's own order (store heads, cashiers).
    const items = reply.body?.items ?? []
    setTeam([
      ...items.filter((one) => one.username.toLowerCase() === self),
      ...items.filter((one) => one.username.toLowerCase() !== self),
    ])
  }

  async function check() {
    if (isWeb) return
    setScanner(null)
    setScanner(await device("fingerprint_state"))
  }

  useEffect(() => {
    void loadTeam()
    void check()
    // A recording left pressing when the screen closes is called off.
    return () => {
      if (watch.current !== null) void cancelFinger(watch.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const person = (username: string) => team?.find((one) => one.username === username) ?? null

  function stop() {
    if (watch.current !== null) void cancelFinger(watch.current)
    watch.current = null
  }

  /// Leave the current view one step towards the list (Esc, Kembali, Batal).
  function back() {
    if (view.kind === "capture") {
      stop()
      setView({ kind: "list" })
    } else if (view.kind === "fingers") {
      setView({ kind: "list" })
    } else {
      onBack()
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      back()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  async function record(username: string, finger: api.FingerCode) {
    const name = `enrol-${Date.now().toString(36)}`
    watch.current = name
    setSent(null)
    setView({ kind: "capture", username, finger })
    setStep({ kind: "pressing", presses: 0, needed: 3, say: "Tempelkan jari" })
    const fail = (say: string) => {
      sound.no()
      watch.current = null
      setStep({ kind: "failed", say })
    }

    // The roster the POS holds, read now: the 1:N check below is only as good
    // as the list it runs against.
    const held = await api.roster()
    if (watch.current !== name) return
    if (!held.ok) {
      fail(`Daftar sidik jari toko belum terbaca. ${held.problem ?? ""}`.trim())
      return
    }
    const roster = held.body?.items ?? []
    const book: ScannerFinger[] = roster.map((one) => ({
      actor_id: one.finger_id,
      username: one.username,
      template_base64: one.template_base64,
    }))
    const nameOf = (owner: string) =>
      team?.find((one) => one.username === owner)?.display_name ?? owner

    let restart = true
    let presses = 0
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
        fail(press.detail)
        return
      }
      if (!press.placed) {
        fail("Tidak ada jari yang terbaca. Ulangi dari awal.")
        return
      }
      if (press.duplicate_of !== null) {
        // The finger matched somebody already on the roster: never sent.
        const owner = roster.find((one) => one.finger_id === press.duplicate_of)
        fail(
          owner === undefined
            ? "Jari ini sudah terdaftar."
            : owner.username === username
              ? `Jari ini sudah terdaftar untuk ${nameOf(owner.username)} (${owner.label}).`
              : `Jari ini sudah terdaftar atas nama ${nameOf(owner.username)}.`,
        )
        return
      }
      if (press.retry) {
        sound.no()
        setNudge((count) => count + 1)
        setStep({ kind: "pressing", presses, needed: press.needed, say: press.detail })
        continue
      }
      presses = press.presses
      sound.read()
      setPulse((count) => count + 1)
      if (press.template_base64 === null) {
        if (presses >= press.needed) {
          fail(press.detail)
          return
        }
        setStep({ kind: "pressing", presses, needed: press.needed, say: "Angkat, lalu tempelkan lagi" })
        continue
      }
      setStep({ kind: "sending" })
      const submitted = await api.submitFinger({
        username,
        finger,
        template_base64: press.template_base64,
        reader_kind: press.reader_kind,
      })
      watch.current = null
      if (!submitted.ok) {
        fail(submitted.problem ?? "Sidik jari tidak terkirim ke server toko.")
        return
      }
      sound.ok()
      const said =
        submitted.body.status === "APPROVED"
          ? "Sidik jari aktif."
          : "Terkirim ke kantor pusat. Sidik jari bisa dipakai setelah disetujui."
      setStep({ kind: "done", say: said })
      await new Promise((resolve) => window.setTimeout(resolve, DONE_MS))
      if (watch.current !== null && watch.current !== name) return
      setSent(said)
      setView({ kind: "list" })
      void loadTeam()
      return
    }
  }

  const canRecord = scanner !== null && scanner.bound
  const read: Read =
    view.kind !== "capture"
      ? "idle"
      : step.kind === "failed"
        ? "no"
        : step.kind === "sending"
          ? "reading"
          : step.kind === "done"
            ? "done"
            : "idle"
  const progress =
    step.kind === "pressing"
      ? { done: step.presses, needed: step.needed }
      : step.kind === "sending" || step.kind === "done"
        ? { done: 3, needed: 3 }
        : undefined

  let title = "Daftarkan sidik jari"
  let body
  if (view.kind === "capture") {
    const who = person(view.username)
    const digit = DIGITS.find((one) => view.finger.endsWith(`_${one.code}`))
    const side = SIDES.find((one) => view.finger.startsWith(`${one.code}_`))
    title = who?.display_name ?? view.username
    body = (
      <div className="fd-capture" aria-live="polite">
        <p className="fd-which">
          {digit !== undefined && side !== undefined ? wordsOf(digit.words, side.words) : view.finger}
        </p>
        <Sensor state={read} onPress={() => undefined} progress={progress} pulse={pulse} nudge={nudge} />
        {step.kind === "pressing" && (
          <>
            <span className="fd-prog" aria-hidden="true">
              {Array.from({ length: step.needed }, (_, at) => (
                <i key={at} className={at < step.presses ? "on" : ""} />
              ))}
            </span>
            <p className="fd-count">
              {step.presses} dari {step.needed}
            </p>
            <p className="fd-say">{step.say}</p>
          </>
        )}
        {step.kind === "sending" && <p className="fd-say">Mengirim…</p>}
        {step.kind === "done" && <p className="fd-say fd-said">{step.say}</p>}
        {step.kind === "failed" && (
          <>
            <p className="d-err fd-fail" role="alert">
              {step.say}
            </p>
            <button
              className="fd-btn"
              type="button"
              onClick={() => void record(view.username, view.finger)}
            >
              Ulangi
            </button>
          </>
        )}
      </div>
    )
  } else if (view.kind === "fingers") {
    const who = person(view.username)
    title = who?.display_name ?? view.username
    body = (
      <>
        <p className="fd-lead">Pilih jari</p>
        <div className="fd-hands">
          {SIDES.map((side) => (
            <div key={side.code} className="fd-hand">
              <span className="fd-side">{side.row}</span>
              <div className="fd-fingers">
                {DIGITS.map((digit) => {
                  const code = `${side.code}_${digit.code}` as api.FingerCode
                  const words = wordsOf(digit.words, side.words)
                  const taken = who?.fingers.some((one) => one.finger === code || one.label === words) === true
                  const filed = who?.submissions.find((one) => one.finger === code)
                  const cls = taken ? "on" : filed?.status === "PENDING" ? "wait" : filed !== undefined ? "bad" : ""
                  return (
                    <button
                      key={code}
                      type="button"
                      className={`fd-finger ${cls}`}
                      disabled={taken}
                      onClick={() => void record(view.username, code)}
                    >
                      <b>{digit.words}</b>
                      <span>
                        {taken ? "Terdaftar" : filed?.status === "PENDING" ? "Menunggu" : filed !== undefined ? "Ditolak" : ""}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </>
    )
  } else {
    body = (
      <>
        {sent !== null && (
          <p className="fd-note" role="status">
            {sent}
          </p>
        )}
        {scanner !== null && !scanner.bound && (
          <div className="fd-scanner">
            <p>{isWeb ? "Pemindai sidik jari hanya ada di aplikasi kasir." : scanner.detail}</p>
            {!isWeb && (
              <button className="fd-btn" type="button" onClick={() => void check()}>
                Periksa lagi
              </button>
            )}
          </div>
        )}
        {problem !== null && (
          <p className="d-err" role="alert">
            {problem}
          </p>
        )}
        {team === null && problem === null && <p className="fd-lead">Memuat tim…</p>}
        {team !== null && (
          <div className="fd-list">
            {team.map((one) => {
              const pending = one.submissions.filter((entry) => entry.status === "PENDING")
              const refused = one.submissions.filter((entry) => entry.status === "REFUSED")
              const none = one.fingers.length === 0 && pending.length === 0 && refused.length === 0
              const you = one.username.toLowerCase() === self
              return (
                <button
                  key={one.username}
                  type="button"
                  className="fd-row"
                  disabled={!canRecord}
                  onClick={() => {
                    setSent(null)
                    void record(one.username, ONLY_FINGER)
                  }}
                >
                  <span className="av md">{initials(one.display_name)}</span>
                  <span className="fd-who">
                    <b>
                      {one.display_name}
                      {you && <span className="fd-you">Anda</span>}
                    </b>
                    <span className="fd-sub">
                      {ROLE_WORDS[one.role] ?? one.role} · {one.username.toUpperCase()}
                    </span>
                    <span className="fd-chips">
                      {none && <span className="fd-chip">Belum ada sidik jari</span>}
                      {one.fingers.map((entry) => (
                        <span key={entry.finger_id} className="fd-chip ok">
                          {entry.label}
                        </span>
                      ))}
                      {pending.length > 0 && (
                        <span className="fd-chip warn">Menunggu persetujuan kantor pusat</span>
                      )}
                      {refused.map((entry) => (
                        <span key={entry.submission_id} className="fd-chip bad">
                          {entry.reason ? `Ditolak: ${entry.reason}` : "Ditolak"}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="pdoor">
      <div className="fd-card m-lift">
        <div className="fd-head">
          <h1>{title}</h1>
          {view.kind === "capture" && step.kind !== "failed" ? (
            <button className="fd-btn red" type="button" disabled={step.kind === "sending"} onClick={back}>
              Batal
            </button>
          ) : (
            <button className="fd-btn" type="button" onClick={back}>
              Kembali
            </button>
          )}
        </div>
        <div className="fd-body">{body}</div>
      </div>
    </div>
  )
}

/// Whether the scanner is attached, and its driver installer — on the Admin's
/// "Till devices" screen. Recording a finger is `EnrolFingerScreen`'s.
export function FingerprintSection() {
  const [state, setState] = useState<Scanner | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)

  async function check() {
    setState(null)
    setState(await device("fingerprint_state"))
  }

  useEffect(() => {
    void check()
  }, [])

  async function install() {
    setNote(null)
    const problem = await installFingerDriver()
    setNote(
      problem === null
        ? { bad: false, text: "Pemasang driver dibuka. Selesaikan, cabut-pasang pemindai, lalu tekan Periksa." }
        : { bad: true, text: problem },
    )
  }

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
          <button className="btn primary" type="button" onClick={() => void check()}>
            Periksa
          </button>
        </span>
      </div>
      {state !== null && !state.bound && (
        <div>
          <button className="btn primary" type="button" onClick={() => void install()}>
            Pasang driver
          </button>
        </div>
      )}
      {note !== null && (
        <span className={note.bad ? "error" : "muted"} style={{ fontSize: 15 }}>{note.text}</span>
      )}
    </section>
  )
}
