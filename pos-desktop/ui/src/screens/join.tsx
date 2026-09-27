/// A till joins its shop's node.
///
/// # What a person sees
///
/// 1. **Cari node** — the till listens on the LAN for a few seconds and lists
///    every node that answered *and* confirmed who it is. An address can
///    always be typed instead, and is checked the same way.
/// 2. **Minta bergabung** — the till asks, and shows a six-character code and
///    a six-digit number.
/// 3. **Menunggu** — a supervisor opens *Kasir menunggu* on a till that has
///    already joined, finds this code, checks the number matches this screen,
///    and approves with a finger or a PIN. This screen asks the node every few
///    seconds whether that has happened.
/// 4. **Tergabung** — the till is "Kasir N" at this shop.
///
/// # Why the number matters more than the code
///
/// The code is a handle, shown on both screens so the supervisor picks the
/// right row. The number is what makes approving safe: the node derives it
/// from the code *and* the digest of the key this till minted, so a request
/// made by some other machine on the shop's wifi shows a different number.
/// The copy on screen says to compare it, in those words.
///
/// # A supervisor at this till
///
/// A shop's first till has no joined till to press a finger on. So a
/// supervisor may sign in here instead, on the node being joined, and approve
/// on the spot — the node accepts that for the first till, or from an Admin.
/// It is also where a replacement is named: "this till replaces Kasir 2" keeps
/// the name, and the old till is revoked.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"

import { Icon } from "@/icons"
import {
  approveHere,
  beginJoin,
  cancelJoin,
  currentJoin,
  discoverNodes,
  identifyNode,
  pollJoin,
  refusedBecause,
  siteTitle,
  spaced,
  supervisorLeave,
  supervisorSignIn,
  timeLeft,
  type FoundNode,
  type JoinView,
  type SupervisorHere,
} from "@/joining"
import { refreshFromShell, useNodeConfig } from "@/session"
import { Topbar } from "@/till"

type Stage =
  | { readonly kind: "loading" }
  | { readonly kind: "find" }
  | { readonly kind: "confirm"; readonly node: FoundNode }
  | { readonly kind: "waiting"; readonly view: JoinView }
  | { readonly kind: "approved"; readonly view: JoinView }
  | { readonly kind: "refused"; readonly view: JoinView }

/// Often enough that a supervisor who just pressed their finger sees this
/// screen change before they have turned round; rarely enough that five
/// waiting tills are not a load on anybody's node.
const POLL_MS = 3000

export function JoinScreen({
  onDone,
  onPeripherals,
}: {
  onDone: () => void
  onPeripherals: () => void
}) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" })

  // A request left waiting when the app closed is picked up where it was:
  // same code, same number, same row in the supervisor's list.
  useEffect(() => {
    let alive = true
    void (async () => {
      const held = await currentJoin()
      if (!alive) return
      setStage(
        held.ok && held.value !== null
          ? { kind: "waiting", view: held.value }
          : { kind: "find" },
      )
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div id="app" data-screen="sale">
      <Topbar />
      <main className="page">
        <div className="page-inner" style={{ maxWidth: 620 }}>
          <div className="page-head">
            <div>
              <h1>Gabungkan kasir ke node toko</h1>
              <p>
                Kasir ini meminta bergabung, supervisor toko menyetujui. Tidak
                ada alamat atau kata sandi yang perlu diketik di sini.
              </p>
            </div>
            {/* Leaving while waiting keeps the request: it is picked up again,
                same code, the next time this screen opens. */}
            {(stage.kind === "find" ||
              stage.kind === "loading" ||
              stage.kind === "waiting") && (
              <button className="btn ghost" type="button" onClick={onDone}>
                <Icon name="back" />
                Kembali
              </button>
            )}
          </div>

          <div className="steps">
            <span className={stage.kind === "find" || stage.kind === "loading" ? "active" : ""}>
              1 · Cari node
            </span>
            <span className={stage.kind === "confirm" ? "active" : ""}>
              2 · Minta bergabung
            </span>
            <span className={stage.kind === "waiting" ? "active" : ""}>
              3 · Persetujuan supervisor
            </span>
            <span className={stage.kind === "approved" ? "active" : ""}>
              4 · Tergabung
            </span>
          </div>

          {stage.kind === "loading" && <p className="muted">Memeriksa…</p>}

          {stage.kind === "find" && (
            <FindNode onPick={(node) => setStage({ kind: "confirm", node })} />
          )}

          {stage.kind === "confirm" && (
            <ConfirmNode
              node={stage.node}
              onBack={() => setStage({ kind: "find" })}
              onAsked={(view) => setStage({ kind: "waiting", view })}
            />
          )}

          {stage.kind === "waiting" && (
            <Waiting
              first={stage.view}
              onApproved={(view) => setStage({ kind: "approved", view })}
              onRefused={(view) => setStage({ kind: "refused", view })}
              onCancelled={() => setStage({ kind: "find" })}
            />
          )}

          {stage.kind === "approved" && (
            <Approved
              view={stage.view}
              onPeripherals={onPeripherals}
              onDone={onDone}
            />
          )}

          {stage.kind === "refused" && (
            <Refused
              view={stage.view}
              onAgain={(view) => setStage({ kind: "waiting", view })}
              onFind={() => setStage({ kind: "find" })}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ── 1. finding the node ─────────────────────────────────────────────────

function FindNode({ onPick }: { onPick: (node: FoundNode) => void }) {
  const { config } = useNodeConfig()
  /// Null while listening.
  const [found, setFound] = useState<readonly FoundNode[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [typed, setTyped] = useState("")
  const [checking, setChecking] = useState(false)
  const [typedProblem, setTypedProblem] = useState<string | null>(null)

  const search = useCallback(async () => {
    setFound(null)
    setProblem(null)
    const heard = await discoverNodes()
    if (!heard.ok) {
      setFound([])
      setProblem(heard.problem)
      return
    }
    setFound(heard.value)
  }, [])

  useEffect(() => {
    void search()
  }, [search])

  async function check(event: FormEvent) {
    event.preventDefault()
    setChecking(true)
    setTypedProblem(null)
    const answer = await identifyNode(typed)
    setChecking(false)
    if (!answer.ok) {
      setTypedProblem(answer.problem)
      return
    }
    onPick(answer.value)
  }

  const confirmed = (found ?? []).filter((node) => node.identity !== null)
  const doubtful = (found ?? []).filter((node) => node.identity === null)

  return (
    <>
      <div className="block-head" style={{ marginBottom: 0 }}>
        <span className="label">Node di jaringan ini</span>
        <button
          className="btn ghost"
          type="button"
          disabled={found === null}
          onClick={() => void search()}
        >
          <Icon name="search" />
          {found === null ? "Mencari…" : "Cari lagi"}
        </button>
      </div>

      {found === null && (
        <div className="notice">Mendengarkan jaringan toko selama beberapa detik…</div>
      )}

      {found !== null && confirmed.length === 0 && (
        <div className="notice warn">
          {problem ??
            "Tidak ada node toko yang terdengar di jaringan ini. Router toko " +
              "mungkin memblokir pengumuman jaringan (multicast), atau node ada " +
              "di jaringan lain — ketik alamatnya di bawah."}
        </div>
      )}

      {confirmed.length > 0 && (
        <div className="pick-list">
          {confirmed.map((node) => {
            const identity = node.identity
            if (identity === null) return null
            const current =
              config?.joined?.origin_id === identity.origin_id ||
              config?.base_url.replace(/\/+$/, "") === node.base_url
            return (
              <button
                key={`${identity.origin_id}-${node.base_url}`}
                type="button"
                className="pick"
                onClick={() => onPick(node)}
              >
                <span className="seal brand" style={{ width: 40, height: 40 }}>
                  <Icon name="plug" />
                </span>
                <span className="grow">
                  <strong>{siteTitle(identity)}</strong>
                  <small className="num">
                    {identity.origin_id} · {node.host} · versi {identity.version}
                  </small>
                </span>
                {current ? (
                  <span className="badge plain">Node kasir ini</span>
                ) : (
                  <span className="badge ok">Terkonfirmasi</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {doubtful.length > 0 && (
        <div className="rows">
          {doubtful.map((node) => (
            <div className="row-item" key={`${node.host}-${node.base_url}`}>
              <span className="grow">
                <h3>
                  {node.advertised_site ?? node.host}{" "}
                  <span className="badge warn">Tidak terkonfirmasi</span>
                </h3>
                <p>{node.problem}</p>
              </span>
            </div>
          ))}
        </div>
      )}

      <form className="rows" onSubmit={(event) => void check(event)}>
        <label className="field">
          Atau ketik alamat node
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="192.168.1.20:8082"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
          />
        </label>
        {typedProblem !== null && <p className="error">{typedProblem}</p>}
        <div>
          <button className="btn" type="submit" disabled={checking || typed.trim() === ""}>
            {checking ? "Memeriksa…" : "Periksa alamat"}
          </button>
        </div>
      </form>
    </>
  )
}

// ── 2. asking ───────────────────────────────────────────────────────────

function ConfirmNode({
  node,
  onBack,
  onAsked,
}: {
  node: FoundNode
  onBack: () => void
  onAsked: (view: JoinView) => void
}) {
  const { config } = useNodeConfig()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const identity = node.identity

  async function ask() {
    setBusy(true)
    setProblem(null)
    const answer = await beginJoin(node.base_url)
    setBusy(false)
    if (!answer.ok) {
      setProblem(answer.problem)
      return
    }
    onAsked(answer.value)
  }

  const alreadyPaired = config?.pairing_id !== null && config?.pairing_id !== undefined

  return (
    <>
      <div className="approval-what" style={{ borderColor: "var(--line)", background: "#fff" }}>
        <span className="seal brand">
          <Icon name="plug" />
        </span>
        <div>
          <strong>{identity !== null ? siteTitle(identity) : node.host}</strong>
          <p className="num">
            {identity !== null ? `${identity.origin_id} · ` : ""}
            {node.base_url}
          </p>
        </div>
      </div>

      <div className="notice">
        Kasir ini akan meminta bergabung ke node ini. Setelah itu layar ini
        menampilkan <strong>kode</strong> dan <strong>nomor verifikasi</strong>;
        supervisor toko menyetujuinya dari kasir yang sudah tergabung, dengan
        sidik jari atau PIN.
      </div>

      {alreadyPaired && (
        <div className="notice warn">
          Kasir ini sudah terpasang sebagai <strong>{config?.terminal_id}</strong>.
          Setelah disetujui, kredensial lamanya diganti. Agar namanya tetap, minta
          supervisor menyetujui sebagai <strong>pengganti {config?.terminal_id}</strong>.
        </div>
      )}

      {problem !== null && <p className="error">{problem}</p>}

      <div className="action-bar" style={{ padding: 0, border: 0, background: "none" }}>
        <button className="btn" type="button" onClick={onBack} disabled={busy}>
          Kembali
        </button>
        <button
          className="btn primary"
          type="button"
          style={{ flex: 1 }}
          onClick={() => void ask()}
          disabled={busy}
        >
          {busy ? "Meminta…" : "Minta bergabung"}
        </button>
      </div>
    </>
  )
}

// ── 3. waiting for a yes ────────────────────────────────────────────────

function Waiting({
  first,
  onApproved,
  onRefused,
  onCancelled,
}: {
  first: JoinView
  onApproved: (view: JoinView) => void
  onRefused: (view: JoinView) => void
  onCancelled: () => void
}) {
  const [view, setView] = useState(first)
  const [now, setNow] = useState(() => Date.now())
  const [unanswered, setUnanswered] = useState<string | null>(null)
  const [here, setHere] = useState(false)
  const asking = useRef(false)
  // Read through a ref so the poll is set up once, not again every time the
  // parent hands down a fresh arrow function.
  const outcome = useRef({ onApproved, onRefused })
  outcome.current = { onApproved, onRefused }

  // One poll at a time: a node slow to answer must not collect a queue of
  // questions from the till waiting on it.
  useEffect(() => {
    let alive = true
    let over = false
    const ask = async () => {
      if (asking.current || over) return
      asking.current = true
      const answer = await pollJoin()
      asking.current = false
      if (!alive) return
      if (!answer.ok) {
        setUnanswered(answer.problem)
        return
      }
      setUnanswered(null)
      const next = answer.value
      // The shell has already acted on the answer — kept the credential, or
      // thrown the key away — before this screen hears it.
      if (next.status === "APPROVED") {
        over = true
        outcome.current.onApproved(next)
        return
      }
      if (next.status === "REFUSED") {
        over = true
        outcome.current.onRefused(next)
        return
      }
      setView(next)
    }
    const poll = window.setInterval(() => void ask(), POLL_MS)
    void ask()
    return () => {
      alive = false
      window.clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [])

  const left = timeLeft(view.expires_at, now)

  return (
    <>
      <div
        className="overlay-card"
        style={{ width: "100%", alignItems: "stretch", boxShadow: "var(--shadow)" }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <span className="label">Kode kasir</span>
            <div className="join-code num">{view.code}</div>
          </div>
          <div>
            <span className="label">Nomor verifikasi</span>
            <div className="join-number num">{spaced(view.verification)}</div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12.5, textAlign: "left" }}>
          {view.node !== null ? siteTitle(view.node) : view.base_url}
          {view.node !== null && <> · {view.node.origin_id}</>}
          {left !== null ? <> · berlaku {left} lagi</> : <> · kedaluwarsa</>}
        </p>
      </div>

      <div className="notice">
        <strong>Minta supervisor:</strong> di kasir yang sudah tergabung, buka{" "}
        <strong>Setelan → Kasir menunggu</strong>, pilih kode{" "}
        <strong className="num">{view.code}</strong>, pastikan nomor verifikasinya{" "}
        <strong className="num">{spaced(view.verification)}</strong> — sama persis
        dengan layar ini — lalu setujui dengan sidik jari atau PIN. Nomor yang
        berbeda berarti permintaan dari komputer lain: jangan disetujui.
      </div>

      <p className={unanswered === null ? "muted" : "error"} style={{ fontSize: 12 }}>
        {unanswered === null
          ? "Menunggu persetujuan… layar ini berganti sendiri begitu disetujui."
          : `Node belum menjawab — mencoba lagi. ${unanswered}`}
      </p>

      {here ? (
        <ApproveHere view={view} onClose={() => setHere(false)} />
      ) : (
        <div>
          <button className="btn" type="button" onClick={() => setHere(true)}>
            <Icon name="user" />
            Supervisor ada di kasir ini?
          </button>
        </div>
      )}

      <div>
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            void (async () => {
              await cancelJoin()
              onCancelled()
            })()
          }}
        >
          Batalkan permintaan
        </button>
      </div>
    </>
  )
}

/// A supervisor signs in here, on the node being joined, and approves.
///
/// The password goes to the shell and on to the node; this component drops it
/// the moment the node has answered, whichever way. The node's session is held
/// by the shell, not here, and signed out as soon as they approve or leave.
function ApproveHere({ view, onClose }: { view: JoinView; onClose: () => void }) {
  const { config } = useNodeConfig()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [signedIn, setSignedIn] = useState<SupervisorHere | null>(null)
  const [mode, setMode] = useState<"new" | "replace">("new")
  const [replaces, setReplaces] = useState("")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    const typed = password
    setPassword("")
    const answer = await supervisorSignIn(username, typed)
    setBusy(false)
    if (!answer.ok) {
      setProblem(answer.problem)
      return
    }
    setSignedIn(answer.value)
    // This till may be the one it replaces: a till re-joining the node it was
    // already paired with offers its own old row first.
    const own = answer.value.tills.find((till) => till.device_id === config?.pairing_id)
    if (own !== undefined) {
      setMode("replace")
      setReplaces(own.device_id)
    }
  }

  async function approve() {
    setBusy(true)
    setProblem(null)
    const answer = await approveHere(
      mode === "replace" ? replaces : null,
      mode === "new" && label.trim() !== "" ? label.trim() : null,
    )
    setBusy(false)
    if (!answer.ok) {
      setProblem(answer.problem)
      return
    }
    setDone(
      `Disetujui oleh ${answer.value.approved_by} sebagai ${answer.value.label}. ` +
        "Menunggu node mengonfirmasi…",
    )
  }

  async function leave() {
    await supervisorLeave()
    onClose()
  }

  if (done !== null) {
    return <div className="notice">{done}</div>
  }

  return (
    <div className="stat" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="block-head" style={{ marginBottom: 0 }}>
        <strong style={{ fontSize: 14 }}>Setujui di kasir ini</strong>
        <button className="icon-btn" type="button" onClick={() => void leave()} aria-label="Tutup">
          <Icon name="x" />
        </button>
      </div>

      {signedIn === null ? (
        <form className="rows" onSubmit={(event) => void signIn(event)}>
          <p className="muted" style={{ fontSize: 12 }}>
            Bisa untuk kasir pertama di toko ini, atau dengan akun Admin. Untuk
            kasir berikutnya node meminta sidik jari atau PIN supervisor di kasir
            yang sudah tergabung. Masuk di sini mengeluarkan akun itu dari
            perangkat lain di node {siteTitle(view.node)}.
          </p>
          <label className="field">
            Nama pengguna supervisor
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          <label className="field">
            Kata sandi
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
            />
          </label>
          {problem !== null && <p className="error">{problem}</p>}
          <div>
            <button
              className="btn primary"
              type="submit"
              disabled={busy || username.trim() === "" || password === ""}
            >
              {busy ? "Memeriksa…" : "Masuk"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12 }}>
            Masuk sebagai <strong>{signedIn.username}</strong>. Cocokkan dulu:
            kode <strong className="num">{view.code}</strong>, nomor{" "}
            <strong className="num">{spaced(view.verification)}</strong>.
          </p>
          <div className="segmented" role="radiogroup" aria-label="Kasir ini sebagai">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "new"}
              aria-pressed={mode === "new"}
              onClick={() => setMode("new")}
            >
              Kasir baru
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "replace"}
              aria-pressed={mode === "replace"}
              disabled={signedIn.tills.length === 0}
              onClick={() => setMode("replace")}
            >
              Menggantikan kasir lama
            </button>
          </div>
          {mode === "new" ? (
            <label className="field">
              Nama kasir
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Kosongkan untuk nomor berikutnya (Kasir N)"
                autoComplete="off"
              />
            </label>
          ) : (
            <label className="field">
              Kasir yang digantikan — namanya dipakai kasir ini, kasir lama dicabut
              <select value={replaces} onChange={(event) => setReplaces(event.target.value)}>
                <option value="">Pilih kasir…</option>
                {signedIn.tills.map((till) => (
                  <option key={till.device_id} value={till.device_id}>
                    {till.label}
                    {till.status !== "ACTIVE" ? ` (${till.status.toLowerCase()})` : ""}
                    {till.device_id === config?.pairing_id ? " — kasir ini sebelumnya" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {signedIn.problem !== null && (
            <p className="muted" style={{ fontSize: 12 }}>
              Daftar kasir tidak bisa dibaca: {signedIn.problem}
            </p>
          )}
          {problem !== null && <p className="error">{problem}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
              Batal
            </button>
            <button
              className="btn primary"
              type="button"
              style={{ flex: 1 }}
              disabled={busy || (mode === "replace" && replaces === "")}
              onClick={() => void approve()}
            >
              {busy ? "Menyetujui…" : "Setujui kasir ini"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── 4. the answer ───────────────────────────────────────────────────────

function Approved({
  view,
  onPeripherals,
  onDone,
}: {
  view: JoinView
  onPeripherals: () => void
  onDone: () => void
}) {
  // The shell changed this till's config on its own when it heard "yes": a
  // new name, a credential, perhaps a new node and no session. The window's
  // copy is brought up to date on the way out of this screen rather than on
  // arrival, so the session re-reading itself cannot pull this screen away
  // before anybody has read which Kasir this is.
  const leave = (next: () => void) => {
    void refreshFromShell().then(next)
  }
  return (
    <div className="overlay-card" style={{ width: "100%", boxShadow: "var(--shadow)" }}>
      <span className="seal">
        <Icon name="check" />
      </span>
      <h3>Kasir ini sudah tergabung</h3>
      <div className="join-code">{view.label}</div>
      <p className="muted num" style={{ fontSize: 12.5 }}>
        {siteTitle(view.node)} · {view.base_url}
      </p>
      <div className="notice" style={{ width: "100%", textAlign: "left" }}>
        Nama ini tercetak di struk dan dipakai untuk shift kas. Perangkat yang
        tersambung ke kasir ini dilaporkan ke node sekarang; periksa di{" "}
        <strong>Perangkat kasir</strong>.
      </div>
      <div style={{ display: "flex", gap: 10, width: "100%" }}>
        <button
          className="btn"
          type="button"
          style={{ flex: 1 }}
          onClick={() => leave(onPeripherals)}
        >
          <Icon name="plug" />
          Perangkat kasir
        </button>
        <button
          className="btn primary"
          type="button"
          style={{ flex: 1 }}
          onClick={() => leave(onDone)}
          autoFocus
        >
          Selesai
        </button>
      </div>
    </div>
  )
}

function Refused({
  view,
  onAgain,
  onFind,
}: {
  view: JoinView
  onAgain: (view: JoinView) => void
  onFind: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <div className="overlay-card" style={{ width: "100%", boxShadow: "var(--shadow)" }}>
      <span className="seal warn">
        <Icon name="alert" />
      </span>
      <h3>Belum tergabung</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        {refusedBecause(view.reason)}
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        Kunci yang dibuat untuk permintaan ini sudah dibuang. Permintaan baru
        memakai kunci baru dan kode baru.
      </p>
      {problem !== null && <p className="error">{problem}</p>}
      <div style={{ display: "flex", gap: 10, width: "100%" }}>
        <button className="btn" type="button" style={{ flex: 1 }} onClick={onFind} disabled={busy}>
          Pilih node lain
        </button>
        <button
          className="btn primary"
          type="button"
          style={{ flex: 1 }}
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true)
              setProblem(null)
              const answer = await beginJoin(view.base_url)
              setBusy(false)
              if (!answer.ok) {
                setProblem(answer.problem)
                return
              }
              onAgain(answer.value)
            })()
          }}
        >
          {busy ? "Meminta…" : "Minta lagi"}
        </button>
      </div>
    </div>
  )
}
