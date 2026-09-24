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
import { PinPad } from "@/pinpad"
import { useNodeConfig, useSession } from "@/session"

/// Sign in on this terminal.
///
/// `onSignedIn` fires only when the node accepted — the session store is the
/// one that knows, and this screen does not decide it. `onSetup` opens the
/// setup screen, and is reachable without signing in on purpose.
export function LoginScreen({
  onSignedIn,
  onSetup,
}: {
  onSignedIn: () => void
  onSetup: () => void
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
  const [methods, setMethods] = useState<string | null>(null)
  const [pin, setPin] = useState("")
  const [pinNote, setPinNote] = useState<string | null>(null)

  // Asked once, on mount, unauthenticated — a till has to know what it may
  // offer before anybody stands at it.
  //
  // While the answer is outstanding, `stepUp` is null and neither button is
  // drawn. That is deliberate: a button that appears and then vanishes is worse
  // than one that arrives late, because the one that vanished was pressed.
  //
  // A node that would not answer has said nothing, not `NONE`, and the two are
  // held apart — both draw no button, and the notice below says which happened,
  // because only one of them is fixed by looking at the node.
  useEffect(() => {
    let alive = true
    void (async () => {
      const reply = await authMethods()
      if (!alive) return
      if (!reply.ok) {
        setStepUp(null)
        setMethods(reply.problem)
        return
      }
      // A node that answered without naming a method accepts no step-up. It
      // said so; this is not a guess standing in for silence.
      setStepUp(reply.body?.till_step_up ?? "NONE")
      setMethods(null)
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

  /// Open the counter with a PIN. Same shape as the finger: the node's own
  /// refusal comes back, or null when the counter is open.
  async function enterWithPin() {
    setBusy(true)
    setPinNote(null)
    const refusal = await signInWithPin(username, pin)
    setBusy(false)
    // Emptied whichever way the node answered, on the same rule as the password
    // above — a refusal is precisely the moment somebody walks away from the
    // counter to go and ask, leaving the marks on the screen behind them.
    setPin("")
    setPinNote(refusal)
    if (refusal === null) onSignedIn()
  }

  return (
    <div id="app" data-screen="sale">
      <div className="overlay">
        <form className="overlay-card" onSubmit={(event) => void enter(event)}>
          <span className="brand">
            <span className="brand-mark">i.</span>itulah{" "}
            <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
              kasir
            </span>
          </span>
          <h3>Masuk untuk membuka konter</h3>

          <label className="field" style={{ width: "100%", textAlign: "left" }}>
            Nama pengguna
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
              // A counter is shared. Nobody's name should be waiting in the
              // field when the next shift walks up to it.
              autoComplete="off"
              aria-label="Nama pengguna"
            />
          </label>

          <label className="field" style={{ width: "100%", textAlign: "left" }}>
            Kata sandi
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              aria-label="Kata sandi"
            />
          </label>

          {problem !== null && (
            <p className="error" style={{ width: "100%", textAlign: "left" }}>
              {problem}
            </p>
          )}

          <button
            className="btn primary"
            style={{ width: "100%" }}
            type="submit"
            disabled={busy || !ready || username === "" || password === ""}
          >
            {busy ? "Memeriksa…" : !ready ? "Membaca setelan…" : "Masuk"}
          </button>

          {/* ── the second way in, as far as the node allows one ─────────── */}

          {/* Only when the node said PIN. A PIN is the STAGING method and the
              notice says so out loud, where the cashier is standing: a till that
              cannot tell a rehearsal from the real thing is how a rehearsal
              reaches a customer, and the shape of this screen is the only clue
              anybody at the counter gets.

              The username is the field above rather than a second one of its
              own. Two name boxes on one card is two chances to type the name
              into the one that is not being sent, and the node checks the same
              name either way. */}
          {stepUp === "PIN" && (
            <div style={{ width: "100%", textAlign: "left" }}>
              <span className="label">Masuk dengan PIN</span>
              <div className="notice warn" style={{ marginTop: 8 }}>
                <strong>PIN hanya diterima node latihan (staging).</strong> Node
                produksi menolak PIN dan meminta sidik jari. Jadi kalau pad ini
                muncul, terminal ini sedang bicara dengan node latihan — apa pun
                yang dijual di sini bukan penjualan sungguhan, dan strukmu bukan
                struk pelanggan. Kata sandi tetap berlaku di node mana pun.
              </div>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                PIN dipakai bersama nama pengguna di kolom paling atas.
              </p>
              <PinPad
                value={pin}
                onChange={setPin}
                onSubmit={() => void enterWithPin()}
                disabled={busy || !ready || username === ""}
              />
              <button
                className="btn"
                style={{ width: "100%", marginTop: 8 }}
                type="button"
                disabled={busy || !ready || username === "" || pin === ""}
                onClick={() => void enterWithPin()}
              >
                {busy ? "Memeriksa…" : "Masuk dengan PIN"}
              </button>
              {pinNote !== null && (
                <p className="error" style={{ marginTop: 6 }}>
                  {pinNote}
                </p>
              )}
            </div>
          )}

          {/* The counter signs in with a finger far more often than with a
              keyboard — `pos-electron` does it this way and this counter will
              too. The button is here now, and it tells the truth about why it
              cannot work yet, because the alternative is a till that looks like
              it supports fingerprints and silently does nothing when pressed.

              Two things are missing, and they are different problems: this
              shell has no driver bound yet (`src-tauri/src/device.rs`), and the
              terminal must be paired with the node before it may speak in its
              own name. Matching happens HERE, against templates the node hands
              down, so a counter can still be opened when head office is
              unreachable — and the pairing secret is what stops any other
              machine on the shop wifi from claiming to be a supervisor.

              Drawn only when the node said FINGERPRINT. It is the production
              method, and on a node that takes PINs instead the press would be
              refused there — with the refusal arriving in the words of a
              fingerprint failure, which is a sentence about a scanner for a node
              that never wanted one. */}
          {stepUp === "FINGERPRINT" && (
            <>
              <button
                className="btn"
                style={{ width: "100%" }}
                type="button"
                disabled={busy || !ready}
                onClick={() => {
                  void (async () => {
                    setFinger("Letakkan jari pada pemindai…")
                    // The refusal shown is whichever came first — this shell
                    // having no scanner bound, the node having nobody enrolled,
                    // or the finger simply not matching. They are different
                    // problems and the cashier is told which one, because only
                    // one of them is fixed by pressing again.
                    const refusal = await signInWithFinger()
                    setFinger(refusal)
                    if (refusal === null) onSignedIn()
                  })()
                }}
              >
                Masuk dengan sidik jari
              </button>
              {finger !== null && (
                <p
                  className="muted"
                  style={{ fontSize: 11.5, textAlign: "left" }}
                >
                  {finger}
                </p>
              )}
            </>
          )}

          {/* Three states, three different sentences, and none of them is a
              button. `NONE` is the node's answer and is final; a null `stepUp`
              with a refusal attached is a node that would not answer, which is
              worth reading because the address above may be the reason; and a
              null with no refusal is simply an answer still on its way. */}
          {stepUp === "NONE" && (
            <div className="notice" style={{ width: "100%", textAlign: "left" }}>
              Node ini hanya menerima kata sandi. Tidak ada PIN dan tidak ada
              sidik jari di sini — bukan disembunyikan oleh terminal, memang
              ditolak oleh node-nya.
            </div>
          )}
          {stepUp === null && methods !== null && (
            <div
              className="notice warn"
              style={{ width: "100%", textAlign: "left" }}
            >
              Node belum menyebut cara masuk selain kata sandi, jadi PIN dan
              sidik jari tidak ditawarkan di layar ini. Kata sandi tetap bisa
              dipakai. Kata node: {methods}
            </div>
          )}
          {stepUp === null && methods === null && (
            <p
              className="muted"
              style={{ fontSize: 11.5, width: "100%", textAlign: "left" }}
            >
              Menanyakan ke node cara masuk apa yang diterima di sini…
            </p>
          )}

          <div className="notice" style={{ width: "100%", textAlign: "left" }}>
            {config === null ? (
              <>
                Terminal ini belum tahu node mana yang harus ditanya, jadi nama
                dan sandi yang benar pun tidak akan sampai ke mana-mana.
              </>
            ) : (
              <>
                Terminal <strong>{config.terminal_id}</strong> menanyakan semua
                hal ke node{" "}
                <strong className="num">{config.base_url}</strong>. Kalau itu
                bukan toko tempat Anda berdiri, sandi yang benar pun akan
                ditolak — dan penolakannya datang dengan kata-kata toko lain.
              </>
            )}
          </div>

          <button
            className="btn ghost"
            style={{ width: "100%" }}
            type="button"
            onClick={onSetup}
          >
            Setelan terminal — arahkan ke node lain
          </button>
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
export function SetupScreen({ onDone }: { onDone: () => void }) {
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
      <main className="page">
        <form
          className="page-inner"
          style={{ maxWidth: 560 }}
          onSubmit={(event) => void commit(event)}
        >
          <div className="page-head">
            <div>
              <h1>Setelan terminal</h1>
              <p>
                Mengganti alamat node berarti mengarahkan kasir ini ke toko
                lain: stok, harga, promo, nomor struk dan sesi kasnya ikut
                pindah ke node itu. Ubah hanya kalau memang mesin ini dipindah.
              </p>
            </div>
            <button className="btn ghost" type="button" onClick={onDone}>
              Tutup
            </button>
          </div>

          <label className="field">
            Alamat node toko
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://192.168.1.20:8082"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
          </label>

          <label className="field">
            Nomor terminal
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
            Printer struk — alamat yang dijangkau node
            <input
              value={printerHost}
              onChange={(event) => setPrinterHost(event.target.value)}
              placeholder="192.168.1.50 — kosongkan kalau konter ini tanpa printer"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              Port printer
              <input
                value={printerPort}
                onChange={(event) => setPrinterPort(event.target.value)}
                inputMode="numeric"
                placeholder="9100"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Lebar kertas
              <select
                value={paper}
                onChange={(event) => setPaper(event.target.value)}
              >
                <option value="NARROW">NARROW — 58 mm</option>
                <option value="WIDE">WIDE — 80 mm</option>
              </select>
            </label>
          </div>

          {/* Pairing is what lets this machine speak in its own name — ask the
              node for the fingerprint roster, and say whose finger matched. It
              is deliberately a separate act from signing in: pairing grants a
              MACHINE standing, which is why the node asks for an admin to do it
              and writes down who did.

              The secret is handed over once and never again. It goes to the
              shell, not to this page. */}
          <div className="notice">
            {config?.pairing_id != null ? (
              <>
                Terminal ini sudah dipasangkan dengan node (
                <span className="num">{config.pairing_id}</span>), jadi sidik
                jari bisa dipakai untuk masuk dan untuk otorisasi supervisor.
              </>
            ) : (
              <>
                Terminal ini belum dipasangkan. Sampai dipasangkan, sidik jari
                tidak bisa dipakai — node tidak punya cara memastikan klaimnya
                datang dari mesin ini.
              </>
            )}
            <div style={{ marginTop: 8 }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void (async () => {
                    setPairing("Meminta kredensial ke node…")
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
                      saved ??
                        "Terminal dipasangkan. Kredensialnya disimpan di mesin ini dan tidak ditampilkan lagi.",
                    )
                  })()
                }}
              >
                {config?.pairing_id != null
                  ? "Pasangkan ulang"
                  : "Pasangkan terminal ini"}
              </button>
            </div>
            {pairing !== null && (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                {pairing}
              </p>
            )}
          </div>

          {/* A machine with no scanner can still be walked through the whole
              thing: the roster coming down, the claim being signed, the grant
              being spent once and expiring. Only a development build reads
              this — a release has no code to read it with — and every answer it
              produces says SIMULASI in the words the cashier sees, because a
              screen that cannot tell a rehearsal from the real thing is how a
              rehearsal reaches a customer. */}
          <label className="field">
            Simulasikan sidik jari milik (hanya build pengembangan)
            <input
              value={pretend}
              onChange={(event) => setPretend(event.target.value)}
              placeholder="Kosongkan kalau memakai pemindai sungguhan"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          {moved && (
            <div className="notice warn">
              Alamat node berubah. Sesi yang sekarang diterbitkan oleh node yang
              lama dan tidak berlaku di node yang baru, jadi menyimpan ini
              sekaligus mengeluarkan terminal dari sesi — masuk lagi setelahnya.
            </div>
          )}

          {ready && config === null && shellProblem !== null && (
            <p className="error">{shellProblem}</p>
          )}
          {problem !== null && <p className="error">{problem}</p>}

          <div className="notice">
            Setelan ini disimpan oleh aplikasi kasir di mesin ini, jadi terminal
            tetap mengingat tokonya setelah ditutup dan dibuka lagi. Mengganti
            alamat node berarti mengarahkan till ini ke toko lain, dan sesi yang
            sedang berjalan ikut diputus.
          </div>

          <div className="action-bar">
            <button className="btn" type="button" onClick={onDone}>
              Batal
            </button>
            <button
              className="btn primary"
              type="submit"
              style={{ flex: 1 }}
              disabled={busy || !ready}
            >
              {busy ? "Menyimpan…" : "Simpan setelan terminal"}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
