/// The tills waiting to join this shop, and a supervisor's yes.
///
/// # Where this happens, and why here
///
/// On a till that has already joined. The node lets a new till in on a
/// supervisor's finger or PIN pressed at a till it already trusts — "one tap
/// and a finger" — because that till can sign the claim the finger or PIN
/// earns, and a till that has not joined yet cannot. So this screen lists the
/// waiting tills (`GET /api/v1/devices/joins`), and approving one takes the
/// same one-shot grant a void takes (`supervisorByFinger`,
/// `supervisorByPin`), which the node spends as it lets the till in.
///
/// # What the supervisor must check
///
/// The number. The code is how the supervisor finds the right row; the six
/// digits beside it are derived from the code *and* the new till's key, so a
/// request some other machine on the wifi made shows a different number from
/// the one on the till standing in front of them. The approve button stays
/// off until they say they compared it.
///
/// # Replacing a till
///
/// A till that dies is replaced, not re-numbered: approving the new one "as
/// the replacement for Kasir 2" revokes the old Kasir 2, keeps its row, and
/// gives the new till its name — so the receipts and the cash shifts carry on
/// under the name the shop already uses.

import { useCallback, useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { Icon } from "@/icons"
import { spaced, timeLeft } from "@/joining"
import { PinPad } from "@/pinpad"
import { Sheet } from "@/screens/dialogs"
import { supervisorByFinger, supervisorByPin, useNodeConfig } from "@/session"
import { Topbar } from "@/till"

/// A waiting till is a person standing at a counter; five seconds is as long
/// as they should wait to appear here.
const REFRESH_MS = 5000

export function WaitingTillsScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<readonly api.PendingJoin[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<api.PendingJoin | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const reply = await api.pendingJoins()
    if (!reply.ok) {
      setProblem(reply.problem)
      setItems((before) => before ?? [])
      return
    }
    setProblem(null)
    setItems(reply.body?.items ?? [])
  }, [])

  useEffect(() => {
    void load()
    const refresh = window.setInterval(() => void load(), REFRESH_MS)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(refresh)
      window.clearInterval(tick)
    }
  }, [load])

  async function refuse(join: api.PendingJoin) {
    if (
      !window.confirm(
        `Tolak kasir dengan kode ${join.code}? Kasir itu membuang kuncinya dan ` +
          "harus meminta lagi.",
      )
    ) {
      return
    }
    const reply = await api.refuseJoin(join.join_id)
    setNote(
      reply.ok
        ? { bad: false, text: `Kasir dengan kode ${join.code} ditolak.` }
        : { bad: true, text: reply.problem ?? "Node tidak menerima penolakan ini." },
    )
    void load()
  }

  return (
    <div id="app" data-screen="sale">
      <Topbar />
      <main className="page">
        <div className="page-inner" style={{ maxWidth: 720 }}>
          <div className="page-head">
            <div>
              <h1>Kasir menunggu persetujuan</h1>
              <p>
                Kasir baru di toko ini yang meminta bergabung. Cocokkan kode dan
                nomor verifikasi dengan layar kasir itu sebelum menyetujui.
              </p>
            </div>
            <button className="btn ghost" type="button" onClick={onBack}>
              <Icon name="back" />
              Kembali
            </button>
          </div>

          {problem !== null && <div className="notice warn">{problem}</div>}
          {note !== null && <p className={note.bad ? "error" : "muted"}>{note.text}</p>}

          {items === null && <p className="muted">Memuat…</p>}

          {items !== null && items.length === 0 && (
            <div className="empty">
              <Icon name="plug" />
              <h3>Tidak ada kasir yang menunggu</h3>
              <p>
                Di kasir baru, buka Setelan lalu Gabungkan ke node. Permintaannya
                muncul di sini dalam beberapa detik.
              </p>
            </div>
          )}

          {items !== null && items.length > 0 && (
            <div className="rows">
              {items.map((join) => {
                const left = timeLeft(join.expires_at, now)
                const machine = join.machine ?? null
                return (
                  <div className="row-item" key={join.join_id}>
                    <span className="seal warn" style={{ width: 44, height: 44 }}>
                      <Icon name="plug" />
                    </span>
                    <span className="grow">
                      <h3 className="num" style={{ fontSize: 18, letterSpacing: 2 }}>
                        {join.code}
                        <span className="muted" style={{ fontSize: 13, letterSpacing: 1, marginLeft: 12 }}>
                          nomor {spaced(join.verification)}
                        </span>
                      </h3>
                      <p>
                        {machine?.hostname !== undefined && machine.hostname !== ""
                          ? machine.hostname
                          : "Komputer tanpa nama"}
                        {machine?.os !== undefined && machine.os !== "" ? ` · ${machine.os}` : ""}
                        {machine?.version !== undefined && machine.version !== ""
                          ? ` · aplikasi ${machine.version}`
                          : ""}
                        {left !== null ? ` · berlaku ${left} lagi` : " · kedaluwarsa"}
                      </p>
                    </span>
                    <button className="btn" type="button" onClick={() => void refuse(join)}>
                      Tolak
                    </button>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={left === null}
                      onClick={() => {
                        setNote(null)
                        setOpen(join)
                      }}
                    >
                      Periksa & setujui
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {open !== null && (
        <ApproveSheet
          join={open}
          onClose={() => setOpen(null)}
          onApproved={(approved) => {
            setOpen(null)
            setNote({
              bad: false,
              text:
                `Kode ${open.code} tergabung sebagai ${approved.label}` +
                (approved.replaced_terminal_id !== null
                  ? ", menggantikan kasir lama (kasir lama dicabut)."
                  : ".") +
                ` Disetujui oleh ${approved.approved_by}.`,
            })
            void load()
          }}
        />
      )}
    </div>
  )
}

type Till = { readonly id: string; readonly label: string; readonly status: string }

function ApproveSheet({
  join,
  onClose,
  onApproved,
}: {
  join: api.PendingJoin
  onClose: () => void
  onApproved: (approved: api.ApprovedTill) => void
}) {
  const { config } = useNodeConfig()
  const [compared, setCompared] = useState(false)
  const [joinAs, setJoinAs] = useState<"new" | "replace">("new")
  const [label, setLabel] = useState("")
  const [replaces, setReplaces] = useState("")
  const [tills, setTills] = useState<readonly Till[] | null>(null)
  const [stepUp, setStepUp] = useState<api.StepUp | null>(null)
  const [how, setHow] = useState<"quick" | "session">("quick")
  const [username, setUsername] = useState("")
  // Held in a ref and emptied the moment the node has answered, as
  // `approval.tsx` holds a supervisor's PIN.
  const pin = useRef("")
  const [, redraw] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [methods, listed] = await Promise.all([api.authMethods(), api.devices()])
      if (!alive) return
      const answer = methods.ok ? (methods.body?.till_step_up ?? "NONE") : "NONE"
      setStepUp(answer)
      if (answer === "NONE") setHow("session")
      setTills(
        listed.ok
          ? (listed.body?.items ?? [])
              .filter((one) => one.kind === "TILL" && one.status !== "REVOKED")
              // This till cannot be replaced from itself.
              .filter((one) => one.device_id !== config?.pairing_id)
              .map((one) => ({ id: one.device_id, label: one.label, status: one.status }))
          : [],
      )
    })()
    return () => {
      alive = false
    }
  }, [config?.pairing_id])

  const setPin = (next: string) => {
    pin.current = next
    redraw((count) => count + 1)
  }

  async function approveWith(authorization: string | null) {
    const reply = await api.approveJoin(join.join_id, {
      authorization,
      label: joinAs === "new" && label.trim() !== "" ? label.trim() : null,
      replaces_terminal_id: joinAs === "replace" ? replaces : null,
    })
    if (!reply.ok) {
      setProblem(reply.problem ?? "Node menolak persetujuan ini.")
      return
    }
    onApproved(reply.body)
  }

  async function approve() {
    setBusy(true)
    setProblem(null)
    if (how === "session") {
      await approveWith(null)
      setBusy(false)
      return
    }
    if (stepUp === "FINGERPRINT") {
      const answer = await supervisorByFinger()
      if (answer.authorization === null) {
        setBusy(false)
        setProblem(answer.problem ?? "Sidik jari ditolak.")
        return
      }
      await approveWith(answer.authorization)
      setBusy(false)
      return
    }
    if (username.trim() === "" || pin.current === "") {
      setBusy(false)
      setProblem("Isi kode supervisor dan PIN.")
      return
    }
    const answer = await supervisorByPin(username.trim(), pin.current)
    setPin("")
    if (answer.authorization === null) {
      setBusy(false)
      setProblem(answer.problem ?? "PIN ditolak.")
      return
    }
    await approveWith(answer.authorization)
    setBusy(false)
  }

  const quick = how === "quick" && stepUp !== null && stepUp !== "NONE"
  const ready =
    compared && !busy && stepUp !== null && (joinAs === "new" || replaces !== "")

  return (
    <Sheet
      title="Setujui kasir baru"
      onClose={onClose}
      foot={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!ready}
            onClick={() => void approve()}
          >
            {quick && stepUp === "FINGERPRINT" && <Icon name="finger" />}
            {busy
              ? "Memeriksa…"
              : quick && stepUp === "FINGERPRINT"
                ? "Pindai sidik jari & setujui"
                : "Setujui"}
          </button>
        </>
      }
    >
      <div className="approval-what">
        <span className="seal warn">
          <Icon name="lock" />
        </span>
        <div>
          <strong className="num" style={{ fontSize: 18, letterSpacing: 2 }}>
            {join.code}
          </strong>
          <p>
            Nomor verifikasi{" "}
            <strong className="num" style={{ display: "inline", fontSize: 18, letterSpacing: 1 }}>
              {spaced(join.verification)}
            </strong>
          </p>
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={compared}
          onChange={(event) => setCompared(event.target.checked)}
        />
        Nomor ini sama persis dengan yang tampil di layar kasir baru
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
        Kalau berbeda, jangan setujui: permintaan itu datang dari komputer lain.
      </p>

      <div className="segmented" role="radiogroup" aria-label="Kasir baru ini sebagai">
        <button
          type="button"
          role="radio"
          aria-checked={joinAs === "new"}
          aria-pressed={joinAs === "new"}
          onClick={() => setJoinAs("new")}
        >
          Kasir baru
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={joinAs === "replace"}
          aria-pressed={joinAs === "replace"}
          disabled={tills !== null && tills.length === 0}
          onClick={() => setJoinAs("replace")}
        >
          Menggantikan kasir lama
        </button>
      </div>

      {joinAs === "new" ? (
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
          Kasir yang digantikan — kasir baru memakai namanya, kasir lama dicabut
          <select value={replaces} onChange={(event) => setReplaces(event.target.value)}>
            <option value="">Pilih kasir…</option>
            {(tills ?? []).map((till) => (
              <option key={till.id} value={till.id}>
                {till.label}
                {till.status !== "ACTIVE" ? ` (${till.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {stepUp === null && <p className="muted">Memuat…</p>}

      {stepUp !== null && (
        <div className="segmented" role="radiogroup" aria-label="Cara menyetujui">
          {stepUp !== "NONE" && (
            <button
              type="button"
              role="radio"
              aria-checked={how === "quick"}
              aria-pressed={how === "quick"}
              onClick={() => setHow("quick")}
            >
              {stepUp === "FINGERPRINT" ? "Sidik jari supervisor" : "PIN supervisor"}
            </button>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={how === "session"}
            aria-pressed={how === "session"}
            onClick={() => setHow("session")}
          >
            Akun yang sedang masuk
          </button>
        </div>
      )}

      {how === "session" && (
        <p className="muted" style={{ fontSize: 12 }}>
          Node menerima persetujuan tanpa sidik jari atau PIN hanya dari akun
          Admin (atau supervisor, untuk kasir pertama toko).
        </p>
      )}

      {quick && stepUp === "PIN" && (
        <form
          className="rows"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) void approve()
          }}
        >
          <label className="field">
            Kode supervisor
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <PinPad
            value={pin.current}
            onChange={setPin}
            onSubmit={() => {
              if (ready) void approve()
            }}
            disabled={busy}
          />
        </form>
      )}

      {problem !== null && <p className="error">{problem}</p>}
    </Sheet>
  )
}
