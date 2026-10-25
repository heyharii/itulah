/// The two screens a terminal shows before it is a till.
///
/// # Why they are a pair
///
/// Signing in and being pointed at a node are the same question asked twice.
/// A cashier typing a correct password into a terminal aimed at another shop's
/// machine is refused by that shop's node, in that shop's words, and nothing
/// about the refusal says the address is wrong. So the sign-in card names the
/// node out loud, and the way to the setup screen is in front of the sign-in
/// rather than behind it — a till pointed at the wrong building cannot be
/// repaired through a door it can never open.
///
/// # What is not here
///
/// No "remember me", and no stored password. The shell holds the token and
/// this window holds neither; `session.ts` says why. The password field is
/// cleared the moment the node has answered, whichever way it answered,
/// because a till is a shared machine and the next person to stand at it is
/// not the one who typed.
///
/// # Why the second way in is asked for, not assumed
///
/// A password opens a counter on every node. Beyond that, **the node decides**:
/// one accepts a PIN, another accepts a finger, and one accepts neither. A
/// method the node does not accept is refused *by the node* — so a till drawing
/// both buttons would not be offering a choice, it would be offering a press
/// that gets somebody's name into a refusal log. `authMethods()` is asked once
/// on mount, before anybody has signed in, which is exactly why that endpoint
/// needs no session.

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react"

import { authMethods, me, pairTerminal, tillPeople, type StepUp, type TillPerson } from "@/api"
import { isWeb } from "@/edition"
import { Icon } from "@/icons"
import { siteTitle } from "@/joining"
import { lastSignInProblem, NO_FINGER, useNodeConfig, useSession } from "@/session"
import { useFingerWatch, useScanner } from "@/scanner"
import { EnrolFingerScreen } from "@/screens/fingerprint-enrol"
import { PeripheralsScreen } from "@/screens/peripherals"
import { SIMULATED, SIM_FINGERS, SIM_HEAD, SIM_SECRET, titled } from "@/simulation"
import { sound } from "@/sound"
import { Sensor, type Read } from "@/sensor"
import { kasirLabel, Topbar } from "@/till"

/// The till's door (owner, 23 Oct 2026), drawn as the prototype draws it
/// (pos-classic-prototype.html): a cashier comes in by finger only — "welcome
/// kasir, fingerprint, langsung masuk" — with no password and no menu. When a
/// finger will not do, the Kepala toko opens the till: her finger or her own
/// password, then "Buka kasir atas nama". A cashier's password is refused.
///
/// `onSignedIn` fires once the till is the right person's. While the head is
/// signed in and choosing, the app keeps this screen up (`onHold`), since the
/// session already has somebody in it who is not the one who will sell.
///
/// Two more doors open from her list, both with her session held: "Daftarkan
/// sidik jari" (`fingers`, any Kepala toko — she records, head office approves)
/// and "Perangkat kasir" (`devices`, an Admin's alone). The store only opens
/// and closes its day (owner, 24 Oct 2026); head office does the rest.
type Door = "touch" | "head" | "headpw" | "behalf" | "welcome" | "fingers" | "devices"

const headRole = (role: string | undefined) =>
  (role ?? "ADMIN").toUpperCase() !== "CASHIER"
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((word) => word[0]?.toUpperCase() ?? "").join("").slice(0, 2)
/// The simulated finger nobody enrolled.
const UNKNOWN = "\u0000unknown"
const NO_SCANNER_WEB = "Tidak ada pemindai jari di browser"
const NO_SCANNER = "Pemindai sidik jari tidak terhubung"
const pause = (ms: number) => new Promise((done) => window.setTimeout(done, ms))
const two = (n: number) => String(n).padStart(2, "0")
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

/// The app mark, Matte · Deep, as the prototype and `components/brand-mark.tsx` draw it.
export function Mark() {
  const id = useId().replace(/:/g, "")
  return (
    <svg className="d-mark" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4277e6" /><stop offset="1" stopColor="#1f4fc0" /></linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d3e0fa" /></linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd766" /><stop offset="1" stopColor="#eaa20f" /></linearGradient>
        <filter id={`${id}s`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.8" /></filter>
      </defs>
      <rect width="100" height="100" rx="23.4" fill={`url(#${id}t)`} />
      <ellipse cx="48" cy="84" rx="25" ry="3.4" fill="#0b2466" opacity=".4" filter={`url(#${id}s)`} />
      <path d="M64.32 28.88A28.25 28.25 0 1 0 64.32 68.12A7.25 7.25 0 0 0 53.89 58.05A13.75 13.75 0 1 1 53.89 38.95A7.25 7.25 0 0 0 64.32 28.88Z" fill={`url(#${id}c)`} />
      <circle cx="75.5" cy="48.5" r="8" fill={`url(#${id}d)`} />
    </svg>
  )
}

/// How long a finger's read stays on the sensor at the least, so the beam is
/// seen crossing before the answer (the fill, or the shake).
const READ_AT_LEAST_MS = 650

export function LoginScreen({
  onSignedIn,
  onHold,
  onJoin,
}: {
  onSignedIn: (openedBy: string | null) => void
  /// True while the Kepala toko is signed in and has not handed the till over.
  onHold: (holding: boolean) => void
  /// Offered while this till holds no credential at its node: a new till's
  /// first screen should say how it becomes a till.
  onJoin?: () => void
}) {
  const { ready, problem, signIn, signInWithFinger, signOut, openFor } = useSession()
  const { config } = useNodeConfig()
  const [door, setDoor] = useState<Door>("touch")
  const [read, setRead] = useState<Read>("idle")
  // When the sensor started reading. The scanner matches a finger in a few
  // milliseconds and only then says one was placed, so the read is held for
  // a moment: long enough for the beam to cross and be seen (owner, 25 Oct
  // 2026: "saat buka ga ada animasi").
  const readingSince = useRef(0)
  const [hint, setHint] = useState<string | null>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState<readonly TillPerson[]>([])
  const [pick, setPick] = useState(0)
  const [head, setHead] = useState<string | null>(null)
  // Her role once signed in: only an ADMIN is offered "Perangkat kasir".
  const [level, setLevel] = useState("")
  const [welcome, setWelcome] = useState<{ name: string; by: string | null } | null>(null)
  const [stepUp, setStepUp] = useState<StepUp | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let alive = true
    void (async () => {
      const reply = await authMethods()
      if (alive) setStepUp(reply.ok ? (reply.body?.till_step_up ?? "NONE") : null)
    })()
    const tick = window.setInterval(() => setNow(new Date()), 10_000)
    return () => {
      alive = false
      window.clearInterval(tick)
    }
  }, [])

  // The scanner on this till, when the shell has one open: then a finger on
  // it signs in against the node's roster, and the simulated chips are gone.
  const scanner = useScanner()
  const realScanner = !isWeb && scanner === true
  const byFinger = realScanner || SIMULATED
  const till = config === null ? "Kasir" : kasirLabel(config.terminal_id)
  const site = config?.joined != null ? siteTitle(config.joined) : null
  const where = site !== null ? `${till} · ${site}` : till
  const clock = `${two(now.getHours())}:${two(now.getMinutes())}`

  function go(next: Door) {
    setRead("idle")
    setHint(null)
    setDoor(next)
  }

  /// The person is in: the welcome, then the till.
  function enter(name: string, by: string | null) {
    setWelcome({ name, by })
    setDoor("welcome")
    sound.welcome()
    window.setTimeout(() => {
      onHold(false)
      onSignedIn(by)
    }, 2050)
  }

  /// Whoever is signed in now: a cashier goes in; a Kepala toko is asked
  /// whose till she is opening.
  async function landed(fromHeadDoor: boolean) {
    const who = await me()
    const body = who.ok ? who.body : null
    if (body === null) return
    const name = body.display_name ?? body.username
    if (!headRole(body.role)) {
      if (fromHeadDoor) {
        await signOut()
        onHold(false)
        setRead("no")
        setHint("Hanya kepala toko yang bisa membukakan kasir")
        return
      }
      enter(name, null)
      return
    }
    onHold(true)
    setHead(name)
    setLevel((body.role ?? "").toUpperCase())
    const list = await tillPeople()
    // She is the last row, "saya sendiri"; the node lists her among the
    // people she may open for too.
    const self = body.username.toLowerCase()
    setPeople(list.ok ? (list.body?.items ?? []).filter((one) => one.username.toLowerCase() !== self) : [])
    setPick(0)
    setHint(list.ok ? null : list.problem)
    setRead("idle")
    setDoor("behalf")
  }

  /// How a finger's answer lands: a refusal shakes the sensor red and says
  /// why; a sign-in fills it, then the person goes in.
  async function settle(fromHeadDoor: boolean, refusal: string | null) {
    const left = READ_AT_LEAST_MS - (performance.now() - readingSince.current)
    if (left > 0) await pause(left)
    setBusy(false)
    if (refusal !== null) {
      onHold(false)
      setRead("no")
      sound.no()
      setHint(refusal)
      window.setTimeout(() => setRead((state) => (state === "no" ? "idle" : state)), 1700)
      return
    }
    setRead("done")
    sound.ok()
    await pause(760)
    await landed(fromHeadDoor)
  }

  /// The real scanner: wait for a finger, match it here against the node's
  /// roster, and claim it at the node. A press on the sensor on screen waits
  /// ten seconds for the finger (`watch` absent); the door listening on its
  /// own (`watch`) shows nothing until a finger lands. Answers whether the
  /// door should go on listening.
  async function byScanner(fromHeadDoor: boolean, watch?: string): Promise<boolean> {
    const explicit = watch === undefined
    let placed = false
    const begin = () => {
      placed = true
      setBusy(true)
      setHint(null)
      setRead("reading")
      readingSince.current = performance.now()
      sound.read()
      // Held at the door for either door: the moment the node opens the
      // session the app would otherwise leave for the till, and the finger's
      // answer (the fill, the check, the welcome) would never be seen.
      onHold(true)
    }
    if (explicit) begin()
    const refusal = await signInWithFinger(undefined, {
      watch,
      waitMs: explicit ? 10_000 : 15_000,
      onPlaced: explicit ? undefined : begin,
    })
    if (refusal === NO_FINGER) {
      if (explicit) {
        setBusy(false)
        onHold(false)
        setRead("idle")
        setHint(refusal)
      }
      return true
    }
    if (!placed) {
      // Before any finger: no roster, nothing enrolled, the scanner gone.
      // Said once, quietly, and the door stops listening until it changes.
      setHint(refusal)
      return false
    }
    await settle(fromHeadDoor, refusal)
    return refusal !== null
  }

  // The door listens to the scanner on its own: a cashier lays a finger on it
  // and is in, without touching the screen ("fingerprint, langsung masuk").
  useFingerWatch(
    realScanner && ready && !busy && read !== "done" && (door === "touch" || door === "head"),
    (watch) => byScanner(door === "head", watch),
    door,
  )

  /// A finger on the sensor: the real scanner in the desktop shell, a named
  /// finger on a rig (VITE_SIM_FINGERS), and on the web — which has no
  /// scanner — a refusal that points at the Kepala toko.
  async function press(fromHeadDoor: boolean, simulated?: string) {
    if (busy || read === "reading" || read === "done") return
    if (simulated === undefined && realScanner) {
      await byScanner(fromHeadDoor)
      return
    }
    setBusy(true)
    setHint(null)
    setRead("reading")
    readingSince.current = performance.now()
    sound.read()
    onHold(true)
    let refusal: string | null
    // Simulation (owner, 23 Oct 2026): with no scanner, pressing the sensor
    // counts as a finger placed — the first simulated cashier's at the door,
    // the simulated head's at the head's door.
    if (simulated === undefined && SIMULATED) {
      simulated = fromHeadDoor ? SIM_HEAD : SIM_FINGERS[0]
    }
    if (simulated === UNKNOWN) {
      await pause(980)
      refusal = "Jari tidak dikenali"
    } else if (simulated !== undefined) {
      await pause(980)
      if (await signIn(simulated, SIM_SECRET)) refusal = null
      else {
        // The node's own sentence when it is the day's rule ("… sudah tutup
        // kasir hari ini"), not a generic "Jari tidak dikenali".
        const said = lastSignInProblem()
        refusal = said !== null && /sudah tutup kasir|sedang dipakai/.test(said) ? said : "Jari tidak dikenali"
      }
    } else {
      await pause(980)
      refusal = isWeb ? NO_SCANNER_WEB : NO_SCANNER
    }
    await settle(fromHeadDoor, refusal)
  }

  async function headPassword(event?: FormEvent) {
    event?.preventDefault()
    if (username === "" || password === "") return
    setBusy(true)
    setHint(null)
    onHold(true)
    const accepted = await signIn(username, password)
    setPassword("")
    setBusy(false)
    if (!accepted) {
      onHold(false)
      return
    }
    await landed(true)
  }

  async function behalf(index: number) {
    const person = people[index]
    if (person === undefined) {
      enter(head ?? "", null)
      return
    }
    setBusy(true)
    const refusal = await openFor(person.username)
    setBusy(false)
    if (refusal !== null) {
      setHint(refusal)
      return
    }
    enter(person.display_name, head)
  }

  async function back() {
    setUsername("")
    setPassword("")
    if (door === "behalf") {
      await signOut()
      onHold(false)
      go("touch")
      return
    }
    go(door === "headpw" && byFinger ? "head" : "touch")
  }

  // Keys, for a counter with no mouse: Enter, Esc, ↑↓ and 1–9, K.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (busy || door === "welcome" || door === "fingers" || door === "devices") return
      const inField = (event.target as HTMLElement | null)?.matches?.("input") ?? false
      if (event.key === "Escape" && door !== "touch") {
        event.preventDefault()
        void back()
        return
      }
      if (door === "touch" && !inField && (event.key === "k" || event.key === "K")) {
        event.preventDefault()
        go(byFinger ? "head" : "headpw")
        return
      }
      if ((door === "touch" || door === "head") && event.key === "Enter" && !inField) {
        event.preventDefault()
        void press(door === "head")
        return
      }
      if (door === "behalf") {
        const count = people.length + 1
        if (event.key === "ArrowDown") setPick((at) => (at + 1) % count)
        else if (event.key === "ArrowUp") setPick((at) => (at + count - 1) % count)
        else if (/^[1-9]$/.test(event.key) && Number(event.key) <= count) setPick(Number(event.key) - 1)
        else if (event.key === "Enter") void behalf(pick)
        else return
        event.preventDefault()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Head office stopped this person on the POS (0990): the finger was known,
  // so the sensor does not say it was not.
  const stoppedByHo = hint !== null && hint.includes("dihentikan kantor pusat")
  const say = (who: "cashier" | "head") =>
    read === "reading"
      ? "Membaca…"
      : read === "done"
        ? "Dikenali"
        : read === "no"
          ? stoppedByHo ? "Akses POS dihentikan" : who === "head" ? "Bukan kepala toko" : "Jari tidak dikenali"
          : who === "head" ? "Kepala toko, tempelkan jari" : "Tempelkan jari"
  const rows = [
    ...people.map((one) => ({ name: one.display_name, sub: `${one.role === "SUPERVISOR" ? "Supervisor" : "Kasir"} · ${one.username.toUpperCase()}` })),
    { name: head ?? "", sub: "Kepala toko · saya sendiri" },
  ]
  const picked = rows[pick]?.name.split(" ")[0] ?? ""

  // Her two other screens, full page; the door's own state (who she is, who
  // she may open for) waits here and is exactly as she left it.
  if (door === "fingers") {
    return <EnrolFingerScreen onBack={() => go("behalf")} />
  }
  if (door === "devices" && level === "ADMIN" && !isWeb) {
    return <PeripheralsScreen onBack={() => go("behalf")} />
  }

  let card
  if (door === "welcome" && welcome !== null) {
    card = (
      <div className="d-in">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Mark />
          <p className="d-word">Central<i>.</i></p>
          <p className="d-till">{where}</p>
        </div>
        <div className="w-orb run">
          <span className="w-av">{initials(welcome.name)}</span>
          <span className="w-blue" />
          <svg className="w-check" viewBox="0 0 24 24"><path d="M6.5 12.5l3.8 3.8 7.2-8.3" /></svg>
        </div>
        <p className="d-hello m-rise" style={{ "--i": 2 } as CSSProperties}>Selamat datang,</p>
        <p className="d-name m-rise" style={{ "--i": 3 } as CSSProperties}>{welcome.name}</p>
        <p className="d-meta m-rise" style={{ "--i": 4 } as CSSProperties}>
          {welcome.by !== null && welcome.by !== welcome.name
            ? `Dibukakan ${welcome.by} · Kepala toko`
            : `${HARI[now.getDay()]}, ${now.getDate()} ${BULAN[now.getMonth()]} ${now.getFullYear()} · ${clock}`}
        </p>
        <span className="d-progress run"><i /></span>
      </div>
    )
  } else if (door === "behalf") {
    card = (
      <div className="d-in d-float m-swap" key="behalf">
        <div className="f-who">
          <span className="av md">{initials(head ?? "")}</span>
          <div className="f-who-t"><b>{head}</b><span>{site !== null ? `Kepala toko · ${site}` : "Kepala toko"}</span></div>
          {/* Keluar, not Batal: it signs her out (owner, 25 Oct 2026). */}
          <button className="d-chip" type="button" onClick={() => void back()} disabled={busy}>Keluar<span className="kbd">Esc</span></button>
        </div>
        <p className="f-title">Buka kasir atas nama</p>
        <div className="bh-list" role="listbox" aria-label="Buka kasir atas nama">
          {rows.map((row, index) => (
            <button
              key={`${row.name}-${index}`}
              type="button"
              role="option"
              aria-selected={index === pick}
              className={`bh-row${index === pick ? " on" : ""}`}
              disabled={busy}
              onClick={() => {
                setPick(index)
                void behalf(index)
              }}
            >
              <span className="kbd">{index + 1}</span>
              <span className="av">{initials(row.name)}</span>
              <span className="bh-t"><b>{row.name}</b><span>{row.sub}</span></span>
            </button>
          ))}
        </div>
        {hint !== null && <p className="d-err" style={{ marginTop: 10 }}>{hint}</p>}
        <button className="pd-btn f-open" type="button" disabled={busy} onClick={() => void behalf(pick)}>
          <span>{busy ? "Membuka…" : `Buka untuk ${picked}`}</span>
          <span className="kbd">Enter</span>
        </button>
        <div className="f-tools">
          <button className="pd-btn" type="button" disabled={busy} onClick={() => go("fingers")}>
            Daftarkan sidik jari
          </button>
          {level === "ADMIN" && !isWeb && (
            <button className="pd-btn" type="button" disabled={busy} onClick={() => go("devices")}>
              Perangkat kasir
            </button>
          )}
        </div>
      </div>
    )
  } else if (door === "headpw") {
    card = (
      <form className="d-in m-swap" key="headpw" onSubmit={(event) => void headPassword(event)}>
        <div className="d-headtop">
          <span className="d-ttl">Password kepala toko</span>
          <button className="d-chip" type="button" onClick={() => void back()}>Kembali<span className="kbd">Esc</span></button>
        </div>
        <p className="d-sub">Hanya untuk kepala toko</p>
        <div className="d-pw">
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus autoComplete="off" spellCheck={false} autoCapitalize="characters" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
          </label>
          {(hint ?? problem) !== null && <p className="d-err" role="alert">{hint ?? problem}</p>}
          <button className="pd-btn" type="submit" disabled={busy || !ready || username === "" || password === ""}>
            <span>{busy ? "Memeriksa…" : "Lanjut"}</span>
            <span className="kbd">Enter</span>
          </button>
        </div>
        {byFinger && (
          <div className="d-foot">
            <button className="d-chip" type="button" onClick={() => go("head")}>Pakai jari</button>
          </div>
        )}
      </form>
    )
  } else if (door === "head") {
    card = (
      <div className="d-in m-swap" key="head">
        <div className="d-headtop">
          <span className="d-ttl">Dibukakan kepala toko</span>
          <button className="d-chip" type="button" onClick={() => void back()}>Kembali<span className="kbd">Esc</span></button>
        </div>
        <p className="d-sub">Lalu pilih kasir yang bertugas</p>
        <Sensor state={read} onPress={() => void press(true)} />
        <p className={`d-say${read === "no" ? " bad" : ""}`} aria-live="polite">{say("head")}</p>
        <p className="d-hint">{read === "no" || (hint !== null && realScanner) ? hint : ""}</p>
        <div className="d-foot">
          <button className="d-chip" type="button" onClick={() => go("headpw")}>Pakai password kepala toko</button>
        </div>
      </div>
    )
  } else {
    card = (
      <div className="d-in" key="touch">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Mark />
          <p className="d-word">Central<i>.</i></p>
          <p className="d-till">{where}</p>
        </div>
        <Sensor state={read} onPress={() => void press(false)} />
        <p className={`d-say${read === "no" ? " bad" : ""}`} aria-live="polite">{say("cashier")}</p>
        <p className="d-hint">{read === "no" || (hint !== null && realScanner) ? (stoppedByHo ? "Oleh kantor pusat" : hint === NO_SCANNER_WEB || hint === NO_SCANNER ? `${hint} · minta kepala toko` : hint) : ""}</p>
        <div className="d-foot">
          <button className="d-chip" type="button" disabled={!ready} onClick={() => go(byFinger ? "head" : "headpw")}>
            Dibukakan kepala toko<span className="kbd">K</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pdoor">
      <div className="d-card m-lift">{card}</div>
      <p className="d-status m-lift">
        <span className="live" />
        <span>{stepUp !== null ? "Central online" : "Menghubungkan…"}</span>
        <span className="dot">·</span>
        <span>{where}</span>
        <span className="dot">·</span>
        <span>{clock}</span>
      </p>
      {SIMULATED && !realScanner && (door === "touch" || door === "head") && (
        <div className="d-sims">
          {SIM_FINGERS.map((person: string) => (
            <button key={person} className="ok" type="button" disabled={busy} onClick={() => void press(door === "head", person)}>
              Jari {titled(person)}
              {person === SIM_HEAD ? " · Kepala toko" : ""}
            </button>
          ))}
          <button className="bad" type="button" disabled={busy} onClick={() => void press(door === "head", UNKNOWN)}>
            Jari tak dikenal
          </button>
        </div>
      )}
      {onJoin !== undefined && config !== null && config.pairing_id === null && door === "touch" && (
        <div className="d-sims">
          <button type="button" onClick={onJoin}>Gabungkan kasir ini ke server toko</button>
        </div>
      )}
    </div>
  )
}

/// Where this terminal points, and what it calls itself.
///
/// Two fields, and both of them decide something a cashier cannot see from the
/// sale screen: the address decides whose stock and whose prices this till is
/// selling, and the number is what a receipt is traced back by.
export function SetupScreen({
  onDone,
  onPeripherals,
  onJoin,
}: {
  onDone: () => void
  /// An Admin's alone (`app.tsx` passes it only to one).
  onPeripherals?: () => void
  onJoin?: () => void
}) {
  const { ready, problem: shellProblem } = useSession()
  const { config, save } = useNodeConfig()
  const [baseUrl, setBaseUrl] = useState("")
  const [terminalId, setTerminalId] = useState("")
  const [printerHost, setPrinterHost] = useState("")
  const [printerPort, setPrinterPort] = useState("9100")
  const [paper, setPaper] = useState("NARROW")
  const [pairing, setPairing] = useState<string | null>(null)
  const [pretend, setPretend] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Seeded from the shell rather than left blank, so "change one thing" does
  // not mean "retype both" — and so what is on screen is what is in force.
  useEffect(() => {
    if (config === null) return
    setBaseUrl(config.base_url)
    setTerminalId(config.terminal_id)
    setPretend(config.simulate_fingerprint ?? "")
    setPrinterHost(config.printer_host ?? "")
    setPrinterPort(String(config.printer_port))
    setPaper(config.paper)
  }, [config])

  const moved = config !== null && baseUrl.trim() !== config.base_url.trim()

  async function commit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const refusal = await save({
      base_url: baseUrl,
      terminal_id: terminalId,
      printer_host: printerHost.trim() === "" ? null : printerHost,
      printer_port: Number(printerPort) || 9100,
      paper,
      pairing_id: config?.pairing_id ?? null,
      pairing_secret: null,
      simulate_fingerprint: pretend.trim() === "" ? null : pretend.trim(),
    })
    setBusy(false)
    setProblem(refusal)
    if (refusal === null) onDone()
  }

  return (
    <div id="app" data-screen="sale">
      <Topbar />
      <main className="page">
        <form
          className="page-inner"
          style={{ maxWidth: 560 }}
          onSubmit={(event) => void commit(event)}
        >
          <div className="page-head">
            <div>
              <h1>Terminal settings</h1>
            </div>
            <button className="btn ghost" type="button" onClick={onDone}>
              <Icon name="back" />
              Back
            </button>
          </div>

          {/* A web till can only ever reach the origin it was served from —
              `webSetConfig` in `web.ts` does not even take a different one —
              so there is nothing here to type. The address is said out loud
              instead, the same way the sign-in card says it. */}
          {isWeb ? (
            <div className="field">
              Store node address
              <p
                className="num"
                style={{ margin: "7px 0 0", fontSize: 14, color: "#303b4c" }}
              >
                {config?.base_url ?? ""}
              </p>
            </div>
          ) : (
            <label className="field">
              Store node address
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://192.168.1.20:8082"
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
              />
            </label>
          )}

          <label className="field">
            Terminal number
            <input
              value={terminalId}
              onChange={(event) => setTerminalId(event.target.value)}
              placeholder="POS-01"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          {/* The printer is addressed as the NODE will reach it, not as this
              machine would. The node does the printing because it is the party
              on the printer's LAN — so a printer only this terminal can see is
              a printer no receipt will ever come out of. */}
          <label className="field">
            Receipt printer address
            <input
              value={printerHost}
              onChange={(event) => setPrinterHost(event.target.value)}
              placeholder="192.168.1.50 — leave empty for no printer"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              Printer port
              <input
                value={printerPort}
                onChange={(event) =>
                  setPrinterPort(event.target.value.replace(/\D/g, ""))
                }
                inputMode="numeric"
                placeholder="9100"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Paper width
              <select
                value={paper}
                onChange={(event) => setPaper(event.target.value)}
              >
                <option value="NARROW">NARROW — 58 mm</option>
                <option value="WIDE">WIDE — 80 mm</option>
              </select>
            </label>
          </div>

          {/* The rest of what hangs off this counter — the shopper's screen,
              the desk reader, the drawer, a printer the node has recorded —
              is set on its own screen and reported to the node. */}
          {onPeripherals !== undefined && (
            <div className="kv">
              <span className="muted">Devices on this till</span>
              <button className="btn" type="button" onClick={onPeripherals}>
                <Icon name="plug" />
                Set up devices
              </button>
            </div>
          )}

          {/* Joining is how a till gets its standing now: it finds the node,
              asks, and head office says yes in Central after comparing the code
              and the number on both screens. The key is minted in the shell and
              never reaches this page. */}
          {onJoin !== undefined && (
            <div className="kv">
              <span className="muted">Till on the store node</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {config?.joined != null ? (
                  <span className="badge ok">
                    {config.joined.label} · {siteTitle(config.joined)}
                  </span>
                ) : config?.pairing_id != null ? (
                  <span className="badge ok">Paired</span>
                ) : (
                  <span className="badge plain">Not joined</span>
                )}
                <button className="btn" type="button" onClick={onJoin}>
                  <Icon name="plug" />
                  {config?.pairing_id != null ? "Join again" : "Join the node"}
                </button>
              </span>
            </div>
          )}

          {/* Pairing is what lets this machine speak in its own name — ask the
              node for the fingerprint roster, and say whose finger matched. It
              is deliberately a separate act from signing in: pairing grants a
              MACHINE standing, which is why the node asks for an admin to do it
              and writes down who did.

              The secret is handed over once and never again. It goes to the
              shell, not to this page. Kept beside joining for a node that
              predates it, and for an admin who is already signed in here.

              None of this exists in web: the pairing secret behind a
              fingerprint or a PIN lives in the shell's config file, which a
              browser tab has no equivalent of — see `web.ts`. */}
          {!isWeb && (
            <>
              <div className="kv">
                <span className="muted">Old pairing (admin account)</span>
                {config?.pairing_id != null ? (
                  <span className="badge ok">
                    Paired · <span className="num">{config.pairing_id}</span>
                  </span>
                ) : (
                  <span className="badge plain">Not yet</span>
                )}
              </div>
              <div>
                <div>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      void (async () => {
                        setPairing("Asking the node for credentials…")
                        const reply = await pairTerminal(terminalId || "POS")
                        if (!reply.ok) {
                          setPairing(reply.problem)
                          return
                        }
                        const paired = reply.body
                        const saved = await save({
                          base_url: baseUrl,
                          terminal_id: terminalId,
                          printer_host:
                            printerHost.trim() === "" ? null : printerHost,
                          printer_port: Number(printerPort) || 9100,
                          paper,
                          pairing_id: paired?.terminal_id ?? null,
                          pairing_secret: paired?.secret ?? null,
                        })
                        setPairing(
                          saved ?? "Terminal paired.",
                        )
                      })()
                    }}
                  >
                    {config?.pairing_id != null
                      ? "Pair again"
                      : "Pair this terminal"}
                  </button>
                </div>
                {pairing !== null && (
                  <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                    {pairing}
                  </p>
                )}
              </div>
            </>
          )}

          {/* A machine with no scanner can still be walked through the whole
              thing: the roster coming down, the claim being signed, the grant
              being spent once and expiring. Only a development build reads
              this — a release has no code to read it with — and every answer it
              produces says SIMULASI in the words the cashier sees, because a
              screen that cannot tell a rehearsal from the real thing is how a
              rehearsal reaches a customer. Web has no fingerprint scanner to
              rehearse against, so it is never drawn there either. */}
          {!isWeb && (
            <label className="field">
              Fingerprint simulation (development build)
              <input
                value={pretend}
                onChange={(event) => setPretend(event.target.value)}
                placeholder="Username — leave empty for the real scanner"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}

          {moved && (
            <div className="notice warn">
              The node address changed — the terminal will sign out and need to sign in again.
            </div>
          )}

          {ready && config === null && shellProblem !== null && (
            <p className="error">{shellProblem}</p>
          )}
          {problem !== null && <p className="error">{problem}</p>}

          <div className="action-bar">
            <button className="btn" type="button" onClick={onDone}>
              Cancel
            </button>
            <button
              className="btn primary"
              type="submit"
              style={{ flex: 1 }}
              disabled={busy || !ready}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
