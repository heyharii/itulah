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

import { useEffect, useState, type FormEvent } from "react"

import { authMethods, pairTerminal, type StepUp } from "@/api"
import { isWeb } from "@/edition"
import { Icon } from "@/icons"
import { siteTitle, useWaitingTills } from "@/joining"
import { PinPad } from "@/pinpad"
import { SIMULATED, SIM_FINGERS, SIM_SECRET, titled } from "@/simulation"
import { useNodeConfig, useSession } from "@/session"
import { Brand, kasirLabel, Topbar } from "@/till"

/// Sign in on this terminal — with a finger.
///
/// `onSignedIn` fires only when the node accepted — the session store is the
/// one that knows, and this screen does not decide it. A password and a PIN are
/// still here, but only as the way in when no finger can be used on this till:
/// no scanner, and nothing simulated. The settings screen is not reachable from
/// here for now.
export function LoginScreen({
  onSignedIn,
  onJoin,
}: {
  onSignedIn: () => void
  /// Offered while this till holds no credential at its node: a new till's
  /// first screen should say how it becomes a till.
  onJoin?: () => void
}) {
  const { ready, problem, signIn, signInWithFinger, signInWithPin } =
    useSession()
  const { config } = useNodeConfig()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [finger, setFinger] = useState<string | null>(null)
  /// Which second way in this node accepts. Null means **not answered yet** —
  /// which is not the same as `NONE`, and is drawn the same way on purpose: see
  /// the effect below.
  const [stepUp, setStepUp] = useState<StepUp | null>(null)
  const [mode, setMode] = useState<"password" | "pin">("password")
  const [pin, setPin] = useState("")
  const [pinNote, setPinNote] = useState<string | null>(null)

  // Asked once, on mount, unauthenticated — a till has to know what it may
  // offer before anybody stands at it. While the answer is outstanding,
  // `stepUp` is null and no button is drawn: a button that appears and then
  // vanishes is worse than one that arrives late, because the one that vanished
  // was pressed.
  useEffect(() => {
    let alive = true
    void (async () => {
      const reply = await authMethods()
      if (!alive) return
      if (!reply.ok) {
        setStepUp(null)
        return
      }
      setStepUp(reply.body?.till_step_up ?? "NONE")
    })()
    return () => {
      alive = false
    }
  }, [])

  async function enter(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const accepted = await signIn(username, password)
    setBusy(false)
    // Dropped as soon as the node has answered, refusal included. A password
    // left sitting in a field is a password the next cashier at this counter
    // can submit.
    setPassword("")
    if (accepted) onSignedIn()
  }

  async function enterWithPin() {
    setBusy(true)
    setPinNote(null)
    const refusal = await signInWithPin(username, pin)
    setBusy(false)
    setPin("")
    setPinNote(refusal)
    if (refusal === null) onSignedIn()
  }

  /// The real scanner, in the desktop shell.
  async function scan() {
    setBusy(true)
    setFinger("Place your finger on the scanner…")
    const refusal = await signInWithFinger()
    setBusy(false)
    setFinger(refusal)
    if (refusal === null) onSignedIn()
  }

  /// A finger placed on the simulated scanner: a beat of "reading", then the
  /// node is asked as that person.
  async function touch(person: string) {
    setBusy(true)
    setFinger("Reading fingerprint…")
    await new Promise((done) => window.setTimeout(done, 700))
    const accepted = await signIn(person, SIM_SECRET)
    setBusy(false)
    if (accepted) {
      setFinger(null)
      onSignedIn()
    } else {
      setFinger("Fingerprint not recognised.")
    }
  }

  const realScanner = !isWeb && stepUp === "FINGERPRINT"
  const byFinger = realScanner || SIMULATED
  const usePin = !byFinger && stepUp === "PIN" && mode === "pin"
  const till = config === null ? null : kasirLabel(config.terminal_id)

  return (
    <div id="app" data-screen="sale">
      <div className="overlay">
        <form
          className="overlay-card login-card"
          onSubmit={(event) => {
            if (byFinger) {
              event.preventDefault()
              return
            }
            if (usePin) {
              event.preventDefault()
              void enterWithPin()
            } else void enter(event)
          }}
        >
          <Brand />
          <h3>{till ?? "Sign in"}</h3>

          {byFinger ? (
            <>
              <button
                className="btn primary lg"
                type="button"
                style={{
                  width: 132,
                  height: 132,
                  borderRadius: "50%",
                  alignSelf: "center",
                  flexDirection: "column",
                  gap: 8,
                }}
                disabled={busy || !ready || (!realScanner && true)}
                onClick={realScanner ? () => void scan() : undefined}
                aria-label="Fingerprint scanner"
              >
                <Icon name="finger" />
                {busy ? "Reading…" : "Touch to sign in"}
              </button>
              {SIMULATED && !realScanner && (
                <div style={{ width: "100%", textAlign: "left" }}>
                  <span className="label">Simulated fingerprint — whose finger?</span>
                  <div className="rows" style={{ marginTop: 8 }}>
                    {SIM_FINGERS.map((person: string) => (
                      <button
                        key={person}
                        className="btn lg"
                        type="button"
                        disabled={busy || !ready}
                        onClick={() => void touch(person)}
                      >
                        <Icon name="finger" />
                        {titled(person)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(finger !== null || problem !== null) && (
                <p
                  className={finger === null ? "error" : "muted"}
                  style={{ fontSize: 13, textAlign: "left", width: "100%" }}
                >
                  {finger ?? problem}
                </p>
              )}
            </>
          ) : (
            <>
              {/* A PIN is claimed over the pairing channel (`claimPin` →
                  `signedEdge`), which only the desktop shell can sign, so the
                  web till never draws the tab that would switch to it. */}
              {!isWeb && stepUp === "PIN" && (
                <div className="segmented" style={{ width: "100%" }}>
                  <button
                    type="button"
                    aria-pressed={!usePin}
                    onClick={() => setMode("password")}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    aria-pressed={usePin}
                    onClick={() => setMode("pin")}
                  >
                    PIN
                  </button>
                </div>
              )}

              <label className="field" style={{ width: "100%", textAlign: "left" }}>
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoFocus
                  // A counter is shared. Nobody's name should be waiting in the
                  // field when the next shift walks up to it.
                  autoComplete="off"
                  aria-label="Username"
                />
              </label>

              {usePin ? (
                <div style={{ width: "100%" }}>
                  <PinPad
                    value={pin}
                    onChange={setPin}
                    onSubmit={() => void enterWithPin()}
                    disabled={busy || !ready}
                  />
                  {pinNote !== null && (
                    <p className="error" style={{ marginTop: 8, textAlign: "left" }}>
                      {pinNote}
                    </p>
                  )}
                </div>
              ) : (
                <label className="field" style={{ width: "100%", textAlign: "left" }}>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="off"
                    aria-label="Password"
                  />
                </label>
              )}

              {!usePin && problem !== null && (
                <p className="error" style={{ width: "100%", textAlign: "left" }}>
                  {problem}
                </p>
              )}

              <button
                className="btn primary lg"
                style={{ width: "100%" }}
                type="submit"
                disabled={
                  busy ||
                  !ready ||
                  username === "" ||
                  (usePin ? pin === "" : password === "")
                }
              >
                {busy ? "Checking…" : !ready ? "Reading settings…" : "Sign in"}
              </button>
            </>
          )}

          {onJoin !== undefined && config !== null && config.pairing_id === null && (
            <div className="notice" style={{ width: "100%", textAlign: "left" }}>
              This till has not joined the store server yet.{" "}
              <button
                className="btn ghost"
                type="button"
                style={{ minHeight: 26, padding: "0 6px" }}
                onClick={onJoin}
              >
                <Icon name="plug" />
                Join
              </button>
            </div>
          )}
        </form>
      </div>
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
  onJoins,
}: {
  onDone: () => void
  onPeripherals?: () => void
  onJoin?: () => void
  /// The tills waiting to join this shop. Only offered to somebody signed in:
  /// the list is the node's, and approving needs a supervisor at this till.
  onJoins?: () => void
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
  // Tills asking to join, counted beside the button that lets them in. Asked
  // only when that button is here — signed in, on a till the node knows.
  const waiting = useWaitingTills(
    onJoins !== undefined &&
      config?.pairing_id !== null &&
      config?.pairing_id !== undefined,
  )

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
              asks, and a supervisor says yes after comparing the code and the
              number on both screens. The key is minted in the shell and never
              reaches this page. */}
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

          {/* A new till is let in from a till that already belongs: the
              supervisor's finger or PIN is pressed here, on a machine the node
              trusts to say whose it was. */}
          {onJoins !== undefined && (
            <div className="kv">
              <span className="muted">New tills asking to join</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {waiting !== null && waiting > 0 && (
                  <span className="badge warn">{waiting} waiting</span>
                )}
                <button className="btn" type="button" onClick={onJoins}>
                  <Icon name="list" />
                  Waiting tills
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
