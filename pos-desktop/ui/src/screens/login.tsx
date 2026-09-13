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

import { useEffect, useState, type FormEvent } from "react"

import { identifyFinger } from "@/edge"
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
  const { ready, problem, signIn } = useSession()
  const { config } = useNodeConfig()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [finger, setFinger] = useState<string | null>(null)

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

          {/* The counter signs in with a finger far more often than with a
              keyboard — `pos-electron` does it this way and this counter will
              too. The button is here now, and it tells the truth about why it
              cannot work yet, because the alternative is a till that looks like
              it supports fingerprints and silently does nothing when pressed.

              Two things are missing, and they are different problems: this
              shell has no driver bound yet (`src-tauri/src/device.rs`), and the
              node has nowhere to keep an enrolled finger — `/api/v1/auth/*` is
              login · logout · me · change-password, and none of them take one.
              Matching is meant to happen HERE, against templates the node hands
              down, so a counter can still be opened when the line is down. */}
          <button
            className="btn"
            style={{ width: "100%" }}
            type="button"
            onClick={() => {
              void (async () => {
                // No enrolled fingers to match against: the node has no place
                // to keep one yet. Asked anyway, so the answer on screen is the
                // shell's own and not this screen's guess about it.
                const seen = await identifyFinger([])
                setFinger(
                  seen.actor_id !== null
                    ? `Dikenali sebagai ${seen.actor_id}.`
                    : seen.detail,
                )
              })()
            }}
          >
            Masuk dengan sidik jari
          </button>
          {finger !== null && (
            <p className="muted" style={{ fontSize: 11.5, textAlign: "left" }}>
              {finger}
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
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Seeded from the shell rather than left blank, so "change one thing" does
  // not mean "retype both" — and so what is on screen is what is in force.
  useEffect(() => {
    if (config === null) return
    setBaseUrl(config.base_url)
    setTerminalId(config.terminal_id)
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
              placeholder="http://192.168.1.20:8081"
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
