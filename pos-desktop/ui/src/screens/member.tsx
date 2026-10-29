/// Member — the prototype's `memberView`, `memberChosen`, `registerMember` and
/// `memNew` (pos-classic-prototype.html). ⇧5 finds a member by the card the
/// shopper holds up or the phone they read out; head office answers with a name
/// and points, and Enter adds them to the sale. ⇧⇧5 (or the last row) opens the
/// registration form: phone, name, gender, birth place and date are required,
/// address and email are not. ⇧5 on the sale screen opens that form directly
/// with one more optional field, "No. transaksi": the struk of a sale already
/// rung, which the new member is then tied to (and earns its points).
///
/// Members are kept at head office, so both need the line to it; when it is
/// down the node says so in a sentence and the sale carries on without.

import { useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { Icon } from "@/icons"
import { seatNow } from "@/seat"
import { viaPointer } from "@/shortcuts"
import { money, units as grouped } from "@itulah/contract/money"

import "../exchange-d.css"
import "../member-d.css"

/// A member refusal in the counter's words: a node with no such route, head
/// office out of reach, or a refusal — never the node's English.
function memberRefusal(reply: api.EdgeReply<unknown>, fallback: string): string {
  const said = reply.problem ?? ""
  if (reply.status === 404 || reply.status === 405) return "Server toko ini belum bisa melayani member."
  if (reply.status === 0 || reply.status === 502 || reply.status === 503 || reply.status === 504) {
    return "Kantor pusat tidak terjangkau — transaksi tetap jalan tanpa member."
  }
  if (reply.status === 401 || reply.status === 403) return "Server toko menolak permintaan member dari kasir ini."
  // The node names who has the number, in Indonesian ("Nomor ini sudah dipakai …").
  if (reply.status === 409) return /\bsudah\b/i.test(said) ? said : "Nomor itu sudah terdaftar sebagai member."
  return /^[\x00-\x7F]*$/.test(said) && /\b(the|not|is|no|a)\b/i.test(said) ? fallback : said || fallback
}

/// What the node says when it will not tie a member to a struk: its own words
/// (Indonesian, with the number in them), or ours when it said none.
function tieRefusal(reply: api.EdgeReply<unknown>, receiptNo: string): string {
  const said = reply.problem ?? ""
  if ((reply.status === 404 || reply.status === 409) && /\b(tidak ada|sudah)\b/i.test(said)) return said
  if (reply.status === 404) return `Struk ${receiptNo} tidak ada`
  if (reply.status === 405) return "Server toko ini belum bisa menambah member ke struk."
  if (reply.status === 0 || reply.status === 502 || reply.status === 503 || reply.status === 504) {
    return "Server toko tidak terjangkau — struk belum dikaitkan ke member."
  }
  return /^[\x00-\x7F]*$/.test(said) && /\b(the|not|is|no|a)\b/i.test(said) ? "Struk belum bisa dikaitkan ke member." : said || "Struk belum bisa dikaitkan ke member."
}

/// What the node says when it will not send a new member's number its code
/// (owner, 25 Oct 2026). Head office's sentences are read before the status:
/// WhatsApp's refusals come back through the node as a 503 with the sentence
/// inside.
function codeRefusal(reply: api.EdgeReply<unknown>, phone: string): string {
  // The node prefixes the kind of refusal ("conflict: …").
  const said = (reply.problem ?? "").replace(/^(?:[a-z ]+:\s*)+/i, "")
  const taken = /^(.+?) already has the number (\d+)/i.exec(said)
  if (taken !== null) return `${taken[1]} sudah memakai nomor ${taken[2]}.`
  if (/not on whatsapp/i.test(said)) return `Nomor ${phone} tidak terdaftar di WhatsApp.`
  if (/not connected/i.test(said)) {
    return "WhatsApp kantor pusat belum tersambung — member baru belum bisa didaftarkan."
  }
  const codes = /sent (\d+) codes/i.exec(said)
  if (codes !== null) return `Nomor itu sudah dikirimi ${codes[1]} kode dalam sejam — coba lagi nanti.`
  if (/mobile number/i.test(said)) return "Member baru didaftarkan dengan nomor HP, 08…"
  return memberRefusal(reply, "Kode belum bisa dikirim ke nomor itu.")
}

/// How long before a new code may be asked for the same number.
const RESEND_AFTER = 30_000

/// The answer to "send this number a code" the form keeps: nothing asked yet
/// (`null`), head office wants no code (`required: false` — the form goes as it
/// always did), or the code is on its way to the number as head office keys it.
type Sent =
  | { readonly required: false }
  | {
      readonly required: true
      readonly memberId: string
      readonly challengeId: string
      readonly sentTo: string
      readonly sentAt: number
    }

/// "10:52", the way the struk's time is read at a counter.
const clock = (iso: string) => {
  const at = new Date(iso)
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
}

/// The card number inside a scanned member barcode, or null when the scan is
/// not one. `M1:` is the member app's payload version; anything else is left
/// to `readScan`, which knows tags and SKUs.
export function memberFromScan(raw: string): string | null {
  const text = raw.trim()
  if (!text.toUpperCase().startsWith("M1:")) return null
  const id = text.slice(3).trim()
  return id === "" ? null : id
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => word[0]!.toUpperCase())
    .join("")
    .slice(0, 2)

/// "0812 •••• 7788": a phone's middle is not for the shopper behind to read.
const maskPhone = (id: string) => (/^\d{8,}$/.test(id) ? `${id.slice(0, 4)} •••• ${id.slice(-4)}` : id)

/// dd/mm/yyyy typed as digits, slashes put in as it goes.
function dated(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8)
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

/// "31/02/1990" -> null (there is no 31 February); "05/03/1990" -> "1990-03-05".
function isoDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const real = new Date(year, month - 1, day)
  if (year < 1900 || real.getFullYear() !== year || real.getMonth() !== month - 1 || real.getDate() !== day) return null
  if (real.getTime() > Date.now()) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

export function MemberSheet({
  start,
  ask,
  forReceipt,
  current = null,
  onAttach,
  onRegistered,
  onSkip,
  onClear,
  onClose,
}: {
  start: "find" | "register"
  /// "pay": the question asked when Bayar is pressed on a sale with no member.
  ask?: "pay"
  /// A paid sale's receipt number: the sheet is then titled "Member untuk <no>".
  forReceipt?: string
  /// The member already on the sale: footer "<name> ada di transaksi ini".
  current?: api.Member | null
  onAttach?: (member: api.Member, registered: boolean) => void
  /// ⇧5: registering only registers — the member is chosen at Bayar — and the
  /// form carries the optional "No. transaksi". Called with the new member and,
  /// when a struk number was given and the node tied it, what it answered.
  onRegistered?: (member: api.Member, tied: api.MemberOnSale | null) => void
  /// ask="pay" only: Enter on an empty field, or "Bukan member, lanjut bayar".
  onSkip?: () => void
  onClear?: () => void
  onClose: () => void
}) {
  const [enter] = useState(viaPointer)
  const [mode, setMode] = useState(start)
  const direct = start === "register"
  const [typed, setTyped] = useState("")
  // What the last lookup was asked about and what came back, so Enter means
  // "look it up" until there is an answer to the number on screen.
  const [asked, setAsked] = useState<string | null>(null)
  const [found, setFound] = useState<api.Member | null>(null)
  const [missing, setMissing] = useState(false)
  // Which row Enter acts on: 0 the answer (or the new-member row when there is
  // none), 1 the new-member row under an answer.
  const [row, setRow] = useState(0)
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [gender, setGender] = useState<"L" | "P" | null>(null)
  const [place, setPlace] = useState("")
  const [birth, setBirth] = useState("")
  const [address, setAddress] = useState("")
  const [email, setEmail] = useState("")
  const [receiptNo, setReceiptNo] = useState("")
  // The WhatsApp code that proves the shopper holds the number (owner, 25 Oct
  // 2026): asked for with Enter on the phone or "Kirim kode", typed back in
  // `code`. A different number is a different code.
  const [sent, setSent] = useState<Sent | null>(null)
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // The member this form has already enrolled: a struk the node then refuses is
  // fixed and tried again without registering the same phone twice.
  const [enrolled, setEnrolled] = useState<api.Member | null>(null)
  // The last three struk of this shift, to say which one the typed number is.
  const [recent, setRecent] = useState<readonly api.ShiftSale[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const findBox = useRef<HTMLInputElement>(null)
  const phoneBox = useRef<HTMLInputElement>(null)
  const nameBox = useRef<HTMLInputElement>(null)
  const genderBox = useRef<HTMLSpanElement>(null)
  const placeBox = useRef<HTMLInputElement>(null)
  const birthBox = useRef<HTMLInputElement>(null)
  const addressBox = useRef<HTMLInputElement>(null)
  const emailBox = useRef<HTMLInputElement>(null)
  const receiptBox = useRef<HTMLInputElement>(null)
  const codeBox = useRef<HTMLInputElement>(null)

  const number = typed.trim()
  const unchanged = asked !== null && number === asked
  const answer = unchanged ? found : null
  const rows = answer !== null ? 1 : 0
  const digitsTyped = typed.replace(/\D/g, "")
  const wantedNo = receiptNo.trim().toUpperCase().replace(/\s/g, "")
  const sameSale = wantedNo === "" ? undefined : recent.find((one) => one.receipt_no.toUpperCase() === wantedNo)

  useEffect(() => {
    const shift = seatNow()?.shift_id
    if (onRegistered === undefined || shift === undefined) return
    let alive = true
    void api.shiftSales(shift).then((reply) => {
      if (!alive || !reply.ok || !Array.isArray(reply.body)) return
      const newest = [...reply.body].sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at))
      setRecent(newest.slice(0, 3))
    })
    return () => {
      alive = false
    }
    // Once, when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mode === "register") (phone === "" ? phoneBox : nameBox).current?.focus()
    else findBox.current?.focus()
    // Only on switching: typing must not steal the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // A code on its way: the caret goes to where it is typed, and "Kirim ulang"
  // counts down the seconds until it may be pressed.
  useEffect(() => {
    if (sent === null || !sent.required) return
    codeBox.current?.focus()
    setNow(Date.now())
    const timer = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at - sent.sentAt >= RESEND_AFTER) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sent])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        if (mode === "register" && !direct) back()
        else leave()
      } else if (event.shiftKey && event.code === "Digit5") {
        event.preventDefault()
        if (mode !== "register") openForm()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  async function look() {
    if (number === "" || busy) return
    setBusy(true)
    setProblem(null)
    setFound(null)
    setMissing(false)
    setRow(0)
    const reply = await api.lookupMember(memberFromScan(number) ?? number)
    setBusy(false)
    setAsked(number)
    if (reply.ok && reply.body) setFound(reply.body)
    else if (reply.status === 404) setMissing(true)
    else setProblem(memberRefusal(reply, "Kantor pusat tidak menjawab untuk member itu."))
  }

  function openForm() {
    const digits = (memberFromScan(number) ?? number).replace(/\D/g, "")
    setPhone(digits.length >= 6 ? digits : "")
    setProblem(null)
    setMode("register")
  }

  function back() {
    setProblem(null)
    setMode("find")
  }

  function attach(member: api.Member) {
    if (!member.blocked) onAttach?.(member, false)
  }

  /// Enter on the field: look it up; then, on the answer, add or register.
  function go() {
    if (number === "") {
      if (ask === "pay") onSkip?.()
      else openForm()
      return
    }
    if (!unchanged) void look()
    else if (answer !== null && row === 0) attach(answer)
    else openForm()
  }

  /// Ask head office to send the phone its code. What it answered, or null when
  /// it refused — the sentence is then on the form. The number is written back
  /// the way head office keys it, because that is what the code is for.
  async function sendCode(): Promise<Sent | null> {
    const digits = phone.replace(/\D/g, "")
    if (digits.length < 10 || digits.length > 13) {
      setProblem("Nomor HP harus 10–13 angka")
      phoneBox.current?.focus()
      return null
    }
    setSending(true)
    setProblem(null)
    const reply = await api.sendMemberCode(digits)
    setSending(false)
    if (!reply.ok || !reply.body) {
      setProblem(codeRefusal(reply, digits))
      return null
    }
    const answer = reply.body
    const asked: Sent = answer.required
      ? {
          required: true,
          memberId: answer.member_id,
          challengeId: answer.challenge_id,
          sentTo: answer.sent_to,
          sentAt: Date.now(),
        }
      : { required: false }
    setSent(asked)
    setCode("")
    if (answer.required) setPhone(answer.member_id)
    return asked
  }

  /// Enter on the phone, or "Kirim kode": the code is sent, then the caret goes
  /// where the form goes next — the code, or the name when head office wants none.
  async function phoneEnter() {
    if (busy || sending) return
    if (sent !== null || enrolled !== null) {
      ;(sent?.required ? codeBox : nameBox).current?.focus()
      return
    }
    const asked = await sendCode()
    if (asked !== null && !asked.required) nameBox.current?.focus()
  }

  async function enrol() {
    if (busy || sending) return
    const fail = (message: string, box?: React.RefObject<HTMLElement | null>) => {
      setProblem(message)
      box?.current?.focus()
    }
    let member = enrolled
    if (member === null) {
      const digits = phone.replace(/\D/g, "")
      if (digits.length < 10 || digits.length > 13) return fail("Nomor HP harus 10–13 angka", phoneBox)
      if (name.trim() === "") return fail("Nama wajib diisi", nameBox)
      if (gender === null) return fail("Pilih jenis kelamin", genderBox)
      if (place.trim() === "") return fail("Tempat lahir wajib diisi", placeBox)
      const iso = isoDate(birth)
      if (iso === null) return fail("Tanggal lahir dd/mm/yyyy", birthBox)
      // The form is whole: if no code has been asked for yet, this is the
      // moment — and the shopper reads it back before anything is saved.
      let asked = sent
      if (asked === null) {
        asked = await sendCode()
        if (asked === null) return
        if (asked.required) return
      }
      if (asked.required && code.length !== 6) return fail("Kode 6 angka dari pelanggan", codeBox)
      setBusy(true)
      setProblem(null)
      const reply = await api.registerMember(
        asked.required ? asked.memberId : digits,
        name.trim(),
        {
          gender,
          birth_place: place.trim(),
          birth_date: iso,
          address: address.trim() === "" ? null : address.trim(),
          email: email.trim() === "" ? null : email.trim(),
        },
        asked.required ? { challenge_id: asked.challengeId, code } : undefined,
      )
      if (!reply.ok || !reply.body) {
        setBusy(false)
        const said = reply.problem ?? ""
        if (/does not match|has expired/i.test(said)) {
          setCode("")
          setProblem("Kode salah atau sudah kedaluwarsa — minta pelanggan baca ulang, atau kirim ulang.")
          codeBox.current?.focus()
        } else if (/reads back the code/i.test(said)) {
          setSent(null)
          setCode("")
          setProblem("Kirim kode ke WhatsApp pelanggan dulu.")
        } else {
          setProblem(memberRefusal(reply, "Kantor pusat tidak bisa mendaftarkan member itu."))
        }
        return
      }
      member = reply.body
      setEnrolled(member)
    }
    if (onRegistered === undefined) {
      setBusy(false)
      onAttach?.(member, true)
      return
    }
    // ⇧5 with a struk: the member is tied to that sale and earns its points.
    if (wantedNo === "") {
      setBusy(false)
      onRegistered(member, null)
      return
    }
    setBusy(true)
    setProblem(null)
    const tie = await api.memberToReceipt(wantedNo, member.member_id)
    setBusy(false)
    if (!tie.ok || !tie.body) {
      setProblem(tieRefusal(tie, wantedNo))
      receiptBox.current?.focus()
      return
    }
    onRegistered(member, tie.body)
  }

  /// Leaving the form. A member this form already enrolled is registered whatever
  /// happened to the struk, and the counter is told so.
  function leave() {
    if (enrolled !== null && onRegistered !== undefined) onRegistered(enrolled, null)
    else onClose()
  }

  /// Enter in a form field: on to the next one; on the last, submit.
  function next(to: React.RefObject<HTMLElement | null> | null) {
    return (event: React.KeyboardEvent) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      if (to === null) void enrol()
      else to.current?.focus()
    }
  }

  function pickGender(value: "L" | "P") {
    setGender(value)
    setProblem(null)
    placeBox.current?.focus()
  }

  const overlay = (children: React.ReactNode, label: string, wide: boolean) => (
    <div
      className={enter ? "xchd enter" : "xchd"}
      onMouseDown={(event) => event.target === event.currentTarget && leave()}
    >
      <section className={wide ? "dlg mem-dlg wide" : "dlg mem-dlg"} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </section>
    </div>
  )

  const head = (title: string) => (
    <div className="dlg-head">
      <p className="ttl">{title}</p>
      <button type="button" className="x-btn" aria-label="Tutup" onClick={leave}>
        <Icon name="x" />
      </button>
    </div>
  )

  if (mode === "register") {
    return overlay(
      <>
        {head("Daftar member")}
        <div className="dlg-body d-pw">
          <div className="row2">
            <label>
              <span className="req">Nomor HP</span>
              <span className="inl">
                <input
                  ref={phoneBox}
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value)
                    // Another number needs its own code; "no code needed" is head
                    // office's and stays.
                    if (sent?.required) {
                      setSent(null)
                      setCode("")
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return
                    event.preventDefault()
                    void phoneEnter()
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0812 3456 7788"
                  maxLength={20}
                />
                {sent === null && enrolled === null && (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="ds-btn ds-btn--primary"
                    disabled={busy || sending}
                    onClick={() => void phoneEnter()}
                  >
                    {sending ? "Mengirim…" : "Kirim kode"}
                  </button>
                )}
              </span>
            </label>
            <label>
              <span className="req">Nama</span>
              <input
                ref={nameBox}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  if (gender === null) genderBox.current?.querySelector("button")?.focus()
                  else placeBox.current?.focus()
                }}
                autoComplete="off"
                spellCheck={false}
                maxLength={80}
              />
            </label>
          </div>
          {sent?.required === true && enrolled === null && (
            <label>
              <span className="req">Kode dari pelanggan</span>
              <span className="inl">
                <input
                  ref={codeBox}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    setProblem(null)
                  }}
                  onKeyDown={next(nameBox)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="6 angka"
                  maxLength={6}
                  aria-label="Kode dari pelanggan"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="ds-btn ds-btn--primary"
                  disabled={busy || sending || now - sent.sentAt < RESEND_AFTER}
                  onClick={() => void sendCode()}
                >
                  {sending
                    ? "Mengirim…"
                    : now - sent.sentAt < RESEND_AFTER
                      ? `Kirim ulang · ${Math.ceil((RESEND_AFTER - (now - sent.sentAt)) / 1000)}`
                      : "Kirim ulang"}
                </button>
              </span>
              <span className="mem-rc">Kode dikirim ke WhatsApp {sent.sentTo}</span>
            </label>
          )}
          <label>
            <span className="req">Jenis kelamin</span>
            <span className="seg2" ref={genderBox}>
              {(
                [
                  ["L", "Laki-laki"],
                  ["P", "Perempuan"],
                ] as const
              ).map(([key, word]) => (
                <button
                  key={key}
                  type="button"
                  className={gender === key ? "on" : ""}
                  aria-pressed={gender === key}
                  onClick={() => pickGender(key)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                      event.preventDefault()
                      ;(event.currentTarget.parentElement?.querySelectorAll("button")[key === "L" ? 1 : 0] as HTMLElement | undefined)?.focus()
                    }
                  }}
                >
                  {word}
                </button>
              ))}
            </span>
          </label>
          <div className="row2">
            <label>
              <span className="req">Tempat lahir</span>
              <input
                ref={placeBox}
                value={place}
                onChange={(event) => setPlace(event.target.value)}
                onKeyDown={next(birthBox)}
                autoComplete="off"
                maxLength={60}
              />
            </label>
            <label>
              <span className="req">Tanggal lahir</span>
              <input
                ref={birthBox}
                value={birth}
                onChange={(event) => setBirth(dated(event.target.value))}
                onKeyDown={next(addressBox)}
                placeholder="dd/mm/yyyy"
                inputMode="numeric"
                autoComplete="off"
              />
            </label>
          </div>
          <label>
            Alamat
            <input
              ref={addressBox}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={next(emailBox)}
              autoComplete="off"
              maxLength={200}
            />
          </label>
          <label>
            Email
            <input
              ref={emailBox}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={next(onRegistered === undefined ? null : receiptBox)}
              inputMode="email"
              autoComplete="off"
              maxLength={120}
            />
          </label>
          {onRegistered !== undefined && (
            <label>
              No. transaksi
              <input
                ref={receiptBox}
                value={receiptNo}
                onChange={(event) => {
                  setReceiptNo(event.target.value)
                  setProblem(null)
                }}
                onKeyDown={next(null)}
                placeholder="Scan atau ketik nomor struk"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
              />
              {sameSale !== undefined && (
                <span className="mem-rc">
                  {sameSale.receipt_no} · {clock(sameSale.completed_at)} · {money(sameSale.total_minor, "IDR")}
                </span>
              )}
            </label>
          )}
          {problem !== null && (
            <p className="mem-err" role="alert">
              {problem}
            </p>
          )}
        </div>
        <div className="dlg-foot">
          {!direct && (
            <button type="button" className="ds-btn ds-btn--ghost" onClick={back}>
              Kembali
            </button>
          )}
          <span className="sp" />
          <button type="button" className="ds-btn ds-btn--ghost" onClick={leave}>
            Batal
          </button>
          <button type="button" className="ds-btn ds-btn--primary" disabled={busy || sending} onClick={() => void enrol()}>
            <span>Daftar</span>
            <span className="kbd">Enter</span>
          </button>
        </div>
      </>,
      "Daftar member",
      true,
    )
  }

  const title = ask === "pay" ? "Apakah pelanggan member?" : forReceipt ? `Member untuk ${forReceipt}` : "Member"
  const newRowOn = row === rows
  return overlay(
    <>
      {head(title)}
      <div className="dlg-body">
        <input
          ref={findBox}
          className="field"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              go()
            } else if (event.key === "ArrowDown") {
              event.preventDefault()
              setRow(Math.min(rows, row + 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setRow(Math.max(0, row - 1))
            }
          }}
          placeholder="Scan kartu member atau ketik nomor HP"
          aria-label="Cari member"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          autoFocus
        />
        <div className="mem-list">
          {answer !== null && (
            <button type="button" className={row === 0 ? "mem on" : "mem"} onClick={() => attach(answer)}>
              <span className="av">{initials(answer.display_name)}</span>
              <span>
                <b>{answer.display_name}</b>
                <span>{maskPhone(answer.member_id)}</span>
              </span>
              {answer.blocked ? (
                <span className="bad">Diblokir</span>
              ) : (
                <span className="pts">{grouped(answer.points_balance)} poin</span>
              )}
            </button>
          )}
          {unchanged && missing && <p className="t-none">Tidak ada member “{number}”</p>}
          {problem !== null && (
            <p className="t-none mem-err" role="alert">
              {problem}
            </p>
          )}
          <button type="button" className={newRowOn ? "mem mem-new on" : "mem mem-new"} onClick={openForm}>
            <span className="av">
              <Icon name="plus" />
            </span>
            <span>
              <b>Daftar member baru</b>
              <span>{/^\d{6,}$/.test(digitsTyped) && answer === null ? `Nomor ${typed.trim()}` : ""}</span>
            </span>
            <span className="kbd">⇧5</span>
          </button>
        </div>
      </div>
      {ask === "pay" ? (
        <div className="dlg-foot">
          <span className="sp" />
          <button type="button" className="ds-btn ds-btn--primary" onClick={() => onSkip?.()}>
            <span>Bukan member, lanjut bayar</span>
            <span className="kbd">Enter</span>
          </button>
        </div>
      ) : current !== null ? (
        <div className="dlg-foot">
          <span className="mute">{current.display_name} ada di transaksi ini</span>
          <span className="sp" />
          <button type="button" className="ds-btn ds-btn--ghost ds-btn--takes-away" onClick={() => onClear?.()}>
            Hapus member
          </button>
        </div>
      ) : null}
    </>,
    title,
    true,
  )
}
