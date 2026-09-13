/// Formatting and wording, in one place.
///
/// **This app speaks Indonesian.** Every other surface in the estate is
/// English, and that is right for them: the hub is read at head office, the
/// contract is read by programmers. This one is read on a phone by the person
/// holding the carton, so the words are theirs — and because the server shouts
/// its enums in English (`PARTIALLY_RECEIVED`, `DRAFT`, `IN_TRANSIT`), the
/// translation has to happen somewhere. It happens here, once, rather than in
/// forty template literals that would each drift on their own.
///
/// **Money is not here.** It is `money()` from `@itulah/contract/money`, shared
/// with the centre and the warehouse; a second formatter would be exactly the
/// drift that estate once paid for.

const plain = new Intl.NumberFormat("id-ID")

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return plain.format(value)
}

/// A signed difference — a variance between what was ordered and what was
/// counted, a gain or a shortage on a stock take. The sign is the whole point,
/// so a zero is written as a zero rather than as a dash.
export function signed(value: number): string {
  if (value === 0) return "0"
  return value > 0 ? `+${plain.format(value)}` : plain.format(value)
}

/// A time somebody on a floor reads: the day and the minute. Almost everything
/// on this surface happened at a minute that matters — which lorry, which
/// round, how long that carton has been open.
export function moment(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/// How long ago, in words, for the one question a floor asks about a queue:
/// has this been sitting here?
export function ago(iso: string | null | undefined): string {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return "baru saja"
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.floor(hours / 24)
  return `${days} hari lalu`
}

/// The retail status taxonomy, one mapping for the whole app.
///
/// Keeping it here rather than per screen is what stops the same word being
/// amber on one list and green on the next.
export type Tone = "ok" | "warn" | "bad" | "info" | "accent" | "neutral"

const tones: Readonly<Record<string, Tone>> = {
  completed: "ok",
  complete: "ok",
  closed: "ok",
  received: "ok",
  accepted: "ok",
  active: "ok",
  approved: "ok",
  sealed: "ok",
  delivered: "ok",
  departed: "ok",

  pending: "warn",
  awaiting: "warn",
  draft: "warn",
  delayed: "warn",
  partial: "warn",
  partially_received: "warn",
  submitted: "warn",
  review: "warn",
  recount: "warn",

  issued: "info",
  shipped: "info",
  processing: "info",
  in_transit: "info",
  loaded: "info",
  packed: "info",
  picked: "info",
  picking: "info",
  shipment: "info",
  receiving: "info",
  open: "info",

  cancelled: "bad",
  canceled: "bad",
  rejected: "bad",
  failed: "bad",
  void: "bad",
  exception: "bad",
  short: "bad",
}

export function toneFor(status: string | null | undefined): Tone {
  if (!status) return "neutral"
  return tones[status.toLowerCase().replace(/[\s-]/g, "_")] ?? "neutral"
}

/// The server's enums, in the language of the floor.
///
/// Anything not in this table falls through to sentence case rather than to a
/// guess: an unknown status shown as `Partially staged` is readable, and an
/// unknown status translated by a machine is a word nobody can act on.
const words: Readonly<Record<string, string>> = {
  open: "Terbuka",
  closed: "Selesai",
  active: "Berjalan",
  draft: "Draf",
  review: "Diperiksa",
  submitted: "Dikirim",
  approved: "Disetujui",
  completed: "Selesai",
  complete: "Selesai",
  cancelled: "Dibatalkan",
  canceled: "Dibatalkan",
  rejected: "Ditolak",
  pending: "Menunggu",
  receiving: "Diterima sebagian",
  received: "Diterima",
  partially_received: "Diterima sebagian",
  accepted: "Diterima",
  recount: "Hitung ulang",
  packed: "Dikemas",
  picked: "Diambil",
  picking: "Diambil",
  shipment: "Masuk kiriman",
  sealed: "Disegel",
  loaded: "Dimuat",
  shipped: "Dikirim",
  in_transit: "Di jalan",
  delivered: "Sampai",
  departed: "Berangkat",
  full: "Penuh",
  cycle: "Berkala",
  targeted: "Terarah",
}

export function label(status: string | null | undefined): string {
  if (!status) return "—"
  const key = status.toLowerCase().replace(/[\s-]+/g, "_").trim()
  const known = words[key]
  if (known !== undefined) return known
  const plainWords = status.toLowerCase().replace(/[_-]+/g, " ").trim()
  return plainWords.charAt(0).toUpperCase() + plainWords.slice(1)
}

/// Indonesian has no plural form, so a count and its noun simply sit together.
/// Written as a helper anyway, because the one thing that does vary is whether
/// a zero is worth saying at all.
export function tally(value: number, noun: string): string {
  return `${count(value)} ${noun}`
}
