/// A POS joins its shop's node.
///
/// # What a person sees
///
/// 1. **Find the server** — the POS listens on the LAN for a few seconds and
///    lists every node that answered *and* confirmed who it is. An address can
///    always be typed instead, and is checked the same way.
/// 2. **Ask to join** — the POS asks, and shows a six-character code and a
///    six-digit number.
/// 3. **Head office approves** — in Central, on the store's page: head office
///    finds this code, checks the number matches this screen, and approves.
///    The store decides nothing here (owner, 24 Oct 2026: the store only opens
///    and closes its day). A request waits up to 24 hours; this screen asks the
///    node every few seconds whether head office has answered.
/// 4. **Joined** — the POS is "Kasir N" at this shop.
///
/// # Why the number matters more than the code
///
/// The code is a handle, shown on both screens so head office picks the right
/// row. The number is what makes approving safe: the node derives it from the
/// code *and* the digest of the key this POS minted, so a request made by some
/// other machine on the shop's wifi shows a different number.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"

import { isGudang } from "@/edition"
import { Icon } from "@/icons"
import {
  beginJoin,
  cancelJoin,
  currentJoin,
  discoverNodes,
  identifyNode,
  pollJoin,
  refusedBecause,
  siteTitle,
  spaced,
  type FoundNode,
  type JoinView,
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

/// What this machine is called on these screens: Central Gudang is a
/// warehouse PC, never a POS.
const THIS = isGudang ? "PC gudang ini" : "POS ini"

/// Often enough that this screen changes soon after head office has answered;
/// rarely enough that five waiting POS are not a load on anybody's node.
const POLL_MS = 3000

export function JoinScreen({
  onDone,
  start,
}: {
  onDone: () => void
  /// A node already chosen — the store server on this PC the door offered.
  start?: FoundNode
}) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" })

  // A request left waiting when the app closed is picked up where it was:
  // same code, same number, same row in head office's list.
  useEffect(() => {
    let alive = true
    void (async () => {
      const held = await currentJoin()
      if (!alive) return
      setStage(
        held.ok && held.value !== null
          ? { kind: "waiting", view: held.value }
          : start !== undefined
            ? { kind: "confirm", node: start }
            : { kind: "find" },
      )
    })()
    return () => {
      alive = false
    }
  }, [start])

  return (
    <div id="app" data-screen="sale">
      <Topbar />
      <main className="page">
        <div className="page-inner" style={{ maxWidth: 620 }}>
          <div className="page-head">
            <div>
              <h1>Gabungkan {THIS} ke server toko</h1>
            </div>
            {/* Leaving while waiting keeps the request: it is picked up again,
                same code, the next time this screen opens. */}
            {(stage.kind === "find" ||
              stage.kind === "loading" ||
              stage.kind === "waiting") && (
              <button className="btn primary" type="button" onClick={onDone}>
                <Icon name="back" />
                Kembali
              </button>
            )}
          </div>

          <div className="steps">
            <span className={stage.kind === "find" || stage.kind === "loading" ? "active" : ""}>
              1 · Cari server
            </span>
            <span className={stage.kind === "confirm" ? "active" : ""}>
              2 · Minta bergabung
            </span>
            <span className={stage.kind === "waiting" ? "active" : ""}>
              3 · Menunggu kantor pusat
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
            <Approved view={stage.view} onDone={onDone} />
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
        <span className="label">Server di jaringan ini</span>
        <button
          className="btn primary"
          type="button"
          disabled={found === null}
          onClick={() => void search()}
        >
          <Icon name="search" />
          {found === null ? "Mencari…" : "Cari lagi"}
        </button>
      </div>

      {found === null && (
        <div className="notice">Mencari di jaringan ini…</div>
      )}

      {found !== null && confirmed.length === 0 && (
        <div className="notice warn">
          {problem ??
            "Tidak ada server toko yang menjawab di jaringan ini. Router toko " +
              "mungkin memblokir pengumuman jaringan (multicast), atau server " +
              "ada di jaringan lain. Ketik alamatnya di bawah."}
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
                  <span className="badge plain">Server {THIS}</span>
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
                  <span className="badge warn">Belum terkonfirmasi</span>
                </h3>
                <p>{node.problem}</p>
              </span>
            </div>
          ))}
        </div>
      )}

      <form className="rows" onSubmit={(event) => void check(event)}>
        <label className="field">
          Atau ketik alamat server
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
          <button className="btn primary" type="submit" disabled={checking || typed.trim() === ""}>
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
    const answer = await beginJoin(node.base_url, node)
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
        Kantor pusat menyetujui {THIS} di Central. Layar ini menampilkan{" "}
        <strong>kode</strong> dan <strong>nomor verifikasi</strong> untuk
        dicocokkan.
      </div>

      {alreadyPaired && (
        <div className="notice warn">
          {isGudang ? "PC gudang ini" : "POS ini"} sudah terpasang sebagai <strong>{config?.terminal_id}</strong>.
          Setelah disetujui, kredensial lamanya diganti. Agar namanya tetap,
          minta kantor pusat menyetujuinya sebagai{" "}
          <strong>pengganti {config?.terminal_id}</strong>.
        </div>
      )}

      {problem !== null && <p className="error">{problem}</p>}

      <div className="action-bar" style={{ padding: 0, border: 0, background: "none" }}>
        <button className="btn primary" type="button" onClick={onBack} disabled={busy}>
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

// ── 3. waiting for head office ──────────────────────────────────────────

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
  const [unanswered, setUnanswered] = useState<string | null>(null)
  const asking = useRef(false)
  // Read through a ref so the poll is set up once, not again every time the
  // parent hands down a fresh arrow function.
  const outcome = useRef({ onApproved, onRefused })
  outcome.current = { onApproved, onRefused }

  // One poll at a time: a node slow to answer must not collect a queue of
  // questions from the POS waiting on it.
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

  return (
    <>
      <div
        className="overlay-card"
        style={{ width: "100%", alignItems: "stretch", boxShadow: "var(--shadow)" }}
      >
        <h3 style={{ textAlign: "center" }}>Menunggu persetujuan kantor pusat</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <span className="label">{isGudang ? "Kode PC gudang" : "Kode POS"}</span>
            <div className="join-code num">{view.code}</div>
          </div>
          <div>
            <span className="label">Nomor verifikasi</span>
            <div className="join-number num">{spaced(view.verification)}</div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 15, textAlign: "left" }}>
          Kantor pusat menyetujui {THIS} di Central.
        </p>
        <p className="muted num" style={{ fontSize: 15, textAlign: "left" }}>
          {view.node !== null ? siteTitle(view.node) : view.base_url}
          {view.node !== null && <> · {view.node.origin_id}</>}
        </p>
      </div>

      {unanswered !== null && (
        <p className="error" style={{ fontSize: 15 }}>
          Server belum menjawab, mencoba lagi. {unanswered}
        </p>
      )}

      <div>
        <button
          className="btn red"
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

// ── 4. the answer ───────────────────────────────────────────────────────

function Approved({ view, onDone }: { view: JoinView; onDone: () => void }) {
  // The shell changed this POS's config on its own when it heard "yes": a new
  // name, a credential, perhaps a new node and no session. The window's copy
  // is brought up to date on the way out of this screen rather than on
  // arrival, so the session re-reading itself cannot pull this screen away
  // before anybody has read which Kasir this is.
  const leave = () => {
    void refreshFromShell().then(onDone)
  }
  return (
    <div className="overlay-card" style={{ width: "100%", boxShadow: "var(--shadow)" }}>
      <span className="seal">
        <Icon name="check" />
      </span>
      <h3>{isGudang ? "PC gudang ini" : "POS ini"} sudah tergabung</h3>
      <div className="join-code">{view.label}</div>
      <p className="muted num" style={{ fontSize: 15 }}>
        {siteTitle(view.node)} · {view.base_url}
      </p>
      <button
        className="btn primary"
        type="button"
        style={{ width: "100%" }}
        onClick={leave}
        autoFocus
      >
        Selesai
      </button>
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
      <p className="muted" style={{ fontSize: 15 }}>
        {refusedBecause(view.reason)}
      </p>
      {problem !== null && <p className="error">{problem}</p>}
      <div style={{ display: "flex", gap: 10, width: "100%" }}>
        <button className="btn primary" type="button" style={{ flex: 1 }} onClick={onFind} disabled={busy}>
          Pilih server lain
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
